import {createError, getQuery} from "h3";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-workspace";
import {ensureProjectHistory} from "nbook/server/workspace-history/project-history";
import type {WorkspaceHistorySnapshotDto} from "nbook/shared/dto/workspace-history.dto";

/**
 * 按内容 hash 取快照全文（diff 面板按需加载两侧）。
 * text = null 表示 body 不可用（超限 / 二进制 / 已被保留策略清理）。
 */
export default defineEventHandler(async (event): Promise<WorkspaceHistorySnapshotDto> => {
    const query = getQuery(event);
    if (typeof query.projectPath !== "string" || !query.projectPath.trim()) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    if (typeof query.hash !== "string" || !query.hash.trim()) {
        throw createError({statusCode: 400, message: "hash 不能为空"});
    }
    const projectPath = normalizeProjectPath(query.projectPath);
    assertProjectOpenForRoot(projectPath);
    const history = await ensureProjectHistory(projectPath);
    if (!history) {
        throw createError({statusCode: 400, message: "文件历史未启用"});
    }
    const body = await history.snapshotBody(query.hash.trim());
    return {text: body === null ? null : new TextDecoder().decode(body)};
});
