import {z} from "zod";
import {createWorkspaceDirectory} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

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
    return createWorkspaceDirectory({
        root: await resolveWorkspaceRootInput(body),
        dirPath: body.path,
        indexContent: body.indexContent,
    });
});
