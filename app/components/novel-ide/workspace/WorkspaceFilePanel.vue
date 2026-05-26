<script setup lang="ts">
import {storeToRefs} from "pinia";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import WorkspaceFileTree from "nbook/app/components/novel-ide/workspace/WorkspaceFileTree.vue";
import WorkspaceFileDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceFileDetailPanel.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import WorkspaceLorebookDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceLorebookDetailPanel.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    canMovePath,
    collectAncestorPaths,
    isWorkspaceContentScopePath,
    isWorkspaceContentDirectoryNode,
    isWorkspaceLorebookScopePath,
    isWorkspaceLorebookEntry,
    normalizeWorkspacePath,
    resolveMovedPath,
    type WorkspaceFileMovePayload,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const store = useNovelIdeStore();
const {choose, confirm, prompt} = useDialog();
const {error: notifyError} = useNotification();
const {
    canAccessWorkspace,
    loadingWorkspaceTree,
    selectedFileNode,
    selectedFilePath,
    workspaceIssues,
    workspaceTree,
} = storeToRefs(store);

const searchQuery = ref("");
const expandedPaths = ref<string[]>([]);
const detailHeight = ref(260);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const WORKSPACE_EXPANDED_PATHS_STORAGE_KEY = "nbook.workspaceFilePanel.expandedPaths";
const LOREBOOK_ENTRY_TYPES = ["location", "character", "item", "rule", "note"] as const;

type LorebookEntryType = typeof LOREBOOK_ENTRY_TYPES[number];

const filteredNodes = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
        return workspaceTree.value;
    }

    const matched = workspaceTree.value.filter((node) => [
        node.path,
        node.title,
        node.summary,
        node.entryType ?? "",
        node.status ?? "",
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(query)));
    const ancestorPathSet = new Set(collectAncestorPaths(matched));
    return workspaceTree.value.filter((node) => matched.includes(node) || ancestorPathSet.has(node.path));
});
const forcedExpandedPaths = computed(() => searchQuery.value.trim() ? collectAncestorPaths(filteredNodes.value) : []);
const existingPathSet = computed(() => new Set(workspaceTree.value.map((node) => normalizeWorkspacePath(node.path))));
const showCharacterDetail = computed(() => isWorkspaceLorebookEntry(selectedFileNode.value) && selectedFileNode.value?.entryType === "character");
const showLorebookDetail = computed(() => isWorkspaceLorebookEntry(selectedFileNode.value) && selectedFileNode.value?.entryType !== "character");

/**
 * 打开右键菜单。
 */
function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = items;
    contextMenuVisible.value = true;
}

/**
 * 选择文件树节点。
 */
async function selectNode(node: WorkspaceFileNode): Promise<void> {
    await store.openWorkspacePath(node.path, "preview");
}

/**
 * 双击打开节点并保留标签。
 */
async function openNode(node: WorkspaceFileNode): Promise<void> {
    await store.openWorkspacePath(node.path, "permanent");
}

/**
 * 刷新文件树。
 */
async function refreshTree(): Promise<void> {
    await store.loadWorkspaceTree();
}

/**
 * 复制当前文件引用。
 */
async function copyReference(node = selectedFileNode.value): Promise<void> {
    if (!node || !import.meta.client) {
        return;
    }
    await navigator.clipboard.writeText(buildReferenceTarget(node));
}

/**
 * 新建文件。
 */
async function createFile(baseDir = ""): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const prefix = baseDir ? `${baseDir.replace(/\/$/, "")}/` : "";
    const input = await prompt("请输入新文件路径", `${prefix}new-file.md`);
    const filePath = typeof input === "string" ? input.trim() : "";
    if (!filePath) {
        return;
    }

    const node = await store.createWorkspaceFile(filePath, "");
    await store.selectWorkspacePath(node.path);
}

/**
 * 通过通用文件接口创建一个带 lorebook frontmatter 的 Markdown 文件。
 */
