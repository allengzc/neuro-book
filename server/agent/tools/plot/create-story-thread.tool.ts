import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    CreateStoryThreadRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";
import {
    clearPlotSceneSelection,
    resolvePlotNovelId,
    syncPlotThreadSelection,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

/**
 * 创建剧情 Thread。
 */
export const createStoryThreadTool: AgentTool<typeof CreateStoryThreadRequestDtoSchema> = {
    key: "create_story_thread",
    description: "Create a new story thread in the current novel and return the full Thread detail.",
    schema: CreateStoryThreadRequestDtoSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const resultData = await plotFacade.createStoryThread(novelId, input);
        syncPlotThreadSelection(context, parseEntityId("threadId", resultData.id));
        clearPlotSceneSelection(context);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
