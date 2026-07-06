<script setup lang="ts">
import { CollisionPriority } from "@dnd-kit/abstract";
import { useSortable } from "@dnd-kit/vue/sortable";
import type { ChapterStatusDto, ChapterSummaryDto } from "nbook/shared/dto/novel-chapter.dto";
import NovelChapterSortableRow from "nbook/app/components/novel-ide/NovelChapterSortableRow.vue";
import { type LocalVolume } from "nbook/app/components/novel-ide/novel-chapter-dnd";

const props = defineProps<{
    volume: LocalVolume;
    index: number;
    visibleChapters: ChapterSummaryDto[];
    selectedVolumeId: string;
    selectedChapterId: string;
    dragDisabled: boolean;
    creating: boolean;
    showInlineCreate: boolean;
    inlineTitle: string;
    chapterNumber: (sortOrder: number) => string;
    statusLabel: (status: ChapterStatusDto) => string;
    statusClass: (status: ChapterStatusDto) => string;
}>();

const emit = defineEmits<{
    (e: "toggle", volumeId: string): void;
    (e: "selectVolume", volumeId: string): void;
    (e: "startInlineCreate", volumeId: string): void;
    (e: "update:inlineTitle", value: string): void;
    (e: "confirmInlineCreate"): void;
    (e: "cancelInlineCreate"): void;
    (e: "selectChapter", chapterId: string): void;
    (e: "editChapter", chapter: ChapterSummaryDto): void;
    (e: "deleteChapter", chapterId: string): void;
    (e: "editVolume", volume: LocalVolume): void;
    (e: "deleteVolume", volume: LocalVolume): void;
}>();

const volumeRef = ref<HTMLElement | null>(null);
const volumeHandleRef = ref<HTMLElement | null>(null);
const inlineInputRef = ref<HTMLInputElement | null>(null);
const {t} = useI18n();

/**
 * 注册篇排序能力。
 */
const { isDragging, isDragSource, isDropTarget } = useSortable({
    id: computed(() => props.volume.id),
    index: computed(() => props.index),
    type: "volume",
    accept: ["volume", "chapter"],
    collisionPriority: CollisionPriority.Low,
    data: computed(() => ({
        kind: "volume" as const,
        volumeId: props.volume.id,
    })),
    element: volumeRef,
    handle: volumeHandleRef,
    feedback: "default",
    disabled: computed(() => props.dragDisabled),
});

watch(() => props.showInlineCreate, (visible) => {
    if (!visible) {
        return;
    }
    nextTick(() => inlineInputRef.value?.focus());
});
</script>

