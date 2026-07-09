import {randomUUID} from "node:crypto";
import {mkdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {consola} from "consola";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    PROJECT_GRACE_MS,
    ProjectNotOpenError,
    acquireUserPresence,
    assertProjectOpen,
    closeAllProjects,
    closeProject,
    isProjectOpen,
    listOpenProjects,
    markProjectActivity,
    openProject,
    projectOccupancy,
    registerAgentPresenceProbe,
    registerProjectResourceOwner,
    resetProjectSessionsForTest,
    sweepProjectSessions,
} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceAssetRootContextForTest} from "nbook/server/workspace-files/workspace-assets-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

type OwnerCalls = {
    closed: string[];
    closedAll: number;
};

/**
 * 注册一个记录调用轨迹的假属主。failRef.value 为 true 时 close 抛错，
 * 供泄漏重试用例在失败/成功之间切换。
 */
function registerRecordingOwner(name: string, failRef: {value: boolean} = {value: false}): OwnerCalls {
    const calls: OwnerCalls = {closed: [], closedAll: 0};
    registerProjectResourceOwner({
        name,
        async close(projectPath) {
            if (failRef.value) {
                throw new Error(`close ${name} failed`);
            }
            calls.closed.push(projectPath);
        },
        async closeAll() {
            calls.closedAll += 1;
        },
    });
    return calls;
}

