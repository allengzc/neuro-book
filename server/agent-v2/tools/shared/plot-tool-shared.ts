import {z} from "zod";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {resolveToolNovelId} from "nbook/server/agent/tools/shared/novel-tool-shared";
import {plotFacade} from "nbook/server/plot";
import {parseEntityId, stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterPlotDetailDto,
    StorySceneDetailDto,
    StoryThreadDetailDto,
} from "nbook/shared/dto/plot.dto";

export const PlotEntityIdSchema = z.string().trim().min(1, "ID 不能为空").describe("Entity ID string (e.g. \"threadId:1\", \"sceneId:5\").");
export const PlotChapterPathSchema = z.string().trim().min(1, "chapterPath 不能为空").describe("Manuscript chapter content-node path, e.g. manuscript/001-opening/.");

type PlotSelectionKey = "selectedStoryThreadId" | "selectedStorySceneId";

/**
 * 读取当前线程中的 plot 小说作用域。
 */
export function resolvePlotNovelId(context: AgentToolContext): number {
    return resolveToolNovelId(context);
}

/**
 * 从 studio.extra 中读取当前选中的 plot 对象 ID。
 */
function readSelectedPlotEntityId(context: AgentToolContext, key: PlotSelectionKey): number | null {
    const value = context.getScope().studio.extra[key];
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`scope.studio.${key} 非法，必须是字符串 ID`);
    }
    return parseEntityId(key === "selectedStoryThreadId" ? "threadId" : "sceneId", value);
}

/**
 * 解析 Thread ID。若未显式提供，则回退到当前选中的 Thread。
 */
export function resolvePlotThreadId(context: AgentToolContext, threadId?: string): number {
    if (threadId !== undefined) {
        return parseEntityId("threadId", threadId);
    }

    const selectedThreadId = readSelectedPlotEntityId(context, "selectedStoryThreadId");
    if (selectedThreadId === null) {
        throw new Error("当前线程缺少已选中的剧情线程，请显式提供 threadId");
    }
    return selectedThreadId;
}

/**
 * 解析 Scene ID。若未显式提供，则回退到当前选中的 Scene。
 */
export function resolvePlotSceneId(context: AgentToolContext, sceneId?: string): number {
    if (sceneId !== undefined) {
        return parseEntityId("sceneId", sceneId);
    }

    const selectedSceneId = readSelectedPlotEntityId(context, "selectedStorySceneId");
    if (selectedSceneId === null) {
        throw new Error("当前线程缺少已选中的剧情场景，请显式提供 sceneId");
    }
    return selectedSceneId;
}

/**
 * 将当前 Thread 焦点写回运行时 scope。
 */
export function syncPlotThreadSelection(context: AgentToolContext, threadId: number): void {
    context.setStudio({
        selectedStoryThreadId: stringifyEntityId(threadId),
    });
}

/**
 * 将当前 Scene 焦点写回运行时 scope。
 */
export function syncPlotSceneSelection(context: AgentToolContext, input: {threadId: number; sceneId: number}): void {
    context.setStudio({
        selectedStoryThreadId: stringifyEntityId(input.threadId),
        selectedStorySceneId: stringifyEntityId(input.sceneId),
    });
}

/**
 * 清空当前 Scene 焦点。
 */
export function clearPlotSceneSelection(context: AgentToolContext): void {
    context.setStudio({
        selectedStorySceneId: null,
    });
}

export type StorySceneContextDto = {
    thread: StoryThreadDetailDto;
    scene: StorySceneDetailDto;
    // 为空表示该 Scene 尚未挂入章节。
    chapterPlot: ChapterPlotDetailDto | null;
};

/**
 * 读取 Scene 工作上下文。
 */
export async function getStorySceneContextDto(context: AgentToolContext, sceneId?: string): Promise<StorySceneContextDto> {
    const novelId = resolvePlotNovelId(context);
    const resolvedSceneId = resolvePlotSceneId(context, sceneId);
    const scene = await plotFacade.getStorySceneDetailDto(novelId, resolvedSceneId);
    const [thread, chapterPlot] = await Promise.all([
        plotFacade.getStoryThreadDetailDto(novelId, parseEntityId("threadId", scene.threadId)),
        scene.chapterPath ? plotFacade.getChapterPlotDetailDto(novelId, scene.chapterPath) : Promise.resolve(null),
    ]);
    syncPlotSceneSelection(context, {
        threadId: parseEntityId("threadId", scene.threadId),
        sceneId: resolvedSceneId,
    });

    return {
        thread,
        scene,
        chapterPlot,
    };
}
