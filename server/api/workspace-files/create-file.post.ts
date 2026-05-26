import {z} from "zod";
import {createWorkspaceFile} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";

const CreateWorkspaceFileBodySchema = z.object({
    projectPath: z.string().optional(),
    workspaceKind: z.literal("user-assets").optional(),
    path: z.string().trim().min(1, "path 不能为空"),
    content: z.string().optional(),
});

/**
 * 创建工作区文本文件。
 */
export default defineEventHandler(async (event) => {
    const body = CreateWorkspaceFileBodySchema.parse(await readBody(event));
    const root = await resolveWorkspaceRootInput(body);
    const node = await createWorkspaceFile({
        root,
        filePath: body.path,
        content: body.content,
    });
    invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind: body.workspaceKind});
    return node;
});
