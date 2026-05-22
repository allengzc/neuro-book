import {z} from "zod";
import {prisma} from "nbook/server/utils/prisma";
import {updateNovelByTool} from "nbook/server/utils/novel-chapter";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {NovelSummarySchema, NovelTitleSchema, resolveToolNovelId} from "nbook/server/agent/tools/shared/novel-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const UpdateNovelInputSchema = z.object({
    title: NovelTitleSchema.optional().describe("New title for the current novel (1–120 characters)."),
    summary: NovelSummarySchema.optional().describe("New summary for the current novel (max 2000 characters)."),
}).refine((value) => value.title !== undefined || value.summary !== undefined, {
    message: "至少提供一个更新字段",
});

/**
 * 更新小说基础信息。
 */
export const updateNovelTool: AgentTool<typeof UpdateNovelInputSchema> = {
    key: "update_novel",
    description: "Update the title or summary of the current novel. At least one of title or summary must be provided.",
    schema: UpdateNovelInputSchema,
    async execute(input, context) {
        const novelId = resolveToolNovelId(context);
        const resultData = await updateNovelByTool(prisma, novelId, input);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
