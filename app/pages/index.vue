<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";
import type {ModelSettingsDto} from "nbook/shared/dto/app-settings.dto";
import type {NovelContinueRequestDto} from "nbook/shared/dto/novel.dto";
import {isNovelIdeTab, type NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import MarkdownStudioWorkbench from "nbook/app/components/markdown-studio/MarkdownStudioWorkbench.vue";
import NovelAgentDrawer from "nbook/app/components/novel-ide/NovelAgentDrawer.vue";
import NovelIdeHeader from "nbook/app/components/novel-ide/NovelIdeHeader.vue";
import NovelIdeSidebar from "nbook/app/components/novel-ide/NovelIdeSidebar.vue";
import NovelIdeSettingsDialog from "nbook/app/components/novel-ide/NovelIdeSettingsDialog.vue";
import NovelIdeToolPanel from "nbook/app/components/novel-ide/NovelIdeToolPanel.vue";
import NovelPromptBar from "nbook/app/components/novel-ide/NovelPromptBar.vue";
import NovelBookshelfDialog from "nbook/app/components/novel-ide/NovelBookshelfDialog.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import WorkspaceFileConflictDialog from "nbook/app/components/novel-ide/workspace/WorkspaceFileConflictDialog.vue";
import WorkspaceLocationProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceLocationProfileDialog.vue";
import WorkspaceRuleProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceRuleProfileDialog.vue";
import type {WorkspaceReferencePreviewMeta} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useMarkdownStudioController} from "nbook/app/composables/useMarkdownStudioController";
import {useWorkspaceFileEvents} from "nbook/app/composables/useWorkspaceFileEvents";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import type {AgentTriggerMenuContext, AgentTriggerMenuItem, AgentTriggerMenuState, MarkdownCommandKind} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload, type WorkspaceEditorKind, type WorkspaceEditorViewMode, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFileChangeEventDto, WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {
    collectWorkspaceReferencePathCandidates,
    searchWorkspaceReferences,
    type WorkspaceReferenceSearchInput,
} from "nbook/app/utils/workspace-reference-search";
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

const abortController = ref<AbortController | null>(null);
const initialized = ref(false);
const themeHostRef = ref<HTMLElement | null>(null);
const currentUser = ref<AuthSessionDto["user"]>(null);
const bookshelfOpen = ref(false);
const settingsDialogOpen = ref(false);
const frontmatterProfileKind = ref<FrontmatterProfileKind | null>(null);
const fileDiagnosticsText = ref("");
const saveQueued = ref(false);
const workspaceEventAbortController = ref<AbortController | null>(null);
let workspaceFileSyncRunning = false;
let pendingWorkspaceFileEvents: WorkspaceFileChangeEventDto[] = [];

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
    validateWorkspace,
} = novelIdeStore;
const {mountThemeHost} = useIdeTheme(theme);
const workspaceFileEvents = useWorkspaceFileEvents();

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

