<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useAgentApi} from "nbook/app/composables/useAgentApi";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload} from "nbook/app/stores/novel-ide";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {
    ClientVariablesDto,
    AgentStreamEventDto,
    AgentThreadDetailDto,
    AgentThreadModelConfigDto,
    AgentThreadSummaryDto,
    AgentSubagentSummaryDto,
    CreateAgentThreadRequestDto,
} from "nbook/shared/dto/agent-chat.dto";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {buildNovelIdeClientVariables} from "nbook/app/components/novel-ide/agent/client-variables";
import {resolveActiveCursorRole, resolveMessageSwitcher} from "nbook/app/components/novel-ide/agent/agent-message";
import {useStructuredReferenceMenu} from "nbook/app/composables/useStructuredReferenceMenu";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useAgentThreadSession} from "nbook/app/components/novel-ide/agent/useAgentThreadSession";

import AgentChatFlow from "nbook/app/components/novel-ide/agent/AgentChatFlow.vue";
import AgentComposer from "nbook/app/components/novel-ide/agent/AgentComposer.vue";
import AgentSubagentPanel from "nbook/app/components/novel-ide/agent/AgentSubagentPanel.vue";
import AgentThreadDialog from "nbook/app/components/novel-ide/agent/AgentThreadDialog.vue";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import type {ModelSettingsDto} from "nbook/shared/dto/app-settings.dto";

