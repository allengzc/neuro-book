<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";
import {deriveAgentTreeState, isDefaultVisibleTreeNode} from "nbook/app/components/novel-ide/agent/session-tree";

type FilterMode = "default" | "messages" | "all";

const props = defineProps<{
    modelValue: boolean;
    tree: SessionTreeNode[];
    activeLeafId: string | null;
    running: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", entryId: string): void;
}>();

const search = ref("");
const filterMode = ref<FilterMode>("default");
const selectedEntryId = ref<string | null>(null);

const treeState = computed(() => deriveAgentTreeState(props.tree));
const selectedNode = computed(() => {
    if (selectedEntryId.value) {
        return treeState.value.nodeById.get(selectedEntryId.value) ?? null;
    }
    return props.activeLeafId ? treeState.value.nodeById.get(props.activeLeafId) ?? null : props.tree.find((node) => node.active) ?? null;
});

const filteredTree = computed(() => {
    const query = search.value.trim().toLowerCase();
    return treeState.value.flattenedNodes.filter((node) => {
        if (filterMode.value === "messages" && node.type !== "message" && node.type !== "custom_message") {
            return false;
        }
        if (filterMode.value === "default" && !isDefaultVisibleTreeNode(node)) {
            return false;
        }
        if (!query) {
            return true;
        }
        return [
            node.id,
            node.parentId ?? "",
            node.role ?? "",
            node.type,
            node.preview ?? "",
            node.toolName ?? "",
            node.label ?? "",
        ].some((value) => value.toLowerCase().includes(query));
    });
});

watch(() => props.modelValue, (visible) => {
    if (visible) {
        selectedEntryId.value = props.activeLeafId ?? props.tree.find((node) => node.active)?.id ?? props.tree[0]?.id ?? null;
    }
});

/**
 * 根据 parent 链计算缩进层级。
 */
function nodeDepth(node: SessionTreeNode): number {
    let depth = 0;
    let cursor = node.parentId;
    while (cursor) {
        const parent = treeState.value.nodeById.get(cursor);
        if (!parent) {
            break;
        }
        depth += 1;
        cursor = parent.parentId;
    }
    return depth;
}

/**
 * 节点角色展示标签。
 */
function roleLabel(node: SessionTreeNode): string {
    if (node.role === "assistant") {
        return "assistant";
    }
    if (node.role === "toolResult") {
        return node.toolName ? `tool:${node.toolName}` : "tool";
    }
    return node.role ?? node.type;
}

/**
 * 节点图标。
 */
function nodeIcon(node: SessionTreeNode): string {
    if (node.role === "user") {
        return "i-lucide-user";
    }
    if (node.role === "assistant") {
        return "i-lucide-sparkles";
    }
    if (node.role === "toolResult") {
        return "i-lucide-wrench";
    }
    if (node.type === "compaction") {
        return "i-lucide-archive";
    }
    if (node.type === "branch_summary") {
        return "i-lucide-git-branch";
    }
    return "i-lucide-circle";
}

/**
 * 节点摘要文案。
 */
function nodePreview(node: SessionTreeNode): string {
    return node.preview || node.label || node.type;
}

/**
 * 选中节点。
 */
function selectNode(node: SessionTreeNode): void {
    selectedEntryId.value = node.id;
}

/**
 * 切换当前 session leaf 到选中节点。
 */
function activateSelected(): void {
    if (!selectedNode.value || props.running) {
        return;
    }
    emit("select", selectedNode.value.id);
}

/**
 * 复制 entry id。
 */
