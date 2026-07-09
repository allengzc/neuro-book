<script setup lang="ts">
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import AgentToolNode from "nbook/app/components/novel-ide/agent/AgentToolNode.vue";
import {resolveToolRenderConfig} from "nbook/app/components/novel-ide/agent/tool-render-registry";
import { useCollapsible } from "nbook/app/composables/useCollapsible";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const emit = defineEmits<{
    (e: "copy", toolCall: AgentToolCall): void;
}>();

const { isCollapsed, toggle } = useCollapsible(true);

const renderConfig = computed(() => resolveToolRenderConfig(props.toolCall));
</script>

<template>
    <div v-if="renderConfig.mode === 'message' && renderConfig.component" class="group flex min-w-0 w-full flex-col items-stretch pl-6">
        <component :is="renderConfig.component" :tool-call="props.toolCall" />
    </div>
    <div v-else class="group flex min-w-0 w-full flex-col items-start pl-6">
        <AgentToolNode
            :tool-call="props.toolCall"
            :expanded="!isCollapsed"
            @toggle="toggle"
            @copy="emit('copy', props.toolCall)"
        />
    </div>
</template>
