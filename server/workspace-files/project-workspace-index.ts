import path from "node:path";
import fs from "node:fs/promises";
import {watch, type FSWatcher} from "chokidar";
import {
    createWorkspaceContentIssues,
    pathExists,
    resolveWorkspaceRoot,
    scanWorkspaceTree,
    toWorkspaceDisplayPath,
    type WorkspaceFileIssue,
    type WorkspaceFileNode,
    type WorkspaceScanOptions,
} from "nbook/server/workspace-files/workspace-files";
import {readProjectManifestIssueFromRoot} from "nbook/server/workspace-files/project-workspace";
import type {
    WorkspaceFileChangeEventDto,
    WorkspaceFileEventKind,
    WorkspaceFileStreamEventDto,
} from "nbook/shared/dto/workspace-file-events.dto";
import type {
    WorkspaceIssueSummaryDto,
    WorkspaceTreeSnapshotDto,
} from "nbook/shared/dto/workspace-tree.dto";

type WorkspaceTreeIndexKind = "project-workspace" | "user-assets";

type WorkspaceTreeIndexOptions = WorkspaceScanOptions & {
    workspaceKind?: "user-assets";
};

type WorkspaceTreeIndexSubscriber = (event: WorkspaceFileStreamEventDto) => void | Promise<void>;

type ProjectWorkspaceIndex = {
    root: string;
    workspaceKind: WorkspaceTreeIndexKind;
    nodes: WorkspaceFileNode[];
    issues: WorkspaceFileIssue[];
    revision: number;
    validatedAt: string;
};

type ProjectWorkspaceIndexEntry = {
    root: string;
    rootInput: string;
    workspaceKind: WorkspaceTreeIndexKind;
    scanOptions: WorkspaceScanOptions;
    index: ProjectWorkspaceIndex | null;
    buildPromise: Promise<ProjectWorkspaceIndex> | null;
    watcher: FSWatcher | null;
    ready: Promise<void> | null;
    subscribers: Set<WorkspaceTreeIndexSubscriber>;
    pendingEvents: Map<string, WorkspaceFileChangeEventDto>;
    sequence: number;
    dirty: boolean;
    rebuildTimer: ReturnType<typeof setTimeout> | null;
    eventGeneration: number;
    revision: number;
    lastWatchError: string | null;
};

const WORKSPACE_INDEX_REBUILD_DEBOUNCE_MS = 120;
const indexEntries = new Map<string, ProjectWorkspaceIndexEntry>();
let beforeProjectWorkspaceIndexCommitForTest: (() => void | Promise<void>) | null = null;

const emptySummary = (): WorkspaceIssueSummaryDto => ({
    selfCount: 0,
    subtreeCount: 0,
    count: 0,
    highestLevel: null,
});

/**
 * 读取 Project Workspace 的 tree snapshot。首次读取会启动 root watcher，并让 index 常驻内存。
 */
export async function readProjectWorkspaceTreeSnapshot(options: WorkspaceScanOptions = {}): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    return readWorkspaceTreeSnapshot(options);
}

/**
 * 读取 user-assets 的 tree snapshot。user-assets 使用同一套 index watcher，但不运行 Project Workspace 校验规则。
 */
export async function readPlainWorkspaceTreeSnapshot(options: WorkspaceScanOptions = {}): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    return readWorkspaceTreeSnapshot({
        ...options,
        workspaceKind: "user-assets",
    });
}

/**
 * 读取统一的 workspace tree index snapshot。dirty 或 watcher error 会在读取时重建。
 */
export async function readWorkspaceTreeSnapshot(options: WorkspaceTreeIndexOptions = {}): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    const entry = await ensureIndexEntry(options);
    if (entry.index && !entry.dirty && !entry.lastWatchError) {
        return projectIndexToSnapshot(entry.index);
    }
    const index = await rebuildWorkspaceTreeIndex(entry);
    return projectIndexToSnapshot(index);
}

/**
 * 订阅统一 workspace tree index 的文件变化。取消订阅只移除 SSE subscriber，不关闭 root watcher。
 */