async function copyId(value: string | null | undefined): Promise<void> {
    if (!value || !import.meta.client) {
        return;
    }
    await navigator.clipboard.writeText(value);
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        title="Session Tree"
        width="min(1180px, calc(100vw - 32px))"
        height="min(760px, calc(100vh - 48px))"
        body-class="!p-0 !gap-0 !overflow-hidden"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-base font-semibold leading-snug tracking-wide text-[var(--text-main)]">Session Tree</div>
                    <div class="truncate text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">{{ props.tree.length }} nodes · leaf {{ props.activeLeafId ?? "-" }}</div>
                </div>
                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:modelValue', false)">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <div class="flex min-h-0 flex-1 bg-[var(--bg-panel)]">
            <!-- Tree 主列表 -->
            <div class="flex min-w-0 flex-1 flex-col border-r border-[var(--border-color)]">
                <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--toolbar-bg)] px-4 py-3">
                    <div class="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5">
                        <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                        <input v-model="search" class="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]" placeholder="搜索内容、类型或 Entry ID..." />
                    </div>
                    <div class="flex h-9 overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]">
                        <button class="px-3 text-xs transition-colors" :class="filterMode === 'default' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="filterMode = 'default'">默认</button>
                        <button class="border-l border-[var(--border-color)] px-3 text-xs transition-colors" :class="filterMode === 'messages' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="filterMode = 'messages'">消息</button>
                        <button class="border-l border-[var(--border-color)] px-3 text-xs transition-colors" :class="filterMode === 'all' ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="filterMode = 'all'">全部</button>
                    </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <div v-if="filteredTree.length > 0" class="space-y-1.5">
                        <button
                            v-for="nodeItem in filteredTree"
                            :key="nodeItem.id"
                            class="flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
                            :class="[
                                nodeItem.id === selectedNode?.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]/40' : nodeItem.active ? 'border-[var(--border-color-hover)] bg-[var(--bg-hover)]/70' : 'border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:bg-[var(--bg-hover)]',
                                nodeItem.id === props.activeLeafId ? 'shadow-[inset_3px_0_0_var(--accent-main)]' : '',
                            ]"
                            @click="selectNode(nodeItem)"
                            @dblclick="activateSelected"
                        >
                            <span class="shrink-0 font-mono text-[11px] text-[var(--text-muted)]" :style="{width: `${Math.min(nodeDepth(nodeItem), 8) * 18}px`}"></span>
                            <span class="h-2 w-2 shrink-0 rounded-full border" :class="nodeItem.active ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color-hover)] bg-[var(--bg-panel)]'"></span>
                            <span :class="nodeIcon(nodeItem)" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                            <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ roleLabel(nodeItem) }}</span>
                            <span class="min-w-0 flex-1 truncate text-sm text-[var(--text-main)]">{{ nodePreview(nodeItem) }}</span>
                            <span v-if="nodeItem.childCount > 0" class="shrink-0 rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ nodeItem.childCount }}</span>
                            <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ formatTimestamp(nodeItem.timestamp) }}</span>
                        </button>
                    </div>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                        没有匹配的节点
                    </div>
                </div>
            </div>

            <!-- 节点详情 -->
            <aside class="flex w-[340px] shrink-0 flex-col bg-[var(--bg-main)]">
                <div class="border-b border-[var(--border-color)] px-4 py-3">
                    <div class="text-sm font-semibold text-[var(--text-main)]">节点详情</div>
                    <div class="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Entry Metadata</div>
                </div>
                <div v-if="selectedNode" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <div class="mb-4 flex items-center gap-2">
                        <span :class="nodeIcon(selectedNode)" class="h-4 w-4 text-[var(--accent-text)]"></span>
                        <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs font-medium text-[var(--text-main)]">{{ roleLabel(selectedNode) }}</span>
                        <span v-if="selectedNode.id === props.activeLeafId" class="rounded bg-[var(--accent-bg)] px-2 py-1 text-[10px] text-[var(--accent-text)]">LEAF</span>
                    </div>

                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                        <div class="mb-2 text-xs font-medium text-[var(--text-main)]">内容</div>
                        <div class="max-h-[220px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{{ nodePreview(selectedNode) }}</div>
                    </div>

                    <div class="mt-4 space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-xs">
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Entry ID</span>
                            <button class="min-w-0 truncate font-mono text-[var(--accent-text)]" @click="void copyId(selectedNode.id)">{{ selectedNode.id }}</button>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Parent</span>
                            <button class="min-w-0 truncate font-mono text-[var(--text-secondary)]" @click="void copyId(selectedNode.parentId)">{{ selectedNode.parentId ?? "-" }}</button>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Type</span>
                            <span class="font-mono text-[var(--text-secondary)]">{{ selectedNode.type }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Children</span>
                            <span class="font-mono text-[var(--text-secondary)]">{{ selectedNode.childCount }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Status</span>
                            <span class="text-[var(--text-secondary)]">{{ selectedNode.active ? "active path" : "inactive" }} · {{ selectedNode.terminal ? "terminal" : "branch" }}</span>
                        </div>
                    </div>
                </div>
                <div v-else class="flex flex-1 items-center justify-center px-4 text-sm text-[var(--text-muted)]">
                    选择一个节点查看详情
                </div>
                <div class="border-t border-[var(--border-color)] px-4 py-3">
                    <button class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.running || !selectedNode" @click="activateSelected">
                        <span class="i-lucide-git-branch h-4 w-4"></span>
                        切换到此节点
                    </button>
                </div>
            </aside>
        </div>
    </Dialog>
</template>
