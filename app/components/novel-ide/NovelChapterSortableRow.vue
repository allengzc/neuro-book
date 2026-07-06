<script setup lang="ts">
import { useSortable } from "@dnd-kit/vue/sortable";
import type { ChapterSummaryDto } from "nbook/shared/dto/novel-chapter.dto";

const props = defineProps<{
    chapter: ChapterSummaryDto;
    volumeId: string;
    index: number;
    selected: boolean;
    dragDisabled: boolean;
    chapterLabel: string;
    statusLabel: string;
    statusClass: string;
}>();

const emit = defineEmits<{
    (e: "select", chapterId: string): void;
    (e: "edit", chapter: ChapterSummaryDto): void;
    (e: "delete", chapterId: string): void;
}>();

const elementRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);
const {t} = useI18n();

/**
 * 注册章节排序能力。
 */
const { isDragging, isDropTarget } = useSortable({
    id: computed(() => props.chapter.id),
    index: computed(() => props.index),
    group: computed(() => props.volumeId),
    type: "chapter",
    accept: "chapter",
    data: computed(() => ({
        kind: "chapter" as const,
        chapterId: props.chapter.id,
        volumeId: props.volumeId,
    })),
    element: elementRef,
    handle: handleRef,
    feedback: "default",
    disabled: computed(() => props.dragDisabled),
});
</script>

<template>
    <!-- 可拖拽章节行 -->
    <div
        ref="elementRef"
        :data-chapter-id="chapter.id"
        :data-dragging="isDragging || undefined"
        :data-drop-target="isDropTarget || undefined"
        class="chapter-row group flex w-full items-center rounded-3 px-2 py-1.5 pl-5 text-left text-xs transition-colors"
        :class="selected ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
        @click="emit('select', chapter.id)"
    >
        <button
            ref="handleRef"
            type="button"
            class="chapter-drag-handle mr-1.5 flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded-full text-[var(--text-muted)] opacity-50 transition-colors hover:bg-[var(--bg-input)] hover:opacity-100 disabled:cursor-not-allowed"
            :disabled="dragDisabled"
            :title="t('ide.chapterPanel.dragChapter')"
            @click.stop
        >
            <span class="i-lucide-grip-vertical h-3.5 w-3.5"></span>
        </button>
        <span class="w-12 shrink-0 font-medium opacity-80">{{ chapterLabel }}</span>
        <span class="flex-1 truncate pr-2 font-serif">{{ chapter.title }}</span>
        <span class="ml-2 w-10 shrink-0 text-right opacity-60">{{ chapter.wordCount }}</span>
        <span class="w-12 shrink-0 text-right" :class="statusClass">{{ statusLabel }}</span>
        <div class="ml-2 flex items-center gap-0.5">
            <button class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.chapterPanel.editChapter')" @click.stop="emit('edit', chapter)">
                <span class="i-lucide-settings-2 h-4 w-4"></span>
            </button>
            <button class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--text-secondary)] transition-all hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('ide.chapterPanel.deleteChapter')" @click.stop="emit('delete', chapter.id)">
                <span class="i-lucide-trash h-4 w-4"></span>
            </button>
        </div>
    </div>
</template>
