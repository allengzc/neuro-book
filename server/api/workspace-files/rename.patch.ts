import {z} from "zod";
import {renameWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

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
    return renameWorkspacePath(await resolveWorkspaceRootInput(body), body.from, body.to);
});
