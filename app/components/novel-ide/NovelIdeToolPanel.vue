<script setup lang="ts">
import {onMounted, ref, useAttrs} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import WorkspaceCharacterPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterPanel.vue";
import NovelPlotPanel from "nbook/app/components/novel-ide/plot/NovelPlotPanel.vue";
import type { NovelIdeTab } from "nbook/app/components/novel-ide/mock-data";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    activeTab: NovelIdeTab | null;
    userAssetsMode?: boolean;
}>();

defineOptions({
    inheritAttrs: false,
});

const emit = defineEmits<{
    (e: "close"): void;
}>();

const titleMap: Record<NovelIdeTab, string> = {
    files: "文件",
    characters: "角色",
    outline: "剧情大纲",
};
const displayTitle = computed(() => props.userAssetsMode ? "用户资产" : titleMap[props.activeTab ?? "files"]);

const novelIdeStore = useNovelIdeStore();
const {plotWorkbenchOpen} = storeToRefs(novelIdeStore);
const notification = useNotification();
const attrs = useAttrs();
const isMounted = ref(false);
const downloadingWorkspace = ref(false);
const syncingAssets = ref(false);
const downloadConfirmOpen = ref(false);

/**
 * 打开 workspace 下载确认框。
 */
function openDownloadConfirm(): void {
    if (downloadingWorkspace.value) {
        return;
    }
    downloadConfirmOpen.value = true;
}

/**
 * 确认后保存未落盘内容并下载当前 workspace。
 */
async function confirmDownloadWorkspace(): Promise<void> {
    if (downloadingWorkspace.value) {
        return;
    }

    downloadingWorkspace.value = true;
    try {
        downloadConfirmOpen.value = false;
        const filename = await novelIdeStore.downloadCurrentWorkspace();
        notification.success(`已开始下载 ${filename}`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "打包下载 workspace 失败"));
    } finally {
        downloadingWorkspace.value = false;
    }
}

/**
 * 从系统 assets 补齐用户 assets 缺失文件。
 */
async function syncSystemAssets(): Promise<void> {
    if (syncingAssets.value || !props.userAssetsMode) {
        return;
    }
    syncingAssets.value = true;
    try {
        const result = await novelIdeStore.syncUserAssetsFromSystem();
        notification.success(`已同步 ${result.copied} 个缺失文件，保留 ${result.skipped} 个已有文件。`, {title: "用户资产已同步"});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "同步系统 assets 失败"));
    } finally {
        syncingAssets.value = false;
    }
}

onMounted(() => {
    isMounted.value = true;
});
</script>

<template>
    <!-- 左侧工具窗 -->
    <div class="contents">
        <aside v-if="activeTab" v-bind="attrs" class="z-10 flex w-[340px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]">
            <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
                <span class="text-[11px] font-medium tracking-[0.24em] text-[var(--text-secondary)]">
                    {{ displayTitle }}
                </span>

                <div class="flex items-center gap-0.5">
                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" title="打包下载当前 workspace" :disabled="downloadingWorkspace" @click="openDownloadConfirm">
                        <span :class="downloadingWorkspace ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-download'" class="h-4 w-4"></span>
                    </button>
                    <button v-if="props.userAssetsMode" class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" title="同步系统 assets" :disabled="syncingAssets" @click="void syncSystemAssets()">
                        <span :class="syncingAssets ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-folder-sync'" class="h-4 w-4"></span>
                    </button>
                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                        <span class="i-lucide-minus h-4 w-4"></span>
                    </button>
                </div>
            </div>

            <WorkspaceFilePanel v-if="activeTab === 'files'" />

            <WorkspaceCharacterPanel v-else-if="activeTab === 'characters' && !props.userAssetsMode" />

            <NovelPlotPanel v-else-if="activeTab === 'outline' && !props.userAssetsMode" />
        </aside>

        <!-- 剧本工作台 Dialog 宿主：允许顶部按钮直接打开，不强制切换左侧剧情大纲 tab。 -->
        <NovelPlotPanel v-if="isMounted && !props.userAssetsMode && activeTab !== 'outline' && plotWorkbenchOpen" class="hidden" />

        <Dialog v-model="downloadConfirmOpen" title="下载 workspace" width="420px" show-cancel :busy="downloadingWorkspace" @confirm="confirmDownloadWorkspace">
            <p>将先保存所有未保存的 workspace 文件，然后打包下载当前 workspace。</p>
        </Dialog>
    </div>
</template>
