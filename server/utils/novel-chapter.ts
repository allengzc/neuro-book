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

const NOVEL_LIST_CACHE_TTL_MS = 5_000;
let defaultNovelListCache: {expiresAt: number; value: NovelListItemDto[]} | null = null;
let defaultNovelListPromise: Promise<NovelListItemDto[]> | null = null;
let defaultNovelListCacheVersion = 0;

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
    if (!options.sessionProvider) {
        const now = Date.now();
        if (defaultNovelListCache && defaultNovelListCache.expiresAt > now) {
            return defaultNovelListCache.value;
        }
        if (defaultNovelListPromise) {
            return defaultNovelListPromise;
        }

        const cacheVersion = defaultNovelListCacheVersion;
        defaultNovelListPromise = readNovelList(new JsonlSessionRepository())
            .then((list) => {
                if (cacheVersion === defaultNovelListCacheVersion) {
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

    return readNovelList(options.sessionProvider);
}

/**
 * 失效 Project Workspace 列表短缓存。
 */
export function invalidateNovelListCache(): void {
    defaultNovelListCacheVersion += 1;
    defaultNovelListCache = null;
    defaultNovelListPromise = null;
}

/**
 * 读取 Project Workspace 列表并汇总统计；调用方决定是否缓存。
 */
async function readNovelList(sessionProvider: SessionListProvider): Promise<NovelListItemDto[]> {
    const [projects, sessionCountByProject] = await Promise.all([
        listProjectWorkspaces(),
        readSessionCountByProject(sessionProvider),
    ]);
    return Promise.all(projects.map(async (project) => toNovelResponse({
        ...project,
        statistics: await readNovelStatistics(project.projectPath, sessionCountByProject.get(project.projectPath) ?? 0),
    })));
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

/**
 * 汇总 Project Workspace 书架卡片所需统计。
 */
async function readNovelStatistics(projectPath: string, sessionCount: number): Promise<NovelStatisticCounts> {
    const [workspaceCounts, plotCounts] = await Promise.all([
        readWorkspaceStatistics(projectPath),
        readPlotCounts(projectPath),
    ]);

    return {
        ...workspaceCounts,
        sessionCount,
        ...plotCounts,
    };
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
        const [threadCount, sceneCount, plotCount] = await Promise.all([
            readSqliteTableCount(client, "StoryThread"),
            readSqliteTableCount(client, "StoryScene"),
            readSqliteTableCount(client, "StoryPlot"),
        ]);
        return {
            threadCount,
            sceneCount,
            plotCount,
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
async function readSqliteTableCount(client: {execute(statement: string): Promise<{rows: Array<Record<string, unknown>>}>}, tableName: "StoryThread" | "StoryScene" | "StoryPlot"): Promise<number> {
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
