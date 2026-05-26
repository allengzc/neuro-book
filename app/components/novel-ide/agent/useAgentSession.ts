import type {AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";
import {computed, ref} from "vue";
import {
    applyPiEventToMessages,
    applySessionEntryToMessages,
    deriveMessagesFromSessionSnapshot,
    reconcileMessages,
    toPendingUserInputSession,
    type AgentMessage,
    type AgentPendingUserInputSession,
} from "nbook/app/components/novel-ide/agent/agent-message";

export type AgentConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected";

export type AgentRunPhase =
    | "idle"
    | "model_pending"
    | "thinking"
    | "assistant_streaming"
    | "tool_args_streaming"
    | "tool_running"
    | "tool_streaming"
    | "waiting_user"
    | "finishing";

/**
 * 统一管理 session snapshot + live event，并派生当前 UI message 列表。
 */
export function useAgentSession() {
    const snapshot = ref<AgentSessionSnapshotDto | null>(null);
    const messages = ref<AgentMessage[]>([]);
    const liveRunStatus = ref<"idle" | "running" | "waiting" | "aborting">("idle");
    const runPhase = ref<AgentRunPhase>("idle");
    const connectionStatus = ref<AgentConnectionStatus>("idle");
    const pendingUserInputSession = ref<AgentPendingUserInputSession | null>(null);
    const lastSeq = ref(0);
    const needsSnapshot = ref(false);
    const snapshotReasons = ref<string[]>([]);
    const running = computed(() => Boolean(snapshot.value?.activeInvocation) || liveRunStatus.value === "running" || liveRunStatus.value === "aborting");

    /**
     * 重置当前会话状态。
     */
    const reset = (): void => {
        snapshot.value = null;
        messages.value = [];
        liveRunStatus.value = "idle";
        runPhase.value = "idle";
        connectionStatus.value = "idle";
        pendingUserInputSession.value = null;
        lastSeq.value = 0;
        needsSnapshot.value = false;
        snapshotReasons.value = [];
    };

    const clearPendingUserInputSession = (): void => {
        pendingUserInputSession.value = null;
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
        const nextSeq = Math.max(lastSeq.value, payload.lastSeq);
        const snapshotMessages = deriveMessagesFromSessionSnapshot(payload);
        const pendingOptimisticMessages = messages.value.filter((message) => {
            return message.id.startsWith("optimistic-user-")
                && !snapshotMessages.some((snapshotMessage) => snapshotMessage.type === "user" && snapshotMessage.content === message.content);
        });
        snapshot.value = payload;
        messages.value = reconcileMessages(messages.value, [
            ...snapshotMessages,
            ...pendingOptimisticMessages,
        ]);
        if (payload.activeInvocation) {
            liveRunStatus.value = payload.activeInvocation.status === "waiting" ? "waiting" : payload.activeInvocation.status;
            runPhase.value = payload.pendingApproval ? "waiting_user" : runPhase.value === "idle" ? "model_pending" : runPhase.value;
        } else {
            liveRunStatus.value = "idle";
            runPhase.value = "idle";
        }
        pendingUserInputSession.value = toPendingUserInputSession(payload.pendingApproval, messages.value);
        lastSeq.value = nextSeq;
        needsSnapshot.value = false;
        snapshotReasons.value = [];
    };

    const requestSnapshot = (reason: string): void => {
        needsSnapshot.value = true;
        if (!snapshotReasons.value.includes(reason)) {
            snapshotReasons.value = [...snapshotReasons.value, reason];
        }
    };

    const clearSnapshotRequest = (): void => {
        needsSnapshot.value = false;
        snapshotReasons.value = [];
    };

    const applyConnectionStatus = (status: AgentConnectionStatus): void => {
        connectionStatus.value = status;
    };

    /**
     * 应用一次 session event envelope。
     */
    const applyEvent = (payload: AgentSessionEventDto): void => {
        if (payload.kind === "session" && payload.event.type === "connected") {
            connectionStatus.value = "connected";
            return;
        }
        if (payload.seq <= lastSeq.value) {
            return;
        }
        if (payload.seq > lastSeq.value + 1 && lastSeq.value > 0) {
            requestSnapshot("seq_gap");
            return;
        }
        lastSeq.value = payload.seq;

        if (payload.kind === "pi") {
            messages.value = applyPiEventToMessages(messages.value, payload.event, payload.invocationId);
            if (payload.event.type === "agent_start") {
                liveRunStatus.value = "running";
                runPhase.value = "model_pending";
            }
            if (payload.event.type === "agent_end") {
                liveRunStatus.value = "idle";
                runPhase.value = "idle";
            }
            if (payload.event.type === "turn_start") {
                liveRunStatus.value = "running";
                runPhase.value = "model_pending";
            }
            if (payload.event.type === "message_start" || payload.event.type === "message_update") {
                const assistantMessageEvent = "assistantMessageEvent" in payload.event ? payload.event.assistantMessageEvent : null;
                if (assistantMessageEvent?.type === "thinking_start" || assistantMessageEvent?.type === "thinking_delta") {
                    runPhase.value = "thinking";
                } else if (assistantMessageEvent?.type === "toolcall_start" || assistantMessageEvent?.type === "toolcall_delta") {
                    runPhase.value = "tool_args_streaming";
                } else if (payload.event.message.role === "assistant") {
                    runPhase.value = "assistant_streaming";
                }
            }
            if (payload.event.type === "tool_execution_start") {
                runPhase.value = "tool_running";
            }
            if (payload.event.type === "tool_execution_update") {
                runPhase.value = "tool_streaming";
            }
            if (payload.event.type === "tool_execution_end") {
                runPhase.value = "finishing";
            }
            if (payload.event.type === "turn_end" && liveRunStatus.value === "running") {
                runPhase.value = "finishing";
            }
            return;
        }

        if (payload.event.type === "snapshot_required") {
            requestSnapshot("snapshot_required");
            return;
        }

        if (payload.event.type === "session_entry") {
            messages.value = applySessionEntryToMessages(messages.value, payload.event.entry);
            if (payload.event.entry.type === "message" && payload.event.entry.message.role === "toolResult") {
                const toolCallId = payload.event.entry.message.toolCallId;
                if (pendingUserInputSession.value?.questions.some((question) => (question.toolCallId ?? question.toolNodeId) === toolCallId)) {
                    pendingUserInputSession.value = null;
                }
            }
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
                followUpQueue: mergeQueuedMessages(currentSnapshot.followUpQueue, payload.event.item),
            } as AgentSessionSnapshotDto;
            return;
        }

        if (payload.event.type === "steer_queued" && snapshot.value) {
            const currentSnapshot = snapshot.value;
            snapshot.value = {
                ...currentSnapshot,
                steerQueue: mergeQueuedMessages(currentSnapshot.steerQueue, payload.event.item),
            } as AgentSessionSnapshotDto;
            return;
        }

        if (payload.event.type === "invocation_aborted") {
            liveRunStatus.value = "aborting";
            runPhase.value = "finishing";
        }
    };

    return {
        appendOptimisticUserMessage,
        applyConnectionStatus,
        applyEvent,
        applySnapshot,
        clearSnapshotRequest,
        clearPendingUserInputSession,
        connectionStatus,
        lastSeq,
        liveRunStatus,
        messages,
        needsSnapshot,
        pendingUserInputSession,
        reset,
        runPhase,
        running,
        snapshotReasons,
        snapshot,
    };
}

function mergeQueuedMessages<T extends {id: string}>(queue: T[], item: T): T[] {
    if (queue.some((current) => current.id === item.id)) {
        return queue;
    }
    return [...queue, item];
}
