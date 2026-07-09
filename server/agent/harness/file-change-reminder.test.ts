import {randomUUID} from "node:crypto";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, registerFauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderRegistration} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {Message} from "nbook/server/agent/messages/types";
import {buildFileChangeReminder, resolveFileChangeAwareness} from "nbook/server/agent/harness/file-change-reminder";
import type {UnseenGroup} from "nbook/server/vendor/nb-history/index";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceAssetRootContextForTest} from "nbook/server/workspace-files/workspace-assets-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    LOCAL_USER_ID,
    recordProjectWrite,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    workspaceHistoryResourceOwner,
} from "nbook/server/workspace-history/project-history";

describe("file-change-reminder 纯函数", () => {
    it("resolveFileChangeAwareness：合法值透传，未声明/非法回退 minimal（D12）", () => {
        expect(resolveFileChangeAwareness({fileChangeAwareness: "off"})).toBe("off");
        expect(resolveFileChangeAwareness({fileChangeAwareness: "full"})).toBe("full");
        expect(resolveFileChangeAwareness({})).toBe("minimal");
        expect(resolveFileChangeAwareness(undefined)).toBe("minimal");
        expect(resolveFileChangeAwareness({fileChangeAwareness: 42})).toBe("minimal");
    });

    it("buildFileChangeReminder：minimal 只含路径条数，full 含归因与操作类型", () => {
        const groups: UnseenGroup[] = [{
            path: "manuscript/ch1.md",
            baseHash: null,
            endHash: "abc",
            maxEntryId: 9,
            entries: [
                {id: 8, occurredAt: "2026-07-09T00:00:00Z", actor: {kind: "user", userId: "local"}, operation: {type: "file.create", path: "manuscript/ch1.md", afterHash: "aaa"}},
                {id: 9, occurredAt: "2026-07-09T00:01:00Z", actor: {kind: "agent", sessionId: "12"}, operation: {type: "file.edit", path: "manuscript/ch1.md", beforeHash: "aaa", afterHash: "abc"}},
            ],
        }];
        const minimal = buildFileChangeReminder(groups, "minimal");
        expect(minimal).toContain("<file-change-notice>");
        expect(minimal).toContain("manuscript/ch1.md（2 条变更）");
        expect(minimal).not.toContain("agent#12");

        const full = buildFileChangeReminder(groups, "full");
        expect(full).toContain("用户");
        expect(full).toContain("agent#12");
        expect(full).toContain("新建");
        expect(full).toContain("修改");
        expect(full).toContain("read");
    });
});

describe("file-change notice 端到端（FauxProvider 黑盒）", () => {
    let agentRoot: string;
    let tempRoot: string;
    let faux: FauxProviderRegistration;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        registerProjectResourceOwner(workspaceHistoryResourceOwner);
        setHistoryEnabledOverrideForTest(true);
        tempRoot = join(os.tmpdir(), `nb-file-change-notice-${randomUUID()}`);
        await mkdir(join(tempRoot, "workspace"), {recursive: true});
        setWorkspaceAssetRootContextForTest({workspaceContainerRoot: join(tempRoot, "workspace")});
        agentRoot = join(".agent", "file-change-notice-test", randomUUID());
        faux = registerFauxProvider({
            models: [{id: `faux-${randomUUID()}`, contextWindow: 128_000, maxTokens: 8_000}],
        });
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(agentRoot),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
        faux.unregister();
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceAssetRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(agentRoot, {recursive: true, force: true}).catch(() => undefined);
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    /** session 内 <file-change-notice> 消息计数。 */
    async function countNotices(sessionId: number): Promise<number> {
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        return context.messages
            .filter((message): message is Message => message.role !== "custom")
            .filter((message) => messageText(message).includes("<file-change-notice>"))
            .length;
    }

    it("他人变更注入 notice，成功轮推进游标，下轮不重复；首轮懒基线不淹没", async () => {
        const projectPath = "workspace/notice-e2e";
        await writeProjectManifest(projectPath, {kind: "novel", title: "notice", summary: ""});
        await openProjectForTest(projectPath);

        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice", name: "Notice"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice",
            initial: {},
            workspaceRoot: agentRoot,
            projectPath,
        });

        // 首轮：懒 initCursor 以当下为基线（未声明 settings 的 profile 默认 minimal，D12）
        faux.setResponses([fauxAssistantMessage("第一轮完成")]);
        const first = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第一轮"}});
        expect(first.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(0);

        // 他人（用户）改文件
        await recordProjectWrite({
            projectPath,
            relativePath: "manuscript/ch1.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("用户改动"),
        });

        // 第二轮：pre-model 注入 notice
        faux.setResponses([fauxAssistantMessage("第二轮完成")]);
        const second = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第二轮"}});
        expect(second.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(1);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const notice = context.messages
            .filter((message): message is Message => message.role !== "custom")
            .map((message) => messageText(message))
            .find((text) => text.includes("<file-change-notice>"));
        expect(notice).toContain("manuscript/ch1.md");

        // 第三轮：游标已推进且无新变更，不再注入
        faux.setResponses([fauxAssistantMessage("第三轮完成")]);
        const third = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第三轮"}});
        expect(third.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(1);
    }, 30_000);

    it("无 projectPath 的 session 不注入 notice", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.global", name: "NoticeGlobal"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.global",
            initial: {},
            workspaceRoot: agentRoot,
        });
        faux.setResponses([fauxAssistantMessage("完成")]);
        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "跑一轮"}});
        expect(result.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(0);
    }, 30_000);
});
