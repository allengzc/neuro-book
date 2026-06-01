<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";
import type {ConfigBootstrapDto} from "nbook/shared/dto/config.dto";
import type {NovelContinueRequestDto} from "nbook/shared/dto/novel.dto";
import {isNovelIdeTab, type NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import MarkdownStudioWorkbench from "nbook/app/components/markdown-studio/MarkdownStudioWorkbench.vue";
import AgentChatSurface from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";
import AgentModeSessionSidebar from "nbook/app/components/novel-ide/agent/AgentModeSessionSidebar.vue";
import NovelIdeHeader from "nbook/app/components/novel-ide/NovelIdeHeader.vue";
import NovelIdeSidebar from "nbook/app/components/novel-ide/NovelIdeSidebar.vue";
import NovelIdeSettingsDialog from "nbook/app/components/novel-ide/NovelIdeSettingsDialog.vue";
import NovelIdeToolPanel from "nbook/app/components/novel-ide/NovelIdeToolPanel.vue";
import NovelPromptBar from "nbook/app/components/novel-ide/NovelPromptBar.vue";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import NovelBookshelfDialog from "nbook/app/components/novel-ide/NovelBookshelfDialog.vue";
import UserProfileWorkbenchDialog from "nbook/app/components/profile-template-editor/UserProfileWorkbenchDialog.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import WorkspaceFileConflictDialog from "nbook/app/components/novel-ide/workspace/WorkspaceFileConflictDialog.vue";
import WorkspaceLocationProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceLocationProfileDialog.vue";
import WorkspaceRuleProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceRuleProfileDialog.vue";
import type {WorkspaceReferencePreviewMeta} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useAuthSessionState} from "nbook/app/composables/useAuthSessionState";
import {useMarkdownStudioController} from "nbook/app/composables/useMarkdownStudioController";
import {useWorkspaceFileEvents} from "nbook/app/composables/useWorkspaceFileEvents";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import type {AgentTriggerMenuContext, AgentTriggerMenuItem, AgentTriggerMenuState, MarkdownCommandKind} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload, type WorkspaceEditorKind, type WorkspaceEditorViewMode, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFileChangeEventDto, WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {
    collectWorkspaceReferencePathCandidates,
} from "nbook/app/utils/workspace-reference-search";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";
import {resolveWorkspaceFileExtension, type FrontmatterProfileKind} from "nbook/shared/editor-workbench";

type StreamTokenEvent = {
    text?: string;
};

type StreamDoneEvent = {
    fullText?: string;
};

type StreamErrorEvent = {
    message?: string;
};

type SameDocumentViewTransition = {
    ready: Promise<void>;
};

type SameDocumentViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void | Promise<void>) => SameDocumentViewTransition;
};

type LayoutModeTransitionDirection = "to-agent" | "to-ide";

const abortController = ref<AbortController | null>(null);
const initialized = ref(false);
const themeHostRef = ref<HTMLElement | null>(null);
const currentUser = ref<AuthSessionDto["user"]>(null);
const bookshelfOpen = ref(false);
const settingsDialogOpen = ref(false);
const profileWorkbenchOpen = ref(false);
const frontmatterProfileKind = ref<FrontmatterProfileKind | null>(null);
const fileDiagnosticsText = ref("");
const agentStudioFileTreeOpen = ref(false);
const saveQueued = ref(false);
const workspaceEventAbortController = ref<AbortController | null>(null);
const agentResizeHandleRef = ref<HTMLElement | null>(null);
const agentStudioResizeHandleRef = ref<HTMLElement | null>(null);
const agentStudioFileTreeResizeHandleRef = ref<HTMLElement | null>(null);
const layoutTransitionDirection = ref<LayoutModeTransitionDirection | null>(null);
let workspaceFileSyncRunning = false;
let pendingWorkspaceFileEvents: WorkspaceFileChangeEventDto[] = [];
const USER_ASSETS_PROJECT_TARGET = "workspace/.nbook";
const MODE_TRANSITION_SELECTORS = [
    ".ide-agent-mode-switch",
    ".agent-mode-session-sidebar",
    ".mode-transition-ide-tools",
    ".mode-transition-studio",
    ".mode-transition-agent",
] as const;
const IDE_PAPER_TRANSITION_SELECTORS = [
    ".mode-transition-ide-tools",
    ".mode-transition-studio",
] as const;

const novelIdeStore = useNovelIdeStore();
const route = useRoute();
const router = useRouter();
const {
    activeLeftTab,
    activeWorkspaceTabPath,
    currentNovelId,
    currentNovel,
    hasUnsavedWorkspaceChanges,
    lastSyncedFileContent,
    loadingWorkspace,
    layoutMode,
    agentSessionPanelOpen,
    agentSessionPanelWidth,
    agentStudioFileTreeWidth,
    agentStudioPanelWidth,
    novels,
    promptExpanded,
    requirement,
    rightPanelOpen,
    savingFile,
    selectedFileContent,
    selectedFileNode,
    selectedFilePath,
    selectedModel,
    selectedReasoning,
    theme,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
    monacoFontSizeOverridesByPath,
    workspaceReady,
    workspaceIssues,
    workspaceTabs,
    workspaceTree,
    workspaceKind,
    isUserAssetsWorkspace,
    leftPanelWidth,
    rightPanelWidth,
} = storeToRefs(novelIdeStore);
const {
    applyAgentWorkspaceSync,
    initializeWorkspace,
    loadWorkspaceTree,
    saveCurrentFile,
    saveDirtyWorkspaceFiles,
    closeWorkspaceTab,
    keepWorkspaceTab,
    moveWorkspaceTab,
    selectWorkspaceTab,
    setSelectedModelLabel,
    setMonacoFontSizeOverride,
    setWorkspaceTabPinned,
    setWorkspaceTabViewMode,
    resolveWorkspaceWriteConflict,
    syncWorkspaceFromDisk,
    switchNovel,
    switchToNovelWorkspace,
    switchToUserAssetsWorkspace,
} = novelIdeStore;
const {mountThemeHost} = useIdeTheme(theme);
const workspaceFileEvents = useWorkspaceFileEvents();
const authSessionState = useAuthSessionState();
const agentSurfaceRef = ref<InstanceType<typeof AgentChatSurface> | null>(null);

const studio = useMarkdownStudioController({
    markdown: selectedFileContent,
    viewMode,
});

const {choose} = useDialog();
const notification = useNotification();

const novelItems = computed(() => novels.value.map((novel) => ({
    label: novel.title,
    value: novel.id,
    active: novel.id === currentNovelId.value,
})));

type ProjectRouteTarget =
    | {kind: "user-assets"}
    | {kind: "project"; projectPath: string}
    | {kind: "default"};

/**
 * 解析页面 URL 中的 project target。workspace/.nbook 是 user-assets 保留值。
 */
const parseProjectRouteTarget = (): ProjectRouteTarget => {
    const projectQuery = typeof route.query.project === "string" ? route.query.project.trim() : "";
    if (projectQuery === USER_ASSETS_PROJECT_TARGET) {
        return {kind: "user-assets"};
    }
    if (/^workspace\/[^/]+$/u.test(projectQuery)) {
        return {kind: "project", projectPath: projectQuery};
    }
    return {kind: "default"};
};

