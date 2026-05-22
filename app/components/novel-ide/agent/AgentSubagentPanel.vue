<script setup lang="ts">
import type { AgentSubagentSummaryDto, AgentThreadSummaryDto } from "nbook/shared/dto/agent-chat.dto";

type AgentThreadKind = "leader" | "subagent";
type AgentThreadStatus = "idle" | "running" | "waiting_user" | "completed" | "stopped" | "failed";

const props = defineProps<{
    threadId: string;
    activeThreadKind: AgentThreadKind;
    subagents: AgentSubagentSummaryDto[];
    leaders?: AgentThreadSummaryDto[];
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "create", profileKey: string, title?: string): void;
    (e: "attach", subagentThreadId: string): void;
    (e: "select", threadId: string): void;
    (e: "refresh"): void;
    (e: "close"): void;
}>();

const showCreateForm = ref(false);
const showAttachForm = ref(false);

const newProfileKey = ref("subagent.writer");
const newTitle = ref("");
const attachThreadId = ref("");

const confirmCreate = () => {
    emit("create", newProfileKey.value, newTitle.value || undefined);
    showCreateForm.value = false;
    newTitle.value = "";
};

const confirmAttach = () => {
    if (!attachThreadId.value.trim()) return;
    emit("attach", attachThreadId.value.trim());
    showAttachForm.value = false;
    attachThreadId.value = "";
};

const profileLabel = (profileKey: string) => {
    switch(profileKey) {
        case "subagent.writer": return "写手节点";
        case "subagent.retrieval": return "内容节点召回";
        case "leader.default": return "主线调度";
        default: return profileKey;
    }
};

const statusDotClass = (status: AgentThreadStatus) => {
    switch (status) {
        case "running": return "bg-blue-500 animate-pulse";
        case "waiting_user": return "bg-amber-500 animate-pulse";
        case "failed": return "bg-red-500";
        case "completed": return "bg-green-500";
        default: return "bg-[var(--text-muted)]";
    }
};

const statusLabel = (status: AgentThreadStatus) => {
    switch (status) {
        case "running": return "执行中";
        case "waiting_user": return "等待输入";
        case "failed": return "失败";
        case "completed": return "已完成";
        default: return "闲置";
    }
};

const listToShow = computed(() => {
    if (props.activeThreadKind === "subagent") {
        return props.leaders || [];
    }
    return props.subagents;
});
</script>

