import {z} from "zod";
import {createWorkspaceFile} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {prisma} from "nbook/server/utils/prisma";

const CreateWorkspaceFileBodySchema = z.object({
    root: z.string().optional(),
    novelId: z.string().optional(),
    workspaceKind: z.literal("user-assets").optional(),
    path: z.string().trim().min(1, "path 不能为空"),
    content: z.string().optional(),
});

/**
 * 创建工作区文本文件。
 */
export default defineEventHandler(async (event) => {
    const body = CreateWorkspaceFileBodySchema.parse(await readBody(event));
    return createWorkspaceFile({
        root: await resolveWorkspaceRootInput(prisma, body),
        filePath: body.path,
        content: body.content,
    });
});
