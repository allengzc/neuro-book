import {z} from "zod";
import {deleteWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";

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
    const root = await resolveWorkspaceRootInput(body);
    await deleteWorkspacePath(root, body.path, body.recursive);
    invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind: body.workspaceKind});
    return {success: true};
});
