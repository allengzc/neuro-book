<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload} from "nbook/app/stores/novel-ide";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {hasVisibleInvocationError, isContinuationPointMessage} from "nbook/app/components/novel-ide/agent/agent-message";
import {applyClientVariablePatch, buildAgentClientState} from "nbook/app/components/novel-ide/agent/client-variables";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {useAgentSessionStream, type AgentSessionStreamSnapshotReason} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import AgentChatFlow from "nbook/app/components/novel-ide/agent/AgentChatFlow.vue";
import AgentComposer from "nbook/app/components/novel-ide/agent/AgentComposer.vue";
import AgentLinkedAgentPanel from "nbook/app/components/novel-ide/agent/AgentLinkedAgentPanel.vue";
import AgentSessionDialog from "nbook/app/components/novel-ide/agent/AgentSessionDialog.vue";
import AgentSessionTreeDialog from "nbook/app/components/novel-ide/agent/AgentSessionTreeDialog.vue";
import {deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigModelSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentQueuedMessageDto, AgentSessionListQueryDto, AgentSessionSnapshotDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {InvokeAgentResult} from "nbook/server/agent/harness/types";

type SessionModelDraft = {
    modelKey: string | null;
    reasoningEffort: ThinkingLevelDto | null;
};

const props = defineProps<{
    active: boolean;
    layout: "drawer" | "workbench";
    novelId: string;
    selectedFilePath?: string;
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "sync-workspace", payload: AgentWorkspaceSyncPayload): void;
}>();

const inputText = ref("");
const chatFlowRef = ref<InstanceType<typeof AgentChatFlow> | null>(null);
const inputRef = ref<InstanceType<typeof AgentComposer> | null>(null);

const sessions = ref<AgentSessionSummaryDto[]>([]);
const activeSessionId = ref<number | null>(null);
const linkedAgentPanelOpen = ref(false);
const loadingSession = ref(false);
const previousSelectedFilePath = ref<string | null>(props.selectedFilePath || null);
const fileChangedSinceLastSend = ref(false);
const selectionVersion = ref(0);
const sessionDialogOpen = ref(false);
const sessionTreeDialogOpen = ref(false);
const sessionActionId = ref<number | null>(null);
const editingMessageId = ref<string | null>(null);
const messageActionId = ref<string | null>(null);
const selectableModels = ref<ConfigModelSettingsDto["enabledModels"]>([]);
const resolvedDefaultProfileKey = ref("leader.default");
const sessionModelMode = ref<"default" | "override">("default");
const sessionModelDraft = ref<SessionModelDraft>({
    modelKey: null,
    reasoningEffort: null,
});
const sessionModelPopoverOpen = ref(false);
const sessionModelSaving = ref(false);
const submittingUserInputKey = ref<string | null>(null);
const userInputSelectedAnswers = ref<Record<string, number[]>>({});
const userInputNotes = ref<Record<string, string>>({});
let defaultProfileResolveRequest = 0;
let ensureSessionRequest: Promise<AgentSessionSummaryDto[]> | null = null;
let suppressLeaderProfileReset = false;

const sanitizeHtml = ref<((html: string) => string) | null>(null);
const session = useAgentSession();
const agentApi = useAgentSessionApi();
const configApi = useConfigApi();
const messages = session.messages;
const running = session.running;
const connectionStatus = session.connectionStatus;
const runPhase = session.runPhase;
const pendingUserInputSession = session.pendingUserInputSession;
const {confirm} = useDialog();
const notification = useNotification();

const ideStore = useNovelIdeStore();
const {
    selectedStoryThreadId,
    selectedStorySceneId,
    workspaceTree,
} = storeToRefs(ideStore);

const novelIdRef = toRef(props, "novelId");
const {
    resolveMenu: resolveInputMenu,
    menuRefreshKey: agentMenuRefreshKey,
    refreshSkillCatalog,
} = useStructuredReferenceMenu({
    novelId: novelIdRef,
    selectedStoryThreadId,
    selectedStorySceneId,
    workspaceTree,
});

provide("sanitizeHtml", sanitizeHtml);

const activeSnapshot = computed(() => session.snapshot.value);
const activeSummary = computed(() => activeSnapshot.value?.summary ?? null);
const activeSummarizer = computed(() => activeSnapshot.value?.summarizer ?? null);
const linkedAgents = computed(() => activeSnapshot.value?.linkedAgents ?? []);
const linkedByAgents = computed(() => activeSnapshot.value?.linkedByAgents ?? []);
const queuedMessages = computed<AgentQueuedMessageDto[]>(() => [
    ...activeSnapshot.value?.steerQueue ?? [],
    ...activeSnapshot.value?.followUpQueue.items ?? [],
].sort((left, right) => left.createdAt - right.createdAt));
const linkedAgentCount = computed(() => linkedAgents.value.length + linkedByAgents.value.length);
const planModeActive = computed(() => activeSnapshot.value?.planModeActive ?? false);
const renderNodes = computed(() => messages.value);
const messageActionsDisabled = computed(() => running.value || Boolean(messageActionId.value));
const canContinueWithoutInput = computed(() => {
    if (running.value || inputText.value.trim() || messages.value.length === 0) {
        return false;
    }
    return isContinuationPointMessage(messages.value.at(-1), {
        allowSettledAiToolCalls: activeSummary.value?.status === "interrupted",
    });
});
const connectionStatusLabel = computed(() => {
    switch (connectionStatus.value) {
        case "connecting": return "连接中";
        case "reconnecting": return "事件连接断开，正在重连";
        case "recovering": return "正在恢复历史";
        case "disconnected": return "事件连接已断开";
        default: return "";
    }
});
const connectionNeedsAction = computed(() => connectionStatus.value === "disconnected" || sessionStream.reconnectAttempt.value > 3);
const runPhaseLabel = computed(() => {
    switch (runPhase.value) {
        case "model_pending": return "等待模型响应";
        case "thinking": return "思考中";
        case "assistant_streaming": return "生成回复中";
        case "tool_args_streaming": return "生成工具参数";
        case "tool_running": return "执行工具中";
        case "tool_streaming": return "读取工具输出";
        case "waiting_user": return "等待用户确认";
        case "finishing": return "工具已完成，正在继续生成";
        default: return "运行中";
    }
});