/**
 * 生成规范 project URL，确保 query value 中的斜杠编码为 %2F。
 */
const buildProjectRoute = (projectTarget: string): string => {
    return `/?${new URLSearchParams({project: projectTarget}).toString()}`;
};

const workspaceBootstrapped = ref(false);
const displayRightPanelOpen = computed(() => workspaceBootstrapped.value && rightPanelOpen.value);
const isAgentMode = computed(() => layoutMode.value === "agent");
const agentSurfaceActive = computed(() => workspaceBootstrapped.value && (rightPanelOpen.value || isAgentMode.value));
const agentModeSessions = computed(() => agentSurfaceRef.value?.sessions ?? []);
const agentModeActiveSessionId = computed(() => agentSurfaceRef.value?.activeSessionId ?? null);
const agentModeLoadingSession = computed(() => agentSurfaceRef.value?.loadingSession ?? false);
const agentModeRunning = computed(() => agentSurfaceRef.value?.running ?? false);
const agentModeSessionActionId = computed(() => agentSurfaceRef.value?.sessionActionId ?? null);
const agentModeReservedWidth = computed(() => 56 + (agentSessionPanelOpen.value ? agentSessionPanelWidth.value : 0) + 340);
const agentStudioMaxWidth = computed(() => {
    if (!import.meta.client) {
        return 620;
    }
    return Math.max(320, window.innerWidth - agentModeReservedWidth.value);
});
const agentStudioFileTreeMaxWidth = computed(() => Math.min(360, Math.max(240, agentStudioPanelWidth.value - 80)));
const agentStudioPanelVisible = computed({
    get: () => novelIdeStore.agentStudioPanelOpen,
    set: (value: boolean) => {
        novelIdeStore.agentStudioPanelOpen = value;
    },
});
const agentStudioPanelOpen = computed(() => workspaceBootstrapped.value && agentStudioPanelVisible.value);
const {isResizing: resizingAgentPanel, panelStyle: agentPanelStyle} = useResizablePanel(agentResizeHandleRef, {
    size: computed(() => rightPanelWidth.value),
    minSize: 320,
    maxSize: 720,
    edge: "left",
    enabled: computed(() => !isAgentMode.value && displayRightPanelOpen.value),
    syncDuringResize: true,
    onResize: (width) => {
        rightPanelWidth.value = width;
    },
});
const {isResizing: resizingAgentStudioPanel, panelStyle: agentStudioPanelStyle} = useResizablePanel(agentStudioResizeHandleRef, {
    size: computed(() => agentStudioPanelWidth.value),
    minSize: 320,
    maxSize: agentStudioMaxWidth,
    edge: "left",
    enabled: computed(() => isAgentMode.value && agentStudioPanelOpen.value),
    onResizeEnd: (width) => {
        agentStudioPanelWidth.value = width;
    },
});
const {isResizing: resizingAgentStudioFileTree, panelStyle: agentStudioFileTreeStyle} = useResizablePanel(agentStudioFileTreeResizeHandleRef, {
    size: computed(() => agentStudioFileTreeWidth.value),
    minSize: 160,
    maxSize: agentStudioFileTreeMaxWidth,
    edge: "left",
    enabled: computed(() => isAgentMode.value && agentStudioPanelOpen.value && agentStudioFileTreeOpen.value),
    onResizeEnd: (width) => {
        agentStudioFileTreeWidth.value = width;
    },
});
const agentSlotStyle = computed(() => {
    if (isAgentMode.value) {
        return {};
    }
    return displayRightPanelOpen.value ? agentPanelStyle.value : {width: "0px"};
});
const agentStudioStyle = computed(() => {
    if (!isAgentMode.value) {
        return {};
    }
    if (layoutTransitionDirection.value === "to-agent") {
        return {width: "0px"};
    }
    return agentStudioPanelOpen.value ? agentStudioPanelStyle.value : {width: "0px"};
});
const displayActiveLeftTab = computed<NovelIdeTab | null>(() => {
    if (!workspaceBootstrapped.value) {
        return "files";
    }
    if (isUserAssetsWorkspace.value) {
        return "files";
    }
    if (activeLeftTab.value === null) {
        return null;
    }
    return isNovelIdeTab(activeLeftTab.value) ? activeLeftTab.value : "files";
});
const ideToolPanelOpen = computed(() => !isAgentMode.value && displayActiveLeftTab.value !== null);
const ideToolPanelStyle = computed(() => ideToolPanelOpen.value ? {width: `${leftPanelWidth.value}px`} : {width: "0px"});
const displaySidebarActiveTab = computed<NovelIdeTab | "sessions" | null>(() => isAgentMode.value ? "sessions" : displayActiveLeftTab.value);
const displayNovelTitle = computed(() => isUserAssetsWorkspace.value ? "用户资产" : currentNovel.value?.title ?? "");
const displayNovelItems = computed(() => isUserAssetsWorkspace.value ? [] : novelItems.value);
const displayNovelIdForAgent = computed(() => isUserAssetsWorkspace.value ? "" : currentNovelId.value);
const agentWorkspaceKey = computed(() => {
    if (isUserAssetsWorkspace.value) {
        return "user-assets";
    }
    return currentNovelId.value || "workspace";
});

/**
 * 当前文件扩展名，统一用于编辑器类型判断。
 */
const currentFileExtension = computed(() => {
    return resolveWorkspaceFileExtension(selectedFilePath.value);
});

const activeWorkspaceTab = computed(() => workspaceTabs.value.find((tab) => tab.path === activeWorkspaceTabPath.value) ?? null);
const currentWorkspaceViewMode = computed(() => activeWorkspaceTab.value?.viewMode ?? (isMarkdownFile.value ? "rich" : "source"));
const currentEditorKind = computed(() => activeWorkspaceTab.value?.editorKind ?? (isMarkdownFile.value ? "markdown" : selectedFileNode.value?.editable ? "monaco" : "readonly"));
const workspaceDisplayReady = computed(() => workspaceBootstrapped.value && workspaceReady.value);
const displayWorkspaceTabs = computed(() => workspaceDisplayReady.value ? workspaceTabs.value : []);
const displayActiveWorkspaceTabPath = computed(() => workspaceDisplayReady.value ? activeWorkspaceTabPath.value : "");
const displaySelectedFileNode = computed(() => workspaceDisplayReady.value ? selectedFileNode.value : null);
const displayCurrentEditorKind = computed<WorkspaceEditorKind>(() => workspaceDisplayReady.value ? currentEditorKind.value : "readonly");
const displayCurrentWorkspaceViewMode = computed<WorkspaceEditorViewMode>(() => workspaceDisplayReady.value ? currentWorkspaceViewMode.value : "source");
const displayPromptExpanded = computed(() => workspaceBootstrapped.value ? promptExpanded.value : true);
const displayRequirement = computed(() => workspaceBootstrapped.value ? requirement.value : "");
const displaySelectedModel = computed(() => workspaceBootstrapped.value ? selectedModel.value : "未配置模型");
const displaySelectedReasoning = computed(() => workspaceBootstrapped.value ? selectedReasoning.value : "中");
const displayMonacoTemporaryFontSize = computed(() => displayActiveWorkspaceTabPath.value
    ? monacoFontSizeOverridesByPath.value[displayActiveWorkspaceTabPath.value] ?? null
    : null);
