<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload} from "nbook/app/stores/novel-ide";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {hasVisibleInvocationError} from "nbook/app/components/novel-ide/agent/agent-message";
import {applyClientVariablePatch, buildAgentClientState} from "nbook/app/components/novel-ide/agent/client-variables";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
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
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {InvokeAgentResult} from "nbook/server/agent/harness/types";

type SessionModelDraft = {
    modelKey: string | null;
    temperature: string;
    topK: string;
    reasoningEffort: "low" | "medium" | "high" | null;
    stream: boolean;
};

const props = defineProps<{
    isOpen: boolean;
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
const eventsAbortController = ref<AbortController | null>(null);
const eventsSessionId = ref<number | null>(null);
let eventStreamReadyPromise: Promise<void> | null = null;
const editingMessageId = ref<string | null>(null);
const messageActionId = ref<string | null>(null);
const selectableModels = ref<ConfigModelSettingsDto["enabledModels"]>([]);
const resolvedDefaultProfileKey = ref("leader.default");
const sessionModelMode = ref<"default" | "override">("default");
const sessionModelDraft = ref<SessionModelDraft>({
    modelKey: null,
    temperature: "",
    topK: "",
    reasoningEffort: null,
    stream: true,
});
const sessionModelPopoverOpen = ref(false);
const sessionModelSaving = ref(false);
const submittingUserInputKey = ref<string | null>(null);
const userInputSelectedAnswers = ref<Record<string, number[]>>({});
const userInputNotes = ref<Record<string, string>>({});
let defaultProfileResolveRequest = 0;

const sanitizeHtml = ref<((html: string) => string) | null>(null);
const session = useAgentSession();
const agentApi = useAgentSessionApi();
const configApi = useConfigApi();
const messages = session.messages;
const running = session.running;
const pendingUserInputSession = session.pendingUserInputSession;
const {confirm} = useDialog();
const notification = useNotification();

const ideStore = useNovelIdeStore();
const {
    selectedStoryThreadId,
    selectedStorySceneId,
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
});

provide("sanitizeHtml", sanitizeHtml);

const activeSnapshot = computed(() => session.snapshot.value);
const activeSummary = computed(() => activeSnapshot.value?.summary ?? null);
const linkedAgents = computed(() => activeSnapshot.value?.linkedAgents ?? []);
const planModeActive = computed(() => activeSnapshot.value?.planModeActive ?? false);
const renderNodes = computed(() => messages.value);
const messageActionsDisabled = computed(() => running.value || Boolean(messageActionId.value));
const canContinueWithoutInput = computed(() => !running.value && !inputText.value.trim() && messages.value.length > 0 && messages.value.at(-1)?.type !== "ai");

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

const activeSessionTitle = computed(() => activeSummary.value?.title || (activeSessionId.value ? `Session #${String(activeSessionId.value)}` : "未命名对话"));
const sessionModelDefaultLabel = computed(() => "跟随 Profile 默认");
const sessionModelSelectionValue = computed(() => sessionModelMode.value === "override" ? sessionModelDraft.value.modelKey : null);
const activeDrawerTitle = computed(() => activeSummary.value?.profileKey === "leader.assets" ? "用户资产助手" : "AI 写作助手");
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
        const settings = await configApi.editorSnapshot();
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
    try {
        sessions.value = await agentApi.listSessions({workspaceKey: workspaceKey.value});
        return sessions.value;
    } catch (error) {
        console.error("刷新 session 列表失败", error);
        return [];
    }
};

/**
 * 初始化或获取有效 session。
 */
const ensureSessionReady = async (forceNew = false): Promise<void> => {
    if (!props.isOpen && !forceNew) {
        return;
    }
    if (activeSessionId.value && !forceNew) {
        return;
    }
    await loadResolvedLeaderProfileKey();
    const list = await refreshSessions();
    const rememberedId = readLastSessionId();
    const rememberedSession = rememberedId ? list.find((item) => item.sessionId === rememberedId) : undefined;
    const target = forceNew ? undefined : rememberedSession ?? list[0];
    if (target) {
        await loadSession(target.sessionId);
        return;
    }
    const created = await agentApi.createSession({
        profileKey: leaderProfileKey.value,
        input: {},
        workspaceRoot: agentWorkspaceRoot.value,
        workspaceKey: workspaceKey.value,
        projectPath: ideStore.workspaceKind === "user-assets" ? undefined : ideStore.currentNovelId,
    });
    await refreshSessions();
    await loadSession(created.sessionId);
};

/**
 * 切换到指定 session，并拉取 snapshot。
 */
const loadSession = async (sessionId: number): Promise<void> => {
    eventsAbortController.value?.abort();
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
        void subscribeSessionEvents(sessionId);
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
const syncActiveSessionSnapshot = async (): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    try {
        const snapshot = await agentApi.getSession(activeSessionId.value);
        session.applySnapshot(snapshot);
        syncSessionModelState(snapshot.summary);
        return true;
    } catch (error) {
        console.error(`同步 session ${String(activeSessionId.value)} snapshot 失败`, error);
        notifyAgentError(error, "同步 Agent session 失败");
        return false;
    }
};