const systemLeaderProfileKey = computed(() => {
    return ideStore.workspaceKind === "user-assets" ? "leader.assets" : "leader.default";
});

const leaderProfileKey = computed(() => {
    return resolvedDefaultProfileKey.value || systemLeaderProfileKey.value;
});

const workspaceKey = computed(() => {
    if (ideStore.workspaceKind === "user-assets") {
        return "user-assets";
    }
    return ideStore.currentNovelId || "workspace";
});

const agentWorkspaceRoot = computed(() => ideStore.workspaceKind === "user-assets" ? "workspace/.nbook" : ideStore.currentWorkspaceRoot || "workspace");

/**
 * 把 Agent 面板内 API 异常统一转换为 notification 文案。
 */
const notifyAgentError = (error: unknown, fallback: string, title = fallback): string => {
    const message = resolveApiErrorMessage(error, fallback);
    notification.error(message, {title});
    return message;
};

/**
 * 生成等待用户输入实例的稳定 key，用来避免旧 pending 的提交态影响下一组问题。
 */
function pendingUserInputKey(session: typeof pendingUserInputSession.value): string | null {
    if (!session) {
        return null;
    }
    const firstQuestion = session.questions[0];
    const toolKey = firstQuestion?.toolCallId ?? firstQuestion?.toolNodeId;
    return toolKey ? `${session.assistantMessageId}\n${toolKey}` : session.assistantMessageId;
}

const currentPendingUserInputKey = computed(() => pendingUserInputKey(pendingUserInputSession.value));
const submittingCurrentUserInput = computed(() => {
    return Boolean(submittingUserInputKey.value && submittingUserInputKey.value === currentPendingUserInputKey.value);
});

/**
 * 当前挂起提问 session 变化时，重置本地答案草稿。
 */
watch(() => pendingUserInputSession.value?.assistantMessageId ?? null, () => {
    userInputSelectedAnswers.value = {};
    userInputNotes.value = {};
}, {immediate: true});

const activeDrawerTitle = computed(() => activeSummary.value?.profileKey === "leader.assets" ? "用户资产助手" : "AI 写作助手");
const activeSessionTitle = computed(() => activeSummary.value?.title || (activeSessionId.value ? `Session #${String(activeSessionId.value)}` : "未命名对话"));
const activeSessionSummaryText = computed(() => activeSummary.value?.summary?.trim() || activeDrawerTitle.value);
const summarizerStatus = computed<null | {
    label: string;
    icon: string;
    className: string;
    title: string;
    spinning: boolean;
}>(() => {
    const state = activeSummarizer.value;
    if (!state) {
        return null;
    }
    if (state.running && state.dirty) {
        return {
            label: "摘要排队",
            icon: "i-lucide-refresh-cw",
            className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            title: "后台摘要正在运行；当前摘要完成后会按最新会话重新摘要。",
            spinning: true,
        };
    }
    if (state.running) {
        return {
            label: "摘要中",
            icon: "i-lucide-loader-circle",
            className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
            title: "后台正在更新当前会话标题和摘要。",
            spinning: true,
        };
    }
    if (state.lastError) {
        return {
            label: "摘要失败",
            icon: "i-lucide-triangle-alert",
            className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
            title: state.lastError,
            spinning: false,
        };
    }
    return null;
});
const sessionModelDefaultLabel = computed(() => "跟随 Profile 默认");
const sessionModelSelectionValue = computed(() => sessionModelMode.value === "override" ? sessionModelDraft.value.modelKey : null);
const sessionThinkingResolvedLabel = computed(() => {
    const requested = activeSnapshot.value?.thinkingLevel ?? null;
    const effective = activeSnapshot.value?.effectiveThinkingLevel ?? "off";
    if (requested === null) {
        return `跟随 Profile（当前 ${thinkingLevelLabel(effective)}）`;
    }
    if (requested === effective) {
        return thinkingLevelLabel(effective);
    }
    return `${thinkingLevelLabel(requested)}（实际 ${thinkingLevelLabel(effective)}）`;
});
const drawerIconClass = computed(() => "i-lucide-sparkles text-[var(--accent-text)]");

const sessionTreeState = computed(() => deriveAgentTreeState(activeSnapshot.value?.tree ?? []));
const branchSwitcherStateByMessageId = computed(() => sessionTreeState.value.switcherByMessageId);

const contextUsageCompactLabel = computed(() => formatCompactTokenCount(activeSnapshot.value?.usage?.input));
const contextUsageExactLabel = computed(() => formatTokenCount(activeSnapshot.value?.usage?.input));
const contextPercentCompactLabel = computed(() => "");
const cumulativeInputCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.input));
const cumulativeOutputCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.output));
const cumulativeCacheCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.cacheRead));
const cumulativeCacheWriteCompactLabel = computed(() => formatCompactTokenCount(activeSummary.value?.usage?.cacheWrite));
const cumulativeUsageExactLabel = computed(() => {
    const usage = activeSummary.value?.usage;
    if (!usage) {
        return "输入 -- / 输出 -- / 缓存 --";
    }
    return `输入 ${formatTokenCount(usage.input)} / 输出 ${formatTokenCount(usage.output)} / 缓存 ${formatTokenCount(usage.cacheRead)}`;
});

/**
 * 将 token 数值格式化为精确文本。
 */
function formatTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    return new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 0}).format(value);
}

/**
 * 将 token 数值格式化为 K/M 紧凑文本。
 */
function formatCompactTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    }
    return `${value}`;
}

/**
 * 显示 PI thinking level 的中文标签。
 */
function thinkingLevelLabel(level: ThinkingLevelDto): string {
    switch (level) {
        case "off": return "关闭";
        case "minimal": return "极低";
        case "low": return "低";
        case "medium": return "中";
        case "high": return "高";
        case "xhigh": return "极高";
    }
}

/**
 * 组装 Novel IDE 客户端变量快照。目前新 profile 第一版不走 header，但保留本地上下文组装入口。
 */
