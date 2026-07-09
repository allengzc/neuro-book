import {z} from "zod";
import {createError} from "h3";
import {assertProjectOpenForRoot} from "nbook/server/workspace-files/project-open-guard";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-workspace";
import {ensureProjectHistory, LOCAL_USER_ID} from "nbook/server/workspace-history/project-history";

const AcceptBodySchema = z.object({
    projectPath: z.string().trim().min(1, "projectPath 不能为空"),
    path: z.string().trim().min(1, "path 不能为空"),
});

/**
 * 接受一个文件的收件箱变更：用户位点推进到该文件当前最新条目。
 */
export default defineEventHandler(async (event) => {
    const body = AcceptBodySchema.parse(await readBody(event));
    const projectPath = normalizeProjectPath(body.projectPath);
    assertProjectOpenForRoot(projectPath);
    const history = await ensureProjectHistory(projectPath);
    if (!history) {
        throw createError({statusCode: 400, message: "文件历史未启用"});
    }
    await history.accept(LOCAL_USER_ID, body.path);
    return {success: true};
});
