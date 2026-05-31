<script setup lang="ts">
import type { AgentMessage, AgentToolCall, ChatNode } from "nbook/app/components/novel-ide/agent/agent-message";
import { toChatNodes } from "nbook/app/components/novel-ide/agent/agent-message";
import AgentTextBubble from "nbook/app/components/novel-ide/agent/AgentTextBubble.vue";
import AgentToolBubble from "nbook/app/components/novel-ide/agent/AgentToolBubble.vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";

const AUTO_SCROLL_RELEASE_THRESHOLD_PX = 12;

const props = defineProps<{
    /** 消息列表。 */
    messages: AgentMessage[];
    /** 是否正在执行中。 */
    running: boolean;
    /** 模式区分。main 显示空状态引导，compact 显示简洁空状态。 */
    mode: "main" | "compact";
    /** 当前处于编辑态的消息 ID。 */
    editingMessageId?: string | null;
    /** 是否禁用消息工具栏动作。 */
    messageActionDisabled?: boolean;
    /** 当前是否正在提交编辑。 */
    savingEdit?: boolean;
    /** 消息级分支切换状态。 */
    branchSwitcherStateByMessageId?: Record<string, {nodeIds: string[]; currentIndex: number; total: number}>;
    /** 编辑器触发菜单刷新 key。 */
    menuRefreshKey?: string | number;
    /** 编辑器触发菜单解析器。 */
    resolveEditorMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    /** 编辑器触发技能菜单时的刷新钩子。 */
    onEditorSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "copy", message: AgentMessage): void;
    (e: "copy-tool", toolCall: AgentToolCall): void;
    (e: "start-edit", message: AgentMessage): void;
    (e: "cancel-edit", message: AgentMessage): void;
    (e: "save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "retry", message: AgentMessage): void;
    (e: "delete", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
}>();

const scrollRef = ref<HTMLDivElement | null>(null);
const shouldStickToBottom = ref(true);
const lastScrollTop = ref(0);
let autoScrollFrame: number | null = null;

const chatNodes = computed(() => {
    return toChatNodes(props.messages);
});

/** 轻量追踪最后一条消息的渲染尺寸变化，避免 deep watch 扫描整棵消息树。 */
const messageScrollSignature = computed(() => {
    const lastMessage = props.messages.at(-1);
    const lastToolCall = lastMessage?.toolCalls?.at(-1);
    return [
        props.messages.length,
        lastMessage?.id ?? "",
        lastMessage?.status ?? "",
        lastMessage?.content.length ?? 0,
        lastMessage?.thinking?.length ?? 0,
        lastToolCall?.id ?? "",
        lastToolCall?.status ?? "",
        lastToolCall?.argsText.length ?? 0,
        lastToolCall?.result?.length ?? 0,
    ].join(":");
});

const getNodeKey = (node: ReturnType<typeof toChatNodes>[0]) => {
    if (node.kind === 'tool') return `${node.message.id}-${node.toolCall.id}`;
    return `${node.message.id}-text`;
};

/** 判断文本节点是否包含正文。 */
const hasTextBubbleContent = (node: ChatNode): boolean => {
    if (node.kind !== "text") {
        return false;
    }
    return Boolean(node.message.content.trim());
};

/** 计算节点间距，避免“仅思维链 + tool”之间出现过大空白。 */
const nodeSpacingClass = (index: number): string => {
    if (index === 0) {
        return "";
    }

    const previousNode = chatNodes.value[index - 1];
    const currentNode = chatNodes.value[index];
    if (!previousNode || !currentNode) {
        return "mt-6";
    }

    if (
        previousNode.kind === "text"
        && currentNode.kind === "tool"
        && previousNode.message.id === currentNode.message.id
        && !hasTextBubbleContent(previousNode)
    ) {
        return "mt-1";
    }

    if (
        previousNode.kind === "tool"
        && currentNode.kind === "tool"
        && previousNode.message.id === currentNode.message.id
    ) {
        return "mt-2";
    }

    return "mt-6";
};

/** 是否接近底部。 */
const isNearBottom = (thresholdPx = AUTO_SCROLL_RELEASE_THRESHOLD_PX): boolean => {
    if (!scrollRef.value) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.value;
    return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
};

/** 滚动到底部。 */
const scrollToBottom = (): void => {
    if (!scrollRef.value) return;
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    lastScrollTop.value = scrollRef.value.scrollTop;
};

/** 把自动吸底合并到下一帧，减少流式输出时的布局读取/写入抖动。 */
const scheduleScrollToBottom = (): void => {
    if (autoScrollFrame !== null) {
        return;
    }
    if (typeof requestAnimationFrame !== "function") {
        if (shouldStickToBottom.value) {
            scrollToBottom();
        }
        return;
    }
    autoScrollFrame = requestAnimationFrame(() => {
        autoScrollFrame = null;
        if (shouldStickToBottom.value) {
            scrollToBottom();
        }
    });
};

/** 滚动事件处理。 */
const onScroll = (): void => {
    if (!scrollRef.value) return;
    const currentScrollTop = scrollRef.value.scrollTop;
    const userScrolledUp = currentScrollTop < lastScrollTop.value;

    if (isNearBottom()) {
        shouldStickToBottom.value = true;
        lastScrollTop.value = currentScrollTop;
        return;
    }

    if (userScrolledUp && !isNearBottom(AUTO_SCROLL_RELEASE_THRESHOLD_PX)) {
        shouldStickToBottom.value = false;
    }

    lastScrollTop.value = currentScrollTop;
};

/** 消息变化时自动吸底。 */
watch(messageScrollSignature, async () => {
    await nextTick();
    if (shouldStickToBottom.value) {
        scheduleScrollToBottom();
    }
});

/** 外部可调用：强制滚动到底部。 */
const forceScrollToBottom = (): void => {
    shouldStickToBottom.value = true;
    if (autoScrollFrame !== null) {
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(autoScrollFrame);
        }
        autoScrollFrame = null;
    }
    scrollToBottom();
};

