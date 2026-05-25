import {z} from "zod";
import {deleteWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

const DeleteWorkspacePathBodySchema = z.object({
    projectPath: z.string().optional(),
    workspaceKind: z.literal("user-assets").optional(),
    path: z.string().trim().min(1, "path 不能为空"),
    recursive: z.boolean().optional().default(false),
});

/**
 * 删除工作区文件或目录。
 */
export default defineEventHandler(async (event) => {
    const body = DeleteWorkspacePathBodySchema.parse(await readBody(event));
    await deleteWorkspacePath(await resolveWorkspaceRootInput(body), body.path, body.recursive);
    return {success: true};
});
