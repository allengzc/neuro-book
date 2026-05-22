import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider} from "@earendil-works/pi-ai";
import type {Context, FauxProviderRegistration} from "@earendil-works/pi-ai";
import {appendCompaction, COMPACTION_SUMMARY_PREFIX} from "nbook/server/agent/harness/compaction";
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
            options: {
                enabled: true,
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
            options: {
                enabled: true,
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
        const assistant = createAssistantTextMessage({text: ""});
        assistant.content = [fauxToolCall("request_user_input", {questions: []}, {id: "approval-1"})];
        await repo.appendMessage(session.metadata.sessionId, assistant, session.metadata.workspaceKey);
        const snapshot = await repo.readSession(session.metadata.sessionId);

        await expect(appendCompaction({
            repo,
            snapshot,
            messages: repo.reduce(snapshot).messages,
            model: faux.getModel(),
        })).rejects.toThrow("未完成 tool call");
    });
});

function summaryPromptText(context: Context | null): string {
    if (!context) {
        return "";
    }
    return context.messages.map((message) => messageText(message as never)).join("\n");
}
