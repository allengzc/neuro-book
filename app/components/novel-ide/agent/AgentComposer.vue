<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentReferenceInput from "nbook/app/components/novel-ide/agent/AgentReferenceInput.vue";
import AgentUserInputPrompt from "nbook/app/components/novel-ide/agent/AgentUserInputPrompt.vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import type {ModelSettingsDto} from "nbook/shared/dto/app-settings.dto";

type AgentComposerSessionModelDraft = {
    modelKey: string | null;
    temperature: string;
    topK: string;
    reasoningEffort: "low" | "medium" | "high" | null;
    stream: boolean;
};

const props = defineProps<{
    inputText: string;
    pendingSession: AgentPendingUserInputSession | null;
    selectedAnswers: Record<string, number[]>;
    notes: Record<string, string>;
    submittingUserInput: boolean;
    running: boolean;
    loadingSession: boolean;
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    sessionModelSelectionValue: string | null;
    sessionModelDefaultLabel: string;
    sessionModelDraft: AgentComposerSessionModelDraft;
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
    connectionStatusLabel: string;
    runPhaseLabel: string;
    connectionNeedsAction: boolean;
    menuRefreshKey: string | number;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "update:inputText", value: string): void;
    (e: "update:selectedAnswers", value: Record<string, number[]>): void;
    (e: "update:notes", value: Record<string, string>): void;
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentComposerSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "submit-user-input", payload: {
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
    }): void;
    (e: "send"): void;
    (e: "stop"): void;
    (e: "toggle-plan-mode"): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
    (e: "reconnect-events"): void;
    (e: "refresh-history"): void;
}>();

const inputRef = ref<InstanceType<typeof AgentReferenceInput> | null>(null);
const sessionModelControlsRef = ref<HTMLElement | null>(null);
const activeQuestionKey = ref("");

const activeComposerValue = computed(() => {
    if (!props.pendingSession || !activeQuestionKey.value) {
        return props.inputText;
    }
    return props.notes[activeQuestionKey.value] ?? "";
});

const composerPlaceholder = computed(() => props.pendingSession
    ? "补充说明...（将随当前需求一起提交）"
    : "输入消息... (输入 @ 引用, $ 技能, / 命令)");

const sendDisabled = computed(() => {
    if (props.running) {
        return false;
    }
    if (props.pendingSession) {
        return true;
    }
    return !props.inputText.trim() && !props.canContinueWithoutInput;
});

const sendIconClass = computed(() => {
    if (props.running) {
        return "i-lucide-square";
    }
    if (props.canContinueWithoutInput) {
        return "i-lucide-chevrons-right";
    }
    return "i-lucide-send";
});

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

onClickOutside(sessionModelControlsRef, () => {
    emit("update:sessionModelPopoverOpen", false);
});

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
function setActiveQuestion(payload: {toolNodeId: string; questionIndex: number; key: string}): void {
    activeQuestionKey.value = payload.key;
}

/**
 * 更新模型参数草稿。
 */
function updateSessionModelDraft(patch: Partial<AgentComposerSessionModelDraft>): void {
    emit("update:sessionModelDraft", {
        ...props.sessionModelDraft,
        ...patch,
    });
}

/**
 * 处理输入框提交。
 */
