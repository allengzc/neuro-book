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
import {AppendingSet, FileChangeNotice, ProfilePrompt} from "nbook/server/agent/profiles/profile-dsl";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {Message} from "nbook/server/agent/messages/types";
import {buildFileChangeReminder, mergeProfileTurnContextMessages} from "nbook/server/agent/profiles/profile-turn-context";
import type {AgentChangeDiffDetail} from "nbook/server/workspace-history/agent-change-diff";
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
        expect(minimal).toContain("added: [manuscript/ch1.md](manuscript/ch1.md) — 2 changes");
        expect(minimal).not.toContain("agent#12");

        const full = buildFileChangeReminder(groups, "full");
        expect(full).toContain("the user");
        expect(full).toContain("agent#12");
        expect(full).toContain("added");
        expect(full).toContain("modified");
        expect(full).toContain("read");
    });

    it("组合操作按净状态保留 Git 风格主状态", () => {
        const actor = {kind: "user", userId: "local"} as const;
        const entry = (id: number, operation: UnseenGroup["entries"][number]["operation"]): UnseenGroup["entries"][number] => ({
            id,
            occurredAt: new Date(id * 1000).toISOString(),
            actor,
            operation,
        });
        const groups: UnseenGroup[] = [
            {
                path: "notes/added.md",
                baseHash: null,
                endHash: "added-2",
                maxEntryId: 2,
                entries: [
                    entry(1, {type: "file.create", path: "notes/added.md", afterHash: "added-1"}),
                    entry(2, {type: "file.edit", path: "notes/added.md", beforeHash: "added-1", afterHash: "added-2"}),
                ],
            },
            {
                path: "notes/renamed.md",
                baseHash: "rename-1",
                endHash: "rename-2",
                maxEntryId: 4,
                entries: [
                    entry(3, {type: "file.rename", fromPath: "notes/old.md", toPath: "notes/renamed.md", contentHash: "rename-1"}),
                    entry(4, {type: "file.edit", path: "notes/renamed.md", beforeHash: "rename-1", afterHash: "rename-2"}),
                ],
            },
            {
                path: "notes/restored.md",
                baseHash: null,
                endHash: "restore-2",
                maxEntryId: 6,
                entries: [
                    entry(5, {type: "file.restore", path: "notes/restored.md", beforeHash: null, afterHash: "restore-1", sourceEntryId: 1}),
                    entry(6, {type: "file.edit", path: "notes/restored.md", beforeHash: "restore-1", afterHash: "restore-2"}),
                ],
            },
            {
                path: "notes/reverted.md",
                baseHash: "revert-before",
                endHash: "revert-2",
                maxEntryId: 8,
                entries: [
                    entry(7, {type: "file.revert", path: "notes/reverted.md", beforeHash: "revert-before", afterHash: "revert-1", revertedEntryIds: [1]}),
                    entry(8, {type: "file.edit", path: "notes/reverted.md", beforeHash: "revert-1", afterHash: "revert-2"}),
                ],
            },
            {
                path: "notes/deleted.md",
                baseHash: "delete-before",
                endHash: null,
                maxEntryId: 9,
                entries: [entry(9, {type: "file.revert", path: "notes/deleted.md", beforeHash: "delete-before", afterHash: null, revertedEntryIds: [2]})],
            },
        ];

        const notice = buildFileChangeReminder(groups, "minimal");

        expect(notice).toContain("added: [notes/added.md]");
        expect(notice).toContain("renamed: [notes/renamed.md]");
        expect(notice).toContain("restored: [notes/restored.md]");
        expect(notice).toContain("reverted: [notes/reverted.md]");
        expect(notice).toContain("deleted: notes/deleted.md");
    });

    it("安全小 diff 内联，超限 diff 只给引用与变更位置", () => {
        const groups: UnseenGroup[] = [{
            path: "manuscript/ch1.md",
            baseHash: "before",
            endHash: "after",
            maxEntryId: 1,
            entries: [{id: 1, occurredAt: "2026-07-09T00:00:00Z", actor: {kind: "user", userId: "local"}, operation: {type: "file.edit", path: "manuscript/ch1.md", beforeHash: "before", afterHash: "after"}}],
        }];
        const inlineDetails = new Map<string, AgentChangeDiffDetail>([["manuscript/ch1.md", {
            kind: "inline",
            diff: "@@ -1,1 +1,1 @@\n-old\n+new",
            locations: ["新 L1 / 旧 L1"],
            charCount: 31,
            changedLineCount: 2,
            lineLimit: 16,
        }]]);
        const inline = buildFileChangeReminder(groups, "minimal", inlineDetails, 512);
        expect(inline).toContain("Diff: 31 characters, 2 changed lines");
        expect(inline).toContain("+new");

        const referenceDetails = new Map<string, AgentChangeDiffDetail>([["manuscript/ch1.md", {
            kind: "reference",
            locations: ["新 L20-L40 / 旧 L18-L35"],
            charCount: 900,
            changedLineCount: 30,
            lineLimit: 16,
        }]]);
        const reference = buildFileChangeReminder(groups, "minimal", referenceDetails, 512);
        expect(reference).toContain("Location: new L20-L40 / old L18-L35");
        expect(reference).toContain("Use read for the complete current file");
    });

    it("单个敏感文件只给普通路径和 inbox 指引，不生成链接或 read 建议", () => {
        const group = unseenGroup(".env.local", 1);
        const details = new Map<string, AgentChangeDiffDetail>([[group.path, {kind: "blocked"}]]);

        const notice = buildFileChangeReminder([group], "full", details, 512);

        expect(notice).toContain("modified: .env.local");
        expect(notice).not.toContain("[.env.local](.env.local)");
        expect(notice).toContain("Sensitive path");
        expect(notice).toContain("file change inbox");
        expect(notice).not.toContain("use read");
        expect(notice).not.toContain("Use read");
    });

    it("敏感文件不在前四个 diff detail 中时仍保持阻断表现", () => {
        const groups = [
            unseenGroup("notes/one.md", 1),
            unseenGroup("notes/two.md", 2),
            unseenGroup("notes/three.md", 3),
            unseenGroup("notes/four.md", 4),
            unseenGroup(".env.production", 5),
        ];

        const notice = buildFileChangeReminder(groups, "minimal", new Map(), 512);

        expect(notice).toContain("modified: .env.production");
        expect(notice).not.toContain("[.env.production](.env.production)");
        expect(notice).toContain("Sensitive path");
        expect(notice).toContain("Sensitive paths must be reviewed in the file change inbox");
    });

    it("敏感与普通文件混合时 read 指引只适用于非敏感路径", () => {
        const groups = [unseenGroup("manuscript/ch1.md", 1), unseenGroup(".env.local", 2)];

        const notice = buildFileChangeReminder(groups, "full", new Map(), 512);

        expect(notice).toContain("[manuscript/ch1.md](manuscript/ch1.md)");
        expect(notice).not.toContain("[.env.local](.env.local)");
        expect(notice).toContain("use read only when the task needs complete current content from a non-sensitive path");
        expect(notice).toContain("Sensitive paths are excluded from the prompt and must be reviewed in the file change inbox");
    });

    it("敏感删除文件无链接且明确当前路径不可读取", () => {
        const group = unseenGroup("credentials/private.key", 1, null);

        const notice = buildFileChangeReminder([group], "full", new Map(), 512);

        expect(notice).toContain("deleted: credentials/private.key");
        expect(notice).not.toContain("[credentials/private.key](credentials/private.key)");
        expect(notice).toContain("Sensitive path");
        expect(notice).toContain("current path cannot be read");
        expect(notice).not.toContain("use read");
        expect(notice).not.toContain("Use read");
    });

    it("批量变更最多逐项列出 50 个文件，并保留准确遗漏数量", () => {
        const groups = Array.from({length: 55}, (_, index) => unseenGroup(`notes/change-${index}.md`, index + 1));

        const notice = buildFileChangeReminder(groups, "minimal");

        expect(notice).toContain("notes/change-49.md");
        expect(notice).not.toContain("notes/change-50.md");
        expect(notice).toContain("5 additional changed files were not expanded");
        expect(Array.from(notice).length).toBeLessThanOrEqual(12_288);
    });

    it("删除文件不生成当前文件链接，超限时只提示当前路径不可读取", () => {
        const group = unseenGroup("manuscript/deleted.md", 1, null);
        const details = new Map<string, AgentChangeDiffDetail>([[group.path, {
            kind: "reference",
            locations: ["新 ∅ / 旧 L1-L40"],
            charCount: 900,
            changedLineCount: 40,
            lineLimit: 16,
        }]]);

        const notice = buildFileChangeReminder([group], "full", details, 512);

        expect(notice).toContain("deleted: manuscript/deleted.md");
        expect(notice).not.toContain("[manuscript/deleted.md](manuscript/deleted.md)");
        expect(notice).toContain("current path cannot be read");
        expect(notice).not.toContain("Use read for the complete current file");
    });

    it("动态 notice 按 Profile 声明的位置插回 AppendingSet", () => {
        const merged = mergeProfileTurnContextMessages(
            [createUserMessage({text: "BEFORE"}), createUserMessage({text: "AFTER"})],
            [{appendingIndex: 1, message: createUserMessage({text: "NOTICE"})}],
        );

        expect(merged.map(messageText)).toEqual(["BEFORE", "NOTICE", "AFTER"]);
    });
});

