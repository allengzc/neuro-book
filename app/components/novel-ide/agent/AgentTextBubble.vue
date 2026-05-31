<script setup lang="ts">
import type { ChatNode, AgentMessage } from "nbook/app/components/novel-ide/agent/agent-message";
import { messageStatusLabel } from "nbook/app/components/novel-ide/agent/agent-message";
import { useCollapsible } from "nbook/app/composables/useCollapsible";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";

const THINKING_SUMMARY_LENGTH = 48;
const SWIPE_MIN_DELTA_X = 48;
const SWIPE_MAX_DELTA_Y = 24;

const props = defineProps<{
    node: Extract<ChatNode, { kind: "text" }>;
    editingMessageId?: string | null;
    actionDisabled?: boolean;
    savingEdit?: boolean;
    branchSwitcher?: {
        nodeIds: string[];
        currentIndex: number;
        total: number;
    };
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "copy", message: AgentMessage): void;
    (e: "start-edit", message: AgentMessage): void;
    (e: "cancel-edit", message: AgentMessage): void;
    (e: "save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "retry", message: AgentMessage): void;
    (e: "delete", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
}>();

const { isCollapsed: isThinkingCollapsed, toggle: toggleThinking } = useCollapsible(true);
const editingDraft = ref("");
const isSystemCollapsed = ref(true);
const swipeStart = ref<{x: number; y: number} | null>(null);

/**
 * 编辑态统一解码 HTML 实体。
 * 这里主要修正历史上已经被写入消息内容的 `&gt;` / `&lt;` 等转义文本，
 * 并兼容 `&amp;gt;` 这类多重转义。
 */
const decodeEditableContent = (content: string): string => {
    let current = content;

    for (let index = 0; index < 3; index += 1) {
        let decoded = current;

        if (import.meta.client) {
            const textarea = document.createElement("textarea");
            textarea.innerHTML = current;
            decoded = textarea.value;
        } else {
            decoded = current
                .replace(/&amp;/g, "&")
                .replace(/&gt;/g, ">")
                .replace(/&lt;/g, "<")
                .replace(/&quot;/g, "\"")
                .replace(/&#039;|&#39;/g, "'");
        }

        if (decoded === current) {
            return decoded;
        }
        current = decoded;
    }

    return current;
};

/** 同步当前消息到编辑草稿。 */
const syncEditingDraft = (): void => {
    editingDraft.value = decodeEditableContent(props.node.message.content);
};

/** 是否显示思维链。 */
const hasThinking = computed(() => {
    return Boolean(props.node.message.type === "ai" && props.node.message.thinking?.trim());
});

/** 是否显示正文气泡。 */
const hasMessageContent = computed(() => {
    return Boolean(props.node.message.content.trim());
});

/** 按自然段抽取折叠摘要。 */
const thinkingSummary = computed(() => {
    const thinking = props.node.message.thinking?.trim();
    if (!thinking) {
        return "";
    }

    const summaries = thinking
        .split(/\n\s*\n/g)
        .map((segment) => segment
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "")
        .filter((line) => line.length > 0)
        .map((line) => line.length > THINKING_SUMMARY_LENGTH
            ? `${line.slice(0, THINKING_SUMMARY_LENGTH)}...`
            : line,
        );

    return summaries.at(-1) ?? "";
});

/** 当前消息是否处于编辑态。 */
const isEditing = computed(() => props.editingMessageId === props.node.message.id);

/** 当前消息是否允许编辑。 */
const canEdit = computed(() => props.node.message.type === "user" || props.node.message.type === "ai");

/** 当前消息是否允许重试。 */
const canRetry = computed(() => props.node.message.type === "user" || props.node.message.type === "ai");

/** 是否为已进入历史的 steer 引导消息。 */
const isSteerMessage = computed(() => props.node.message.type === "user" && props.node.message.intent === "steer");

/** 普通消息头部图标。 */
const messageIconClass = computed(() => {
    if (props.node.message.type === "ai") {
        return "i-lucide-sparkles text-[var(--accent-text)]";
    }
    if (isSteerMessage.value) {
        return "i-lucide-corner-down-left text-[var(--accent-text)]";
    }
    return "i-lucide-user text-[var(--text-muted)]";
});

/** 普通消息头部标签。 */
const messageAuthorLabel = computed(() => {
    if (props.node.message.type === "ai") {
        return "Assistant";
    }
    return isSteerMessage.value ? "引导" : "You";
});

/** 系统消息展示类型。 */
const systemDisplayKind = computed(() => props.node.message.systemDisplayKind ?? "system");

/** 是否为低权重运行时提醒。 */
const isSystemReminder = computed(() => systemDisplayKind.value === "reminder");
const isSystemError = computed(() => systemDisplayKind.value === "error");

/** 系统消息标题。 */
const systemLabel = computed(() => {
    if (props.node.message.systemLabel) {
        return props.node.message.systemLabel;
    }
    if (systemDisplayKind.value === "prompt") {
        return "System Prompt";
    }
    if (systemDisplayKind.value === "reminder") {
        return "System Reminder";
    }
    if (systemDisplayKind.value === "error") {
        return "Run Error";
    }
    return "System";
});

/** 系统消息折叠摘要。 */
const systemSummary = computed(() => {
    const firstLine = props.node.message.content
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    return firstLine.length > 86 ? `${firstLine.slice(0, 86)}...` : firstLine;
});

/** 切换系统消息展开态。 */
const toggleSystem = (): void => {
    isSystemCollapsed.value = !isSystemCollapsed.value;
};

/**
 * 进入编辑态时同步草稿。
 */
watch(isEditing, (nextValue) => {
    if (nextValue) {
        syncEditingDraft();
    }
}, {immediate: true});

/**
 * System Prompt 和运行时系统卡片默认收起，避免新会话顶部过重。
 */
watch(() => props.node.message.id, () => {
    isSystemCollapsed.value = !isSystemError.value;
}, {immediate: true});

/**
 * 开始编辑当前消息。
 */
const startEdit = (): void => {
    if (!canEdit.value || props.actionDisabled) {
        return;
    }
    syncEditingDraft();
    emit("start-edit", props.node.message);
};

/**
 * 取消编辑当前消息。
 */
const cancelEdit = (): void => {
    syncEditingDraft();
    emit("cancel-edit", props.node.message);
};

/**
 * 保存编辑内容。
 */
const saveEdit = (): void => {
    const content = decodeEditableContent(editingDraft.value).trim();
    if (!content || props.savingEdit) {
        return;
    }
    emit("save-edit", {
        message: props.node.message,
        content,
    });
};

/**
 * 切换到当前消息的上一条/下一条 continuation 分支。
 */
const cycleBranch = (direction: -1 | 1): void => {
    if (!props.branchSwitcher || props.actionDisabled) {
        return;
    }
    emit("cycle-branch", {
        messageId: props.node.message.id,
        direction,
    });
};

/**
 * 记录消息正文横向滑动起点。
 */
const startSwipe = (event: PointerEvent): void => {
    if (!props.branchSwitcher || props.actionDisabled || isEditing.value) {
        return;
    }
    swipeStart.value = {
        x: event.clientX,
        y: event.clientY,
    };
};

/**
 * 横向滑动切换消息分支，纵向滚动不拦截。
 */
const endSwipe = (event: PointerEvent): void => {
    if (!swipeStart.value || !props.branchSwitcher || props.actionDisabled || isEditing.value) {
        swipeStart.value = null;
        return;
    }
    const deltaX = event.clientX - swipeStart.value.x;
    const deltaY = event.clientY - swipeStart.value.y;
    swipeStart.value = null;
    if (Math.abs(deltaX) < SWIPE_MIN_DELTA_X || Math.abs(deltaY) > SWIPE_MAX_DELTA_Y) {
        return;
    }
    cycleBranch(deltaX < 0 ? 1 : -1);
};
</script>

<template>
    <!-- System 消息 -->
    <div v-if="props.node.message.type === 'system'" class="group flex min-w-0 w-full flex-col pl-6" :class="isSystemReminder ? 'my-2' : 'my-3'">
        <button
            class="flex min-w-0 w-full items-center gap-2 rounded-md border text-left transition-colors"
            :class="isSystemError
                ? 'border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 hover:bg-rose-500/15'
                : isSystemReminder
                    ? 'border-[var(--border-color)]/50 bg-[var(--bg-panel)]/45 px-2.5 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text-secondary)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
            @click="toggleSystem"
        >
            <span :class="isSystemError ? 'i-lucide-alert-triangle h-3.5 w-3.5' : isSystemReminder ? 'i-lucide-bell-ring h-3 w-3' : 'i-lucide-settings-2 h-3.5 w-3.5'" class="shrink-0"></span>
            <span class="shrink-0 font-medium uppercase tracking-[0.18em]">{{ systemLabel }}</span>
            <span v-if="isSystemCollapsed && systemSummary" class="min-w-0 flex-1 truncate normal-case tracking-normal opacity-75">{{ systemSummary }}</span>
            <span v-else class="min-w-0 flex-1"></span>
            <span :class="isSystemCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="h-3.5 w-3.5 shrink-0"></span>
        </button>

        <div v-show="!isSystemCollapsed" class="mt-2 min-w-0 w-full">
            <div
                class="min-w-0 max-w-full overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)]/55 px-3 py-2 shadow-sm"
                :class="isSystemError ? 'max-h-[240px] border-rose-500/30 bg-rose-500/5' : isSystemReminder ? 'max-h-[180px]' : 'max-h-[320px]'"
            >
                <div v-if="props.node.message.content" class="min-w-0 text-xs leading-relaxed" :class="isSystemError ? 'text-rose-700' : 'text-[var(--text-muted)]'">
                    <AgentMarkdownContent :content="props.node.message.content" :html="props.node.message.html" />
                </div>
            </div>
        </div>
    </div>

    <!-- 用户 / Assistant 消息 -->
    <div v-else class="group flex min-w-0 w-full flex-col items-start">
        <!-- 消息头部 -->
        <div class="mb  -1.5 ml-1 flex w-full items-center gap-2">
            <div
                class="flex h-4 w-4 items-center justify-center rounded-full border"
                :class="props.node.message.type === 'ai' ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]'"
            >
                <span :class="messageIconClass" class="h-2.5 w-2.5"></span>
            </div>
            <span class="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--text-main)]">
                {{ messageAuthorLabel }}
            </span>
            <span v-if="props.node.message.model" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {{ props.node.message.model }}
            </span>
            <span v-if="props.node.message.timestamp" class="text-[10px] text-[var(--text-muted)]">{{ props.node.message.timestamp }}</span>
            <span v-if="messageStatusLabel(props.node.message)" class="rounded border border-[var(--border-color)] bg-[var(--bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {{ messageStatusLabel(props.node.message) }}
            </span>

            <div class="flex-1"></div>

            <div class="mr-4 flex items-center gap-0.5 text-[var(--text-muted)]">
                <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" title="复制" @click="emit('copy', props.node.message)">
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                </button>
                <template v-if="props.branchSwitcher">
                    <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" title="上一条分支" @click="cycleBranch(-1)">
                        <span class="i-lucide-chevron-left h-3.5 w-3.5"></span>
                    </button>
                    <span class="px-1 text-[10px] tabular-nums text-[var(--text-muted)]">
                        {{ props.branchSwitcher.currentIndex + 1 }}/{{ props.branchSwitcher.total }}
                    </span>
                    <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" title="下一条分支" @click="cycleBranch(1)">
                        <span class="i-lucide-chevron-right h-3.5 w-3.5"></span>
                    </button>
                </template>
                <button v-if="canEdit" class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" title="编辑" @click="startEdit">
                    <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                </button>
                <button v-if="canRetry" class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" title="刷新" @click="emit('retry', props.node.message)">
                    <span class="i-lucide-rotate-cw h-3.5 w-3.5"></span>
                </button>
                <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.actionDisabled" title="回退" @click="emit('delete', props.node.message)">
                    <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <!-- Assistant 思维链 -->
        <div v-if="hasThinking" class="mb-1 w-full pl-6">
            <div class="px-0.5 py-0.5">
                <button
                    class="flex w-full items-center gap-1.5 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]/90 transition-colors hover:text-[var(--text-main)]"
                    @click="toggleThinking"
                >
                    <span :class="isThinkingCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3 w-3 shrink-0"></span>
                    <span class="i-lucide-brain-circuit h-3 w-3 shrink-0"></span>
                    <span
                        v-if="isThinkingCollapsed"
                        class="min-w-0 flex-1 truncate text-[11px] normal-case tracking-normal text-[var(--text-muted)]/75"
                    >
                        {{ thinkingSummary }}
                    </span>
                    <span v-else class="text-[10px] normal-case tracking-normal text-[var(--text-muted)]/65">收起</span>
                </button>

                <div v-if="!isThinkingCollapsed" class="mt-1.5 border-l border-[var(--border-color)]/40 pl-3 text-[13px] leading-relaxed text-[var(--text-muted)]/85">
                    <AgentMarkdownContent :content="props.node.message.thinking ?? ''" :streaming="props.node.message.status === 'streaming'" />
                </div>
            </div>
        </div>

        <!-- 消息正文 -->
        <div
            v-if="hasMessageContent"
            class="min-w-0 w-full touch-pan-y pl-6"
            @pointerdown="startSwipe"
            @pointerup="endSwipe"
            @pointercancel="swipeStart = null"
        >
            <div
                class="min-w-0 max-w-full rounded-2xl border border-[var(--border-color)] bg-[var(--agent-bg)] px-4 py-3 shadow-sm"
                :class="props.node.message.error ? 'border-rose-500/40 bg-rose-500/5' : ''"
            >
                <div v-if="isEditing" class="space-y-3">
                    <!-- 消息编辑器 -->
                    <StructuredTextEditor
                        :model-value="editingDraft"
                        placeholder="编辑消息..."
                        :min-height="180"
                        :max-height="420"
                        mode="source"
                        :show-toolbar="false"
                        popover-direction="auto"
                        :submit-on-enter="false"
                        :enable-quick-triggers="true"
                        :menu-refresh-key="props.menuRefreshKey ?? ''"
                        :resolve-menu="props.resolveMenu"
                        :on-skill-trigger-start="props.onSkillTriggerStart"
                        @update:model-value="editingDraft = $event"
                    />
                    <div class="flex items-center justify-end gap-2">
                        <button class="inline-flex h-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.savingEdit" @click="cancelEdit">
                            取消
                        </button>
                        <button class="inline-flex h-7 items-center justify-center rounded-md border border-transparent bg-[var(--accent-main)] px-2.5 text-[11px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.savingEdit || !editingDraft.trim()" @click="saveEdit">
                            {{ props.savingEdit ? "保存中..." : "保存" }}
                        </button>
                    </div>
                </div>
                <div v-else class="min-w-0 text-sm leading-relaxed text-[var(--text-main)]">
                    <AgentMarkdownContent :content="props.node.message.content" :html="props.node.message.html" :streaming="props.node.message.status === 'streaming'" />
                </div>
            </div>
        </div>

        <!-- token 尾部 -->
        <div v-if="props.node.message.tokens" class="mt-1 flex w-full items-center pl-6 text-[var(--text-muted)]">
            <div class="flex-1"></div>
            <div class="flex items-center text-[10px] text-[var(--text-muted)]">
                <span class="i-lucide-zap mr-1 h-3 w-3"></span>
                {{ props.node.message.tokens }} tokens
            </div>
        </div>
    </div>
</template>