describe("project-session 生命周期", () => {
    let tempRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        // 把 Workspace Root 指到临时目录，openProject 的目录校验与 sqlite 初始化都发生在这里。
        tempRoot = join(os.tmpdir(), `neuro-book-project-session-test-${randomUUID()}`);
        await mkdir(join(tempRoot, "workspace"), {recursive: true});
        setWorkspaceAssetRootContextForTest({workspaceContainerRoot: join(tempRoot, "workspace")});
    });

    afterEach(async () => {
        resetProjectSessionsForTest();
        setWorkspaceAssetRootContextForTest(null);
        collectReleasedSqliteHandles({force: true});
        await removeTempRootBestEffort(tempRoot);
    }, 60_000);

    /** 在临时 Workspace Root 下建一个可 open 的真实 Project（含 manifest，open 时能建 sqlite）。 */
    async function createTempProject(slug: string): Promise<string> {
        const projectPath = `workspace/${slug}`;
        await writeProjectManifest(projectPath, {kind: "novel", title: slug, summary: ""});
        return projectPath;
    }

    it("openProject 幂等且并发去重；目录不存在抛 404", async () => {
        await expect(openProject("workspace/does-not-exist", {kind: "user"})).rejects.toMatchObject({statusCode: 404});
        expect(isProjectOpen("workspace/does-not-exist")).toBe(false);

        const projectPath = await createTempProject("open-book");
        await Promise.all([
            openProject(projectPath, {kind: "user"}),
            openProject(projectPath, {kind: "agent", sessionId: 1}),
        ]);
        await openProject(projectPath, {kind: "job", source: "test"});

        expect(isProjectOpen(projectPath)).toBe(true);
        const sessionList = listOpenProjects();
        expect(sessionList).toHaveLength(1);
        expect(sessionList[0]).toMatchObject({projectPath, state: "open", userConnections: 0, agentActive: false});
        // open 时已跑 initProjectDatabase：Project SQLite 落盘。
        const databaseStat = await stat(join(tempRoot, "workspace", "open-book", ".nbook", "project.sqlite"));
        expect(databaseStat.isFile()).toBe(true);
    });

    it("acquireUserPresence 未 open 抛错；归零立即进 grace；再次 acquire 或 openProject 取消 grace", async () => {
        expect(() => acquireUserPresence("workspace/never-open")).toThrow(ProjectNotOpenError);

        const projectPath = await createTempProject("presence-book");
        await openProject(projectPath, {kind: "user"});
        const releaseFirst = acquireUserPresence(projectPath);
        const releaseSecond = acquireUserPresence(projectPath);
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 2, agentActive: false});

        // release 幂等：重复调用只扣减一次。
        releaseFirst();
        releaseFirst();
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 1, agentActive: false});

        // 归零：release 内立即进入 grace。
        releaseSecond();
        expect(projectOccupancy(projectPath)).toEqual({state: "grace", userConnections: 0, agentActive: false});

        // openProject 幂等分支取消 grace。
        await openProject(projectPath, {kind: "user"});
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 0, agentActive: false});

        // 再次归零后，acquire 直接取消 grace。
        acquireUserPresence(projectPath)();
        expect(projectOccupancy(projectPath)?.state).toBe("grace");
        acquireUserPresence(projectPath);
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 1, agentActive: false});
    });

    it("agent 探针在场时不进 grace；探针转 false 后经 sweep 进 grace 并到期关闭", async () => {
        const owner = registerRecordingOwner("agent-owner");
        const projectPath = await createTempProject("agent-book");
        await openProject(projectPath, {kind: "agent", sessionId: 7});
        const agentRunning = {value: true};
        registerAgentPresenceProbe((probedPath) => probedPath === projectPath && agentRunning.value);

        // presence 归零但 agent 在场：release 不进 grace，sweep 也不动它。
        acquireUserPresence(projectPath)();
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 0, agentActive: true});
        const base = Date.now();
        await expect(sweepProjectSessions(base)).resolves.toEqual([]);
        expect(projectOccupancy(projectPath)?.state).toBe("open");

        // agent 退场：sweep 进入 grace，宽限到期后关闭并调属主 close。
        agentRunning.value = false;
        await expect(sweepProjectSessions(base)).resolves.toEqual([]);
        expect(projectOccupancy(projectPath)?.state).toBe("grace");
        await expect(sweepProjectSessions(base + PROJECT_GRACE_MS + 1)).resolves.toEqual([projectPath]);
        expect(isProjectOpen(projectPath)).toBe(false);
        expect(owner.closed).toEqual([projectPath]);
    });

    it("closeProject 单属主失败：其余属主仍被调、项目进泄漏集合、下轮 sweep 重试成功后移出", async () => {
        const flakyFail = {value: true};
        const flaky = registerRecordingOwner("flaky-owner", flakyFail);
        const survivor = registerRecordingOwner("surviving-owner");
        const projectPath = "workspace/leaky-book";

        // session 不存在也执行属主关闭（删除流程会对未 open 项目调用）。
        await expect(closeProject(projectPath, "delete")).resolves.toBeUndefined();
        expect(survivor.closed).toEqual([projectPath]);
        expect(flaky.closed).toEqual([]);

        // 属主仍失败：泄漏重试重跑全部属主，项目留在泄漏集合。
        await expect(sweepProjectSessions()).resolves.toEqual([]);
        expect(survivor.closed).toEqual([projectPath, projectPath]);
        expect(flaky.closed).toEqual([]);

        // 属主恢复：重试成功后移出泄漏集合，再 sweep 不再重跑。
        flakyFail.value = false;
        await expect(sweepProjectSessions()).resolves.toEqual([]);
        expect(flaky.closed).toEqual([projectPath]);
        expect(survivor.closed).toEqual([projectPath, projectPath, projectPath]);
        await expect(sweepProjectSessions()).resolves.toEqual([]);
        expect(flaky.closed).toEqual([projectPath]);
        expect(survivor.closed).toEqual([projectPath, projectPath, projectPath]);
    });

    it("assertProjectOpen：open 与 grace 都放行，关闭后抛 ProjectNotOpenError", async () => {
        expect(() => assertProjectOpen("workspace/never-open")).toThrow(ProjectNotOpenError);

        const projectPath = await createTempProject("assert-book");
        await openProject(projectPath, {kind: "user"});
        expect(() => assertProjectOpen(projectPath)).not.toThrow();

        // grace 态仍视为打开。
        acquireUserPresence(projectPath)();
        expect(projectOccupancy(projectPath)?.state).toBe("grace");
        expect(() => assertProjectOpen(projectPath)).not.toThrow();

        await closeProject(projectPath, "shutdown");
        try {
            assertProjectOpen(projectPath);
            expect.unreachable("closed 项目应当抛 ProjectNotOpenError");
        } catch (error) {
            expect(error).toBeInstanceOf(ProjectNotOpenError);
            expect((error as ProjectNotOpenError).projectPath).toBe(projectPath);
        }
    });

    it("markProjectActivity 不建 session，也不影响状态机", async () => {
        markProjectActivity("workspace/never-open");
        expect(listOpenProjects()).toEqual([]);

        const projectPath = await createTempProject("activity-book");
        await openProject(projectPath, {kind: "user"});
        const before = listOpenProjects()[0];
        await new Promise((resolve) => setTimeout(resolve, 15));
        markProjectActivity(projectPath);
        const after = listOpenProjects()[0];
        expect(after).toMatchObject({projectPath, state: "open", userConnections: 0});
        expect(after && before && after.lastActivityAt > before.lastActivityAt).toBe(true);
        expect(after?.openedAt).toBe(before?.openedAt);
    });

    it("closeAllProjects 调每个属主 closeAll 一次并清空会话", async () => {
        const first = registerRecordingOwner("bulk-owner-a");
        const second = registerRecordingOwner("bulk-owner-b");
        const projectPath = await createTempProject("close-all-book");
        await openProject(projectPath, {kind: "user"});

        await closeAllProjects();

        expect(first.closedAll).toBe(1);
        expect(second.closedAll).toBe(1);
        expect(first.closed).toEqual([]);
        expect(second.closed).toEqual([]);
        expect(listOpenProjects()).toEqual([]);
        expect(isProjectOpen(projectPath)).toBe(false);
    });

    it("同名属主重复注册按替换处理", async () => {
        const stale = registerRecordingOwner("same-name");
        const active = registerRecordingOwner("same-name");
        const projectPath = "workspace/replace-book";

        await closeProject(projectPath, "delete");

        expect(stale.closed).toEqual([]);
        expect(active.closed).toEqual([projectPath]);
    });

    it("跨世代 release 不误扣新会话：close+重开后旧连接的迟到 release 是 no-op", async () => {
        const projectPath = await createTempProject("generation-book");
        await openProject(projectPath, {kind: "user"});
        const staleRelease = acquireUserPresence(projectPath);

        // 关闭并重开：sessions 记录被替换为新世代对象。
        await closeProject(projectPath, "shutdown");
        await openProject(projectPath, {kind: "user"});
        acquireUserPresence(projectPath); // 新世代的一路连接，userConnections=1

        // 旧世代连接的迟到 release：按对象身份比对应为 no-op，不得扣减新会话计数、不得使其进 grace。
        staleRelease();
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 1, agentActive: false});
    });

    it("重开清除泄漏标记：泄漏项目被重新 open 后，sweep 不再对其重试 close", async () => {
        const flakyFail = {value: true};
        const flaky = registerRecordingOwner("reopen-flaky", flakyFail);
        const projectPath = await createTempProject("reopen-leak-book");

        // 关闭失败 → 进泄漏集合。
        await openProject(projectPath, {kind: "user"});
        await closeProject(projectPath, "delete");
        expect(isProjectOpen(projectPath)).toBe(false);

        // 重新 open：establish 清除泄漏标记（新会话资源不该被泄漏重试误关）。
        flakyFail.value = false;
        await openProject(projectPath, {kind: "user"});
        const closedBefore = flaky.closed.length;
        await expect(sweepProjectSessions()).resolves.toEqual([]);
        expect(flaky.closed.length).toBe(closedBefore); // 未再对该 key 重试 close
        expect(isProjectOpen(projectPath)).toBe(true);
    });

    it("grace-expired close 在锁内复检：会话已回 open 时跳过关闭", async () => {
        const owner = registerRecordingOwner("recheck-owner");
        const projectPath = await createTempProject("recheck-book");
        await openProject(projectPath, {kind: "user"});

        // 会话处于 open（非 grace）：直接对其发 grace-expired close 应被复检拦截为 no-op。
        await closeProject(projectPath, "grace-expired");
        expect(isProjectOpen(projectPath)).toBe(true);
        expect(owner.closed).toEqual([]);
    });

    it("close 与重开串行互斥：慢属主关闭途中重开，新会话资源不被误关", async () => {
        // 可控闸门属主：close 阻塞在 gate 上，模拟慢关闭期间的并发重开。
        let releaseGate: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            releaseGate = resolve;
        });
        const closedKeys: string[] = [];
        registerProjectResourceOwner({
            name: "gated-owner",
            async close(projectPath) {
                closedKeys.push(projectPath);
                await gate;
            },
            async closeAll() {},
        });
        const projectPath = await createTempProject("serialize-book");
        await openProject(projectPath, {kind: "user"});

        // 启动 close（阻塞在 gate），随后并发发起重开——重开必须排队到 close 之后。
        const closing = closeProject(projectPath, "delete");
        const reopening = openProject(projectPath, {kind: "user"});
        releaseGate();
        await Promise.all([closing, reopening]);

        // close 只对旧会话关了一次；重开在 close 完成后建立新会话，最终处于 open。
        expect(closedKeys).toEqual([projectPath]);
        expect(isProjectOpen(projectPath)).toBe(true);
        expect(projectOccupancy(projectPath)).toEqual({state: "open", userConnections: 0, agentActive: false});

        // 收尾关闭重开的会话：触发 force GC 释放 sqlite 句柄，避免 Windows 下 afterEach 清理临时目录受阻。
        await closeProject(projectPath, "shutdown");
    });
});

/** 清理临时目录：Windows 下 sqlite 句柄可能延迟释放，重试后仍失败只告警不让用例失败。 */
async function removeTempRootBestEffort(target: string): Promise<void> {
    try {
        collectReleasedSqliteHandles({force: true});
        await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error
            && (error.code === "EBUSY" || error.code === "EPERM" || error.code === "ENOTEMPTY")) {
            consola.warn({target, error}, "清理临时 Project 目录失败，忽略");
            return;
        }
        throw error;
    }
}
