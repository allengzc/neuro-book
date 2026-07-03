<script setup lang="ts">
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentComposerInput from "nbook/app/components/novel-ide/agent/AgentComposerInput.vue";
import AgentSessionModelControls from "nbook/app/components/novel-ide/agent/AgentSessionModelControls.vue";
import AgentUserInputPrompt from "nbook/app/components/novel-ide/agent/AgentUserInputPrompt.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {ModelSettingsDto} from "nbook/shared/dto/app-settings.dto";
import type {AgentQueuedMessageDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    inputText: string;
    pendingSession: AgentPendingUserInputSession | null;
    selectedAnswers: Record<string, number[]>;
    notes: Record<string, string>;
    submittingUserInput: boolean;
    running: boolean;
    readonly?: boolean;
    readonlyReason?: string;
    loadingSession: boolean;
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: ModelSettingsDto["enabledModels"];
    planModeActive: boolean;
    canContinueWithoutInput: boolean;
    contextUsageExactLabel: string;
    contextUsageCompactLabel: string;
    contextPercentCompactLabel: string;
    cumulativeUsageExactLabel: string;
    cumulativeInputCompactLabel: string;
    cumulativeOutputCompactLabel: string;
    cumulativeCacheCompactLabel: string;
    cumulativeCacheWriteCompactLabel: string;
    cumulativeCacheHitRateLabel: string;
    cumulativeCostCompactLabel: string;
    connectionStatusLabel: string;
    runPhaseLabel: string;
    connectionNeedsAction: boolean;
    queuedMessages: AgentQueuedMessageDto[];
    menuRefreshKey: string | number;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "update:inputText", value: string): void;
    (e: "update:selectedAnswers", value: Record<string, number[]>): void;
    (e: "update:notes", value: Record<string, string>): void;
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "submit-user-input", payload: {
        assistantMessageId: string;
        resume?: boolean;
        answers: Array<{
            toolNodeId: string;
            questionIndex?: number;
            selectedOptionIndex?: number;
            note?: string;
            ignored?: boolean;
        }>;
    }): void;
    /** Task 63: Low-Code Form 提交事件 */
    (e: "submit-user-input-form", payload: {
        assistantMessageId: string;
        toolCallId: string;
        data: import("nbook/shared/dto/low-code-form.dto").LowCodeJsonObject;
    }): void;
    (e: "cancel-user-input", payload: {assistantMessageId: string}): void;
    (e: "send"): void;
    (e: "steer"): void;
    (e: "followup"): void;
    (e: "stop"): void;
    (e: "toggle-plan-mode"): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
    (e: "reconnect-events"): void;
    (e: "refresh-history"): void;
}>();

const inputRef = ref<InstanceType<typeof AgentComposerInput> | null>(null);
const userInputPromptRef = ref<InstanceType<typeof AgentUserInputPrompt> | null>(null);
const {t} = useI18n();
const activeQuestionKey = ref("");
const composerExpanded = ref(false);
const activeQuestionState = ref({
    canContinue: false,
    submitButtonLabel: t("agent.composer.continue"),
});

const activeComposerValue = computed(() => {
    if (!props.pendingSession || !activeQuestionKey.value) {
        return props.inputText;
    }
    return props.notes[activeQuestionKey.value] ?? "";
});

const composerPlaceholder = computed(() => props.pendingSession
    ? t("agent.composer.pendingPlaceholder")
    : t("agent.composer.messagePlaceholder"));

const runInputText = computed(() => props.inputText);
const canStopReadonlyRun = computed(() => props.readonly && props.running && !runInputText.value.trim());

const sendDisabled = computed(() => {
    if (props.readonly) {
        return !canStopReadonlyRun.value;
    }
    if (props.pendingSession) {
        return props.submittingUserInput || !activeQuestionState.value.canContinue;
    }
    if (props.running) {
        return false;
    }
    return !props.inputText.trim() && !props.canContinueWithoutInput;
});