const characterProfileVisible = computed({
    get: () => frontmatterProfileKind.value === "character",
    set: (visible: boolean): void => {
        frontmatterProfileKind.value = visible ? "character" : null;
    },
});
const locationProfileVisible = computed({
    get: () => frontmatterProfileKind.value === "location",
    set: (visible: boolean): void => {
        frontmatterProfileKind.value = visible ? "location" : null;
    },
});
const ruleProfileVisible = computed({
    get: () => frontmatterProfileKind.value === "rule",
    set: (visible: boolean): void => {
        frontmatterProfileKind.value = visible ? "rule" : null;
    },
});
const workspaceReferenceRefreshKey = computed(() => workspaceTree.value
    .map((node) => [
        node.path,
        node.entryType ?? "",
        node.icon ?? "",
        node.status ?? "",
        node.contentNode ? "content" : "plain",
        node.frontmatterError ?? "",
        node.mtimeMs,
    ].join(":"))
    .join("|"));
/**
 * Markdown 文件继续进入 MarkdownStudio。
 */
const isMarkdownFile = computed(() => currentFileExtension.value === ".md");

const markdownCommandSections = [
    {
        id: "ai",
        title: "AI",
        items: [
            createMarkdownCommandItem("command:ai-generate", "AI 生成", "占位，后续接入 AI 写入。", "i-lucide-sparkles", "paragraph", true),
            createMarkdownCommandItem("command:ai-rewrite", "AI 改写", "占位，后续接入选区改写。", "i-lucide-wand-sparkles", "paragraph", true),
        ],
    },
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
    {
        id: "insert",
        title: "Insert",
        items: [
            createMarkdownCommandItem("command:image", "图片", "占位，后续插入图片语法。", "i-lucide-image", "image", true),
            createMarkdownCommandItem("command:link", "链接", "占位，后续插入普通链接。", "i-lucide-link", "link", true),
            createMarkdownCommandItem("command:reference", "引用", "切换到 @ 引用菜单。", "i-lucide-at-sign", "reference"),
            createMarkdownCommandItem("command:comment", "评论", "占位，后续插入评论。", "i-lucide-message-square-plus", "comment", true),
        ],
    },
];

/**
 * 创建 Markdown slash command 菜单项。
 */
function createMarkdownCommandItem(
    id: string,
    label: string,
    description: string,
    iconClass: string,
    markdownCommand: MarkdownCommandKind,
    disabled = false,
): AgentTriggerMenuItem {
    return {
        id,
        label,
        description,
        iconClass,
        markdownCommand,
        disabled,
        trailingSpace: false,
    };
}

/**
 * 解析 Markdown Studio 的 / 命令和 @ 引用菜单。
 */
function resolveMarkdownMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
    if (context.kind === "command") {
        const query = context.query.trim().toLocaleLowerCase("zh-CN");
        const sections = markdownCommandSections
            .map((section) => ({
                ...section,
                items: section.items.filter((item) => !query || `${item.label} ${item.description} ${item.hint ?? ""}`.toLocaleLowerCase("zh-CN").includes(query)),
            }))
            .filter((section) => section.items.length > 0);
        return {
            title: "命令",
            prefix: "/",
            sections: sections.length > 0 ? sections : [createEmptyMenuSection(context.query)],
        };
    }

    const referenceSections = buildWorkspaceReferenceSections(workspaceTree.value, context.query);
    return {
        title: "引用",
        prefix: "@",
        sections: referenceSections.length > 0 ? referenceSections : [createEmptyMenuSection(context.query)],
    };
}

/**
 * 搜索无结果时仍保留菜单，避免 Suggestion 直接关闭。
 */
function createEmptyMenuSection(query: string): {id: string; title: string; items: AgentTriggerMenuItem[]} {
    const label = query.trim() ? "没有匹配结果" : "暂无可引用内容";
    return {
        id: "empty",
        title: "",
        items: [{
            id: "empty-result",
            label,
            description: query.trim() ? "换一个关键词试试。" : "当前工作区没有可引用的 Markdown 文件或内容节点。",
            iconClass: "i-lucide-search-x",
            disabled: true,
        }],
    };
}

/**
 * 打开 Markdown 引用指向的 workspace 文件。
 */
async function openWorkspaceReference(target: string): Promise<void> {
    const resolvedPath = resolveReferencePath(target, selectedFilePath.value);
    if (!resolvedPath) {
        notification.warning(`引用目标不存在或不可打开：${target}`, {title: "打开引用失败"});
        return;
    }
    await novelIdeStore.openWorkspacePath(resolvedPath, "permanent");
}

/**
 * 在页面关闭或刷新前同步落下当前 workspace 会话。
 */
function flushWorkspaceSession(): void {
    novelIdeStore.persistWorkspaceSession();
}

/**
 * 为 TipTap 引用 chip 解析真实 workspace 节点。
 */
function resolveWorkspaceReferencePreview(target: string, sourcePath: string): WorkspaceReferencePreviewMeta {
    const node = resolveReferenceNode(target, sourcePath);
    if (!node) {
        return {
            target,
            resolvedPath: null,
            entryType: null,
            icon: null,
            title: "",
            status: null,
            broken: true,
            contentNode: false,
            isDirectory: false,
        };
    }

    const isValidContentNode = Boolean(node.contentNode && node.entryType && !node.frontmatterError);
    const entryType = isValidContentNode
        ? node.entryType
        : isWorkspacePlanFile(node.path)
            ? "plan"
            : node.isDirectory ? "folder" : "file";
    return {
        target,
        resolvedPath: node.isDirectory && node.hasIndex ? `${normalizeWorkspacePath(node.path)}/index.md` : node.path,
        entryType,
        icon: node.icon ? `i-lucide-${node.icon}` : null,
        title: node.title?.trim() || basename(node.path),
        status: node.status,
        broken: false,
        contentNode: isValidContentNode,
        isDirectory: node.isDirectory,
    };
}

/**
 * 判断路径是否是 Agent thread Markdown 工作文件。
 */
function isWorkspacePlanFile(filePath: string): boolean {
    const normalizedPath = normalizeWorkspacePath(filePath).toLowerCase();
    return /\.agent\/[^/]+\/.+\.md$/i.test(normalizedPath)
        || /^\.agent\/[^/]+\/.+\.md$/i.test(normalizedPath);
}

/**
 * 将引用 target 解析为可打开路径。
 */
function resolveReferencePath(target: string, sourcePath: string): string | null {
    const node = resolveReferenceNode(target, sourcePath);
    if (!node) {
        return null;
    }
    if (node.isDirectory) {
        return node.hasIndex ? `${normalizeWorkspacePath(node.path)}/index.md` : node.path;
    }
    return node.path;
}

/**
 * 将引用 target 解析为 workspace tree 中的节点。
 */