async function createLorebookEntry(baseDir: string | null = null): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const selectedType = await choose("请选择 Lorebook 条目类型", [
        {label: "地点", value: "location", tone: "primary"},
        {label: "角色", value: "character"},
        {label: "物品", value: "item"},
        {label: "规则", value: "rule"},
        {label: "笔记", value: "note"},
    ], "新建 Lorebook 条目");
    if (!isLorebookEntryType(selectedType)) {
        return;
    }

    const defaultDir = baseDir === null ? `lorebook/${selectedType}/` : baseDir;
    const prefix = defaultDir ? `${defaultDir.replace(/\/$/, "")}/` : "";
    const input = await prompt("请输入 Lorebook 条目路径", `${prefix}new-entry`, "新建 Lorebook 条目");
    const rawPath = typeof input === "string" ? input.trim() : "";
    if (!rawPath) {
        return;
    }

    const filePath = normalizeLorebookEntryIndexPath(rawPath);
    if (!isWorkspaceLorebookScopePath(filePath)) {
        notifyError("Lorebook 条目必须创建在 lorebook/ 目录下。", {title: "创建 Lorebook 条目失败"});
        return;
    }

    try {
        const node = await store.createWorkspaceFile(filePath, buildLorebookEntryContent(filePath, selectedType));
        expandedPaths.value = [...new Set([...expandedPaths.value, resolveParentDirectory(node.path)])].filter(Boolean);
        await store.selectWorkspacePath(node.path);
    } catch (error) {
        notifyError(formatCreateError(error), {title: "创建 Lorebook 条目失败"});
    }
}

/**
 * 新建普通目录，不默认创建 index.md。
 */
async function createDirectory(baseDir = ""): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const prefix = baseDir ? `${baseDir.replace(/\/$/, "")}/` : "";
    const input = await prompt("请输入新目录路径", `${prefix}new-folder`);
    const dirPath = typeof input === "string" ? input.trim() : "";
    if (!dirPath) {
        return;
    }

    const node = await store.createWorkspaceDirectory(dirPath);
    expandedPaths.value = [...new Set([...expandedPaths.value, node.path])];
    await store.selectWorkspacePath(node.path);
}

/**
 * 为现有目录创建 index.md，使其成为可编辑目录节点。
 */
async function createDirectoryIndex(node: WorkspaceFileNode | null = selectedFileNode.value): Promise<void> {
    if (!node || !canCreateDirectoryIndex(node)) {
        return;
    }

    try {
        const dirPath = node.path.replace(/\/$/, "");
        const indexPath = `${dirPath}/index.md`;
        const indexNode = await store.createWorkspaceFile(indexPath, buildDirectoryIndexContent(node));
        expandedPaths.value = [...new Set([...expandedPaths.value, node.path])];
        await store.selectWorkspacePath(indexNode.path);
    } catch (error) {
        notifyError(formatCreateError(error), {title: "转化目录节点失败"});
    }
}

/**
 * 将文件转换为同名目录下的 index.md。
 */
async function convertFileToDirectory(node: WorkspaceFileNode | null = selectedFileNode.value): Promise<void> {
    if (!node || !canConvertFileToDirectory(node)) {
        return;
    }

    try {
        const converted = await store.convertWorkspaceFileToDirectory(node.path);
        expandedPaths.value = [...new Set([...expandedPaths.value, converted.path])];
        await store.selectWorkspacePath(converted.path);
    } catch (error) {
        notifyError(formatCreateError(error), {title: "文件转目录节点失败"});
    }
}

/**
 * 重命名或移动节点。
 */
async function renameNode(node: WorkspaceFileNode): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const currentPath = node.isDirectory ? node.path.replace(/\/$/, "") : node.path;
    const input = await prompt("请输入新路径", currentPath);
    const nextPath = typeof input === "string" ? input.trim() : "";
    if (!nextPath || nextPath === currentPath) {
        return;
    }

    const moved = await store.renameWorkspacePath(currentPath, nextPath);
    expandedPaths.value = [...new Set([...expandedPaths.value, resolveParentDirectory(moved.path)])].filter(Boolean);
    await store.selectWorkspacePath(moved.path);
}

