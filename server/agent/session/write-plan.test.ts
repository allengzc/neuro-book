import {randomUUID} from "node:crypto";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {SessionWriteExecutor} from "nbook/server/agent/session/write-plan";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";

describe("SessionWriteExecutor", () => {
    let root: string;
    let repo: JsonlSessionRepository;
    let eventHub: AgentSessionEventHub;
    let executor: SessionWriteExecutor;

    beforeEach(() => {
        root = join(".agent", "agent-write-plan-test", randomUUID());
        repo = new JsonlSessionRepository(root);
        eventHub = new AgentSessionEventHub();
        executor = new SessionWriteExecutor({
            repo,
            eventHub,
            liveStateProvider: async (sessionId) => ({
                summary: {
                    sessionId,
                    profileKey: "leader.default",
                    workspaceKey: "global",
                    workspaceRoot: root,
                    status: "idle",
                    updatedAt: 1,
                    archived: false,
                },
                activeLeafId: null,
                pendingApproval: null,
                steerQueue: [],
                followUpQueue: {
                    status: "ready",
                    items: [],
                },
                activeInvocation: null,
                model: null,
                thinkingLevel: null,
                effectiveThinkingLevel: "off",
                planModeActive: false,
            }),
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("要求 write plan 必须有 target 和 cause", async () => {
        await expect(executor.execute([{
            target: {sessionId: 0},
            cause: "test",
            ops: [],
        }])).rejects.toThrow("target.sessionId");

        await expect(executor.execute([{
            target: {sessionId: 1},
            cause: "",
            ops: [],
        }])).rejects.toThrow("cause");
    });

    it("按顺序写入 batch 并发布 session events", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const events: string[] = [];
        let stateChangedEvent: AgentSessionEventDto | undefined;
        const subscription = eventHub.subscribe(session.metadata.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();

        const result = await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "test",
            ops: [{
                kind: "appendMany",
                entries: [
                    {
                        type: "message",
                        message: createAssistantTextMessage({text: "assistant"}),
                        origin: "harness",
                    },
                    {
                        type: "message",
                        message: createTextToolResult({
                            toolCallId: "tool-1",
                            toolName: "read",
                            text: "ok",
                        }),
                        origin: "harness",
                    },
                ],
            }],
        }], "invoke-1");

        for (let index = 0; index < 3; index += 1) {
            const event = await iterator.next();
            if (!event.done) {
                events.push(event.value.kind === "session" ? event.value.event.type : event.value.kind);
                if (event.value.kind === "session" && event.value.event.type === "session_state_changed") {
                    stateChangedEvent = event.value;
                }
            }
        }
        await iterator.return?.();
        expect(result.entries.map((entry) => entry.type)).toEqual(["message", "message"]);
        expect(events).toEqual(["session_entry", "session_entry", "session_state_changed"]);
        expect(stateChangedEvent?.kind).toBe("session");
        if (stateChangedEvent?.kind === "session" && stateChangedEvent.event.type === "session_state_changed") {
            expect(stateChangedEvent.event).not.toHaveProperty("snapshot");
            expect(stateChangedEvent.event.state.summary.sessionId).toBe(session.metadata.sessionId);
            expect(stateChangedEvent.event.state).not.toHaveProperty("messages");
            expect(stateChangedEvent.event.state).not.toHaveProperty("entries");
            expect(stateChangedEvent.event.state).not.toHaveProperty("tree");
            expect(JSON.stringify(stateChangedEvent).length).toBeLessThan(50_000);
        }
        expect(repo.reduce(await repo.readSession(session.metadata.sessionId)).messages.map((message) => message.role)).toEqual(["assistant", "toolResult"]);
    });

    it("连续 savePoint plans 会合并成同一个 session batch", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });

        await executor.execute([
            {
                target: {sessionId: session.metadata.sessionId},
                cause: "turn.ingest",
                durability: "savePoint",
                ops: [{
                    kind: "appendMany",
                    entries: [
                        {
                            type: "message",
                            message: createAssistantTextMessage({text: "assistant"}),
                            origin: "harness",
                        },
                        {
                            type: "message",
                            message: createTextToolResult({
                                toolCallId: "tool-1",
                                toolName: "read",
                                text: "ok",
                            }),
                            origin: "harness",
                        },
                    ],
                }],
            },
            {
                target: {sessionId: session.metadata.sessionId},
                cause: "tool.state",
                durability: "savePoint",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "custom",
                        key: "test.tool.state",
                        value: "queued",
                    },
                }],
            },
        ], "invoke-1");

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(session.metadata.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; key?: string; message?: {role?: string}}>});
        const batches = records.filter((record) => record.kind === "batch");
        expect(batches).toHaveLength(1);
        expect((batches[0]?.entries ?? [])
            .filter((entry) => entry.type !== "leaf")
            .map((entry) => entry.type === "message" ? entry.message?.role : entry.key)).toEqual([
            "assistant",
            "toolResult",
            "test.tool.state",
        ]);
    });

    it("projection 写入不移动 active leaf", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const user = await repo.appendUserMessage(session.metadata.sessionId, "hello");

        await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "projection",
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "session_update",
                    updates: {
                        title: "Title",
                    },
                },
            }],
        }]);

        const snapshot = await repo.readSession(session.metadata.sessionId);
        expect(snapshot.leafId).toBe(user.id);
        expect(repo.reduce(snapshot).title).toBe("Title");
    });

    it("同一个 session 的并发写入会串行执行", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const originalAppendEntry = repo.appendEntry.bind(repo);
        let activeAppends = 0;
        let maxActiveAppends = 0;
        repo.appendEntry = async (...args: Parameters<JsonlSessionRepository["appendEntry"]>): ReturnType<JsonlSessionRepository["appendEntry"]> => {
            activeAppends += 1;
            maxActiveAppends = Math.max(maxActiveAppends, activeAppends);
            await new Promise((resolve) => setTimeout(resolve, 10));
            try {
                return await originalAppendEntry(...args);
            } finally {
                activeAppends -= 1;
            }
        };

        await Promise.all([
            executor.execute([{
                target: {sessionId: session.metadata.sessionId},
                cause: "concurrent.first",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "message",
                        message: createAssistantTextMessage({text: "first"}),
                        origin: "harness",
                    },
                }],
            }]),
            executor.execute([{
                target: {sessionId: session.metadata.sessionId},
                cause: "concurrent.second",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "message",
                        message: createAssistantTextMessage({text: "second"}),
                        origin: "harness",
                    },
                }],
            }]),
        ]);

        expect(maxActiveAppends).toBe(1);
        expect(repo.reduce(await repo.readSession(session.metadata.sessionId)).messages.map((message) => message.role)).toEqual(["assistant", "assistant"]);
    });

    it("moveLeaf op 会移动 active leaf 并发布 session events", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            workspaceKey: "global",
        });
        const user = await repo.appendUserMessage(session.metadata.sessionId, "hello");
        const subscription = eventHub.subscribe(session.metadata.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();

        const result = await executor.execute([{
            target: {sessionId: session.metadata.sessionId},
            cause: "tree.before",
            ops: [{
                kind: "moveLeaf",
                leafId: user.parentId,
            }],
        }], "invoke-1");

        const firstEvent = await iterator.next();
        const secondEvent = await iterator.next();
        await iterator.return?.();
        const snapshot = await repo.readSession(session.metadata.sessionId);
        expect(result.entries.map((entry) => entry.type)).toEqual(["leaf"]);
        expect(snapshot.leafId).toBeNull();
        expect(firstEvent.done ? undefined : firstEvent.value.kind === "session" ? firstEvent.value.event.type : firstEvent.value.kind).toBe("session_entry");
        expect(secondEvent.done ? undefined : secondEvent.value.kind === "session" ? secondEvent.value.event.type : secondEvent.value.kind).toBe("session_state_changed");
    });
});
