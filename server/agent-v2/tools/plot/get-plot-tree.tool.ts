import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {resolvePlotNovelId} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";

const GetPlotTreeInputSchema = z.object({});

/**
 * 返回当前小说的剧情树。
 */
export const getPlotTreeTool: AgentTool<typeof GetPlotTreeInputSchema> = {
    key: "get_plot_tree",
    description: "Return the plot tree for the current novel, including Story, Phase, Thread, Scene, and statistics. This tool takes no arguments.",
    schema: GetPlotTreeInputSchema,
    async execute(_input, context) {
        const novelId = resolvePlotNovelId(context);
        const resultData = await plotFacade.getPlotTree(novelId);
        return createToolResultMessage(resultData, "{}");
    },
};
