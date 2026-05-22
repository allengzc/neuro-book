<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";

const props = defineProps<{
    modelValue: boolean;
    sessions: AgentSessionSummaryDto[];
    activeSessionId: number | null;
    loading: boolean;
    running: boolean;
    actionId: number | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", sessionId: number): void;
    (e: "create"): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
}>();

const sessionSearch = ref("");

const filteredSessions = computed(() => {
    return props.sessions.filter((session) => {
        if (!sessionSearch.value) return true;
        return (session.title?.includes(sessionSearch.value) || session.summary?.includes(sessionSearch.value));
    });
});

const sessionTitle = (session: AgentSessionSummaryDto) => session.title || `Session #${String(session.sessionId)}`;
const sessionPreview = (session: AgentSessionSummaryDto) => session.lastMessagePreview || session.summary || "No recent messages";
const canArchiveSession = (session: AgentSessionSummaryDto): boolean => session.status !== "running" && session.status !== "waiting";

const close = () => {
    emit("update:modelValue", false);
};
</script>

<template>
    <Dialog :model-value="props.modelValue" title="Agent Sessions" width="560px" :show-cancel="false" @confirm="emit('create')" @update:model-value="emit('update:modelValue', $event)">
        <template #header>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-base font-semibold leading-snug tracking-wide text-[var(--text-main)]">Sessions</div>
                    <div class="truncate text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Select, Create, Archive</div>
                </div>
                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="close">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <div class="space-y-4 pt-4">
            <div class="flex items-center gap-2">
                <input
                    v-model="sessionSearch"
                    type="text"
                    placeholder="Search by title or summary..."
                    class="h-10 flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                />
                <button class="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-[var(--accent-bg)] px-3 text-sm text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:opacity-40" :disabled="loading || !!actionId" @click="emit('create')">
                    <span class="i-lucide-plus h-4 w-4"></span>
                    New
                </button>
            </div>

            <div class="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                <div
                    v-for="session in filteredSessions"
                    :key="session.sessionId"
                    class="flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors"
                    :class="session.sessionId === activeSessionId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]/40' : 'border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:bg-[var(--bg-hover)]'"
                    @click="emit('select', session.sessionId)"
                >
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium text-[var(--text-main)]">{{ sessionTitle(session) }}</span>
                            <span v-if="session.sessionId === activeSessionId" class="rounded border border-[var(--accent-main)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[var(--accent-text)]">Active</span>
                            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">{{ session.profileKey }}</span>
                        </div>
                        <div class="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{{ sessionPreview(session) }}</div>
                        <div class="mt-2 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
                            <span class="font-mono">#{{ session.sessionId }}</span> • {{ formatTimestamp(session.updatedAt) }}
                        </div>
                    </div>
                    <button class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40" :disabled="actionId === session.sessionId || loading || !canArchiveSession(session)" title="Archive" @click.stop="emit('archive', session)">
                        <span v-if="actionId === session.sessionId" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        <span v-else class="i-lucide-archive h-4 w-4"></span>
                    </button>
                </div>

                <div v-if="filteredSessions.length === 0" class="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    No matching sessions
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex w-full items-center justify-end">
                <button class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="close">Close</button>
            </div>
        </template>
    </Dialog>
</template>
