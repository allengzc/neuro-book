<script setup lang="ts">
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {z} from "zod";
import {RequestUserInputToolArgsSchema, RequestUserInputToolAnswerSchema} from "nbook/app/components/novel-ide/agent/agent-message";

const NONE_OF_ABOVE_OPTION_INDEX = -1;
const RequestUserInputToolRawResultSchema = z.object({
    answers: z.array(RequestUserInputToolAnswerSchema),
});

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);

const parsedArgs = computed(() => {
    try {
        return RequestUserInputToolArgsSchema.parse(JSON.parse(props.toolCall.argsJson ?? props.toolCall.argsText));
    } catch {
        return null;
    }
});

const parsedAnswer = computed(() => {
    try {
        const parsed = RequestUserInputToolRawResultSchema.safeParse(props.toolCall.rawResult);
        if (parsed.success) {
            return parsed.data.answers[0] ?? null;
        }
        return RequestUserInputToolAnswerSchema.parse(props.toolCall.rawResult);
    } catch {
        return null;
    }
});

/**
 * 当前 tool 是否对应挂起中的问题。
 */
const pendingQuestion = computed(() => {
    return userInputContext?.pendingSession.value?.questions.find((question) => question.toolNodeId === props.toolCall.id) ?? null;
});

const isPlanModeApproval = computed(() => {
    return props.toolCall.name === "enter_plan_mode"
        || pendingQuestion.value?.kind === "tool_approval";
});
const isExitPlanModeApproval = computed(() => pendingQuestion.value?.approvalAction === "exit_plan_mode" || props.toolCall.name === "exit_plan_mode");

/**
 * 当前 tool 是否仍处于等待用户回答状态。
 */
const isPendingQuestion = computed(() => {
    return Boolean(
        pendingQuestion.value
        && userInputContext?.pendingSession.value?.assistantMessageId === props.toolCall.assistantMessageId,
    );
});

/**
 * 当前问题文本。
 */
const questionText = computed(() => {
    return pendingQuestion.value?.question ?? parsedArgs.value?.questions.map((question) => question.question).join("\n") ?? "";
});

/**
 * 当前问题选项。
 */
const questionOptions = computed(() => {
    return pendingQuestion.value?.options ?? parsedArgs.value?.questions[0]?.options ?? [];
});

/**
 * 当前工具参数文本，流式期间可能是不完整 JSON。
 */
const toolArgsText = computed(() => {
    return props.toolCall.argsJson ?? props.toolCall.argsText;
});

const selectedLabel = computed(() => {
    if (!parsedAnswer.value) {
        return "";
    }
    if (parsedAnswer.value.ignored) {
        return "已忽略";
    }
    if (parsedAnswer.value.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX) {
        return isExitPlanModeApproval.value ? "追加建议" : "其他答案";
    }
    if (parsedAnswer.value.selectedOptionIndexes?.length) {
        return parsedAnswer.value.selectedOptionIndexes.map((optionIndex) => optionIndex === NONE_OF_ABOVE_OPTION_INDEX
            ? isExitPlanModeApproval.value ? "追加建议" : "其他答案"
            : questionOptions.value[optionIndex]?.label ?? String(optionIndex)).join("、");
    }
    if (parsedAnswer.value.selectedOptionIndex === undefined) {
        return "开放回答";
    }
    return questionOptions.value[parsedAnswer.value.selectedOptionIndex]?.label ?? String(parsedAnswer.value.selectedOptionIndex);
});
</script>

<template>
    <!-- request_user_input 已回答 / 待回答 -->
    <div class="mt-2 space-y-2">
        <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ isPlanModeApproval ? "Approval" : "Question" }}</div>
            <div v-if="questionText" class="text-sm leading-6 text-[var(--text-main)]">
                {{ questionText }}
            </div>
            <div v-else class="text-xs whitespace-pre-wrap break-all font-mono leading-5 text-[var(--text-secondary)]">
                {{ toolArgsText || "参数流式输出中..." }}
            </div>

            <div class="mt-3 space-y-2">
                <div v-if="questionOptions.length > 0" class="space-y-1.5">
                    <div
                        v-for="(option, index) in questionOptions"
                        :key="index"
                        class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2"
                    >
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-medium text-[var(--text-main)]">{{ option.label }}</span>
                            <span v-if="option.recommended" class="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">推荐</span>
                        </div>
                        <div v-if="option.description" class="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
                            {{ option.description }}
                        </div>
                    </div>
                </div>
                <div class="flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                    <span v-if="questionOptions.length === 0" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">开放回答</span>
                    <span v-if="questionOptions.length > 0" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">{{ isExitPlanModeApproval ? "允许追加建议" : "允许其他答案" }}</span>
                    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">允许备注</span>
                </div>
            </div>
        </div>

        <div
            class="rounded-lg p-3"
            :class="isPendingQuestion ? 'border border-amber-500/30 bg-amber-500/5' : parsedAnswer ? 'border border-emerald-500/20 bg-emerald-500/5' : 'border border-[var(--border-color)] bg-[var(--bg-main)]'"
        >
            <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ isPlanModeApproval ? "Decision" : "Answer" }}</div>

            <div v-if="isPendingQuestion" class="flex items-center gap-2 text-xs leading-5 text-amber-700">
                <span class="i-lucide-clock h-3.5 w-3.5 shrink-0"></span>
                <span>{{ isPlanModeApproval ? "等待用户审批，请在输入框上方完成选择。" : "等待用户回答，请在输入框上方完成选择。" }}</span>
            </div>

            <div v-else-if="parsedAnswer && parsedAnswer.selectedOptionIndex === undefined && !parsedAnswer.selectedOptionIndexes?.length && parsedAnswer.note" class="text-sm leading-6 text-[var(--text-main)]">
                回答：{{ parsedAnswer.note }}
            </div>

            <div v-else-if="parsedAnswer" class="space-y-2">
                <div class="text-sm text-[var(--text-main)]">选择：{{ selectedLabel }}</div>
                <div v-if="parsedAnswer.note" class="text-xs leading-5 text-[var(--text-muted)]">备注：{{ parsedAnswer.note }}</div>
            </div>

            <div v-else class="text-xs whitespace-pre-wrap break-all text-[var(--text-secondary)]">
                {{ props.toolCall.result }}
            </div>
        </div>
    </div>
</template>
