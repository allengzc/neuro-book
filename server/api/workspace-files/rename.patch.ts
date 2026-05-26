import {z} from "zod";
import {renameWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";

const RenameWorkspacePathBodySchema = z.object({
    projectPath: z.string().optional(),
    workspaceKind: z.literal("user-assets").optional(),
    from: z.string().trim().min(1, "from 不能为空"),
    to: z.string().trim().min(1, "to 不能为空"),
});

/**
 * 移动或重命名工作区路径。
 */
export default defineEventHandler(async (event) => {
    const body = RenameWorkspacePathBodySchema.parse(await readBody(event));
    const root = await resolveWorkspaceRootInput(body);
    const node = await renameWorkspacePath(root, body.from, body.to);
    invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind: body.workspaceKind});
    return node;
});