const buildClientState = () => {
    const isUserAssetsWorkspace = ideStore.workspaceKind === "user-assets";
    return buildAgentClientState({
        activePanel: isNovelIdeTab(ideStore.activeLeftTab) ? ideStore.activeLeftTab : null,
        theme: ideStore.theme,
        novelId: isUserAssetsWorkspace ? "" : ideStore.currentNovelId,
        workspace: ideStore.currentWorkspaceRoot || null,
        workspaceKind: ideStore.workspaceKind,
        selectedFilePath: props.selectedFilePath || null,
        selectedStoryThreadId: isUserAssetsWorkspace ? null : selectedStoryThreadId.value,
        selectedStorySceneId: isUserAssetsWorkspace ? null : selectedStorySceneId.value,
        previousSelectedFilePath: previousSelectedFilePath.value,
        fileChangedSinceLastSend: fileChangedSinceLastSend.value,
        selectionVersion: selectionVersion.value,
    });
};

/**
 * 读取可选模型列表。
 */
const loadSelectableModels = async (): Promise<void> => {
    try {
        const snapshot = await configApi.editorSnapshot();
        selectableModels.value = snapshot.modelSettings.enabledModels;
    } catch (error) {
        console.error("读取模型列表失败", error);
        selectableModels.value = [];
    }
};

/**
 * 按当前 workspace 解析默认 Agent Profile。
 */
const loadResolvedLeaderProfileKey = async (): Promise<void> => {
    const requestId = ++defaultProfileResolveRequest;
    if (ideStore.workspaceKind !== "user-assets" && !ideStore.currentNovelId) {
        if (requestId === defaultProfileResolveRequest) {
            resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
        }
        return;
    }
    try {
        const settings = await configApi.bootstrap();
        if (requestId !== defaultProfileResolveRequest) {
            return;
        }
        resolvedDefaultProfileKey.value = settings.defaultProfileSettings.effectiveProfileKey || systemLeaderProfileKey.value;
    } catch (error) {
        if (requestId !== defaultProfileResolveRequest) {
            return;
        }
        console.error("读取默认 Agent Profile 失败", error);
        resolvedDefaultProfileKey.value = systemLeaderProfileKey.value;
    }
};

/**
 * 刷新 session 列表。
 */
const refreshSessions = async (): Promise<AgentSessionSummaryDto[]> => {
    return refreshSessionsWithQuery({
        profileGroup: "leader",
        status: "active",
        relation: "all",
        limit: 50,
    });
};

/**
 * 按弹窗筛选条件刷新 session 列表。
 */
const refreshSessionsWithQuery = async (query: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> => {
    try {
        sessions.value = await agentApi.listSessions({
            ...query,
            workspaceKey: workspaceKey.value,
        });
        return sessions.value;
    } catch (error) {
        console.error("刷新 session 列表失败", error);
        notifyAgentError(error, "刷新 session 列表失败");
        throw error;
    }
};

/**
 * 恢复当前 workspace 下已有的有效 session，不主动创建新 session。
 */
const ensureSessionReady = async (): Promise<AgentSessionSummaryDto[]> => {
    if (ensureSessionRequest) {
        return ensureSessionRequest;
    }
    ensureSessionRequest = ensureSessionReadyInternal();
    try {
        return await ensureSessionRequest;
    } finally {
        ensureSessionRequest = null;
    }
};

/**
 * 执行 session 恢复。
 */
const ensureSessionReadyInternal = async (): Promise<AgentSessionSummaryDto[]> => {
    if (!props.active) {
        return sessions.value;
    }
    if (activeSessionId.value) {
        return sessions.value;
    }
    await loadResolvedLeaderProfileKey();
    if (activeSessionId.value) {
        return sessions.value;
    }
    const list = await refreshSessions();
    if (activeSessionId.value) {
        return list;
    }
    const rememberedId = readLastSessionId();
    const rememberedSession = rememberedId ? list.find((item) => item.sessionId === rememberedId) : undefined;
    const target = rememberedSession ?? list[0];
    if (target) {
        await loadSession(target.sessionId);
        return list;
    }
    return list;
};

/**
 * 显式创建一个新的 session。只能由按钮、弹窗或 /new 这类用户命令调用。
 */
const createSession = async (): Promise<AgentSessionSummaryDto[]> => {
    await loadResolvedLeaderProfileKey();
    const created = await agentApi.createSession({
        profileKey: leaderProfileKey.value,
        input: {},
        workspaceRoot: agentWorkspaceRoot.value,
        workspaceKey: workspaceKey.value,
        projectPath: ideStore.workspaceKind === "user-assets" ? undefined : ideStore.currentNovelId,
    });
    await refreshSessions();
    await loadSession(created.sessionId);
    return sessions.value;
};

/**
 * 切换到指定 session，并拉取 snapshot。
 */
const loadSession = async (sessionId: number): Promise<void> => {
    sessionStream.stop();
    activeSessionId.value = sessionId;
    session.reset();
    editingMessageId.value = null;
    messageActionId.value = null;
    linkedAgentPanelOpen.value = false;
    saveLastSessionId(sessionId);

    try {
        const snapshot = await agentApi.getSession(sessionId);
        session.applySnapshot(snapshot);
        syncSessionModelState(snapshot.summary);
        void sessionStream.start(sessionId);
        fileChangedSinceLastSend.value = false;
        await nextTick();
        scrollToBottom();
    } catch (error) {
        console.error(`加载 session ${String(sessionId)} 失败`, error);
        notifyAgentError(error, "加载 Agent session 失败");
    }
};

/**
 * 从服务端重新同步当前 session snapshot。
 */
const syncActiveSessionSnapshot = async (reason: AgentSessionStreamSnapshotReason = "manual_refresh"): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    return sessionStream.syncSnapshot(reason);
};

/**
 * HTTP 操作如果已返回 snapshot，直接应用；否则才补一次恢复 snapshot。
 */
const applySnapshotOrSync = async (snapshot?: AgentSessionSnapshotDto | null): Promise<void> => {
    if (snapshot) {
        if (snapshot.summary.sessionId !== activeSessionId.value) {
            return;
        }
        session.applySnapshot(snapshot);
        syncSessionModelState(snapshot.summary);
        return;
    }
    await syncActiveSessionSnapshot();
};