/**
 * 删除节点，目录失败后允许用户确认递归删除。
 */
async function deleteNode(node: WorkspaceFileNode): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const label = node.title || node.path;
    if (!await confirm(`确定要删除 ${label} 吗？`)) {
        return;
    }

    try {
        await store.deleteWorkspacePath(node.path, false);
    } catch (error) {
        if (!node.isDirectory || !await confirm("目录非空。是否递归删除整个目录？")) {
            throw error;
        }
        await store.deleteWorkspacePath(node.path, true);
    }
}

/**
 * 执行拖拽移动。
 */
async function moveNode(payload: WorkspaceFileMovePayload): Promise<void> {
    const sourceNode = workspaceTree.value.find((node) => node.path === payload.sourcePath);
    if (!sourceNode) {
        return;
    }

    const targetDir = resolveDropTargetDirectory(payload);
    let nextPath = resolveMovedPath(sourceNode.path, targetDir);
    const currentExistingPathSet = new Set(existingPathSet.value);

    if (!canMovePath(sourceNode, targetDir, currentExistingPathSet)) {
        const resolvedPath = await resolveMoveConflictPath(sourceNode, targetDir, nextPath);
        if (!resolvedPath) {
            return;
        }
        nextPath = resolvedPath;
    }

    const currentSelection = selectedFilePath.value;
    try {
        await store.optimisticRenameWorkspacePath(sourceNode.path, nextPath);
        const nextSelection = resolveSelectionAfterMove(sourceNode.path, nextPath, currentSelection);
        await store.selectWorkspacePath(nextSelection);
    } catch (error) {
        notifyError(formatMoveError(error), {title: "移动文件失败"});
    }
}

/**
 * 打开节点右键菜单。
 */
function openNodeMenu(node: WorkspaceFileNode, event: MouseEvent): void {
    const baseDir = node.isDirectory ? node.path : resolveParentDirectory(node.path);
    const siblingDir = resolveParentDirectory(node.path);
    const items: ContextMenuItem[] = [
        {label: isWorkspaceContentDirectoryNode(node) ? "打开 index.md" : "打开", iconClass: "i-lucide-folder-open", action: () => void openNode(node)},
        {
            label: node.isDirectory && expandedPaths.value.includes(node.path) ? "收起" : "展开",
            iconClass: "i-lucide-chevron-down",
            disabled: !node.isDirectory,
            action: () => toggleExpanded(node.path),
        },
        {separator: true},
        {label: "新建子文件", iconClass: "i-lucide-file-plus", disabled: !node.isDirectory, action: () => void createFile(baseDir)},
        {label: "新建子目录", iconClass: "i-lucide-folder-plus", disabled: !node.isDirectory, action: () => void createDirectory(baseDir)},
        {label: "新建同级文件", iconClass: "i-lucide-file-plus-2", action: () => void createFile(siblingDir)},
        {label: "新建同级目录", iconClass: "i-lucide-folder-plus", action: () => void createDirectory(siblingDir)},
    ];

    if (node.isDirectory && isWorkspaceLorebookScopePath(baseDir)) {
        items.push({label: "新建子 Lorebook 条目", iconClass: "i-lucide-book-plus", action: () => void createLorebookEntry(baseDir)});
    }
    if (!node.isDirectory && isWorkspaceLorebookScopePath(siblingDir)) {
        items.push({label: "新建同级 Lorebook 条目", iconClass: "i-lucide-book-plus", action: () => void createLorebookEntry(siblingDir)});
    }
    if (canCreateDirectoryIndex(node)) {
        items.push({label: "转化为目录节点", iconClass: "i-lucide-file-symlink", action: () => void createDirectoryIndex(node)});
    }
    if (canConvertFileToDirectory(node)) {
        items.push({label: "文件转目录节点", iconClass: "i-lucide-folder-input", action: () => void convertFileToDirectory(node)});
    }

    items.push(
        {separator: true},
        {label: "复制引用", iconClass: "i-lucide-copy", action: () => void copyReference(node)},
        {label: "重命名", iconClass: "i-lucide-pencil", action: () => void renameNode(node)},
        {label: "删除", iconClass: "i-lucide-trash-2", danger: true, action: () => void deleteNode(node)},
    );
    openContextMenu(event, items);
}

