import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    CreateStoryPlotRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";
import {
    getStorySceneContextDto,
    resolvePlotNovelId,
    resolvePlotSceneId,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";

const CreateStoryPlotToolInputSchema = CreateStoryPlotRequestDtoSchema.omit({
    sceneId: true,
}).extend({
    sceneId: z.string().trim().min(1, "sceneId 不能为空").optional().describe("Scene ID to attach this plot to. Defaults to the currently selected story scene in the IDE."),
});

/**
 * 创建剧情 Plot。
 */
export const createStoryPlotTool: AgentTool<typeof CreateStoryPlotToolInputSchema> = {
    key: "create_story_plot",
    description: [
        "Create a new plot under a scene in the current novel.",
        "When sceneId is omitted, the plot is attached to the currently selected story scene in the IDE.",
    ].join("\n"),
    schema: CreateStoryPlotToolInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const sceneId = resolvePlotSceneId(context, input.sceneId);
        const resultData = await plotFacade.createStoryPlot(novelId, {
            ...input,
            sceneId: String(sceneId),
        });
        await getStorySceneContextDto(context, String(sceneId));
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
