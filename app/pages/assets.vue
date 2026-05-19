<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";
import MarkdownStudioWorkbench from "nbook/app/components/markdown-studio/MarkdownStudioWorkbench.vue";
import NovelIdeHeader from "nbook/app/components/novel-ide/NovelIdeHeader.vue";
import WorkspaceFileConflictDialog from "nbook/app/components/novel-ide/workspace/WorkspaceFileConflictDialog.vue";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useMarkdownStudioController} from "nbook/app/composables/useMarkdownStudioController";
import {useNotification} from "nbook/app/composables/useNotification";
import {useWorkspaceFileEvents} from "nbook/app/composables/useWorkspaceFileEvents";
import type {AgentTriggerMenuContext, AgentTriggerMenuState, MarkdownCommandKind} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useNovelIdeStore, type WorkspaceEditorKind, type WorkspaceEditorViewMode, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFileChangeEventDto, WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {resolveWorkspaceFileExtension} from "nbook/shared/editor-workbench";

type WorkspaceCommandItem = {
    id: string;
    label: string;
    description: string;
    iconClass: string;
    commandKind: MarkdownCommandKind;
};

const themeHostRef = ref<HTMLElement | null>(null);
const currentUser = ref<AuthSessionDto["user"]>(null);
const initialized = ref(false);
const workspaceEventAbortController = ref<AbortController | null>(null);
let workspaceFileSyncRunning = false;
let pendingWorkspaceFileEvents: WorkspaceFileChangeEventDto[] = [];

const novelIdeStore = useNovelIdeStore();
const {
    activeWorkspaceTabPath,
    selectedFileContent,
    selectedFileNode,
    selectedFilePath,
    theme,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
    monacoFontSizeOverridesByPath,
    workspaceReady,
    workspaceTabs,
} = storeToRefs(novelIdeStore);
const {
    closeWorkspaceTab,
    keepWorkspaceTab,
    loadWorkspaceTree,
    moveWorkspaceTab,
    resolveWorkspaceWriteConflict,
    saveCurrentFile,
    selectWorkspaceTab,
    setMonacoFontSizeOverride,
    setWorkspaceTabPinned,
    setWorkspaceTabViewMode,
    persistWorkspaceSession,
    switchToUserAssetsWorkspace,
    syncWorkspaceFromDisk,
} = novelIdeStore;
const {mountThemeHost} = useIdeTheme(theme);
const studio = useMarkdownStudioController({
    markdown: selectedFileContent,
    viewMode,
});
const workspaceFileEvents = useWorkspaceFileEvents();
const notification = useNotification();

const currentFileExtension = computed(() => resolveWorkspaceFileExtension(selectedFilePath.value));
const activeWorkspaceTab = computed(() => workspaceTabs.value.find((tab) => tab.path === activeWorkspaceTabPath.value) ?? null);
const currentWorkspaceViewMode = computed(() => activeWorkspaceTab.value?.viewMode ?? (currentFileExtension.value === ".md" ? "rich" : "source"));
const currentEditorKind = computed(() => activeWorkspaceTab.value?.editorKind ?? (currentFileExtension.value === ".md" ? "markdown" : selectedFileNode.value?.editable ? "monaco" : "readonly"));
const workspaceDisplayReady = computed(() => initialized.value && workspaceReady.value);
const displayWorkspaceTabs = computed(() => workspaceDisplayReady.value ? workspaceTabs.value : []);
const displayActiveWorkspaceTabPath = computed(() => workspaceDisplayReady.value ? activeWorkspaceTabPath.value : "");
const displaySelectedFileNode = computed(() => workspaceDisplayReady.value ? selectedFileNode.value : null);
const displayCurrentEditorKind = computed<WorkspaceEditorKind>(() => workspaceDisplayReady.value ? currentEditorKind.value : "readonly");
const displayCurrentWorkspaceViewMode = computed<WorkspaceEditorViewMode>(() => workspaceDisplayReady.value ? currentWorkspaceViewMode.value : "source");
const displayMonacoTemporaryFontSize = computed(() => displayActiveWorkspaceTabPath.value
    ? monacoFontSizeOverridesByPath.value[displayActiveWorkspaceTabPath.value] ?? null
    : null);

