import {z} from "zod";
import {createWorkspaceDirectory} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";

const CreateWorkspaceDirectoryBodySchema = z.object({
    projectPath: z.string().optional(),
    workspaceKind: z.literal("user-assets").optional(),
    path: z.string().trim().min(1, "path 不能为空"),
    indexContent: z.string().nullable().optional(),
});

/**
 * 创建工作区目录。
 */
export default defineEventHandler(async (event) => {
    const body = CreateWorkspaceDirectoryBodySchema.parse(await readBody(event));
    const root = await resolveWorkspaceRootInput(body);
    const node = await createWorkspaceDirectory({
        root,
        dirPath: body.path,
        indexContent: body.indexContent,
    });
    invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind: body.workspaceKind});
    return node;
});
