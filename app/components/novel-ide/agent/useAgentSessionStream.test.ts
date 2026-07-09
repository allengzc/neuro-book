import {beforeEach, describe, expect, it, vi} from "vitest";
import {ref} from "vue";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {useAgentSessionStream} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import type {AgentSessionEventDto, AgentSessionEventsQueryDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";

type AgentSessionEventWithoutEpoch = AgentSessionEventDto extends infer Event
    ? Event extends AgentSessionEventDto ? Omit<Event, "eventEpoch"> : never
    : never;

const baseSnapshot = (lastSeq = 0, eventEpoch = "epoch-1"): AgentSessionSnapshotDto => ({
    eventEpoch,
    eventCursor: {
        eventEpoch,
        after: lastSeq,
    },
    latestSeq: lastSeq,
    summary: {
        sessionId: 1,
        profileKey: "leader.default",
        workspaceKey: "global",
        workspaceRoot: ".",
        status: "idle",
        updatedAt: 1,
        archived: false,
    },
    activeLeafId: null,
    activePathRevision: null,
    messages: [],
    tree: [],
    entries: [],
    linkedAgents: [],
    linkedByAgents: [],
    pendingUserInputs: [],
    pendingApprovals: [],
    steerQueue: [],
    followUpQueue: {
        status: "ready",
        items: [],
    },
    activeInvocation: null,
    model: null,
    thinkingLevel: null,
    effectiveThinkingLevel: "off",
    agentMode: "normal",
    lastSeq,
});

const sessionEvent = (event: AgentSessionEventWithoutEpoch, eventEpoch = "epoch-1"): AgentSessionEventDto => {
    if (event.kind === "runtime") {
        return {
            eventEpoch,
            ...event,
        };
    }
    return {
        eventEpoch,
        ...event,
    };
};

const connectedEvent = (seq: number, eventEpoch = "epoch-1"): AgentSessionEventDto => ({
    eventEpoch,
    seq,
    sessionId: 1,
    kind: "session",
    event: {type: "connected", eventEpoch, latestSeq: seq},
});

describe("useAgentSessionStream", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("首次订阅使用 snapshot eventCursor 作为 after", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot({
            ...baseSnapshot(3),
            eventCursor: {
                eventEpoch: "epoch-1",
                after: 3,
            },
            latestSeq: 7,
        });
        const cursors: AgentSessionEventsQueryDto[] = [];
        const stream = useAgentSessionStream({
            session,
            activeSessionId,
            api: {
                getSession: vi.fn(async () => baseSnapshot(3)),
                subscribeSessionEvents: vi.fn(async (_sessionId, cursor, onEvent, _signal, options) => {
                    cursors.push(cursor);
                    options?.onOpen?.();
                    await onEvent(connectedEvent(7, cursor.eventEpoch ?? "epoch-1"));
                }),
            },
        });

        await stream.start(1);

        expect(cursors[0]).toEqual({eventEpoch: "epoch-1", after: 3});
        stream.stop();
    });

    it("stream close 后按 lastSeq 自动重连", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(7));
        const cursorValues: AgentSessionEventsQueryDto[] = [];
        let calls = 0;
        const api = {
            getSession: vi.fn(async () => baseSnapshot(7)),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, cursor: AgentSessionEventsQueryDto, onEvent: (event: AgentSessionEventDto) => void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                calls += 1;
                cursorValues.push(cursor);
                options?.onOpen?.();
                onEvent(connectedEvent(cursor.after ?? 0, cursor.eventEpoch ?? "epoch-1"));
                if (calls === 1) {
                    return;
                }
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await stream.start(1);
        expect(session.connectionStatus.value).toBe("reconnecting");
        await vi.advanceTimersByTimeAsync(300);

        expect(api.subscribeSessionEvents).toHaveBeenCalledTimes(2);
        expect(cursorValues).toEqual([
            {eventEpoch: "epoch-1", after: 7},
            {eventEpoch: "epoch-1", after: 7},
        ]);
    });

    it("多个 snapshot_required 触发只拉一次 snapshot", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        let resolveSnapshot!: (snapshot: AgentSessionSnapshotDto) => void;
        const api = {
            getSession: vi.fn(() => new Promise<AgentSessionSnapshotDto>((resolve) => {
                resolveSnapshot = resolve;
            })),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, onEvent: (event: AgentSessionEventDto) => Promise<void> | void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                options?.onOpen?.();
                void onEvent(sessionEvent({
                    seq: 2,
                    sessionId: 1,
                    kind: "session",
                    event: {type: "snapshot_required", reason: "buffer expired"},
                }));
                void onEvent(sessionEvent({
                    seq: 3,
                    sessionId: 1,
                    kind: "session",
                    event: {type: "snapshot_required", reason: "buffer expired again"},
                }));
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await stream.start(1);
        await Promise.resolve();

        expect(api.getSession).toHaveBeenCalledTimes(1);
        resolveSnapshot(baseSnapshot(3));
        await Promise.resolve();
        expect(session.lastSeq.value).toBe(3);
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("后端 event epoch 换代后拉 snapshot 并允许 cursor 回退", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(426, "epoch-1"));
        const api = {
            getSession: vi.fn(async () => baseSnapshot(0, "epoch-2")),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, onEvent: (event: AgentSessionEventDto) => Promise<void> | void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                options?.onOpen?.();
                await onEvent(connectedEvent(0, "epoch-2"));
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await stream.start(1);
        await vi.waitFor(() => {
            expect(api.getSession).toHaveBeenCalledTimes(1);
        });

        expect(session.eventEpoch.value).toBe("epoch-2");
        expect(session.lastSeq.value).toBe(0);
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("切换 session 后丢弃旧 session 的 in-flight snapshot", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        let resolveOldSnapshot!: (snapshot: AgentSessionSnapshotDto) => void;
        const api = {
            getSession: vi.fn((sessionId: number) => {
                if (sessionId === 1) {
                    return new Promise<AgentSessionSnapshotDto>((resolve) => {
                        resolveOldSnapshot = resolve;
                    });
                }
                return Promise.resolve({...baseSnapshot(9), summary: {...baseSnapshot(9).summary, sessionId}});
            }),
            subscribeSessionEvents: vi.fn(async () => new Promise<void>(() => {})),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        const oldSync = stream.syncSnapshot("manual_refresh");
        activeSessionId.value = 2;
        session.applySnapshot({...baseSnapshot(9), summary: {...baseSnapshot(9).summary, sessionId: 2}});
        resolveOldSnapshot({...baseSnapshot(5), summary: {...baseSnapshot(5).summary, sessionId: 1}});

        await expect(oldSync).resolves.toBe(false);
        expect(session.snapshot.value?.summary.sessionId).toBe(2);
        expect(session.lastSeq.value).toBe(9);
    });

    it("stop 后丢弃同 session 的 in-flight snapshot", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        let resolveSnapshot!: (snapshot: AgentSessionSnapshotDto) => void;
        const api = {
            getSession: vi.fn(() => new Promise<AgentSessionSnapshotDto>((resolve) => {
                resolveSnapshot = resolve;
            })),
            subscribeSessionEvents: vi.fn(async () => new Promise<void>(() => {})),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        const sync = stream.syncSnapshot("manual_refresh");
        stream.stop();
        resolveSnapshot(baseSnapshot(5));

        await expect(sync).resolves.toBe(false);
        expect(session.lastSeq.value).toBe(1);
    });

    it("旧 snapshot finally 不清掉新的同 session single-flight", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        let resolveOldSnapshot!: (snapshot: AgentSessionSnapshotDto) => void;
        let resolveNewSnapshot!: (snapshot: AgentSessionSnapshotDto) => void;
        let callCount = 0;
        const api = {
            getSession: vi.fn(() => {
                callCount += 1;
                if (callCount === 1) {
                    return new Promise<AgentSessionSnapshotDto>((resolve) => {
                        resolveOldSnapshot = resolve;
                    });
                }
                return new Promise<AgentSessionSnapshotDto>((resolve) => {
                    resolveNewSnapshot = resolve;
                });
            }),
            subscribeSessionEvents: vi.fn(async () => new Promise<void>(() => {})),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        const oldSync = stream.syncSnapshot("manual_refresh");
        stream.stop();
        const newSync = stream.syncSnapshot("manual_refresh");
        resolveOldSnapshot(baseSnapshot(3));
        await expect(oldSync).resolves.toBe(false);

        const reusedNewSync = stream.syncSnapshot("manual_refresh");
        expect(api.getSession).toHaveBeenCalledTimes(2);

        resolveNewSnapshot(baseSnapshot(5));
        await expect(newSync).resolves.toBe(true);
        await expect(reusedNewSync).resolves.toBe(true);
        expect(session.lastSeq.value).toBe(5);
    });

    it("manual refresh snapshot 不伪造 SSE connected 状态", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        session.applyConnectionStatus("disconnected");
        const api = {
            getSession: vi.fn(async () => baseSnapshot(5)),
            subscribeSessionEvents: vi.fn(async () => new Promise<void>(() => {})),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await stream.syncSnapshot("manual_refresh");

        expect(session.connectionStatus.value).toBe("disconnected");
        expect(session.lastSeq.value).toBe(5);
    });

    it("active path revision 改变时通过 snapshot 恢复消息投影", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        const api = {
            getSession: vi.fn(async () => ({
                ...baseSnapshot(2),
                activePathRevision: "leaf-move-1",
            })),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, onEvent: (event: AgentSessionEventDto) => Promise<void> | void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                options?.onOpen?.();
                await onEvent(sessionEvent({
                    seq: 2,
                    sessionId: 1,
                    kind: "session",
                    event: {
                        type: "session_state_changed",
                        state: {
                            summary: baseSnapshot(2).summary,
                            activeInvocation: null,
                            activeLeafId: "entry-1",
                            activePathRevision: "leaf-move-1",
                            pendingUserInputs: [],
                            pendingApprovals: [],
                            steerQueue: [],
                            followUpQueue: {
                                status: "ready",
                                items: [],
                            },
                            model: null,
                            thinkingLevel: null,
                            effectiveThinkingLevel: "off",
                            agentMode: "normal",
                        },
                    },
                }));
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await stream.start(1);

        expect(api.getSession).toHaveBeenCalledTimes(1);
        expect(session.needsSnapshot.value).toBe(false);
        expect(session.snapshot.value?.activePathRevision).toBe("leaf-move-1");
    });

    it("agent link entry 改变关联关系时通过 snapshot 刷新 linked agents", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        const api = {
            getSession: vi.fn(async () => ({
                ...baseSnapshot(2),
                linkedAgents: [{
                    sessionId: 2,
                    profileKey: "writer",
                    workspaceKey: "global",
                    workspaceRoot: ".",
                    status: "idle" as const,
                    updatedAt: 2,
                    archived: false,
                    detached: false,
                }],
            })),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, onEvent: (event: AgentSessionEventDto) => Promise<void> | void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                options?.onOpen?.();
                await onEvent(sessionEvent({
                    seq: 2,
                    sessionId: 1,
                    kind: "session",
                    event: {
                        type: "session_entry",
                        entry: {
                            id: "entry-agent-link-2",
                            parentId: null,
                            timestamp: Date.now(),
                            type: "custom",
                            key: "agent.link.2",
                            value: {
                                sessionId: 2,
                                profileKey: "writer",
                            },
                        },
                    },
                }));
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await stream.start(1);

        expect(api.getSession).toHaveBeenCalledTimes(1);
        expect(session.needsSnapshot.value).toBe(false);
        expect(session.snapshot.value?.linkedAgents).toEqual([
            expect.objectContaining({
                sessionId: 2,
                detached: false,
            }),
        ]);
    });

    it("等待异步事件处理完成后再处理下一帧", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(1));
        let releaseFirstEvent!: () => void;
        let resolveFirstEventStarted!: () => void;
        const appliedSeq: number[] = [];
        const firstEventStarted = new Promise<void>((resolve) => {
            resolveFirstEventStarted = resolve;
        });
        const api = {
            getSession: vi.fn(async () => baseSnapshot(1)),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, onEvent: (event: AgentSessionEventDto) => Promise<void> | void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                options?.onOpen?.();
                await onEvent(sessionEvent({
                    seq: 2,
                    sessionId: 1,
                    kind: "session",
                    event: {
                        type: "client_variable_patch_requested",
                        request: {
                            namespace: "client",
                            path: "ide.selection",
                            operations: [],
                        },
                    },
                }));
                appliedSeq.push(session.lastSeq.value);
                await onEvent(sessionEvent({
                    seq: 3,
                    sessionId: 1,
                    kind: "session",
                    event: {type: "follow_up_queued", item: {id: "follow-1", kind: "followup", message: {text: "继续"}, createdAt: Date.now()}},
                }));
                appliedSeq.push(session.lastSeq.value);
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({
            session,
            api,
            activeSessionId,
            onEvent: async (event) => {
                if (event.kind === "session" && event.event.type === "client_variable_patch_requested") {
                    resolveFirstEventStarted();
                    await new Promise<void>((resolve) => {
                        releaseFirstEvent = resolve;
                    });
                }
            },
        });

        const startPromise = stream.start(1);
        await firstEventStarted;
        releaseFirstEvent();
        await startPromise;

        await vi.waitFor(() => {
            expect(appliedSeq).toEqual([2, 3]);
        });
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("连续重连失败后进入 disconnected 并允许手动重连", async () => {
        const session = useAgentSession();
        const activeSessionId = ref<number | null>(1);
        session.applySnapshot(baseSnapshot(5));
        let fail = true;
        const api = {
            getSession: vi.fn(async () => baseSnapshot(5)),
            subscribeSessionEvents: vi.fn(async (_sessionId: number, _cursor: AgentSessionEventsQueryDto, _onEvent: (event: AgentSessionEventDto) => void, _signal?: AbortSignal, options?: {onOpen?: () => void}) => {
                if (fail) {
                    throw new Error("network down");
                }
                options?.onOpen?.();
                await new Promise<void>(() => {});
            }),
        };
        const stream = useAgentSessionStream({session, api, activeSessionId});

        await expect(stream.start(1)).rejects.toThrow("network down");
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(800);
        await vi.advanceTimersByTimeAsync(1500);

        expect(session.connectionStatus.value).toBe("disconnected");

        fail = false;
        await stream.reconnectNow();

        expect(session.connectionStatus.value).toBe("connecting");
        expect(api.subscribeSessionEvents).toHaveBeenCalledTimes(5);
    });
});