<template>
    <div class="border-b border-[var(--border-color)] bg-[var(--bg-main)] p-4 shadow-sm z-10 sticky top-0 flex flex-col gap-3">
        <!-- Title and actions -->
        <div class="flex items-center justify-between">
            <span class="text-xs font-semibold tracking-wider text-[var(--accent-text)] flex items-center gap-2">
                <span :class="activeThreadKind === 'subagent' ? 'i-lucide-network' : 'i-lucide-boxes'" class="h-4 w-4"></span>
                {{ activeThreadKind === 'subagent' ? '所属主线任务' : '关联协作节点' }}
            </span>
            <div class="flex gap-1.5 shrink-0">
                <template v-if="activeThreadKind === 'leader'">
                    <button
                        class="rounded px-2.5 py-1 text-xs font-medium transition-colors border border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]"
                        :class="{'bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-main)]': showCreateForm}"
                        @click="showCreateForm = !showCreateForm; showAttachForm = false"
                        :disabled="props.loading"
                    >
                        新建
                    </button>
                    <button
                        class="rounded px-2.5 py-1 text-xs font-medium transition-colors border border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]"
                        :class="{'bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-main)]': showAttachForm}"
                        @click="showAttachForm = !showAttachForm; showCreateForm = false"
                        :disabled="props.loading"
                    >
                        挂载
                    </button>
                </template>
                <button class="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] w-6 h-6 ml-1 flex items-center justify-center transition-colors" @click="emit('close')">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </div>

        <!-- Create Form -->
        <div v-if="showCreateForm && activeThreadKind === 'leader'" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 space-y-3 text-sm shadow-sm">
            <div class="flex gap-2">
                <select v-model="newProfileKey" class="w-1/3 min-w-[120px] rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 outline-none text-xs transition-colors focus:border-[var(--accent-main)]">
                    <option value="subagent.writer">写手节点 (Drafter)</option>
                    <option value="subagent.retrieval">内容节点召回 (Retrieval)</option>
                </select>
                <input v-model="newTitle" placeholder="可选：自定义标题名称" class="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 outline-none text-xs transition-colors focus:border-[var(--accent-main)] placeholder-[var(--text-muted)]" />
            </div>
            <div class="flex justify-end gap-2">
                <button class="rounded px-3 py-1 text-xs text-[var(--text-secondary)] border border-[var(--border-color)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] transition-colors" @click="showCreateForm = false">取消</button>
                <button class="rounded px-4 py-1 text-xs font-medium bg-[var(--text-main)] text-[var(--bg-main)] hover:opacity-90 transition-opacity" @click="confirmCreate" :disabled="props.loading">确认创建</button>
            </div>
        </div>

        <!-- Attach Form -->
        <div v-if="showAttachForm && activeThreadKind === 'leader'" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 flex gap-2 items-center shadow-sm">
            <input v-model="attachThreadId" placeholder="输入已有节点 Thread ID..." class="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 outline-none text-xs font-mono transition-colors focus:border-[var(--accent-main)] placeholder-[var(--text-muted)]" />
            <button class="shrink-0 rounded px-3 py-1.5 text-xs text-[var(--text-secondary)] border border-[var(--border-color)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] transition-colors" @click="showAttachForm = false">取消</button>
            <button class="shrink-0 rounded px-4 py-1.5 text-xs font-medium bg-[var(--text-main)] text-[var(--bg-main)] hover:opacity-90 transition-opacity disabled:opacity-50" @click="confirmAttach" :disabled="props.loading || !attachThreadId.trim()">挂载</button>
        </div>

        <!-- Thread List -->
        <div v-if="listToShow.length > 0" class="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            <div v-for="item in listToShow" :key="item.id" class="group flex items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 cursor-pointer transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--accent-main)] hover:shadow-sm" @click="emit('select', item.id)">
                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:border-[var(--accent-main)]">
                    <span class="h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]" :class="activeThreadKind === 'subagent' ? 'i-lucide-sparkles' : 'i-lucide-bot'"></span>
                </div>
                <div class="min-w-0 flex-1 flex flex-col justify-center">
                    <div class="flex items-center gap-2">
                        <span class="truncate text-xs font-medium text-[var(--text-main)] group-hover:text-[var(--accent-main)] transition-colors">{{ item.title || '未命名' }}</span>
                        <span class="text-[10px] text-[var(--text-muted)] bg-[var(--bg-input)] rounded px-1.5 py-0.5 border border-transparent group-hover:border-[var(--accent-main)]/20 transition-colors">{{ profileLabel(item.profileKey) }}</span>
                    </div>
                    <div class="text-[10px] text-[var(--text-muted)] font-mono truncate opacity-70 mt-0.5">ID: {{ item.id }}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0 bg-[var(--bg-input)] rounded px-2 py-1 border border-[var(--border-color)] group-hover:border-[var(--accent-main)]/30 transition-colors">
                    <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(item.status)"></span>
                    <span class="text-[10px] text-[var(--text-main)] font-medium">{{ statusLabel(item.status) }}</span>
                </div>
            </div>
        </div>

        <!-- Empty State -->
        <div v-else class="text-center rounded-lg border border-dashed border-[var(--border-color)] py-8 text-xs text-[var(--text-muted)] bg-[var(--bg-panel)]">
            <template v-if="activeThreadKind === 'subagent'">
                当前节点未挂载到任何主线任务。
            </template>
            <template v-else>
                该主线暂无协作节点。<br/>请通过上方按钮新建或挂载已有节点。
            </template>
        </div>
    </div>
</template>
