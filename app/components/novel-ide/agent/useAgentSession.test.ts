import {describe, expect, it} from "vitest";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";

const baseSnapshot = (lastSeq = 0): AgentSessionSnapshotDto => ({
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
    pendingApproval: null,
    followUpQueue: [],
    activeInvocation: null,
    model: null,
    planModeActive: false,
    lastSeq,
});

describe("useAgentSession", () => {
    it("connected 只更新连接状态，不推进 lastSeq", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(10));

        session.applyEvent({
            seq: 10,
            sessionId: 1,
            kind: "session",
            event: {type: "connected"},
        });

        expect(session.connectionStatus.value).toBe("connected");
        expect(session.lastSeq.value).toBe(10);
        expect(session.needsSnapshot.value).toBe(false);
    });

    it("发现 seq gap 后只标记 snapshot 恢复请求", () => {
        const session = useAgentSession();
        session.applySnapshot(baseSnapshot(10));

        session.applyEvent({
            seq: 12,
            sessionId: 1,
            kind: "session",
            event: {type: "follow_up_queued", item: {id: "follow-1", message: {text: "继续"}, createdAt: Date.now()}},
        });

        expect(session.lastSeq.value).toBe(10);
        expect(session.needsSnapshot.value).toBe(true);
        expect(session.snapshotReasons.value).toContain("seq_gap");
    });

    it("session_state_changed.snapshot 直接恢复 running 状态", () => {
        const session = useAgentSession();

        session.applyEvent({
            seq: 1,
            sessionId: 1,
            kind: "session",
            event: {
                type: "session_state_changed",
                snapshot: {
                    ...baseSnapshot(1),
                    activeInvocation: {
                        invocationId: "run-1",
                        sessionId: 1,
                        status: "running",
                        mode: "prompt",
                        startedAt: Date.now(),
                    },
                },
            },
        });

        expect(session.running.value).toBe(true);
        expect(session.liveRunStatus.value).toBe("running");
        expect(session.runPhase.value).toBe("model_pending");
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

        session.applyEvent({
            seq: 1,
            sessionId: 1,
            invocationId: "run-1",
            kind: "pi",
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
});
