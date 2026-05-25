import {readWorkspaceTextFile, statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

/**
 * 读取工作区文本文件。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const filePath = readRequiredQueryString(query.path, "path");
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const workspaceRoot = await resolveWorkspaceRootInput({projectPath, workspaceKind});
    const [node, content] = await Promise.all([
        statWorkspacePath(workspaceRoot, filePath),
        readWorkspaceTextFile(workspaceRoot, filePath),
    ]);

    return {
        path: node.path,
        absolutePath: node.absolutePath,
        entryType: node.entryType,
        editable: node.editable,
        mtimeMs: node.mtimeMs,
        content,
    };
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
