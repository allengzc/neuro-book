<script setup lang="ts">
import {storeToRefs} from "pinia";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {isWorkspaceLorebookEntry} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const store = useNovelIdeStore();
const {confirm, prompt} = useDialog();
const {error: notifyError} = useNotification();
const {
    loadingWorkspaceTree,
    selectedFileNode,
    selectedFilePath,
    workspaceIssues,
    workspaceTree,
} = storeToRefs(store);

const searchQuery = ref("");
const detailHeight = ref(320);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);

const characterNodes = computed(() => {
    return workspaceTree.value
        .filter((node) => isWorkspaceLorebookEntry(node) && node.entryType === "character")
        .sort((left, right) => displayTitle(left).localeCompare(displayTitle(right), "zh-Hans-CN"));
});
const filteredNodes = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
        return characterNodes.value;
    }
    return characterNodes.value.filter((node) => {
        const aliases = readStringArray(node.frontmatter.aliases).join(" ");
        const tags = readStringArray(node.frontmatter.tags).join(" ");
        return [
            node.path,
            node.title,
            node.summary,
            node.status ?? "",
            aliases,
            tags,
        ].some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    });
});
const selectedIsCharacter = computed(() => isWorkspaceLorebookEntry(selectedFileNode.value) && selectedFileNode.value?.entryType === "character");

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
 * 刷新工作区树。
 */
async function refreshTree(): Promise<void> {
    await store.loadWorkspaceTree();
}

/**
 * 打开角色节点对应的 index.md。
 */
async function selectCharacter(node: WorkspaceFileNode): Promise<void> {
    await store.selectWorkspacePath(node.path);
}

/**
 * 新建文件化角色条目。
 */
async function createCharacter(): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const input = await prompt("请输入角色路径", "lorebook/character/new-character", "新建角色");
    const rawPath = typeof input === "string" ? input.trim() : "";
    if (!rawPath) {
        return;
    }

    const indexPath = normalizeCharacterIndexPath(rawPath);
    if (!indexPath.startsWith("lorebook/")) {
        notifyError("角色必须创建在 lorebook/ 目录下。", {title: "创建角色失败"});
        return;
    }

    try {
        const node = await store.createWorkspaceFile(indexPath, buildCharacterContent(indexPath));
        await store.selectWorkspacePath(node.path);
    } catch (error) {
        notifyError(formatError(error), {title: "创建角色失败"});
    }
}

/**
 * 重命名角色目录或 index.md。
 */
async function renameCharacter(node: WorkspaceFileNode): Promise<void> {
    const currentPath = node.path.endsWith("/index.md") ? node.path.slice(0, -"/index.md".length) : node.path;
    const input = await prompt("请输入新路径", currentPath, "重命名角色");
    const rawPath = typeof input === "string" ? input.trim() : "";
    if (!rawPath || rawPath === currentPath) {
        return;
    }

    try {
        const moved = await store.renameWorkspacePath(currentPath, rawPath);
        await store.selectWorkspacePath(moved.path);
    } catch (error) {
        notifyError(formatError(error), {title: "重命名角色失败"});
    }
}

/**
 * 删除角色目录。
 */
async function deleteCharacter(node: WorkspaceFileNode): Promise<void> {
    const targetPath = node.path.endsWith("/index.md") ? node.path.slice(0, -"/index.md".length) : node.path;
    if (!await confirm(`确定要删除角色 ${displayTitle(node)} 吗？`)) {
        return;
    }

    try {
        await store.deleteWorkspacePath(targetPath, true);
    } catch (error) {
        notifyError(formatError(error), {title: "删除角色失败"});
    }
}

/**
 * 复制角色的 Markdown 相对引用。
 */
async function copyReference(node: WorkspaceFileNode): Promise<void> {
    if (!import.meta.client) {
        return;
    }
    await navigator.clipboard.writeText(buildReferenceTarget(node));
}

/**
 * 打开节点右键菜单。
 */
function openNodeMenu(node: WorkspaceFileNode, event: MouseEvent): void {
    openContextMenu(event, [
        {label: "打开", iconClass: "i-lucide-folder-open", action: () => void selectCharacter(node)},
        {label: "复制引用", iconClass: "i-lucide-copy", action: () => void copyReference(node)},
        {separator: true},
        {label: "新建角色", iconClass: "i-lucide-user-plus", action: () => void createCharacter()},
        {label: "重命名", iconClass: "i-lucide-pencil", action: () => void renameCharacter(node)},
        {label: "删除", iconClass: "i-lucide-trash-2", danger: true, action: () => void deleteCharacter(node)},
    ]);
}

