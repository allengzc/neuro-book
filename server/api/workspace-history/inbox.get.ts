import {createError, getQuery} from "h3";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-workspace";
import {ensureProjectHistory, LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {toWorkspaceHistoryInboxGroupDto} from "nbook/server/workspace-history/history-dto";
import type {WorkspaceHistoryInboxDto} from "nbook/shared/dto/workspace-history.dto";

/**
 * 用户收件箱：列出有未接受 agent/system 变更的项目文件分组（userId 服务端固定 local，D10）。
 * history 未启用时返回空列表。
 */
export default defineEventHandler(async (event): Promise<WorkspaceHistoryInboxDto> => {
    const query = getQuery(event);
    if (typeof query.projectPath !== "string" || !query.projectPath.trim()) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }
    const projectPath = normalizeProjectPath(query.projectPath);
    assertProjectOpenForRoot(projectPath);
    const history = await ensureProjectHistory(projectPath);
    if (!history) {
        return {groups: []};
    }
    const groups = await history.inbox(LOCAL_USER_ID);
    return {groups: groups.map(toWorkspaceHistoryInboxGroupDto)};
});