function resolveReferenceNode(target: string, sourcePath: string): WorkspaceFileNode | null {
    const cleanTarget = stripReferenceFragment(target.trim());
    if (!cleanTarget || cleanTarget.startsWith("/") || isExternalOrSchemeTarget(cleanTarget)) {
        return null;
    }

    const decodedTarget = safeDecodeURI(cleanTarget).replace(/\\/g, "/");
    const basePath = decodedTarget.startsWith("./") || decodedTarget.startsWith("../")
        ? dirname(sourcePath)
        : "";
    const normalizedTarget = normalizeWorkspacePath(joinWorkspacePath(basePath, decodedTarget));
    const candidates = collectWorkspaceReferencePathCandidates(normalizedTarget, novelIdeStore.currentWorkspaceRoot);
    for (const candidate of candidates) {
        const node = findWorkspaceNode(candidate);
        if (node) {
            return node;
        }
    }
    return null;
}

/**
 * 根据标准化路径查找 workspace 节点。
 */
function findWorkspaceNode(path: string): WorkspaceFileNode | null {
    const normalizedPath = normalizeWorkspacePath(path);
    return workspaceTree.value.find((node) => normalizeWorkspacePath(node.path) === normalizedPath) ?? null;
}

/**
 * 判断 target 是否是外部链接或协议链接。
 */
function isExternalOrSchemeTarget(target: string): boolean {
    return /^(?:https?:|mailto:|tel:|#)/i.test(target) || /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

/**
 * 安全解码 URI。
 */
function safeDecodeURI(target: string): string {
    try {
        return decodeURI(target);
    } catch {
        return target;
    }
}

/**
 * 去掉 query/hash。
 */
function stripReferenceFragment(target: string): string {
    const queryIndex = target.indexOf("?");
    const hashIndex = target.indexOf("#");
    const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
    return indexes.length > 0 ? target.slice(0, Math.min(...indexes)) : target;
}

/**
 * 拼接并归一化 workspace 路径。
 */
function joinWorkspacePath(basePath: string, target: string): string {
    const segments = `${basePath ? `${basePath}/` : ""}${target}`.split("/");
    const resolved: string[] = [];
    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }
        if (segment === "..") {
            resolved.pop();
            continue;
        }
        resolved.push(segment);
    }
    return resolved.join("/");
}

/**
 * 返回路径父目录。
 */
function dirname(filePath: string): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    return normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";
}

/**
 * 返回路径 basename。
 */
function basename(filePath: string): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 标准化 workspace 相对路径。
 */
function normalizeWorkspacePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/^workspace\//, "").replace(/^\.\//, "");
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * 保存当前真实文件，并更新工具栏诊断文本。
 */
const saveCurrentWorkspaceFile = async (): Promise<void> => {
    if (!initialized.value || !selectedFileNode.value?.editable) {
        return;
    }
    if (savingFile.value) {
        saveQueued.value = true;
        return;
    }

    try {
        const node = await saveCurrentFile();
        fileDiagnosticsText.value = node
            ? ""
            : novelIdeStore.workspaceWriteConflict ? "真实文件已被修改，请处理保存冲突" : "当前文件不可保存";
    } catch (error) {
        fileDiagnosticsText.value = error instanceof Error ? error.message : "自动保存失败";
    } finally {
        if (saveQueued.value && !novelIdeStore.workspaceWriteConflict && selectedFileContent.value !== lastSyncedFileContent.value) {
            saveQueued.value = false;
            await saveCurrentWorkspaceFile();
            return;
        }
        saveQueued.value = false;
    }
};

/**
 * 切换工作区编辑模式。
 */
const setCurrentWorkspaceViewMode = (mode: WorkspaceEditorViewMode): void => {
    if (!selectedFilePath.value) {
        return;
    }
    setWorkspaceTabViewMode(selectedFilePath.value, mode);
    viewMode.value = mode;
};

watch(currentWorkspaceViewMode, (mode) => {
    viewMode.value = mode;
}, {immediate: true});

/**
 * 关闭标签页，脏文件先确认。
 */
const closeEditorTab = async (filePath: string): Promise<void> => {
    const tab = workspaceTabs.value.find((item) => item.path === filePath);
    if (!tab) {
        return;
    }
    if (!tab.dirty) {
        await closeWorkspaceTab(filePath, true);
        return;
    }
    const action = await choose("当前标签有未保存修改，是否先保存？", [
        {label: "保存", value: "save", tone: "primary"},
        {label: "放弃", value: "discard", tone: "danger"},
        {label: "取消", value: "cancel"},
    ], "关闭标签");
    if (action === "cancel") {
        return;
    }
    if (action === "save" && filePath !== selectedFilePath.value) {
        await selectWorkspaceTab(filePath);
    }
    if (action === "save") {
        await saveCurrentWorkspaceFile();
    }
    await closeWorkspaceTab(filePath, true);
};

/**
 * 处理切换前的未保存文件修改。
 */
type WorkspaceSwitchDecision = "save" | "discard" | "cancel";

/**
 * 处理切换前的未保存文件修改。
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

/**
 * 切换小说前先处理当前文件保存状态。
 */
const handleSwitchNovel = async (novelId: string): Promise<void> => {
    if (novelId === currentNovelId.value) {
        if (route.query.project !== novelId) {
            await router.replace(buildProjectRoute(novelId));
        }
        return;
    }

    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") {
        return;
    }

    await switchNovel(novelId, {discardWorkspaceChanges: decision === "discard"});
    await router.replace(buildProjectRoute(novelId));
};

/**
 * 捕获模式切换前后需要平滑移动的元素位置。
 */
const captureModeTransitionRects = (): Map<string, DOMRect> => {
    const rects = new Map<string, DOMRect>();
    for (const selector of MODE_TRANSITION_SELECTORS) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
            rects.set(selector, element.getBoundingClientRect());
        }
    }
    return rects;
};

/**
 * 克隆当前 IDE 工作区，作为向左滑出的纸面快照。
 */
