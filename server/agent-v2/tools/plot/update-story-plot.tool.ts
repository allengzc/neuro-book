import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    UpdateStoryPlotRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";
import {
    PlotEntityIdSchema,
    getStorySceneContextDto,
    resolvePlotNovelId,
    resolvePlotSceneId,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

const UpdateStoryPlotToolInputSchema = UpdateStoryPlotRequestDtoSchema.extend({
    plotId: PlotEntityIdSchema.describe("Plot ID to update. Required."),
});

/**
 * 更新剧情 Plot。
 */
export const updateStoryPlotTool: AgentTool<typeof UpdateStoryPlotToolInputSchema> = {
    key: "update_story_plot",
    description: "Update a plot in the current novel. plotId is required; sceneId is optional and can be used to move the plot to a different scene.",
    schema: UpdateStoryPlotToolInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const plotId = parseEntityId("plotId", input.plotId);
        const {plotId: _plotId, sceneId, ...patch} = input;
        const resultData = await plotFacade.updateStoryPlot(novelId, plotId, {
            ...patch,
            sceneId: sceneId === undefined ? undefined : String(resolvePlotSceneId(context, sceneId)),
        });
        await getStorySceneContextDto(context, resultData.sceneId);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
