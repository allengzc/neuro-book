import type {Prisma} from "nbook/server/generated/project-prisma/client";
import type {
    StoryAct,
    StoryChapter,
    StoryPhase,
    StoryScene,
    StorySceneRef,
    StoryThread,
} from "nbook/server/generated/project-prisma/client";
import type {
    CreateStoryActRequestDto,
    CreateStoryChapterRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    StoryRefDto,
    UpdateStoryActRequestDto,
    UpdateStoryChapterRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";
import type {Instant} from "nbook/server/world-engine/types";

/**
 * 剧情模块可用的 Prisma 执行器。
 */
export type PrismaExecutor = Prisma.TransactionClient | {
    story: Prisma.TransactionClient["story"];
    storyAct: Prisma.TransactionClient["storyAct"];
    storyChapter: Prisma.TransactionClient["storyChapter"];
    storyPhase: Prisma.TransactionClient["storyPhase"];
    storyThread: Prisma.TransactionClient["storyThread"];
    storyScene: Prisma.TransactionClient["storyScene"];
    storySceneRef: Prisma.TransactionClient["storySceneRef"];
    $executeRaw: Prisma.TransactionClient["$executeRaw"];
    $executeRawUnsafe: Prisma.TransactionClient["$executeRawUnsafe"];
};

/**
 * Scene 与 World Engine 的桥接锚点。
 */
export type SceneWorldAnchor = {
    // `null` 表示 Scene 尚未连接 World Engine 起点。
    startInstant: Instant | null;
    // `null` 表示 Scene 尚未连接 World Engine 终点。
    endInstant: Instant | null;
    subjectIds: string[];
    // `null` 表示 Scene 没有指定地点 subject。
    locationSubjectId: string | null;
};

/**
 * Scene ref 查询结果。
 */
export type StorySceneRefWithTargets = StorySceneRef & {
    targetThread: Pick<StoryThread, "id" | "name"> | null;
    targetScene: Pick<StoryScene, "id"> | null;
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
 * Scene 上内嵌的 Chapter 轻量引用。
 */
export type StoryChapterRef = Pick<StoryChapter, "id" | "name" | "title">;

/**
 * 带所属 Chapter 摘要的 Scene 读取模型;`chapter` 为空表示 Scene 未挂章。
 */
export type StorySceneWithChapter = StoryScene & {
    chapter: StoryChapterRef | null;
};

/**
 * ChapterBrief 的数据库列展开(StoryChapter 上的 brief* 字段组)。
 */
export type ChapterBriefColumns = Pick<
    StoryChapter,
    "briefGoal" | "briefPov" | "briefTone" | "briefPacing"
    | "briefReaderKnows" | "briefProtagonistKnows" | "briefMustHide" | "briefHintOnly"
    | "briefOpening" | "briefEnding" | "briefDoNotWrite"
>;

/**
 * 带 Chapter 的 Act 聚合结果(承载树节点)。
 */
export type StoryActWithChapters = StoryAct & {
    chapters: StoryChapter[];
};

/**
 * Thread 详情聚合结果，不包含 refs。
 */
export type StoryThreadWithScenes = StoryThreadEntity & {
    scenes: StorySceneWithChapter[];
};

/**
 * Scene 详情聚合结果。
 */
export type StorySceneWithDetails = StorySceneWithChapter & {
    refs: StorySceneRefWithTargets[];
    thread: StoryThreadEntity;
};

/**
 * Workbench Scene 聚合结果。
 */
export type StoryWorkbenchScene = StorySceneWithChapter & {
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
    thread: Pick<StoryThread, "id" | "title" | "isMainThread">;
};

/**
 * Chapter writer brief 专用 Scene read model。带 refs 以便编译「建议读取」。
 */
export type ChapterWriterBriefSceneWithThread = StoryScene & {
    thread: Pick<StoryThread, "id" | "title" | "isMainThread" | "summary" | "writingTip">;
    refs: StorySceneRefWithTargets[];
};

/**
 * Act 创建输入。
 */
export type ParsedCreateStoryActInput = CreateStoryActRequestDto;

/**
 * Act 更新输入。
 */
export type ParsedUpdateStoryActInput = UpdateStoryActRequestDto;

/**
 * Chapter 创建输入。
 */
export type ParsedCreateStoryChapterInput = Omit<CreateStoryChapterRequestDto, "actId"> & {
    // `actId` 为 null 表示创建未归卷章节。
    actId: number | null;
};

/**
 * Chapter 更新输入。
 */
export type ParsedUpdateStoryChapterInput = Omit<UpdateStoryChapterRequestDto, "actId"> & {
    // `actId` 为 undefined 表示不修改;null 表示移动到未归卷区。
    actId?: number | null;
};

/**
 * 解析后的引用写入结构。
 */
export type ResolvedStoryRefInput = {
    sortOrder: number;
    relation: string;
    rawTarget: string;
    targetKind: "content" | "thread" | "scene";
    targetThreadId: number | null;
    targetSceneId: number | null;
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
    chapterId: number | null;
    threadSortOrder: number;
    chapterSortOrder: number | null;
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
export type ParsedCreateStorySceneInput = Omit<CreateStorySceneRequestDto, "threadId" | "chapterId" | "refs" | "worldAnchor"> & {
    threadId: number;
    chapterId: number | null;
    refs: StoryRefDto[];
    // `resolvedRefs` 非空表示内容层已经完成目标存在性校验，可直接写库。
    resolvedRefs?: ResolvedStoryRefInput[];
    worldAnchor: SceneWorldAnchor;
};

/**
 * 场景更新输入。
 */
export type ParsedUpdateStorySceneInput = Omit<UpdateStorySceneRequestDto, "threadId" | "chapterId" | "refs" | "worldAnchor"> & {
    // `threadId` 为 undefined 表示不修改所属线程。
    threadId?: number;
    // `chapterId` 为 undefined 表示不修改；null 表示从章节顺序中移除。
    chapterId?: number | null;
    refs?: StoryRefDto[];
    // `resolvedRefs` 非空表示内容层已经完成目标存在性校验，可直接写库。
    resolvedRefs?: ResolvedStoryRefInput[];
    // `worldAnchor` 为 undefined 表示不修改 World Engine 桥接锚点。
    worldAnchor?: SceneWorldAnchor;
};

export type ReorderStoryPhaseItem = ReorderStoryPhasesRequestDto["items"][number];
export type ReorderStoryThreadItem = ReorderStoryThreadsRequestDto["items"][number];
export type ReorderStorySceneItem = ReorderStoryScenesRequestDto["items"][number];