/**
 * 统一处理阻塞 invoke 的 HTTP 返回。SSE 正常时错误会以 session entry 进入消息流；
 * 这里负责补 snapshot，并在事件流缺失时给一个即时通知兜底。
 */
const handleInvokeResult = async (result: InvokeAgentResult): Promise<void> => {
    if (result.status !== "error") {
        return;
    }
    await syncActiveSessionSnapshot();
    if (!hasVisibleInvocationError(messages.value, result.invocationId)) {
        notification.error(result.error ?? "Agent 运行失败", {title: "Agent 运行失败"});
    }
};

/**
 * 委托 AgentChatFlow 滚动到底部。
 */
const scrollToBottom = (): void => {
    chatFlowRef.value?.scrollToBottom();
};

/**
 * 订阅 session 长连接事件。
 */
const subscribeSessionEvents = async (sessionId: number): Promise<void> => {
    if (eventsAbortController.value && eventsSessionId.value === sessionId) {
        await eventStreamReadyPromise;
        return;
    }

    eventsAbortController.value?.abort();
    const controller = new AbortController();
    eventsAbortController.value = controller;
    eventsSessionId.value = sessionId;
    let resolveReady: () => void = () => {};
    let rejectReady: (error: unknown) => void = () => {};
    const readyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    eventStreamReadyPromise = readyPromise;
    void readyPromise.catch(() => {});

    try {
        await agentApi.subscribeSessionEvents(sessionId, session.lastSeq.value, async (event) => {
            if (sessionId !== activeSessionId.value) {
                return;
            }
            if (event.kind === "session" && event.event.type === "client_variable_patch_requested") {
                await acknowledgeClientPatch(sessionId, event.event.request);
                return;
            }
            session.applyEvent(event);
            if (session.needsSnapshot.value) {
                await syncActiveSessionSnapshot();
            }
            if (event.kind === "session" && event.event.type === "session_state_changed" && event.event.snapshot) {
                syncSessionModelState(event.event.snapshot.summary);
            }
        }, controller.signal, {
            onOpen: resolveReady,
        });
    } catch (error) {
        rejectReady(error);
        if (sessionId === activeSessionId.value && !(error instanceof DOMException && error.name === "AbortError")) {
            running.value = false;
            console.error("Agent event stream 断开", error);
        }
    } finally {
        if (eventsAbortController.value === controller) {
            eventsAbortController.value = null;
            eventsSessionId.value = null;
            eventStreamReadyPromise = null;
        }
    }
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
    if (!activeSessionId.value) {
        return;
    }
    if (eventsAbortController.value) {
        if (eventsSessionId.value === activeSessionId.value) {
            await eventStreamReadyPromise;
            return;
        }
        eventsAbortController.value.abort();
        eventsSessionId.value = null;
    }
    void subscribeSessionEvents(activeSessionId.value);
    await eventStreamReadyPromise;
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
        if (result.snapshot) {
            session.applySnapshot(result.snapshot);
            syncSessionModelState(result.snapshot.summary);
            return;
        }
        await syncActiveSessionSnapshot();
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
    await ensureSessionReady();
    if (!activeSessionId.value) {
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
 * 处理前端识别的 slash command。
 */
const handleSlashCommand = async (message: string): Promise<boolean> => {
    if (!activeSessionId.value) {
        return false;
    }
    const [command, ...rest] = message.trim().split(/\s+/);
    if (command === "/new") {
        await ensureSessionReady(true);
        return true;
    }
    if (command === "/clear") {
        const result = await agentApi.moveTree(activeSessionId.value, {
            position: "empty",
        });
        session.applySnapshot(result.snapshot);
        syncSessionModelState(result.snapshot.summary);
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
        await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey: rest[0] ?? null,
        });
        await syncActiveSessionSnapshot();
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
        await agentApi.runCommand(activeSessionId.value, {
            command: "compact",
            instructions,
        });
        await syncActiveSessionSnapshot();
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
        await agentApi.runCommand(activeSessionId.value, {
            command: "model",
            modelKey,
        });
        await syncActiveSessionSnapshot();
    } catch (error) {
        console.error("更新 session 模型失败", error);
        notifyAgentError(error, "更新 session 模型失败");
    } finally {
        sessionModelSaving.value = false;
    }
};

function toggleSessionModelPopover(): void {
    sessionModelPopoverOpen.value = !sessionModelPopoverOpen.value;
}

async function applySessionModelSettings(): Promise<void> {
    await updateSessionModelSelection(sessionModelDraft.value.modelKey);
    sessionModelPopoverOpen.value = false;
}

async function resetSessionModelSettings(): Promise<void> {
    await updateSessionModelSelection(null);
    sessionModelPopoverOpen.value = false;
}