/**
 * 打开根区域右键菜单。
 */
function openRootMenu(event: MouseEvent): void {
    openContextMenu(event, [
        {label: "新建文件", iconClass: "i-lucide-file-plus", action: () => void createFile()},
        {label: "新建目录", iconClass: "i-lucide-folder-plus", action: () => void createDirectory()},
        {label: "新建 Lorebook 条目", iconClass: "i-lucide-book-plus", action: () => void createLorebookEntry(null)},
        {separator: true},
        {label: "刷新", iconClass: "i-lucide-refresh-cw", action: () => void refreshTree()},
    ]);
}

/**
 * 切换目录展开。
 */
function toggleExpanded(path: string): void {
    const nextExpandedPaths = new Set(expandedPaths.value);
    if (nextExpandedPaths.has(path)) {
        nextExpandedPaths.delete(path);
    } else {
        nextExpandedPaths.add(path);
    }
    expandedPaths.value = [...nextExpandedPaths];
}

/**
 * 根据当前活动文件生成 Markdown 相对引用。
 */
function buildReferenceTarget(node: WorkspaceFileNode): string {
    const targetPath = resolveReferenceTargetPath(node);
    const sourceDir = selectedFilePath.value ? resolveParentDirectory(selectedFilePath.value).replace(/\/$/, "") : "";
    return relativeWorkspacePath(sourceDir, targetPath);
}

function resolveParentDirectory(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    if (!normalizedPath.includes("/")) {
        return "";
    }
    return `${normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))}/`;
}

function resolveDropTargetDirectory(payload: WorkspaceFileMovePayload): string {
    if (payload.position === "root" || !payload.targetPath) {
        return "";
    }

    const targetNode = workspaceTree.value.find((node) => node.path === payload.targetPath);
    if (payload.position === "inside" && targetNode) {
        if (targetNode.isDirectory) {
            return targetNode.path;
        }
    }
    return resolveParentDirectory(payload.targetPath);
}

async function resolveMoveConflictPath(sourceNode: WorkspaceFileNode, targetDir: string, conflictedPath: string): Promise<string | null> {
    const normalizedSourcePath = normalizeWorkspacePath(sourceNode.path);
    const normalizedTargetDir = normalizeWorkspacePath(targetDir);
    if (normalizedTargetDir === normalizedSourcePath || normalizedTargetDir.startsWith(`${normalizedSourcePath}/`)) {
        return null;
    }
    if (normalizeWorkspacePath(conflictedPath) === normalizedSourcePath) {
        return null;
    }

    const suggestedPath = suggestAvailableMovePath(sourceNode, targetDir);
    const input = await prompt(`目标位置已存在同名路径：${conflictedPath}\n请输入新的目标路径`, suggestedPath, "目标位置同名冲突");
    const nextPath = typeof input === "string" ? input.trim() : "";
    if (!nextPath || nextPath === normalizeWorkspacePath(sourceNode.path) || existingPathSet.value.has(normalizeWorkspacePath(nextPath))) {
        return null;
    }
    return nextPath;
}

function suggestAvailableMovePath(sourceNode: WorkspaceFileNode, targetDir: string): string {
    const sourceName = basename(sourceNode.path);
    const {stem, extension} = splitName(sourceName);
    let renameSuffix = 1;
    let suggestedName = `${stem}-${renameSuffix}${extension}`;
    let suggestedPath = joinWorkspacePath(targetDir, suggestedName);
    while (existingPathSet.value.has(normalizeWorkspacePath(suggestedPath))) {
        renameSuffix++;
        suggestedName = `${stem}-${renameSuffix}${extension}`;
        suggestedPath = joinWorkspacePath(targetDir, suggestedName);
    }
    return suggestedPath;
}