const markdownCommandSections = [
    {
        id: "style",
        title: "Style",
        items: [
            createMarkdownCommandItem("command:paragraph", "正文", "切换为普通段落。", "i-lucide-type", "paragraph"),
            createMarkdownCommandItem("command:heading-1", "标题 1", "插入一级标题。", "i-lucide-heading-1", "heading-1"),
            createMarkdownCommandItem("command:heading-2", "标题 2", "插入二级标题。", "i-lucide-heading-2", "heading-2"),
            createMarkdownCommandItem("command:heading-3", "标题 3", "插入三级标题。", "i-lucide-heading-3", "heading-3"),
            createMarkdownCommandItem("command:bullet-list", "无序列表", "切换无序列表。", "i-lucide-list", "bullet-list"),
            createMarkdownCommandItem("command:ordered-list", "有序列表", "切换有序列表。", "i-lucide-list-ordered", "ordered-list"),
            createMarkdownCommandItem("command:blockquote", "引用块", "切换引用块。", "i-lucide-text-quote", "blockquote"),
            createMarkdownCommandItem("command:code-block", "代码块", "插入代码块。", "i-lucide-square-code", "code-block"),
            createMarkdownCommandItem("command:horizontal-rule", "分割线", "插入水平分割线。", "i-lucide-minus", "horizontal-rule"),
        ],
    },
];

/**
 * 创建 Markdown Studio 命令菜单项。
 */
function createMarkdownCommandItem(
    id: string,
    label: string,
    description: string,
    iconClass: string,
    commandKind: MarkdownCommandKind,
): WorkspaceCommandItem {
    return {id, label, description, iconClass, commandKind};
}

/**
 * 解析 Markdown Studio 命令菜单。
 */
function resolveMarkdownMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
    if (context.kind !== "command") {
        return {
            title: "引用",
            prefix: "@",
            sections: [],
        };
    }
    const query = context.query.trim().toLocaleLowerCase("zh-CN");
    const sections = markdownCommandSections
        .map((section) => ({
            ...section,
            items: section.items.filter((item) => !query || `${item.label} ${item.description}`.toLocaleLowerCase("zh-CN").includes(query)),
        }))
        .filter((section) => section.items.length > 0);
    return {
        title: "命令",
        prefix: "/",
        sections,
    };
}

/**
 * 保存当前文件。
 */
async function handleSaveCurrentFile(content: string): Promise<void> {
    const result = await saveCurrentFile({content});
    if (result) {
        studio.setStatusText("已保存");
    }
}

/**
 * 切换当前工作区编辑模式。
 */
function setCurrentWorkspaceViewMode(mode: WorkspaceEditorViewMode): void {
    if (!selectedFilePath.value) {
        return;
    }
    setWorkspaceTabViewMode(selectedFilePath.value, mode);
    viewMode.value = mode;
}

/**
 * 刷新当前用户 assets 工作区文件树。
 */
async function handleRefreshWorkspaceTree(): Promise<void> {
    await loadWorkspaceTree();
}

/**
 * 同步文件系统事件。
 */
async function flushWorkspaceFileEvents(): Promise<void> {
    if (workspaceFileSyncRunning || pendingWorkspaceFileEvents.length === 0) {
        return;
    }
    workspaceFileSyncRunning = true;
    const events = pendingWorkspaceFileEvents.splice(0);
    try {
        const result = await syncWorkspaceFromDisk(events);
        if (result.dirtyPaths.length > 0) {
            notification.warning("部分用户资产文件已在磁盘中变化，已保留你的未保存内容。", {title: "文件有外部修改"});
        }
        if (result.deletedPaths.length > 0 || result.activeFile === "deleted") {
            notification.warning("部分用户资产文件已在磁盘中删除，相关编辑器已关闭。", {title: "文件已删除"});
        }
    } finally {
        workspaceFileSyncRunning = false;
    }
}

/**
 * 处理 workspace 文件事件流。
 */
function handleWorkspaceFileEvent(event: WorkspaceFileStreamEventDto): void {
    if (event.type !== "workspace_files_changed") {
        return;
    }
    pendingWorkspaceFileEvents.push(...event.events);
    void flushWorkspaceFileEvents();
}

/**
 * 订阅用户 assets 工作区文件变化。
 */
