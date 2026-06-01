<script setup lang="ts">
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    sessions: AgentSessionSummaryDto[];
    activeSessionId: number | null;
    loading: boolean;
    running: boolean;
    actionId: number | null;
    workspaceKey: string;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: number): void;
    (e: "create"): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "refresh"): void;
}>();

const searchQuery = ref("");
const pinnedSessionIds = ref<number[]>([]);

const storageKey = computed(() => `agent:pinned-sessions:${props.workspaceKey}`);
const pinnedSet = computed(() => new Set(pinnedSessionIds.value));
const filteredSessions = computed(() => {
    const keyword = searchQuery.value.trim().toLowerCase();
    const source = keyword
        ? props.sessions.filter((session) => {
            return (session.title?.toLowerCase().includes(keyword)
                || session.summary?.toLowerCase().includes(keyword)
                || session.lastMessagePreview?.toLowerCase().includes(keyword)
                || session.profileKey.toLowerCase().includes(keyword)
                || String(session.sessionId).includes(keyword));
        })
        : props.sessions;
    return [...source].sort((left, right) => {
        const leftPinned = pinnedSet.value.has(left.sessionId);
        const rightPinned = pinnedSet.value.has(right.sessionId);
        if (leftPinned !== rightPinned) {
            return leftPinned ? -1 : 1;
        }
        return right.updatedAt - left.updatedAt;
    });
});

/**
 * 读取当前 Project Workspace 的本机会话置顶偏好。
 */
function loadPinnedSessions(): void {
    if (!import.meta.client) {
        return;
    }
    try {
        const raw = localStorage.getItem(storageKey.value);
        const parsed = raw ? JSON.parse(raw) : [];
        pinnedSessionIds.value = Array.isArray(parsed)
            ? parsed.filter((value): value is number => Number.isInteger(value) && value > 0)
            : [];
    } catch {
        pinnedSessionIds.value = [];
    }
}

/**
 * 保存当前 Project Workspace 的本机会话置顶偏好。
 */
function savePinnedSessions(): void {
    if (!import.meta.client) {
        return;
    }
    localStorage.setItem(storageKey.value, JSON.stringify(pinnedSessionIds.value));
}

/**
 * 切换 session 在本机列表中的置顶状态。
 */
function togglePin(sessionId: number): void {
    pinnedSessionIds.value = pinnedSet.value.has(sessionId)
        ? pinnedSessionIds.value.filter((id) => id !== sessionId)
        : [sessionId, ...pinnedSessionIds.value];
    savePinnedSessions();
}

/**
 * 返回 session 展示标题。
 */
function sessionTitle(session: AgentSessionSummaryDto): string {
    return session.title || `Session #${String(session.sessionId)}`;
}

/**
 * 返回 session 预览文本。
 */
function sessionPreview(session: AgentSessionSummaryDto): string {
    return session.summary || session.lastMessagePreview || "暂无消息";
}

/**
 * 判断 session 是否允许归档。
 */
function canArchiveSession(session: AgentSessionSummaryDto): boolean {
    return session.status !== "running" && session.status !== "waiting";
}

/**
 * 返回 session 状态的中文标签。
 */
function statusLabel(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return "运行中";
        case "waiting": return "等待";
        case "interrupted": return "中断";
        case "archived": return "归档";
        default: return "闲置";
    }
}

/**
 * 返回 session 状态样式。
 */
function statusClass(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return "border-blue-500/35 bg-blue-500/10 text-blue-600 dark:text-blue-300";
        case "waiting": return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
        case "interrupted": return "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300";
        case "archived": return "border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]";
        default: return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
    }
}

watch(storageKey, loadPinnedSessions, {immediate: true});
</script>

<template>
    <!-- Agent Mode 左侧 session 导航 -->
    <aside class="flex h-full w-[300px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-3">
            <div class="min-w-0">
                <div class="text-sm font-semibold text-[var(--text-main)]">Agent Sessions</div>
                <div class="text-[11px] text-[var(--text-muted)]">当前 Project Workspace</div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                <button type="button" class="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40" title="刷新" :disabled="loading" @click="emit('refresh')">
                    <span class="i-lucide-refresh-cw h-4 w-4"></span>
                </button>
                <button type="button" class="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-text)] hover:opacity-80 disabled:opacity-40" title="新建对话" :disabled="loading || Boolean(actionId)" @click="emit('create')">
                    <span class="i-lucide-plus h-4 w-4"></span>
                </button>
            </div>
        </div>

        <div class="shrink-0 border-b border-[var(--border-color)] p-3">
            <div class="flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5">
                <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                <input v-model="searchQuery" type="text" placeholder="搜索会话..." class="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]">
            </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            <button
                v-for="session in filteredSessions"
                :key="session.sessionId"
                type="button"
                class="group mb-1.5 flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
                :class="session.sessionId === activeSessionId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]/50' : 'border-transparent bg-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                @click="emit('select', session.sessionId)"
            >
                <span :class="pinnedSet.has(session.sessionId) ? 'i-lucide-pin text-[var(--accent-text)]' : 'i-lucide-message-square text-[var(--text-muted)]'" class="mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-1.5">
                        <span class="truncate text-[12px] font-medium text-[var(--text-main)]">{{ sessionTitle(session) }}</span>
                        <span class="shrink-0 rounded border px-1 py-0.5 text-[9px]" :class="statusClass(session.status)">{{ statusLabel(session.status) }}</span>
                    </span>
                    <span class="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-[var(--text-secondary)]">{{ sessionPreview(session) }}</span>
                    <span class="mt-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        <span class="font-mono">#{{ session.sessionId }}</span>
                        <span>{{ formatTimestamp(session.updatedAt) }}</span>
                    </span>
                </span>
                <span class="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-input)] hover:text-[var(--accent-text)]" :title="pinnedSet.has(session.sessionId) ? '取消置顶' : '置顶'" @click.stop="togglePin(session.sessionId)">
                        <span class="i-lucide-pin h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40" title="归档" :disabled="loading || actionId === session.sessionId || !canArchiveSession(session)" @click.stop="emit('archive', session)">
                        <span v-if="actionId === session.sessionId" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                        <span v-else class="i-lucide-archive h-3.5 w-3.5"></span>
                    </button>
                </span>
            </button>

            <div v-if="filteredSessions.length === 0" class="mt-6 rounded-md border border-dashed border-[var(--border-color)] px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
                没有匹配的会话
            </div>
        </div>
    </aside>
</template>
