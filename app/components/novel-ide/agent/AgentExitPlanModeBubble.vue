<script setup lang="ts">
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "nbook/app/components/novel-ide/agent/request-user-input-context";
import {RequestUserInputToolAnswerSchema} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import {z} from "zod";

const NONE_OF_ABOVE_OPTION_INDEX = -1;
const REJECT_OPTION_INDEX = 1;
const APPROVE_OPTION_INDEX = 0;

const ExitPlanModePreviewDataSchema = z.object({
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
});

const ExitPlanModeRawResultSchema = z.object({
    answers: z.array(RequestUserInputToolAnswerSchema).optional(),
    approved: z.boolean().optional(),
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
    data: z.unknown().optional(),
});

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);
const showApprovedPreview = ref(false);

/**
 * 当前 exit_plan_mode 是否仍在等待审批。
 */
const pendingQuestion = computed(() => {
    return userInputContext?.pendingSession.value?.questions.find((question) => question.toolNodeId === props.toolCall.id) ?? null;
});

const isPendingQuestion = computed(() => {
    return Boolean(
        pendingQuestion.value
        && userInputContext?.pendingSession.value?.assistantMessageId === props.toolCall.assistantMessageId,
    );
});

const parsedRawResult = computed(() => {
    const parsed = ExitPlanModeRawResultSchema.safeParse(props.toolCall.rawResult);
    return parsed.success ? parsed.data : null;
});

const parsedPreviewData = computed(() => {
    const parsed = ExitPlanModePreviewDataSchema.safeParse(parsedRawResult.value?.data);
    return parsed.success ? parsed.data : null;
});

const planFilePath = computed(() => {
    return pendingQuestion.value?.planFilePath ?? parsedRawResult.value?.planFilePath ?? parsedPreviewData.value?.planFilePath ?? "";
});

const planContent = computed(() => {
    return pendingQuestion.value?.planContent ?? parsedRawResult.value?.planContent ?? parsedPreviewData.value?.planContent ?? "";
});

const hasPlanFilePreview = computed(() => Boolean(planFilePath.value && planContent.value));
const hasPlanFileArgument = computed(() => Boolean(planFilePath.value));

const parsedAnswer = computed(() => {
    const answer = parsedRawResult.value?.answers?.[0];
    if (answer) {
        return answer;
    }
    try {
        return RequestUserInputToolAnswerSchema.parse(props.toolCall.rawResult);
    } catch {
        return null;
    }
});

const questionOptions = computed(() => {
    return pendingQuestion.value?.options ?? [];
});

const selectedIndexes = computed(() => {
    if (!parsedAnswer.value) {
        return [];
    }
    if (parsedAnswer.value.selectedOptionIndexes?.length) {
        return parsedAnswer.value.selectedOptionIndexes;
    }
    return parsedAnswer.value.selectedOptionIndex === undefined ? [] : [parsedAnswer.value.selectedOptionIndex];
});

function selectedOptionLabel(optionIndex: number): string {
    if (optionIndex === NONE_OF_ABOVE_OPTION_INDEX) {
        return "追加建议";
    }
    const optionLabel = questionOptions.value[optionIndex]?.label;
    if (optionLabel) {
        return optionLabel;
    }
    if (optionIndex === APPROVE_OPTION_INDEX) {
        return "批准";
    }
    if (optionIndex === REJECT_OPTION_INDEX) {
        return "拒绝";
    }
    return String(optionIndex);
}

const selectedLabel = computed(() => {
    if (!parsedAnswer.value) {
        return "";
    }
    if (parsedAnswer.value.ignored) {
        return "已忽略";
    }
    if (selectedIndexes.value.length === 0) {
        return "开放回答";
    }
    return selectedIndexes.value.map(selectedOptionLabel).join("、");
});

const shouldShowPlanPreview = computed(() => {
    return isPendingQuestion.value || showApprovedPreview.value;
});