function submitComposer(): void {
    if (props.pendingSession) {
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
        <div v-if="props.pendingSession" class="flex min-w-0 justify-center px-1 pb-2">
            <AgentUserInputPrompt
                :session="props.pendingSession"
                :selected-answers="props.selectedAnswers"
                :notes="props.notes"
                :submitting="props.submittingUserInput"
                @update:selected-answers="emit('update:selectedAnswers', $event)"
                @update:notes="emit('update:notes', $event)"
                @active-question-change="setActiveQuestion"
                @submit="emit('submit-user-input', $event)"
            />
        </div>

        <!-- 消息输入栏 -->
        <div class="flex flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]">
            <AgentReferenceInput
                ref="inputRef"
                :model-value="activeComposerValue"
                :placeholder="composerPlaceholder"
                :menu-refresh-key="props.menuRefreshKey"
                :resolve-menu="resolveComposerMenu"
                :on-skill-trigger-start="props.onSkillTriggerStart"
                @update:model-value="updateComposerValue"
                @submit="submitComposer"
                @toggle-plan-mode="emit('toggle-plan-mode')"
            />

            <div class="flex items-center justify-between border-t border-[var(--border-color)]/50 px-2 py-2">
                <div class="flex min-w-0 items-center gap-2">
                    <div ref="sessionModelControlsRef" class="relative flex w-[230px] shrink-0 items-center gap-1.5">
                        <div class="min-w-0 flex-1">
                            <NovelIdeModelSelect
                                :model-value="props.sessionModelSelectionValue"
                                :models="props.selectableModels"
                                allow-default
                                :default-label="props.sessionModelDefaultLabel"
                                placeholder="选择 Session 模型"
                                :disabled="props.running || props.loadingSession || props.sessionModelSaving"
                                dropdown-direction="up"
                                @update:model-value="emit('update-session-model-selection', $event)"
                            />
                        </div>
                        <button
                            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
                            :disabled="props.running || props.loadingSession"
                            title="当前 Session 模型参数"
                            @click="emit('toggle-session-model-popover')"
                        >
                            <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
                        </button>

                        <div v-if="props.sessionModelPopoverOpen" class="absolute bottom-full left-0 z-40 mb-2 w-[320px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 shadow-2xl">
                            <div class="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div class="text-sm font-medium text-[var(--text-main)]">当前 Session 模型参数</div>
                                    <div class="mt-1 text-[11px] text-[var(--text-muted)]">仅影响当前 Session 后续新发起的 run。</div>
                                </div>
                                <button class="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:sessionModelPopoverOpen', false)">
                                    <span class="i-lucide-x h-3.5 w-3.5"></span>
                                </button>
                            </div>

                            <div class="space-y-3">
                                <div class="space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)]">模型</label>
                                    <NovelIdeModelSelect
                                        :model-value="props.sessionModelDraft.modelKey"
                                        :models="props.selectableModels"
                                        placeholder="选择 Session 模型"
                                        dropdown-direction="up"
                                        @update:model-value="updateSessionModelDraft({modelKey: $event})"
                                    />
                                </div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div class="space-y-1.5">
                                        <label class="text-xs font-medium text-[var(--text-secondary)]">温度</label>
                                        <input :value="props.sessionModelDraft.temperature" type="number" step="0.1" min="0" placeholder="留空" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" @input="updateSessionModelDraft({temperature: ($event.target as HTMLInputElement).value})">
                                    </div>
                                    <div class="space-y-1.5">
                                        <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
                                        <input :value="props.sessionModelDraft.topK" type="number" step="1" min="1" placeholder="留空" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" @input="updateSessionModelDraft({topK: ($event.target as HTMLInputElement).value})">
                                    </div>
                                </div>
                                <div class="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                                    <div>
                                        <div class="text-xs font-medium text-[var(--text-main)]">流式响应</div>
                                        <div class="mt-0.5 text-[11px] text-[var(--text-muted)]">关闭后仅影响模型侧流式返回。</div>
                                    </div>
                                    <button
                                        class="inline-flex h-7 min-w-[56px] items-center justify-center rounded-md border px-3 text-[12px] font-medium transition-colors"
                                        :class="props.sessionModelDraft.stream ? 'border-emerald-600/20 bg-emerald-500/10 text-emerald-600' : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-secondary)]'"
                                        @click="updateSessionModelDraft({stream: !props.sessionModelDraft.stream})"
                                    >
                                        {{ props.sessionModelDraft.stream ? "开启" : "关闭" }}
                                    </button>
                                </div>
                            </div>

                            <div class="mt-4 flex items-center justify-between gap-2">
                                <button class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :disabled="props.sessionModelSaving" @click="emit('reset-session-model-settings')">
                                    回到 profile 默认
                                </button>
                                <button class="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.sessionModelSaving || !props.sessionModelDraft.modelKey" @click="emit('apply-session-model-settings')">
                                    <span v-if="props.sessionModelSaving" class="i-lucide-loader-2 mr-1.5 h-3.5 w-3.5 animate-spin"></span>
                                    应用到当前 Session
                                </button>
                            </div>
                        </div>
                    </div>

                    <button
                        class="rounded p-1.5 transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        :class="props.planModeActive ? 'text-[var(--accent-text)] bg-[var(--accent-bg)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                        :disabled="props.running"
                        title="Plan Mode (Shift+Tab)"
                        @click="emit('toggle-plan-mode')"
                    >
                        <span :class="props.planModeActive ? 'i-lucide-clipboard-check' : 'i-lucide-clipboard-list'" class="h-3.5 w-3.5"></span>
                    </button>
                </div>
                <button
                    class="flex items-center justify-center rounded bg-[var(--accent-bg)] p-1.5 text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="sendDisabled"
                    @click="props.running ? emit('stop') : emit('send')"
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
                <template v-if="props.cumulativeCacheWriteCompactLabel">
                    <span class="i-lucide-hard-drive-upload h-3 w-3"></span>
                    <span>{{ props.cumulativeCacheWriteCompactLabel }}</span>
                </template>
            </div>
            <div v-if="props.connectionStatusLabel" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-wifi h-3 w-3"></span>
                <span>{{ props.connectionStatusLabel }}</span>
            </div>
            <template v-if="props.connectionNeedsAction">
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="重新连接 Agent 事件流" @click="emit('reconnect-events')">
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                    <span>重连</span>
                </button>
                <button class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="重新拉取一次当前 Session 历史" @click="emit('refresh-history')">
                    <span class="i-lucide-history h-3 w-3"></span>
                    <span>刷新历史</span>
                </button>
            </template>
            <div v-if="props.running" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">
                <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                <span>{{ props.runPhaseLabel || "运行中" }}</span>
            </div>
            <div v-if="props.planModeActive" class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] px-1.5 py-0.5 text-[var(--accent-text)]" title="Shift+Tab 切换">
                <span class="i-lucide-clipboard-list h-3 w-3"></span>
                <span>Plan</span>
            </div>
        </div>
    </div>
</template>
