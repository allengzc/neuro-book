import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {
    PlotChapterPathSchema,
    resolvePlotNovelId,
} from "nbook/server/agent/tools/shared/plot-tool-shared";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {plotFacade} from "nbook/server/plot";

const GetChapterPlotInputSchema = z.object({
    chapterPath: PlotChapterPathSchema.describe("Manuscript chapter path, e.g. manuscript/001-opening/."),
});

/**
 * 读取章节对应的剧情视图。
 */
export const getChapterPlotTool: AgentTool<typeof GetChapterPlotInputSchema> = {
    key: "get_chapter_plot",
    description: [
        "Read the scenes and plots attached to a manuscript chapter content-node.",
        "Use manuscript/.../ paths. Database chapter IDs are no longer supported.",
    ].join("\n"),
    schema: GetChapterPlotInputSchema,
    async execute(input, context) {
        const novelId = resolvePlotNovelId(context);
        const resultData = await plotFacade.getChapterPlotDetailDto(novelId, input.chapterPath);
        return createToolResultMessage(resultData, JSON.stringify(input));
    },
};
