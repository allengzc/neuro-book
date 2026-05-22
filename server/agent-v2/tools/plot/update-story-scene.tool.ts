import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    UpdateStorySceneRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";
import {
    PlotEntityIdSchema,
    resolvePlotNovelId,
    resolvePlotSceneId,
    resolvePlotThreadId,
    syncPlotSceneSelection,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

const UpdateStorySceneToolInputSchema = UpdateStorySceneRequestDtoSchema.extend({
    sceneId: PlotEntityIdSchema.optional().describe("Scene ID to update. Defaults to the currently selected story scene in the IDE."),
});

/**
 * 更新剧情 Scene。
 */
export const updateStorySceneTool: AgentTool<typeof UpdateStorySceneToolInputSchema> = {
    key: "update_story_scene",
    description: [
        "Update a story scene in the current novel.",
        "When sceneId is omitted, defaults to the currently selected story scene in the IDE.",
        "Use chapterPath with manuscript/.../ paths when attaching a scene to manuscript order. Database chapter IDs are no longer supported.",
        "For refs to lore/settings, use workspace content-node paths such as lorebook/location/foo/. Do not use lorebook:// or pending://.",
    ].join("\n"),
    schema: UpdateStorySceneToolInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const sceneId = resolvePlotSceneId(context, input.sceneId);
        const {sceneId: _sceneId, threadId, ...restPatch} = input;
        const resultData = await plotFacade.updateStoryScene(novelId, sceneId, {
            ...restPatch,
            threadId: threadId === undefined ? undefined : String(resolvePlotThreadId(context, threadId)),
        });
        syncPlotSceneSelection(context, {
            threadId: parseEntityId("threadId", resultData.threadId),
            sceneId: parseEntityId("sceneId", resultData.id),
        });
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
