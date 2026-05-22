import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    CreateStorySceneRequestDtoSchema,
} from "nbook/shared/dto/plot.dto";
import {
    resolvePlotNovelId,
    resolvePlotThreadId,
    syncPlotSceneSelection,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

const CreateStorySceneToolInputSchema = CreateStorySceneRequestDtoSchema.omit({
    threadId: true,
}).extend({
    threadId: z.string().trim().min(1, "threadId 不能为空").optional().describe("Thread ID to attach this scene to. Defaults to the currently selected story thread in the IDE."),
});

/**
 * 创建剧情 Scene。
 */
export const createStorySceneTool: AgentTool<typeof CreateStorySceneToolInputSchema> = {
    key: "create_story_scene",
    description: [
        "Create a new story scene in the current novel.",
        "When threadId is omitted, the scene is attached to the currently selected story thread in the IDE.",
        "Use chapterPath with manuscript/.../ paths when attaching a scene to manuscript order. Database chapter IDs are no longer supported.",
        "For refs to lore/settings, use workspace content-node paths such as lorebook/location/foo/. Do not use lorebook:// or pending://.",
    ].join("\n"),
    schema: CreateStorySceneToolInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const threadId = resolvePlotThreadId(context, input.threadId);
        const resultData = await plotFacade.createStoryScene(novelId, {
            ...input,
            threadId: String(threadId),
        });
        syncPlotSceneSelection(context, {
            threadId: parseEntityId("threadId", resultData.threadId),
            sceneId: parseEntityId("sceneId", resultData.id),
        });
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
