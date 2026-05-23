<script setup lang="ts">
import type {AgentLinkedSessionDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    sessionId: number | null;
    agents: AgentLinkedSessionDto[];
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: number): void;
    (e: "refresh"): void;
    (e: "close"): void;
}>();

const visibleAgents = computed(() => props.agents.filter((agent) => !agent.detached));

const profileLabel = (profileKey: string) => {
    switch(profileKey) {
        case "leader.default": return "主线调度";
        case "leader.assets": return "用户资产助手";
        default: return profileKey;
    }
};

const statusDotClass = (status: AgentLinkedSessionDto["status"]) => {
    switch (status) {
        case "running": return "animate-pulse bg-blue-500";
        case "waiting": return "animate-pulse bg-amber-500";
        case "interrupted": return "bg-rose-500";
        case "archived": return "bg-[var(--text-muted)]";
        default: return "bg-green-500";
    }
};

const statusLabel = (status: AgentLinkedSessionDto["status"]) => {
    switch (status) {
        case "running": return "执行中";
        case "waiting": return "等待输入";
        case "interrupted": return "已中断";
        case "archived": return "已归档";
        default: return "闲置";
    }
};
</script>

<template>
    <div class="sticky top-0 z-10 flex flex-col gap-3 border-b border-[var(--border-color)] bg-[var(--bg-main)] p-4 shadow-sm">
        <!-- Linked agents 标题栏 -->
        <div class="flex items-center justify-between">
            <span class="flex items-center gap-2 text-xs font-semibold tracking-wider text-[var(--accent-text)]">
                <span class="i-lucide-boxes h-4 w-4"></span>
                关联 Agent
            </span>
            <div class="flex shrink-0 gap-1.5">
                <button class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :disabled="props.loading" title="刷新" @click="emit('refresh')">
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                </button>
                <button class="ml-1 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </div>

        <!-- Linked agents 列表 -->
        <div v-if="visibleAgents.length > 0" class="max-h-[220px] space-y-2 overflow-y-auto pr-1">
            <div v-for="item in visibleAgents" :key="item.sessionId" class="group flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 transition-all hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:shadow-sm" @click="emit('select', item.sessionId)">
                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] transition-colors group-hover:border-[var(--accent-main)] group-hover:bg-[var(--accent-bg)]">
                    <span class="i-lucide-bot h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-main)]"></span>
                </div>
                <div class="flex min-w-0 flex-1 flex-col justify-center">
                    <div class="flex items-center gap-2">
                        <span class="truncate text-xs font-medium text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ item.title || `Agent #${item.sessionId}` }}</span>
                        <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ profileLabel(item.profileKey) }}</span>
                    </div>
                    <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)] opacity-70">sessionId: {{ item.sessionId }}</div>
                </div>
                <div class="flex shrink-0 items-center gap-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 transition-colors group-hover:border-[var(--accent-main)]/30">
                    <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(item.status)"></span>
                    <span class="text-[10px] font-medium text-[var(--text-main)]">{{ statusLabel(item.status) }}</span>
                </div>
            </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] py-8 text-center text-xs text-[var(--text-muted)]">
            当前 session 暂无关联 Agent。
        </div>
    </div>
</template>
