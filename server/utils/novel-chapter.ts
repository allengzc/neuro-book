import {existsSync} from "node:fs";
import {createClient} from "@libsql/client";
import {consola} from "consola";
import type {H3Event} from "h3";
import type {
    NovelListItemDto,
    UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import type {AgentSessionListQueryDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {ServerTimingSink} from "nbook/server/utils/server-timing";
import {isError} from "h3";
import {YAMLParseError} from "yaml";
import {z} from "zod";
import {
    readProjectWorkspaceTreeSnapshot,
} from "nbook/server/workspace-files/project-workspace-index";
import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";
import {
    assertProjectWorkspaceDirectory,
    listProjectWorkspaces,
    readProjectManifest,
    resolveProjectAbsolutePath,
    resolveProjectDatabasePath,
    toSqliteFileUrl,
    writeProjectManifest,
    type ProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

type NovelStatisticCounts = Pick<
    NovelListItemDto,
    "volumeCount" | "chapterCount" | "totalWords" | "lorebookCount" | "sessionCount" | "threadCount" | "sceneCount" | "plotCount"
>;

type SessionListProvider = {
    listSessions(input?: AgentSessionListQueryDto): Promise<AgentSessionSummaryDto[]>;
};

type NovelListOptions = {
    sessionProvider?: SessionListProvider;
    limit?: number;
    includeProjectPaths?: string[];
    excludeProjectPathPrefixes?: string[];
    timingSink?: ServerTimingSink;
    diagnostics?: NovelListDiagnostics;
};

export type NovelListCacheStatus = "hit" | "miss" | "pending" | "bypass";

export type NovelListDiagnostics = {
    cacheMode?: "default" | "filtered" | "custom";
    fullListCache?: NovelListCacheStatus;
    projectListCache?: NovelListCacheStatus;
    sessionCountCache?: NovelListCacheStatus;
    projectCount?: number;
    visibleCount?: number;
    statsCacheHits?: number;
    statsCacheMisses?: number;
    statsCachePending?: number;
};

const EMPTY_NOVEL_STATISTICS: NovelStatisticCounts = {
    volumeCount: 0,
    chapterCount: 0,
    totalWords: 0,
    lorebookCount: 0,
    sessionCount: 0,
    threadCount: 0,
    sceneCount: 0,
    plotCount: 0,
};

const EMPTY_PROJECT_STATISTICS: ProjectStatisticsWithoutSessions = {
    volumeCount: 0,
    chapterCount: 0,
    totalWords: 0,
    lorebookCount: 0,
    threadCount: 0,
    sceneCount: 0,
    plotCount: 0,
};

const NOVEL_LIST_CACHE_TTL_MS = 5_000;
let defaultNovelListCache: {expiresAt: number; value: NovelListItemDto[]} | null = null;
let defaultNovelListPromise: Promise<NovelListItemDto[]> | null = null;
let defaultNovelListCacheVersion = 0;
let defaultProjectListCache: {expiresAt: number; value: Awaited<ReturnType<typeof listProjectWorkspaces>>} | null = null;
let defaultProjectListPromise: Promise<Awaited<ReturnType<typeof listProjectWorkspaces>>> | null = null;
let defaultSessionCountCache: {expiresAt: number; value: Map<string, number>} | null = null;
let defaultSessionCountPromise: Promise<Map<string, number>> | null = null;
const projectStatisticsCache = new Map<string, {expiresAt: number; value: ProjectStatisticsWithoutSessions}>();
const projectStatisticsPromises = new Map<string, Promise<ProjectStatisticsWithoutSessions>>();

type ProjectStatisticsWithoutSessions =
    Pick<NovelStatisticCounts, "volumeCount" | "chapterCount" | "totalWords" | "lorebookCount" | "threadCount" | "sceneCount" | "plotCount">;

type NovelListReadContext = {
    useRuntimeCaches: boolean;
    timingSink?: ServerTimingSink;
    diagnostics?: NovelListDiagnostics;
};

type EntityIdLabel =
    | "storyId"
    | "phaseId"
    | "threadId"
    | "sceneId"
    | "plotId"
    | "entryId"
    | "parentId";

/**
 * 将数据库整数 ID 转成对外字符串。
 */
export function stringifyEntityId(id: number): string {
    return String(id);
}

/**
 * 将外部传入的 ID 解析为数据库整数。
 */
export function parseEntityId(label: EntityIdLabel, value: string): number {
    const normalized = value.trim();
    if (!normalized) {
        throwBadRequest(`${label} 不能为空`);
    }

    if (!/^\d+$/.test(normalized)) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    const parsedId = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    return parsedId;
}

/**
 * 将可空 ID 解析为数据库整数。
 * 空值表示客户端未提供该字段。
 */
export function parseNullableEntityId(label: EntityIdLabel, value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    return parseEntityId(label, value);
}

/**
 * 抛出 400。
 */
const throwBadRequest = (message: string): never => {
    throw createError({
        statusCode: 400,
        message,
    });
};

/**
 * 将 Project manifest 映射为兼容现有前端的小说列表项。
 */
export function toNovelResponse(project: {
    projectPath: string;
    title: string;
    summary: string;
    updatedAt: string;
    manifestError?: string;
    statistics?: Partial<NovelStatisticCounts>;
}): NovelListItemDto {
    const workspaceSlug = project.projectPath.split("/").at(-1) ?? project.projectPath;
    const statistics = {
        ...EMPTY_NOVEL_STATISTICS,
        ...project.statistics,
    };
    return {
        id: project.projectPath,
        title: project.title,
        summary: project.summary,
        workspaceSlug,
        projectPath: project.projectPath,
        manifestError: project.manifestError,
        createdAt: project.updatedAt,
        updatedAt: project.updatedAt,
        ...statistics,
    };
}

/**
 * 获取 Project Workspace 列表。
 */
export async function listNovels(options: NovelListOptions = {}): Promise<NovelListItemDto[]> {
    const startedAt = performance.now();
    const hasFilteringOptions = Boolean(typeof options.limit === "number" || options.excludeProjectPathPrefixes?.length);
    const canUseDefaultList = !options.sessionProvider && !hasFilteringOptions;
    options.diagnostics ??= {};
    options.diagnostics.cacheMode = options.sessionProvider ? "custom" : canUseDefaultList ? "default" : "filtered";
    if (!canUseDefaultList) {
        options.diagnostics.fullListCache = "bypass";
    }
    try {
        if (canUseDefaultList) {
            return await readDefaultNovelList(options);
        }

        return await readNovelList(options.sessionProvider ?? new JsonlSessionRepository(), options, {
            useRuntimeCaches: !options.sessionProvider,
            timingSink: options.timingSink,
            diagnostics: options.diagnostics,
        });
    } finally {
        options.timingSink?.mark("projects.total", performance.now() - startedAt);
    }
}

/**
 * 失效 Project Workspace 列表短缓存。
 */
export function invalidateNovelListCache(): void {
    defaultNovelListCacheVersion += 1;
    defaultNovelListCache = null;
    defaultNovelListPromise = null;
    defaultProjectListCache = null;
    defaultProjectListPromise = null;
    defaultSessionCountCache = null;
    defaultSessionCountPromise = null;
    projectStatisticsCache.clear();
    projectStatisticsPromises.clear();
}

/**
 * 渐进预热 Project 列表短缓存。这里不占用 defaultNovelListPromise，避免首个真实请求被后台全量预热捆住。
 */
export async function prewarmNovelListCache(): Promise<void> {
    const cacheVersion = defaultNovelListCacheVersion;
    const diagnostics: NovelListDiagnostics = {};
    const context: NovelListReadContext = {
        useRuntimeCaches: true,
        diagnostics,
    };
    const [projects, sessionCountByProject] = await Promise.all([
        readCachedProjectList(context),
        readCachedSessionCount(new JsonlSessionRepository(), context),
    ]);
    const warmedStatistics = new Map<string, ProjectStatisticsWithoutSessions>();
    for (const project of projects) {
        await yieldToEventLoop();
        warmedStatistics.set(project.projectPath, await readCachedProjectStatistics(project.projectPath, context));
    }
    if (cacheVersion !== defaultNovelListCacheVersion) {
        return;
    }
    const list = projects.map((project) => {
        const statistics = warmedStatistics.get(project.projectPath) ?? EMPTY_NOVEL_STATISTICS;
        return toNovelResponse({
            ...project,
            statistics: {
                ...statistics,
                sessionCount: sessionCountByProject.get(project.projectPath) ?? 0,
            },
        });
    });
    refreshRuntimeCachesFromNovelList(list);
    defaultNovelListCache = {
        expiresAt: Date.now() + NOVEL_LIST_CACHE_TTL_MS,
        value: list,
    };
}

/**
 * 读取默认完整列表。includeProjectPath-only 不裁剪列表，复用完整列表缓存即可。
 */
async function readDefaultNovelList(options: NovelListOptions): Promise<NovelListItemDto[]> {
    const now = Date.now();
    if (defaultNovelListCache && defaultNovelListCache.expiresAt > now) {
        options.diagnostics!.fullListCache = "hit";
        options.diagnostics!.projectCount = defaultNovelListCache.value.length;
        options.diagnostics!.visibleCount = defaultNovelListCache.value.length;
        markCachedNovelListTiming(options.timingSink);
        return defaultNovelListCache.value;
    }
    if (defaultNovelListPromise) {
        options.diagnostics!.fullListCache = "pending";
        markCachedNovelListTiming(options.timingSink);
        const list = await measureAsync(options.timingSink, "projects.pending.fullList", () => defaultNovelListPromise!);
        options.diagnostics!.projectCount = list.length;
        options.diagnostics!.visibleCount = list.length;
        return list;
    }

    options.diagnostics!.fullListCache = "miss";
    const cacheVersion = defaultNovelListCacheVersion;
    defaultNovelListPromise = readNovelList(new JsonlSessionRepository(), options, {
        useRuntimeCaches: true,
        timingSink: options.timingSink,
        diagnostics: options.diagnostics,
    })
        .then((list) => {
            if (cacheVersion === defaultNovelListCacheVersion) {
                refreshRuntimeCachesFromNovelList(list);
                defaultNovelListCache = {
                    expiresAt: Date.now() + NOVEL_LIST_CACHE_TTL_MS,
                    value: list,
                };
            }
            return list;
        })
        .finally(() => {
            if (cacheVersion === defaultNovelListCacheVersion) {
                defaultNovelListPromise = null;
            }
        });
    return defaultNovelListPromise;
}

function markCachedNovelListTiming(timingSink: ServerTimingSink | undefined): void {
    timingSink?.mark("projects.manifests", 0);
    timingSink?.mark("projects.sessions", 0);
    timingSink?.mark("projects.filter", 0);
    timingSink?.mark("projects.stats.workspace", 0);
    timingSink?.mark("projects.stats.plot", 0);
}

function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function refreshRuntimeCachesFromNovelList(list: readonly NovelListItemDto[]): void {
    const expiresAt = Date.now() + NOVEL_LIST_CACHE_TTL_MS;
    if (defaultProjectListCache) {
        defaultProjectListCache.expiresAt = expiresAt;
    }
    if (defaultSessionCountCache) {
        defaultSessionCountCache.expiresAt = expiresAt;
    }
    for (const novel of list) {
        projectStatisticsCache.set(novel.projectPath, {
            expiresAt,
            value: {
                volumeCount: novel.volumeCount,
                chapterCount: novel.chapterCount,
                totalWords: novel.totalWords,
                lorebookCount: novel.lorebookCount,
                threadCount: novel.threadCount,
                sceneCount: novel.sceneCount,
                plotCount: novel.plotCount,
            },
        });
    }
}

/**
 * 读取 Project Workspace 列表并汇总统计；调用方决定是否缓存。
 */
async function readNovelList(sessionProvider: SessionListProvider, options: NovelListOptions, context: NovelListReadContext): Promise<NovelListItemDto[]> {
    const [projects, sessionCountByProject] = await Promise.all([
        context.useRuntimeCaches ? readCachedProjectList(context) : measureProjectList(context, () => listProjectWorkspaces()),
        context.useRuntimeCaches ? readCachedSessionCount(sessionProvider, context) : measureSessionCount(context, () => readSessionCountByProject(sessionProvider)),
    ]);
    context.diagnostics!.projectCount = projects.length;
    const visibleProjects = measureSync(context.timingSink, "projects.filter", () => filterNovelListProjects(projects, options));
    context.diagnostics!.visibleCount = visibleProjects.length;
    const statisticsByProjectPath = await readProjectStatisticsBatch(visibleProjects.map((project) => project.projectPath), context);
    return visibleProjects.map((project) => toNovelResponse({
        ...project,
        statistics: {
            ...(statisticsByProjectPath.get(project.projectPath) ?? EMPTY_NOVEL_STATISTICS),
            sessionCount: sessionCountByProject.get(project.projectPath) ?? 0,
        },
    }));
}

/**
 * 读取带短缓存的 Project manifest 列表。
 */
async function readCachedProjectList(context: NovelListReadContext): Promise<Awaited<ReturnType<typeof listProjectWorkspaces>>> {
    const now = Date.now();
    if (defaultProjectListCache && defaultProjectListCache.expiresAt > now) {
        context.diagnostics!.projectListCache = "hit";
        context.timingSink?.mark("projects.manifests", 0);
        return defaultProjectListCache.value;
    }
    if (defaultProjectListPromise) {
        context.diagnostics!.projectListCache = "pending";
        return measureProjectList(context, () => defaultProjectListPromise!);
    }

    context.diagnostics!.projectListCache = "miss";
    const cacheVersion = defaultNovelListCacheVersion;
    defaultProjectListPromise = measureProjectList(context, () => listProjectWorkspaces())
        .then((projects) => {
            if (cacheVersion === defaultNovelListCacheVersion) {
                defaultProjectListCache = {
                    expiresAt: Date.now() + NOVEL_LIST_CACHE_TTL_MS,
                    value: projects,
                };
            }
            return projects;
        })
        .finally(() => {
            if (cacheVersion === defaultNovelListCacheVersion) {
                defaultProjectListPromise = null;
            }
        });
    return defaultProjectListPromise;
}

/**
 * 读取带短缓存的 Project session 计数。
 */
async function readCachedSessionCount(sessionProvider: SessionListProvider, context: NovelListReadContext): Promise<Map<string, number>> {
    const now = Date.now();
    if (defaultSessionCountCache && defaultSessionCountCache.expiresAt > now) {
        context.diagnostics!.sessionCountCache = "hit";
        context.timingSink?.mark("projects.sessions", 0);
        return defaultSessionCountCache.value;
    }
    if (defaultSessionCountPromise) {
        context.diagnostics!.sessionCountCache = "pending";
        return measureSessionCount(context, () => defaultSessionCountPromise!);
    }

    context.diagnostics!.sessionCountCache = "miss";
    const cacheVersion = defaultNovelListCacheVersion;
    defaultSessionCountPromise = measureSessionCount(context, () => readSessionCountByProject(sessionProvider))
        .then((counts) => {
            if (cacheVersion === defaultNovelListCacheVersion) {
                defaultSessionCountCache = {
                    expiresAt: Date.now() + NOVEL_LIST_CACHE_TTL_MS,
                    value: counts,
                };
            }
            return counts;
        })
        .finally(() => {
            if (cacheVersion === defaultNovelListCacheVersion) {
                defaultSessionCountPromise = null;
            }
        });
    return defaultSessionCountPromise;
}

function measureProjectList<T>(context: NovelListReadContext, task: () => Promise<T>): Promise<T> {
    return measureAsync(context.timingSink, "projects.manifests", task);
}

function measureSessionCount<T>(context: NovelListReadContext, task: () => Promise<T>): Promise<T> {
    return measureAsync(context.timingSink, "projects.sessions", task);
}

/**
 * 按调用方提供的轻量列表参数裁剪 Project；include 项用于保留当前选择或 URL 目标。
 */
function filterNovelListProjects<T extends {projectPath: string}>(projects: T[], options: NovelListOptions): T[] {
    const includeProjectPaths = new Set(options.includeProjectPaths ?? []);
    const excludePrefixes = options.excludeProjectPathPrefixes ?? [];
    const filteredProjects = excludePrefixes.length
        ? projects.filter((project) => !excludePrefixes.some((prefix) => project.projectPath.startsWith(prefix)))
        : projects;
    const limitedProjects = typeof options.limit === "number" ? filteredProjects.slice(0, options.limit) : filteredProjects;
    if (includeProjectPaths.size === 0) {
        return limitedProjects;
    }

    const selectedProjectPaths = new Set(limitedProjects.map((project) => project.projectPath));
    const includedProjects = projects.filter((project) => includeProjectPaths.has(project.projectPath) && !selectedProjectPaths.has(project.projectPath));
    return [...includedProjects, ...limitedProjects];
}

/**
 * 校验 Project Workspace 存在。
 */
export async function assertNovel(projectPath: string): Promise<NovelListItemDto> {
    const manifest = await readProjectManifest(projectPath);
    return toNovelResponse({
        projectPath,
        title: manifest.title,
        summary: manifest.summary,
        updatedAt: new Date().toISOString(),
    });
}

async function readProjectStatisticsBatch(projectPaths: readonly string[], context: NovelListReadContext): Promise<Map<string, ProjectStatisticsWithoutSessions>> {
    const result = new Map<string, ProjectStatisticsWithoutSessions>();
    const now = Date.now();
    const pendingProjects: Array<{projectPath: string; promise: Promise<ProjectStatisticsWithoutSessions>}> = [];
    const missingProjectPaths: string[] = [];
    for (const projectPath of projectPaths) {
        const cached = projectStatisticsCache.get(projectPath);
        if (cached && cached.expiresAt > now) {
            context.diagnostics!.statsCacheHits = (context.diagnostics!.statsCacheHits ?? 0) + 1;
            result.set(projectPath, cached.value);
            continue;
        }
        const pending = projectStatisticsPromises.get(projectPath);
        if (pending) {
            context.diagnostics!.statsCachePending = (context.diagnostics!.statsCachePending ?? 0) + 1;
            pendingProjects.push({projectPath, promise: pending});
            continue;
        }
        context.diagnostics!.statsCacheMisses = (context.diagnostics!.statsCacheMisses ?? 0) + 1;
        missingProjectPaths.push(projectPath);
    }

    const [pendingResults, missingResults] = await Promise.all([
        readPendingProjectStatistics(pendingProjects, context),
        readMissingProjectStatistics(missingProjectPaths, context),
    ]);
    for (const [projectPath, statistics] of [...pendingResults, ...missingResults]) {
        result.set(projectPath, statistics);
    }
    return result;
}

async function readCachedProjectStatistics(projectPath: string, context: NovelListReadContext): Promise<ProjectStatisticsWithoutSessions> {
    return (await readProjectStatisticsBatch([projectPath], context)).get(projectPath) ?? EMPTY_PROJECT_STATISTICS;
}

async function readPendingProjectStatistics(
    pendingProjects: Array<{projectPath: string; promise: Promise<ProjectStatisticsWithoutSessions>}>,
    context: NovelListReadContext,
): Promise<Array<[string, ProjectStatisticsWithoutSessions]>> {
    if (pendingProjects.length === 0) {
        return [];
    }
    return measureAsync(context.timingSink, "projects.stats.pending", async () => Promise.all(pendingProjects.map(async (item) => [
        item.projectPath,
        await item.promise,
    ] as [string, ProjectStatisticsWithoutSessions])));
}

async function readMissingProjectStatistics(projectPaths: readonly string[], context: NovelListReadContext): Promise<Array<[string, ProjectStatisticsWithoutSessions]>> {
    if (projectPaths.length === 0) {
        context.timingSink?.mark("projects.stats.workspace", 0);
        context.timingSink?.mark("projects.stats.plot", 0);
        return [];
    }
    const cacheVersion = defaultNovelListCacheVersion;
    const workspaceCountsPromise = measureAsync(context.timingSink, "projects.stats.workspace", async () => Promise.all(projectPaths.map((projectPath) => readWorkspaceStatistics(projectPath))));
    const plotCountsPromise = measureAsync(context.timingSink, "projects.stats.plot", async () => Promise.all(projectPaths.map((projectPath) => readPlotCounts(projectPath))));
    const batchPromise = Promise.all([workspaceCountsPromise, plotCountsPromise]);
    const promises = projectPaths.map((projectPath, index) => {
        const promise = batchPromise
            .then(([workspaceCounts, plotCounts]) => {
                const workspaceStatistics = workspaceCounts[index] ?? EMPTY_PROJECT_STATISTICS;
                const plotStatistics = plotCounts[index] ?? EMPTY_PROJECT_STATISTICS;
                return {
                    ...workspaceStatistics,
                    ...plotStatistics,
                };
            })
            .then((value) => {
                if (cacheVersion === defaultNovelListCacheVersion) {
                    projectStatisticsCache.set(projectPath, {
                        expiresAt: Date.now() + NOVEL_LIST_CACHE_TTL_MS,
                        value,
                    });
                }
                return value;
            })
            .finally(() => {
                if (cacheVersion === defaultNovelListCacheVersion) {
                    projectStatisticsPromises.delete(projectPath);
                }
            });
        projectStatisticsPromises.set(projectPath, promise);
        return promise.then((statistics) => [projectPath, statistics] as [string, ProjectStatisticsWithoutSessions]);
    });
    return Promise.all(promises);
}

/**
 * 从 Project Workspace tree index 统计正文与 lorebook 内容节点。
 */
async function readWorkspaceStatistics(projectPath: string): Promise<Pick<NovelStatisticCounts, "volumeCount" | "chapterCount" | "totalWords" | "lorebookCount">> {
    try {
        const snapshot = await readProjectWorkspaceTreeSnapshot({
            root: resolveProjectAbsolutePath(projectPath),
        });
        const manuscriptNodes = snapshot.nodes.filter((node) => isUnderRoot(node, "manuscript"));
        const chapterNodes = manuscriptNodes.filter((node) => isCountableContentNode(node) && node.entryType === "chapter");

        return {
            volumeCount: manuscriptNodes.filter((node) => isCountableContentNode(node) && node.entryType === "volume").length,
            chapterCount: chapterNodes.length,
            totalWords: chapterNodes.reduce((total, node) => total + node.words, 0),
            lorebookCount: snapshot.nodes.filter(isLorebookEntryNode).length,
        };
    } catch (error) {
        consola.warn({projectPath, error}, "读取 Project Workspace 统计失败");
        return {
            volumeCount: 0,
            chapterCount: 0,
            totalWords: 0,
            lorebookCount: 0,
        };
    }
}

/**
 * 统计当前 Project 的非系统、非归档 Agent session。
 */
async function readSessionCountByProject(sessionProvider: SessionListProvider): Promise<Map<string, number>> {
    try {
        const sessions = await sessionProvider.listSessions({
            includeArchived: false,
            includeSystem: false,
            status: "active",
        });
        const result = new Map<string, number>();
        for (const session of sessions) {
            if (!session.projectPath) {
                continue;
            }
            result.set(session.projectPath, (result.get(session.projectPath) ?? 0) + 1);
        }
        return result;
    } catch (error) {
        consola.warn({error}, "读取 Project Agent session 统计失败");
        return new Map();
    }
}

/**
 * 只读统计 Project SQLite 剧情对象数量；不得初始化数据库或 Story。
 */
async function readPlotCounts(projectPath: string): Promise<Pick<NovelStatisticCounts, "threadCount" | "sceneCount" | "plotCount">> {
    const databasePath = resolveProjectDatabasePath(projectPath);
    if (!existsSync(databasePath)) {
        return {
            threadCount: 0,
            sceneCount: 0,
            plotCount: 0,
        };
    }

    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const [threadCount, sceneCount] = await Promise.all([
            readSqliteTableCount(client, "StoryThread"),
            readSqliteTableCount(client, "StoryScene"),
        ]);
        return {
            threadCount,
            sceneCount,
            plotCount: 0,
        };
    } catch (error) {
        consola.warn({projectPath, error}, "读取 Project Plot 统计失败");
        return {
            threadCount: 0,
            sceneCount: 0,
            plotCount: 0,
        };
    } finally {
        await client.close();
        collectReleasedSqliteHandles();
    }
}

/**
 * 读取 SQLite 表行数，表不存在时返回 0。
 */
async function readSqliteTableCount(client: {execute(statement: string): Promise<{rows: Array<Record<string, unknown>>}>}, tableName: "StoryThread" | "StoryScene"): Promise<number> {
    try {
        const result = await client.execute(`SELECT COUNT(*) AS count FROM "${tableName}"`);
        const value = result.rows[0]?.count;
        if (typeof value === "number") {
            return value;
        }
        if (typeof value === "bigint") {
            return Number(value);
        }
        return typeof value === "string" ? Number.parseInt(value, 10) || 0 : 0;
    } catch (error) {
        if (isMissingSqliteTableError(error)) {
            return 0;
        }
        throw error;
    }
}

async function measureAsync<T>(timingSink: ServerTimingSink | undefined, name: string, task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
        return await task();
    } finally {
        timingSink?.mark(name, performance.now() - startedAt);
    }
}

function measureSync<T>(timingSink: ServerTimingSink | undefined, name: string, task: () => T): T {
    const startedAt = performance.now();
    try {
        return task();
    } finally {
        timingSink?.mark(name, performance.now() - startedAt);
    }
}

/**
 * 判断 SQLite 错误是否表示表不存在。
 */
function isMissingSqliteTableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("no such table");
}

