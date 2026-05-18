import {parseEntityId, parseNullableEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ParsedCreateStoryPlotInput,
    ParsedCreateStorySceneInput,
    ParsedCreateStoryThreadInput,
    ParsedReorderStoryPhaseItem,
    ParsedReorderStoryPlotItem,
    ParsedReorderStorySceneItem,
    ParsedReorderStoryThreadItem,
    ParsedUpdateStoryPlotInput,
    ParsedUpdateStorySceneInput,
    ParsedUpdateStoryThreadInput,
    ResolvedStoryRefInput,
} from "nbook/server/plot/core/types";
import type {
    CreateStoryPlotRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryPlotsRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    UpdateStoryPlotRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";

/**
 * 剧情模块输入解析器。
 * 负责把 HTTP DTO 转成内部使用的 number/null 结构。
 */
export class PlotInputParser {

    /**
     * 解析线程创建输入。
     */
    parseCreateThread(input: CreateStoryThreadRequestDto): ParsedCreateStoryThreadInput {
        return {
            ...input,
            storyPhaseId: parseNullableEntityId("phaseId", input.storyPhaseId),
        };
    }

    /**
     * 解析线程更新输入。
     */
    parseUpdateThread(input: UpdateStoryThreadRequestDto): ParsedUpdateStoryThreadInput {
        return {
            ...input,
            storyPhaseId: input.storyPhaseId === undefined
                ? undefined
                : parseNullableEntityId("phaseId", input.storyPhaseId),
        };
    }

    /**
     * 解析线程重排输入。
     */
    parseReorderThreads(input: ReorderStoryThreadsRequestDto): ParsedReorderStoryThreadItem[] {
        return input.items.map((item) => ({
            threadId: parseEntityId("threadId", item.threadId),
            storyPhaseId: parseNullableEntityId("phaseId", item.storyPhaseId),
            sortOrder: item.sortOrder,
        }));
    }

    /**
     * 解析阶段重排输入。
     */
    parseReorderPhases(input: ReorderStoryPhasesRequestDto): ParsedReorderStoryPhaseItem[] {
        return input.items.map((item) => ({
            phaseId: parseEntityId("phaseId", item.phaseId),
            sortOrder: item.sortOrder,
        }));
    }

    /**
     * 解析场景创建输入。
     */
    parseCreateScene(
        input: CreateStorySceneRequestDto & {resolvedRefs?: ResolvedStoryRefInput[]},
    ): ParsedCreateStorySceneInput {
        return {
            ...input,
            threadId: parseEntityId("threadId", input.threadId),
            chapterPath: input.chapterPath ?? null,
            refs: input.refs ?? [],
        };
    }

    /**
     * 解析场景更新输入。
     */
    parseUpdateScene(
        input: UpdateStorySceneRequestDto & {resolvedRefs?: ResolvedStoryRefInput[]},
    ): ParsedUpdateStorySceneInput {
        return {
            ...input,
            threadId: input.threadId === undefined ? undefined : parseEntityId("threadId", input.threadId),
            chapterPath: input.chapterPath,
            refs: input.refs,
        };
    }

    /**
     * 解析场景重排输入。
     */
    parseReorderScenes(input: ReorderStoryScenesRequestDto): ParsedReorderStorySceneItem[] {
        return input.items.map((item) => ({
            sceneId: parseEntityId("sceneId", item.sceneId),
            threadId: parseEntityId("threadId", item.threadId),
            chapterPath: item.chapterPath,
            threadSortOrder: item.threadSortOrder,
            chapterSortOrder: item.chapterSortOrder,
        }));
    }

    /**
     * 解析情节点创建输入。
     */
    parseCreatePlot(input: CreateStoryPlotRequestDto): ParsedCreateStoryPlotInput {
        return {
            ...input,
            sceneId: parseEntityId("sceneId", input.sceneId),
        };
    }

    /**
     * 解析情节点更新输入。
     */
    parseUpdatePlot(input: UpdateStoryPlotRequestDto): ParsedUpdateStoryPlotInput {
        return {
            ...input,
            sceneId: input.sceneId === undefined ? undefined : parseEntityId("sceneId", input.sceneId),
        };
    }

    /**
     * 解析情节点重排输入。
     */
    parseReorderPlots(input: ReorderStoryPlotsRequestDto): ParsedReorderStoryPlotItem[] {
        return input.items.map((item) => ({
            plotId: parseEntityId("plotId", item.plotId),
            sceneId: parseEntityId("sceneId", item.sceneId),
            sortOrder: item.sortOrder,
        }));
    }
}
