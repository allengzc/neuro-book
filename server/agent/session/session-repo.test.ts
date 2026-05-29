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

    it("workspace session 列表只读取指定 workspaceKey", async () => {
        const workspaceSession = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "workspace",
            title: "workspace session",
        });
        const projectSession = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace/novel-7",
            workspaceKey: "workspace/novel-7",
            projectPath: "workspace/novel-7",
            title: "project session",
        });
        const userAssetsSession = await repo.createSession({
            profileKey: "leader.assets",
            input: {},
            workspaceRoot: "workspace/.nbook",
            workspaceKey: "user-assets",
            title: "assets session",
        });

        const sessions = await repo.listSessions({workspaceKey: "workspace"});

        expect(sessions.map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
            workspaceSession.metadata.sessionId,
        ]);
        expect(sessions.some((session) => session.sessionId === userAssetsSession.metadata.sessionId)).toBe(false);
        expect(sessions.some((session) => session.sessionId === projectSession.metadata.sessionId)).toBe(false);
    });

    it("session 列表支持 profile、状态、关系和数量筛选", async () => {
        const leader = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "workspace",
            title: "leader",
        });
        await repo.createSession({
            profileKey: "writer",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "workspace",
            parentSessionId: leader.metadata.sessionId,
            title: "writer",
        });
        const assetsLeader = await repo.createSession({
            profileKey: "leader.assets",
            input: {},
            workspaceRoot: "workspace/.nbook",
            workspaceKey: "workspace",
            title: "assets leader",
        });
        await repo.appendEntry(assetsLeader.metadata.sessionId, {
            type: "session_archived",
            reason: "test",
        }, assetsLeader.metadata.workspaceKey);

        const leaders = await repo.listSessions({
            workspaceKey: "workspace",
            includeArchived: true,
            profileGroup: "leader",
        });
        expect(leaders.map((session) => session.profileKey)).toEqual(["leader.assets", "leader.default"]);

        const topActiveLeaders = await repo.listSessions({
            workspaceKey: "workspace",
            profileGroup: "leader",
            status: "active",
            relation: "top",
            limit: 1,
        });
        expect(topActiveLeaders).toHaveLength(1);
        expect(topActiveLeaders[0]).toMatchObject({
            sessionId: leader.metadata.sessionId,
            profileKey: "leader.default",
        });

        const childSessions = await repo.listSessions({
            workspaceKey: "workspace",
            includeArchived: true,
            relation: "child",
        });
        expect(childSessions.map((session) => session.profileKey)).toEqual(["writer"]);

        const runtimeOnlySessions = await repo.listSessions({
            workspaceKey: "workspace",
            includeArchived: true,
            status: "running",
        });
        expect(runtimeOnlySessions).toEqual([]);
    });

    it("session 列表默认隐藏 system session，includeSystem 时显示", async () => {
        const leader = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "workspace",
            title: "leader",
        });
        const summarizer = await repo.createSession({
            profileKey: "summarizer",
            input: {sourceSessionId: leader.metadata.sessionId},
            workspaceRoot: "workspace",
            workspaceKey: "workspace",
            systemRole: "summarizer",
            title: "summarizer",
        });

        const defaultList = await repo.listSessions({workspaceKey: "workspace"});
        const systemList = await repo.listSessions({workspaceKey: "workspace", includeSystem: true});

        expect(defaultList.map((session) => session.sessionId)).toEqual([leader.metadata.sessionId]);
        expect(systemList.map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
            leader.metadata.sessionId,
            summarizer.metadata.sessionId,
        ]);
        expect(systemList.find((session) => session.sessionId === summarizer.metadata.sessionId)?.systemRole).toBe("summarizer");
    });

    it("active leaf scoped projection 只影响绑定的分支", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
            title: "base",
        });
        const userEntry = await repo.appendUserMessage(session.metadata.sessionId, "root");
        const firstBranch = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "branch a"}));
        await repo.moveLeaf(session.metadata.sessionId, userEntry.id);
        const secondBranch = await repo.appendMessage(session.metadata.sessionId, createAssistantTextMessage({text: "branch b"}));

        const firstProjection = await repo.appendProjectionEntry(session.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "Branch A Title",
                summary: "Branch A summary",
            },
        }, {
            scope: "activeLeaf",
            leafId: firstBranch.id,
        });
        const secondProjection = await repo.appendProjectionEntry(session.metadata.sessionId, {
            type: "session_update",
            updates: {
                title: "Branch B Title",
                summary: "Branch B summary",
            },
        }, {
            scope: "activeLeaf",
            leafId: secondBranch.id,
        });

        let snapshot = await repo.readSession(session.metadata.sessionId);
        expect(snapshot.leafId).toBe(secondBranch.id);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "Branch B Title",
            summary: "Branch B summary",
        });

        await repo.moveLeaf(session.metadata.sessionId, firstBranch.id);
        snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "Branch A Title",
            summary: "Branch A summary",
        });

        await repo.moveLeaf(session.metadata.sessionId, userEntry.id);
        snapshot = await repo.readSession(session.metadata.sessionId);
        expect(repo.reduce(snapshot)).toMatchObject({
            title: "base",
            summary: undefined,
        });
        const treeNodeIds = repo.tree(snapshot).map((node) => node.id);
        expect(treeNodeIds).not.toContain(firstProjection.id);
        expect(treeNodeIds).not.toContain(secondProjection.id);
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

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: unknown[]});
        const batch = records.find((record) => record.kind === "batch");
        expect(batch?.entries?.map((entry) => (entry as {type: string}).type)).toEqual(["message", "message", "leaf"]);
    });
});