export async function subscribeWorkspaceTreeIndex(
    options: WorkspaceTreeIndexOptions,
    handler: WorkspaceTreeIndexSubscriber,
): Promise<() => void> {
    const entry = await ensureIndexEntry(options);
    entry.subscribers.add(handler);
    notifyWorkspaceTreeIndexReady(entry, handler);

    return () => {
        entry.subscribers.delete(handler);
    };
}

/**
 * 同进程 mutation 成功后标记 index 为 dirty，并交给同一套 debounce rebuild 更新缓存。
 */
export function invalidateProjectWorkspaceIndexAfterMutation(input: {root: string | undefined; workspaceKind?: "user-assets"}): void {
    const entry = indexEntries.get(resolveWorkspaceRoot(input.root));
    if (!entry) {
        return;
    }
    markWorkspaceTreeIndexDirty(entry);
}

/**
 * 测试专用：在 index 扫描完成、提交缓存前暂停，便于覆盖并发 mutation race。
 */
export function setProjectWorkspaceIndexCommitHookForTest(hook: (() => void | Promise<void>) | null): void {
    beforeProjectWorkspaceIndexCommitForTest = hook;
}

/**
 * 关闭指定 root 的 watcher 并移除内存 index。用于测试、root 删除和显式生命周期清理。
 */
export async function closeWorkspaceTreeIndex(rootInput: string | undefined): Promise<void> {
    const root = resolveWorkspaceRoot(rootInput);
    const entry = indexEntries.get(root);
    if (!entry) {
        return;
    }
    indexEntries.delete(root);
    if (entry.rebuildTimer) {
        clearTimeout(entry.rebuildTimer);
        entry.rebuildTimer = null;
    }
    if (entry.watcher) {
        await entry.watcher.close();
        entry.watcher = null;
    }
}

/**
 * 判断当前 tree query 是否请求完整 Project Workspace snapshot。
 */
export function assertFullTreeSnapshotQuery(input: {targets: string[]; type: string | null; depth: number | null}): void {
    if (input.targets.length > 0 || input.type || input.depth !== null) {
        throw createError({
            statusCode: 400,
            message: "tree snapshot 暂不支持 target/type/depth 过滤查询，请请求完整 Project Workspace tree",
        });
    }
}

async function ensureIndexEntry(options: WorkspaceTreeIndexOptions): Promise<ProjectWorkspaceIndexEntry> {
    const root = resolveWorkspaceRoot(options.root);
    const existing = indexEntries.get(root);
    if (existing) {
        existing.rootInput = normalizeRootInput(options.root);
        existing.scanOptions = normalizeScanOptions(options, root);
        existing.workspaceKind = resolveWorkspaceTreeIndexKind(options);
        await ensureWorkspaceTreeIndexWatcher(existing);
        return existing;
    }

    const entry: ProjectWorkspaceIndexEntry = {
        root,
        rootInput: normalizeRootInput(options.root),
        workspaceKind: resolveWorkspaceTreeIndexKind(options),
        scanOptions: normalizeScanOptions(options, root),
        index: null,
        buildPromise: null,
        watcher: null,
        ready: null,
        subscribers: new Set(),
        pendingEvents: new Map(),
        sequence: 0,
        dirty: true,
        rebuildTimer: null,
        eventGeneration: 0,
        revision: 0,
        lastWatchError: null,
    };
    indexEntries.set(root, entry);
    await ensureWorkspaceTreeIndexWatcher(entry);
    return entry;
}

