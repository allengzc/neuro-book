<script setup lang="ts">
import { storeToRefs } from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import { useDialog } from "nbook/app/composables/useDialog";
import { useNovelIdeStore } from "nbook/app/stores/novel-ide";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "switched", novelId: string): void;
}>();

const { prompt, confirm, choose } = useDialog();
const novelIdeStore = useNovelIdeStore();
const { novels, currentNovelId, hasUnsavedWorkspaceChanges } = storeToRefs(novelIdeStore);
const { switchNovel, createNovel, deleteNovel, saveDirtyWorkspaceFiles } = novelIdeStore;

const isCreating = ref(false);

type WorkspaceSwitchDecision = "save" | "discard" | "cancel";

const handleClose = () => {
    emit("update:modelValue", false);
};

/**
 * 切换或删除当前小说前处理未保存的 workspace 标签。
 */
const resolveUnsavedWorkspaceChanges = async (): Promise<WorkspaceSwitchDecision> => {
    if (!hasUnsavedWorkspaceChanges.value) {
        return "save";
    }

    const action = await choose("当前 workspace 有未保存修改，是否先保存？", [
        {label: "保存", value: "save", tone: "primary"},
        {label: "放弃", value: "discard", tone: "danger"},
        {label: "取消", value: "cancel"},
    ], "未保存修改");

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
    const title = await prompt("请输入新小说名称", "新小说");
    if (!title) return;
    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") return;

    try {
        isCreating.value = true;
        const newNovelId = await createNovel(title);
        await switchNovel(newNovelId, {discardWorkspaceChanges: decision === "discard"});
        emit("switched", newNovelId);
        handleClose();
    } finally {
        isCreating.value = false;
    }
};

const handleSwitchNovel = async (novelId: string) => {
    if (novelId === currentNovelId.value) return;
    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") return;
    await switchNovel(novelId, {discardWorkspaceChanges: decision === "discard"});
    emit("switched", novelId);
    handleClose();
};

const handleDeleteNovel = async (novelId: string, title: string) => {
    const ok = await confirm(`确定要删除《${title}》吗？此操作不可恢复。`);
    if (!ok) return;
    if (novelId === currentNovelId.value) {
        const decision = await resolveUnsavedWorkspaceChanges();
        if (decision === "cancel") return;
    }

    await deleteNovel(novelId);
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
</script>

<template>
    <Dialog
        :model-value="modelValue"
        title="我的书架"
        width="800px"
        overlay-type="blur"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
        @cancel="handleClose"
    >
        <div class="px-2 py-2 min-h-[400px]">
            <!-- 书架网格 -->
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                
                <!-- 新建书籍卡片 -->
                <button
                    class="group relative flex flex-col items-center justify-center p-6 bg-[var(--bg-input)] border border-dashed border-[var(--border-color)] rounded-xl aspect-[3/4] transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--accent-main)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-main)] focus:ring-opacity-50"
                    :disabled="isCreating"
                    @click="handleCreateNovel"
                >
                    <div class="flex flex-col items-center gap-3 text-[var(--text-muted)] group-hover:text-[var(--accent-main)] transition-colors">
                        <span v-if="isCreating" class="i-lucide-loader-2 h-8 w-8 animate-spin"></span>
                        <span v-else class="i-lucide-plus-circle h-8 w-8"></span>
                        <span class="text-sm font-medium tracking-wide">{{ isCreating ? '创建中...' : '新建书籍' }}</span>
                    </div>
                </button>

                <!-- 已有书籍卡片 -->
                <div
                    v-for="novel in novels"
                    :key="novel.id"
                    class="group relative flex flex-col bg-[var(--bg-panel)] border border-[var(--border-color)] rounded-xl aspect-[3/4] overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:-translate-y-1"
                    :class="[novel.id === currentNovelId ? 'ring-2 ring-[var(--accent-main)] border-transparent' : 'hover:border-[var(--accent-main)]']"
                    @click="handleSwitchNovel(novel.id)"
                >
                    <!-- 封面展示区（占上方空间） -->
                    <div class="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-[var(--bg-input)] to-[var(--bg-main)] p-4 relative">
                        <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[var(--bg-panel)] to-transparent opacity-50"></div>
                        <span class="relative i-lucide-book h-12 w-12 text-[var(--text-muted)] opacity-50 mb-2"></span>
                        <h3 class="relative text-base font-serif font-bold text-[var(--text-main)] text-center line-clamp-2">{{ novel.title }}</h3>
                        
                        <div v-if="novel.id === currentNovelId" class="absolute top-2 right-2 bg-[var(--accent-bg)] text-[var(--accent-text)] text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wider uppercase">
                            当前阅读
                        </div>
                    </div>

                    <!-- 信息统计区（底部） -->
                    <div class="shrink-0 flex flex-col gap-1 p-3 bg-[var(--bg-panel)] border-t border-[var(--border-color)]">
                        <div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                            <span class="flex items-center gap-1" title="字数"><span class="i-lucide-pen-tool w-3 h-3"></span>{{ novel.totalWords }} 字</span>
                            <span class="flex items-center gap-1" title="章节"><span class="i-lucide-layers w-3 h-3"></span>{{ novel.chapterCount }} 章</span>
                        </div>
                        <div class="text-[10px] text-[var(--text-muted)] truncate" :title="'最后更新: ' + formatDate(novel.updatedAt)">
                            更新于 {{ formatDate(novel.updatedAt) }}
                        </div>
                    </div>

                    <!-- 悬浮操作菜单 -->
                    <div class="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            class="p-1.5 bg-[var(--bg-main)]/80 backdrop-blur-sm hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-500 rounded-lg transition-colors border border-transparent hover:border-red-500/20 shadow-sm"
                            title="删除书籍"
                            @click.stop="handleDeleteNovel(novel.id, novel.title)"
                        >
                            <span class="i-lucide-trash-2 w-4 h-4"></span>
                        </button>
                    </div>
                </div>

            </div>
        </div>
    </Dialog>
</template>