const sendIconClass = computed(() => {
    if (props.pendingSession && props.submittingUserInput) {
        return "i-lucide-loader-2 animate-spin";
    }
    if (props.pendingSession) {
        return "i-lucide-corner-down-left";
    }
    if (props.running && !runInputText.value.trim()) {
        return "i-lucide-square";
    }
    if (props.running) {
        return "i-lucide-corner-down-left";
    }
    if (props.canContinueWithoutInput) {
        return "i-lucide-chevrons-right";
    }
    return "i-lucide-send";
});

const sendButtonTitle = computed(() => {
    if (canStopReadonlyRun.value) {
        return t("agent.composer.stop");
    }
    if (props.readonly) {
        return props.readonlyReason || t("agent.composer.readonly");
    }
    if (props.pendingSession) {
        return activeQuestionState.value.submitButtonLabel || t("agent.composer.continue");
    }
    if (props.running && runInputText.value.trim()) {
        return composerExpanded.value ? t("agent.composer.steerQueueExpanded") : t("agent.composer.steerQueue");
    }
    if (props.running) {
        return t("agent.composer.stop");
    }
    if (props.canContinueWithoutInput) {
        return t("agent.composer.continue");
    }
    return t("agent.composer.send");
});

const expandButtonTitle = computed(() => composerExpanded.value ? t("agent.composer.collapseEditor") : t("agent.composer.expandEditor"));
const expandButtonIcon = computed(() => composerExpanded.value ? "i-lucide-minimize-2" : "i-lucide-maximize-2");

const queuedMessageText = (item: AgentQueuedMessageDto): string => {
    const text = item.message?.text.trim();
    if (text) {
        return text;
    }
    return item.input === undefined ? "" : JSON.stringify(item.input);
};

const queuedMessageIcon = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? "i-lucide-corner-down-left" : "i-lucide-list-plus";

const queuedMessageLabel = (item: AgentQueuedMessageDto): string => item.kind === "steer" ? t("agent.composer.steer") : t("agent.composer.queue");

const resolveComposerMenu = (context: AgentTriggerMenuContext): AgentTriggerMenuState => {
    const state = props.resolveMenu(context);
    if (context.kind !== "command") {
        return state;
    }

    if (!context.hasPlainTextBeforeTrigger) {
        return state;
    }

    const blockedIds = new Set(["command:compact", "command:clear", "command:new"]);
    return {
        ...state,
        sections: state.sections
            .map((section) => ({
                ...section,
                items: section.items.filter((item) => !blockedIds.has(item.id)),
            }))
            .filter((section) => section.items.length > 0),
    };
};

/**
 * 聚焦底部输入框。
 */
const focus = (): void => {
    inputRef.value?.focus();
};

/**
 * 同步输入框内容。
 */
function updateComposerValue(value: string): void {
    if (!props.pendingSession || !activeQuestionKey.value) {
        emit("update:inputText", value);
        return;
    }
    emit("update:notes", {
        ...props.notes,
        [activeQuestionKey.value]: value,
    });
}

/**
 * 更新当前活跃问题，供底部输入框写入 note。
 */
function setActiveQuestion(payload: {toolNodeId: string; questionIndex: number; key: string; canContinue: boolean; submitButtonLabel: string}): void {
    activeQuestionKey.value = payload.key;
    activeQuestionState.value = {
        canContinue: payload.canContinue,
        submitButtonLabel: payload.submitButtonLabel,
    };
}

/**
 * 处理回答备注输入提交。
 */
function submitComposer(payload?: {ctrlKey?: boolean; metaKey?: boolean}): void {
    if (props.readonly) {
        return;
    }
    if (props.pendingSession) {
        submitActiveQuestion();
        return;
    }
    if (props.running && runInputText.value.trim()) {
        if (payload?.ctrlKey || payload?.metaKey) {
            emit("followup");
        } else {
            emit("steer");
        }
        return;
    }
    emit("send");
}

/**
 * 继续或提交当前 request_user_input 问题。
 */