async function rebuildWorkspaceTreeIndex(entry: ProjectWorkspaceIndexEntry): Promise<ProjectWorkspaceIndex> {
    if (entry.buildPromise) {
        return entry.buildPromise;
    }

    entry.buildPromise = (async () => {
        const buildGeneration = entry.eventGeneration;
        const nodes = await scanWorkspaceTree({
            ...entry.scanOptions,
            root: entry.root,
        });
        const issues = entry.workspaceKind === "user-assets"
            ? []
            : await createProjectWorkspaceIssues(entry, nodes);
        const summaryByPath = entry.workspaceKind === "user-assets"
            ? new Map<string, WorkspaceIssueSummaryDto>()
            : buildIssueSummaryByPath(issues, nodes);
        await beforeProjectWorkspaceIndexCommitForTest?.();
        const nextIndex: ProjectWorkspaceIndex = {
            root: entry.root,
            workspaceKind: entry.workspaceKind,
            nodes: nodes.map((node) => ({
                ...node,
                issueSummary: summaryByPath.get(normalizeIssuePath(node.path)) ?? emptySummary(),
            })),
            issues,
            revision: entry.revision + 1,
            validatedAt: new Date().toISOString(),
        };
        entry.index = nextIndex;
        entry.revision = nextIndex.revision;
        entry.lastWatchError = null;
        if (entry.eventGeneration === buildGeneration) {
            entry.dirty = false;
        }
        return nextIndex;
    })();

    try {
        return await entry.buildPromise;
    } finally {
        entry.buildPromise = null;
        if (!await pathExists(entry.root)) {
            await closeWorkspaceTreeIndex(entry.root);
        }
    }
}

async function createProjectWorkspaceIssues(entry: ProjectWorkspaceIndexEntry, nodes: WorkspaceFileNode[]): Promise<WorkspaceFileIssue[]> {
    const existingPathSet = new Set(nodes.flatMap((node) => normalizedExistingPaths(node)));
    const issues = createWorkspaceContentIssues({
        root: entry.root,
        nodes,
        lorebookRoot: entry.scanOptions.lorebookRoot,
        chapterRoot: entry.scanOptions.chapterRoot,
        existingPathSet,
    });
    const manifestIssue = await createProjectManifestIssue(entry.root);
    if (manifestIssue) {
        issues.unshift(manifestIssue);
    }
    return issues;
}

async function createProjectManifestIssue(root: string): Promise<WorkspaceFileIssue | null> {
    const message = await readProjectManifestIssueFromRoot(root);
    if (!message) {
        return null;
    }
    return {
        level: "P1",
        code: "invalid-project-manifest",
        path: "project.yaml",
        message,
    };
}

/**
 * 确保 root watcher 已启动。读取 tree 即启动 watcher，但 root 不存在时只保留 read-time rebuild 能力。
 */
async function ensureWorkspaceTreeIndexWatcher(entry: ProjectWorkspaceIndexEntry): Promise<void> {
    if (entry.watcher || !await pathExists(entry.root)) {
        return;
    }
    const stat = await fs.stat(entry.root);
    if (!stat.isDirectory()) {
        throw new Error(`workspace root 不是目录: ${entry.rootInput}`);
    }

    let resolveReady: () => void = () => {};
    entry.ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    entry.watcher = watch(entry.root, {
        awaitWriteFinish: {
            stabilityThreshold: WORKSPACE_INDEX_REBUILD_DEBOUNCE_MS,
            pollInterval: 50,
        },
        cwd: entry.root,
        ignoreInitial: true,
        ignored: isIgnoredWorkspaceWatchPath,
        persistent: true,
    });
    entry.watcher.on("all", (eventName, changedPath) => {
        recordWorkspaceTreeIndexEvent(entry, eventName, String(changedPath));
    });
    entry.watcher.on("ready", () => {
        resolveReady();
    });
    entry.watcher.on("error", (error) => {
        entry.lastWatchError = error instanceof Error ? error.message : String(error);
        entry.dirty = true;
        resolveReady();
        console.error("[workspace-tree-index] watcher failed", {
            root: entry.rootInput,
        }, error);
    });
}

/**
 * 异步发送 watcher ready 事件，避免 SSE 连接被大型工作区的初始 watch 扫描阻塞。
 */
function notifyWorkspaceTreeIndexReady(entry: ProjectWorkspaceIndexEntry, handler: WorkspaceTreeIndexSubscriber): void {
    void (async () => {
        await entry.ready;
        if (!entry.subscribers.has(handler)) {
            return;
        }
        await handler({
            type: "workspace_watch_ready",
            root: entry.rootInput,
            sequence: entry.sequence,
            changedAt: new Date().toISOString(),
        });
    })();
}

