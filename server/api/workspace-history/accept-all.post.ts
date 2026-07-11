import {z} from "zod";
import {createError} from "h3";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-workspace";
import {ensureProjectHistory, LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";
import {workspaceHistoryInboxRevision} from "nbook/server/workspace-history/history-inbox";

const AcceptAllBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 不能为空"),
    revision: z.number().int().nonnegative("revision 不能为负数"),
});

/**
 * 接受当前用户收件箱中的全部文件变更。
 * 服务端重新读取 inbox，避免客户端列表过期时遗漏文件。
 */
export default defineEventHandler(async (event) => {
    const body = AcceptAllBodySchema.parse(await readBody(event));
    const projectPath = normalizeProjectPath(body.projectPath);
    assertProjectOpenForRoot(projectPath);
    const history = await ensureProjectHistory(projectPath);
    if (!history) {
        throw createError({statusCode: 400, message: "文件历史未启用"});
    }
    const groups = await history.inbox(LOCAL_USER_ID);
    if (workspaceHistoryInboxRevision(groups) !== body.revision) {
        throw createError({statusCode: 412, message: "收件箱已发生新变化，请刷新后重新审查"});
    }
    for (const group of groups) {
        await history.accept(LOCAL_USER_ID, group.path);
    }
    return {success: true, accepted: groups.length};
});