/**
 * 统一处理阻塞 invoke 的 HTTP 返回。SSE 正常时错误会以 session entry 进入消息流；
 * 这里负责补 snapshot，并在事件流缺失时给一个即时通知兜底。
 */
const handleInvokeResult = async (result: InvokeAgentResult): Promise<void> => {
    if (result.queuedItem && activeSnapshot.value) {
        const snapshot = activeSnapshot.value;
        if (result.queuedItem.kind === "steer") {
            const steerQueue = mergeQueuedMessages(snapshot.steerQueue, result.queuedItem);
            session.applySnapshot({
                ...snapshot,
                steerQueue,
            } as AgentSessionSnapshotDto);
        } else {
            const followUpQueue = {
                ...snapshot.followUpQueue,
                items: mergeQueuedMessages(snapshot.followUpQueue.items, result.queuedItem),
            };
            session.applySnapshot({
                ...snapshot,
                followUpQueue,
            } as AgentSessionSnapshotDto);
        }
    }
    if (result.status !== "error") {
        return;
    }
    await syncActiveSessionSnapshot("invoke_error_fallback");
    if (!hasVisibleInvocationError(messages.value, result.invocationId)) {
        notification.error(result.error ?? "Agent 运行失败", {title: "Agent 运行失败"});
    }
};

function mergeQueuedMessages(queue: AgentQueuedMessageDto[], item: AgentQueuedMessageDto): AgentQueuedMessageDto[] {
    if (queue.some((current) => current.id === item.id)) {
        return queue;
    }
    return [...queue, item];
}

/**
 * 委托 AgentChatFlow 滚动到底部。
 */
const scrollToBottom = (): void => {
    chatFlowRef.value?.scrollToBottom();
};

const acknowledgeClientPatch = async (sessionId: number, request: Parameters<typeof applyClientVariablePatch>[0]): Promise<void> => {
    try {
        const appliedValue = applyClientVariablePatch(request, buildClientState(), {
            setActivePanel: (value) => {
                ideStore.activeLeftTab = value;
            },
            setTheme: (value) => {
                ideStore.theme = value;
            },
        });
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            appliedValue,
            invocationId: request.invocationId,
            toolCallId: request.toolCallId,
        });
    } catch (error) {
        await agentApi.acknowledgeClientVariablePatch(sessionId, {
            namespace: "client",
            path: request.path,
            operations: request.operations,
            error: error instanceof Error ? error.message : String(error),
            invocationId: request.invocationId,
            toolCallId: request.toolCallId,
        });
    }
};

/**
 * 发送或继续前确保当前 session SSE 处于连接状态。
 */
const ensureActiveSessionEvents = async (): Promise<void> => {
    await sessionStream.ensure();
};

/**
 * 用户显式要求立即重连事件流。
 */
const reconnectActiveSessionEvents = async (): Promise<void> => {
    try {
        await sessionStream.reconnectNow();
    } catch (error) {
        console.error("重新连接 Agent 事件流失败", error);
        notifyAgentError(error, "重新连接 Agent 事件流失败");
    }
};

/**
 * 提交结构化问题答案。
 */
const submitUserInputAnswers = async (payload: {
    assistantMessageId: string;
    resume?: boolean;
    answers: Array<{
        toolNodeId: string;
        questionIndex?: number;
        selectedOptionIndex?: number;
        selectedOptionIndexes?: number[];
        note?: string;
        ignored?: boolean;
    }>;
}): Promise<void> => {
    if (!activeSessionId.value || !pendingUserInputSession.value) {
        return;
    }
    const pendingSession = pendingUserInputSession.value;
    const pendingKey = pendingUserInputKey(pendingSession);
    if (pendingKey && submittingUserInputKey.value === pendingKey) {
        return;
    }
    try {
        submittingUserInputKey.value = pendingKey;
        await ensureActiveSessionEvents();
        const toolCallId = pendingSession.questions[0]?.toolCallId ?? pendingSession.questions[0]?.toolNodeId;
        const firstQuestion = pendingSession.questions[0];
        if (!toolCallId || !firstQuestion) {
            return;
        }
        const answers = payload.answers.map((answer, index) => {
            const questionIndex = answer.questionIndex ?? index;
            const question = pendingSession.questions.find((item) => {
                return item.toolNodeId === answer.toolNodeId && item.questionIndex === questionIndex;
            }) ?? pendingSession.questions[questionIndex] ?? firstQuestion;
            return {
                questionIndex,
                text: answer.ignored
                    ? "用户选择终止本轮。"
                    : formatAnswerText(question.options, answer.selectedOptionIndex, answer.selectedOptionIndexes, answer.note),
                selectedOptionIndex: answer.selectedOptionIndex,
                selectedOptionIndexes: answer.selectedOptionIndexes,
                note: answer.note,
                ignored: answer.ignored,
            };
        });
        session.clearPendingUserInputSession();
        userInputSelectedAnswers.value = {};
        userInputNotes.value = {};
        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "continue",
            clientState: buildClientState(),
            resolution: firstQuestion.kind === "tool_approval"
                ? {
                    kind: "tool_approval",
                    toolCallId,
                    approved: isApprovalApproved(payload.answers[0]),
                    resultText: answers.map((answer) => answer.text).join("\n"),
                    answers,
                }
                : {
                    kind: "user_input",
                    toolCallId,
                    answers,
                },
        });
        await handleInvokeResult(result);
        await syncActiveSessionSnapshot();
    } catch (error) {
        if (!pendingUserInputSession.value && submittingUserInputKey.value === pendingKey) {
            pendingUserInputSession.value = pendingSession;
        }
        console.error("提交问题答案失败", error);
        await syncActiveSessionSnapshot();
        notifyAgentError(error, "提交问题答案失败");
        throw error;
    } finally {
        if (submittingUserInputKey.value === pendingKey) {
            submittingUserInputKey.value = null;
        }
    }
};

/**
 * 提交当前挂起中的整组结构化答案。
 */
