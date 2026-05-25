import {z} from "zod";
import {convertWorkspaceFileToDirectory} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

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
    return convertWorkspaceFileToDirectory({
        root: await resolveWorkspaceRootInput(body),
        filePath: body.path,
    });
});
