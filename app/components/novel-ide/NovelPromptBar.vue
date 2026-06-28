<script setup lang="ts">
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import ReferencePlainTextEditor from "nbook/app/components/common/form/ReferencePlainTextEditor.vue";
import {parseSelectionRefChip, type InlineEditReference, type InlineEditTask} from "nbook/app/utils/inline-editor-selection";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

interface InlineTaskOption {
    id: InlineEditTask;
    label: string;
    iconClass: string;
    description: string;
}

const props = defineProps<{
    modelValue: string;
    loading: boolean;
    selectedModel: string;
    expanded: boolean;
    task: InlineEditTask;
    references: InlineEditReference[];
    currentPath: string;
    sessionLabel: string;
    sessions: AgentSessionSummaryDto[];
    activeSessionId: number | null;
    sessionLoading: boolean;
    editPreview: string;
    resultText: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:expanded", value: boolean): void;
    (e: "update:task", value: InlineEditTask): void;
    (e: "send"): void;
    (e: "stop"): void;
    (e: "height-change", value: number): void;
    (e: "clear-reference", index: number): void;
    (e: "hover-reference", reference: InlineEditReference | null): void;
    (e: "select-session", sessionId: number): void;
    (e: "create-session"): void;
    (e: "refresh-sessions"): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const editorRef = ref<InstanceType<typeof ReferencePlainTextEditor> | null>(null);
const {t} = useI18n();
let resizeObserver: ResizeObserver | null = null;

const taskOptions = computed<InlineTaskOption[]>(() => [
    {id: "rewrite", label: t("ide.inlineAi.taskRewrite"), iconClass: "i-lucide-refresh-cw", description: t("ide.inlineAi.rewriteDescription")},
    {id: "polish", label: t("ide.inlineAi.taskPolish"), iconClass: "i-lucide-sparkles", description: t("ide.inlineAi.polishDescription")},
    {id: "expand", label: t("ide.inlineAi.taskExpand"), iconClass: "i-lucide-stretch-horizontal", description: t("ide.inlineAi.expandDescription")},
    {id: "condense", label: t("ide.inlineAi.taskCondense"), iconClass: "i-lucide-shrink", description: t("ide.inlineAi.condenseDescription")},
    {id: "continue_after", label: t("ide.inlineAi.taskContinueAfter"), iconClass: "i-lucide-forward", description: t("ide.inlineAi.continueAfterDescription")},
    {id: "bridge", label: t("ide.inlineAi.taskBridge"), iconClass: "i-lucide-git-compare-arrows", description: t("ide.inlineAi.bridgeDescription")},
]);

const taskDropdownItems = computed<DropdownItem[]>(() => taskOptions.value.map((option) => ({
    label: option.label,
    value: option.id,
    iconClass: option.iconClass,
    active: option.id === props.task,
    rightIconClass: option.id === props.task ? "i-lucide-check" : undefined,
})));

const currentTask = computed(() => taskOptions.value.find((option) => option.id === props.task) ?? taskOptions.value[0]!);
const canSubmit = computed(() => props.loading || Boolean(props.modelValue.trim()) || props.references.length > 0 || Boolean(props.currentPath));
const sessionDropdownItems = computed<DropdownItem[]>(() => {
    const items = props.sessions.length > 0
        ? props.sessions.map((session) => ({
            label: sessionTitle(session),
            value: `session:${String(session.sessionId)}`,
            iconClass: session.status === "running" || session.status === "waiting" ? "i-lucide-loader-circle" : "i-lucide-message-square-more",
            active: session.sessionId === props.activeSessionId,
            rightIconClass: session.sessionId === props.activeSessionId ? "i-lucide-check" : undefined,
        }))
        : [{
            label: t("ide.inlineAi.noInlineSession"),
            value: "__empty",
            iconClass: "i-lucide-circle-dashed",
        }];
    return [
        ...items,
        {
            label: t("ide.inlineAi.refreshSessions"),
            value: "__refresh",
            iconClass: "i-lucide-refresh-cw",
        },
        {
            label: t("ide.inlineAi.createSession"),
            value: "__create",
            iconClass: "i-lucide-plus",
        },
    ];
});

/**
 * 选择 Inline AI 任务。
 */
function selectTask(value: string): void {
    if (taskOptions.value.some((option) => option.id === value)) {
        emit("update:task", value as InlineEditTask);
    }
}

/**
 * 处理 Inline AI session 菜单。
 */
function selectSessionMenu(value: string): void {
    if (value === "__refresh") {
        emit("refresh-sessions");
        return;
    }
    if (value === "__create") {
        emit("create-session");
        return;
    }
    if (!value.startsWith("session:")) {
        return;
    }
    const sessionId = Number(value.slice("session:".length));
    if (Number.isInteger(sessionId) && sessionId > 0) {
        emit("select-session", sessionId);
    }
}

/**
 * 发送当前 PromptBar 的真实高度。
 */
const reportHeight = (): void => {
    emit("height-change", rootRef.value?.offsetHeight ?? 0);
};

/**
 * 切换 PromptBar 展开状态。
 */
const toggleExpanded = (): void => {
    emit("update:expanded", !props.expanded);
};

/**
 * 处理发送或停止。
 */
const submit = (): void => {
    if (props.loading) {
        emit("stop");
        return;
    }
    if (!canSubmit.value) {
        return;
    }
    emit("send");
};

/**
 * 读取 selection chip 的紧凑展示名。
 */
function referenceLabel(reference: InlineEditReference): string {
    return parseSelectionRefChip(reference.ref)?.label ?? reference.path;
}

/**
 * 返回 session 在 PromptBar 菜单里的展示名。
 */
function sessionTitle(session: AgentSessionSummaryDto): string {
    return session.title || `Inline AI #${String(session.sessionId)}`;
}

watch(() => props.expanded, async (expanded) => {
    await nextTick();
    reportHeight();
    if (expanded) {
        editorRef.value?.focus();
    }
}, {immediate: true});

watch(() => [props.modelValue, props.references.length, props.editPreview, props.resultText], async () => {
    await nextTick();
    reportHeight();
});

onMounted(async () => {
    await nextTick();
    reportHeight();

    if (rootRef.value) {
        resizeObserver = new ResizeObserver(() => {
            reportHeight();
        });
        resizeObserver.observe(rootRef.value);
    }
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>

<template>
    <!-- 底部 Inline AI Prompt Bar -->
    <div ref="rootRef" class="ide-prompt-bar z-20 shrink-0 px-4">
        <div v-if="props.expanded" class="relative mx-auto w-full max-w-4xl pb-5 pt-7">
            <button
                class="absolute left-1/2 top-7 flex h-6 w-12 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-full border border-b-0 border-[var(--prompt-border)] bg-[var(--prompt-bg)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('ide.inlineAi.collapse')"
                @click="toggleExpanded"
            >
                <span class="i-lucide-chevron-down h-3.5 w-3.5"></span>
            </button>

            <div class="w-full overflow-visible rounded-xl border border-[var(--prompt-border)] bg-[var(--prompt-bg)] shadow-2xl shadow-black/10 transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]">
                <!-- Inline AI 修改预览 -->
                <div v-if="props.editPreview" class="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-2 text-xs text-[var(--text-secondary)]">
                    <div class="mb-1 flex items-center gap-2 font-medium text-[var(--text-main)]">
                        <span class="i-lucide-file-diff h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                        <span>{{ t("ide.inlineAi.editing") }}</span>
                    </div>
                    <div class="line-clamp-3 whitespace-pre-wrap leading-5">{{ props.editPreview }}</div>
                </div>

                <!-- Inline AI 结果摘要 -->
                <div v-if="props.resultText && !props.editPreview" class="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-2 text-xs text-[var(--text-secondary)]">
                    <div class="mb-1 flex items-center gap-2 font-medium text-[var(--text-main)]">
                        <span class="i-lucide-check-check h-3.5 w-3.5 text-emerald-500"></span>
                        <span>{{ t("ide.inlineAi.result") }}</span>
                    </div>
                    <div class="line-clamp-3 whitespace-pre-wrap leading-5">{{ props.resultText }}</div>
                </div>

                <!-- Inline AI 引用区 -->
                <div class="border-b border-[var(--border-color)] px-4 py-1.5">
                    <div class="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="inline-flex h-5 items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                            <span class="i-lucide-quote h-3.5 w-3.5"></span>
                            <span>{{ t("ide.inlineAi.references") }}</span>
                        </span>
                        <span
                            v-for="(reference, index) in props.references"
                            :key="`${reference.ref}:${String(index)}`"
                            class="group inline-flex h-5 max-w-[18rem] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs leading-none text-[var(--text-main)] transition-colors hover:border-rose-500/50"
                            :title="reference.ref"
                            @mouseenter="emit('hover-reference', reference)"
                            @mouseleave="emit('hover-reference', null)"
                        >
                            <span class="i-lucide-text-select h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                            <span class="truncate">{{ referenceLabel(reference) }}</span>
                            <button
                                type="button"
                                class="-mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-600 focus:bg-rose-500/10 focus:text-rose-600 focus:outline-none"
                                :title="t('ide.inlineAi.clearReference')"
                                @focus="emit('hover-reference', reference)"
                                @blur="emit('hover-reference', null)"
                                @click.stop="emit('clear-reference', index); emit('hover-reference', null)"
                            >
                                <span class="i-lucide-x h-3 w-3"></span>
                            </button>
                        </span>
                        <span v-if="props.references.length === 0" class="inline-flex h-5 items-center text-xs text-[var(--text-muted)]">
                            {{ t("ide.inlineAi.noReferenceBound") }}
                        </span>
                    </div>
                </div>

                <ReferencePlainTextEditor
                    ref="editorRef"
                    :model-value="props.modelValue"
                    :placeholder="t('ide.inlineAi.promptPlaceholder')"
                    :min-height="64"
                    :max-height="180"
                    borderless
                    submit-on-enter
                    enable-quick-triggers
                    @update:model-value="emit('update:modelValue', $event)"
                    @submit="submit"
                />

                <!-- Inline AI 控制区 -->
                <div class="flex items-center justify-between gap-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <Dropdown :items="taskDropdownItems" root-class="relative inline-block" menu-class="left-0 bottom-full mb-1.5 w-40" compact @select="selectTask">
                            <button class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" :title="currentTask.description">
                                <span :class="currentTask.iconClass" class="h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                <span>{{ currentTask.label }}</span>
                                <span class="i-lucide-chevron-up h-3 w-3 text-[var(--text-muted)]"></span>
                            </button>
                        </Dropdown>

                        <Dropdown :items="sessionDropdownItems" root-class="relative inline-block" menu-class="left-0 bottom-full mb-1.5 w-56" compact @select="selectSessionMenu">
                            <button class="inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" :title="t('ide.inlineAi.selectSession')">
                                <span :class="props.sessionLoading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-message-square-more'" class="h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                <span class="truncate">{{ props.sessionLabel }}</span>
                                <span class="i-lucide-chevron-up h-3 w-3 text-[var(--text-muted)]"></span>
                            </button>
                        </Dropdown>

                        <span class="inline-flex h-8 max-w-[12rem] items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)]" :title="props.selectedModel">
                            <span class="i-lucide-cpu h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                            <span class="truncate">{{ props.selectedModel }}</span>
                        </span>
                    </div>

                    <div class="flex items-center gap-3">
                        <div class="hidden text-right sm:block">
                            <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">INLINE AI</div>
                        </div>

                        <button
                            class="flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                            :class="props.loading ? 'border-rose-500/50 bg-rose-500/10 text-rose-500' : 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)] hover:opacity-85'"
                            :disabled="!canSubmit"
                            :title="props.loading ? t('ide.inlineAi.stop') : t('ide.inlineAi.send')"
                            @click="submit"
                        >
                            <span v-if="props.loading" class="i-lucide-square h-3.5 w-3.5"></span>
                            <span v-else class="i-lucide-send h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="flex justify-center">
            <button
                class="flex h-6 w-12 items-center justify-center rounded-t-full border border-b-0 border-[var(--prompt-border)] bg-[var(--prompt-bg)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('ide.inlineAi.expandBar')"
                @click="toggleExpanded"
            >
                <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
            </button>
        </div>
    </div>
</template>
