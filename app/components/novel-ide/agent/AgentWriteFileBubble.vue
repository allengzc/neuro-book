<script setup lang="ts">
import { computed } from "vue";
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/AgentMarkdownContent.vue";
import { extractStreamingStringField, parseToolArgsObject } from "nbook/app/components/novel-ide/agent/tool-args-stream";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();


interface WriteFileArgs {
    path?: string;
    content?: string;
}

const parsedArgs = computed<WriteFileArgs>(() => {
    const parsed = parseToolArgsObject<WriteFileArgs>(props.toolCall.argsJson ?? props.toolCall.argsText);
    return parsed ?? {};
});

const filePathText = computed(() => parsedArgs.value.path ?? extractStreamingStringField(props.toolCall.argsText, "path"));
const contentText = computed(() => parsedArgs.value.content ?? extractStreamingStringField(props.toolCall.argsText, "content"));

</script>

<template>
    <div class="mt-2 space-y-3">
        <!-- Tool 目标路径 -->
        <div class="flex items-center gap-2">
            <span class="rounded bg-[var(--bg-main)] px-2 py-1 font-mono text-[11px] text-[var(--accent-main)] border border-[var(--accent-main)]/30">
                <span class="i-lucide-file-code h-3 w-3 mr-1 inline-block align-text-bottom"></span>
                {{ filePathText || "解析路径中..." }}
            </span>
            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">overwrite</span>
        </div>
        
        <!-- Content Preview：content 在流式阶段实时增长 -->
        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)]/50 p-4">
            <div class="text-sm leading-relaxed text-[var(--text-main)]">
                <AgentMarkdownContent :content="contentText || '...'" />
            </div>
        </div>

        <div v-if="props.toolCall.error" class="break-all whitespace-pre-wrap rounded border border-rose-500/30 bg-rose-500/5 p-2 font-mono text-xs text-rose-500 mt-2">
            {{ props.toolCall.error }}
        </div>
        
        <div v-if="props.toolCall.status === 'success'" class="flex items-center text-[11px] text-green-500/80 mt-2 gap-1.5 font-medium">
            <span class="i-lucide-check-circle h-3.5 w-3.5"></span>
            文件写入成功
        </div>
    </div>
</template>