const submitPendingUserInputAnswers = (): void => {
    if (!pendingUserInputSession.value || submittingCurrentUserInput.value) {
        return;
    }
    void submitUserInputAnswers({
        assistantMessageId: pendingUserInputSession.value.assistantMessageId,
        answers: pendingUserInputSession.value.questions.map((question) => {
            const key = `${question.toolNodeId}\n${question.questionIndex}`;
            const selected = userInputSelectedAnswers.value[key] ?? [];
            return {
                toolNodeId: question.toolNodeId,
                questionIndex: question.questionIndex,
                selectedOptionIndex: question.multiSelect ? undefined : selected[0],
                selectedOptionIndexes: question.multiSelect ? selected : undefined,
                note: userInputNotes.value[key]?.trim() || undefined,
            };
        }),
    });
};

provide(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, {
    pendingSession: pendingUserInputSession,
    submitting: submittingCurrentUserInput,
    draft: {
        selectedAnswers: userInputSelectedAnswers,
        notes: userInputNotes,
    },
    submitAnswers: submitPendingUserInputAnswers,
});

/**
 * 停止当前运行。
 */
const stopRun = async (): Promise<void> => {
    if (!activeSessionId.value || !running.value) {
        return;
    }
    try {
        await agentApi.abortSession(activeSessionId.value, {reason: "user abort"});
        await syncActiveSessionSnapshot();
    } catch (error) {
        console.error("停止 Agent 运行失败", error);
    }
};

/**
 * 快捷键切换 Plan Mode。
 */
const togglePlanMode = async (): Promise<void> => {
    if (!activeSessionId.value || running.value) {
        return;
    }
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "plan",
            active: !planModeActive.value,
        });
        await applySnapshotOrSync(result.snapshot);
    } catch (error) {
        console.error("切换 Plan Mode 失败", error);
        notifyAgentError(error, "切换 Plan Mode 失败");
    }
};

/**
 * 发送输入内容。
 */
const send = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (pendingUserInputSession.value) {
        return;
    }
    if (!activeSessionId.value) {
        notification.info("请先新建或选择一个 Agent session", {title: "没有可用 session"});
        sessionDialogOpen.value = true;
        return;
    }

    if (message.startsWith("/") && await handleSlashCommand(message)) {
        resetInput();
        return;
    }

    if (!message) {
        if (canContinueWithoutInput.value) {
            await ensureActiveSessionEvents();
            const result = await agentApi.invokeSession(activeSessionId.value, {
                mode: "continue",
                clientState: buildClientState(),
            });
            await handleInvokeResult(result);
        }
        return;
    }

    const prompt = inputText.value;
    resetInput();
    session.appendOptimisticUserMessage(prompt);
    await ensureActiveSessionEvents();
    const result = await agentApi.invokeSession(activeSessionId.value, {
        mode: "prompt",
        message: {text: prompt},
        clientState: buildClientState(),
    });
    await handleInvokeResult(result);
};

/**
 * 运行中引导当前 Agent loop。
 */
const steer = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (!activeSessionId.value || !running.value || !message) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const prompt = inputText.value;
        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "steer",
            message: {text: prompt},
            clientState: buildClientState(),
        });
        await handleInvokeResult(result);
        resetInput();
        notification.success("消息已引导");
    } catch (error) {
        console.error("引导消息失败", error);
        notifyAgentError(error, "引导消息失败");
    }
};

/**
 * 运行中把消息排到当前 loop 结束后继续执行。
 */
const followup = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (!activeSessionId.value || !running.value || !message) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const prompt = inputText.value;
        const result = await agentApi.invokeSession(activeSessionId.value, {
            mode: "followup",
            message: {text: prompt},
            clientState: buildClientState(),
        });
        await handleInvokeResult(result);
        resetInput();
        notification.success("消息已排队");
    } catch (error) {
        console.error("排队消息失败", error);
        notifyAgentError(error, "排队消息失败");
    }
};

/**
 * 处理前端识别的 slash command。
 */
const handleSlashCommand = async (message: string): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    const [command, ...rest] = message.trim().split(/\s+/);
    if (command === "/new") {
        await createSession();
        return true;
    }
    if (command === "/clear") {
        const result = await agentApi.moveTree(activeSessionId.value, {
            position: "empty",
        });
        await applySnapshotOrSync(result.snapshot);
        return true;
    }
    if (command === "/plan") {
        await togglePlanMode();
        return true;
    }
    if (command === "/compact") {
        await compactSession(rest.join(" ") || undefined);
        return true;
    }
    if (command === "/model") {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey: rest[0] ?? null,
        });
        await applySnapshotOrSync(result.snapshot);
        return true;
    }
    return false;
};

/**
 * 手动压缩当前 Session 上下文。压缩过程走 session SSE，同步一次 snapshot 让 UI 立刻进入 running。
 */
const compactSession = async (instructions?: string): Promise<void> => {
    if (!activeSessionId.value || running.value) {
        return;
    }
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "compact",
            instructions,
        });
        await applySnapshotOrSync(result.snapshot);
    } catch (error) {
        console.error("压缩 Session 失败", error);
        notifyAgentError(error, "压缩 Session 失败");
    }
};

/**
 * 清空输入态。
 */
function resetInput(): void {
    inputText.value = "";
}

/**
 * 复制消息正文。
 */
const copyMessage = async (message: AgentMessage): Promise<void> => {
    if (!message.content.trim()) {
        return;
    }
    await navigator.clipboard.writeText(message.content);
    notification.success("消息已复制");
};

/**
 * 复制工具调用内容。
 */
const copyToolCall = async (toolCall: AgentToolCall): Promise<void> => {
    const text = [toolCall.argsJson ?? toolCall.argsText, toolCall.result ?? "", toolCall.error ?? ""]
        .filter((value) => value.trim())
        .join("\n\n");
    if (!text) {
        return;
    }
    await navigator.clipboard.writeText(text);
    notification.success("工具结果已复制");
};

const startEditingMessage = (message: AgentMessage): void => {
    if (messageActionsDisabled.value) {
        return;
    }
    editingMessageId.value = message.id;
};

const cancelEditingMessage = (): void => {
    editingMessageId.value = null;
};

/**
 * 更新当前 session 模型覆盖。
 */
