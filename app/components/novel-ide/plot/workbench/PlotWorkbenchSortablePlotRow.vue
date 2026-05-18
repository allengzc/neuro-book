<script setup lang="ts">
import {computed, ref} from "vue";
import {useSortable} from "@dnd-kit/vue/sortable";
import {
    PLOT_KIND_LABELS,
    type PlotThreadPanelPlot,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

const props = defineProps<{
    plot: PlotThreadPanelPlot;
    index: number;
    sceneId: string;
    canMoveUp: boolean;
    canMoveDown: boolean;
}>();

const emit = defineEmits<{
    (e: "editPlot", plotId: string): void;
    (e: "deletePlot", plotId: string): void;
    (e: "movePlot", payload: {sceneId: string; plotId: string; direction: "up" | "down"}): void;
}>();

const elementRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);

/**
 * 注册工作台 Plot 行拖拽排序。
 */
const {isDragging, isDropTarget} = useSortable({
    id: computed(() => props.plot.id),
    index: computed(() => props.index),
    group: computed(() => `workbench-plot:${props.sceneId}`),
    type: "workbench-plot",
    accept: "workbench-plot",
    data: computed(() => ({
        kind: "plot" as const,
        plotId: props.plot.id,
        sceneId: props.sceneId,
    })),
    element: elementRef,
    handle: handleRef,
    feedback: "default",
});

/**
 * 卡片只展示 inline ref 的标题，Markdown 源码仍由 Inspector 保留。
 */
function displayInlineText(text: string | null): string {
    return (text ?? "").replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
}
</script>

<template>
    <!-- 工作台可排序 Plot 行 -->
    <div
        ref="elementRef"
        :data-workbench-plot-id="props.plot.id"
        :data-workbench-plot-scene-id="props.sceneId"
        :data-dragging="isDragging || undefined"
        :data-drop-target="isDropTarget || undefined"
        class="plot-workbench-plot-row group/plot grid w-full grid-cols-[16px_56px_minmax(0,1fr)_104px] items-start gap-2.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-left transition-colors hover:border-amber-500/40 hover:bg-[var(--bg-hover)] hover:shadow-sm"
    >
        <button ref="handleRef" type="button" class="mt-[1px] inline-flex h-5 w-4 cursor-grab items-center justify-center rounded text-[var(--text-muted)] opacity-50 transition-opacity hover:bg-[var(--bg-hover)] group-hover/plot:opacity-100 active:cursor-grabbing" title="拖拽排序 Plot" @click.stop>
            <span class="i-lucide-grip-vertical h-4 w-4"></span>
        </button>
        <span class="plot-kind-chip flex h-[20px] shrink-0 items-center justify-center rounded text-[10px] font-semibold">
            {{ PLOT_KIND_LABELS[props.plot.kind] || props.plot.kind }}
        </span>
        <div class="min-w-0">
            <p class="whitespace-pre-wrap text-[12px] font-medium leading-snug text-[var(--text-main)]">{{ displayInlineText(props.plot.summary) }}</p>
            <div v-if="props.plot.effect" class="mt-1 flex items-start gap-1.5 rounded-md bg-[var(--bg-main)]/60 px-2 py-1.5">
                <span class="i-lucide-info mt-0.5 h-3 w-3 shrink-0 text-[var(--text-muted)]"></span>
                <p class="whitespace-pre-wrap text-[11px] leading-snug text-[var(--text-secondary)]">{{ displayInlineText(props.plot.effect) }}</p>
            </div>
        </div>
        <div class="flex justify-end gap-0.5">
            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]" title="上移 Plot" :disabled="!props.canMoveUp" @click.stop="emit('movePlot', {sceneId: props.sceneId, plotId: props.plot.id, direction: 'up'})">
                <span class="i-lucide-arrow-up h-3.5 w-3.5"></span>
            </button>
            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]" title="下移 Plot" :disabled="!props.canMoveDown" @click.stop="emit('movePlot', {sceneId: props.sceneId, plotId: props.plot.id, direction: 'down'})">
                <span class="i-lucide-arrow-down h-3.5 w-3.5"></span>
            </button>
            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="编辑 Plot" @click.stop="emit('editPlot', props.plot.id)">
                <span class="i-lucide-pencil-line h-3.5 w-3.5"></span>
            </button>
            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-600" title="删除 Plot" @click.stop="emit('deletePlot', props.plot.id)">
                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
            </button>
        </div>
    </div>
</template>

<style scoped>
.plot-workbench-plot-row[data-dragging="true"] {
    opacity: 1 !important;
    background: var(--bg-panel) !important;
}

.plot-kind-chip {
    opacity: 1 !important;
    background: color-mix(in srgb, var(--bg-panel) 82%, var(--accent-main) 18%);
    color: var(--text-main);
    border: 1px solid color-mix(in srgb, var(--border-color) 82%, var(--accent-main) 18%);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--bg-main) 72%, transparent);
}

.plot-workbench-plot-row[data-dragging="true"] .plot-kind-chip {
    opacity: 1 !important;
    background: color-mix(in srgb, var(--bg-panel) 78%, var(--accent-main) 22%);
    color: var(--text-main);
}

.plot-workbench-plot-row[data-drop-target="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 48%, transparent);
}
</style>
