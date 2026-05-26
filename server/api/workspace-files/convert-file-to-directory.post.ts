import {z} from "zod";
import {convertWorkspaceFileToDirectory} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";

const ConvertWorkspaceFileToDirectoryBodySchema = z.object({
    projectPath: z.string().optional(),
    workspaceKind: z.literal("user-assets").optional(),
    path: z.string().trim().min(1, "path 不能为空"),
});

/**
 * 将工作区文本文件转换为同名目录下的 index.md。
 */
export default defineEventHandler(async (event) => {
    const body = ConvertWorkspaceFileToDirectoryBodySchema.parse(await readBody(event));
    const root = await resolveWorkspaceRootInput(body);
    const node = await convertWorkspaceFileToDirectory({
        root,
        filePath: body.path,
    });
    invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind: body.workspaceKind});
    return node;
});
