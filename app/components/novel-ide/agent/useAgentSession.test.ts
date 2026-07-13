import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {AgentRuntimeStreamEventDto, AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";
import type {SessionEntry} from "nbook/server/agent/session/types";

type RuntimeMessage = Extract<AgentRuntimeStreamEventDto, {message: unknown}>["message"];
type AssistantRuntimeMessage = Extract<RuntimeMessage, {role: "assistant"}>;
type AgentSessionEventWithoutEpoch = AgentSessionEventDto extends infer Event
    ? Event extends AgentSessionEventDto ? Omit<Event, "eventEpoch"> : never
    : never;

const baseSnapshot = (lastSeq = 0): AgentSessionSnapshotDto => ({
    eventEpoch: "epoch-1",
    eventCursor: {
        eventEpoch: "epoch-1",
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

const withEnvelope = (event: AgentSessionEventWithoutEpoch, eventEpoch = "epoch-1"): AgentSessionEventDto => {
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

const applyEvent = (session: ReturnType<typeof useAgentSession>, event: AgentSessionEventWithoutEpoch, eventEpoch = "epoch-1"): void => {
    session.applyEvent(withEnvelope(event, eventEpoch));
};

let animationFrames: Array<{id: number; callback: FrameRequestCallback}> = [];
let animationFrameId = 0;

const flushAnimationFrames = (): void => {
    const currentFrames = animationFrames;
    animationFrames = [];
    for (const frame of currentFrames) {
        frame.callback(performance.now());
    }
};

const assistantMessage = (timestamp = 1): AssistantRuntimeMessage => ({
    role: "assistant",
    content: [],
    api: "test",
    provider: "test",
    model: "test",
    usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: "stop",
    timestamp,
} as AssistantRuntimeMessage);

const assistantMessageWithText = (text: string, timestamp = 1): AssistantRuntimeMessage => ({
    ...assistantMessage(timestamp),
    content: [{type: "text", text}],
});

const userEntry = (id: string, text: string, parentId: string | null = null): SessionEntry => ({
    id,
    parentId,
    timestamp: 1,
    type: "message",
    origin: "prompt",
    message: {
        role: "user",
        content: [{type: "text", text}],
        timestamp: 1,
    },
});

const textDeltaEvent = (delta: string): AssistantMessageEvent => ({
    type: "text_delta",
    contentIndex: 0,
    delta,
    partial: assistantMessage(1),
});

const toolCallEndEvent = (): AssistantMessageEvent => ({
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: {
        type: "toolCall",
        id: "call-1",
        name: "read",
        arguments: {path: "a.md"},
    },
    partial: assistantMessage(1),
});

beforeEach(() => {
    animationFrames = [];
    animationFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        const id = animationFrameId + 1;
        animationFrameId = id;
        animationFrames.push({id, callback});
        return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
        animationFrames = animationFrames.filter((frame) => frame.id !== id);
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useAgentSession", () => {
    it("connected 只更新连接状态，不推进 lastSeq", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(10));

        session.applyEvent(withEnvelope({
            seq: 10,
            sessionId: 1,
            kind: "session",
            event: {type: "connected", eventEpoch: "epoch-1", latestSeq: 10},
        }));

        expect(session.connectionStatus.value).toBe("connected");
        expect(session.eventEpoch.value).toBe("epoch-1");
        expect(session.lastSeq.value).toBe(10);
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("connected 发现新 epoch 后请求 snapshot 并允许 lastSeq 回退", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(426));

        session.applyEvent(withEnvelope({
            seq: 0,
            sessionId: 1,
            kind: "session",
            event: {type: "connected", eventEpoch: "epoch-2", latestSeq: 0},
        }, "epoch-2"));

        expect(session.connectionStatus.value).toBe("connected");
        expect(session.needsSnapshot.value).toBe(true);
        expect(session.snapshotReasons.value).toContain("event_epoch_changed");
        expect(session.lastSeq.value).toBe(426);

        session.applySnapshot({
            ...baseSnapshot(0),
            eventEpoch: "epoch-2",
            eventCursor: {
                eventEpoch: "epoch-2",
                after: 0,
            },
        });

        expect(session.eventEpoch.value).toBe("epoch-2");
        expect(session.lastSeq.value).toBe(0);
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("connected 发现服务端 latestSeq 小于本地 lastSeq 时请求 snapshot", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(426));

        session.applyEvent(withEnvelope({
            seq: 0,
            sessionId: 1,
            kind: "session",
            event: {type: "connected", eventEpoch: "epoch-1", latestSeq: 0},
        }));

        expect(session.connectionStatus.value).toBe("connected");
        expect(session.needsSnapshot.value).toBe(true);
        expect(session.snapshotReasons.value).toContain("event_epoch_changed");
        expect(session.lastSeq.value).toBe(426);
    });

    it("忽略已经被 snapshot cursor 覆盖的 snapshot_required", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(10));

        applyEvent(session, {
            seq: 10,
            sessionId: 1,
            kind: "session",
            event: {type: "snapshot_required", reason: "stale queued recovery"},
        });

        expect(session.needsSnapshot.value).toBe(false);
        expect(session.snapshotReasons.value).toEqual([]);
        expect(session.lastSeq.value).toBe(10);
    });

    it("applyRelations 只更新关联 Agent 数据，不重建消息流", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(7));
        session.appendOptimisticUserMessage("hello");
        const messagesBefore = session.messages.value;

        session.applyRelations({
            sessionId: 1,
            linkedAgents: [{
                sessionId: 2,
                profileKey: "writer",
                workspaceKey: "global",
                workspaceRoot: ".",
                status: "idle",
                updatedAt: 2,
                archived: false,
            }],
            linkedByAgents: [],
        });

        expect(session.messages.value).toBe(messagesBefore);
        expect(session.lastSeq.value).toBe(7);
        expect(session.eventEpoch.value).toBe("epoch-1");
        expect(session.snapshot.value?.linkedAgents).toEqual([
            expect.objectContaining({
                sessionId: 2,
            }),
        ]);

        session.applyRelations({
            sessionId: 999,
            linkedAgents: [],
            linkedByAgents: [],
        });

        expect(session.snapshot.value?.linkedAgents).toHaveLength(1);
    });

    it("applySnapshot 使用 eventCursor 而不是 latestSeq 作为恢复点", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(10));

        session.applySnapshot({
            ...baseSnapshot(10),
            eventCursor: {
                eventEpoch: "epoch-1",
                after: 3,
            },
            latestSeq: 10,
            lastSeq: 3,
        });

        expect(session.eventEpoch.value).toBe("epoch-1");
        expect(session.lastSeq.value).toBe(3);
    });

    it("运行中轻量 snapshot 保留未落盘 live 消息和已有 contextUsage", () => {
        const session = useAgentSession();
        const activeInvocation = {
            invocationId: "invocation-1",
            sessionId: 1,
            status: "running" as const,
            mode: "prompt" as const,
            startedAt: 1,
        };
        session.applySnapshot({
            ...baseSnapshot(0),
            activeInvocation,
            contextUsage: {
                usedTokens: 1200,
                limitTokens: 8000,
                percent: 15,
                estimated: true,
            },
        });

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "invocation-1",
            kind: "runtime",
            event: {
                type: "tool_execution_start",
                toolCallId: "write-1",
                toolName: "write",
                args: {path: "manuscript/01.md", contentPreview: "正文"},
            },
        });

        expect(session.messages.value.some((message) => message.id === "tool-execution:write-1")).toBe(true);

        session.applySnapshot({
            ...baseSnapshot(1),
            activeInvocation,
        });

        expect(session.snapshot.value?.contextUsage).toEqual(expect.objectContaining({
            usedTokens: 1200,
            limitTokens: 8000,
        }));
        expect(session.messages.value.some((message) => message.id === "tool-execution:write-1")).toBe(true);
    });

    it("snapshot 返回时 invocation 已结束仍保留尚未落盘的最新 live 消息", () => {
        const session = useAgentSession();
        session.applySnapshot({
            ...baseSnapshot(0),
            activeInvocation: {
                invocationId: "invocation-1",
                sessionId: 1,
                status: "running",
                mode: "prompt",
                startedAt: 1,
            },
        });

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "invocation-1",
            kind: "runtime",
            event: {
                type: "message_end",
                message: assistantMessageWithText("writer 最新回复"),
            },
        });

        session.applySnapshot({
            ...baseSnapshot(1),
            activeInvocation: null,
        });

        expect(session.messages.value).toEqual(expect.arrayContaining([
            expect.objectContaining({
                content: "writer 最新回复",
                invocationId: "invocation-1",
            }),
        ]));
    });

    it("applyContextUsage 只更新当前 session 的 token 估算，不重建消息流", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));
        session.appendOptimisticUserMessage("hello");
        const messagesBefore = session.messages.value;

        session.applyContextUsage(1, {
            usedTokens: 2400,
            limitTokens: 8000,
            percent: 30,
            estimated: true,
        });

        expect(session.messages.value).toBe(messagesBefore);
        expect(session.snapshot.value?.contextUsage).toEqual(expect.objectContaining({
            usedTokens: 2400,
            limitTokens: 8000,
        }));

        session.applyContextUsage(999, {
            usedTokens: 1,
            limitTokens: 2,
            percent: 50,
            estimated: true,
        });

        expect(session.snapshot.value?.contextUsage?.usedTokens).toBe(2400);
    });

    it("发现 seq gap 后只标记 snapshot 恢复请求", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(10));

        applyEvent(session, {
            seq: 12,
            sessionId: 1,
            kind: "session",
            event: {type: "follow_up_queued", item: {id: "follow-1", kind: "followup", message: {text: "继续"}, createdAt: Date.now()}},
        });

        expect(session.lastSeq.value).toBe(10);
        expect(session.needsSnapshot.value).toBe(true);
        expect(session.snapshotReasons.value).toContain("seq_gap");
    });

    it("合并 steer 和 followUp queue 事件并按 id 去重", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {type: "steer_queued", item: {id: "steer-1", kind: "steer", message: {text: "调整"}, createdAt: 1}},
        });
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            kind: "session",
            event: {type: "follow_up_queued", item: {id: "follow-1", kind: "followup", message: {text: "继续"}, createdAt: 2}},
        });

        expect(session.snapshot.value?.steerQueue).toEqual([
            expect.objectContaining({id: "steer-1", kind: "steer"}),
        ]);
        expect(session.snapshot.value?.followUpQueue.items).toEqual([
            expect.objectContaining({id: "follow-1", kind: "followup"}),
        ]);
    });

    it("agent link custom entry 到达时请求完整 snapshot 恢复关联面板", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
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
        });

        expect(session.needsSnapshot.value).toBe(true);
        expect(session.snapshotReasons.value).toContain("linked_agent_changed");
    });

    it("session_state_changed.state 只更新 live shell", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_state_changed",
                state: {
                    summary: {
                        ...baseSnapshot(1).summary,
                        status: "running",
                    },
                    summarizer: {
                        running: true,
                        dirty: false,
                        lastDialogueContentTokens: 42,
                    },
                    activeInvocation: {
                        invocationId: "run-1",
                        sessionId: 1,
                        status: "running",
                        mode: "prompt",
                        startedAt: Date.now(),
                    },
                    activeLeafId: null,
                    activePathRevision: null,
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
        });

        expect(session.running.value).toBe(true);
        expect(session.canSteer.value).toBe(true);
        expect(session.canFollowUp.value).toBe(true);
        expect(session.liveRunStatus.value).toBe("running");
        expect(session.runPhase.value).toBe("model_pending");
        expect(session.snapshot.value?.summarizer).toEqual(expect.objectContaining({
            running: true,
            lastDialogueContentTokens: 42,
        }));
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("aborting active invocation 仍显示运行中但禁止 steer 和 followUp", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_state_changed",
                state: {
                    summary: {
                        ...baseSnapshot(1).summary,
                        status: "running",
                    },
                    activeInvocation: {
                        invocationId: "run-1",
                        sessionId: 1,
                        status: "aborting",
                        mode: "prompt",
                        startedAt: Date.now(),
                    },
                    activeLeafId: null,
                    activePathRevision: null,
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
        });

        expect(session.running.value).toBe(true);
        expect(session.canSteer.value).toBe(false);
        expect(session.canFollowUp.value).toBe(false);
        expect(session.liveRunStatus.value).toBe("aborting");
    });

    it("session_state_changed 发现 active path revision 改变时请求 snapshot", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_state_changed",
                state: {
                    summary: baseSnapshot(1).summary,
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
        });

        expect(session.snapshot.value?.activePathRevision).toBe("leaf-move-1");
        expect(session.needsSnapshot.value).toBe(true);
        expect(session.snapshotReasons.value).toContain("active_path_changed");
    });

    it("active path changed snapshot 会替换旧消息投影", () => {
        const session = useAgentSession();
        session.applySnapshot({
            ...baseSnapshot(0),
            entries: [{
                id: "error-1",
                parentId: null,
                timestamp: Date.now(),
                type: "invocation_lifecycle",
                invocationId: "run-1",
                status: "error",
                error: "provider failed",
            }],
        });
        expect(session.messages.value.some((message) => message.systemDisplayKind === "error")).toBe(true);

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_state_changed",
                state: {
                    summary: baseSnapshot(1).summary,
                    activeInvocation: null,
                    activeLeafId: null,
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
        });
        session.applySnapshot({
            ...baseSnapshot(1),
            activePathRevision: "leaf-move-1",
            entries: [],
        });

        expect(session.messages.value).toEqual([]);
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("prependEntriesPage 会把更早历史插入当前轻快照前方", () => {
        const session = useAgentSession();
        session.applySnapshot({
            ...baseSnapshot(0),
            entries: [userEntry("entry-2", "second", "entry-1")],
            entryPage: {
                hasMoreBefore: true,
                beforeEntryId: "entry-2",
                total: 2,
                limit: 1,
            },
        });

        session.prependEntriesPage({
            sessionId: 1,
            entries: [userEntry("entry-1", "first")],
            hasMoreBefore: false,
            beforeEntryId: null,
            total: 2,
            limit: 1,
        });

        expect(session.snapshot.value?.entries.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
        expect(session.snapshot.value?.entryPage?.hasMoreBefore).toBe(false);
        expect(session.messages.value.map((message) => message.content)).toEqual(["first", "second"]);
    });

    it("工具完成后 active invocation 仍保持 finishing phase", () => {
        const session = useAgentSession();
        session.applySnapshot({
            ...baseSnapshot(0),
            activeInvocation: {
                invocationId: "run-1",
                sessionId: 1,
                status: "running",
                mode: "prompt",
                startedAt: Date.now(),
            },
        });

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "tool_execution_end",
                toolCallId: "call-1",
                toolName: "read",
                result: {content: [{type: "text", text: "ok"}]},
                isError: false,
            },
        });

        expect(session.running.value).toBe(true);
        expect(session.runPhase.value).toBe("finishing");
    });

    it("waiting agent_end 不会把 approval UI 冲回 idle", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "agent_end",
                status: "waiting",
            },
        });

        expect(session.liveRunStatus.value).toBe("waiting");
        expect(session.runPhase.value).toBe("waiting_user");
    });

    it("连续 message_update 合并到下一帧后按顺序提交", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_start",
                message: assistantMessage(1),
            },
        });
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_update",
                message: assistantMessage(1),
                assistantMessageEvent: textDeltaEvent("你"),
            },
        });
        applyEvent(session, {
            seq: 3,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_update",
                message: assistantMessage(1),
                assistantMessageEvent: textDeltaEvent("好"),
            },
        });

        expect(session.messages.value[0]?.content).toBe("");
        expect(session.runPhase.value).toBe("assistant_streaming");
        expect(animationFrames).toHaveLength(1);

        flushAnimationFrames();

        expect(session.messages.value[0]?.content).toBe("你好");
    });

    it("message_end 到来前会先提交 pending message_update", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_start",
                message: assistantMessage(1),
            },
        });
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_update",
                message: assistantMessage(1),
                assistantMessageEvent: textDeltaEvent("你"),
            },
        });
        applyEvent(session, {
            seq: 3,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_end",
                message: assistantMessageWithText("你好"),
            },
        });

        expect(animationFrames).toHaveLength(0);
        expect(session.messages.value[0]?.content).toBe("你好");
        expect(session.messages.value[0]?.status).toBe("done");
    });

    it("工具执行事件到来前会先提交 pending toolcall update", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_start",
                message: assistantMessage(1),
            },
        });
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_update",
                message: assistantMessage(1),
                assistantMessageEvent: toolCallEndEvent(),
            },
        });
        applyEvent(session, {
            seq: 3,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "tool_execution_start",
                toolCallId: "call-1",
                toolName: "read",
                args: {path: "a.md"},
            },
        });

        expect(session.messages.value).toHaveLength(1);
        expect(session.messages.value.some((message) => message.id === "tool-execution:call-1")).toBe(false);
        expect(session.messages.value[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            id: "call-1",
            name: "read",
            status: "running",
        }));
    });

    it("处理非 request_user_input 的 tool.user-input-required formSpec 事件", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        // 先发送 assistant message with tool call
        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_start",
                message: {
                    ...assistantMessage(1),
                    content: [{
                        type: "toolCall",
                        id: "call-1",
                        name: "custom_form_tool",
                        arguments: {form: {fields: []}},
                    }],
                },
            },
        });

        // 发送 tool.user-input-required 事件
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "tool.user-input-required",
                toolCallId: "call-1",
                toolName: "custom_form_tool",
                args: {},
                formSpec: {
                    form: {
                        defaults: {},
                        fields: [
                            {path: "username", label: "用户名", component: "text", required: true, options: []},
                            {path: "age", label: "年龄", component: "number", required: false, options: []},
                        ],
                    },
                },
            },
        });

        // 验证 pendingUserInputSessions 被更新
        expect(session.pendingUserInputSession.value).toBeTruthy();
        expect(session.pendingUserInputSession.value?.formToolCallId).toBe("call-1");
        expect(session.pendingUserInputSession.value?.form).toEqual({
            defaults: {},
            fields: [
                {path: "username", label: "用户名", component: "text", required: true, options: []},
                {path: "age", label: "年龄", component: "number", required: false, options: []},
            ],
        });
        expect(session.pendingUserInputSession.value?.questions).toEqual([]);

        // 验证状态变为 waiting
        expect(session.liveRunStatus.value).toBe("waiting");
        expect(session.runPhase.value).toBe("waiting_user");
    });

    it("request_user_input 的 tool.user-input-required 事件生成普通问题 session", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        // 先发送 assistant message with tool call
        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_start",
                message: {
                    ...assistantMessage(1),
                    content: [{
                        type: "toolCall",
                        id: "call-1",
                        name: "request_user_input",
                        arguments: {
                            questions: [{question: "选择方案", options: [{label: "A"}, {label: "B"}]}],
                        },
                    }],
                },
            },
        });

        const messageId = session.messages.value[0]?.id;

        // 发送 tool.user-input-required 事件
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "tool.user-input-required",
                toolCallId: "call-1",
                toolName: "request_user_input",
                args: {
                    questions: [{question: "选择方案", options: [{label: "A"}, {label: "B"}]}],
                },
                formSpec: {
                    form: {defaults: {}, fields: []},
                },
            },
        });

        // 验证 assistantMessageId 正确关联
        expect(session.pendingUserInputSession.value?.assistantMessageId).toBe(messageId);
        expect(session.pendingUserInputSession.value?.formToolCallId).toBeUndefined();
        expect(session.pendingUserInputSession.value?.form).toBeUndefined();
        expect(session.pendingUserInputSession.value?.questions).toEqual([expect.objectContaining({
            toolNodeId: "call-1",
            toolCallId: "call-1",
            toolName: "request_user_input",
            kind: "question",
            questionIndex: 0,
            question: "选择方案",
            options: [{label: "A"}, {label: "B"}],
        })]);
    });

    it("工具结果到来时清理对应的 request_user_input pendingUserInputSession", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(0));

        // 先发送 assistant message with tool call
        applyEvent(session, {
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "message_start",
                message: {
                    ...assistantMessage(1),
                    content: [{
                        type: "toolCall",
                        id: "call-1",
                        name: "request_user_input",
                        arguments: {questions: [{question: "Name?", options: []}]},
                    }],
                },
            },
        });

        // 发送 tool.user-input-required 事件
        applyEvent(session, {
            seq: 2,
            sessionId: 1,
            invocationId: "run-1",
            kind: "runtime",
            event: {
                type: "tool.user-input-required",
                toolCallId: "call-1",
                toolName: "request_user_input",
                args: {questions: [{question: "Name?", options: []}]},
                formSpec: {
                    form: {defaults: {}, fields: []},
                },
            },
        });

        expect(session.pendingUserInputSession.value).toBeTruthy();

        // 发送工具结果
        applyEvent(session, {
            seq: 3,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_entry",
                entry: {
                    id: "entry-1",
                    parentId: "parent-1",
                    type: "message",
                    message: {
                        role: "toolResult",
                        toolCallId: "call-1",
                        toolName: "request_user_input",
                        content: [{type: "text", text: "用户输入结果"}],
                        isError: false,
                        timestamp: 1,
                    },
                    timestamp: 1,
                },
            },
        });

        // 验证 pendingUserInputSession 被清理
        expect(session.pendingUserInputSession.value).toBeNull();
    });
});