<template>
    <!-- 可拖拽篇卡片 -->
    <div
        ref="volumeRef"
        :data-volume-id="volume.id"
        :data-dragging="isDragging || undefined"
        :data-drag-source="isDragSource || undefined"
        :data-drop-target="isDropTarget && !isDragSource ? true : undefined"
        class="volume-card relative flex flex-col rounded-3 transition-colors duration-180 ease-out"
        :class="selectedVolumeId === volume.id ? 'bg-[var(--accent-bg)]/20' : ''"
    >
        <!-- 篇头 -->
        <div
            class="volume-card__header group flex items-center gap-2 rounded-3 border border-transparent px-2 py-1.5 transition-colors duration-180 ease-out"
            :class="[
                selectedVolumeId === volume.id ? 'border-[var(--accent-main)]/30 bg-[var(--accent-bg)]/40' : 'hover:bg-[var(--bg-hover)]',
                isDragSource ? 'border-[var(--accent-main)]/35 bg-[var(--accent-bg)]/35' : '',
                isDropTarget && !isDragSource ? 'border-[var(--accent-main)]/40 bg-[var(--accent-bg)]/45' : '',
            ]"
        >
            <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)]" :title="volume.isExpanded ? t('ide.chapterPanel.collapseVolume') : t('ide.chapterPanel.expandVolume')" @click.stop="emit('toggle', volume.id)">
                <span :class="volume.isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-4 w-4"></span>
            </button>
            <button
                ref="volumeHandleRef"
                type="button"
                class="volume-drag-handle flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] disabled:cursor-not-allowed"
                :disabled="dragDisabled"
                :title="t('ide.chapterPanel.dragVolume')"
            >
                <span class="i-lucide-grip-vertical h-4 w-4"></span>
            </button>
            <button type="button" class="flex min-w-0 flex-1 items-center justify-between gap-3 text-left" @click="emit('selectVolume', volume.id)">
                <span class="min-w-0 flex-1">
                    <span class="block truncate font-serif text-sm font-bold text-[var(--text-main)]">{{ volume.title }}</span>
                    <span class="block truncate text-[10px] text-[var(--text-muted)]">{{ volume.summary || t("ide.chapterPanel.noSummary") }}</span>
                </span>
            </button>
            <div class="flex shrink-0 items-center gap-1" @click.stop>
                <button class="flex h-6 w-6 items-center justify-center rounded-full bg-transparent text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="creating" :title="t('ide.chapterPanel.createChapterInVolume')" @click="emit('startInlineCreate', volume.id)">
                    <span class="i-lucide-plus h-4 w-4"></span>
                </button>
                <button class="flex h-6 w-6 items-center justify-center rounded-full bg-transparent text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.chapterPanel.editVolume')" @click="emit('editVolume', volume)">
                    <span class="i-lucide-settings-2 h-4 w-4"></span>
                </button>
                <button class="flex h-6 w-6 items-center justify-center rounded-full bg-transparent text-[var(--text-secondary)] transition-all hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="creating" :title="t('ide.chapterPanel.deleteVolume')" @click="emit('deleteVolume', volume)">
                    <span class="i-lucide-trash h-4 w-4"></span>
                </button>
            </div>
        </div>

        <!-- 章节列表 -->
        <div
            v-if="volume.isExpanded"
            class="mt-1 space-y-0.5 rounded-3 transition-colors duration-180 ease-out"
            :class="isDropTarget && !isDragSource ? 'bg-[var(--accent-bg)]/15' : ''"
        >
            <NovelChapterSortableRow
                v-for="(chapter, chapterIndex) in visibleChapters"
                :key="chapter.id"
                :chapter="chapter"
                :volume-id="volume.id"
                :index="chapterIndex"
                :selected="selectedChapterId === chapter.id && !selectedVolumeId"
                :drag-disabled="dragDisabled"
                :chapter-label="chapterNumber(chapter.sortOrder)"
                :status-label="statusLabel(chapter.status)"
                :status-class="statusClass(chapter.status)"
                @select="emit('selectChapter', $event)"
                @edit="emit('editChapter', $event)"
                @delete="emit('deleteChapter', $event)"
            />

            <div v-if="showInlineCreate" class="flex w-full items-center rounded-3 px-2 py-1 pl-5">
                <span class="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-muted)]">
                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                </span>
                <div class="flex flex-1 items-center justify-between rounded-2 border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 focus-within:border-[var(--accent-main)]">
                    <input ref="inlineInputRef" :value="inlineTitle" type="text" :placeholder="t('ide.chapterPanel.inlineChapterPlaceholder')" class="min-w-0 flex-1 bg-transparent text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]" @input="emit('update:inlineTitle', ($event.target as HTMLInputElement).value)" @keydown.enter="emit('confirmInlineCreate')" @keydown.esc="emit('cancelInlineCreate')" @blur="emit('confirmInlineCreate')">
                    <button class="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--accent-main)] transition-colors hover:bg-[var(--accent-main)] hover:text-[var(--text-inverse)]" :title="t('ide.chapterPanel.confirmCreate')" @mousedown.prevent @click="emit('confirmInlineCreate')">
                        <span class="i-lucide-check h-3 w-3"></span>
                    </button>
                </div>
            </div>

            <div v-if="volume.chapters.length === 0" class="mx-5 rounded-2 border border-dashed border-[var(--border-color)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                {{ t("ide.chapterPanel.emptyVolumeHint") }}
            </div>
        </div>
    </div>
</template>

<style scoped>
.volume-card[data-drag-source="true"] {
    opacity: 0.96;
}

.volume-card[data-drag-source="true"] .volume-card__header {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 40%, transparent);
}
</style>
