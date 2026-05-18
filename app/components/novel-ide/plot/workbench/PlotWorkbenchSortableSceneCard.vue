<script setup lang="ts">
import {computed, ref} from "vue";
import {useSortable} from "@dnd-kit/vue/sortable";
import {
    PLOT_SCENE_STATUS_LABELS,
    type PlotThreadPanelChapter,
    type PlotThreadPanelScene,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";

const props = defineProps<{
    scene: PlotThreadPanelScene;
    index: number;
    threadId: string;
    chapter: PlotThreadPanelChapter | null;
    plotCount: number;
    expanded: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
}>();

const emit = defineEmits<{
    (e: "editScene", sceneId: string): void;
    (e: "toggleScene", sceneId: string): void;
    (e: "moveScene", payload: {sceneId: string; direction: "up" | "down"}): void;
}>();

const elementRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);

/**
 * 注册工作台 Scene 卡片拖拽排序。
 */
const {isDragging, isDropTarget} = useSortable({
    id: computed(() => props.scene.id),
    index: computed(() => props.index),
    group: computed(() => `workbench-scene:${props.threadId}`),
    type: "workbench-scene",
    accept: "workbench-scene",
    data: computed(() => ({
        kind: "scene" as const,
        sceneId: props.scene.id,
        threadId: props.threadId,
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
    <!-- 工作台可排序 Scene 卡片 -->
    <article
        ref="elementRef"
        :data-workbench-scene-id="props.scene.id"
        :data-dragging="isDragging || undefined"
        :data-drop-target="isDropTarget || undefined"
        class="plot-workbench-scene-card group flex flex-col rounded-xl border bg-[var(--bg-panel)] transition-all duration-200"
        :class="props.expanded ? 'border-amber-500/40 shadow-[0_8px_24px_rgba(15,23,42,0.06)] ring-1 ring-amber-500/10' : 'border-[var(--border-color)] hover:border-[var(--border-color-hover)] shadow-sm hover:shadow-md'"
    >
        <div class="flex items-start gap-3 p-3.5">
            <!-- 拖拽手柄与序号 -->
            <div class="flex shrink-0 flex-col items-center gap-2 pt-0.5">
                <span class="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-color)] bg-[var(--bg-main)]/80 text-[12px] font-semibold text-[var(--text-secondary)] shadow-sm">
                    {{ props.index + 1 }}
                </span>
                <button ref="handleRef" type="button" class="flex cursor-grab items-center justify-center rounded py-1 opacity-40 transition-opacity hover:bg-[var(--bg-hover)] hover:opacity-100 group-hover:opacity-70 active:cursor-grabbing" title="拖拽排序 Scene" @click.stop>
                    <span class="i-lucide-grip-vertical h-4 w-4 text-[var(--text-muted)]"></span>
                </button>
            </div>

            <!-- 主体内容 -->
            <div class="flex min-w-0 flex-1 flex-col">
                <div class="flex items-start justify-between gap-4">
                    <!-- 标题与元数据 -->
                    <div class="flex min-w-0 flex-col gap-1.5">
                        <div class="flex items-center gap-2.5">
                            <h3 class="truncate text-[15px] font-semibold tracking-tight text-[var(--text-main)]">{{ props.scene.title }}</h3>
                            <span class="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
                                {{ PLOT_SCENE_STATUS_LABELS[props.scene.status] }}
                            </span>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-medium text-[var(--text-muted)]">
                            <span class="flex items-center gap-1.5">
                                <span class="i-lucide-book-open h-3.5 w-3.5 opacity-70"></span>
                                {{ props.chapter ? props.chapter.numberLabel : "未挂章" }}
                            </span>
                            <span class="flex items-center gap-1.5">
                                <span class="i-lucide-hash h-3.5 w-3.5 opacity-70"></span>
                                #{{ props.scene.threadSortOrder + 1 }}
                            </span>
                            <span class="flex items-center gap-1.5">
                                <span class="i-lucide-layers h-3.5 w-3.5 opacity-70"></span>
                                {{ props.plotCount }} Plots
                            </span>
                        </div>
                    </div>
                    
                    <!-- 右侧操作区 -->
                    <div class="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                        <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]" title="上移 Scene" :disabled="!props.canMoveUp" @click.stop="emit('moveScene', {sceneId: props.scene.id, direction: 'up'})">
                            <span class="i-lucide-arrow-up h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]" title="下移 Scene" :disabled="!props.canMoveDown" @click.stop="emit('moveScene', {sceneId: props.scene.id, direction: 'down'})">
                            <span class="i-lucide-arrow-down h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="编辑 Scene" @click.stop="emit('editScene', props.scene.id)">
                            <span class="i-lucide-pencil-line h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="更多操作">
                            <span class="i-lucide-more-vertical h-4 w-4"></span>
                        </button>
                        <span class="mx-1 h-3.5 w-[1px] bg-[var(--border-color)]"></span>
                        <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200" :class="props.expanded ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'" :title="props.expanded ? '收起 Plots' : '展开 Plots'" @click.stop="emit('toggleScene', props.scene.id)">
                            <span class="i-lucide-chevron-down h-4 w-4 transition-transform duration-200" :class="props.expanded ? 'rotate-180' : ''"></span>
                        </button>
                    </div>
                </div>

                <!-- 场景摘要框 -->
                <div v-if="props.scene.summary" class="mt-3 rounded-lg bg-[var(--bg-main)]/40 transition-colors group-hover:bg-[var(--bg-main)]/60">
                    <div class="px-3 py-2.5">
                        <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-secondary)]">{{ displayInlineText(props.scene.summary) }}</p>
                    </div>
                </div>
                <div v-else class="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--border-color)] bg-transparent px-3 py-2 text-[12px] text-[var(--text-muted)] opacity-0 transition-all hover:bg-[var(--bg-main)]/30 hover:text-[var(--text-main)] group-hover:opacity-100" @click.stop="emit('editScene', props.scene.id)">
                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                    添加场景摘要...
                </div>
            </div>
        </div>

        <slot />
    </article>
</template>

<style scoped>
.plot-workbench-scene-card[data-drop-target="true"] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 48%, transparent);
}
</style>