type ThreadModelDraft = {
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

const threads = ref<AgentThreadSummaryDto[]>([]);
const activeThreadId = ref("");
const activeThread = ref<AgentThreadSummaryDto | null>(null);
const subagents = ref<AgentSubagentSummaryDto[]>([]);
const leaders = ref<AgentThreadSummaryDto[]>([]);
const subagentPanelOpen = ref(false);

const loadingThread = ref(false);
const previousSelectedFilePath = ref<string | null>(props.selectedFilePath || null);
const fileChangedSinceLastSend = ref(false);
const selectionVersion = ref(0);

const threadDialogOpen = ref(false);
const threadActionId = ref<string | null>(null);
const runAbortController = ref<AbortController | null>(null);
const runStreamThreadId = ref<string | null>(null);
let streamReadyPromise: Promise<void> | null = null;
const editingMessageId = ref<string | null>(null);
const messageActionId = ref<string | null>(null);
const selectableModels = ref<ModelSettingsDto["enabledModels"]>([]);
const threadModelMode = ref<"default" | "override">("default");
const threadModelDraft = ref<ThreadModelDraft>({
    modelKey: null,
    temperature: "",
    topK: "",
    reasoningEffort: null,
    stream: true,
});
const threadModelPopoverOpen = ref(false);
const threadModelSaving = ref(false);
const submittingUserInput = ref(false);
const userInputSelectedAnswers = ref<Record<string, number[]>>({});
const userInputNotes = ref<Record<string, string>>({});

const sanitizeHtml = ref<((html: string) => string) | null>(null);
const session = useAgentThreadSession();
const messages = session.messages;
const running = session.running;
const treeIndex = session.treeIndex;
const pendingUserInputSession = session.pendingUserInputSession;
const {confirm} = useDialog();
const notification = useNotification();

const planModeActive = computed(() => activeThread.value?.planMode.active ?? false);

provide("sanitizeHtml", sanitizeHtml);

/**
 * 当前挂起问题是否都已填写完成。
 */
const canSubmitPendingUserInput = computed(() => {
    if (!pendingUserInputSession.value) {
        return false;
    }
    return pendingUserInputSession.value.questions.every((question) => {
        const key = `${question.toolNodeId}\n${question.questionIndex}`;
        return question.options.length === 0
            ? Boolean(userInputNotes.value[key]?.trim())
            : Boolean(userInputSelectedAnswers.value[key]?.length);
    });
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

const ideStore = useNovelIdeStore();
const {
    selectedStoryThreadId,
    selectedStorySceneId,
} = storeToRefs(ideStore);

const threadTokenStats = computed(() => activeThread.value?.tokenStats ?? null);

const contextUsageCompactLabel = computed(() => {
    const lastRun = threadTokenStats.value?.lastRun;
    const contextWindowTokens = threadTokenStats.value?.contextWindowTokens ?? null;
    return `${formatCompactTokenCount(lastRun?.inputTokens)} / ${formatCompactTokenCount(contextWindowTokens)}`;
});

const contextUsageExactLabel = computed(() => {
    const lastRun = threadTokenStats.value?.lastRun;
    const contextWindowTokens = threadTokenStats.value?.contextWindowTokens ?? null;
    return `${formatTokenCount(lastRun?.inputTokens)} / ${formatTokenCount(contextWindowTokens)}`;
});

const contextPercentCompactLabel = computed(() => {
    const percent = threadTokenStats.value?.lastRunContextPercent;
    if (typeof percent !== "number" || !Number.isFinite(percent)) {
        return "";
    }
    return `${percent.toFixed(1)}%`;
});

const cumulativeInputCompactLabel = computed(() => {
    return formatCompactTokenCount(threadTokenStats.value?.cumulative?.inputTokens);
});

const cumulativeOutputCompactLabel = computed(() => {
    return formatCompactTokenCount(threadTokenStats.value?.cumulative?.outputTokens);
});

const cumulativeCacheCompactLabel = computed(() => {
    return formatCompactTokenCount(threadTokenStats.value?.cumulative?.cacheReadTokens);
});

const cumulativeCacheWriteCompactLabel = computed(() => {
    const cacheCreationTokens = threadTokenStats.value?.cumulative?.cacheCreationTokens;
    if (typeof cacheCreationTokens !== "number" || cacheCreationTokens <= 0) {
        return "";
    }
    return formatCompactTokenCount(cacheCreationTokens);
});

const cumulativeUsageExactLabel = computed(() => {
    const cumulative = threadTokenStats.value?.cumulative;
    if (!cumulative) {
        return "输入 -- / 输出 -- / 缓存 --";
    }

    const cacheMiss = typeof cumulative.cacheMissTokens === "number" && cumulative.cacheMissTokens > 0
        ? ` / 未命中 ${formatTokenCount(cumulative.cacheMissTokens)}`
        : "";
    const cacheWrite = typeof cumulative.cacheCreationTokens === "number" && cumulative.cacheCreationTokens > 0
        ? ` / 写入 ${formatTokenCount(cumulative.cacheCreationTokens)}`
        : "";

    return `输入 ${formatTokenCount(cumulative.inputTokens)} / 输出 ${formatTokenCount(cumulative.outputTokens)} / 缓存 ${formatTokenCount(cumulative.cacheReadTokens)}${cacheMiss}${cacheWrite}`;
});
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

const plotMutationToolNames = new Set([
    "create_story_thread",
    "update_story_thread",
    "create_story_scene",
    "update_story_scene",
    "create_story_plot",
    "update_story_plot",
]);

/**
 * 组装 Client Variables。
 */
const buildClientVariables = (): ClientVariablesDto => {
    const isUserAssetsWorkspace = ideStore.workspaceKind === "user-assets";
    return buildNovelIdeClientVariables({
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

const agentApi = useAgentApi({getClientVariables: buildClientVariables});

const leaderProfileKey = computed<"leader.default" | "leader.assets">(() => {
    return ideStore.workspaceKind === "user-assets" ? "leader.assets" : "leader.default";
});

/**
 * 读取可选模型列表。
 */
const loadSelectableModels = async (): Promise<void> => {
    try {
        const settings = await $fetch<ModelSettingsDto>("/api/settings/models");
        selectableModels.value = settings.enabledModels;
    } catch (error) {
        console.error("读取模型列表失败", error);
        selectableModels.value = [];
    }
};

/**
 * 将数字配置转成输入框文本。
 */
function stringifyNullableNumber(value: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * 将输入框文本解析为可空数字。
 */
function parseNullableNumber(value: string, integerOnly = false): number | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return integerOnly ? Math.trunc(parsed) : parsed;
}

/**
 * 从线程模型配置构造本地草稿。
 */
function createThreadModelDraft(config: AgentThreadModelConfigDto | null): ThreadModelDraft {
    return {
        modelKey: config?.modelKey ?? null,
        temperature: stringifyNullableNumber(config?.temperature ?? null),
        topK: stringifyNullableNumber(config?.topK ?? null),
        reasoningEffort: config?.reasoningEffort ?? null,
        stream: config?.stream ?? true,
    };
}

/**
 * 从线程摘要同步当前模型状态。
 */
function syncThreadModelState(summary: AgentThreadSummaryDto | null): void {
    threadModelMode.value = summary?.modelOverride ? "override" : "default";
    threadModelDraft.value = createThreadModelDraft(summary?.modelOverride ?? summary?.effectiveModel ?? null);
}

/**
 * 基于当前草稿构造线程模型覆盖配置。
 */
function buildThreadModelOverrideConfig(): CreateAgentThreadRequestDto["modelOverride"] | null {
    if (!threadModelDraft.value.modelKey) {
        return null;
    }

    return {
        modelKey: threadModelDraft.value.modelKey,
        temperature: parseNullableNumber(threadModelDraft.value.temperature),
        topK: parseNullableNumber(threadModelDraft.value.topK, true),
        reasoningEffort: threadModelDraft.value.reasoningEffort,
        stream: threadModelDraft.value.stream,
    };
}

/**
 * 同步本地线程摘要缓存。
 */
const patchThreadSummary = (summary: AgentThreadSummaryDto): void => {
    const exists = threads.value.some((thread) => thread.id === summary.id);
    threads.value = exists
        ? threads.value.map((thread) => thread.id === summary.id ? summary : thread)
        : [summary, ...threads.value];
    if (activeThreadId.value === summary.id) {
        activeThread.value = summary;
        syncThreadModelState(summary);
    }
};

/**
 * 当挂起提问 session 变化时，重置本地答案草稿。
 */
watch(() => pendingUserInputSession.value?.assistantMessageId ?? null, () => {
    userInputSelectedAnswers.value = {};
    userInputNotes.value = {};
}, {immediate: true});

const activeThreadTitle = computed(() => activeThread.value?.title || activeThreadId.value.slice(0, 8) || "未命名对话");
const threadModelDefaultLabel = computed(() => {
    const effectiveLabel = activeThread.value?.effectiveModel?.modelLabel?.trim()
        || activeThread.value?.effectiveModelLabel?.trim()
        || "";
    return effectiveLabel ? `跟随默认 (${effectiveLabel})` : "跟随默认";
});
const threadModelSelectionValue = computed(() => threadModelMode.value === "override" ? threadModelDraft.value.modelKey : null);

const activeDrawerTitle = computed(() => {
    if (activeThread.value?.kind === "subagent") {
        return `协作节点：${profileLabel(activeThread.value.profileKey)}`;
    }
    return "AI 写作助手";
});

const drawerIconClass = computed(() => (
    activeThread.value?.kind === "subagent"
        ? "i-lucide-bot text-[var(--accent-text)]"
        : "i-lucide-sparkles text-[var(--accent-text)]"
));

const renderNodes = computed(() => messages.value);
const messageActionsDisabled = computed(() => running.value || Boolean(messageActionId.value));
const activeCursorRole = computed(() => resolveActiveCursorRole(treeIndex.value));
const canContinueWithoutInput = computed(() => {
    return !running.value && !inputText.value.trim() && activeCursorRole.value !== null && activeCursorRole.value !== "assistant";
});

type BranchSwitcherState = {
    nodeIds: string[];
    currentIndex: number;
    total: number;
};

const branchSwitcherStateByMessageId = computed<Record<string, BranchSwitcherState>>(() => {
    const result: Record<string, BranchSwitcherState> = {};
    if (!treeIndex.value) {
        return result;
    }
    for (const message of messages.value) {
        const switcher = resolveMessageSwitcher(treeIndex.value, message.id);
        if (switcher) {
            result[message.id] = switcher;
        }
    }
    return result;
});

/**
 * profile 文案。
 */
function profileLabel(profileKey: string | undefined): string {
    switch (profileKey) {
        case "subagent.writer": return "写手节点 (Drafter)";
        case "subagent.retrieval": return "内容节点召回 (Retrieval)";
        case "leader.default": return "主线调度";
        case "leader.assets": return "用户资产助手";
        default: return profileKey ?? "未知节点";
    }
}

/**
 * 构造新线程的模型创建参数。
 */
function buildCreateThreadPayload(): CreateAgentThreadRequestDto {
    const modelOverride = threadModelMode.value === "override" ? buildThreadModelOverrideConfig() : null;
    return {
        profileKey: leaderProfileKey.value,
        ...(modelOverride ? {modelOverride} : {}),
    };
}

/**
 * 初始化或获取有效线程。
 */
const ensureThreadReady = async (forceNew = false): Promise<void> => {
    if (!props.isOpen && !forceNew) {
        return;
    }
    if (activeThreadId.value && !forceNew) {
        return;
    }
    try {
        const threadsList = await agentApi.listThreads("leader", leaderProfileKey.value);
        threads.value = threadsList;

        const firstThreadId = threadsList[0]?.id;
        if (firstThreadId && !forceNew) {
            await loadThread(firstThreadId);
        } else {
            const created = await agentApi.createThread(buildCreateThreadPayload());
            await loadThread(created.id);
        }
    } catch (error) {
        console.error("Agent 线程初始化失败", error);
    }
};

/**
 * 刷新线程列表。
 */
const refreshThreads = async (): Promise<AgentThreadSummaryDto[]> => {
    try {
        const response = await agentApi.listThreads("leader", leaderProfileKey.value);
        threads.value = response;
        if (activeThreadId.value) {
            const nextActiveThread = response.find((thread) => thread.id === activeThreadId.value) ?? null;
            if (nextActiveThread) {
                activeThread.value = nextActiveThread;
            } else {
                activeThreadId.value = "";
                activeThread.value = null;
                session.reset();
                syncThreadModelState(null);
            }
        }
        return threads.value;
    } catch (error) {
        console.error("刷新线程列表失败", error);
        return [];
    }
};

/**
 * 刷新 subagent 列表。
 */
const refreshSubagents = async (): Promise<void> => {
    if (!activeThreadId.value) {
        return;
    }
    try {
        subagents.value = await agentApi.listThreadSubagents(activeThreadId.value);
    } catch (error) {
        console.error("获取 Subagents 失败", error);
    }
};

/**
 * 切换到指定线程，并拉取历史。
 */
const loadThread = async (threadId: string): Promise<void> => {
    runAbortController.value?.abort();
    runStreamThreadId.value = null;
    activeThreadId.value = threadId;
    session.reset();
    activeThread.value = null;
    syncThreadModelState(null);
    subagents.value = [];
    leaders.value = [];
    subagentPanelOpen.value = false;
    editingMessageId.value = null;
    messageActionId.value = null;

    try {
        void subscribeThreadStream(threadId);
        const detail: AgentThreadDetailDto = await agentApi.getThreadDetail(threadId);
        activeThread.value = detail.thread;
        syncThreadModelState(detail.thread);
        subagents.value = detail.subagents || [];
        leaders.value = (detail as AgentThreadDetailDto & {leaders?: AgentThreadSummaryDto[]}).leaders || [];
        session.applyConversationTree(detail.conversationTree);
        session.setPendingUserInputSession(detail.pendingUserInputSession);
        fileChangedSinceLastSend.value = false;
        await nextTick();
        scrollToBottom();
    } catch (error) {
        console.error(`加载线程 ${threadId} 失败`, error);
    }
};

/**
 * 从服务端重新同步当前线程详情。
 */
const syncActiveThreadDetail = async (): Promise<void> => {
    if (!activeThreadId.value) {
        return;
    }
    const detail: AgentThreadDetailDto = await agentApi.getThreadDetail(activeThreadId.value);
    activeThread.value = detail.thread;
    patchThreadSummary(detail.thread);
    subagents.value = detail.subagents || [];
    leaders.value = (detail as AgentThreadDetailDto & {leaders?: AgentThreadSummaryDto[]}).leaders || [];
    session.applyConversationTree(detail.conversationTree);
    session.setPendingUserInputSession(detail.pendingUserInputSession);
};

/**
 * 委托 AgentChatFlow 滚动到底部。
 */
const scrollToBottom = (): void => {
    chatFlowRef.value?.scrollToBottom();
};

/**
 * 处理 Agent SSE 事件。
 */
const handleAgentEvent = (payload: AgentStreamEventDto): void => {
    session.applyEvent(payload);

    if (payload.type === "thread_snapshot") {
        activeThread.value = payload.thread;
        syncThreadModelState(payload.thread);
        patchThreadSummary(payload.thread);
        subagents.value = payload.subagents;
        leaders.value = payload.leaders;
        return;
    }

    if (payload.type === "run_state" && ["completed", "stopped", "failed"].includes(payload.status)) {
        fileChangedSinceLastSend.value = false;
        return;
    }

    if (payload.type !== "tool_finished") {
        return;
    }

    if (payload.toolCall.toolName === "invoke_subagent") {
        void refreshSubagents();
    }

    if (
        payload.status === "success"
        && plotMutationToolNames.has(payload.toolCall.toolName)
    ) {
        emit("sync-workspace", {
            kind: "plot_tree",
            toolName: payload.toolCall.toolName,
            toolCallId: payload.toolCall.toolCallId ?? payload.toolCall.toolNodeId,
        });
    }

};

/**
 * 订阅线程流。
 */
const subscribeThreadStream = async (threadId: string): Promise<void> => {
    if (runAbortController.value && runStreamThreadId.value === threadId) {
        await streamReadyPromise;
        return;
    }

    runAbortController.value?.abort();
    const controller = new AbortController();
    runAbortController.value = controller;
    runStreamThreadId.value = threadId;
    let resolveStreamReady: () => void = () => {};
    let rejectStreamReady: (error: unknown) => void = () => {};
    const readyPromise = new Promise<void>((resolve, reject) => {
        resolveStreamReady = resolve;
        rejectStreamReady = reject;
    });
    streamReadyPromise = readyPromise;
    void readyPromise.catch(() => {});

    try {
        await agentApi.subscribeThreadStream(threadId, (event) => {
            if (threadId !== activeThreadId.value) {
                return;
            }
            handleAgentEvent(event);
        }, controller.signal, {
            onOpen: resolveStreamReady,
        });
    } catch (error) {
        rejectStreamReady(error);
        if (threadId === activeThreadId.value && !(error instanceof DOMException && error.name === "AbortError")) {
            running.value = false;
            handleAgentEvent({
                type: "run_state",
                threadId,
                status: "failed",
                error: error instanceof Error ? error.message : "Agent 请求失败",
            });
        }
    } finally {
        if (runAbortController.value === controller) {
            runAbortController.value = null;
            runStreamThreadId.value = null;
            streamReadyPromise = null;
        }
    }
};

/**
 * 发送或继续前确保当前线程 SSE 处于连接状态。
 */
const ensureActiveThreadStream = async (): Promise<void> => {
    if (!activeThreadId.value) {
        return;
    }
    if (runAbortController.value) {
        if (runStreamThreadId.value === activeThreadId.value) {
            await streamReadyPromise;
            return;
        }
        runAbortController.value.abort();
        runStreamThreadId.value = null;
    }
    void subscribeThreadStream(activeThreadId.value);
    await streamReadyPromise;
};

/**
 * 派发一次 continue，不追加新的用户消息。
 */
const dispatchContinueThreadRun = async (threadId: string): Promise<void> => {
    scrollToBottom();
    await ensureActiveThreadStream();
    await agentApi.invokeThread(
        threadId,
        agentApi.createContinueDispatchBody(),
    );
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
    if (!activeThreadId.value) {
        return;
    }
    try {
        submittingUserInput.value = true;
        await ensureActiveThreadStream();
        await agentApi.submitUserInputAnswers(activeThreadId.value, payload);
        await syncActiveThreadDetail();
    } catch (error) {
        console.error("提交问题答案失败", error);
        await syncActiveThreadDetail();
        notification.error(error instanceof Error ? error.message : "提交问题答案失败");
        throw error;
    } finally {
        submittingUserInput.value = false;
      }
  };

/**
 * 提交当前挂起中的整组结构化答案。
 */
const submitPendingUserInputAnswers = (): void => {
    if (!pendingUserInputSession.value || submittingUserInput.value || !canSubmitPendingUserInput.value) {
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
    submitting: submittingUserInput,
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
    if (!activeThreadId.value || !running.value) {
        return;
    }
    try {
        await agentApi.abortThreadRun(activeThreadId.value);
        await syncActiveThreadDetail();
    } catch (error) {
        console.error("停止 Agent 运行失败", error);
    }
};

/**
 * 切换当前线程软 Plan Mode。
 */
const setPlanMode = async (active: boolean): Promise<void> => {
    if (running.value) {
        return;
    }
    if (!active && !activeThreadId.value) {
        return;
    }
    await ensureThreadReady();
    if (!activeThreadId.value) {
        return;
    }
    await agentApi.updateThreadPlanMode(activeThreadId.value, {active});
    await syncActiveThreadDetail();
};

/**
 * 快捷键切换 Plan Mode。
 */
const togglePlanMode = async (): Promise<void> => {
    await setPlanMode(!planModeActive.value);
};

/**
 * 发送输入内容。
 */
const send = async (): Promise<void> => {
    const message = inputText.value.trim();
    if (running.value) {
        return;
    }
    if (pendingUserInputSession.value) {
        return;
    }

    if (message && (message === "/new" || message === "/clear")) {
        await ensureThreadReady(true);
        resetInput();
        return;
    }

    if (message && message === "/settings") {
        resetInput();
        return;
    }

    if (message === "/plan" || message.startsWith("/plan ")) {
        const planPrompt = message.slice("/plan".length).trim();
        resetInput();
        if (planPrompt === "off") {
            await setPlanMode(false);
            return;
        }
        await setPlanMode(true);
        if (!planPrompt || !activeThreadId.value) {
            return;
        }
        await ensureActiveThreadStream();
        const result = await agentApi.createMessage(activeThreadId.value, {
            content: planPrompt,
        });
        session.applyConversationTree(result.conversationTree);
        await dispatchContinueThreadRun(activeThreadId.value);
        return;
    }

    await ensureThreadReady();
    if (!activeThreadId.value) {
        return;
    }

    if (!message) {
        if (canContinueWithoutInput.value) {
            await dispatchContinueThreadRun(activeThreadId.value);
        }
        return;
    }

    const prompt = inputText.value;
    resetInput();
    await ensureActiveThreadStream();
    const result = await agentApi.createMessage(activeThreadId.value, {
        content: prompt,
    });
    session.applyConversationTree(result.conversationTree);
    await dispatchContinueThreadRun(activeThreadId.value);
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

/**
 * 进入消息编辑态。
 */
const startEditingMessage = (message: AgentMessage): void => {
    if (messageActionsDisabled.value) {
        return;
    }
    editingMessageId.value = message.id;
};

/**
 * 取消消息编辑态。
 */
const cancelEditingMessage = (): void => {
    editingMessageId.value = null;
};

/**
 * 激活指定 continuation 节点。
 */
const activateMessage = async (messageId: string): Promise<void> => {
    if (!activeThreadId.value || messageActionId.value || running.value) {
        return;
    }

    messageActionId.value = messageId;
    try {
        const result = await agentApi.activateMessage(activeThreadId.value, messageId);
        session.applyConversationTree(result.conversationTree);
        editingMessageId.value = null;
    } catch (error) {
        console.error("切换 continuation 失败", error);
        notification.error(error instanceof Error ? error.message : "切换 continuation 失败");
    } finally {
        messageActionId.value = null;
    }
};

/**
 * 更新当前线程的模型覆盖。
 */
const updateThreadModelSelection = async (modelKey: string | null): Promise<void> => {
    if (modelKey === null) {
        threadModelMode.value = "default";
        if (activeThread.value?.effectiveModel) {
            threadModelDraft.value = createThreadModelDraft(activeThread.value.effectiveModel);
        }
    } else {
        threadModelMode.value = "override";
        threadModelDraft.value = {
            ...threadModelDraft.value,
            modelKey,
        };
    }

    if (!activeThreadId.value || running.value || threadModelSaving.value) {
        return;
    }

    threadModelSaving.value = true;
    try {
        const summary = modelKey === null
            ? await agentApi.updateThreadModel(activeThreadId.value, {
                mode: "default",
            })
            : await agentApi.updateThreadModel(activeThreadId.value, {
                mode: "override",
                config: buildThreadModelOverrideConfig() ?? {
                    modelKey,
                    temperature: null,
                    topK: null,
                    reasoningEffort: null,
                    stream: true,
                },
            });
        patchThreadSummary(summary);
    } catch (error) {
        console.error("更新线程模型失败", error);
        notification.error(error instanceof Error ? error.message : "更新线程模型失败");
        syncThreadModelState(activeThread.value);
    } finally {
        threadModelSaving.value = false;
    }
};

/**
 * 打开当前线程模型参数弹层。
 */
function toggleThreadModelPopover(): void {
    if (threadModelPopoverOpen.value) {
        threadModelPopoverOpen.value = false;
        return;
    }

    if (activeThread.value) {
        syncThreadModelState(activeThread.value);
    }
    threadModelPopoverOpen.value = true;
}

/**
 * 应用当前线程模型参数覆盖。
 */
async function applyThreadModelSettings(): Promise<void> {
    if (!threadModelDraft.value.modelKey) {
        notification.error("请先选择一个线程模型");
        return;
    }

    threadModelMode.value = "override";

    if (!activeThreadId.value || running.value || threadModelSaving.value) {
        threadModelPopoverOpen.value = false;
        return;
    }

    threadModelSaving.value = true;
    try {
        const summary = await agentApi.updateThreadModel(activeThreadId.value, {
            mode: "override",
            config: buildThreadModelOverrideConfig() ?? {
                modelKey: threadModelDraft.value.modelKey,
                temperature: null,
                topK: null,
                reasoningEffort: threadModelDraft.value.reasoningEffort,
                stream: threadModelDraft.value.stream,
            },
        });
        patchThreadSummary(summary);
        threadModelPopoverOpen.value = false;
    } catch (error) {
        console.error("更新线程模型参数失败", error);
        notification.error(error instanceof Error ? error.message : "更新线程模型参数失败");
        syncThreadModelState(activeThread.value);
    } finally {
        threadModelSaving.value = false;
    }
}

/**
 * 回到 Profile 默认模型参数。
 */
async function resetThreadModelSettings(): Promise<void> {
    threadModelMode.value = "default";
    if (activeThread.value?.effectiveModel) {
        threadModelDraft.value = createThreadModelDraft(activeThread.value.effectiveModel);
    }

    if (!activeThreadId.value || running.value || threadModelSaving.value) {
        threadModelPopoverOpen.value = false;
        return;
    }

    threadModelSaving.value = true;
    try {
        const summary = await agentApi.updateThreadModel(activeThreadId.value, {
            mode: "default",
        });
        patchThreadSummary(summary);
        threadModelPopoverOpen.value = false;
    } catch (error) {
        console.error("重置线程模型参数失败", error);
        notification.error(error instanceof Error ? error.message : "重置线程模型参数失败");
        syncThreadModelState(activeThread.value);
    } finally {
        threadModelSaving.value = false;
    }
}

/**
 * 沿当前消息的 continuation 组切换分支。
 */
const cycleMessageBranch = async (messageId: string, direction: -1 | 1): Promise<void> => {
    const switcher = branchSwitcherStateByMessageId.value[messageId];
    if (!switcher) {
        return;
    }
    const nextIndex = (switcher.currentIndex + direction + switcher.total) % switcher.total;
    const nextNodeId = switcher.nodeIds[nextIndex];
    if (!nextNodeId) {
        return;
    }
    await activateMessage(nextNodeId);
};

/**
 * 保存消息改写。
 */
const saveEditedMessage = async (payload: {message: AgentMessage; content: string}): Promise<void> => {
    if (!activeThreadId.value || messageActionId.value || running.value) {
        return;
    }

    messageActionId.value = payload.message.id;
    try {
        await ensureActiveThreadStream();
        const result = await agentApi.updateMessage(activeThreadId.value, payload.message.id, {
            content: payload.content,
        });
        session.applyConversationTree(result.conversationTree);
        editingMessageId.value = null;
        notification.success("消息已更新");
        if (payload.message.type === "user") {
            await dispatchContinueThreadRun(activeThreadId.value);
        }
    } catch (error) {
        console.error("改写消息失败", error);
        notification.error(error instanceof Error ? error.message : "改写消息失败");
    } finally {
        messageActionId.value = null;
    }
};

/**
 * 基于指定消息触发刷新。
 */
const refreshMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeThreadId.value || messageActionId.value || running.value) {
        return;
    }

    messageActionId.value = message.id;
    try {
        await ensureActiveThreadStream();
        const result = await agentApi.refreshMessage(activeThreadId.value, message.id);
        session.applyConversationTree(result.conversationTree);
        editingMessageId.value = null;
        await dispatchContinueThreadRun(activeThreadId.value);
    } catch (error) {
        console.error("刷新消息失败", error);
        notification.error(error instanceof Error ? error.message : "刷新消息失败");
    } finally {
        messageActionId.value = null;
    }
};

/**
 * 回退到指定消息，并丢弃它之后的当前历史。
 */
const rollbackMessage = async (message: AgentMessage): Promise<void> => {
    if (!activeThreadId.value || messageActionId.value || running.value) {
        return;
    }

    const confirmed = await confirm("确定要回退到这条消息，并丢弃它之后的全部历史吗？", "回退消息");
    if (!confirmed) {
        return;
    }

    messageActionId.value = message.id;
    try {
        const result = await agentApi.rollbackMessage(activeThreadId.value, message.id);
        session.applyConversationTree(result.conversationTree);
        editingMessageId.value = null;
        notification.success("消息已回退");
    } catch (error) {
        console.error("回退消息失败", error);
        notification.error(error instanceof Error ? error.message : "回退消息失败");
    } finally {
        messageActionId.value = null;
    }
};

/**
 * 创建 subagent。
 */
const handleCreateSubagent = async (profileKey: "subagent.writer" | "subagent.retrieval", title?: string): Promise<void> => {
    if (!activeThreadId.value) {
        return;
    }
    await agentApi.createThreadSubagent(activeThreadId.value, {profileKey, title});
    await refreshSubagents();
};

/**
 * 绑定已有 subagent。
 */
const handleAttachSubagent = async (subagentThreadId: string): Promise<void> => {
    if (!activeThreadId.value) {
        return;
    }
    await agentApi.attachThreadSubagent(activeThreadId.value, {subagentThreadId});
    await refreshSubagents();
};

/**
 * 打开线程列表对话框。
 */
const openThreadDialog = async (): Promise<void> => {
    await ensureThreadReady();
    await refreshThreads();
    threadDialogOpen.value = true;
};

/**
 * 选择线程。
 */
const selectThread = async (threadId: string): Promise<void> => {
    if (loadingThread.value || threadActionId.value) {
        return;
    }
    if (threadId === activeThreadId.value) {
        threadDialogOpen.value = false;
        return;
    }
    loadingThread.value = true;
    try {
        await loadThread(threadId);
        threadDialogOpen.value = false;
    } finally {
        loadingThread.value = false;
    }
};

/**
 * 从弹窗创建线程。
 */
const createThreadFromDialog = async (): Promise<void> => {
    if (loadingThread.value || threadActionId.value) {
        return;
    }
    loadingThread.value = true;
    try {
        const created = await agentApi.createThread({
            ...buildCreateThreadPayload(),
        });
        await refreshThreads();
        await loadThread(created.id);
        threadDialogOpen.value = false;
    } finally {
        loadingThread.value = false;
    }
};

/**
 * 从弹窗删除线程。
 */
const deleteThreadFromDialog = async (thread: AgentThreadSummaryDto): Promise<void> => {
    if (thread.status === "running" || thread.status === "waiting_user" || loadingThread.value || threadActionId.value) {
        return;
    }
    threadActionId.value = thread.id;
    try {
        await agentApi.deleteThread(thread.id);
        const nextThreads = await refreshThreads();
        if (thread.id !== activeThreadId.value) {
            return;
        }
        if (nextThreads[0]?.id) {
            await loadThread(nextThreads[0].id);
            return;
        }
        await ensureThreadReady(true);
    } finally {
        threadActionId.value = null;
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
        threadDialogOpen.value = false;
        subagentPanelOpen.value = false;
        threadModelPopoverOpen.value = false;
        editingMessageId.value = null;
        messageActionId.value = null;
        runAbortController.value?.abort();
        runStreamThreadId.value = null;
        return;
    }

    await loadSelectableModels();
    await ensureThreadReady();
    await refreshThreads();
    await nextTick();
    requestAnimationFrame(() => {
        inputRef.value?.focus();
        scrollToBottom();
    });
});

watch(leaderProfileKey, async () => {
    runAbortController.value?.abort();
    runStreamThreadId.value = null;
    activeThreadId.value = "";
    activeThread.value = null;
    threads.value = [];
    subagents.value = [];
    leaders.value = [];
    subagentPanelOpen.value = false;
    session.reset();
    syncThreadModelState(null);
    if (!props.isOpen) {
        return;
    }
    await ensureThreadReady();
    await refreshThreads();
});

onBeforeUnmount(() => {
    runAbortController.value?.abort();
    runStreamThreadId.value = null;
});

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            return;
        }
        await loadSelectableModels();
        const {default: createDOMPurify} = await import("dompurify");
        const purifier = createDOMPurify(window);
        sanitizeHtml.value = (html) => purifier.sanitize(html) as string;
    })();
});
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
                        <div class="truncate text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ activeThreadTitle }}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="新建对话" :disabled="loadingThread" @click="void ensureThreadReady(true)">
                        <span class="i-lucide-plus h-4 w-4"></span>
                    </button>
                    <button class="flex items-center gap-1.5 rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="{'bg-[var(--bg-hover)] text-[var(--accent-main)]': subagentPanelOpen}" title="Subagents 管理" @click="subagentPanelOpen = !subagentPanelOpen">
                        <span class="i-lucide-users h-4 w-4"></span>
                        <span v-if="subagents.length" class="rounded-sm bg-[var(--accent-main)] px-1 text-[9px] font-bold text-white">{{ subagents.length }}</span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="线程列表" @click="void openThreadDialog()">
                        <span class="i-lucide-messages-square h-4 w-4"></span>
                    </button>
                    <button class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <!-- Subagents 面板 -->
            <AgentSubagentPanel
                v-if="subagentPanelOpen"
                :thread-id="activeThreadId"
                :active-thread-kind="activeThread?.kind ?? 'leader'"
                :subagents="subagents"
                :leaders="leaders"
                :loading="loadingThread"
                @create="handleCreateSubagent"
                @attach="handleAttachSubagent"
                @select="void loadThread($event); subagentPanelOpen = false"
                @refresh="refreshSubagents"
                @close="subagentPanelOpen = false"
            />

            <!-- 消息序列 -->
            <AgentChatFlow
                ref="chatFlowRef"
                :messages="renderNodes"
                :running="running"
                mode="leader"
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
                v-model:thread-model-popover-open="threadModelPopoverOpen"
                v-model:thread-model-draft="threadModelDraft"
                :pending-session="pendingUserInputSession"
                :submitting-user-input="submittingUserInput"
                :running="running"
                :loading-thread="loadingThread"
                :thread-model-saving="threadModelSaving"
                :thread-model-selection-value="threadModelSelectionValue"
                :thread-model-default-label="threadModelDefaultLabel"
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
                @toggle-thread-model-popover="toggleThreadModelPopover"
                @update-thread-model-selection="void updateThreadModelSelection($event)"
                @apply-thread-model-settings="void applyThreadModelSettings()"
                @reset-thread-model-settings="void resetThreadModelSettings()"
            />

            <!-- 线程管理弹窗 -->
            <AgentThreadDialog
                v-model="threadDialogOpen"
                :threads="threads"
                :active-thread-id="activeThreadId"
                :loading="loadingThread"
                :running="running"
                :action-id="threadActionId"
                @select="void selectThread($event)"
                @create="void createThreadFromDialog()"
                @delete="void deleteThreadFromDialog($event)"
            />
        </template>
    </aside>
</template>
