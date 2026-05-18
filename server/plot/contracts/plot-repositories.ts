import type {
    Novel,
    Story,
    StoryPhase,
    StoryPlot,
    StoryScene,
    StoryThread,
} from "nbook/server/generated/prisma/client";
import type {
    ChapterPlotSceneWithThread,
    ResolvedStoryRefInput,
    StorySceneWithDetails,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";

/**
 * Story 仓储接口。
 */
export interface StoryRepository {
    findStoryByNovelId(novelId: number): Promise<Story | null>;
    upsertStoryForNovel(input: {novelId: number; title: string; summary: string}): Promise<Story>;
    updateStory(storyId: number, data: Partial<Pick<Story, "title" | "summary" | "note">>): Promise<Story>;
    findPhaseById(phaseId: number): Promise<StoryPhase | null>;
    findPhasesByStory(storyId: number): Promise<StoryPhase[]>;
    findPhaseIdsByStory(storyId: number): Promise<number[]>;
    createPhase(input: {storyId: number; sortOrder: number; name: string; title: string; summary: string; note: string | null}): Promise<StoryPhase>;
    updatePhase(phaseId: number, data: Partial<Pick<StoryPhase, "name" | "title" | "summary" | "note" | "sortOrder">>): Promise<StoryPhase>;
    deletePhase(phaseId: number): Promise<void>;
    findPhaseByName(storyId: number, name: string, excludePhaseId?: number): Promise<StoryPhase | null>;
}

/**
 * Thread 仓储接口。
 */
export interface ThreadRepository {
    findThreadById(threadId: number): Promise<StoryThread | null>;
    findThreadWithScenesById(threadId: number): Promise<StoryThreadWithScenes | null>;
    findThreadIdsByStory(storyId: number): Promise<number[]>;
    findThreadsByStoryPhase(storyId: number, storyPhaseId: number | null): Promise<StoryThread[]>;
    findThreadByName(storyId: number, name: string, excludeThreadId?: number): Promise<StoryThread | null>;
    createThread(input: {
        storyId: number;
        storyPhaseId: number | null;
        sortOrder: number;
        name: string;
        title: string;
        isMainThread: boolean;
        status: StoryThread["status"];
        summary: string;
        tags: string[];
        writingTip: string | null;
        note: string | null;
    }): Promise<StoryThread>;
    updateThread(threadId: number, data: Partial<Pick<
        StoryThread,
        "storyPhaseId" | "sortOrder" | "name" | "title" | "isMainThread" | "status" | "summary" | "tags" | "writingTip" | "note"
    >>): Promise<StoryThread>;
    deleteThread(threadId: number): Promise<void>;
    findThreadTargetByName(storyId: number, name: string): Promise<Pick<StoryThread, "id" | "name"> | null>;
    findUngroupedThreads(storyId: number): Promise<Array<StoryThread & {scenes: StoryScene[]}>>;
    findPhaseThreadsWithScenes(storyId: number): Promise<Array<StoryPhase & {threads: Array<StoryThread & {scenes: StoryScene[]}>}>>;
    findUngroupedWorkbenchThreads(storyId: number): Promise<StoryWorkbenchThread[]>;
    findWorkbenchPhaseThreads(storyId: number): Promise<StoryWorkbenchPhase[]>;
}

/**
 * Scene 仓储接口。
 */
export interface SceneRepository {
    findSceneById(sceneId: number): Promise<StoryScene | null>;
    findSceneWithDetailsById(sceneId: number): Promise<StorySceneWithDetails | null>;
    findChapterScenesWithPlots(chapterPath: string): Promise<ChapterPlotSceneWithThread[]>;
    findSceneIdsByStory(storyId: number): Promise<number[]>;
    createScene(input: {
        storyId: number;
        threadId: number;
        chapterPath: string | null;
        threadSortOrder: number;
        chapterSortOrder: number | null;
        title: string;
        status: StoryScene["status"];
        summary: string;
        purpose: string | null;
        writingTip: string | null;
        note: string | null;
    }): Promise<StoryScene>;
    updateScene(sceneId: number, data: Partial<Pick<
        StoryScene,
        "threadId" | "chapterPath" | "threadSortOrder" | "chapterSortOrder" | "title" | "status" | "summary" | "purpose" | "writingTip" | "note"
    >>): Promise<StoryScene>;
    deleteScene(sceneId: number): Promise<void>;
    replaceRefs(sceneId: number, refs: ResolvedStoryRefInput[]): Promise<void>;
    findScenesByThread(threadId: number): Promise<Pick<StoryScene, "id" | "threadSortOrder">[]>;
    findScenesByChapter(chapterPath: string): Promise<Pick<StoryScene, "id" | "chapterSortOrder">[]>;
}

/**
 * Plot 仓储接口。
 */
export interface PlotRepository {
    findPlotById(plotId: number): Promise<StoryPlot | null>;
    findPlotByIdWithStory(plotId: number): Promise<(StoryPlot & {scene: Pick<StoryScene, "storyId">}) | null>;
    findPlotIdsByStory(storyId: number): Promise<number[]>;
    createPlot(input: {
        sceneId: number;
        sortOrder: number;
        kind: StoryPlot["kind"];
        summary: string;
        effect: string | null;
        writingTip: string | null;
        note: string | null;
    }): Promise<StoryPlot>;
    updatePlot(plotId: number, data: Partial<Pick<
        StoryPlot,
        "sceneId" | "sortOrder" | "kind" | "summary" | "effect" | "writingTip" | "note"
    >>): Promise<StoryPlot>;
    deletePlot(plotId: number): Promise<void>;
    findPlotsByScene(sceneId: number): Promise<Pick<StoryPlot, "id" | "sortOrder">[]>;
    lockPlotOrderBucket(sceneId: number): Promise<void>;
    countPlotsByStory(storyId: number): Promise<number>;
}

/**
 * 辅助查询仓储接口。
 */
export interface PlotLookupRepository {
    findNovelById(novelId: number): Promise<Pick<Novel, "id" | "title" | "summary" | "workspaceSlug"> | null>;
}