/**
 * 打开根菜单。
 */
function openRootMenu(event: MouseEvent): void {
    openContextMenu(event, [
        {label: "新建角色", iconClass: "i-lucide-user-plus", action: () => void createCharacter()},
        {separator: true},
        {label: "刷新", iconClass: "i-lucide-refresh-cw", action: () => void refreshTree()},
    ]);
}

function normalizeCharacterIndexPath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^workspace\//, "").replace(/\/$/, "");
    if (normalizedPath.toLowerCase().endsWith("/index.md")) {
        return normalizedPath;
    }
    if (/\.md$/i.test(normalizedPath)) {
        return `${normalizedPath.replace(/\.md$/i, "")}/index.md`;
    }
    return `${normalizedPath}/index.md`;
}

function buildCharacterContent(filePath: string): string {
    const title = basename(filePath.replace(/\/index\.md$/i, "")) || "new-character";
    return `---\ntitle: ${JSON.stringify(title)}\ntype: character\nsubtype: person\nstatus: draft\naliases: []\ntags: []\nsummary: ""\nrefs: []\nretrieval:\n    enabled: true\n    trigger: null\ninject:\n    profiles: []\n    always: false\ngovernance:\n    source: manual\n    review: proposed\ncharacter:\n    logline: ""\n    profile: {}\n    story: {}\n    meta:\n        pinned: false\n        primaryContext: null\n---\n\n`;
}

function buildReferenceTarget(node: WorkspaceFileNode): string {
    const targetPath = `${node.path.replace(/\/index\.md$/i, "").replace(/\/$/, "")}/`;
    const sourceDir = selectedFilePath.value ? resolveParentDirectory(selectedFilePath.value).replace(/\/$/, "") : "";
    return relativeWorkspacePath(sourceDir, targetPath);
}

/**
 * 返回当前文件路径的父目录。
 */
function resolveParentDirectory(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    if (!normalizedPath.includes("/")) {
        return "";
    }
    return `${normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))}/`;
}

/**
 * 计算从当前文件目录到角色节点的 Markdown 相对路径。
 */
function relativeWorkspacePath(sourceDir: string, targetPath: string): string {
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
    return prefixedPath.endsWith("/") ? prefixedPath : `${prefixedPath}/`;
}

function displayTitle(node: WorkspaceFileNode): string {
    return node.title || basename(node.path.replace(/\/index\.md$/i, "")) || node.path;
}

function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return "文件操作失败。";
}

onMounted(() => {
    if (workspaceTree.value.length === 0) {
        void store.loadWorkspaceTree();
    }
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 角色面板头部 -->
        <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
            <div class="relative min-w-0 flex-1">
                <span class="i-lucide-search absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
                <input v-model="searchQuery" type="text" placeholder="搜索角色、别名、标签..." class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]">
            </div>
            <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" title="新建角色" @click="void createCharacter()">
                <span class="i-lucide-user-plus h-3.5 w-3.5"></span>
            </button>
            <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" title="刷新" @click="void refreshTree()">
                <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
            </button>
        </div>

        <!-- 角色列表 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar" @contextmenu.prevent.stop="openRootMenu">
            <div v-if="loadingWorkspaceTree && workspaceTree.length === 0" class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]">
                正在加载角色...
            </div>
            <div v-else-if="filteredNodes.length === 0" class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] px-4 text-center text-xs leading-5 text-[var(--text-muted)]">
                未找到角色。右键或点击上方按钮创建角色。
            </div>
            <button
                v-for="node in filteredNodes"
                v-else
                :key="node.path"
                type="button"
                class="group mb-1 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors"
                :class="selectedFilePath === node.path ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900' : 'border-transparent text-[var(--text-main)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                @click="void selectCharacter(node)"
                @contextmenu.prevent.stop="openNodeMenu(node, $event)"
            >
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-700">
                    <span class="i-lucide-user-round h-4 w-4"></span>
                </span>
                <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-2">
                        <span class="truncate text-sm font-semibold">{{ displayTitle(node) }}</span>
                        <span v-if="node.status" class="shrink-0 rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">{{ node.status }}</span>
                    </span>
                    <span class="mt-0.5 block truncate text-[10px] font-mono text-[var(--text-muted)]">{{ node.path.replace(/\/index\.md$/i, "") }}</span>
                    <span v-if="node.summary" class="mt-1 line-clamp-2 block text-[11px] leading-4 text-[var(--text-secondary)]">{{ node.summary }}</span>
                </span>
            </button>
        </div>

        <WorkspaceCharacterDetailPanel
            v-if="selectedIsCharacter"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @refresh="void refreshTree()"
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