const updateSessionModelSelection = async (modelKey: string | null): Promise<void> => {
    sessionModelMode.value = modelKey === null ? "default" : "override";
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey,
    };

    if (!activeSessionId.value || running.value || sessionModelSaving.value) {
        return;
    }
    sessionModelSaving.value = true;
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey,
        });
        await applySnapshotOrSync(result.snapshot);
    } catch (error) {
        console.error("更新 session 模型失败", error);
        notifyAgentError(error, "更新 session 模型失败");
    } finally {
        sessionModelSaving.value = false;
    }
};

/**
 * 更新当前 session 的 thinking 覆盖。
 */
const updateSessionThinkingLevel = async (thinkingLevel: ThinkingLevelDto | null): Promise<void> => {
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        reasoningEffort: thinkingLevel,
    };

    if (!activeSessionId.value || running.value || sessionModelSaving.value) {
        return;
    }
    sessionModelSaving.value = true;
    try {
        const result = await agentApi.runCommand(activeSessionId.value, {
            command: "thinking",
            thinkingLevel,
        });
        await applySnapshotOrSync(result.snapshot);
    } catch (error) {
        console.error("更新 session 推理强度失败", error);
        notifyAgentError(error, "更新 session 推理强度失败");
    } finally {
        sessionModelSaving.value = false;
    }
};

function toggleSessionModelPopover(): void {
    sessionModelPopoverOpen.value = !sessionModelPopoverOpen.value;
}

async function applySessionModelSettings(): Promise<void> {
    const nextModelKey = sessionModelDraft.value.modelKey;
    const nextThinkingLevel = sessionModelDraft.value.reasoningEffort;
    await updateSessionModelSelection(nextModelKey);
    await updateSessionThinkingLevel(nextThinkingLevel);
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey: nextModelKey,
        reasoningEffort: nextThinkingLevel,
    };
    sessionModelPopoverOpen.value = false;
}

async function resetSessionModelSettings(): Promise<void> {
    await updateSessionModelSelection(null);
    await updateSessionThinkingLevel(null);
    sessionModelPopoverOpen.value = false;
}

function syncSessionModelState(_summary: AgentSessionSummaryDto | null): void {
    const model = session.snapshot.value?.model ?? null;
    sessionModelMode.value = model ? "override" : "default";
    const providerConfigId = model && "providerConfigId" in model && typeof model.providerConfigId === "string"
        ? model.providerConfigId
        : model?.provider;
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey: model ? `${providerConfigId}/${model.id}` : null,
        reasoningEffort: session.snapshot.value?.thinkingLevel ?? null,
    };
}

const sessionStream = useAgentSessionStream({
    session,
    api: agentApi,
    activeSessionId,
    applySnapshotSideEffects: (snapshot) => {
        syncSessionModelState(snapshot.summary);
    },
    onEvent: async (event) => {
        if (event.kind === "session" && event.event.type === "client_variable_patch_requested" && activeSessionId.value) {
            await acknowledgeClientPatch(activeSessionId.value, event.event.request);
        }
    },
    onError: (error, fallback) => {
        console.error(fallback, error);
        notifyAgentError(error, fallback);
    },
});

const cycleMessageBranch = async (messageId: string, direction: -1 | 1): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    const target = resolveBranchSwitchTarget(sessionTreeState.value, messageId, direction);
    if (!target) {
        return;
    }
    messageActionId.value = messageId;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: target.id,
            position: "at",
        });
        await applySnapshotOrSync(result.snapshot);
    } catch (error) {
        console.error("切换消息分支失败", error);
        notifyAgentError(error, "切换消息分支失败");
    } finally {
        messageActionId.value = null;
    }
};

const selectTreeNode = async (entryId: string): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    messageActionId.value = entryId;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: entryId,
            position: "at",
        });
        await applySnapshotOrSync(result.snapshot);
    } catch (error) {
        console.error("切换 Session Tree 节点失败", error);
        notifyAgentError(error, "切换 Session Tree 节点失败");
    } finally {
        messageActionId.value = null;
    }
};

const saveEditedMessage = async (payload: {message: AgentMessage; content: string}): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    messageActionId.value = payload.message.id;
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: payload.message.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "prompt",
                message: {text: payload.content},
                clientState: buildClientState(),
            },
        });
        if (result.invocation) {
            await handleInvokeResult(result.invocation);
        }
        editingMessageId.value = null;
        await syncActiveSessionSnapshot();
        notification.success("消息已更新");
    } catch (error) {
        console.error("改写消息失败", error);
        notifyAgentError(error, "改写消息失败");
    } finally {
        messageActionId.value = null;
    }
};

const refreshMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    messageActionId.value = message.id;
    try {
        await ensureActiveSessionEvents();
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: message.type === "user" ? "at" : "before",
            next: {
                type: "invoke",
                mode: "continue",
                clientState: buildClientState(),
            },
        });
        if (result.invocation) {
            await handleInvokeResult(result.invocation);
        }
        editingMessageId.value = null;
        await syncActiveSessionSnapshot();
    } catch (error) {
        console.error("刷新消息失败", error);
        notifyAgentError(error, "刷新消息失败");
    } finally {
        messageActionId.value = null;
    }
};

const rollbackMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeSessionId.value || messageActionId.value || running.value) {
        return;
    }
    const confirmed = await confirm("确定要回退到这条消息吗？", "回退消息");
    if (!confirmed) {
        return;
    }
    messageActionId.value = message.id;
    try {
        const result = await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: "at",
        });
        await applySnapshotOrSync(result.snapshot);
        editingMessageId.value = null;
        notification.success("消息已回退");
    } catch (error) {
        console.error("回退消息失败", error);
        notifyAgentError(error, "回退消息失败");
    } finally {
        messageActionId.value = null;
    }
};

const openSessionDialog = async (): Promise<void> => {
    await ensureSessionReady();
    sessionDialogOpen.value = true;
};

const selectSession = async (sessionId: number): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    if (sessionId === activeSessionId.value) {
        sessionDialogOpen.value = false;
        return;
    }
    loadingSession.value = true;
    try {
        await loadSession(sessionId);
        sessionDialogOpen.value = false;
    } finally {
        loadingSession.value = false;
    }
};

