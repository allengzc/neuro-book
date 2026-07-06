import {describe, expect, it} from "vitest";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {AgentMode, AgentSessionLiveStateDto, AgentSessionSnapshotDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

describe("useAgentSession live state", () => {
    it("applyLiveState 可立即更新 Plan Mode，重复 SSE state 不请求 snapshot", () => {
        const session = useAgentSession();
        session.applySnapshot(snapshot(1));
        const state = liveState(1, "plan");

        session.applyLiveState(state);
        session.applyLiveState(state);

        expect(session.snapshot.value?.agentMode).toBe("plan");
        expect(session.needsSnapshot.value).toBe(false);
        expect(session.snapshotReasons.value).toEqual([]);
    });
});

function summary(sessionId: number): AgentSessionSummaryDto {
    return {
        sessionId,
        profileKey: "leader.default",
        workspaceKey: "global",
        workspaceRoot: ".",
        status: "idle",
        updatedAt: 1,
        archived: false,
    };
}

function snapshot(sessionId: number): AgentSessionSnapshotDto {
    return {
        eventEpoch: "epoch-1",
        eventCursor: {
            eventEpoch: "epoch-1",
            after: 0,
        },
        latestSeq: 0,
        summary: summary(sessionId),
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
        lastSeq: 0,
    };
}

function liveState(sessionId: number, agentMode: AgentMode): AgentSessionLiveStateDto {
    return {
        summary: {
            ...summary(sessionId),
            updatedAt: 2,
        },
        activeInvocation: null,
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
        agentMode,
    };
}