/**
 * 记录 watcher 文件事件，并安排一次 debounce 全量重建。
 */
function recordWorkspaceTreeIndexEvent(entry: ProjectWorkspaceIndexEntry, eventName: string, changedPath: string): void {
    const kind = normalizeWorkspaceEventKind(eventName);
    if (!kind) {
        return;
    }

    const eventPath = normalizeWorkspaceEventPath(entry.root, changedPath);
    if (!eventPath || isIgnoredWorkspaceWatchPath(eventPath)) {
        return;
    }

    entry.pendingEvents.set(eventPath, {
        kind,
        path: eventPath,
    });
    markWorkspaceTreeIndexDirty(entry);
}

/**
 * 标记 index 已过期。所有 watcher 事件和同进程 mutation 都必须推进 generation。
 */
function markWorkspaceTreeIndexDirty(entry: ProjectWorkspaceIndexEntry): void {
    entry.eventGeneration += 1;
    entry.dirty = true;
    scheduleWorkspaceTreeIndexRebuild(entry);
}

/**
 * 安排一次全量重建。第一版优先保证正确性，不做增量 patch。
 */
function scheduleWorkspaceTreeIndexRebuild(entry: ProjectWorkspaceIndexEntry): void {
    if (entry.rebuildTimer) {
        clearTimeout(entry.rebuildTimer);
    }
    entry.rebuildTimer = setTimeout(() => {
        void flushWorkspaceTreeIndexChanges(entry);
    }, WORKSPACE_INDEX_REBUILD_DEBOUNCE_MS);
}

/**
 * 全量重建 index，并向 SSE subscriber 推送合并后的变更批次。
 */
async function flushWorkspaceTreeIndexChanges(entry: ProjectWorkspaceIndexEntry): Promise<void> {
    entry.rebuildTimer = null;
    const events = [...entry.pendingEvents.values()];
    entry.pendingEvents.clear();

    try {
        if (entry.buildPromise) {
            await entry.buildPromise;
        }
        const index = entry.dirty || !entry.index
            ? await rebuildWorkspaceTreeIndex(entry)
            : entry.index;
        if (events.length === 0) {
            return;
        }
        entry.sequence += 1;
        const payload: WorkspaceFileStreamEventDto = {
            type: "workspace_files_changed",
            root: entry.rootInput,
            sequence: entry.sequence,
            revision: index.revision,
            validatedAt: index.validatedAt,
            changedAt: new Date().toISOString(),
            events,
        };
        for (const subscriber of entry.subscribers) {
            void subscriber(payload);
        }
    } catch (error) {
        entry.lastWatchError = error instanceof Error ? error.message : String(error);
        entry.dirty = true;
        console.error("[workspace-tree-index] rebuild failed", {
            root: entry.rootInput,
        }, error);
    }
}

function resolveWorkspaceTreeIndexKind(options: WorkspaceTreeIndexOptions): WorkspaceTreeIndexKind {
    return options.workspaceKind === "user-assets" ? "user-assets" : "project-workspace";
}

function normalizeScanOptions(options: WorkspaceTreeIndexOptions, root: string): WorkspaceScanOptions {
    return {
        ...options,
        root,
    };
}

function normalizeWorkspaceEventKind(eventName: string): WorkspaceFileEventKind | null {
    if (
        eventName === "add"
        || eventName === "change"
        || eventName === "unlink"
        || eventName === "addDir"
        || eventName === "unlinkDir"
    ) {
        return eventName;
    }
    return null;
}

function normalizeWorkspaceEventPath(root: string, changedPath: string): string {
    const absolutePath = path.isAbsolute(changedPath)
        ? changedPath
        : path.resolve(root, changedPath);
    return toWorkspaceDisplayPath(root, absolutePath).replace(/\\/g, "/").replace(/\/+$/u, "");
}

function isIgnoredWorkspaceWatchPath(value: string): boolean {
    return value.replace(/\\/g, "/").split("/").includes(".git");
}