const createSessionFromDialog = async (): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        await createSession();
        sessionDialogOpen.value = false;
    } finally {
        loadingSession.value = false;
    }
};

/**
 * 从抽屉头部显式创建 session，并避免重复点击连建多个空 session。
 */
const createSessionFromHeader = async (): Promise<void> => {
    if (loadingSession.value || sessionActionId.value) {
        return;
    }
    loadingSession.value = true;
    try {
        await createSession();
    } finally {
        loadingSession.value = false;
    }
};

const archiveSessionFromDialog = async (target: AgentSessionSummaryDto): Promise<void> => {
    if (target.status === "running" || target.status === "waiting" || loadingSession.value || sessionActionId.value) {
        return;
    }
    sessionActionId.value = target.sessionId;
    try {
        await agentApi.runCommand(target.sessionId, {
            command: "archive",
            reason: "archived from drawer",
        });
        const nextSessions = await refreshSessions();
        if (target.sessionId !== activeSessionId.value) {
            return;
        }
        if (nextSessions[0]?.sessionId) {
            await loadSession(nextSessions[0].sessionId);
            return;
        }
        sessionStream.stop();
        activeSessionId.value = null;
        session.reset();
        syncSessionModelState(null);
    } finally {
        sessionActionId.value = null;
    }
};

/**
 * 清空当前 workspace 绑定的 Agent session 状态。workspace 切换时必须硬重置，
 * 避免同 profile 的不同 Project Workspace 复用旧会话。
 */
function resetWorkspaceSessionState(): void {
    sessionStream.stop();
    activeSessionId.value = null;
    sessions.value = [];
    linkedAgentPanelOpen.value = false;
    sessionDialogOpen.value = false;
    sessionTreeDialogOpen.value = false;
    sessionModelPopoverOpen.value = false;
    editingMessageId.value = null;
    messageActionId.value = null;
    inputText.value = "";
    session.reset();
    syncSessionModelState(null);
}

watch(() => props.selectedFilePath, (nextFilePath, previousFilePath) => {
    const nextValue = nextFilePath || null;
    const previousValue = previousFilePath || null;
    if (nextValue === previousValue) {
        return;
    }
    previousSelectedFilePath.value = previousValue;
    fileChangedSinceLastSend.value = true;
    selectionVersion.value += 1;
});

watch(() => props.active, async (active) => {
    if (!active) {
        sessionDialogOpen.value = false;
        linkedAgentPanelOpen.value = false;
        sessionModelPopoverOpen.value = false;
        editingMessageId.value = null;
        messageActionId.value = null;
        return;
    }
    await loadSelectableModels();
    await loadResolvedLeaderProfileKey();
    await ensureSessionReady();
    await nextTick();
    requestAnimationFrame(() => {
        inputRef.value?.focus();
        scrollToBottom();
    });
});

watch(leaderProfileKey, async () => {
    if (suppressLeaderProfileReset) {
        return;
    }
    resetWorkspaceSessionState();
    if (!props.active) {
        return;
    }
    await ensureSessionReady();
});

watch(() => [ideStore.workspaceKind, ideStore.currentNovelId] as const, async () => {
    suppressLeaderProfileReset = true;
    try {
        await loadResolvedLeaderProfileKey();
        resetWorkspaceSessionState();
        if (!props.active) {
            return;
        }
        await ensureSessionReady();
        await nextTick();
    } finally {
        suppressLeaderProfileReset = false;
    }
});

onBeforeUnmount(() => {
    sessionStream.stop();
});

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            return;
        }
        await loadSelectableModels();
        await loadResolvedLeaderProfileKey();
        const {default: createDOMPurify} = await import("dompurify");
        const purifier = createDOMPurify(window);
        sanitizeHtml.value = (html) => purifier.sanitize(html) as string;
    })();
});

defineExpose({
    activeSessionId,
    sessions,
    loadingSession,
    running,
    sessionActionId,
    ensureSessionReady,
    refreshSessionsWithQuery,
    selectSession,
    createSession: createSessionFromHeader,
    archiveSessionFromDialog,
});

