import type {Prisma} from "nbook/server/generated/project-prisma/client";
import type {
    StoryPhase,
    StoryPlot,
    StoryScene,
    StorySceneRef,
    StoryThread,
} from "nbook/server/generated/project-prisma/client";
import type {
    CreateStoryPlotRequestDto,
    CreateStoryPlotsRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryPlotsRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    StoryRefDto,
    UpdateStoryPlotRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";

/**
 * 剧情模块可用的 Prisma 执行器。
 */
export type PrismaExecutor = Prisma.TransactionClient | {
    story: Prisma.TransactionClient["story"];
    storyPhase: Prisma.TransactionClient["storyPhase"];
    storyThread: Prisma.TransactionClient["storyThread"];
    storyScene: Prisma.TransactionClient["storyScene"];
    storyPlot: Prisma.TransactionClient["storyPlot"];
    storySceneRef: Prisma.TransactionClient["storySceneRef"];
    $executeRaw: Prisma.TransactionClient["$executeRaw"];
    $executeRawUnsafe: Prisma.TransactionClient["$executeRawUnsafe"];
};

/**
 * Scene ref 查询结果。
 */
export type StorySceneRefWithTargets = StorySceneRef & {
    targetThread: Pick<StoryThread, "id" | "name"> | null;
    targetScene: Pick<StoryScene, "id"> | null;
    targetPlot: Pick<StoryPlot, "id"> | null;
};

/**
 * Plot 层对外使用的 Thread 实体。
 *
 * 数据库中 `tags` 使用 JSON array 文本以兼容 SQLite/Postgres；进入 Plot
 * service 后统一归一化为 string[]，避免 DTO 和前端感知持久化差异。
 */
export type StoryThreadEntity = Omit<StoryThread, "tags"> & {
    tags: string[];
};

/**
 * Thread 详情聚合结果，不包含 refs。
 */
export type StoryThreadWithScenes = StoryThreadEntity & {
    scenes: StoryScene[];
};

/**
 * Scene 详情聚合结果。
 */
export type StorySceneWithDetails = StoryScene & {
    plots: StoryPlot[];
    refs: StorySceneRefWithTargets[];
    thread: StoryThreadEntity;
};

/**
 * Workbench Scene 聚合结果。
 */
export type StoryWorkbenchScene = StoryScene & {
    plots: StoryPlot[];
    refs: StorySceneRefWithTargets[];
};

/**
 * Workbench Thread 聚合结果。
 */
export type StoryWorkbenchThread = StoryThreadEntity & {
    scenes: StoryWorkbenchScene[];
};

/**
 * Workbench Phase 聚合结果。
 */
export type StoryWorkbenchPhase = StoryPhase & {
    threads: StoryWorkbenchThread[];
};

/**
 * 章节剧情详情聚合结果。
 */
export type ChapterPlotSceneWithThread = StoryScene & {
    plots: StoryPlot[];
    thread: Pick<StoryThread, "id" | "title" | "isMainThread">;
};

/**
 * 解析后的引用写入结构。
 */
export type ResolvedStoryRefInput = {
    sortOrder: number;
    relation: string;
    rawTarget: string;
    targetKind: "content" | "thread" | "scene" | "plot";
    targetThreadId: number | null;
    targetSceneId: number | null;
    targetPlotId: number | null;
    visibility: StoryRefDto["visibility"];
    // `note` 为空表示该引用没有额外备注。
    note: string | null;
};

/**
 * 剧情阶段重排项。
 */
export type ParsedReorderStoryPhaseItem = {
    phaseId: number;
    sortOrder: number;
};

/**
 * 剧情线程重排项。
 */
export type ParsedReorderStoryThreadItem = {
    threadId: number;
    storyPhaseId: number | null;
    sortOrder: number;
};

/**
 * 剧情场景重排项。
 */
export type ParsedReorderStorySceneItem = {
    sceneId: number;
    threadId: number;
    chapterPath: string | null;
    threadSortOrder: number;
    chapterSortOrder: number | null;
};

/**
 * 情节点重排项。
 */
export type ParsedReorderStoryPlotItem = {
    plotId: number;
    sceneId: number;
    sortOrder: number;
};

/**
 * 线程创建输入。
 */
export type ParsedCreateStoryThreadInput = Omit<CreateStoryThreadRequestDto, "storyPhaseId"> & {
    storyPhaseId: number | null;
};

/**
 * 线程更新输入。
 */
export type ParsedUpdateStoryThreadInput = Omit<UpdateStoryThreadRequestDto, "storyPhaseId"> & {
    // `storyPhaseId` 为 undefined 表示不修改；null 表示移动到未分组。
    storyPhaseId?: number | null;
};

/**
 * 场景创建输入。
 */
export type ParsedCreateStorySceneInput = Omit<CreateStorySceneRequestDto, "threadId" | "chapterPath" | "refs"> & {
    threadId: number;
    chapterPath: string | null;
    refs: StoryRefDto[];
    // `resolvedRefs` 非空表示内容层已经完成目标存在性校验，可直接写库。
    resolvedRefs?: ResolvedStoryRefInput[];
};

/**
 * 场景更新输入。
 */
export type ParsedUpdateStorySceneInput = Omit<UpdateStorySceneRequestDto, "threadId" | "chapterPath" | "refs"> & {
    // `threadId` 为 undefined 表示不修改所属线程。
    threadId?: number;
    // `chapterPath` 为 undefined 表示不修改；null 表示从章节顺序中移除。
    chapterPath?: string | null;
    refs?: StoryRefDto[];
    // `resolvedRefs` 非空表示内容层已经完成目标存在性校验，可直接写库。
    resolvedRefs?: ResolvedStoryRefInput[];
};

/**
 * 情节点创建输入。
 */
export type ParsedCreateStoryPlotInput = Omit<CreateStoryPlotRequestDto, "sceneId"> & {
    sceneId: number;
};

/**
 * 情节点批量创建输入。
 */
export type ParsedCreateStoryPlotsInput = Omit<CreateStoryPlotsRequestDto, "sceneId"> & {
    sceneId: number;
};

/**
 * 情节点更新输入。
 */
export type ParsedUpdateStoryPlotInput = Omit<UpdateStoryPlotRequestDto, "sceneId"> & {
    // `sceneId` 为 undefined 表示不修改所属 Scene。
    sceneId?: number;
};

export type ReorderStoryPhaseItem = ReorderStoryPhasesRequestDto["items"][number];
export type ReorderStoryThreadItem = ReorderStoryThreadsRequestDto["items"][number];
export type ReorderStorySceneItem = ReorderStoryScenesRequestDto["items"][number];
export type ReorderStoryPlotItem = ReorderStoryPlotsRequestDto["items"][number];
