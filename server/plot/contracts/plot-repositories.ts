import type {
    Story,
    StoryAct,
    StoryChapter,
    StoryPhase,
    StoryScene,
    StoryThread,
} from "nbook/server/generated/project-prisma/client";
import type {
    ChapterBriefColumns,
    ChapterPlotSceneWithThread,
    ChapterWriterBriefSceneWithThread,
    ResolvedStoryRefInput,
    StoryActWithChapters,
    StoryThreadEntity,
    StorySceneWithChapter,
    StorySceneWithDetails,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";

/**
 * Story 仓储接口。
 */
export interface StoryRepository {
    findStory(): Promise<Story | null>;
    createStory(input: {title: string; summary: string}): Promise<Story>;
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
    findThreadById(threadId: number): Promise<StoryThreadEntity | null>;
    findThreadWithScenesById(threadId: number): Promise<StoryThreadWithScenes | null>;
    findThreadIdsByStory(storyId: number): Promise<number[]>;
    findThreadsByStoryPhase(storyId: number, storyPhaseId: number | null): Promise<StoryThreadEntity[]>;
    findThreadByName(storyId: number, name: string, excludeThreadId?: number): Promise<StoryThreadEntity | null>;
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
    }): Promise<StoryThreadEntity>;
    updateThread(threadId: number, data: Partial<Pick<
        StoryThread,
        "storyPhaseId" | "sortOrder" | "name" | "title" | "isMainThread" | "status" | "summary" | "writingTip" | "note"
    >> & {tags?: string[]}): Promise<StoryThreadEntity>;
    deleteThread(threadId: number): Promise<void>;
    findThreadTargetByName(storyId: number, name: string): Promise<Pick<StoryThread, "id" | "name"> | null>;
    findUngroupedThreads(storyId: number): Promise<Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>>;
    findPhaseThreadsWithScenes(storyId: number): Promise<Array<StoryPhase & {threads: Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>}>>;
    findUngroupedWorkbenchThreads(storyId: number): Promise<StoryWorkbenchThread[]>;
    findWorkbenchPhaseThreads(storyId: number): Promise<StoryWorkbenchPhase[]>;
}

/**
 * Act / Chapter(承载树)仓储接口。
 */
export interface ChapterRepository {
    findActById(actId: number): Promise<StoryAct | null>;
    findActsByStory(storyId: number): Promise<StoryAct[]>;
    findActByName(storyId: number, name: string, excludeActId?: number): Promise<StoryAct | null>;
    findActsWithChapters(storyId: number): Promise<StoryActWithChapters[]>;
    createAct(input: {storyId: number; sortOrder: number; name: string; title: string; summary: string; note: string | null}): Promise<StoryAct>;
    updateAct(actId: number, data: Partial<Pick<StoryAct, "name" | "title" | "summary" | "note" | "sortOrder">>): Promise<StoryAct>;
    deleteAct(actId: number): Promise<void>;
    findChapterById(chapterId: number): Promise<StoryChapter | null>;
    findChaptersByStory(storyId: number): Promise<StoryChapter[]>;
    findUngroupedChapters(storyId: number): Promise<StoryChapter[]>;
    findChapterByName(storyId: number, name: string, excludeChapterId?: number): Promise<StoryChapter | null>;
    createChapter(input: {storyId: number; actId: number | null; sortOrder: number; name: string; title: string; note: string | null} & Partial<ChapterBriefColumns>): Promise<StoryChapter>;
    updateChapter(chapterId: number, data: Partial<Pick<StoryChapter, "actId" | "sortOrder" | "name" | "title" | "note">> & Partial<ChapterBriefColumns>): Promise<StoryChapter>;
    deleteChapter(chapterId: number): Promise<void>;
}

/**
 * Scene 仓储接口。
 */
export interface SceneRepository {
    findSceneById(sceneId: number): Promise<StoryScene | null>;
    findSceneWithDetailsById(sceneId: number): Promise<StorySceneWithDetails | null>;
    findChapterScenes(chapterId: number): Promise<ChapterPlotSceneWithThread[]>;
    findChapterScenesForBrief(chapterId: number): Promise<ChapterWriterBriefSceneWithThread[]>;
    findSceneIdsByStory(storyId: number): Promise<number[]>;
    createScene(input: {
        storyId: number;
        threadId: number;
        chapterId: number | null;
        threadSortOrder: number;
        chapterSortOrder: number | null;
        title: string;
        status: StoryScene["status"];
        summary: string;
        purpose: string | null;
        writingTip: string | null;
        note: string | null;
        startInstant: bigint | null;
        endInstant: bigint | null;
        subjectIdsJson: string;
        locationSubjectId: string | null;
    }): Promise<StoryScene>;
    updateScene(sceneId: number, data: Partial<Pick<
        StoryScene,
        "threadId" | "chapterId" | "threadSortOrder" | "chapterSortOrder" | "title" | "status" | "summary" | "purpose" | "writingTip" | "note" | "startInstant" | "endInstant" | "subjectIdsJson" | "locationSubjectId"
    >>): Promise<StoryScene>;
    deleteScene(sceneId: number): Promise<void>;
    replaceRefs(sceneId: number, refs: ResolvedStoryRefInput[]): Promise<void>;
    findScenesByThread(threadId: number): Promise<Pick<StoryScene, "id" | "threadSortOrder">[]>;
    findScenesByChapter(chapterId: number): Promise<Pick<StoryScene, "id" | "chapterSortOrder">[]>;
}