function readLastSessionId(): number | null {
    if (!import.meta.client) {
        return null;
    }
    const raw = localStorage.getItem(`agent:last-session:${workspaceKey.value}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function saveLastSessionId(sessionId: number): void {
    if (!import.meta.client) {
        return;
    }
    localStorage.setItem(`agent:last-session:${workspaceKey.value}`, String(sessionId));
}

function formatAnswerText(
    options: Array<{label: string}>,
    selectedOptionIndex?: number,
    selectedOptionIndexes?: number[],
    note?: string,
): string {
    const indexes = selectedOptionIndexes?.length ? selectedOptionIndexes : selectedOptionIndex === undefined ? [] : [selectedOptionIndex];
    const labels = indexes.map((index) => index === -1 ? "其他答案" : options[index]?.label ?? String(index));
    const selectedText = labels.join("、");
    if (selectedText && note?.trim()) {
        return `${selectedText}\n备注：${note.trim()}`;
    }
    return note?.trim() || selectedText || "继续";
}

function isApprovalApproved(answer?: {
    selectedOptionIndex?: number;
    selectedOptionIndexes?: number[];
    ignored?: boolean;
}): boolean {
    if (!answer || answer.ignored) {
        return false;
    }
    const indexes = answer.selectedOptionIndexes?.length
        ? answer.selectedOptionIndexes
        : answer.selectedOptionIndex === undefined ? [] : [answer.selectedOptionIndex];
    return indexes.includes(0);
}
</script>

<template>
    <!-- Agent Chat Surface -->
    <section
        class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-panel)]"
        :class="[props.layout === 'workbench' ? 'border-x border-[var(--border-color)]' : '', props.active ? '' : 'pointer-events-none opacity-0']"
        :aria-hidden="!props.active"
    >
        <!-- 抽屉头部 -->
            <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
                <div class="min-w-0 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded border border-[var(--accent-main)] bg-[var(--accent-bg)]">
                        <span class="h-3.5 w-3.5" :class="drawerIconClass"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="flex min-w-0 items-center gap-1.5">
                            <div class="truncate text-sm font-medium tracking-wide text-[var(--text-main)]" :title="activeSessionTitle">{{ activeSessionTitle }}</div>
                            <span class="inline-flex shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-[var(--text-muted)]" :title="activeDrawerTitle">{{ activeDrawerTitle }}</span>
                        </div>
                        <div class="flex min-w-0 items-center gap-1.5">
                            <div class="truncate text-[10px] leading-4 text-[var(--text-muted)]" :title="activeSessionSummaryText">{{ activeSessionSummaryText }}</div>
                            <span v-if="summarizerStatus" class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-normal" :class="summarizerStatus.className" :title="summarizerStatus.title">
                                <span class="h-3 w-3" :class="[summarizerStatus.icon, summarizerStatus.spinning ? 'animate-spin' : '']"></span>
                                {{ summarizerStatus.label }}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="新建对话" :disabled="loadingSession" @click="void createSessionFromHeader()">
                        <span class="i-lucide-plus h-4 w-4"></span>
                    </button>
                    <button class="flex items-center gap-1.5 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': linkedAgentPanelOpen}" title="关联 Agent" @click="linkedAgentPanelOpen = !linkedAgentPanelOpen">
                        <span class="i-lucide-users h-4 w-4"></span>
                        <span v-if="linkedAgentCount" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-white">{{ linkedAgentCount }}</span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" title="Session Tree" :disabled="!activeSessionId" @click="sessionTreeDialogOpen = true">
                        <span class="i-lucide-git-branch h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="Session 列表" @click="void openSessionDialog()">
                        <span class="i-lucide-messages-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <!-- Linked Agent 面板 -->
            <AgentLinkedAgentPanel
                v-if="linkedAgentPanelOpen"
                :session-id="activeSessionId"
                :owned-agents="linkedAgents"
                :linked-by-agents="linkedByAgents"
                :loading="loadingSession"
                @select="void loadSession($event); linkedAgentPanelOpen = false"
                @refresh="void syncActiveSessionSnapshot()"
                @close="linkedAgentPanelOpen = false"
            />

            <!-- 消息序列 -->
            <AgentChatFlow
                ref="chatFlowRef"
                :messages="renderNodes"
                :session-id="activeSessionId"
                :running="running"
                mode="main"
                :editing-message-id="editingMessageId"
                :message-action-disabled="messageActionsDisabled"
                :saving-edit="Boolean(messageActionId)"
                :branch-switcher-state-by-message-id="branchSwitcherStateByMessageId"
                :menu-refresh-key="agentMenuRefreshKey"
                :resolve-editor-menu="resolveInputMenu"
                :on-editor-skill-trigger-start="refreshSkillCatalog"
                @copy="void copyMessage($event)"
                @copy-tool="void copyToolCall($event)"
                @start-edit="startEditingMessage"
                @cancel-edit="cancelEditingMessage"
                @save-edit="void saveEditedMessage($event)"
                @retry="void refreshMessage($event)"
                @delete="void rollbackMessage($event)"
                @cycle-branch="void cycleMessageBranch($event.messageId, $event.direction)"
            />

            <AgentComposer
                ref="inputRef"
                v-model:input-text="inputText"
                v-model:selected-answers="userInputSelectedAnswers"
                v-model:notes="userInputNotes"
                v-model:session-model-popover-open="sessionModelPopoverOpen"
                v-model:session-model-draft="sessionModelDraft"
                :pending-session="pendingUserInputSession"
                :submitting-user-input="submittingCurrentUserInput"
                :running="running"
                :loading-session="loadingSession"
                :session-model-saving="sessionModelSaving"
                :session-model-selection-value="sessionModelSelectionValue"
                :session-model-default-label="sessionModelDefaultLabel"
                :session-thinking-resolved-label="sessionThinkingResolvedLabel"
                :selectable-models="selectableModels"
                :plan-mode-active="planModeActive"
                :can-continue-without-input="canContinueWithoutInput"
                :context-usage-exact-label="contextUsageExactLabel"
                :context-usage-compact-label="contextUsageCompactLabel"
                :context-percent-compact-label="contextPercentCompactLabel"
                :cumulative-usage-exact-label="cumulativeUsageExactLabel"
                :cumulative-input-compact-label="cumulativeInputCompactLabel"
                :cumulative-output-compact-label="cumulativeOutputCompactLabel"
                :cumulative-cache-compact-label="cumulativeCacheCompactLabel"
                :cumulative-cache-write-compact-label="cumulativeCacheWriteCompactLabel"
                :connection-status-label="connectionStatusLabel"
                :run-phase-label="runPhaseLabel"
                :connection-needs-action="connectionNeedsAction"
                :queued-messages="queuedMessages"
                :menu-refresh-key="agentMenuRefreshKey"
                :resolve-menu="resolveInputMenu"
                :on-skill-trigger-start="refreshSkillCatalog"
                @submit-user-input="void submitUserInputAnswers($event)"
                @send="void send()"
                @steer="void steer()"
                @followup="void followup()"
                @stop="void stopRun()"
                @toggle-plan-mode="void togglePlanMode()"
                @toggle-session-model-popover="toggleSessionModelPopover"
                @update-session-model-selection="void updateSessionModelSelection($event)"
                @apply-session-model-settings="void applySessionModelSettings()"
                @reset-session-model-settings="void resetSessionModelSettings()"
                @reconnect-events="void reconnectActiveSessionEvents()"
                @refresh-history="void syncActiveSessionSnapshot()"
            />

            <!-- Session 管理弹窗 -->
            <AgentSessionDialog
                v-model="sessionDialogOpen"
                :sessions="sessions"
                :active-session-id="activeSessionId"
                :loading="loadingSession"
                :running="running"
                :action-id="sessionActionId"
                @select="void selectSession($event)"
                @create="void createSessionFromDialog()"
                @archive="void archiveSessionFromDialog($event)"
                @refresh="void refreshSessionsWithQuery($event)"
            />

            <AgentSessionTreeDialog
                v-model="sessionTreeDialogOpen"
                :tree="activeSnapshot?.tree ?? []"
                :active-leaf-id="activeSnapshot?.activeLeafId ?? null"
                :running="running"
                @select="void selectTreeNode($event)"
            />
    </section>
</template>