function resolveSelectionAfterMove(sourcePath: string, nextPath: string, selectedPath: string): string {
    const normalizedSource = sourcePath.replace(/\/$/, "");
    const normalizedNext = nextPath.replace(/\/$/, "");
    if (selectedPath === sourcePath) {
        return nextPath;
    }
    if (selectedPath.startsWith(`${normalizedSource}/`)) {
        return `${normalizedNext}${selectedPath.slice(normalizedSource.length)}`;
    }
    return nextPath;
}

function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 将 Lorebook 条目路径归一化为目录节点的 index.md。
 */
function normalizeLorebookEntryIndexPath(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    if (normalizedPath.toLowerCase().endsWith("/index.md")) {
        return normalizedPath;
    }
    if (/\.md$/i.test(normalizedPath)) {
        return `${normalizedPath.replace(/\.md$/i, "")}/index.md`;
    }
    return `${normalizedPath}/index.md`;
}

/**
 * 判断对话框返回值是否是合法 Lorebook 类型。
 */
function isLorebookEntryType(value: string): value is LorebookEntryType {
    return LOREBOOK_ENTRY_TYPES.includes(value as LorebookEntryType);
}

/**
 * 生成文件化 Lorebook 条目的初始 Markdown 内容。
 */
function buildLorebookEntryContent(filePath: string, entryType: LorebookEntryType): string {
    const title = basename(resolveParentDirectory(filePath)).replace(/\.md$/i, "") || "new-entry";
    const characterBlock = entryType === "character"
        ? `character:\n    logline: ""\n    profile: {}\n    story: {}\n    meta:\n        pinned: false\n        primaryContext: null\n`
        : "";
    const subtypeBlock = entryType === "character" ? "subtype: person\n" : "";
    return `---\ntitle: ${JSON.stringify(title)}\ntype: ${entryType}\n${subtypeBlock}status: draft\naliases: []\ntags: []\nsummary: \"\"\nrefs: []\nretrieval:\n    enabled: true\n    trigger: null\ninject:\n    profiles: []\n    always: false\ngovernance:\n    source: manual\n    review: proposed\n${characterBlock}---\n\n`;
}

function splitName(fileName: string): {stem: string; extension: string} {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) {
        return {stem: fileName, extension: ""};
    }
    return {
        stem: fileName.slice(0, dotIndex),
        extension: fileName.slice(dotIndex),
    };
}

function joinWorkspacePath(dirPath: string, fileName: string): string {
    return dirPath ? `${dirPath.replace(/\/$/, "")}/${fileName}` : fileName;
}

function canConvertFileToDirectory(node: WorkspaceFileNode): boolean {
    return !node.isDirectory && node.editable && isWorkspaceContentScopePath(node.path) && !node.path.toLowerCase().endsWith("/index.md");
}

function canCreateDirectoryIndex(node: WorkspaceFileNode): boolean {
    return node.isDirectory && !node.hasIndex && isWorkspaceContentScopePath(node.path);
}

function buildDirectoryIndexContent(node: WorkspaceFileNode): string {
    const title = node.title || basename(node.path) || "index";
    return `---\ntitle: ${JSON.stringify(title)}\nstatus: draft\n---\n\n`;
}

/**
 * 将节点转换为 refs / inline link 推荐使用的相对引用目标。
 */
function resolveReferenceTargetPath(node: WorkspaceFileNode): string {
    const normalizedPath = node.path.replace(/\/$/, "");
    if (normalizedPath.toLowerCase().endsWith("/index.md")) {
        return `${normalizedPath.slice(0, -"/index.md".length)}/`;
    }
    if (node.isDirectory) {
        return `${normalizedPath}/`;
    }
    return node.path;
}

/**
 * 计算从当前文件目录到目标路径的 Markdown 相对路径。
 */
