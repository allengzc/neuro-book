import {getQuery} from "h3";
import {appLogger} from "nbook/server/app-logs/logger";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {listNovels, type NovelListDiagnostics} from "nbook/server/utils/novel-chapter";

const SLOW_PROJECT_LIST_MS = 500;

/**
 * 查询 Project Workspace 列表。
 */
export default defineEventHandler(async (event) => {
    const startedAt = performance.now();
    const timingSink = createServerTiming(event);
    const query = getQuery(event);
    const limit = typeof query.limit === "string" && /^\d+$/.test(query.limit) ? Number.parseInt(query.limit, 10) : undefined;
    const includeProjectPaths = queryStringList(query.includeProjectPath);
    const excludeProjectPathPrefixes = queryStringList(query.excludeProjectPathPrefix);
    const diagnostics: NovelListDiagnostics = {};
    const novels = await listNovels({
        limit: Number.isSafeInteger(limit) ? limit : undefined,
        includeProjectPaths,
        excludeProjectPathPrefixes,
        timingSink,
        diagnostics,
    });
    const durationMs = performance.now() - startedAt;
    if (durationMs > SLOW_PROJECT_LIST_MS) {
        void appLogger.warn("projects.list.slow", {
            durationMs,
            queryShape: {
                hasLimit: typeof limit === "number",
                includeProjectPathCount: includeProjectPaths?.length ?? 0,
                excludePrefixCount: excludeProjectPathPrefixes?.length ?? 0,
            },
            projectCount: diagnostics.projectCount ?? novels.length,
            visibleCount: diagnostics.visibleCount ?? novels.length,
            cache: {
                mode: diagnostics.cacheMode,
                fullList: diagnostics.fullListCache,
                projectList: diagnostics.projectListCache,
                sessions: diagnostics.sessionCountCache,
                statsHits: diagnostics.statsCacheHits ?? 0,
                statsMisses: diagnostics.statsCacheMisses ?? 0,
                statsPending: diagnostics.statsCachePending ?? 0,
            },
        }, "Project 列表请求过慢");
    }
    return novels;
});

/**
 * 将 h3 query 的单值 / 多值参数转成字符串数组。
 */
function queryStringList(value: unknown): string[] | undefined {
    if (typeof value === "string") {
        return value ? [value] : undefined;
    }
    if (Array.isArray(value)) {
        const list = value.filter((item): item is string => typeof item === "string" && Boolean(item));
        return list.length ? list : undefined;
    }
    return undefined;
}