function syncSessionModelState(_summary: AgentSessionSummaryDto | null): void {
    const model = session.snapshot.value?.model ?? null;
    sessionModelMode.value = model ? "override" : "default";
    const providerConfigId = model && typeof (model as {providerConfigId?: unknown}).providerConfigId === "string"
        ? (model as {providerConfigId: string}).providerConfigId
        : model?.provider;
    sessionModelDraft.value = {
        ...sessionModelDraft.value,
        modelKey: model ? `${providerConfigId}/${model.id}` : null,
    };
}

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
        await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: target.id,
            position: "at",
        });
        await syncActiveSessionSnapshot();
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
        await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: entryId,
            position: "at",
        });
        await syncActiveSessionSnapshot();
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
        await agentApi.moveTree(activeSessionId.value, {
            targetEntryId: message.id,
            position: "at",
        });
        await syncActiveSessionSnapshot();
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
    await refreshSessions();
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
        await ensureSessionReady(true);
        await refreshSessions();
        sessionDialogOpen.value = false;
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
        await ensureSessionReady(true);
    } finally {
        sessionActionId.value = null;
    }
};

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

watch(() => props.isOpen, async (open) => {
    if (!open) {
        sessionDialogOpen.value = false;
        linkedAgentPanelOpen.value = false;
        sessionModelPopoverOpen.value = false;
        editingMessageId.value = null;
        messageActionId.value = null;
        eventsAbortController.value?.abort();
        eventsSessionId.value = null;
        return;
    }
    await loadSelectableModels();
    await loadResolvedLeaderProfileKey();
    await ensureSessionReady();
    await refreshSessions();
    await nextTick();
    requestAnimationFrame(() => {
        inputRef.value?.focus();
        scrollToBottom();
    });
});

watch(leaderProfileKey, async () => {
    eventsAbortController.value?.abort();
    eventsSessionId.value = null;
    activeSessionId.value = null;
    sessions.value = [];
    linkedAgentPanelOpen.value = false;
    session.reset();
    syncSessionModelState(null);
    if (!props.isOpen) {
        return;
    }
    await ensureSessionReady();
    await refreshSessions();
});

watch(() => [ideStore.workspaceKind, ideStore.currentNovelId] as const, async () => {
    await loadResolvedLeaderProfileKey();
});

onBeforeUnmount(() => {
    eventsAbortController.value?.abort();
    eventsSessionId.value = null;
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
    <!-- 右侧 Agent 抽屉 -->
    <aside
        class="z-30 flex h-full shrink-0 flex-col bg-[var(--bg-panel)] shadow-2xl transition-all duration-300"
        :class="props.isOpen ? 'w-[400px] border-l border-[var(--border-color)] opacity-100' : 'pointer-events-none w-0 border-l-0 opacity-0'"
    >
        <template v-if="props.isOpen">
            <!-- 抽屉头部 -->
            <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
                <div class="min-w-0 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded border border-[var(--accent-main)] bg-[var(--accent-bg)]">
                        <span class="h-3.5 w-3.5" :class="drawerIconClass"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="text-sm font-medium tracking-wide text-[var(--text-main)]">{{ activeDrawerTitle }}</div>
                        <div class="truncate text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ activeSessionTitle }}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="新建对话" :disabled="loadingSession" @click="void ensureSessionReady(true)">
                        <span class="i-lucide-plus h-4 w-4"></span>
                    </button>
                    <button class="flex items-center gap-1.5 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': linkedAgentPanelOpen}" title="关联 Agent" @click="linkedAgentPanelOpen = !linkedAgentPanelOpen">
                        <span class="i-lucide-users h-4 w-4"></span>
                        <span v-if="linkedAgents.length" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-white">{{ linkedAgents.length }}</span>
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
                :agents="linkedAgents"
                :loading="loadingSession"
                @select="void loadSession($event); linkedAgentPanelOpen = false"
                @refresh="void syncActiveSessionSnapshot()"
                @close="linkedAgentPanelOpen = false"
            />

            <!-- 消息序列 -->
            <AgentChatFlow
                ref="chatFlowRef"
                :messages="renderNodes"
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
                :menu-refresh-key="agentMenuRefreshKey"
                :resolve-menu="resolveInputMenu"
                :on-skill-trigger-start="refreshSkillCatalog"
                @submit-user-input="void submitUserInputAnswers($event)"
                @send="void send()"
                @stop="void stopRun()"
                @toggle-plan-mode="void togglePlanMode()"
                @toggle-session-model-popover="toggleSessionModelPopover"
                @update-session-model-selection="void updateSessionModelSelection($event)"
                @apply-session-model-settings="void applySessionModelSettings()"
                @reset-session-model-settings="void resetSessionModelSettings()"
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
            />

            <AgentSessionTreeDialog
                v-model="sessionTreeDialogOpen"
                :tree="activeSnapshot?.tree ?? []"
                :active-leaf-id="activeSnapshot?.activeLeafId ?? null"
                :running="running"
                @select="void selectTreeNode($event)"
            />
        </template>
    </aside>
</template>
