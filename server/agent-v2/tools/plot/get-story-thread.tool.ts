import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    clearPlotSceneSelection,
    PlotEntityIdSchema,
    resolvePlotNovelId,
    resolvePlotThreadId,
    syncPlotThreadSelection,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";

const GetStoryThreadInputSchema = z.object({
    threadId: PlotEntityIdSchema.optional().describe("Thread ID. Defaults to the currently selected story thread in the IDE."),
});

/**
 * 读取剧情 Thread 详情。
 */
export const getStoryThreadTool: AgentTool<typeof GetStoryThreadInputSchema> = {
    key: "get_story_thread",
    description: [
        "Read the full detail of a single story thread in the current novel.",
        "When threadId is omitted, defaults to the currently selected story thread in the IDE.",
    ].join("\n"),
    schema: GetStoryThreadInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const threadId = resolvePlotThreadId(context, input.threadId);
        const resultData = await plotFacade.getStoryThreadDetailDto(novelId, threadId);
        syncPlotThreadSelection(context, threadId);
        clearPlotSceneSelection(context);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
