import type {AgentCommandResult} from "nbook/server/agent/harness/types";
import type {AgentSessionLiveStateDto, AgentSessionSnapshotDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

export type AgentCommandResultApplyContext = {
    activeSessionId(): number | null;
    applyLiveState(state: AgentSessionLiveStateDto): void;
    syncSessionModelState(summary: AgentSessionSummaryDto | null): void;
    refreshSessions(): Promise<unknown>;
    loadSession(sessionId: number): Promise<unknown>;
    applySnapshotOrSync(snapshot?: AgentSessionSnapshotDto | null): Promise<void>;
};

/**
 * 应用 command HTTP 返回。轻控制命令只更新 live shell，不补拉完整 snapshot。
 */
export async function applyAgentCommandResult(result: AgentCommandResult, context: AgentCommandResultApplyContext): Promise<void> {
    if (result.kind === "live_state") {
        if (result.sessionId !== context.activeSessionId()) {
            return;
        }
        context.applyLiveState(result.state);
        context.syncSessionModelState(result.state.summary);
        return;
    }
    if (result.kind === "created_session") {
        await context.refreshSessions();
        await context.loadSession(result.createdSession.sessionId);
        return;
    }
    await context.applySnapshotOrSync(result.snapshot);
}
