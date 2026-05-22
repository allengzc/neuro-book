import type {AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";
import {
    applyPiEventToMessages,
    deriveMessagesFromSessionSnapshot,
    reconcileMessages,
    toPendingUserInputSession,
    type AgentMessage,
    type AgentPendingUserInputSession,
} from "nbook/app/components/novel-ide/agent/agent-message";

/**
 * 统一管理 session snapshot + live event，并派生当前 UI message 列表。
 */
export function useAgentSession() {
    const snapshot = ref<AgentSessionSnapshotDto | null>(null);
    const messages = ref<AgentMessage[]>([]);
    const running = ref(false);
    const pendingUserInputSession = ref<AgentPendingUserInputSession | null>(null);
    const lastSeq = ref(0);
    const needsSnapshot = ref(false);

    /**
     * 重置当前会话状态。
     */
    const reset = (): void => {
        snapshot.value = null;
        messages.value = [];
        running.value = false;
        pendingUserInputSession.value = null;
        lastSeq.value = 0;
        needsSnapshot.value = false;
    };

    /**
     * 追加乐观用户消息。
     */
    const appendOptimisticUserMessage = (content: string): void => {
        messages.value = reconcileMessages(messages.value, [
            ...messages.value,
            {
                id: `optimistic-user-${String(Date.now())}`,
                type: "user",
                content,
                status: "done",
                timestamp: "刚刚",
            },
        ]);
    };

    /**
     * 应用恢复真相的 snapshot。
     */
    const applySnapshot = (payload: AgentSessionSnapshotDto): void => {
        snapshot.value = payload;
        messages.value = reconcileMessages(messages.value, deriveMessagesFromSessionSnapshot(payload));
        running.value = Boolean(payload.activeInvocation);
        pendingUserInputSession.value = toPendingUserInputSession(payload.pendingApproval, messages.value);
        lastSeq.value = payload.lastSeq;
        needsSnapshot.value = false;
    };

    /**
     * 应用一次 session event envelope。
     */
    const applyEvent = (payload: AgentSessionEventDto): void => {
        if (payload.seq <= lastSeq.value) {
            return;
        }
        if (payload.seq > lastSeq.value + 1 && lastSeq.value > 0) {
            needsSnapshot.value = true;
        }
        lastSeq.value = payload.seq;

        if (payload.kind === "pi") {
            messages.value = applyPiEventToMessages(messages.value, payload.event);
            if (payload.event.type === "agent_start") {
                running.value = true;
            }
            if (payload.event.type === "agent_end") {
                running.value = false;
            }
            return;
        }

        if (payload.event.type === "snapshot_required") {
            needsSnapshot.value = true;
            return;
        }

        if (payload.event.type === "session_state_changed" && payload.event.snapshot) {
            applySnapshot(payload.event.snapshot);
            return;
        }

        if (payload.event.type === "follow_up_queued" && snapshot.value) {
            const currentSnapshot = snapshot.value;
            snapshot.value = {
                ...currentSnapshot,
                followUpQueue: [...currentSnapshot.followUpQueue, payload.event.item],
            } as AgentSessionSnapshotDto;
            return;
        }

        if (payload.event.type === "invocation_aborted") {
            running.value = false;
        }
    };

    return {
        appendOptimisticUserMessage,
        applyEvent,
        applySnapshot,
        lastSeq,
        messages,
        needsSnapshot,
        pendingUserInputSession,
        reset,
        running,
        snapshot,
    };
}
