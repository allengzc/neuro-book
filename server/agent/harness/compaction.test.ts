import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider} from "@earendil-works/pi-ai";
import type {Context, FauxProviderRegistration} from "@earendil-works/pi-ai";
import {appendCompaction, COMPACTION_PROMPT, COMPACTION_SUMMARY_PREFIX, compactIfNeeded, resolveCompactionOptions, shouldCompactWithOptions} from "nbook/server/agent/harness/compaction";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";

describe("compaction", () => {
    let root: string;
    let repo: JsonlSessionRepository;
    let faux: FauxProviderRegistration;

    beforeEach(() => {
        root = join(".agent", "agent-compaction-test", randomUUID());
        repo = new JsonlSessionRepository(root);
        faux = registerFauxProvider({
            models: [{
                id: `faux-compact-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
    });

    afterEach(async () => {
        faux.unregister();
        await rm(root, {recursive: true, force: true});
    });

    it("使用 LLM 生成 summary，并在 reduce 后保留 summary + recent messages", async () => {
        let summaryPrompt: Context | null = null;
        faux.setResponses([
            (context) => {
                summaryPrompt = context;
                return fauxAssistantMessage(fauxText("LLM SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        for (let index = 1; index <= 6; index += 1) {
            await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: `user ${String(index)}`}), session.metadata.workspaceKey);
        }
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            model: faux.getModel(),
            instructions: "focus on files",
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecentTokens: 1,
            },
        });

        const context = repo.reduce(await repo.readSession(session.metadata.sessionId));

        expect(summaryPromptText(summaryPrompt)).toContain("focus on files");
        expect(messageText(context.messages[0] as never)).toContain(COMPACTION_SUMMARY_PREFIX);
        expect(messageText(context.messages[0] as never)).toContain("LLM SUMMARY");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "user"]);
        expect(messageText(context.messages[1] as never)).toBe("user 6");
    });

    it("cut point 不会从 toolResult 半截开始", async () => {
        faux.setResponses([fauxAssistantMessage(fauxText("TOOL SUMMARY"))]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old"}), session.metadata.workspaceKey);
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [
            fauxText("call"),
            fauxToolCall("report_result", {result: "ok"}, {id: "tool-1"}),
        ];
        await repo.appendMessage(session.metadata.sessionId, assistant, session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createTextToolResult({
            toolCallId: "tool-1",
            toolName: "report_result",
            text: "ok",
        }), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            model: faux.getModel(),
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecentTokens: 1,
            },
        });

        const context = repo.reduce(await repo.readSession(session.metadata.sessionId));

        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(messageText(context.messages[1] as never)).toContain("[tool:report_result]");
        expect(messageText(context.messages[2] as never)).toBe("ok");
    });

    it("存在未完成 tool call 时拒绝压缩", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [fauxToolCall("request_user_input", {questions: []}, {id: "approval-1"})];
        await repo.appendMessage(session.metadata.sessionId, assistant, session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await expect(appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            model: faux.getModel(),
            writeCompactionEntry,
            compaction: {
                reserveTokens: 2_000,
                keepRecentTokens: 1,
            },
        })).rejects.toThrow("未完成 tool call");
    });

    it("没有 profile Compaction policy 时不会自动压缩", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        const compacted = await compactIfNeeded({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            model: faux.getModel(),
            writeCompactionEntry,
        });

        expect(compacted).toBe(false);
    });

    it("解析默认 prompt/prefix、百分比触发和 recent 百分比", () => {
        const options = resolveCompactionOptions({
            triggerPercent: 0.8,
            keepRecentPercent: 0.25,
        }, faux.getModel());

        expect(options.prompt).toBe(COMPACTION_PROMPT);
        expect(options.summaryPrefix).toBe(COMPACTION_SUMMARY_PREFIX);
        expect(options.keepRecentTokens).toBe(32_000);
        expect(shouldCompactWithOptions(102_400, 128_000, options)).toBe(true);
        expect(shouldCompactWithOptions(102_399, 128_000, options)).toBe(false);
    });

    it("triggerTokens 生效并把自定义 prompt/prefix 写入 summary 调用和 compaction entry", async () => {
        let summaryPrompt: Context | null = null;
        let summaryHeaders: Record<string, string> | undefined;
        faux.setResponses([
            (context, options) => {
                summaryPrompt = context;
                summaryHeaders = options?.headers;
                return fauxAssistantMessage(fauxText("CUSTOM SUMMARY"));
            },
        ]);
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const writeCompactionEntry = createCompactionEntryWriter(repo, session.metadata.sessionId);
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "old context"}), session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        const compacted = await compactIfNeeded({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            model: {
                ...faux.getModel(),
                headers: {
                    "x-model": "model",
                    "x-shared": "model",
                },
            },
            requestOptions: {
                headers: {
                    "x-request": "request",
                    "x-shared": "request",
                },
            },
            compaction: {
                triggerTokens: 1,
                keepRecentTokens: 1,
                prompt: "CUSTOM PROMPT",
                summaryPrefix: "CUSTOM PREFIX",
            },
            writeCompactionEntry,
        });

        const reduced = repo.reduce(await repo.readSession(session.metadata.sessionId));
        expect(compacted).toBe(true);
        const capturedPrompt = summaryPrompt as Context | null;
        expect(capturedPrompt?.systemPrompt).toBe("CUSTOM PROMPT");
        expect(summaryHeaders).toEqual({
            "x-request": "request",
            "x-model": "model",
            "x-shared": "model",
        });
        expect(messageText(reduced.messages[0] as never)).toContain("CUSTOM PREFIX");
    });
});

function createCompactionEntryWriter(repo: JsonlSessionRepository, sessionId: number): Parameters<typeof appendCompaction>[0]["writeCompactionEntry"] {
    return async (entry) => {
        await repo.appendEntry(sessionId, entry);
    };
}

function summaryPromptText(context: Context | null): string {
    if (!context) {
        return "";
    }
    return context.messages.map((message) => messageText(message as never)).join("\n");
}
