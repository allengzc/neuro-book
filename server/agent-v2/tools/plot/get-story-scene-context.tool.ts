import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {getStorySceneContextDto, PlotEntityIdSchema} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const GetStorySceneContextInputSchema = z.object({
    sceneId: PlotEntityIdSchema.optional().describe("Scene ID. Defaults to the currently selected story scene in the IDE."),
});

/**
 * 读取 Scene 的组合上下文。
 */
export const getStorySceneContextTool: AgentTool<typeof GetStorySceneContextInputSchema> = {
    key: "get_story_scene_context",
    description: [
        "Read the working context for a story scene.",
        "Returns the scene, its parent thread, and the chapter plot view for the chapter containing this scene.",
        "When sceneId is omitted, defaults to the currently selected story scene in the IDE.",
    ].join("\n"),
    schema: GetStorySceneContextInputSchema,
    async execute(input, context) {
        const resultData = await getStorySceneContextDto(context, input.sceneId);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
