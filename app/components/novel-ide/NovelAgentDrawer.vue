<script setup lang="ts">
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import type {AgentWorkspaceSyncPayload} from "nbook/app/stores/novel-ide";
import AgentChatSurface from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";

const MIN_DRAWER_WIDTH = 320;
const MAX_DRAWER_WIDTH = 720;

const props = defineProps<{
    isOpen: boolean;
    width: number;
    novelId: string;
    selectedFilePath?: string;
}>();

const emit = defineEmits<{
    (e: "update:width", value: number): void;
    (e: "close"): void;
    (e: "sync-workspace", payload: AgentWorkspaceSyncPayload): void;
}>();

const resizeHandleRef = ref<HTMLElement | null>(null);

const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: MIN_DRAWER_WIDTH,
    maxSize: MAX_DRAWER_WIDTH,
    edge: "left",
    enabled: computed(() => props.isOpen),
    onResize: (width) => emit("update:width", width),
});

const drawerStyle = computed(() => props.isOpen ? panelStyle.value : {width: "0px"});
</script>

<template>
    <!-- IDE 右侧 Agent 槽位壳 -->
    <aside
        class="relative z-30 flex h-full shrink-0 flex-col bg-[var(--bg-panel)] shadow-2xl transition-all duration-300"
        :class="[props.isOpen ? 'border-l border-[var(--border-color)] opacity-100' : 'pointer-events-none border-l-0 opacity-0', isResizing ? 'select-none transition-none' : '']"
        :style="drawerStyle"
    >
        <template v-if="props.isOpen">
            <!-- 宽度拖拽手柄 -->
            <div ref="resizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="isResizing ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
            </div>

            <AgentChatSurface
                class="min-h-0 flex-1"
                active
                layout="drawer"
                :novel-id="props.novelId"
                :selected-file-path="props.selectedFilePath"
                @close="emit('close')"
                @sync-workspace="emit('sync-workspace', $event)"
            />
        </template>
    </aside>
</template>