function subscribeWorkspaceEvents(): void {
    workspaceEventAbortController.value?.abort();
    const abortController = new AbortController();
    workspaceEventAbortController.value = abortController;
    void workspaceFileEvents.subscribe({workspaceKind: "user-assets"}, handleWorkspaceFileEvent, abortController.signal)
        .catch((error) => {
            if (abortController.signal.aborted) {
                return;
            }
            console.warn("[workspace-files] user assets event stream failed", error);
            notification.warning("用户资产实时同步连接已断开，请手动刷新。", {title: "同步中断"});
        });
}

/**
 * 刷新当前登录用户。
 */
async function refreshCurrentUser(): Promise<void> {
    try {
        const session = await $fetch<AuthSessionDto>("/api/auth/me");
        currentUser.value = session.user;
    } catch {
        currentUser.value = null;
    }
}

/**
 * 回到小说 IDE。
 */
async function openBookshelf(): Promise<void> {
    await navigateTo("/");
}

/**
 * 进入管理员后台。
 */
async function openAdmin(): Promise<void> {
    await navigateTo("/admin/users");
}

/**
 * 退出登录并回到登录页。
 */
async function logout(): Promise<void> {
    await $fetch("/api/auth/logout", {method: "POST"});
    currentUser.value = null;
    await navigateTo("/login");
}

onMounted(() => {
    mountThemeHost(themeHostRef.value);
    void (async () => {
        await refreshCurrentUser();
        await switchToUserAssetsWorkspace();
        initialized.value = true;
        subscribeWorkspaceEvents();
    })();
});

onBeforeUnmount(() => {
    persistWorkspaceSession();
    workspaceEventAbortController.value?.abort();
    workspaceEventAbortController.value = null;
});
</script>

<template>
    <!-- 用户 assets 工作区页面 -->
    <div ref="themeHostRef" class="novel-ide-page ide-shell flex h-screen flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <ClientOnly>
            <NovelIdeHeader
                class="ide-panel ide-header"
                :right-panel-open="false"
                novel-title="用户资产"
                :novel-items="[]"
                :current-user="currentUser"
                @toggle-agent="() => {}"
                @open-bookshelf="void openBookshelf()"
                @open-plot-workbench="() => {}"
                @open-user-assets="() => {}"
                @switch-novel="() => {}"
                @open-admin="void openAdmin()"
                @logout="void logout()"
            />
        </ClientOnly>

        <div class="flex min-h-0 flex-1 overflow-hidden">
            <aside class="ide-panel z-10 flex w-[340px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]">
                <div class="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
                    <span class="text-[11px] font-medium tracking-[0.24em] text-[var(--text-secondary)]">用户资产</span>
                    <button class="rounded-2 p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="刷新" @click="void handleRefreshWorkspaceTree()">
                        <span class="i-lucide-refresh-cw h-4 w-4"></span>
                    </button>
                </div>
                <WorkspaceFilePanel />
            </aside>

            <!-- 用户 assets 编辑区 -->
            <main class="ide-editor-canvas relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--editor-canvas-bg)]">
                <MarkdownStudioWorkbench
                    v-model:content="selectedFileContent"
                    :controller="studio"
                    :tabs="displayWorkspaceTabs"
                    :active-path="displayActiveWorkspaceTabPath"
                    :node="displaySelectedFileNode"
                    :editor-kind="displayCurrentEditorKind"
                    :workspace-view-mode="displayCurrentWorkspaceViewMode"
                    :theme="theme"
                    :editor-preferences="markdownEditorPreferences"
                    :monaco-preferences="monacoEditorPreferences"
                    :monaco-temporary-font-size="displayMonacoTemporaryFontSize"
                    :resolve-menu="resolveMarkdownMenu"
                    @select-tab="(path) => void selectWorkspaceTab(path)"
                    @close-tab="(path) => void closeWorkspaceTab(path)"
                    @set-pin="setWorkspaceTabPinned"
                    @keep-tab="keepWorkspaceTab"
                    @move-tab="moveWorkspaceTab"
                    @set-view-mode="setCurrentWorkspaceViewMode"
                    @update-monaco-temporary-font-size="setMonacoFontSizeOverride(displayActiveWorkspaceTabPath, $event)"
                    @save-request="void handleSaveCurrentFile(selectedFileContent)"
                />
            </main>
        </div>

        <WorkspaceFileConflictDialog
            v-model="novelIdeStore.workspaceConflictDialogOpen"
            :conflict="novelIdeStore.workspaceWriteConflict"
            :theme="theme"
            @resolve="void resolveWorkspaceWriteConflict($event)"
        />
    </div>
</template>