function relativeWorkspacePath(sourceDir: string, targetPath: string): string {
    const targetIsDirectory = targetPath.endsWith("/");
    const sourceSegments = sourceDir.split("/").filter(Boolean);
    const targetSegments = targetPath.replace(/\/$/, "").split("/").filter(Boolean);
    let commonLength = 0;
    while (
        commonLength < sourceSegments.length
        && commonLength < targetSegments.length
        && sourceSegments[commonLength] === targetSegments[commonLength]
    ) {
        commonLength++;
    }

    const upSegments = Array.from({length: sourceSegments.length - commonLength}, () => "..");
    const downSegments = targetSegments.slice(commonLength);
    const relativeSegments = [...upSegments, ...downSegments];
    const relativePath = relativeSegments.length > 0 ? relativeSegments.join("/") : ".";
    const prefixedPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return targetIsDirectory && !prefixedPath.endsWith("/") ? `${prefixedPath}/` : prefixedPath;
}

function formatMoveError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return "文件系统移动失败，已恢复到移动前状态。";
}

/**
 * 格式化创建失败提示。
 */
function formatCreateError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return "文件创建失败，请检查路径是否已经存在。";
}

function loadExpandedPaths(): string[] {
    if (!import.meta.client) {
        return [];
    }

    const rawValue = localStorage.getItem(WORKSPACE_EXPANDED_PATHS_STORAGE_KEY);
    if (!rawValue) {
        return [];
    }

    try {
        const parsedValue = JSON.parse(rawValue) as unknown;
        if (!Array.isArray(parsedValue)) {
            return [];
        }
        return [...new Set(parsedValue.filter((path): path is string => typeof path === "string" && path.length > 0))];
    } catch {
        return [];
    }
}

function saveExpandedPaths(paths: string[]): void {
    if (!import.meta.client) {
        return;
    }

    localStorage.setItem(WORKSPACE_EXPANDED_PATHS_STORAGE_KEY, JSON.stringify([...new Set(paths)]));
}

onMounted(() => {
    expandedPaths.value = loadExpandedPaths();
    if (canAccessWorkspace.value && workspaceTree.value.length === 0) {
        void store.loadWorkspaceTree();
    }
});

watch(expandedPaths, (paths) => {
    saveExpandedPaths(paths);
}, {deep: true});

watch(canAccessWorkspace, (canAccess) => {
    if (canAccess && workspaceTree.value.length === 0) {
        void store.loadWorkspaceTree();
    }
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 工作区文件面板头部 -->
        <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
            <div class="relative min-w-0 flex-1">
                <span class="i-lucide-search absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
                <input v-model="searchQuery" type="text" placeholder="搜索文件、类型、摘要..." class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]">
            </div>
            <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="void refreshTree()">
                <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
            </button>
        </div>

        <!-- 工作区文件树容器 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            <div v-if="loadingWorkspaceTree && workspaceTree.length === 0" class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]">
                正在加载文件树...
            </div>
            <div v-else-if="filteredNodes.length === 0" class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]" @contextmenu.prevent.stop="openRootMenu">
                没有可显示的文件
            </div>
            <WorkspaceFileTree
                v-else
                v-model:expanded-paths="expandedPaths"
                :nodes="filteredNodes"
                :selected-path="selectedFilePath"
                :forced-expanded-paths="forcedExpandedPaths"
                @select="selectNode"
                @open="openNode"
                @move="moveNode"
                @node-contextmenu="openNodeMenu"
                @root-contextmenu="openRootMenu"
            />
        </div>

        <WorkspaceCharacterDetailPanel
            v-if="showCharacterDetail"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @refresh="void refreshTree()"
        />
        <WorkspaceLorebookDetailPanel
            v-else-if="showLorebookDetail"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @refresh="void refreshTree()"
        />
        <WorkspaceFileDetailPanel
            v-else
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @create-index="void createDirectoryIndex()"
            @convert-file-to-directory="void convertFileToDirectory()"
        />

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="contextMenuVisible = false"
        />
    </div>
</template>