function submitActiveQuestion(): void {
    if (props.readonly) {
        return;
    }
    userInputPromptRef.value?.continueQuestion();
}

/**
 * 处理右下角按钮点击。
 */
function submitButton(event: MouseEvent): void {
    if (props.readonly && !canStopReadonlyRun.value) {
        return;
    }
    if (props.pendingSession) {
        submitActiveQuestion();
        return;
    }
    if (props.running && !runInputText.value.trim()) {
        emit("stop");
        return;
    }
    if (props.running) {
        if (event.ctrlKey || event.metaKey) {
            emit("followup");
        } else {
            emit("steer");
        }
        return;
    }
    emit("send");
}

defineExpose({focus});
</script>

<template>
    <!-- Agent 底部输入容器 -->
    <div class="relative shrink-0 bg-[var(--bg-panel)] px-2 pb-1">
        <!-- request_user_input 回答区 -->
        <div v-if="props.pendingSession" class="flex min-w-0 w-full pb-2">
            <AgentUserInputPrompt
                ref="userInputPromptRef"
                :session="props.pendingSession"
                :selected-answers="props.selectedAnswers"
                :notes="props.notes"
                :submitting="props.submittingUserInput"
                :readonly="props.readonly"
                @update:selected-answers="emit('update:selectedAnswers', $event)"
                @update:notes="emit('update:notes', $event)"
                @active-question-change="setActiveQuestion"
                @submit="emit('submit-user-input', $event)"
                @submit-form="emit('submit-user-input-form', $event)"
                @cancel="emit('cancel-user-input', $event)"
            />
        </div>

        <!-- pending 引导/队列 -->
        <div v-if="!props.pendingSession && props.queuedMessages.length > 0" class="flex min-w-0 flex-wrap gap-1 px-1 pb-1.5">
            <div
                v-for="item in props.queuedMessages"
                :key="item.id"
                class="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                :title="`${queuedMessageLabel(item)}：${queuedMessageText(item)}`"
            >
                <span :class="queuedMessageIcon(item)" class="h-3 w-3 shrink-0 text-[var(--accent-text)]"></span>
                <span class="shrink-0 font-medium">{{ queuedMessageLabel(item) }}</span>
                <span class="max-w-[18rem] truncate text-[var(--text-muted)]">{{ queuedMessageText(item) }}</span>
            </div>
        </div>

        <!-- 消息输入栏 -->
        <div class="flex flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]" style="--composer-radius: 0.75rem;">
            <AgentComposerInput
                ref="inputRef"
                borderless
                :model-value="activeComposerValue"
                :placeholder="composerPlaceholder"
                :expanded="composerExpanded"
                :readonly="props.readonly"
                :menu-refresh-key="props.menuRefreshKey"
                :resolve-menu="resolveComposerMenu"
                :on-skill-trigger-start="props.onSkillTriggerStart"
                @update:model-value="updateComposerValue"
                @submit="submitComposer"
                @toggle-plan-mode="emit('toggle-plan-mode')"
            />

            <div class="flex items-center justify-between border-t border-[var(--border-color)]/50 px-2 py-2">
                <div class="flex min-w-0 items-center gap-2">
                    <AgentSessionModelControls
                        :session-model-selection-value="props.sessionModelSelectionValue"
                        :session-thinking-resolved-label="props.sessionThinkingResolvedLabel"
                        :session-model-draft="props.sessionModelDraft"
                        :selectable-models="props.selectableModels"
                        :session-model-saving="props.sessionModelSaving"
                        :session-model-popover-open="props.sessionModelPopoverOpen"
                        :readonly="props.readonly"
                        :running="props.running"
                        :loading-session="props.loadingSession"
                        dropdown-direction="up"
                        root-class="w-[320px]"
                        popover-class="w-[360px]"
                        @update:session-model-popover-open="emit('update:sessionModelPopoverOpen', $event)"
                        @update:session-model-draft="emit('update:sessionModelDraft', $event)"
                        @update-session-model-selection="emit('update-session-model-selection', $event)"
                        @toggle-session-model-popover="emit('toggle-session-model-popover')"
                        @apply-session-model-settings="emit('apply-session-model-settings')"
                        @reset-session-model-settings="emit('reset-session-model-settings')"
                    />

                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                        :class="composerExpanded ? 'bg-[var(--bg-hover)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        :title="expandButtonTitle"
                        @click="composerExpanded = !composerExpanded"
                    >
                        <span :class="expandButtonIcon" class="h-3.5 w-3.5"></span>
                    </button>

                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        :class="props.planModeActive ? 'text-[var(--accent-text)] bg-[var(--accent-bg)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        :disabled="props.readonly || props.running"
                        title="Plan Mode (Shift+Tab)"
                        @click="emit('toggle-plan-mode')"
                    >
                        <span :class="props.planModeActive ? 'i-lucide-clipboard-check' : 'i-lucide-clipboard-list'" class="h-3.5 w-3.5"></span>
                    </button>
                </div>
                <button
                    class="flex items-center justify-center rounded bg-[var(--accent-bg)] p-1.5 text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="sendDisabled"
                    :title="sendButtonTitle"
                    @click.prevent="submitButton"
                >
                    <span :class="sendIconClass" class="h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <!-- token 与运行状态 -->
        <div class="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[9px] text-[var(--text-muted)]">
            <div :title="props.contextUsageExactLabel" class="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-gauge h-3 w-3 shrink-0"></span>
                <span class="truncate font-medium text-[var(--text-secondary)]">{{ props.contextUsageCompactLabel }}</span>
                <span v-if="props.contextPercentCompactLabel" class="rounded-full bg-[var(--accent-bg)] px-1 py-[1px] text-[8px] font-semibold text-[var(--accent-text)]">{{ props.contextPercentCompactLabel }}</span>
            </div>
            <div :title="props.cumulativeUsageExactLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-arrow-down h-3 w-3"></span>
                <span>{{ props.cumulativeInputCompactLabel }}</span>
                <span class="i-lucide-arrow-up h-3 w-3"></span>
                <span>{{ props.cumulativeOutputCompactLabel }}</span>
                <span class="i-lucide-database-zap h-3 w-3"></span>
                <span>{{ props.cumulativeCacheCompactLabel }}</span>
                <template v-if="props.cumulativeCacheHitRateLabel">
                    <span class="i-lucide-percent h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheHitRateLabel }}</span>
                </template>
                <template v-if="props.cumulativeCacheWriteCompactLabel !== '-' && props.cumulativeCacheWriteCompactLabel !== '0'">
                    <span class="i-lucide-hard-drive-upload h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheWriteCompactLabel }}</span>
                </template>
                <template v-if="props.cumulativeCostCompactLabel">
                    <span class="i-lucide-circle-dollar-sign h-3 w-3"></span>
                    <span>{{ props.cumulativeCostCompactLabel }}</span>
                </template>
            </div>
            <div v-if="props.connectionStatusLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-wifi h-3 w-3"></span>
                <span>{{ props.connectionStatusLabel }}</span>
            </div>
            <template v-if="props.connectionNeedsAction">
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.composer.reconnectTitle')" @click="emit('reconnect-events')">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                    <span>{{ t("agent.composer.reconnect") }}</span>
                </button>
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.composer.refreshHistoryTitle')" @click="emit('refresh-history')">
                    <span class="i-lucide-history h-3 w-3"></span>
                    <span>{{ t("agent.composer.refreshHistory") }}</span>
                </button>
            </template>
            <div v-if="props.running" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                <span>{{ props.runPhaseLabel || t("agent.composer.running") }}</span>
            </div>
            <div v-if="props.planModeActive" class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] px-1.5 py-0.5 text-[var(--accent-text)]" :title="t('agent.composer.togglePlanTitle')">
                <span class="i-lucide-clipboard-list h-3 w-3"></span>
                <span>Plan</span>
            </div>
        </div>
    </div>
</template>