function normalizeRootInput(rootInput: string | undefined): string {
    return (rootInput?.trim() || "workspace").replace(/\\/g, "/").replace(/\/+$/u, "");
}

function projectIndexToSnapshot(index: ProjectWorkspaceIndex): WorkspaceTreeSnapshotDto<WorkspaceFileNode> {
    return {
        nodes: index.nodes,
        issues: index.issues,
        revision: index.revision,
        validatedAt: index.validatedAt,
    };
}

function normalizedExistingPaths(node: WorkspaceFileNode): string[] {
    const normalized = normalizeIssuePath(node.path);
    return node.isDirectory && normalized.endsWith("/")
        ? [normalized, normalized.slice(0, -1)]
        : [normalized];
}

function buildIssueSummaryByPath(issues: WorkspaceFileIssue[], nodes: WorkspaceFileNode[]): Map<string, WorkspaceIssueSummaryDto> {
    const summaryByPath = new Map<string, WorkspaceIssueSummaryDto>();
    const nodePaths = new Set(nodes.map((node) => normalizeIssuePath(node.path)));

    for (const nodePath of nodePaths) {
        summaryByPath.set(nodePath, emptySummary());
    }

    for (const issue of issues) {
        const issuePath = normalizeIssuePath(issue.path);
        const selfPath = resolveIssueOwnerPath(issuePath, nodePaths);
        if (!selfPath) {
            continue;
        }
        incrementSummary(summaryByPath, selfPath, issue.level, "self");
        for (const ancestor of issueAncestorPaths(selfPath, nodePaths)) {
            incrementSummary(summaryByPath, ancestor, issue.level, "subtree");
        }
    }

    return summaryByPath;
}

function incrementSummary(
    summaryByPath: Map<string, WorkspaceIssueSummaryDto>,
    path: string,
    level: WorkspaceFileIssue["level"],
    scope: "self" | "subtree",
): void {
    const current = summaryByPath.get(path) ?? emptySummary();
    const next = {
        ...current,
        selfCount: current.selfCount + (scope === "self" ? 1 : 0),
        subtreeCount: current.subtreeCount + (scope === "subtree" ? 1 : 0),
        count: current.count + 1,
        highestLevel: higherIssueLevel(current.highestLevel, level),
    };
    summaryByPath.set(path, next);
}

function resolveIssueOwnerPath(issuePath: string, nodePaths: Set<string>): string | null {
    if (nodePaths.has(issuePath)) {
        return issuePath;
    }
    const withoutIndex = issuePath.replace(/\/index\.md$/u, "/");
    if (nodePaths.has(withoutIndex)) {
        return withoutIndex;
    }
    const stateOwner = issuePath.replace(/\/state\.md$/u, "/");
    if (nodePaths.has(stateOwner)) {
        return stateOwner;
    }
    const segments = issuePath.split("/").filter(Boolean);
    while (segments.length > 0) {
        const candidate = `${segments.join("/")}/`;
        if (nodePaths.has(candidate)) {
            return candidate;
        }
        segments.pop();
    }
    return nodePaths.has("./") ? "./" : null;
}

function issueAncestorPaths(path: string, nodePaths: Set<string>): string[] {
    const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
    const segments = normalized.split("/").filter(Boolean);
    const ancestors: string[] = [];
    while (segments.length > 1) {
        segments.pop();
        const candidate = `${segments.join("/")}/`;
        if (nodePaths.has(candidate)) {
            ancestors.push(candidate);
        }
    }
    if (nodePaths.has("./")) {
        ancestors.push("./");
    }
    return ancestors;
}

function higherIssueLevel(left: WorkspaceFileIssue["level"] | null, right: WorkspaceFileIssue["level"]): WorkspaceFileIssue["level"] {
    if (!left) {
        return right;
    }
    const rank: Record<WorkspaceFileIssue["level"], number> = {
        P1: 4,
        P2: 3,
        P3: 2,
        WARN: 1,
    };
    return rank[right] > rank[left] ? right : left;
}

function normalizeIssuePath(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized || ".";
}
