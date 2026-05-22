import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {createAssistantTextMessage} from "nbook/server/agent/messages/message-utils";

describe("JsonlSessionRepository", () => {
    let root: string;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = join(".agent", "agent-v3-session-test", randomUUID());
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
});
