import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {AgentRuntimeStreamEventDto, AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";

type RuntimeMessage = Extract<AgentRuntimeStreamEventDto, {message: unknown}>["message"];
type AssistantRuntimeMessage = Extract<RuntimeMessage, {role: "assistant"}>;
type AgentSessionEventWithoutEpoch = AgentSessionEventDto extends infer Event
    ? Event extends AgentSessionEventDto ? Omit<Event, "eventEpoch"> : never
    : never;

const baseSnapshot = (lastSeq = 0): AgentSessionSnapshotDto => ({
    eventEpoch: "epoch-1",
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
    messages: [],
    tree: [],
    entries: [],
    linkedAgents: [],
    linkedByAgents: [],
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

        session.applySnapshot({...baseSnapshot(0), eventEpoch: "epoch-2"});

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
                    pendingApproval: null,
                    steerQueue: [],
                    followUpQueue: {
                        status: "ready",
                        items: [],
                    },
                    model: null,
                    thinkingLevel: null,
                    effectiveThinkingLevel: "off",
                    planModeActive: false,
                },
            },
        });

        expect(session.running.value).toBe(true);
        expect(session.liveRunStatus.value).toBe("running");
        expect(session.runPhase.value).toBe("model_pending");
        expect(session.snapshot.value?.summarizer).toEqual(expect.objectContaining({
            running: true,
            lastDialogueContentTokens: 42,
        }));
        expect(session.needsSnapshot.value).toBe(false);
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
});
