<script setup lang="ts">
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

type CreateAgentArgs = {
    profileKey?: string;
    title?: string;
};

type CreateAgentResult = {
    sessionId?: number;
    profileKey?: string;
    title?: string;
};

/**
 * 解析 create_agent 的调用参数。
 */
const args = computed<CreateAgentArgs>(() => {
    try {
        return JSON.parse(props.toolCall.argsJson ?? "{}") as CreateAgentArgs;
    } catch {
        return {};
    }
});

/**
 * 解析 create_agent 的返回结果。
 */
const result = computed<CreateAgentResult>(() => {
    try {
        return JSON.parse(props.toolCall.result ?? "{}") as CreateAgentResult;
    } catch {
        return {};
    }
});

/**
 * 人类可读的 Agent 类型标签。
 */
const profileLabel = computed(() => {
    const profileKey = result.value.profileKey ?? args.value.profileKey;
    return profileKey ?? "Unknown";
});

/**
 * 展示标题。优先展示结果中的真实标题。
 */
const title = computed(() => {
    return result.value.title ?? args.value.title ?? "未命名";
});

/**
 * 展示 linked session ID。
 */
const linkedSessionId = computed(() => {
    return result.value.sessionId ?? props.toolCall.linkedSessionId ?? null;
});

/**
 * 当前创建状态文案。
 */
const statusLabel = computed(() => {
    switch (props.toolCall.status) {
        case "running":
        case "streaming":
            return "创建中";
        case "error":
            return "创建失败";
        case "success":
            return "已创建";
        default:
            return "未知状态";
    }
});
</script>

<template>
    <!-- create_agent 专用卡片 -->
    <div class="mt-2 space-y-3">
        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                    <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-users h-4 w-4"></span>
                    </div>
                    <div class="min-w-0">
                        <div class="text-sm font-medium text-[var(--text-main)]">创建 Agent</div>
                        <div class="truncate text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ statusLabel }}</div>
                    </div>
                </div>
                <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[10px] font-medium text-[var(--text-muted)]">
                    {{ profileLabel }}
                </span>
            </div>

            <div class="mt-3 grid gap-2 text-xs text-[var(--text-secondary)]">
                <div class="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-input)] px-3 py-2">
                    <span class="shrink-0 text-[var(--text-muted)]">标题</span>
                    <span class="text-right text-[var(--text-main)]">{{ title }}</span>
                </div>
                <div class="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-input)] px-3 py-2">
                    <span class="shrink-0 text-[var(--text-muted)]">Session</span>
                    <span class="font-mono text-right text-[var(--text-main)]">
                        {{ linkedSessionId ? `#${String(linkedSessionId).slice(-6)}` : "等待返回" }}
                    </span>
                </div>
            </div>
        </div>

        <div v-if="props.toolCall.error" class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 font-mono text-xs text-rose-500">
            {{ props.toolCall.error }}
        </div>

        <div v-if="!result.sessionId && props.toolCall.result" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Raw Result</div>
            <div class="break-all whitespace-pre-wrap font-mono text-xs text-[var(--text-secondary)]">
                {{ props.toolCall.result }}
            </div>
        </div>
    </div>
</template>
