import {randomUUID} from "node:crypto";
import {mkdir, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import os from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceAssetRootContextForTest} from "nbook/server/workspace-files/workspace-assets-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {recordAgentWorkspaceWrite, resolveAgentWritePath} from "nbook/server/workspace-history/agent-file-recorder";
import {
    ensureProjectHistory,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    workspaceHistoryResourceOwner,
} from "nbook/server/workspace-history/project-history";

describe("resolveAgentWritePath 项目反推", () => {
    const workspaceRoot = resolve("workspace");

    it("容器内项目文件反推 workspace/<slug> + 项目内相对路径", () => {
        expect(resolveAgentWritePath(workspaceRoot, join(workspaceRoot, "my-book", "manuscript", "ch1.md")))
            .toEqual({projectPath: "workspace/my-book", relativePath: "manuscript/ch1.md"});
        // 跨项目别名：归属跟落盘位置走，不看 context.projectPath
        expect(resolveAgentWritePath(workspaceRoot, join(workspaceRoot, "other-book", "lorebook", "npc.md")))
            .toEqual({projectPath: "workspace/other-book", relativePath: "lorebook/npc.md"});
    });

    it("越界 / 容器根散文件 / user-assets 返回 null", () => {
        expect(resolveAgentWritePath(workspaceRoot, resolve("outside", "x.md"))).toBeNull();
        expect(resolveAgentWritePath(workspaceRoot, join(workspaceRoot, "loose.md"))).toBeNull();
        expect(resolveAgentWritePath(workspaceRoot, join(workspaceRoot, ".nbook", "agent", "bin", "workspace"))).toBeNull();
    });
});

describe("recordAgentWorkspaceWrite 归因记账", () => {
    let tempRoot: string;
    let workspaceRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        registerProjectResourceOwner(workspaceHistoryResourceOwner);
        setHistoryEnabledOverrideForTest(true);
        tempRoot = join(os.tmpdir(), `neuro-book-agent-recorder-test-${randomUUID()}`);
        workspaceRoot = join(tempRoot, "workspace");
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceAssetRootContextForTest({workspaceContainerRoot: workspaceRoot});
    });

    afterEach(async () => {
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceAssetRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    it("写入归因 agent + String(sessionId)，删除记 before 快照，未 open 项目静默跳过", async () => {
        const projectPath = "workspace/attribution";
        await writeProjectManifest(projectPath, {kind: "novel", title: "attribution", summary: ""});
        await openProjectForTest(projectPath);

        const filePath = join(workspaceRoot, "attribution", "manuscript", "ch1.md");
        await recordAgentWorkspaceWrite({sessionId: 42, workspaceRoot, absolutePath: filePath, before: null, after: "v1"});
        await recordAgentWorkspaceWrite({sessionId: 42, workspaceRoot, absolutePath: filePath, before: "v1", after: null});

        const history = (await ensureProjectHistory(projectPath))!;
        const timeline = await history.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.delete"]);
        expect(timeline[0]!.entry.actor).toEqual({kind: "agent", sessionId: "42"});

        // 未 open 的项目：反推成功但 record 静默跳过（fail-open）
        await recordAgentWorkspaceWrite({
            sessionId: 42, workspaceRoot,
            absolutePath: join(workspaceRoot, "not-open", "manuscript", "x.md"),
            before: null, after: "x",
        });
        expect(await ensureProjectHistory("workspace/not-open")).toBeNull();
    });
});