const createIdePaperSlideOverlay = (): HTMLElement | null => {
    const items = IDE_PAPER_TRANSITION_SELECTORS
        .map((selector) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                return null;
            }
            return {element, rect};
        })
        .filter((item): item is {element: HTMLElement; rect: DOMRect} => item !== null);

    if (items.length === 0) {
        return null;
    }

    const left = Math.min(...items.map((item) => item.rect.left));
    const top = Math.min(...items.map((item) => item.rect.top));
    const right = Math.max(...items.map((item) => item.rect.right));
    const bottom = Math.max(...items.map((item) => item.rect.bottom));
    const overlay = document.createElement("div");
    overlay.className = "mode-transition-paper";
    overlay.style.position = "fixed";
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${right - left}px`;
    overlay.style.height = `${bottom - top}px`;
    overlay.style.zIndex = "80";
    overlay.style.pointerEvents = "none";
    overlay.style.overflow = "hidden";
    overlay.style.transform = "translate3d(0, 0, 0)";
    overlay.style.willChange = "transform";

    for (const item of items) {
        const clone = item.element.cloneNode(true) as HTMLElement;
        clone.style.position = "absolute";
        clone.style.left = `${item.rect.left - left}px`;
        clone.style.top = `${item.rect.top - top}px`;
        clone.style.width = `${item.rect.width}px`;
        clone.style.height = `${item.rect.height}px`;
        clone.style.margin = "0";
        clone.style.pointerEvents = "none";
        clone.style.transform = "none";
        overlay.appendChild(clone);
    }

    themeHostRef.value?.appendChild(overlay);
    return overlay;
};

/**
 * 播放 IDE 纸面向左滑出动画。
 */
const animateIdePaperSlideOut = (overlay: HTMLElement | null): void => {
    if (!overlay) {
        return;
    }

    const rect = overlay.getBoundingClientRect();
    const distance = Math.max(rect.right + 24, window.innerWidth * 0.72);
    const animation = overlay.animate([
        {transform: "translate3d(0, 0, 0)"},
        {transform: `translate3d(-${distance}px, 0, 0)`},
    ], {
        duration: 360,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
    });
    animation.onfinish = () => overlay.remove();
    window.setTimeout(() => overlay.remove(), 420);
};

/**
 * 在不支持 View Transition 的浏览器里，用纸面滑动 + FLIP 缓和布局 order 变化。
 */
const runFallbackLayoutModeTransition = async (mutation: () => void): Promise<void> => {
    const direction = layoutMode.value === "ide" ? "to-agent" : "to-ide";
    layoutTransitionDirection.value = direction;
    await nextTick();
    const beforeRects = captureModeTransitionRects();
    const idePaperOverlay = direction === "to-agent" ? createIdePaperSlideOverlay() : null;
    mutation();
    await nextTick();

    const animated: Array<{
        element: HTMLElement;
        transform: string;
        transition: string;
        willChange: string;
    }> = [];

    for (const selector of MODE_TRANSITION_SELECTORS) {
        if (direction === "to-agent" && IDE_PAPER_TRANSITION_SELECTORS.includes(selector as typeof IDE_PAPER_TRANSITION_SELECTORS[number])) {
            continue;
        }

        const element = document.querySelector(selector);
        const beforeRect = beforeRects.get(selector);
        if (!(element instanceof HTMLElement) || !beforeRect) {
            continue;
        }

        const afterRect = element.getBoundingClientRect();
        if (beforeRect.width === 0 || beforeRect.height === 0 || afterRect.width === 0 || afterRect.height === 0) {
            continue;
        }

        const deltaX = beforeRect.left - afterRect.left;
        const deltaY = beforeRect.top - afterRect.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
            continue;
        }

        animated.push({
            element,
            transform: element.style.transform,
            transition: element.style.transition,
            willChange: element.style.willChange,
        });
        element.style.transition = "none";
        element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        element.style.willChange = "transform";
    }

    if (animated.length === 0) {
        animateIdePaperSlideOut(idePaperOverlay);
        window.setTimeout(() => {
            if (layoutTransitionDirection.value === direction) {
                layoutTransitionDirection.value = null;
            }
        }, 360);
        return;
    }

    document.body.getBoundingClientRect();
    requestAnimationFrame(() => {
        animateIdePaperSlideOut(idePaperOverlay);
        for (const item of animated) {
            item.element.style.transition = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";
            item.element.style.transform = "translate3d(0, 0, 0)";
        }
        window.setTimeout(() => {
            for (const item of animated) {
                item.element.style.transform = item.transform;
                item.element.style.transition = item.transition;
                item.element.style.willChange = item.willChange;
            }
            if (layoutTransitionDirection.value === direction) {
                layoutTransitionDirection.value = null;
            }
        }, 320);
    });
};

/**
 * 使用浏览器 View Transition 包裹主模式切换，减轻 DOM order 改变带来的硬切。
 */
const runLayoutModeTransition = async (mutation: () => void): Promise<void> => {
    if (!import.meta.client) {
        mutation();
        await nextTick();
        return;
    }

    if (layoutMode.value === "ide") {
        await runFallbackLayoutModeTransition(mutation);
        return;
    }

    const transitionDocument = document as SameDocumentViewTransitionDocument;
    if (!transitionDocument.startViewTransition) {
        await runFallbackLayoutModeTransition(mutation);
        return;
    }

    const transition = transitionDocument.startViewTransition(async () => {
        layoutTransitionDirection.value = layoutMode.value === "ide" ? "to-agent" : "to-ide";
        mutation();
        await nextTick();
    });
    await transition.ready.catch(() => {});
    window.setTimeout(() => {
        layoutTransitionDirection.value = null;
    }, 320);
};

/**
 * 切换主界面的 IDE / Agent layout mode。
 */
const toggleAgentLayoutMode = async (): Promise<void> => {
    if (layoutMode.value === "agent") {
        await runLayoutModeTransition(() => {
            layoutMode.value = "ide";
            rightPanelOpen.value = true;
        });
        return;
    }
    await runLayoutModeTransition(() => {
        layoutMode.value = "agent";
        rightPanelOpen.value = true;
    });
    await agentSurfaceRef.value?.ensureSessionReady();
};

/**
 * Agent Mode 左侧栏请求刷新 leader sessions。
 */
const refreshAgentModeSessions = async (): Promise<void> => {
    await agentSurfaceRef.value?.refreshSessionsWithQuery({
        profileGroup: "leader",
        status: "active",
        relation: "all",
        limit: 50,
    });
};

/**
 * Agent Mode 选择指定 session。
 */
const selectAgentModeSession = async (sessionId: number): Promise<void> => {
    await agentSurfaceRef.value?.selectSession(sessionId);
};

/**
 * Agent Mode 新建默认 leader session。
 */
const createAgentModeSession = async (): Promise<void> => {
    await agentSurfaceRef.value?.createSession();
};

/**
 * Agent Mode 归档指定 session。
 */
const archiveAgentModeSession = async (session: AgentSessionSummaryDto): Promise<void> => {
    await agentSurfaceRef.value?.archiveSessionFromDialog(session);
};

/**
 * 关闭当前 Agent 槽位。
 */
const closeAgentSurface = (): void => {
    if (layoutMode.value === "agent") {
        layoutMode.value = "ide";
        rightPanelOpen.value = true;
        return;
    }
    rightPanelOpen.value = false;
};

/**
 * 切换 Agent Mode 的右侧 Studio 区域。
 */
const toggleAgentModeStudio = (): void => {
    agentStudioPanelVisible.value = !agentStudioPanelVisible.value;
};

/**
 * 左侧窄 sidebar 在 Agent Mode 下只作为 Sessions 入口，不切换 IDE 工具 tab。
 */
const handleSidebarToggle = (tab: NovelIdeTab | "sessions"): void => {
    if (tab === "sessions") {
        agentSessionPanelOpen.value = !agentSessionPanelOpen.value;
        return;
    }
    if (isAgentMode.value) {
        return;
    }
    toggleLeftTab(tab);
};

/**
 * Agent 写入后刷新通用文件树；旧 chapter 事件仍交给 store 兼容处理。
 */
const handleAgentWorkspaceUpdated = async (payload: AgentWorkspaceSyncPayload): Promise<void> => {
    const result = await applyAgentWorkspaceSync(payload);
    await loadWorkspaceTree();
    if (result === "applied") {
        studio.scrollToTop();
    }
};

/**
 * 合并并应用 workspace 文件系统事件。
 */
const flushWorkspaceFileEvents = async (): Promise<void> => {
    if (workspaceFileSyncRunning) {
        return;
    }
    workspaceFileSyncRunning = true;
    try {
        while (pendingWorkspaceFileEvents.length > 0) {
            const events = pendingWorkspaceFileEvents;
            pendingWorkspaceFileEvents = [];
            const result = await syncWorkspaceFromDisk(events);
            if (result.activeFile === "dirty") {
                notification.warning("磁盘文件已更新，但当前编辑器有未保存修改，已保留本地内容。", {title: "文件同步冲突"});
            }
            if (result.activeFile === "deleted") {
                notification.warning("当前文件已在磁盘中删除，编辑器已关闭该文件。", {title: "文件已删除"});
            }
        }
    } finally {
        workspaceFileSyncRunning = false;
    }
};

/**
 * 处理 workspace 文件事件流。
 */
const handleWorkspaceFileEvent = (event: WorkspaceFileStreamEventDto): void => {
    if (event.type !== "workspace_files_changed") {
        return;
    }
    pendingWorkspaceFileEvents.push(...event.events);
    void flushWorkspaceFileEvents();
};

/**
 * 订阅当前 workspace 的文件变化。
 */
const subscribeWorkspaceEvents = (): void => {
    workspaceEventAbortController.value?.abort();
    workspaceEventAbortController.value = null;
    pendingWorkspaceFileEvents = [];
    if (!import.meta.client) {
        return;
    }

    const abortController = new AbortController();
    workspaceEventAbortController.value = abortController;
    const target = workspaceKind.value === "user-assets"
        ? {workspaceKind: "user-assets"} as const
        : currentNovelId.value ? {projectPath: currentNovelId.value} as const : null;
    if (!target) {
        return;
    }
    void workspaceFileEvents.subscribe(target, handleWorkspaceFileEvent, abortController.signal)
        .catch((error) => {
            if (abortController.signal.aborted) {
                return;
            }
            console.warn("[workspace-files] event stream failed", error);
            notification.warning("文件实时同步连接已断开，请手动刷新或重新打开小说。", {title: "同步中断"});
        });
};

/**
 * 把服务端 SSE 帧解析为续写事件。
 */
const handleFrame = (frame: string): void => {
    const lines = frame.split("\n");
    let eventName = "";
    let dataText = "";

    for (const line of lines) {
        if (line.startsWith("event:")) {
            eventName = line.slice("event:".length).trim();
            continue;
        }
        if (line.startsWith("data:")) {
            dataText += line.slice("data:".length).trim();
        }
    }

    if (!eventName || !dataText) {
        return;
    }

    if (eventName === "token") {
        const tokenPayload = JSON.parse(dataText) as StreamTokenEvent;
        const text = typeof tokenPayload.text === "string" ? tokenPayload.text : "";
        if (text) {
            studio.appendStreamText(text);
        }
        return;
    }

    if (eventName === "done") {
        const donePayload = JSON.parse(dataText) as StreamDoneEvent;
        studio.setStatusText(`生成完成，总新增 ${String(donePayload.fullText ?? "").length} 字`);
        return;
    }

    if (eventName === "error") {
        const errorPayload = JSON.parse(dataText) as StreamErrorEvent;
        studio.setStatusText(errorPayload.message ?? "续写失败");
    }
};

/**
 * 停止当前续写请求，并保存当前文件。
 */
const stopContinue = (): void => {
    abortController.value?.abort();
    abortController.value = null;
    studio.setStatusText("已手动停止续写");
    studio.abortStream();
    void saveCurrentWorkspaceFile();
};

/**
 * 发起续写请求并消费 SSE 流，内容源改为当前文件。
 */
const startContinue = async (): Promise<void> => {
    if (studio.loading.value) {
        return;
    }

    await saveCurrentWorkspaceFile();

    if (!selectedFileContent.value.trim()) {
        studio.setStatusText("请先输入部分正文以获取上下文");
        return;
    }
    if (!requirement.value.trim()) {
        studio.setStatusText("请填写具体的情节续写要求");
        return;
    }

    const payload: NovelContinueRequestDto = {
        content: selectedFileContent.value,
        requirement: requirement.value,
    };

    const controller = new AbortController();
    abortController.value = controller;
    studio.loading.value = true;
    studio.setStatusText("AI 加载中...");

    try {
        const response = await fetch("/api/writing/continue", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`请求失败：${response.status}`);
        }
        if (!response.body) {
            throw new Error("服务端未返回流式数据");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        studio.setStatusText("正在续写中...");
        studio.startStream();

        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, {stream: true});
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";

            for (const frame of frames) {
                handleFrame(frame);
            }
        }

        if (buffer.trim()) {
            handleFrame(buffer);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            studio.setStatusText("已手动停止续写");
        } else {
            studio.setStatusText(error instanceof Error ? error.message : "请求失败获取异常");
        }
    } finally {
        abortController.value = null;
        studio.finishStream();
    }
};

/**
 * 读取后端默认模型展示名。
 */
const syncDefaultModelLabel = async (): Promise<void> => {
    try {
        const query = workspaceKind.value === "user-assets" || !currentNovelId.value
            ? {workspaceKind: "user-assets"} as const
            : {workspaceKind: "novel", projectPath: currentNovelId.value} as const;
        const settings = await $fetch<ConfigBootstrapDto>("/api/config/bootstrap", {
            query,
        });
        setSelectedModelLabel(settings.modelSettings.defaultModelLabel);
    } catch {
        setSelectedModelLabel(null);
    }
};

/**
 * 同步当前登录用户，用于右上角账户菜单。
 */
const syncAuthSession = async (): Promise<void> => {
    if (authSessionState.session.value) {
        currentUser.value = authSessionState.session.value.user;
        return;
    }
    try {
        const session = await $fetch<AuthSessionDto>("/api/auth/me");
        authSessionState.setSession(session);
        currentUser.value = session.user;
    } catch {
        authSessionState.setSession(null);
        currentUser.value = null;
    }
};

/**
 * 退出登录并回到登录页。
 */
const logout = async (): Promise<void> => {
    await $fetch("/api/auth/logout", {method: "POST"});
    authSessionState.setSession(null);
    currentUser.value = null;
    await navigateTo("/login");
};

/**
 * 进入管理员后台。
 */
const openAdmin = async (): Promise<void> => {
    await navigateTo("/admin/users");
};

/**
 * 切换左侧标签；若重复点击则收起。
 */
const toggleLeftTab = (tab: NovelIdeTab): void => {
    activeLeftTab.value = activeLeftTab.value === tab ? null : tab;
};

/**
 * 从顶部栏直接打开剧本工作台。
 */
const openPlotWorkbench = (): void => {
    if (isUserAssetsWorkspace.value) {
        return;
    }
    novelIdeStore.plotWorkbenchOpen = true;
};

/**
 * 打开全局用户 assets 工作区。
 */
const openUserAssets = (): void => {
    const resolved = router.resolve(buildProjectRoute(USER_ASSETS_PROJECT_TARGET));
    window.open(resolved.href, "_blank", "noopener,noreferrer");
};

/**
 * 根据页面 query 初始化当前工作区。
 */
const initializeWorkspaceFromRoute = async (): Promise<void> => {
    const target = parseProjectRouteTarget();
    if (target.kind === "user-assets") {
        await switchToUserAssetsWorkspace();
        activeLeftTab.value = "files";
        return;
    }

    await switchToNovelWorkspace(target.kind === "project" ? target.projectPath : undefined);
};

/**
 * 判断当前 store 状态是否已经匹配页面 query。
 */
const workspaceRouteSynced = (): boolean => {
    const target = parseProjectRouteTarget();
    if (target.kind === "user-assets") {
        return isUserAssetsWorkspace.value;
    }
    if (target.kind === "project" && novels.value.some((novel) => novel.id === target.projectPath)) {
        return workspaceKind.value === "novel" && currentNovelId.value === target.projectPath;
    }
    return !route.query.project && workspaceKind.value === "novel";
};

/**
 * 将当前小说页面规范成可分享的 query URL。
 */
const normalizeNovelRouteQuery = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value || !currentNovelId.value) {
        return;
    }
    if (route.query.project === currentNovelId.value) {
        return;
    }
    await router.replace(buildProjectRoute(currentNovelId.value));
};

/**
 * 监听页面 query 变化，允许主页面直接切换 novel/user-assets workspace。
 */
const syncWorkspaceRoute = async (): Promise<void> => {
    if (workspaceRouteSynced()) {
        if (!isUserAssetsWorkspace.value) {
            await normalizeNovelRouteQuery();
        }
        subscribeWorkspaceEvents();
        return;
    }
    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") {
        return;
    }
    await initializeWorkspaceFromRoute();
    if (!isUserAssetsWorkspace.value) {
        await normalizeNovelRouteQuery();
    }
    subscribeWorkspaceEvents();
};

/**
 * 打开当前 Markdown 文件的类型专属 frontmatter 档案。
 */
function openFrontmatterProfile(kind: FrontmatterProfileKind): void {
    frontmatterProfileKind.value = kind;
}

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            workspaceBootstrapped.value = true;
            return;
        }

        try {
            mountThemeHost(themeHostRef.value);
            window.addEventListener("pagehide", flushWorkspaceSession);
            window.addEventListener("beforeunload", flushWorkspaceSession);
            void syncAuthSession();
            await initializeWorkspaceFromRoute();
            await syncDefaultModelLabel();
            if (!isUserAssetsWorkspace.value) {
                await normalizeNovelRouteQuery();
            }
            subscribeWorkspaceEvents();
            initialized.value = true;
        } finally {
            workspaceBootstrapped.value = true;
        }
    })();
});

watch(() => route.query.project, () => {
    if (!initialized.value) {
        return;
    }
    void syncWorkspaceRoute();
});

onBeforeUnmount(() => {
    studio.abortStream();
    abortController.value?.abort();
    abortController.value = null;
    workspaceEventAbortController.value?.abort();
    workspaceEventAbortController.value = null;
    if (import.meta.client) {
        window.removeEventListener("pagehide", flushWorkspaceSession);
        window.removeEventListener("beforeunload", flushWorkspaceSession);
    }
    novelIdeStore.persistWorkspaceSession();
});
</script>

<template>
    <!-- IDE 页面根容器 -->
    <div ref="themeHostRef" class="novel-ide-page ide-shell flex h-screen flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <NovelIdeHeader
            class="ide-panel ide-header"
            :right-panel-open="isAgentMode ? agentStudioPanelOpen : displayRightPanelOpen"
            :agent-mode-active="isAgentMode"
            :novel-title="displayNovelTitle"
            :novel-items="displayNovelItems"
            :current-user="currentUser"
            :workspace-mode="isUserAssetsWorkspace ? 'user-assets' : 'novel'"
            @toggle-layout-mode="void toggleAgentLayoutMode()"
            @toggle-agent="isAgentMode ? toggleAgentModeStudio() : rightPanelOpen = !rightPanelOpen"
            @open-bookshelf="bookshelfOpen = true"
            @open-plot-workbench="openPlotWorkbench"
            @open-user-assets="openUserAssets"
            @open-profile-workbench="profileWorkbenchOpen = true"
            @switch-novel="handleSwitchNovel"
            @open-admin="void openAdmin()"
            @logout="void logout()"
        />

        <div class="flex min-h-0 flex-1 overflow-hidden">
            <NovelIdeSidebar class="ide-sidebar" :active-tab="displaySidebarActiveTab" :agent-mode="isAgentMode" :user-assets-mode="isUserAssetsWorkspace" @toggle-tab="handleSidebarToggle" @collapse="activeLeftTab = null" @open-settings="settingsDialogOpen = true" />

            <AgentModeSessionSidebar
                :sessions="agentModeSessions"
                :active-session-id="agentModeActiveSessionId"
                :loading="agentModeLoadingSession"
                :running="agentModeRunning"
                :action-id="agentModeSessionActionId"
                :workspace-key="agentWorkspaceKey"
                :open="isAgentMode && agentSessionPanelOpen"
                :width="agentSessionPanelWidth"
                @update:width="agentSessionPanelWidth = $event"
                @select="void selectAgentModeSession($event)"
                @create="void createAgentModeSession()"
                @archive="void archiveAgentModeSession($event)"
                @refresh="void refreshAgentModeSessions()"
            />

            <div
                class="mode-transition-ide-tools flex h-full shrink-0 overflow-hidden transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="[
                    ideToolPanelOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-2 opacity-0',
                    layoutTransitionDirection ? 'transition-none' : '',
                ]"
                :style="ideToolPanelStyle"
            >
                <NovelIdeToolPanel v-model:width="leftPanelWidth" class="ide-panel h-full" :active-tab="displayActiveLeftTab" :user-assets-mode="isUserAssetsWorkspace" @close="activeLeftTab = null" />
            </div>

            <!-- Studio 工作区 -->
            <main
                class="mode-transition-studio ide-editor-canvas relative flex min-w-0 flex-col overflow-hidden bg-[var(--editor-canvas-bg)] transition-[width,flex-basis,opacity,border-color,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="[
                    isAgentMode ? 'shrink order-3' : 'flex-1 order-2',
                    isAgentMode && agentStudioPanelOpen && layoutTransitionDirection !== 'to-agent' ? 'border-l border-[var(--border-color)] opacity-100' : '',
                    isAgentMode && !agentStudioPanelOpen ? 'pointer-events-none border-l-0 opacity-0' : '',
                    layoutTransitionDirection === 'to-agent' ? 'pointer-events-none border-l-0 opacity-0' : '',
                    layoutTransitionDirection ? 'transition-none' : '',
                    resizingAgentStudioPanel ? 'select-none transition-none' : '',
                ]"
                :style="agentStudioStyle"
            >
                <template v-if="isAgentMode && agentStudioPanelOpen">
                    <div ref="agentStudioResizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                        <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="resizingAgentStudioPanel ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
                    </div>
                </template>
                <div v-if="isAgentMode" class="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3">
                    <div class="min-w-0">
                        <div class="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Studio</div>
                    </div>
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="agentStudioFileTreeOpen ? '收起文件树' : '展开文件树'" @click="agentStudioFileTreeOpen = !agentStudioFileTreeOpen">
                        <span :class="agentStudioFileTreeOpen ? 'i-lucide-panel-right-close' : 'i-lucide-folder-tree'" class="h-4 w-4"></span>
                    </button>
                </div>

                <div class="flex min-h-0 flex-1 overflow-hidden">
                    <div class="contain-layout-paint flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" :class="resizingAgentStudioPanel || resizingAgentStudioFileTree ? 'pointer-events-none select-none' : ''">
                        <MarkdownStudioWorkbench
                            v-model:content="selectedFileContent"
                            :controller="studio"
                            :tabs="displayWorkspaceTabs"
                            :active-path="displayActiveWorkspaceTabPath"
                            :node="displaySelectedFileNode"
                            :editor-kind="displayCurrentEditorKind"
                            :workspace-view-mode="displayCurrentWorkspaceViewMode"
                            :theme="theme"
                            :compact="isAgentMode"
                            :editor-preferences="markdownEditorPreferences"
                            :monaco-preferences="monacoEditorPreferences"
                            :monaco-temporary-font-size="displayMonacoTemporaryFontSize"
                            :diagnostics-text="fileDiagnosticsText"
                            :reference-refresh-key="workspaceReferenceRefreshKey"
                            :resolve-menu="resolveMarkdownMenu"
                            :open-reference="openWorkspaceReference"
                            :resolve-reference="resolveWorkspaceReferencePreview"
                            @select-tab="void selectWorkspaceTab($event)"
                            @close-tab="void closeEditorTab($event)"
                            @set-pin="setWorkspaceTabPinned"
                            @keep-tab="keepWorkspaceTab"
                            @move-tab="moveWorkspaceTab"
                            @set-view-mode="setCurrentWorkspaceViewMode"
                            @update-monaco-temporary-font-size="setMonacoFontSizeOverride(displayActiveWorkspaceTabPath, $event)"
                            @save-request="void saveCurrentWorkspaceFile()"
                            @open-frontmatter-profile="openFrontmatterProfile"
                        />
                    </div>
                    <div
                        v-if="isAgentMode && agentStudioFileTreeOpen"
                        class="agent-mode-studio-file-tree relative h-full shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-panel)]"
                        :class="resizingAgentStudioPanel || resizingAgentStudioFileTree ? 'select-none transition-none' : ''"
                        :style="agentStudioFileTreeStyle"
                    >
                        <div ref="agentStudioFileTreeResizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                            <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="resizingAgentStudioFileTree ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
                        </div>
                        <div class="contain-layout-paint h-full">
                            <WorkspaceFilePanel />
                        </div>
                    </div>
                </div>

                <NovelPromptBar
                    v-if="!isAgentMode"
                    class="ide-prompt-bar"
                    :model-value="displayRequirement"
                    :loading="studio.loading.value || loadingWorkspace"
                    :typing="studio.typing.value"
                    :status-text="studio.statusText.value"
                    :selected-model="displaySelectedModel"
                    :selected-reasoning="displaySelectedReasoning"
                    :expanded="displayPromptExpanded"
                    @update:model-value="requirement = $event"
                    @update:expanded="promptExpanded = $event"
                    @send="startContinue"
                    @stop="stopContinue"
                />
            </main>

            <!-- Agent Chat Surface 槽位 -->
            <section
                class="mode-transition-agent relative z-30 flex h-full min-h-0 shrink-0 flex-col bg-[var(--bg-panel)] transition-[width,flex,opacity,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="[
                    isAgentMode ? 'order-2 min-w-[340px] flex-[1.2] border-x border-[var(--border-color)] opacity-100' : 'order-3 shadow-2xl',
                    !isAgentMode && displayRightPanelOpen ? 'border-l border-[var(--border-color)] opacity-100' : '',
                    !isAgentMode && !displayRightPanelOpen ? 'pointer-events-none border-l-0 opacity-0' : '',
                    layoutTransitionDirection ? 'transition-none' : '',
                    resizingAgentPanel ? 'select-none transition-none' : '',
                ]"
                :style="agentSlotStyle"
            >
                <template v-if="!isAgentMode && displayRightPanelOpen">
                    <div ref="agentResizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                        <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="resizingAgentPanel ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
                    </div>
                </template>
                <AgentChatSurface
                    ref="agentSurfaceRef"
                    class="contain-layout-paint min-h-0 flex-1"
                    :active="agentSurfaceActive"
                    :layout="isAgentMode ? 'workbench' : 'drawer'"
                    :novel-id="displayNovelIdForAgent"
                    :selected-file-path="selectedFilePath"
                    @close="closeAgentSurface"
                    @sync-workspace="void handleAgentWorkspaceUpdated($event)"
                />
            </section>
        </div>

        <NovelBookshelfDialog v-model="bookshelfOpen" @switched="void router.replace(buildProjectRoute($event))" />
        <NovelIdeSettingsDialog v-model="settingsDialogOpen" />
        <UserProfileWorkbenchDialog v-model="profileWorkbenchOpen" />
        <WorkspaceFileConflictDialog
            v-model="novelIdeStore.workspaceConflictDialogOpen"
            :conflict="novelIdeStore.workspaceWriteConflict"
            :theme="theme"
            @resolve="void resolveWorkspaceWriteConflict($event)"
        />
        <WorkspaceCharacterDetailPanel
            v-model="characterProfileVisible"
            dialog-only
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="0"
            @refresh="void loadWorkspaceTree()"
        />
        <WorkspaceLocationProfileDialog
            v-model="locationProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
        />
        <WorkspaceRuleProfileDialog
            v-model="ruleProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
        />
    </div>
</template>

<style scoped>
.novel-ide-page {
    --ide-header-height: 48px;
    --ide-toolbar-height: 48px;
    --editor-min-height: calc(100vh - var(--ide-header-height) - var(--ide-toolbar-height));
}

.plain-text-editor {
    caret-color: var(--accent-main);
}

:global(.contain-layout-paint) {
    contain: layout paint;
}

:global(.ide-agent-mode-switch) {
    view-transition-name: ide-agent-mode-switch;
}

:global(.mode-transition-agent) {
    view-transition-name: ide-agent-surface;
}

:global(.mode-transition-studio) {
    view-transition-name: ide-studio-surface;
}

:global(.mode-transition-ide-tools) {
    view-transition-name: ide-tools-panel;
}

:global(.agent-mode-session-sidebar) {
    view-transition-name: agent-session-panel;
}

:global(::view-transition-old(root)),
:global(::view-transition-new(root)),
:global(::view-transition-old(ide-agent-mode-switch)),
:global(::view-transition-new(ide-agent-mode-switch)),
:global(::view-transition-old(ide-agent-surface)),
:global(::view-transition-new(ide-agent-surface)),
:global(::view-transition-old(ide-studio-surface)),
:global(::view-transition-new(ide-studio-surface)),
:global(::view-transition-old(ide-tools-panel)),
:global(::view-transition-new(ide-tools-panel)),
:global(::view-transition-old(agent-session-panel)),
:global(::view-transition-new(agent-session-panel)) {
    animation-duration: 300ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