/** 构造 notice 纯函数测试使用的单条 unseen 分组。 */
function unseenGroup(path: string, id: number, endHash: string | null = `after-${id}`): UnseenGroup {
    return {
        path,
        baseHash: `before-${id}`,
        endHash,
        maxEntryId: id,
        entries: [{
            id,
            occurredAt: new Date(id * 1000).toISOString(),
            actor: {kind: "user", userId: "local"},
            operation: endHash === null
                ? {type: "file.delete", path, beforeHash: `before-${id}`}
                : {type: "file.edit", path, beforeHash: `before-${id}`, afterHash: endHash},
        }],
    };
}

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
            context() {
                return ProfilePrompt({
                    children: AppendingSet({children: FileChangeNotice({mode: "minimal"})}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice",
            initial: {},
            workspaceRoot: agentRoot,
            projectPath,
        });

        // 首轮：Profile 显式声明 notice；懒 initCursor 以当下为基线。
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
        expect(notice).toContain("Diff:");
        expect(notice).toContain("+用户改动");

        // 第三轮：游标已推进且无新变更，不再注入
        faux.setResponses([fauxAssistantMessage("第三轮完成")]);
        const third = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第三轮"}});
        expect(third.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(1);
    }, 30_000);

    it("模型失败不推进游标，notice 位于 CurrentUserInput 前并在成功重试后结算", async () => {
        const projectPath = "workspace/notice-at-least-once";
        await writeProjectManifest(projectPath, {kind: "novel", title: "notice-at-least-once", summary: ""});
        await openProjectForTest(projectPath);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.retry", name: "NoticeRetry"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return ProfilePrompt({
                    children: AppendingSet({children: FileChangeNotice({mode: "minimal"})}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.retry",
            initial: {},
            workspaceRoot: agentRoot,
            projectPath,
        });

        faux.setResponses([fauxAssistantMessage("建立基线")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "基线轮"}});
        await recordProjectWrite({
            projectPath,
            relativePath: "manuscript/retry.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("需要重复交付"),
        });

        faux.setResponses([(context) => {
            const texts = context.messages.map((message) => messageText(message));
            const noticeIndex = texts.findIndex((text) => text.includes("<file-change-notice>"));
            expect(noticeIndex).toBeGreaterThanOrEqual(0);
            expect(noticeIndex).toBeLessThan(texts.length - 1);
            expect(texts.at(-1)).toContain("失败轮");
            return fauxAssistantMessage("provider failed", {stopReason: "error", errorMessage: "provider failed"});
        }]);
        const failed = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "失败轮"}});
        expect(failed.status).toBe("error");

        let retryNoticeCount = 0;
        faux.setResponses([(context) => {
            const texts = context.messages.map((message) => messageText(message));
            expect(texts.some((text) => text.includes("manuscript/retry.md"))).toBe(true);
            expect(texts.at(-1)).toContain("重试轮");
            retryNoticeCount = texts.filter((text) => text.includes("<file-change-notice>")).length;
            return fauxAssistantMessage("重试成功");
        }]);
        const retried = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "重试轮"}});
        expect(retried.status).toBe("completed");

        faux.setResponses([(context) => {
            const texts = context.messages.map((message) => messageText(message));
            expect(texts.filter((text) => text.includes("<file-change-notice>")).length).toBe(retryNoticeCount);
            return fauxAssistantMessage("结算完成");
        }]);
        const settled = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "结算检查"}});
        expect(settled.status).toBe("completed");
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

    it("敏感文件只注入引用和阻断说明，绝不把正文或 diff 送给 Agent", async () => {
        const projectPath = "workspace/notice-sensitive";
        await writeProjectManifest(projectPath, {kind: "novel", title: "notice-sensitive", summary: ""});
        await openProjectForTest(projectPath);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.sensitive", name: "NoticeSensitive"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            context() {
                return ProfilePrompt({
                    children: AppendingSet({children: FileChangeNotice({mode: "full"})}),
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.sensitive",
            initial: {},
            workspaceRoot: agentRoot,
            projectPath,
        });

        faux.setResponses([fauxAssistantMessage("第一轮完成")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第一轮"}});
        await recordProjectWrite({
            projectPath,
            relativePath: ".env.local",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("SUPER_SECRET_VALUE=never-echo"),
        });

        faux.setResponses([fauxAssistantMessage("第二轮完成")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第二轮"}});
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const notice = context.messages
            .filter((message): message is Message => message.role !== "custom")
            .map((message) => messageText(message))
            .find((text) => text.includes("<file-change-notice>"));

        expect(notice).toContain(".env.local");
        expect(notice).toContain("Sensitive path");
        expect(notice).not.toContain("SUPER_SECRET_VALUE");
        expect(notice).not.toContain("never-echo");
    }, 30_000);

    it("有 Project 和未见变更，但 Profile 未声明节点时绝不注入 notice", async () => {
        const projectPath = "workspace/notice-disabled";
        await writeProjectManifest(projectPath, {kind: "novel", title: "notice-disabled", summary: ""});
        await openProjectForTest(projectPath);
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.notice.disabled", name: "NoticeDisabled"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.notice.disabled",
            initial: {},
            workspaceRoot: agentRoot,
            projectPath,
        });

        faux.setResponses([fauxAssistantMessage("第一轮完成")]);
        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第一轮"}});
        await recordProjectWrite({
            projectPath,
            relativePath: "manuscript/ch1.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("用户改动"),
        });

        faux.setResponses([fauxAssistantMessage("第二轮完成")]);
        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "第二轮"}});

        expect(result.status).toBe("completed");
        expect(await countNotices(created.sessionId)).toBe(0);
    }, 30_000);
});
