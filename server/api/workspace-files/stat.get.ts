import {statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 读取工作区文件或目录元信息。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const filePath = readRequiredQueryString(query.path, "path");
    const root = typeof query.root === "string" ? query.root : undefined;
    const novelId = typeof query.novelId === "string" ? query.novelId : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    return statWorkspacePath(await resolveWorkspaceRootInput(prisma, {root, novelId, workspaceKind}), filePath);
});

/**
 * 读取必填查询字符串。
 */
function readRequiredQueryString(value: unknown, key: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw createError({statusCode: 400, message: `${key} 不能为空`});
    }
    return value.trim();
}
