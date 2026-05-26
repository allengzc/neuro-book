<script setup lang="ts">
import {onMounted, ref, useAttrs} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import WorkspaceCharacterPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterPanel.vue";
import NovelPlotPanel from "nbook/app/components/novel-ide/plot/NovelPlotPanel.vue";
import type { NovelIdeTab } from "nbook/app/components/novel-ide/mock-data";
import {useNotification} from "nbook/app/composables/useNotification";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 560;

const props = defineProps<{
    activeTab: NovelIdeTab | null;
    userAssetsMode?: boolean;
    width: number;
}>();

defineOptions({
    inheritAttrs: false,
});

const emit = defineEmits<{
    (e: "update:width", value: number): void;
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
const uploadingSingleFile = ref(false);
const uploadingProject = ref(false);
const syncingAssets = ref(false);
const downloadConfirmOpen = ref(false);
const singleFileInputRef = ref<HTMLInputElement | null>(null);
const projectDirectoryInputRef = ref<HTMLInputElement | null>(null);
const projectZipInputRef = ref<HTMLInputElement | null>(null);
const resizeHandleRef = ref<HTMLElement | null>(null);
const downloadTargetLabel = computed(() => props.userAssetsMode ? "Workspace Root .nbook" : "Project Workspace");
const downloadButtonTitle = computed(() => props.userAssetsMode ? "打包下载 Workspace Root .nbook" : "打包下载当前 Project Workspace");
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: MIN_PANEL_WIDTH,
    maxSize: MAX_PANEL_WIDTH,
    edge: "right",
    enabled: computed(() => Boolean(props.activeTab)),
    onResize: (width) => emit("update:width", width),
});
const projectUploadItems: DropdownItem[] = [
    {label: "上传文件夹", value: "directory", iconClass: "i-lucide-folder-up"},
    {label: "上传 zip", value: "zip", iconClass: "i-lucide-file-archive"},
];

/**
 * 打开下载确认框。
 */
function openDownloadConfirm(): void {
    if (downloadingWorkspace.value) {
        return;
    }
    downloadConfirmOpen.value = true;
}

/**
 * 确认后保存未落盘内容并下载当前挂载目标。
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
        notification.error(resolveApiErrorMessage(error, `打包下载 ${downloadTargetLabel.value} 失败`));
    } finally {
        downloadingWorkspace.value = false;
    }
}

/**
 * 打开单文件上传选择器。
 */
function openSingleFileUpload(): void {
    if (uploadingSingleFile.value) {
        return;
    }
    singleFileInputRef.value?.click();
}

/**
 * 打开 Project 文件夹上传选择器。
 */
function openProjectDirectoryUpload(): void {
    if (uploadingProject.value) {
        return;
    }
    projectDirectoryInputRef.value?.click();
}

/**
 * 打开 Project zip 上传选择器。
 */
function openProjectZipUpload(): void {
    if (uploadingProject.value) {
        return;
    }
    projectZipInputRef.value?.click();
}

function selectProjectUploadMode(mode: string): void {
    if (mode === "zip") {
        openProjectZipUpload();
        return;
    }
    openProjectDirectoryUpload();
}

/**
 * 上传单个文件到 upload/。
 */
async function handleSingleFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || uploadingSingleFile.value) {
        return;
    }

    uploadingSingleFile.value = true;
    try {
        const result = await novelIdeStore.uploadFileToUploadFolder(file);
        notification.success(formatUploadResult(result, "文件已上传到 upload/"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "上传文件失败"));
    } finally {
        uploadingSingleFile.value = false;
    }
}

/**
 * 上传浏览器选择的 Project 文件夹。
 */
async function handleProjectDirectorySelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length || uploadingProject.value) {
        return;
    }

    uploadingProject.value = true;
    try {
        const result = await novelIdeStore.uploadProjectFiles(files);
        notification.success(formatUploadResult(result, "Project 文件夹上传完成"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "上传 Project 文件夹失败"));
    } finally {
        uploadingProject.value = false;
    }
}

/**
 * 上传 Project zip 压缩包。
 */
async function handleProjectZipSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file || uploadingProject.value) {
        return;
    }

    uploadingProject.value = true;
    try {
        const result = await novelIdeStore.uploadProjectZip(file);
        notification.success(formatUploadResult(result, "Project zip 上传完成"));
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "上传 Project zip 失败"));
    } finally {
        uploadingProject.value = false;
    }
}

function formatUploadResult(result: {written: number; skipped: number}, fallback: string): string {
    if (!result.written && !result.skipped) {
        return fallback;
    }
    return `已写入 ${result.written} 个文件，跳过 ${result.skipped} 个已有文件。`;
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
        <aside v-if="activeTab" v-bind="attrs" class="relative z-10 flex shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]" :class="isResizing ? 'select-none transition-none' : ''" :style="panelStyle">
            <!-- 宽度拖拽手柄 -->
            <div ref="resizeHandleRef" class="group absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize">
                <div class="ml-0.5 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="isResizing ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
            </div>

            <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
                <span class="text-[11px] font-medium tracking-[0.24em] text-[var(--text-secondary)]">
                    {{ displayTitle }}
                </span>

                <div class="flex items-center gap-0.5">
                    <input ref="singleFileInputRef" class="hidden" type="file" @change="(event) => void handleSingleFileSelected(event)">
                    <input ref="projectDirectoryInputRef" class="hidden" type="file" multiple webkitdirectory @change="(event) => void handleProjectDirectorySelected(event)">
                    <input ref="projectZipInputRef" class="hidden" type="file" accept=".zip,application/zip" @change="(event) => void handleProjectZipSelected(event)">

                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" title="上传单个文件到 upload/" :disabled="uploadingSingleFile" @click="openSingleFileUpload">
                        <span :class="uploadingSingleFile ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-file-up'" class="h-4 w-4"></span>
                    </button>
                    <Dropdown class="!w-auto" :items="projectUploadItems" menu-class="right-0 top-full mt-1 w-36" @select="selectProjectUploadMode">
                        <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" title="上传 Project" :disabled="uploadingProject">
                            <span :class="uploadingProject ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-folder-up'" class="h-4 w-4"></span>
                        </button>
                    </Dropdown>
                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :title="downloadButtonTitle" :disabled="downloadingWorkspace" @click="openDownloadConfirm">
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

        <Dialog v-model="downloadConfirmOpen" :title="`下载 ${downloadTargetLabel}`" width="420px" show-cancel :busy="downloadingWorkspace" @confirm="confirmDownloadWorkspace">
            <p>将先保存所有未保存的文件，然后打包下载当前 {{ downloadTargetLabel }}。</p>
        </Dialog>
    </div>
</template>
