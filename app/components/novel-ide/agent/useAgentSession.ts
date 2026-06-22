import type {AgentRuntimeStreamEventDto, AgentSessionEventDto, AgentSessionLiveStateDto, AgentSessionRelationsDto, AgentSessionSnapshotDto, AgentPendingApprovalDto} from "nbook/shared/dto/agent-session.dto";
import {computed, getCurrentScope, onScopeDispose, ref, shallowRef} from "vue";
import {
    applyRuntimeEventToMessages,
    applySessionEntryToMessages,
    deriveMessagesFromSessionSnapshot,
    formatTimestamp,
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

type PendingMessageUpdate = {
    event: Extract<AgentRuntimeStreamEventDto, {type: "message_update"}>;
    invocationId?: string;
};

/**
 * 统一管理 session snapshot + live event，并派生当前 UI message 列表。
 */
export function useAgentSession() {
    const snapshot = shallowRef<AgentSessionSnapshotDto | null>(null);
    const messages = ref<AgentMessage[]>([]);
    const liveRunStatus = ref<"idle" | "running" | "waiting" | "aborting">("idle");
    const runPhase = ref<AgentRunPhase>("idle");
    const connectionStatus = ref<AgentConnectionStatus>("idle");
    const pendingUserInputSessions = ref<AgentPendingUserInputSession[]>([]);
    const eventEpoch = ref<string | null>(null);
    const lastSeq = ref(0);
    const needsSnapshot = ref(false);
    const snapshotReasons = ref<string[]>([]);
    const running = computed(() => Boolean(snapshot.value?.activeInvocation) || liveRunStatus.value === "running" || liveRunStatus.value === "aborting");
    const pendingUserInputSession = computed(() => pendingUserInputSessions.value[0] ?? null);
    const pendingMessageUpdates: PendingMessageUpdate[] = [];
    let runtimeUpdateFrame: number | null = null;
    let runtimeUpdateFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    /** 取消尚未执行的 message_update 批量提交。 */
    const cancelPendingMessageUpdateFlush = (): void => {
        if (runtimeUpdateFrame !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(runtimeUpdateFrame);
        }
        runtimeUpdateFrame = null;
        if (runtimeUpdateFallbackTimer !== null) {
            clearTimeout(runtimeUpdateFallbackTimer);
        }
        runtimeUpdateFallbackTimer = null;
    };

    /** 清理尚未应用的流式 message_update。 */
    const clearPendingMessageUpdates = (): void => {
        cancelPendingMessageUpdateFlush();
        pendingMessageUpdates.splice(0);
    };

    /** 一次性提交帧内累积的 message_update，减少 Vue 列表重建频率。 */
    const flushPendingMessageUpdates = (): void => {
        cancelPendingMessageUpdateFlush();
        if (pendingMessageUpdates.length === 0) {
            return;
        }
        const updates = pendingMessageUpdates.splice(0);
        messages.value = updates.reduce((currentMessages, item) => {
            return applyRuntimeEventToMessages(currentMessages, item.event, item.invocationId);
        }, messages.value);
    };

    /** 把流式 token 更新合并到浏览器下一帧再提交。 */
    const schedulePendingMessageUpdateFlush = (): void => {
        if (runtimeUpdateFrame !== null || runtimeUpdateFallbackTimer !== null) {
            return;
        }
        if (typeof requestAnimationFrame === "function") {
            runtimeUpdateFrame = requestAnimationFrame(() => {
                runtimeUpdateFrame = null;
                flushPendingMessageUpdates();
            });
            return;
        }
        runtimeUpdateFallbackTimer = setTimeout(() => {
            runtimeUpdateFallbackTimer = null;
            flushPendingMessageUpdates();
        }, 0);
    };

    /** 暂存一次流式 message_update。 */
    const queuePendingMessageUpdate = (event: Extract<AgentRuntimeStreamEventDto, {type: "message_update"}>, invocationId?: string): void => {
        pendingMessageUpdates.push({event, invocationId});
        schedulePendingMessageUpdateFlush();
    };

    /** 根据 runtime event 更新运行阶段。 */
    const applyRuntimePhase = (event: AgentRuntimeStreamEventDto): void => {
        if (event.type === "agent_start") {
            liveRunStatus.value = "running";
            runPhase.value = "model_pending";
        }
        if (event.type === "agent_end") {
            if (event.status === "waiting") {
                liveRunStatus.value = "waiting";
                runPhase.value = "waiting_user";
            } else {
                liveRunStatus.value = "idle";
                runPhase.value = "idle";
            }
        }
        if (event.type === "turn_start") {
            liveRunStatus.value = "running";
            runPhase.value = "model_pending";
        }
        if (event.type === "message_start" || event.type === "message_update") {
            const assistantMessageEvent = "assistantMessageEvent" in event ? event.assistantMessageEvent : null;
            if (assistantMessageEvent?.type === "thinking_start" || assistantMessageEvent?.type === "thinking_delta") {
                runPhase.value = "thinking";
            } else if (assistantMessageEvent?.type === "toolcall_start" || assistantMessageEvent?.type === "toolcall_delta") {
                runPhase.value = "tool_args_streaming";
            } else if (event.message.role === "assistant") {
                runPhase.value = "assistant_streaming";
            }
        }
        if (event.type === "tool_execution_start") {
            runPhase.value = "tool_running";
        }
        if (event.type === "tool_execution_update") {
            runPhase.value = "tool_streaming";
        }
        if (event.type === "tool_execution_end") {
            runPhase.value = "finishing";
        }
        if (event.type === "turn_end" && liveRunStatus.value === "running") {
            runPhase.value = "finishing";
        }
    };

    if (getCurrentScope()) {
        onScopeDispose(() => {
            clearPendingMessageUpdates();
        });
    }

    /**
     * 重置当前会话状态。
     */
    const reset = (): void => {
        clearPendingMessageUpdates();
        snapshot.value = null;
        messages.value = [];
        liveRunStatus.value = "idle";
        runPhase.value = "idle";
        connectionStatus.value = "idle";
        pendingUserInputSessions.value = [];
        eventEpoch.value = null;
        lastSeq.value = 0;
        needsSnapshot.value = false;
        snapshotReasons.value = [];
    };

    const clearPendingUserInputSession = (): void => {
        pendingUserInputSessions.value = [];
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
                timestamp: formatTimestamp(Date.now()),
            },
        ]);
    };

    /**
     * 应用恢复真相的 snapshot。
     */
    const applySnapshot = (payload: AgentSessionSnapshotDto): void => {
        clearPendingMessageUpdates();
        const cursor = payload.eventCursor ?? {eventEpoch: payload.eventEpoch, after: payload.lastSeq};
        const activePathChanged = snapshotReasons.value.includes("active_path_changed");
        const snapshotMessages = deriveMessagesFromSessionSnapshot(payload);
        const pendingOptimisticMessages = messages.value.filter((message) => {
            return message.id.startsWith("optimistic-user-")
                && !snapshotMessages.some((snapshotMessage) => snapshotMessage.type === "user" && snapshotMessage.content === message.content);
        });
        snapshot.value = payload;
        const nextMessages = [
            ...snapshotMessages,
            ...pendingOptimisticMessages,
        ];
        messages.value = activePathChanged ? nextMessages : reconcileMessages(messages.value, nextMessages);
        if (payload.activeInvocation) {
            liveRunStatus.value = payload.activeInvocation.status === "waiting" ? "waiting" : payload.activeInvocation.status;
            runPhase.value = payload.pendingApprovals.length > 0 ? "waiting_user" : runPhase.value === "idle" ? "model_pending" : runPhase.value;
        } else {
            liveRunStatus.value = "idle";
            runPhase.value = "idle";
        }
        pendingUserInputSessions.value = payload.pendingApprovals
            .map((approval: AgentPendingApprovalDto) => toPendingUserInputSession(approval, messages.value))
            .filter((session: AgentPendingUserInputSession | null): session is AgentPendingUserInputSession => session !== null);
        eventEpoch.value = cursor.eventEpoch;
        lastSeq.value = cursor.after;
        needsSnapshot.value = false;
        snapshotReasons.value = [];
    };

    /**
     * 只更新关联 Agent 面板需要的关系数据，不重建消息流。
     */
    const applyRelations = (payload: AgentSessionRelationsDto): void => {
        if (!snapshot.value || snapshot.value.summary.sessionId !== payload.sessionId) {
            return;
        }
        snapshot.value = {
            ...snapshot.value,
            linkedAgents: payload.linkedAgents,
            linkedByAgents: payload.linkedByAgents,
        };
    };

    /**
     * 应用轻量 live state。它只更新运行态 shell，不重建历史消息。
     */
    const applyLiveState = (state: AgentSessionLiveStateDto): void => {
        if (!snapshot.value) {
            requestSnapshot("missing_snapshot");
            return;
        }
        const currentSnapshot = snapshot.value;
        const activePathChanged = state.activePathRevision !== currentSnapshot.activePathRevision;
        snapshot.value = {
            ...currentSnapshot,
            summary: state.summary,
            summarizer: state.summarizer,
            activeLeafId: state.activeLeafId,
            activePathRevision: state.activePathRevision,
            pendingApprovals: state.pendingApprovals,
            steerQueue: state.steerQueue,
            followUpQueue: state.followUpQueue,
            activeInvocation: state.activeInvocation,
            model: state.model,
            thinkingLevel: state.thinkingLevel,
            effectiveThinkingLevel: state.effectiveThinkingLevel,
            planModeActive: state.planModeActive,
            usage: state.usage,
            contextUsage: state.contextUsage,
        };
        if (state.activeInvocation) {
            liveRunStatus.value = state.activeInvocation.status === "waiting" ? "waiting" : state.activeInvocation.status;
            runPhase.value = state.pendingApprovals.length > 0 ? "waiting_user" : runPhase.value === "idle" ? "model_pending" : runPhase.value;
        } else if (liveRunStatus.value !== "aborting") {
            liveRunStatus.value = "idle";
            runPhase.value = "idle";
        }
        pendingUserInputSessions.value = state.pendingApprovals
            .map((approval: AgentPendingApprovalDto) => toPendingUserInputSession(approval, messages.value))
            .filter((session: AgentPendingUserInputSession | null): session is AgentPendingUserInputSession => session !== null);
        if (activePathChanged) {
            requestSnapshot("active_path_changed");
        }
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
            const epochChanged = eventEpoch.value !== null && eventEpoch.value !== payload.event.eventEpoch;
            const cursorAheadOfStream = payload.event.latestSeq < lastSeq.value;
            if (epochChanged || cursorAheadOfStream) {
                requestSnapshot("event_epoch_changed");
            } else {
                eventEpoch.value = payload.event.eventEpoch;
            }
            connectionStatus.value = "connected";
            return;
        }
        if (eventEpoch.value !== null && eventEpoch.value !== payload.eventEpoch) {
            flushPendingMessageUpdates();
            requestSnapshot("event_epoch_changed");
            return;
        }
        if (eventEpoch.value === null) {
            eventEpoch.value = payload.eventEpoch;
        }
        if (payload.kind === "session" && payload.event.type === "snapshot_required") {
            flushPendingMessageUpdates();
            requestSnapshot("snapshot_required");
            return;
        }
        if (payload.seq <= lastSeq.value) {
            return;
        }
        if (payload.seq > lastSeq.value + 1 && lastSeq.value > 0) {
            flushPendingMessageUpdates();
            requestSnapshot("seq_gap");
            return;
        }
        lastSeq.value = payload.seq;

        if (payload.kind === "runtime") {
            if (payload.event.type === "message_update") {
                queuePendingMessageUpdate(payload.event, payload.invocationId);
                applyRuntimePhase(payload.event);
                return;
            }
            flushPendingMessageUpdates();
            messages.value = applyRuntimeEventToMessages(messages.value, payload.event, payload.invocationId);
            applyRuntimePhase(payload.event);
            return;
        }

        flushPendingMessageUpdates();

        if (payload.event.type === "session_entry") {
            messages.value = applySessionEntryToMessages(messages.value, payload.event.entry);
            if (payload.event.entry.type === "message" && payload.event.entry.message.role === "toolResult") {
                const toolCallId = payload.event.entry.message.toolCallId;
                pendingUserInputSessions.value = pendingUserInputSessions.value.filter((session) => {
                    return !session.questions.some((question) => (question.toolCallId ?? question.toolNodeId) === toolCallId);
                });
            }
            if (payload.event.entry.type === "custom"
                && (payload.event.entry.key.startsWith("agent.link.") || payload.event.entry.key.startsWith("agent.detach."))) {
                requestSnapshot("linked_agent_changed");
            }
            return;
        }

        if (payload.event.type === "session_state_changed") {
            applyLiveState(payload.event.state);
            return;
        }

        if (payload.event.type === "follow_up_queued" && snapshot.value) {
            const currentSnapshot = snapshot.value;
            snapshot.value = {
                ...currentSnapshot,
                followUpQueue: {
                    ...currentSnapshot.followUpQueue,
                    items: mergeQueuedMessages(currentSnapshot.followUpQueue.items, payload.event.item),
                },
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
        applyRelations,
        applySnapshot,
        clearSnapshotRequest,
        clearPendingUserInputSession,
        connectionStatus,
        eventEpoch,
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