onUnmounted(() => {
    if (autoScrollFrame !== null) {
        if (typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(autoScrollFrame);
        }
        autoScrollFrame = null;
    }
});

defineExpose({ scrollToBottom: forceScrollToBottom, scrollRef });
</script>

<template>
    <!-- 通用对话流容器 -->
    <div ref="scrollRef" class="flex flex-1 flex-col overflow-y-auto p-4 pb-12 scroll-smooth bg-[var(--bg-panel)]" @scroll="onScroll">
        <template v-if="props.messages.length > 0">
            <div
                v-for="(node, index) in chatNodes"
                :key="getNodeKey(node)"
                :class="nodeSpacingClass(index)"
            >
                <AgentTextBubble
                    v-if="node.kind === 'text'"
                    :node="node"
                    :editing-message-id="props.editingMessageId"
                    :action-disabled="props.messageActionDisabled"
                    :saving-edit="props.savingEdit"
                    :branch-switcher="props.branchSwitcherStateByMessageId?.[node.message.id]"
                    :menu-refresh-key="props.menuRefreshKey"
                    :resolve-menu="props.resolveEditorMenu"
                    :on-skill-trigger-start="props.onEditorSkillTriggerStart"
                    @copy="emit('copy', $event)"
                    @start-edit="emit('start-edit', $event)"
                    @cancel-edit="emit('cancel-edit', $event)"
                    @save-edit="emit('save-edit', $event)"
                    @retry="emit('retry', $event)"
                    @delete="emit('delete', $event)"
                    @cycle-branch="emit('cycle-branch', $event)"
                />
                <AgentToolBubble
                    v-else-if="node.kind === 'tool'"
                    :tool-call="node.toolCall"
                    @copy="emit('copy-tool', $event)"
                />
            </div>
        </template>

        <!-- 空状态 -->
        <div v-else class="flex h-full flex-col items-center justify-center space-y-6 px-4 text-center">
            <!-- main 模式空状态 -->
            <template v-if="props.mode === 'main'">
                <div class="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm">
                    <span class="i-lucide-bot h-6 w-6 text-[var(--text-muted)]"></span>
                </div>
                <div class="space-y-2">
                    <h3 class="text-base font-medium text-[var(--text-main)]">开始与 AI 协作</h3>
                    <p class="text-sm leading-relaxed text-[var(--text-muted)]">你可以让我帮你设计角色、规划大纲，或者直接讨论接下来的剧情走向。</p>
                </div>
            </template>
            <!-- compact 模式空状态 -->
            <template v-else>
                <div class="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin text-[var(--text-muted)]"></span>
                </div>
                <p class="text-xs text-[var(--text-muted)]">等待 Agent 响应…</p>
            </template>
        </div>
    </div>
</template>
