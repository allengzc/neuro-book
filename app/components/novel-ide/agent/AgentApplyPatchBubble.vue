<script setup lang="ts">
import { computed } from "vue";
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import {
    extractStreamingNumberField,
    extractStreamingStringField,
    extractStreamingTextField,
    parseToolArgsObject,
} from "nbook/app/components/novel-ide/agent/tool-args-stream";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

interface ApplyPatchArgs {
    path?: string;
    patch?: string;
    fuzzFactor?: number;
}

/** apply_patch 的 patch 文本通常较长，需要优先展示已解析出的 patch 内容。 */
const parsedArgs = computed<ApplyPatchArgs>(() => {
    const parsed = parseToolArgsObject<ApplyPatchArgs>(props.toolCall.argsJson ?? props.toolCall.argsText);
    return parsed ?? {};
});

const filePathText = computed(() => parsedArgs.value.path ?? extractStreamingStringField(props.toolCall.argsText, "path"));
const patchText = computed(() => parsedArgs.value.patch ?? extractStreamingTextField(props.toolCall.argsText, "patch"));
const fuzzFactorText = computed(() => {
    if (typeof parsedArgs.value.fuzzFactor === "number") {
        return String(parsedArgs.value.fuzzFactor);
    }
    const extracted = extractStreamingNumberField(props.toolCall.argsText, "fuzzFactor");
    return extracted === null ? "" : String(extracted);
});
</script>

<template>
    <div class="mt-2 space-y-3">
        <!-- Tool 目标路径 -->
        <div class="flex flex-wrap items-center gap-2">
            <span class="rounded border border-[var(--accent-main)]/30 bg-[var(--bg-main)] px-2 py-1 font-mono text-[11px] text-[var(--accent-main)]">
                <span class="mr-1 inline-block h-3 w-3 align-text-bottom i-lucide-file-diff"></span>
                {{ filePathText || "解析路径中..." }}
            </span>
            <span v-if="fuzzFactorText" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                fuzz: {{ fuzzFactorText }}
            </span>
        </div>

        <!-- Patch Preview -->
        <div class="rounded border border-[var(--border-color)] bg-[var(--bg-main)]/60">
            <div class="border-b border-[var(--border-color)]/50 px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Patch</div>
            <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-[var(--text-secondary)]">{{ patchText || "..." }}</pre>
        </div>

        <div v-if="props.toolCall.error" class="mt-2 break-all whitespace-pre-wrap rounded border border-rose-500/30 bg-rose-500/5 p-2 font-mono text-xs text-rose-500">
            {{ props.toolCall.error }}
        </div>

        <div v-if="props.toolCall.status === 'success'" class="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-green-500/80">
            <span class="i-lucide-check-circle h-3.5 w-3.5"></span>
            补丁应用成功
        </div>
    </div>
</template>