const planSummary = computed(() => {
    const source = planContent.value;
    return source
        .split(/\r?\n/)
        .map((line) => line
            .replace(/^#{1,6}\s+/, "")
            .replace(/^\s*[-*+]\s+/, "")
            .replace(/^\s*\d+[.)]\s+/, "")
            .replace(/`{1,3}/g, "")
            .trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" / ");
});

const statusLabel = computed(() => {
    if (isPendingQuestion.value) {
        return hasPlanFileArgument.value ? "计划文件审批中" : "聊天计划审批中";
    }
    if (!parsedAnswer.value) {
        if (parsedRawResult.value?.approved === true) {
            return "计划已批准";
        }
        if (parsedRawResult.value?.approved === false) {
            return "计划已拒绝";
        }
        return hasPlanFileArgument.value ? "计划文件审批" : "聊天计划审批";
    }
    if (parsedAnswer.value.ignored) {
        return "计划审批已暂停";
    }
    if (selectedIndexes.value.includes(APPROVE_OPTION_INDEX)) {
        return "计划已批准";
    }
    if (selectedIndexes.value.includes(NONE_OF_ABOVE_OPTION_INDEX)) {
        return "已追加建议";
    }
    if (selectedIndexes.value.includes(REJECT_OPTION_INDEX) || parsedRawResult.value?.approved === false) {
        return "计划已拒绝";
    }
    return "已追加建议";
});
</script>

<template>
    <!-- exit_plan_mode 正文式计划审批预览 -->
    <div class="min-w-0 w-full">
        <div class="min-w-0 w-full rounded-xl border border-[var(--border-color)] bg-[var(--agent-bg)] px-3 py-2.5 shadow-sm">
            <div class="mb-1.5 flex min-w-0 items-center gap-2 text-[11px] leading-5 text-[var(--text-muted)]">
                <span :class="isPendingQuestion ? 'i-lucide-clock text-amber-600' : 'i-lucide-file-check-2 text-emerald-600'" class="h-3.5 w-3.5 shrink-0"></span>
                <span class="shrink-0 font-medium text-[var(--text-main)]">{{ statusLabel }}</span>
                <span v-if="planFilePath" class="min-w-0 truncate font-mono text-[11px] text-[var(--text-muted)]">{{ planFilePath }}</span>
                <button
                    v-if="!isPendingQuestion && planContent"
                    class="ml-auto shrink-0 rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    type="button"
                    :title="showApprovedPreview ? '折叠计划预览' : '展开计划预览'"
                    @click="showApprovedPreview = !showApprovedPreview"
                >
                    <span :class="showApprovedPreview ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>
            </div>

            <div v-if="shouldShowPlanPreview && hasPlanFilePreview" class="max-h-[320px] min-w-0 overflow-y-auto pr-2 text-xs leading-relaxed text-[var(--text-main)]">
                <AgentMarkdownContent :content="planContent" />
            </div>
            <div v-else-if="planSummary" class="line-clamp-2 break-words text-xs leading-5 text-[var(--text-secondary)]">
                {{ planSummary || "计划预览已折叠。" }}
            </div>
            <div v-else class="text-xs leading-5 text-[var(--text-muted)]">
                {{ hasPlanFileArgument ? "计划文件未附带可展示内容；请以聊天中已经展示的计划为准。" : "本次退出审批未携带计划文件；请以聊天中已经展示的计划为准。" }}
            </div>

            <div v-if="isPendingQuestion" class="mt-2 flex items-center gap-2 text-[11px] leading-5 text-amber-700">
                <span class="i-lucide-clock h-3.5 w-3.5 shrink-0"></span>
                <span>等待用户审批，请在输入框上方完成选择。</span>
            </div>
            <div v-else-if="parsedAnswer" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-5 text-[var(--text-muted)]">
                <span>选择：{{ selectedLabel }}</span>
                <span v-if="parsedAnswer.note">备注：{{ parsedAnswer.note }}</span>
            </div>
        </div>
    </div>
</template>
