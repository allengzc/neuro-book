<script setup lang="ts">
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import type {LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import {withLowCodeFormDefaults} from "nbook/app/components/common/low-code-form/low-code-form-utils";

const NONE_OF_ABOVE_OPTION_INDEX = -1;

const props = defineProps<{
    session: AgentPendingUserInputSession;
    selectedAnswers: Record<string, number[]>;
    notes: Record<string, string>;
    submitting?: boolean;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:selectedAnswers", value: Record<string, number[]>): void;
    (e: "update:notes", value: Record<string, string>): void;
    (e: "active-question-change", payload: {toolNodeId: string; questionIndex: number; key: string; canContinue: boolean; canSubmitAll: boolean; submitButtonLabel: string}): void;
    (e: "submit", payload: {
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
    (e: "submit-form", payload: {
        assistantMessageId: string;
        toolCallId: string;
        data: LowCodeJsonObject;
    }): void;
    (e: "cancel", payload: {assistantMessageId: string}): void;
}>();

const activeToolNodeId = ref("");
const activeQuestionIndexValue = ref(0);
const isCollapsed = ref(false);
const {t} = useI18n();

// Task 63: Low-Code Form 状态
const lowCodeFormData = ref<LowCodeJsonObject>({});
const isLowCodeFormMode = computed(() => Boolean(props.session.form));

const activeQuestion = computed(() => {
    if (isLowCodeFormMode.value) {
        return null;
    }
    return props.session.questions.find((question) => question.toolNodeId === activeToolNodeId.value && question.questionIndex === activeQuestionIndexValue.value) ?? props.session.questions[0];
});

const activeQuestionIndex = computed(() => {
    const index = props.session.questions.findIndex((question) => question.toolNodeId === activeQuestion.value?.toolNodeId && question.questionIndex === activeQuestion.value?.questionIndex);
    return Math.max(index, 0);
});

const questionCount = computed(() => props.session.questions.length);

const activeAnswer = computed(() => {
    if (!activeQuestion.value) {
        return [];
    }
    return props.selectedAnswers[questionKey(activeQuestion.value.toolNodeId, activeQuestion.value.questionIndex)] ?? [];
});

const activeQuestionCanContinue = computed(() => activeQuestion.value
    ? hasAnswer(questionKey(activeQuestion.value.toolNodeId, activeQuestion.value.questionIndex))
    : false);

const isToolApproval = computed(() => activeQuestion.value?.kind === "tool_approval");
const isExitPlanModeApproval = computed(() => activeQuestion.value?.approvalAction === "exit_plan_mode");

const submitButtonLabel = computed(() => {
    if (!isToolApproval.value) {
        return canSubmit.value ? t("agent.userInput.continue") : t("agent.userInput.next");
    }
    if (activeAnswer.value.includes(0)) {
        return t("agent.userInput.approve");
    }
    return isExitPlanModeApproval.value && activeAnswer.value.includes(NONE_OF_ABOVE_OPTION_INDEX)
        ? t("agent.userInput.submitSuggestion")
        : t("agent.userInput.submit");
});

const cancelButtonLabel = computed(() => t("agent.userInput.terminateRun"));
const noneOfAboveLabel = computed(() => isExitPlanModeApproval.value ? t("agent.userInput.addSuggestion") : t("agent.userInput.otherAnswer"));
const noneOfAboveDescription = computed(() => isExitPlanModeApproval.value
    ? t("agent.userInput.suggestionDescription")
    : t("agent.userInput.otherAnswerDescription"));

const answeredCount = computed(() => {
    return props.session.questions.filter((question) => hasAnswer(questionKey(question.toolNodeId, question.questionIndex))).length;
});

/**
 * 判断当前问题是否已选择答案。
 */
function hasAnswer(toolNodeId: string): boolean {
    const question = props.session.questions.find((item) => questionKey(item.toolNodeId, item.questionIndex) === toolNodeId);
    if (!question) {
        return false;
    }
    const key = questionKey(question.toolNodeId, question.questionIndex);
    if (props.notes[key]?.trim()) {
        return true;
    }
    return question.options.length > 0 && Boolean(props.selectedAnswers[key]?.length);
}

/**
 * 当前是否允许提交。
 */
const canSubmit = computed(() => {
    return props.session.questions.every((question) => hasAnswer(questionKey(question.toolNodeId, question.questionIndex)));
});

/**
 * 切换到指定问题。
 */
function switchQuestion(nextIndex: number): void {
    const boundedIndex = Math.min(Math.max(nextIndex, 0), questionCount.value - 1);
    const question = props.session.questions[boundedIndex];
    activeToolNodeId.value = question?.toolNodeId ?? "";
    activeQuestionIndexValue.value = question?.questionIndex ?? 0;
}

/**
 * 选择当前问题答案。
 */
function selectAnswer(optionIndex: number): void {
    if (!activeQuestion.value || props.readonly) {
        return;
    }
    const key = questionKey(activeQuestion.value.toolNodeId, activeQuestion.value.questionIndex);
    const nextAnswers = {...props.selectedAnswers};
    nextAnswers[key] = [optionIndex];
    emit("update:selectedAnswers", nextAnswers);
}

function questionKey(toolNodeId: string, questionIndex: number): string {
    return `${toolNodeId}\n${questionIndex}`;
}

function normalizeDefaultAnswers(question: AgentPendingUserInputSession["questions"][number]): number[] {
    if (question.kind !== "tool_approval" || question.options.length === 0) {
        return [];
    }
    return [0];
}

function applyDefaultAnswers(): void {
    const nextAnswers = {...props.selectedAnswers};
    let changed = false;
    for (const question of props.session.questions) {
        const key = questionKey(question.toolNodeId, question.questionIndex);
        if (nextAnswers[key]?.length || props.notes[key]?.trim()) {
            continue;
        }
        const defaultAnswers = normalizeDefaultAnswers(question);
        if (defaultAnswers.length === 0) {
            continue;
        }
        nextAnswers[key] = defaultAnswers;
        changed = true;
    }
    if (changed) {
        emit("update:selectedAnswers", nextAnswers);
    }
}

/**
 * 取消当前等待并终止本轮 ReAct loop。
 */
function cancelQuestion(): void {
    if (props.session.questions.length === 0 || props.submitting || props.readonly) {
        return;
    }
    emit("cancel", {assistantMessageId: props.session.assistantMessageId});
}

/**
 * 进入下一题，全部完成后提交。
 */
function continueQuestion(): void {
    if (isLowCodeFormMode.value) {
        submitLowCodeForm();
        return;
    }
    if (!activeQuestion.value || !hasAnswer(questionKey(activeQuestion.value.toolNodeId, activeQuestion.value.questionIndex)) || props.submitting || props.readonly) {
        return;
    }
    if (canSubmit.value) {
        submit();
        return;
    }
    const nextUnansweredIndex = props.session.questions.findIndex((question, index) => {
        return index > activeQuestionIndex.value && !hasAnswer(questionKey(question.toolNodeId, question.questionIndex));
    });
    switchQuestion(nextUnansweredIndex >= 0 ? nextUnansweredIndex : props.session.questions.findIndex((question) => !hasAnswer(questionKey(question.toolNodeId, question.questionIndex))));
}

/**
 * 提交整组答案。
 */
function submit(): void {
    if (!canSubmit.value || props.submitting || props.readonly) {
        return;
    }
    emit("submit", {
        assistantMessageId: props.session.assistantMessageId,
        resume: true,
        answers: props.session.questions.map((question) => {
            const key = questionKey(question.toolNodeId, question.questionIndex);
            const selected = props.selectedAnswers[key] ?? [];
            return {
                toolNodeId: question.toolNodeId,
                questionIndex: question.questionIndex,
                selectedOptionIndex: selected[0],
                note: props.notes[key]?.trim() || undefined,
            };
        }),
    });
}

/**
 * Task 63: 提交 Low-Code Form 数据。
 */
function submitLowCodeForm(): void {
    if (!props.session.form || !props.session.formToolCallId || props.submitting || props.readonly) {
        return;
    }
    emit("submit-form", {
        assistantMessageId: props.session.assistantMessageId,
        toolCallId: props.session.formToolCallId,
        data: lowCodeFormSubmitData(),
    });
}

/**
 * 提交时补齐 Low-Code Form 展示层默认值，避免未触碰字段丢失。
 */
function lowCodeFormSubmitData(): LowCodeJsonObject {
    const form = props.session.form;
    if (!form) {
        return lowCodeFormData.value;
    }
    return withLowCodeFormDefaults(form, lowCodeFormData.value);
}

/**
 * Task 63: 取消 Low-Code Form 请求。
 */
function cancelLowCodeForm(): void {
    if (!props.session.form || !props.session.formToolCallId || props.submitting || props.readonly) {
        return;
    }
    emit("cancel", {assistantMessageId: props.session.assistantMessageId});
}

watch(() => props.session.assistantMessageId, () => {
    if (isLowCodeFormMode.value) {
        lowCodeFormData.value = {};
        isCollapsed.value = false;
        return;
    }
    activeToolNodeId.value = props.session.questions[0]?.toolNodeId ?? "";
    activeQuestionIndexValue.value = props.session.questions[0]?.questionIndex ?? 0;
    isCollapsed.value = false;
    applyDefaultAnswers();
}, {immediate: true});

watch(() => props.session.questions.map((question) => `${question.toolNodeId}\n${question.questionIndex}`).join("\n"), () => {
    if (isLowCodeFormMode.value) {
        return;
    }
    applyDefaultAnswers();
    if (props.session.questions.some((question) => question.toolNodeId === activeToolNodeId.value && question.questionIndex === activeQuestionIndexValue.value)) {
        return;
    }
    const question = props.session.questions.find((item) => !hasAnswer(questionKey(item.toolNodeId, item.questionIndex))) ?? props.session.questions[0];
    activeToolNodeId.value = question?.toolNodeId ?? "";
    activeQuestionIndexValue.value = question?.questionIndex ?? 0;
});

const activeQuestionStatePayload = computed(() => {
    const question = activeQuestion.value;
    if (!question) {
        return null;
    }
    return {
        toolNodeId: question.toolNodeId,
        questionIndex: question.questionIndex,
        key: questionKey(question.toolNodeId, question.questionIndex),
        canContinue: activeQuestionCanContinue.value,
        canSubmitAll: canSubmit.value,
        submitButtonLabel: submitButtonLabel.value,
    };
});

watch(activeQuestionStatePayload, (payload) => {
    if (!payload) {
        return;
    }
    emit("active-question-change", payload);
}, {immediate: true});

defineExpose({
    continueQuestion,
});
</script>

<template>
    <!-- Task 63: Low-Code Form 模式 -->
    <div v-if="isLowCodeFormMode && props.session.form" class="min-w-0 w-full overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] shadow-lg shadow-black/5">
        <div class="flex items-center justify-between gap-3 border-b border-[var(--border-color)]/60 px-3 py-1.5">
            <div class="min-w-0">
                <div class="flex items-center gap-2 text-[11px] font-medium text-[var(--text-muted)]">
                    <span>{{ t("agent.userInput.formRequest") }}</span>
                </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <button
                    class="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :title="isCollapsed ? t('agent.userInput.expand') : t('agent.userInput.collapse')"
                    @click="isCollapsed = !isCollapsed"
                >
                    <span :class="isCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <div v-if="!isCollapsed" class="max-h-[400px] overflow-y-auto px-3 pb-2 pt-2">
            <LowCodeForm
                :form="props.session.form"
                v-model="lowCodeFormData"
                :disabled="props.submitting || props.readonly"
            />
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)]/70 bg-[var(--bg-panel)]/35 px-3 py-1.5">
            <div class="min-w-0 text-xs text-[var(--text-muted)]">
                {{ t("agent.userInput.fillForm") }}
            </div>
            <div class="flex min-w-0 shrink-0 items-center gap-2">
                <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="props.submitting || props.readonly"
                    @click="cancelLowCodeForm"
                >
                    <span>{{ t("agent.userInput.terminateRun") }}</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="props.submitting || props.readonly"
                    @click="submitLowCodeForm"
                >
                    <span>{{ t("agent.userInput.submit") }}</span>
                    <span v-if="props.submitting" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                    <span v-else class="i-lucide-corner-down-left h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>
    </div>

    <!-- 挂起中的结构化问题 -->
    <div v-else-if="activeQuestion" class="flex h-[280px] min-w-0 w-full flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] shadow-lg shadow-black/5 sm:h-[320px]">
        <div class="flex items-center justify-between gap-3 border-b border-[var(--border-color)]/60 px-3 py-1.5">
            <div class="min-w-0">
                <div class="flex items-center gap-2 text-[11px] font-medium text-[var(--text-muted)]">
                    <span>{{ activeQuestion.header || (isToolApproval ? t("agent.userInput.approval") : t("agent.userInput.currentRequest")) }}</span>
                    <span class="tabular-nums">{{ activeQuestionIndex + 1 }} / {{ questionCount }}</span>
                    <span class="tabular-nums">{{ t("agent.userInput.answeredCount", {count: answeredCount}) }}</span>
                </div>
                <div v-if="isCollapsed" class="mt-0.5 truncate text-xs font-semibold text-[var(--text-main)]">{{ activeQuestion.question }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <button
                    class="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                    :disabled="isCollapsed || activeQuestionIndex === 0"
                    :title="t('agent.userInput.previous')"
                    @click="switchQuestion(activeQuestionIndex - 1)"
                >
                    <span class="i-lucide-chevron-left h-3.5 w-3.5"></span>
                </button>
                <button
                    class="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                    :disabled="isCollapsed || activeQuestionIndex >= questionCount - 1"
                    :title="t('agent.userInput.nextQuestion')"
                    @click="switchQuestion(activeQuestionIndex + 1)"
                >
                    <span class="i-lucide-chevron-right h-3.5 w-3.5"></span>
                </button>
                <button
                    class="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :title="isCollapsed ? t('agent.userInput.expand') : t('agent.userInput.collapse')"
                    @click="isCollapsed = !isCollapsed"
                >
                    <span :class="isCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-2">
            <template v-if="!isCollapsed">
                <div class="min-w-0 break-words text-[13px] font-semibold leading-5 text-[var(--text-main)]">
                    <span v-if="activeQuestion.header" class="mb-0.5 block text-[11px] font-medium text-[var(--text-muted)]">{{ activeQuestion.header }}</span>
                    <span>{{ activeQuestion.question }}</span>
                </div>

                <div v-if="activeQuestion.options.length === 0" class="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium leading-4 text-[var(--text-muted)]">
                    <span class="i-lucide-message-square-text h-3 w-3"></span>
                    <span>{{ t("agent.userInput.openAnswer") }}</span>
                </div>

                <div v-if="activeQuestion.options.length > 0" class="mt-2 space-y-0.5">
                    <button
                        v-for="(option, index) in activeQuestion.options"
                        :key="index"
                        type="button"
                        class="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-55"
                        :class="activeAnswer.includes(index) ? 'text-[var(--text-main)]' : 'text-[var(--text-secondary)]'"
                        :disabled="props.readonly"
                        @click="selectAnswer(index)"
                    >
                        <span class="w-5 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[var(--text-muted)]">{{ index + 1 }}.</span>
                        <span class="min-w-0 flex-1">
                            <span class="inline-flex flex-wrap items-center gap-1.5 text-[13px] font-semibold leading-5">
                                <span>{{ option.label }}</span>
                                <span v-if="option.description" class="i-lucide-info h-3 w-3 text-[var(--text-muted)]" :title="option.description"></span>
                            </span>
                            <span v-if="option.description" class="block text-[11px] leading-4 text-[var(--text-muted)]">{{ option.description }}</span>
                        </span>
                        <span
                            class="mt-1 h-2.5 w-2.5 rounded-full border transition-colors"
                            :class="activeAnswer.includes(index) ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color)] group-hover:border-[var(--text-muted)]'"
                        ></span>
                    </button>

                    <button
                        v-if="isToolApproval && activeQuestion.options.length > 0"
                        type="button"
                        class="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-55"
                        :class="activeAnswer.includes(NONE_OF_ABOVE_OPTION_INDEX) ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'"
                        :disabled="props.readonly"
                        @click="selectAnswer(NONE_OF_ABOVE_OPTION_INDEX)"
                    >
                        <span class="w-5 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[var(--text-muted)]">{{ activeQuestion.options.length + 1 }}.</span>
                        <span class="min-w-0 flex-1">
                            <span class="block text-[13px] font-semibold leading-5">{{ noneOfAboveLabel }}</span>
                            <span class="block text-[11px] leading-4 text-[var(--text-muted)]">{{ noneOfAboveDescription }}</span>
                        </span>
                        <span
                            class="mt-1 h-2.5 w-2.5 rounded-full border transition-colors"
                            :class="activeAnswer.includes(NONE_OF_ABOVE_OPTION_INDEX) ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color)] group-hover:border-[var(--text-muted)]'"
                        ></span>
                    </button>
                </div>
            </template>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)]/70 bg-[var(--bg-panel)]/35 px-3 py-1.5">
            <div class="min-w-0 text-xs text-[var(--text-muted)]">
                {{ t("agent.userInput.answeredProgress", {answered: answeredCount, total: questionCount}) }}
            </div>
            <div class="flex min-w-0 shrink-0 items-center gap-2">
                <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="props.submitting || props.readonly"
                    @click="cancelQuestion"
                >
                    <span>{{ cancelButtonLabel }}</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!hasAnswer(questionKey(activeQuestion.toolNodeId, activeQuestion.questionIndex)) || props.submitting || props.readonly"
                    @click="continueQuestion"
                >
                    <span>{{ submitButtonLabel }}</span>
                    <span v-if="props.submitting" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                    <span v-else class="i-lucide-corner-down-left h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>
    </div>
</template>
