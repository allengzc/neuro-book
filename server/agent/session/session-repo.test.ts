import {randomUUID} from "node:crypto";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";

describe("JsonlSessionRepository", () => {
    let root: string;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = join(".agent", "agent-session-test", randomUUID());
        repo = new JsonlSessionRepository(root);
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("创建 session 使用全局递增 ID 并 reduce active path", async () => {
        const first = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
            title: "first",
        });
        const second = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "novel-a",
            title: "second",
        });

        expect(first.metadata.sessionId).toBe(1);
        expect(second.metadata.sessionId).toBe(2);

        await repo.appendUserMessage(first.metadata.sessionId, "hello", first.metadata.workspaceKey);
        await repo.appendMessage(first.metadata.sessionId, createAssistantTextMessage({text: "hi"}), first.metadata.workspaceKey);
        await repo.appendEntry(first.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "renamed",
                summary: "short summary",
            },
        }, first.metadata.workspaceKey);

        const context = repo.reduce(await repo.readSession(first.metadata.sessionId));

        expect(context.title).toBe("renamed");
        expect(context.summary).toBe("short summary");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    });

    it("支持 leaf 移动和 fork，历史不删除", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const userEntry = await repo.appendUserMessage(session.metadata.sessionId, "first", session.metadata.workspaceKey);
        await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "answer"}), session.metadata.workspaceKey);

        await repo.moveLeaf(session.metadata.sessionId, userEntry.id, session.metadata.workspaceKey);
        const moved = await repo.readSession(session.metadata.sessionId);

        expect(repo.reduce(moved).messages.map((message) => message.role)).toEqual(["user"]);
        expect(repo.tree(moved).some((node) => node.type === "message" && !node.active)).toBe(true);

        const fork = await repo.forkSession(session.metadata.sessionId, userEntry.id);
        const forkContext = repo.reduce(fork);

        expect(fork.metadata.sessionId).toBe(2);
        expect(fork.metadata.parentSessionId).toBe(session.metadata.sessionId);
        expect(forkContext.customState["fork.fromEntryId"]).toBe(userEntry.id);
    });

    it("tree 返回消息展示元数据和终端节点信息", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const userEntry = await repo.appendUserMessage(session.metadata.sessionId, "first message", session.metadata.workspaceKey);
        const firstAssistantEntry = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "first answer"}), session.metadata.workspaceKey);

        await repo.moveLeaf(session.metadata.sessionId, userEntry.id, session.metadata.workspaceKey);
        const secondAssistantEntry = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "second answer"}), session.metadata.workspaceKey);
        await repo.appendEntry(session.metadata.sessionId, {
            type: "label",
            targetEntryId: secondAssistantEntry.id,
            label: "selected",
        }, session.metadata.workspaceKey);

        const tree = repo.tree(await repo.readSession(session.metadata.sessionId));
        const userNode = tree.find((node) => node.id === userEntry.id);
        const firstAssistantNode = tree.find((node) => node.id === firstAssistantEntry.id);
        const secondAssistantNode = tree.find((node) => node.id === secondAssistantEntry.id);

        expect(userNode).toMatchObject({
            role: "user",
            messageId: userEntry.id,
            preview: "first message",
            childCount: 2,
            terminal: false,
            active: true,
        });
        expect(firstAssistantNode).toMatchObject({
            role: "assistant",
            preview: "first answer",
            childCount: 0,
            terminal: true,
            active: false,
        });
        expect(secondAssistantNode).toMatchObject({
            role: "assistant",
            preview: "second answer",
            label: "selected",
            terminal: false,
            active: true,
        });
    });

    it("appendEntries 以单条 batch record 写入多条 entry 并只移动一次 leaf", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        await repo.appendUserMessage(session.metadata.sessionId, "run", session.metadata.workspaceKey);

        const entries = await repo.appendEntries(session.metadata.sessionId, [
            {
                type: "message",
                message: createAssistantTextMessage({text: "I will call a tool"}),
                origin: "harness",
            },
            {
                type: "message",
                message: createTextToolResult({
                    toolCallId: "call-1",
                    toolName: "read",
                    text: "ok",
                }),
                origin: "harness",
            },
        ], session.metadata.workspaceKey);

        expect(entries.map((entry) => entry.type)).toEqual(["message", "message"]);
        const snapshot = await repo.readSession(session.metadata.sessionId, session.metadata.workspaceKey);
        expect(repo.reduce(snapshot).messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);

        const sessionPath = join(root, ".nbook", "agent", "sessions", "global", `${String(session.metadata.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: unknown[]});
        const batch = records.find((record) => record.kind === "batch");
        expect(batch?.entries?.map((entry) => (entry as {type: string}).type)).toEqual(["message", "message", "leaf"]);
    });
});
