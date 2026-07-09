import {describe, expect, it, vi} from "vitest";
import {applyAgentCommandResult, type AgentCommandResultApplyContext} from "nbook/app/components/novel-ide/agent/agent-command-result";
import type {AgentSessionLiveStateDto, AgentSessionSnapshotDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

describe("applyAgentCommandResult", () => {
    it("live_state 只应用 live state，不走 snapshot fallback", async () => {
        const state = liveState(12, {agentMode: "plan"});
        const context = createContext(12);

        await applyAgentCommandResult({
            kind: "live_state",
            status: "completed",
            sessionId: 12,
            state,
        }, context);

        expect(context.applyLiveState).toHaveBeenCalledWith(state);
        expect(context.syncSessionModelState).toHaveBeenCalledWith(state.summary);
        expect(context.applySnapshotOrSync).not.toHaveBeenCalled();
        expect(context.refreshSessions).not.toHaveBeenCalled();
        expect(context.loadSession).not.toHaveBeenCalled();
    });

    it("live_state 不属于当前 session 时不更新状态", async () => {
        const context = createContext(13);

        await applyAgentCommandResult({
            kind: "live_state",
            status: "completed",
            sessionId: 12,
            state: liveState(12),
        }, context);

        expect(context.applyLiveState).not.toHaveBeenCalled();
        expect(context.applySnapshotOrSync).not.toHaveBeenCalled();
    });

    it("created_session 刷新列表后切换到新 session", async () => {
        const context = createContext(12);

        await applyAgentCommandResult({
            kind: "created_session",
            status: "completed",
            sessionId: 21,
            createdSession: summary(21),
        }, context);

        expect(context.refreshSessions).toHaveBeenCalledTimes(1);
        expect(context.loadSession).toHaveBeenCalledWith(21);
        expect(context.applySnapshotOrSync).not.toHaveBeenCalled();
    });

    it("snapshot 结果沿用完整 snapshot 应用路径", async () => {
        const context = createContext(12);
        const snapshot = sessionSnapshot(12);

        await applyAgentCommandResult({
            kind: "snapshot",
            status: "completed",
            sessionId: 12,
            snapshot,
        }, context);

        expect(context.applySnapshotOrSync).toHaveBeenCalledWith(snapshot);
        expect(context.applyLiveState).not.toHaveBeenCalled();
    });
});

function createContext(activeSessionId: number | null): AgentCommandResultApplyContext {
    return {
        activeSessionId: () => activeSessionId,
        applyLiveState: vi.fn(),
        syncSessionModelState: vi.fn(),
        refreshSessions: vi.fn(async () => []),
        loadSession: vi.fn(async () => undefined),
        applySnapshotOrSync: vi.fn(async () => undefined),
    };
}

function summary(sessionId: number): AgentSessionSummaryDto {
    return {
        sessionId,
        profileKey: "leader.default",
        workspaceKey: "global",
        workspaceRoot: "workspace",
        status: "idle",
        updatedAt: 1,
        archived: false,
    };
}

function liveState(sessionId: number, overrides: Partial<Pick<AgentSessionLiveStateDto, "agentMode">> = {}): AgentSessionLiveStateDto {
    return {
        summary: summary(sessionId),
        activeLeafId: null,
        activePathRevision: null,
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
        agentMode: overrides.agentMode ?? "normal",
    };
}

function sessionSnapshot(sessionId: number): AgentSessionSnapshotDto {
    return {
        eventEpoch: "epoch",
        eventCursor: {
            eventEpoch: "epoch",
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
