<script setup lang="ts">
import { storeToRefs } from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import { useDialog } from "nbook/app/composables/useDialog";
import { useNovelIdeStore } from "nbook/app/stores/novel-ide";
import { resolveApiErrorMessage } from "nbook/app/utils/api-error";
import type {NovelListItemDto} from "nbook/shared/dto/novel-chapter.dto";

const props = defineProps<{
    modelValue: boolean;
    beforeWorkspaceSwitch?: () => boolean | Promise<boolean>;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "switched", novelId: string): void;
}>();

const { confirm, choose } = useDialog();
const novelIdeStore = useNovelIdeStore();
const { novels, currentNovelId, hasUnsavedWorkspaceChanges } = storeToRefs(novelIdeStore);
const { switchNovel, createNovel, deleteNovel, saveDirtyWorkspaceFiles, ensureDefaultNovel } = novelIdeStore;
const {t, locale} = useI18n();

const isInitializing = ref(false);
const isCreating = ref(false);
const isCreateFormOpen = ref(false);
const createTitle = ref(t("ide.bookshelf.defaultTitle"));
const createSummary = ref("");
const createTitleInput = ref<HTMLInputElement | null>(null);
const bookshelfError = ref("");

type WorkspaceSwitchDecision = "save" | "discard" | "cancel";

const handleClose = () => {
    emit("update:modelValue", false);
};

/**
 * 切换 Project Workspace 前允许宿主拦截，例如保护外层工作台的会话草稿。
 */
const canSwitchWorkspace = async (): Promise<boolean> => {
    return await props.beforeWorkspaceSwitch?.() ?? true;
};

/**
 * 打开就地新建表单。
 */
const openCreateForm = async () => {
    bookshelfError.value = "";
    isCreateFormOpen.value = true;
    createTitle.value = t("ide.bookshelf.defaultTitle");
    createSummary.value = "";
    await nextTick();
    createTitleInput.value?.select();
};

/**
 * 取消就地新建。
 */
const cancelCreateForm = () => {
    if (isCreating.value) return;
    bookshelfError.value = "";
    isCreateFormOpen.value = false;
    createTitle.value = t("ide.bookshelf.defaultTitle");
    createSummary.value = "";
};

/**
 * 切换或删除当前小说前处理未保存的 workspace 标签。
 */
const resolveUnsavedWorkspaceChanges = async (): Promise<WorkspaceSwitchDecision> => {
    if (!hasUnsavedWorkspaceChanges.value) {
        return "save";
    }

    const action = await choose(t("ide.bookshelf.unsavedMessage"), [
        {label: t("ide.bookshelf.save"), value: "save", tone: "primary"},
        {label: t("ide.bookshelf.discard"), value: "discard", tone: "danger"},
        {label: t("ide.bookshelf.cancel"), value: "cancel"},
    ], t("ide.bookshelf.unsavedTitle"));

    if (action === "cancel") {
        return "cancel";
    }
    if (action === "save") {
        await saveDirtyWorkspaceFiles();
        return "save";
    }
    return "discard";
};

const handleCreateNovel = async () => {
    const title = createTitle.value.trim();
    if (!title) {
        bookshelfError.value = t("ide.bookshelf.emptyTitleError");
        return;
    }

    try {
        if (!(await canSwitchWorkspace())) return;
        const decision = await resolveUnsavedWorkspaceChanges();
        if (decision === "cancel") return;
        isCreating.value = true;
        bookshelfError.value = "";
        const newNovelId = await createNovel(title, createSummary.value.trim());
        await switchNovel(newNovelId, {discardWorkspaceChanges: decision === "discard"});
        emit("switched", newNovelId);
        handleClose();
    } catch (error) {
        bookshelfError.value = resolveApiErrorMessage(error, t("ide.bookshelf.createOrSwitchFailed"));
    } finally {
        isCreating.value = false;
    }
};

const handleSwitchNovel = async (novelId: string) => {
    if (novelId === currentNovelId.value) return;
    try {
        bookshelfError.value = "";
        if (!(await canSwitchWorkspace())) return;
        const decision = await resolveUnsavedWorkspaceChanges();
        if (decision === "cancel") return;
        await switchNovel(novelId, {discardWorkspaceChanges: decision === "discard"});
        emit("switched", novelId);
        handleClose();
    } catch (error) {
        bookshelfError.value = resolveApiErrorMessage(error, t("ide.bookshelf.switchFailed"));
    }
};

