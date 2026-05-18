import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    UpdateStoryThreadRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";
import {
    PlotEntityIdSchema,
    resolvePlotNovelId,
    resolvePlotThreadId,
    syncPlotThreadSelection,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";

const UpdateStoryThreadToolInputSchema = UpdateStoryThreadRequestDtoSchema.extend({
    threadId: PlotEntityIdSchema.optional().describe("Thread ID to update. Defaults to the currently selected story thread in the IDE."),
});

/**
 * 更新剧情 Thread。
 */
export const updateStoryThreadTool: AgentTool<typeof UpdateStoryThreadToolInputSchema> = {
    key: "update_story_thread",
    description: [
        "Update a story thread in the current novel.",
        "When threadId is omitted, defaults to the currently selected story thread in the IDE.",
    ].join("\n"),
    schema: UpdateStoryThreadToolInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const threadId = resolvePlotThreadId(context, input.threadId);
        const {threadId: _threadId, ...patch} = input;
        const resultData = await plotFacade.updateStoryThread(novelId, threadId, patch);
        syncPlotThreadSelection(context, threadId);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
