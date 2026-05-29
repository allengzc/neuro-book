import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall} from "@earendil-works/pi-ai";
import {createTextToolResult, createUserMessage} from "nbook/server/agent/messages/message-utils";
import {buildAgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";

describe("Agent Dialogue Content", () => {
    let root: string;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = join(".agent", "dialogue-content-test", randomUUID());
        repo = new JsonlSessionRepository(root);
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("只渲染普通 user/assistant 文本和 compaction，并排除 tool/thinking/custom", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        await repo.appendMessage(session.metadata.sessionId, createUserMessage({text: "用户正文"}), session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, fauxAssistantMessage([
            fauxText("助手正文"),
            fauxThinking("内部思考"),
            fauxToolCall("read", {path: "x"}, {id: "tool-1"}),
        ]), session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createTextToolResult({
            toolCallId: "tool-1",
            toolName: "read",
            text: "工具结果",
        }), session.metadata.workspaceKey);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "custom_message",
            message: createUserMessage({text: "自定义可见消息"}),
            visibleToModel: true,
        }, session.metadata.workspaceKey);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "compaction",
            summary: "压缩摘要",
            firstKeptEntryId: null,
            tokensBefore: 100,
        }, session.metadata.workspaceKey);

        const content = buildAgentDialogueContent({
            repo,
            snapshot: await repo.readSession(session.metadata.sessionId, session.metadata.workspaceKey),
            summarizerProfileKey: "summarizer",
            summarizerInput: {sourceSessionId: session.metadata.sessionId},
        });

        expect(content.text).toContain("[user ");
        expect(content.text).toContain("用户正文");
        expect(content.text).toContain("[assistant ");
        expect(content.text).toContain("助手正文");
        expect(content.text).toContain("[compaction ");
        expect(content.text).toContain("压缩摘要");
        expect(content.text).not.toContain("内部思考");
        expect(content.text).not.toContain("[tool:");
        expect(content.text).not.toContain("工具结果");
        expect(content.text).not.toContain("自定义可见消息");
        expect(content.tokens).toBeGreaterThan(0);
        expect(content.fingerprint).toHaveLength(64);
    });
});