const isHydrated = ref(false);
const displayRightPanelOpen = computed(() => isHydrated.value && rightPanelOpen.value);
const displayActiveLeftTab = computed<NovelIdeTab | null>(() => {
    if (!isHydrated.value) {
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
const displayNovelTitle = computed(() => isUserAssetsWorkspace.value ? "用户资产" : currentNovel.value?.title ?? "");
const displayNovelItems = computed(() => isUserAssetsWorkspace.value ? [] : novelItems.value);
const displayNovelIdForAgent = computed(() => isUserAssetsWorkspace.value ? "" : currentNovelId.value);

/**
 * 当前文件扩展名，统一用于编辑器类型判断。
 */
const currentFileExtension = computed(() => {
    return resolveWorkspaceFileExtension(selectedFilePath.value);
});

const activeWorkspaceTab = computed(() => workspaceTabs.value.find((tab) => tab.path === activeWorkspaceTabPath.value) ?? null);
const currentWorkspaceViewMode = computed(() => activeWorkspaceTab.value?.viewMode ?? (isMarkdownFile.value ? "rich" : "source"));
const currentEditorKind = computed(() => activeWorkspaceTab.value?.editorKind ?? (isMarkdownFile.value ? "markdown" : selectedFileNode.value?.editable ? "monaco" : "readonly"));
const workspaceDisplayReady = computed(() => isHydrated.value && workspaceReady.value);
const displayWorkspaceTabs = computed(() => workspaceDisplayReady.value ? workspaceTabs.value : []);
const displayActiveWorkspaceTabPath = computed(() => workspaceDisplayReady.value ? activeWorkspaceTabPath.value : "");
const displaySelectedFileNode = computed(() => workspaceDisplayReady.value ? selectedFileNode.value : null);
const displayCurrentEditorKind = computed<WorkspaceEditorKind>(() => workspaceDisplayReady.value ? currentEditorKind.value : "readonly");
const displayCurrentWorkspaceViewMode = computed<WorkspaceEditorViewMode>(() => workspaceDisplayReady.value ? currentWorkspaceViewMode.value : "source");
const displayPromptExpanded = computed(() => isHydrated.value ? promptExpanded.value : true);
const displayRequirement = computed(() => isHydrated.value ? requirement.value : "");
const displaySelectedModel = computed(() => isHydrated.value ? selectedModel.value : "未配置模型");
const displaySelectedReasoning = computed(() => isHydrated.value ? selectedReasoning.value : "中");
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

    const referenceSections = buildWorkspaceReferenceSections(context.query);
    return {
        title: "引用",
        prefix: "@",
        sections: referenceSections.length > 0 ? referenceSections : [createEmptyMenuSection(context.query)],
    };
}

/**
 * 从当前 workspace tree 生成按类型分组的引用候选。
 */
function buildWorkspaceReferenceSections(query: string): Array<{id: string; title: string; items: AgentTriggerMenuItem[]}> {
    const candidates = workspaceTree.value
        .filter((node) => isReferenceCandidate(node))
        .map((node, index): WorkspaceReferenceSearchInput<AgentTriggerMenuItem> => {
            const label = node.title?.trim() || basename(node.path);
            const target = referenceTarget(node);
            const entryType = resolveReferenceEntryType(node);
            const item = {
                id: `workspace-reference:${target}`,
                label,
                description: node.summary || target,
                iconClass: node.icon ? `i-lucide-${node.icon}` : node.isDirectory ? "i-lucide-folder" : "i-lucide-file-text",
                hint: entryType,
                workspaceReference: {
                    label,
                    target,
                    entryType,
                    icon: node.icon,
                },
            } satisfies AgentTriggerMenuItem;
            return {
                item,
                label,
                target,
                description: node.summary || target,
                entryType,
                menuId: item.id,
                frontmatter: node.frontmatter,
                order: index,
            };
        });
    const items = searchWorkspaceReferences(candidates, query, 40).map((result) => result.item);
    const sectionOrder = ["chapter", "character", "location", "item", "rule", "note", "file", "folder"];
    const extraTypes = [...new Set(items
        .map((item) => item.workspaceReference?.entryType ?? "file")
        .filter((entryType) => !sectionOrder.includes(entryType)))];
    return [...sectionOrder, ...extraTypes]
        .map((entryType) => {
            const sectionItems = items.filter((item) => item.workspaceReference?.entryType === entryType);
            return {
                id: `workspace-reference-${entryType}`,
                title: referenceSectionTitle(entryType),
                items: sectionItems,
            };
        })
        .filter((section) => section.items.length > 0);
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
 * 解析引用候选的展示类型。
 */
function resolveReferenceEntryType(node: WorkspaceFileNode): string {
    if (node.contentNode && node.entryType && !node.frontmatterError) {
        return node.entryType;
    }
    return node.isDirectory ? "folder" : "file";
}

/**
 * 引用菜单分组标题。
 */
function referenceSectionTitle(entryType: string): string {
    const titles: Record<string, string> = {
        chapter: "章节",
        character: "角色",
        location: "地点",
        item: "物品",
        rule: "规则",
        note: "笔记",
        file: "文件",
        folder: "目录",
    };
    return titles[entryType] ?? entryType;
}

/**
 * 判断节点是否适合作为 @ 引用候选。
 */
function isReferenceCandidate(node: WorkspaceFileNode): boolean {
    if (node.isDirectory) {
        return node.contentNode || node.hasIndex;
    }
    if (node.contentNode && node.path.toLowerCase().endsWith("/index.md")) {
        return false;
    }
    return node.editable && node.path.toLowerCase().endsWith(".md");
}

/**
 * 将节点路径转成 Markdown 引用 target。
 */
function referenceTarget(node: WorkspaceFileNode): string {
    if (node.isDirectory) {
        return `${normalizeWorkspacePath(node.path)}/`;
    }
    return normalizeWorkspacePath(node.path);
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
        if (route.query.workspace !== "novel" || route.query.novelId !== novelId) {
            await router.replace({path: "/", query: {workspace: "novel", novelId}});
        }
        return;
    }

    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") {
        return;
    }

    await switchNovel(novelId, {discardWorkspaceChanges: decision === "discard"});
    await router.replace({path: "/", query: {workspace: "novel", novelId}});
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
        : currentNovelId.value ? {novelId: currentNovelId.value} as const : null;
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
        const settings = await $fetch<ModelSettingsDto>("/api/settings/models");
        setSelectedModelLabel(settings.defaultModelLabel);
    } catch {
        setSelectedModelLabel(null);
    }
};

/**
 * 同步当前登录用户，用于右上角账户菜单。
 */
const syncAuthSession = async (): Promise<void> => {
    try {
        const session = await $fetch<AuthSessionDto>("/api/auth/me");
        currentUser.value = session.user;
    } catch {
        currentUser.value = null;
    }
};

/**
 * 退出登录并回到登录页。
 */
const logout = async (): Promise<void> => {
    await $fetch("/api/auth/logout", {method: "POST"});
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
    const resolved = router.resolve({path: "/", query: {workspace: "user-assets"}});
    window.open(resolved.href, "_blank", "noopener,noreferrer");
};

/**
 * 根据页面 query 初始化当前工作区。
 */