/**
 * 判断节点是否位于指定内容根下。
 */
function isUnderRoot(node: WorkspaceFileNode, root: "manuscript" | "lorebook"): boolean {
    return node.path === `${root}/` || node.path.startsWith(`${root}/`);
}

/**
 * 判断节点是否为 lorebook 条目；排除 lorebook 根目录自身。
 */
function isLorebookEntryNode(node: WorkspaceFileNode): boolean {
    if (!isCountableContentNode(node) || !isUnderRoot(node, "lorebook")) {
        return false;
    }
    return node.path !== "lorebook/" && node.path !== "lorebook/index.md";
}

/**
 * 目录内容节点和独立 Markdown 内容节点计数；目录对应的 index.md 不重复计数。
 */
function isCountableContentNode(node: WorkspaceFileNode): boolean {
    if (!node.contentNode) {
        return false;
    }
    return node.isDirectory || !node.path.endsWith("/index.md");
}

/**
 * 读取 projectPath 路由参数。
 */
export function requireProjectPath(event: H3Event): string {
    const value = event.context.params?.projectPath ?? event.context.params?.novelId ?? "";
    if (!value.trim()) {
        throwBadRequest("projectPath 不能为空");
    }
    return decodeURIComponent(value);
}

/**
 * 读取 query 中的 projectPath。
 */