const handleDeleteNovel = async (novelId: string, title: string) => {
    const ok = await confirm(t("ide.bookshelf.deleteConfirm", {title}));
    if (!ok) return;

    try {
        bookshelfError.value = "";
        if (novelId === currentNovelId.value) {
            if (!(await canSwitchWorkspace())) return;
            const decision = await resolveUnsavedWorkspaceChanges();
            if (decision === "cancel") return;
        }
        await deleteNovel(novelId);
    } catch (error) {
        bookshelfError.value = resolveApiErrorMessage(error, t("ide.bookshelf.deleteFailed"));
    }
};

// 格式化日期
const formatDate = (dateString: string) => {
    try {
        const d = new Date(dateString);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
        return dateString;
    }
};

/**
 * 格式化数字统计，避免卡片拥挤。
 */
const formatCount = (value: number) => {
    return new Intl.NumberFormat(locale.value).format(Number.isFinite(value) ? value : 0);
};

/**
 * 格式化字数统计。
 */
const formatWords = (value: number) => {
    const words = Number.isFinite(value) ? value : 0;
    if (words >= 10000) {
        return new Intl.NumberFormat(locale.value, {notation: "compact", maximumFractionDigits: words >= 100000 ? 0 : 1}).format(words);
    }
    return formatCount(words);
};

watch(() => props.modelValue, async (open) => {
    if (!open) {
        bookshelfError.value = "";
        isInitializing.value = false;
        isCreateFormOpen.value = false;
        createTitle.value = t("ide.bookshelf.defaultTitle");
        createSummary.value = "";
        return;
    }
    try {
        isInitializing.value = true;
        bookshelfError.value = "";
        await ensureDefaultNovel();
    } catch (error) {
        bookshelfError.value = resolveApiErrorMessage(error, t("ide.bookshelf.initFailed"));
    } finally {
        isInitializing.value = false;
    }
});
</script>