const initializeWorkspaceFromRoute = async (): Promise<void> => {
    const workspaceQuery = typeof route.query.workspace === "string" ? route.query.workspace : "";
    const novelIdQuery = typeof route.query.novelId === "string" ? route.query.novelId : "";

    if (workspaceQuery === "user-assets") {
        await switchToUserAssetsWorkspace();
        activeLeftTab.value = "files";
        return;
    }

    await switchToNovelWorkspace(workspaceQuery === "novel" ? novelIdQuery : undefined);
};

/**
 * 判断当前 store 状态是否已经匹配页面 query。
 */
const workspaceRouteSynced = (): boolean => {
    const workspaceQuery = typeof route.query.workspace === "string" ? route.query.workspace : "";
    const novelIdQuery = typeof route.query.novelId === "string" ? route.query.novelId : "";
    if (workspaceQuery === "user-assets") {
        return isUserAssetsWorkspace.value;
    }
    if (workspaceQuery === "novel" && novelIdQuery && novels.value.some((novel) => novel.id === novelIdQuery)) {
        return workspaceKind.value === "novel" && currentNovelId.value === novelIdQuery;
    }
    return workspaceKind.value === "novel";
};

/**
 * 将当前小说页面规范成可分享的 query URL。
 */
const normalizeNovelRouteQuery = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value || !currentNovelId.value) {
        return;
    }
    if (route.query.workspace === "novel" && route.query.novelId === currentNovelId.value) {
        return;
    }
    await router.replace({path: "/", query: {workspace: "novel", novelId: currentNovelId.value}});
};

/**
 * 监听页面 query 变化，允许主页面直接切换 novel/user-assets workspace。
 */
const syncWorkspaceRoute = async (): Promise<void> => {
    if (workspaceRouteSynced()) {
        subscribeWorkspaceEvents();
        return;
    }
    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") {
        return;
    }
    await initializeWorkspaceFromRoute();
    if (!isUserAssetsWorkspace.value) {
        await validateWorkspace();
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
            isHydrated.value = true;
            return;
        }

        try {
            mountThemeHost(themeHostRef.value);
            window.addEventListener("pagehide", flushWorkspaceSession);
            window.addEventListener("beforeunload", flushWorkspaceSession);
            await syncAuthSession();
            await syncDefaultModelLabel();
            await initializeWorkspaceFromRoute();
            if (!isUserAssetsWorkspace.value) {
                await validateWorkspace();
                await normalizeNovelRouteQuery();
            }
            subscribeWorkspaceEvents();
            initialized.value = true;
        } finally {
            isHydrated.value = true;
        }
    })();
});

watch(() => [route.query.workspace, route.query.novelId], () => {
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
        <ClientOnly>
            <NovelIdeHeader
                class="ide-panel ide-header"
                :right-panel-open="displayRightPanelOpen"
                :novel-title="displayNovelTitle"
                :novel-items="displayNovelItems"
                :current-user="currentUser"
                :workspace-mode="isUserAssetsWorkspace ? 'user-assets' : 'novel'"
                @toggle-agent="rightPanelOpen = !rightPanelOpen"
                @open-bookshelf="bookshelfOpen = true"
                @open-plot-workbench="openPlotWorkbench"
                @open-user-assets="openUserAssets"
                @switch-novel="handleSwitchNovel"
                @open-admin="void openAdmin()"
                @logout="void logout()"
            />
            <template #fallback>
                <!-- 顶部栏 SSR 占位，真实 Header 等客户端状态恢复后挂载。 -->
                <header class="ide-panel ide-header flex h-12 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-panel)]"></header>
            </template>
        </ClientOnly>

        <div class="flex min-h-0 flex-1 overflow-hidden">
            <NovelIdeSidebar class="ide-sidebar" :active-tab="displayActiveLeftTab" :user-assets-mode="isUserAssetsWorkspace" @toggle-tab="toggleLeftTab" @collapse="activeLeftTab = null" @open-settings="settingsDialogOpen = true" />

            <NovelIdeToolPanel class="ide-panel" :active-tab="displayActiveLeftTab" :user-assets-mode="isUserAssetsWorkspace" @close="activeLeftTab = null" />

            <!-- 中央工作区 -->
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

                <NovelPromptBar
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

            <NovelAgentDrawer
                class="ide-agent-drawer"
                :is-open="displayRightPanelOpen"
                :novel-id="displayNovelIdForAgent"
                :selected-file-path="selectedFilePath"
                @close="rightPanelOpen = false"
                @sync-workspace="void handleAgentWorkspaceUpdated($event)"
            />
        </div>

        <NovelBookshelfDialog v-model="bookshelfOpen" @switched="void router.replace({path: '/', query: {workspace: 'novel', novelId: $event}})" />
        <NovelIdeSettingsDialog v-model="settingsDialogOpen" />
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
            @validate="void validateWorkspace()"
        />
        <WorkspaceLocationProfileDialog
            v-model="locationProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
            @validate="void validateWorkspace()"
        />
        <WorkspaceRuleProfileDialog
            v-model="ruleProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
            @validate="void validateWorkspace()"
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
</style>