export function requireProjectPathQuery(event: H3Event): string {
    const query = getQuery(event);
    const value = query.projectPath;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        throwBadRequest("projectPath query 不能为空");
    }
    return text;
}

/**
 * 统一校验请求体。
 */
export async function validateBody<T>(event: H3Event, schema: z.ZodSchema<T>): Promise<T> {
    const body = await readBody(event);
    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        consola.warn({
            method: event.method,
            path: event.path,
            body,
            issues: parseResult.error.issues,
        }, "请求体验证失败");
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
}

/**
 * 更新 Project manifest 基础信息。
 */
export async function updateNovelByTool(
    projectPath: string,
    input: UpdateNovelRequestDto,
): Promise<NovelListItemDto> {
    const normalizedProjectPath = await assertProjectWorkspaceDirectory(projectPath);
    const current = await readProjectManifestOrFallback(normalizedProjectPath);
    const next = {
        ...current,
        title: input.title ?? current.title,
        summary: input.summary ?? current.summary,
    };
    await writeProjectManifest(normalizedProjectPath, next);
    return toNovelResponse({
        projectPath: normalizedProjectPath,
        title: next.title,
        summary: next.summary,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * 读取 Project Manifest；若文件已损坏，使用目录名兜底，让元数据更新可以覆盖写回合法 manifest。
 */
async function readProjectManifestOrFallback(projectPath: string): Promise<ProjectManifest> {
    try {
        return await readProjectManifest(projectPath);
    } catch (error) {
        if (!isRecoverableProjectManifestError(error)) {
            throw error;
        }
        return {
            kind: "novel",
            title: projectPath.split("/").at(-1) ?? projectPath,
            summary: "",
        };
    }
}

/**
 * 判断 Project Manifest 读取错误是否可以由覆盖写回修复。
 */
function isRecoverableProjectManifestError(error: unknown): boolean {
    if (error instanceof YAMLParseError) {
        return true;
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return true;
    }
    if (isError(error) && error.statusCode === 400) {
        return true;
    }
    return false;
}
