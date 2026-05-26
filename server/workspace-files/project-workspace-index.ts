import {
    createWorkspaceContentIssues,
    pathExists,
    resolveWorkspaceRoot,
    scanWorkspaceTree,
    type WorkspaceFileIssue,
    type WorkspaceFileNode,
    type WorkspaceScanOptions,
} from "nbook/server/workspace-files/workspace-files";
import type {
    WorkspaceIssueSummaryDto,
    WorkspaceTreeSnapshotDto,
} from "nbook/shared/dto/workspace-tree.dto";

type ProjectWorkspaceIndex = {
    root: string;
    nodes: WorkspaceFileNode[];
    issues: WorkspaceFileIssue[];
    revision: number;
    validatedAt: string;
};

type ProjectWorkspaceIndexEntry = {
    root: string;
    index: ProjectWorkspaceIndex | null;
    buildPromise: Promise<ProjectWorkspaceIndex> | null;
    revision: number;
};

const indexEntries = new Map<string, ProjectWorkspaceIndexEntry>();

const emptySummary = (): WorkspaceIssueSummaryDto => ({
    selfCount: 0,
    subtreeCount: 0,
    count: 0,
    highestLevel: null,
});

/**
 * 读取 Project Workspace 的 tree snapshot。并发 build 会复用同一个 Promise。
 */
export async function readProjectWorkspaceTreeSnapshot(options: WorkspaceScanOptions = {}): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    const root = resolveWorkspaceRoot(options.root);
    const entry = ensureIndexEntry(root);
    if (entry.index) {
        return projectIndexToSnapshot(entry.index);
    }
    const index = await rebuildProjectWorkspaceIndex(options);
    return projectIndexToSnapshot(index);
}

/**
 * 读取 user-assets 的 tree snapshot。user-assets 不运行 Project Workspace 校验规则。
 */
export async function readPlainWorkspaceTreeSnapshot(options: WorkspaceScanOptions = {}): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    const nodes = await scanWorkspaceTree(options);
    return {
        nodes,
        issues: [],
        revision: 0,
        validatedAt: new Date().toISOString(),
    };
}

/**
 * 文件事件触发后刷新 Project Workspace Index。第一版保守重建完整索引。
 */
export async function refreshProjectWorkspaceIndex(options: WorkspaceScanOptions = {}): Promise<WorkspaceTreeSnapshotDto<WorkspaceFileNode>> {
    const index = await rebuildProjectWorkspaceIndex(options);
    return projectIndexToSnapshot(index);
}

/**
 * 清空指定 Project Workspace 的内存索引。
 */
export function invalidateProjectWorkspaceIndex(rootInput: string | undefined): void {
    const entry = indexEntries.get(resolveWorkspaceRoot(rootInput));
    if (!entry) {
        return;
    }
    entry.index = null;
}

/**
 * Project Workspace 文件写入成功后清空索引。user-assets 不维护 Project Workspace Issue Index。
 */
export function invalidateProjectWorkspaceIndexAfterMutation(input: {root: string | undefined; workspaceKind?: "user-assets"}): void {
    if (input.workspaceKind === "user-assets") {
        return;
    }
    invalidateProjectWorkspaceIndex(input.root);
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

function ensureIndexEntry(root: string): ProjectWorkspaceIndexEntry {
    const existing = indexEntries.get(root);
    if (existing) {
        return existing;
    }
    const entry: ProjectWorkspaceIndexEntry = {
        root,
        index: null,
        buildPromise: null,
        revision: 0,
    };
    indexEntries.set(root, entry);
    return entry;
}

async function rebuildProjectWorkspaceIndex(options: WorkspaceScanOptions): Promise<ProjectWorkspaceIndex> {
    const root = resolveWorkspaceRoot(options.root);
    const entry = ensureIndexEntry(root);
    if (entry.buildPromise) {
        return entry.buildPromise;
    }

    entry.buildPromise = (async () => {
        const nodes = await scanWorkspaceTree({
            ...options,
            root,
        });
        const existingPathSet = new Set(nodes.flatMap((node) => normalizedExistingPaths(node)));
        const issues = createWorkspaceContentIssues({
            root,
            nodes,
            lorebookRoot: options.lorebookRoot,
            chapterRoot: options.chapterRoot,
            existingPathSet,
        });
        const summaryByPath = buildIssueSummaryByPath(issues, nodes);
        const nextIndex: ProjectWorkspaceIndex = {
            root,
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
        return nextIndex;
    })();

    try {
        return await entry.buildPromise;
    } finally {
        entry.buildPromise = null;
        if (!await pathExists(root)) {
            indexEntries.delete(root);
        }
    }
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