<template>
    <Dialog
        :model-value="modelValue"
        :title="t('ide.bookshelf.title')"
        size="xl"
        overlay-type="blur"
        :show-footer="false"
        :busy="isCreating"
        body-class="overflow-hidden"
        @update:model-value="emit('update:modelValue', $event)"
        @cancel="handleClose"
    >
        <div class="flex min-h-0 flex-1 flex-col px-1 py-1">
            <div v-if="bookshelfError" class="mb-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs leading-5 text-[var(--status-danger)]">
                {{ bookshelfError }}
            </div>

            <!-- 书架初始化状态 -->
            <div v-if="isInitializing && novels.length === 0" class="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]">
                <span class="i-lucide-loader-2 h-6 w-6 animate-spin"></span>
                <span class="text-sm">{{ t("ide.bookshelf.preparing") }}</span>
            </div>

            <!-- 书架网格 -->
            <div v-else class="min-h-0 flex-1 overflow-y-auto pr-1">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <!-- 新建书籍卡片 -->
                    <button
                        v-if="!isCreateFormOpen"
                        class="group relative flex min-h-[168px] items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-input)] p-4 transition-all hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-main)] focus:ring-opacity-50 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="isCreating || isInitializing"
                        @click="openCreateForm"
                    >
                        <div class="flex flex-col items-center gap-3 text-[var(--text-muted)] group-hover:text-[var(--accent-main)] transition-colors">
                            <span class="i-lucide-plus-circle h-7 w-7"></span>
                            <span class="text-sm font-medium">{{ t("ide.bookshelf.createBook") }}</span>
                        </div>
                    </button>

                    <!-- 就地新建表单 -->
                    <form
                        v-else
                        class="flex min-h-[168px] flex-col rounded-lg border border-[var(--accent-main)] bg-[var(--bg-panel)] p-3 shadow-sm"
                        @keydown.esc.stop.prevent="cancelCreateForm"
                        @submit.prevent="handleCreateNovel"
                    >
                        <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                            <span class="i-lucide-book-plus h-4 w-4 text-[var(--accent-main)]"></span>
                            {{ t("ide.bookshelf.createBook") }}
                        </div>
                        <label class="mb-2 block text-xs text-[var(--text-secondary)]">
                            <span class="mb-1 block">{{ t("ide.bookshelf.bookTitle") }}</span>
                            <input
                                ref="createTitleInput"
                                v-model="createTitle"
                                class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                maxlength="120"
                                :disabled="isCreating"
                                autofocus
                            >
                        </label>
                        <label class="text-xs text-[var(--text-secondary)]">
                            <span class="mb-1 block">{{ t("ide.bookshelf.summary") }}</span>
                            <textarea
                                v-model="createSummary"
                                class="h-[58px] w-full resize-none rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-5 text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)]"
                                maxlength="2000"
                                :disabled="isCreating"
                            ></textarea>
                        </label>
                        <div class="mt-2 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                class="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                :disabled="isCreating"
                                @click="cancelCreateForm"
                            >
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                                {{ t("ide.bookshelf.cancel") }}
                            </button>
                            <button
                                type="submit"
                                class="inline-flex items-center justify-center gap-1 rounded-md bg-[var(--accent-main)] px-3 py-2 text-xs font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:opacity-60"
                                :disabled="isCreating"
                            >
                                <span v-if="isCreating" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                <span v-else class="i-lucide-check h-3.5 w-3.5"></span>
                                {{ isCreating ? t("ide.bookshelf.creating") : t("ide.bookshelf.create") }}
                            </button>
                        </div>
                    </form>

                    <!-- 已有书籍卡片 -->
                    <div
                        v-for="novel in novels"
                        :key="novel.id"
                        class="group relative flex min-h-[168px] cursor-pointer overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] transition-all hover:-translate-y-0.5 hover:shadow-md"
                        :class="[novel.id === currentNovelId ? 'ring-2 ring-[var(--accent-main)] border-transparent' : 'hover:border-[var(--accent-main)]']"
                        @click="handleSwitchNovel(novel.id)"
                    >
                        <!-- 书籍封面缩略区 -->
                        <div class="relative flex w-[118px] shrink-0 flex-col items-center justify-center border-r border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                            <span class="i-lucide-book h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                            <div v-if="novel.id === currentNovelId" class="absolute right-2 top-2 rounded-full bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-text)]">{{ t("ide.bookshelf.current") }}</div>
                        </div>

                        <!-- 书籍信息区 -->
                        <div class="flex min-w-0 flex-1 flex-col gap-2 p-3">
                            <div class="min-w-0 pr-7">
                                <h3 class="truncate font-serif text-base font-bold leading-snug text-[var(--text-main)]">{{ novel.title }}</h3>
                                <div class="mt-1 truncate text-[10px] text-[var(--text-muted)]" :title="t('ide.bookshelf.lastUpdatedTitle', {time: formatDate(novel.updatedAt)})">
                                    {{ t("ide.bookshelf.updatedAt", {time: formatDate(novel.updatedAt)}) }}
                                </div>
                            </div>

                            <div class="grid grid-cols-2 gap-2">
                                <div class="min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                                    <div class="flex items-center gap-1 text-[10px] text-[var(--text-muted)]"><span class="i-lucide-pen-tool h-3 w-3"></span>{{ t("ide.bookshelf.words") }}</div>
                                    <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ formatWords(novel.totalWords) }}</div>
                                </div>
                                <div class="min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                                    <div class="flex items-center gap-1 text-[10px] text-[var(--text-muted)]"><span class="i-lucide-layers h-3 w-3"></span>{{ t("ide.bookshelf.chapters") }}</div>
                                    <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ formatCount(novel.chapterCount) }}</div>
                                </div>
                            </div>

                            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-secondary)]">
                                <span class="inline-flex items-center gap-1"><span class="i-lucide-book-open h-3 w-3 text-[var(--text-muted)]"></span>{{ t("ide.bookshelf.volume") }} {{ formatCount(novel.volumeCount) }}</span>
                                <span class="inline-flex items-center gap-1"><span class="i-lucide-library h-3 w-3 text-[var(--text-muted)]"></span>Lore {{ formatCount(novel.lorebookCount) }}</span>
                                <span class="inline-flex items-center gap-1"><span class="i-lucide-messages-square h-3 w-3 text-[var(--text-muted)]"></span>Session {{ formatCount(novel.sessionCount) }}</span>
                                <span class="inline-flex items-center gap-1" :title="`Thread: ${formatCount(novel.threadCount)} / Scene: ${formatCount(novel.sceneCount)} / Plot: ${formatCount(novel.plotCount)}`"><span class="i-lucide-route h-3 w-3 text-[var(--text-muted)]"></span>{{ t("ide.bookshelf.plot") }} {{ formatCount(novel.threadCount + novel.sceneCount + novel.plotCount) }}</span>
                            </div>
                        </div>

                        <!-- 悬浮操作菜单 -->
                        <div class="absolute left-2 top-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            <button
                                class="rounded-lg border border-transparent bg-[var(--bg-main)]/80 p-1.5 text-[var(--text-muted)] shadow-sm backdrop-blur-sm transition-colors hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]"
                                :title="t('ide.bookshelf.deleteBook')"
                                :aria-label="t('ide.bookshelf.deleteBook')"
                                @click.stop="handleDeleteNovel(novel.id, novel.title)"
                            >
                                <span class="i-lucide-trash-2 w-4 h-4"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Dialog>
</template>
