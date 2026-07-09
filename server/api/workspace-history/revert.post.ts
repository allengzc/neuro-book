import {z} from "zod";
import {createError} from "h3";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";
import {ensureProjectHistory, LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";

const RevertBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 不能为空"),
    path: z.string().trim().min(1, "path 不能为空"),
});

/**
 * 还原一个文件到用户的「已接受基线」：落盘 + 记 file.revert + 位点推进。
 * 还原写盘绕过常规写入口，手动失效 workspace 索引让编辑器立即看到。
 */
export default defineEventHandler(async (event) => {
    const body = RevertBodySchema.parse(await readBody(event));
    const projectPath = normalizeProjectPath(body.projectPath);
    assertProjectOpenForRoot(projectPath);
    const history = await ensureProjectHistory(projectPath);
    if (!history) {
        throw createError({statusCode: 400, message: "文件历史未启用"});
    }
    await history.revert(LOCAL_USER_ID, body.path);
    invalidateProjectWorkspaceIndexAfterMutation({root: projectPath});
    return {success: true};
});
