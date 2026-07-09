import {z} from "zod";
import {
    withWriteDiagnosticsSchema,
} from "nbook/shared/dto/write-response";
import {
    MAX_REFERENCE_COUNT,
    MAX_REFERENCE_NOTE_LENGTH,
    MAX_REFERENCE_RELATION_LENGTH,
    MAX_REFERENCE_TARGET_LENGTH,
    ReferenceVisibilitySchema,
    StoryStructuredReferenceKindSchema,
    StructuredReferenceDtoSchema,
} from "nbook/shared/reference-core";

export const MAX_STORY_NAME_LENGTH = 120;
export const MAX_STORY_TITLE_LENGTH = 120;
export const MAX_STORY_SUMMARY_LENGTH = 5_000;
export const MAX_STORY_NOTE_LENGTH = 5_000;
export const MAX_STORY_TIP_LENGTH = 2_000;
export const MAX_STORY_RELATION_LENGTH = MAX_REFERENCE_RELATION_LENGTH;
export const MAX_STORY_TARGET_LENGTH = MAX_REFERENCE_TARGET_LENGTH;
export const MAX_STORY_TAG_LENGTH = 120;
export const MAX_STORY_TAG_COUNT = 50;
export const MAX_STORY_REFS_COUNT = MAX_REFERENCE_COUNT;
export const MAX_STORY_SCENE_SUBJECT_COUNT = 100;

const NonEmptyStringSchema = z.string().trim().min(1, "不能为空");
const StoryNameSchema = z.string()
    .trim()
    .min(1, "name 不能为空")
    .max(MAX_STORY_NAME_LENGTH, "name 过长")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "name 仅允许小写字母、数字和中划线");
const StoryShortTextSchema = z.string().trim().min(1, "不能为空").max(MAX_STORY_TAG_LENGTH, "内容过长");
const StorySummarySchema = z.string().max(MAX_STORY_SUMMARY_LENGTH, "summary 过长");
const StoryNoteSchema = z.string().max(Math.max(MAX_STORY_NOTE_LENGTH, MAX_REFERENCE_NOTE_LENGTH), "note 过长");
const StoryTipSchema = z.string().max(MAX_STORY_TIP_LENGTH, "writingTip 过长");

type PlotJsonValue = null | boolean | number | string | PlotJsonValue[] | {[key: string]: PlotJsonValue};
const PlotJsonValueSchema: z.ZodType<PlotJsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(PlotJsonValueSchema),
    z.record(z.string(), PlotJsonValueSchema),
]));

export const StoryThreadStatusSchema = z.enum(["active", "draft", "paused", "done", "archived"]);
export const StorySceneStatusSchema = z.enum(["draft", "active", "written", "revised", "archived"]);
export const StoryRefTargetKindSchema = StoryStructuredReferenceKindSchema;
export const StoryRefVisibilitySchema = ReferenceVisibilitySchema;

export const StoryRefDtoSchema = StructuredReferenceDtoSchema.extend({
    visibility: StoryRefVisibilitySchema,
    note: StoryNoteSchema.nullable().optional().default(null),
});

export const StoryEffectiveRefDtoSchema = StoryRefDtoSchema.extend({
    sourceType: z.enum(["scene"]),
    sourceId: z.string(),
});

const StoryRefsInputSchema = z.array(StoryRefDtoSchema).max(MAX_STORY_REFS_COUNT, "refs 过多");
const StoryTagsInputSchema = z.array(StoryShortTextSchema).max(MAX_STORY_TAG_COUNT, "tags 过多");

export const StorySceneWorldAnchorInputDtoSchema = z.object({
    // `startTime` 为空表示 Scene 尚未连接 World Engine 起点。
    startTime: z.string().trim().min(1, "startTime 不能为空").nullable(),
    // `endTime` 为空表示 Scene 尚未连接 World Engine 终点。
    endTime: z.string().trim().min(1, "endTime 不能为空").nullable(),
    // `startInstant` 只用字符串承载 bigint，普通 UI 不直接编辑。
    startInstant: z.string().nullable(),
    // `endInstant` 只用字符串承载 bigint，普通 UI 不直接编辑。
    endInstant: z.string().nullable(),
    subjectIds: z.array(z.string().trim().min(1, "subjectId 不能为空")).max(MAX_STORY_SCENE_SUBJECT_COUNT, "出场 subjects 过多"),
    // `locationSubjectId` 为空表示 Scene 没有指定地点 subject。
    locationSubjectId: z.string().trim().min(1, "locationSubjectId 不能为空").nullable(),
});

export const StorySceneWorldAnchorSubjectDtoSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    resolved: z.boolean(),
});

export const StorySceneWorldAnchorDtoSchema = StorySceneWorldAnchorInputDtoSchema.extend({
    subjects: z.array(StorySceneWorldAnchorSubjectDtoSchema),
    // `locationSubject` 为空表示未指定地点；resolved=false 表示占位 subject 尚未接入 World Engine。
    locationSubject: StorySceneWorldAnchorSubjectDtoSchema.nullable(),
    unresolvedSubjectIds: z.array(z.string()),
});

export const SceneWorldContextDtoSchema = z.object({
    slices: z.array(z.object({
        id: z.string(),
        time: z.string(),
        title: z.string(),
        summary: z.string(),
        kind: z.string(),
        patchCount: z.number().int().nonnegative(),
    })),
    subjectStates: z.array(z.object({
        subjectId: z.string(),
        type: z.string(),
        name: z.string(),
        attrs: z.record(z.string(), PlotJsonValueSchema),
    })),
    unresolvedSubjectIds: z.array(z.string()),
});

export const StoryDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StoryPhaseDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    summary: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// 承载树:Act(卷)。与 manuscript volume 目录切割,排序权威在 sortOrder。
export const StoryActDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    summary: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// ChapterBrief:章级写作指令(POV/信息控制/开头收尾/禁写等)。字段全部可空,
// 空表示该维度未约束、交给 writer 自由发挥;非空即 leader/用户对本章的显式指令,兼作写后审查依据。
export const ChapterBriefDtoSchema = z.object({
    // 章节目标 / 落点。
    goal: z.string().nullable(),
    // 本章视角、叙述距离、切换限制。
    pov: z.string().nullable(),
    // 语气 / 情绪温度 / 风格约束。
    tone: z.string().nullable(),
    // 节奏、悬念、下一章牵引。
    pacing: z.string().nullable(),
    // 信息控制:读者已知。
    readerKnows: z.string().nullable(),
    // 信息控制:主角已知。
    protagonistKnows: z.string().nullable(),
    // 信息控制:必须隐藏。
    mustHide: z.string().nullable(),
    // 信息控制:可暗示但不可明说。
    hintOnly: z.string().nullable(),
    // 开场钩子。
    opening: z.string().nullable(),
    // 章节落点 / 结尾定句。
    ending: z.string().nullable(),
    // 禁写事项。
    doNotWrite: z.string().nullable(),
});

// 承载树:Chapter(章)一等实体。Prose 文件通过 frontmatter `chapter: <name>` 反指本实体。
export const StoryChapterDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    // `actId` 为空表示该章尚未归入具体卷。
    actId: z.string().nullable(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    brief: ChapterBriefDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

// Scene 上内嵌的 Chapter 轻量摘要,供列表/树展示,避免 UI 再查一次。
export const StorySceneChapterRefDtoSchema = z.object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
});

export const StoryThreadSummaryDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    // `storyPhaseId` 为空表示当前线程未归入具体阶段。
    storyPhaseId: z.string().nullable(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    isMainThread: z.boolean(),
    status: StoryThreadStatusSchema,
    summary: z.string(),
    tags: z.array(z.string()),
    // `writingTip` 为空表示没有额外写作提示。
    writingTip: z.string().nullable(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StorySceneSummaryDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    threadId: z.string(),
    // `chapterId` 为空表示当前 Scene 还未挂入具体章节。
    chapterId: z.string().nullable(),
    // `chapter` 为空同 chapterId;非空时是所属 Chapter 的轻量摘要。
    chapter: StorySceneChapterRefDtoSchema.nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    // `chapterSortOrder` 为空表示当前 Scene 未进入正文顺序。
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    // `purpose` 为空表示尚未填写场景功能说明。
    purpose: z.string().nullable(),
    // `writingTip` 为空表示没有额外写作提示。
    writingTip: z.string().nullable(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StoryThreadDetailDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StorySceneSummaryDtoSchema).optional(),
});
export const StoryThreadWriteResponseDtoSchema = withWriteDiagnosticsSchema(StoryThreadDetailDtoSchema);

export const StorySceneDetailDtoSchema = StorySceneSummaryDtoSchema.extend({
    refs: z.array(StoryRefDtoSchema),
    effectiveRefs: z.array(StoryEffectiveRefDtoSchema),
});
export const StorySceneWriteResponseDtoSchema = withWriteDiagnosticsSchema(StorySceneDetailDtoSchema);

export const ChapterPlotSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    threadTitle: z.string(),
    threadIsMain: z.boolean(),
    chapterId: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    purpose: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
});

export const ChapterPlotDetailDtoSchema = z.object({
    chapter: StoryChapterDtoSchema,
    scenes: z.array(ChapterPlotSceneDtoSchema),
    totalScenes: z.number().int().nonnegative(),
});

// Writer 防全知模式:autonomous=writer 自查 World Engine/lorebook,brief 只给查询提示;
// curated=writer 读不到设定源,brief 需带上过滤后的状态摘要,由 leader 投喂。
export const ChapterWriterBriefModeSchema = z.enum(["autonomous", "curated"]);

export const ChapterWriterBriefStatusSchema = z.enum([
    "ready",
    "needs_plot",
    "needs_world_anchor",
    "needs_world_context",
    // 信息控制四项(读者已知/主角已知/必须隐藏/可暗示)全空:信息控制是防全知唯一的按章控制面,必填。
    "needs_chapter_brief",
]);

// brief 编译出的建议读取项。来源于 Scene/Thread 的结构化 refs(content 类),替代 leader 手写设定复述。
export const ChapterWriterBriefReadingDtoSchema = z.object({
    // Project Workspace 相对内容节点路径,例如 lorebook/character/weiluosi/。
    path: z.string(),
    // 关系标签(foreshadows/depends_on 等),作为「为什么读」的 gloss。
    relation: z.string(),
    // `note` 为空表示该 ref 没有额外备注。
    note: z.string().nullable(),
    // 引用来源:来自某个 Scene 还是所属 Thread。
    source: z.enum(["scene", "thread"]),
});

export const ChapterWriterBriefSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    threadTitle: z.string(),
    threadIsMain: z.boolean(),
    threadSummary: z.string(),
    // `threadWritingTip` 为空表示该 Thread 没有额外写作提示。
    threadWritingTip: z.string().nullable(),
    chapterId: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    // `purpose` 为空表示 Scene 没有单独的场景功能说明。
    purpose: z.string().nullable(),
    // `writingTip` 为空表示 Scene 没有单独的写作提示。
    writingTip: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    // `worldContext` 为空表示该 Scene 尚不能安全提供 World Engine 上下文。
    worldContext: SceneWorldContextDtoSchema.nullable(),
    warnings: z.array(z.string()),
});

export const ChapterWriterBriefDtoSchema = z.object({
    chapter: StoryChapterDtoSchema,
    mode: ChapterWriterBriefModeSchema,
    status: ChapterWriterBriefStatusSchema,
    scenes: z.array(ChapterWriterBriefSceneDtoSchema),
    totalScenes: z.number().int().nonnegative(),
    // 由 Scene/Thread refs 编译的建议读取清单(已按 path 去重)。
    suggestedReading: z.array(ChapterWriterBriefReadingDtoSchema),
    warnings: z.array(z.string()),
    suggestedBriefMarkdown: z.string().min(1),
});

export const StoryThreadTreeNodeDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StorySceneSummaryDtoSchema),
});

export const StoryPhaseTreeNodeDtoSchema = StoryPhaseDtoSchema.extend({
    threads: z.array(StoryThreadTreeNodeDtoSchema),
});

// 承载树节点:Act 携带旗下 Chapter(按 sortOrder 排列)。
export const StoryActTreeNodeDtoSchema = StoryActDtoSchema.extend({
    chapters: z.array(StoryChapterDtoSchema),
});

export const PlotTreeDtoSchema = z.object({
    story: StoryDtoSchema,
    // 因果树:Phase → Thread → Scene。
    phases: z.array(StoryPhaseTreeNodeDtoSchema),
    ungroupedThreads: z.array(StoryThreadTreeNodeDtoSchema),
    // 承载树:Act → Chapter;未归卷的 Chapter 平铺在 ungroupedChapters。
    acts: z.array(StoryActTreeNodeDtoSchema),
    ungroupedChapters: z.array(StoryChapterDtoSchema),
    totalPhases: z.number().int().nonnegative(),
    totalThreads: z.number().int().nonnegative(),
    totalScenes: z.number().int().nonnegative(),
    totalActs: z.number().int().nonnegative(),
    totalChapters: z.number().int().nonnegative(),
});

export const StoryWorkbenchSceneDtoSchema = StorySceneSummaryDtoSchema.extend({
    refs: z.array(StoryRefDtoSchema),
});

export const StoryWorkbenchThreadDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StoryWorkbenchSceneDtoSchema),
});

export const StoryWorkbenchPhaseDtoSchema = StoryPhaseDtoSchema.extend({
    threads: z.array(StoryWorkbenchThreadDtoSchema),
});

export const PlotWorkbenchDtoSchema = z.object({
    story: StoryDtoSchema,
    phases: z.array(StoryWorkbenchPhaseDtoSchema),
    ungroupedThreads: z.array(StoryWorkbenchThreadDtoSchema),
    totalPhases: z.number().int().nonnegative(),
    totalThreads: z.number().int().nonnegative(),
    totalScenes: z.number().int().nonnegative(),
});

export const UpdateStoryRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional(),
    summary: StorySummarySchema.optional(),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined || value.note !== undefined, {
    message: "至少提供一个更新字段",
});

export const CreateStoryPhaseRequestDtoSchema = z.object({
    name: StoryNameSchema,
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长"),
    summary: StorySummarySchema.optional(),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional(),
});

export const UpdateStoryPhaseRequestDtoSchema = z.object({
    name: StoryNameSchema.optional(),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional(),
    summary: StorySummarySchema.optional(),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional(),
}).refine((value) => (
    value.name !== undefined
    || value.title !== undefined
    || value.summary !== undefined
    || value.note !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStoryPhaseItemDtoSchema = z.object({
    phaseId: z.string().trim().min(1, "phaseId 不能为空"),
    sortOrder: z.number().int().nonnegative(),
});

export const ReorderStoryPhasesRequestDtoSchema = z.object({
    items: z.array(ReorderStoryPhaseItemDtoSchema).min(1, "items 不能为空"),
});

// ChapterBrief 写入 schema:每个字段 undefined=不修改,null=显式清空。
export const ChapterBriefInputDtoSchema = z.object({
    goal: StorySummarySchema.nullable().optional().describe("Chapter goal / landing point. Null clears it."),
    pov: StorySummarySchema.nullable().optional().describe("POV, narrative distance and switching constraints for this chapter. Null clears it."),
    tone: StorySummarySchema.nullable().optional().describe("Tone / emotional temperature / style constraints. Null clears it."),
    pacing: StorySummarySchema.nullable().optional().describe("Pacing, suspense and next-chapter pull. Null clears it."),
    readerKnows: StorySummarySchema.nullable().optional().describe("Information control: what the reader already knows. Null clears it."),
    protagonistKnows: StorySummarySchema.nullable().optional().describe("Information control: what the protagonist knows. Null clears it."),
    mustHide: StorySummarySchema.nullable().optional().describe("Information control: facts that must stay hidden this chapter. Null clears it."),
    hintOnly: StorySummarySchema.nullable().optional().describe("Information control: may be hinted at but not stated. Null clears it."),
    opening: StorySummarySchema.nullable().optional().describe("Opening hook. Null clears it."),
    ending: StorySummarySchema.nullable().optional().describe("Chapter landing / closing line. Null clears it."),
    doNotWrite: StorySummarySchema.nullable().optional().describe("Do-not-write list (secrets, premature reveals). Null clears it."),
});

export const CreateStoryActRequestDtoSchema = z.object({
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable act (volume) title."),
    summary: StorySummarySchema.optional().describe("Act summary (max 5000 characters)."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
});

export const UpdateStoryActRequestDtoSchema = z.object({
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable act (volume) title."),
    summary: StorySummarySchema.optional().describe("Act summary (max 5000 characters)."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    sortOrder: z.number().int().nonnegative().optional().describe("Act order within the story."),
}).refine((value) => (
    value.name !== undefined
    || value.title !== undefined
    || value.summary !== undefined
    || value.note !== undefined
    || value.sortOrder !== undefined
), {
    message: "至少提供一个更新字段",
});

export const CreateStoryChapterRequestDtoSchema = z.object({
    // `actId` 为空表示创建未归卷章节。
    actId: z.string().trim().min(1, "actId 不能为空").nullable().optional().describe("Act ID to group this chapter under. Null for an ungrouped chapter."),
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens). Prose files point back via frontmatter `chapter: <name>`."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable chapter title."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    brief: ChapterBriefInputDtoSchema.optional().describe("Chapter-level writer brief (goal, POV, info control, opening/ending, do-not-write)."),
});

export const UpdateStoryChapterRequestDtoSchema = z.object({
    // `actId` 为空表示移动到未归卷区。
    actId: z.string().trim().min(1, "actId 不能为空").nullable().optional().describe("Act ID to move the chapter to. Null moves to ungrouped."),
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens). Renaming breaks existing prose frontmatter pointers."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable chapter title."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    sortOrder: z.number().int().nonnegative().optional().describe("Chapter order within the story."),
    brief: ChapterBriefInputDtoSchema.optional().describe("Chapter-level writer brief fields to update. Omitted fields stay unchanged; null fields are cleared."),
}).refine((value) => (
    value.actId !== undefined
    || value.name !== undefined
    || value.title !== undefined
    || value.note !== undefined
    || value.sortOrder !== undefined
    || value.brief !== undefined
), {
    message: "至少提供一个更新字段",
});

export const CreateStoryThreadRequestDtoSchema = z.object({
    // `storyPhaseId` 为空表示创建未分组线程。
    storyPhaseId: z.string().trim().min(1, "storyPhaseId 不能为空").nullable().optional().describe("Phase ID to group this thread under. Null for an ungrouped thread."),
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable thread title."),
    isMainThread: z.boolean().optional().describe("Whether this is the main story thread."),
    status: StoryThreadStatusSchema.optional().describe("Thread status (active, draft, paused, done, archived)."),
    summary: StorySummarySchema.optional().describe("Thread summary (max 5000 characters)."),
    tags: StoryTagsInputSchema.optional().describe("Tags for categorization (max 50)."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the thread. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
});

export const UpdateStoryThreadRequestDtoSchema = z.object({
    // `storyPhaseId` 为空表示移动到未分组线程。
    storyPhaseId: z.string().trim().min(1, "storyPhaseId 不能为空").nullable().optional().describe("Phase ID to move the thread to. Null moves to ungrouped."),
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable thread title."),
    isMainThread: z.boolean().optional().describe("Whether this is the main story thread."),
    status: StoryThreadStatusSchema.optional().describe("Thread status (active, draft, paused, done, archived)."),
    summary: StorySummarySchema.optional().describe("Thread summary (max 5000 characters)."),
    tags: StoryTagsInputSchema.optional().describe("Tags for categorization (max 50)."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the thread. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
}).refine((value) => (
    value.storyPhaseId !== undefined
    || value.name !== undefined
    || value.title !== undefined
    || value.isMainThread !== undefined
    || value.status !== undefined
    || value.summary !== undefined
    || value.tags !== undefined
    || value.writingTip !== undefined
    || value.note !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStoryThreadItemDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空"),
    // `storyPhaseId` 为空表示放入未分组线程区。
    storyPhaseId: z.string().trim().min(1, "storyPhaseId 不能为空").nullable(),
    sortOrder: z.number().int().nonnegative(),
});

export const ReorderStoryThreadsRequestDtoSchema = z.object({
    items: z.array(ReorderStoryThreadItemDtoSchema).min(1, "items 不能为空"),
});

export const CreateStorySceneRequestDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空").describe("Thread ID to attach this scene to."),
    // `chapterId` 为空表示当前 Scene 还未挂入具体章节。
    chapterId: z.string().trim().min(1, "chapterId 不能为空").nullable().optional().describe("StoryChapter ID to attach this scene to. Null if not yet placed in a chapter."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable scene title."),
    status: StorySceneStatusSchema.optional().describe("Scene status (draft, active, written, revised, archived)."),
    summary: StorySummarySchema.optional().describe("Scene summary (max 5000 characters)."),
    // `purpose` 为空表示显式清空场景功能说明。
    purpose: StorySummarySchema.nullable().optional().describe("Scene purpose/function description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the scene. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    worldAnchor: StorySceneWorldAnchorInputDtoSchema.optional().describe("World Engine time/subject anchor for this scene."),
    refs: StoryRefsInputSchema.optional().describe("Structured references (max 100). Use workspace content-node paths for lore, e.g. lorebook/character/foo/. Use thread:// or scene:// for plot entities. pending:// is not supported."),
});

export const UpdateStorySceneRequestDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空").optional().describe("Thread ID to move this scene to."),
    // `chapterId` 为空表示从章节顺序中移除当前 Scene。
    chapterId: z.string().trim().min(1, "chapterId 不能为空").nullable().optional().describe("StoryChapter ID. Null removes the scene from chapter ordering."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable scene title."),
    status: StorySceneStatusSchema.optional().describe("Scene status (draft, active, written, revised, archived)."),
    summary: StorySummarySchema.optional().describe("Scene summary (max 5000 characters)."),
    // `purpose` 为空表示显式清空场景功能说明。
    purpose: StorySummarySchema.nullable().optional().describe("Scene purpose/function description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the scene. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    worldAnchor: StorySceneWorldAnchorInputDtoSchema.optional().describe("World Engine time/subject anchor for this scene."),
    refs: StoryRefsInputSchema.optional().describe("Structured references (max 100). Use workspace content-node paths for lore, e.g. lorebook/character/foo/. Use thread:// or scene:// for plot entities. pending:// is not supported."),
}).refine((value) => (
    value.threadId !== undefined
    || value.chapterId !== undefined
    || value.title !== undefined
    || value.status !== undefined
    || value.summary !== undefined
    || value.purpose !== undefined
    || value.writingTip !== undefined
    || value.note !== undefined
    || value.worldAnchor !== undefined
    || value.refs !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStorySceneItemDtoSchema = z.object({
    sceneId: z.string().trim().min(1, "sceneId 不能为空"),
    threadId: z.string().trim().min(1, "threadId 不能为空"),
    // `chapterId` 为空表示该 Scene 当前不挂入正文顺序。
    chapterId: z.string().trim().min(1, "chapterId 不能为空").nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    // `chapterSortOrder` 为空表示该 Scene 当前不挂入正文顺序。
    chapterSortOrder: z.number().int().nonnegative().nullable(),
});

export const ReorderStoryScenesRequestDtoSchema = z.object({
    items: z.array(ReorderStorySceneItemDtoSchema).min(1, "items 不能为空"),
});

export type StoryThreadStatusDto = z.infer<typeof StoryThreadStatusSchema>;
export type StorySceneStatusDto = z.infer<typeof StorySceneStatusSchema>;
export type StoryRefTargetKindDto = z.infer<typeof StoryRefTargetKindSchema>;
export type StoryRefVisibilityDto = z.infer<typeof StoryRefVisibilitySchema>;
export type StoryRefDto = z.infer<typeof StoryRefDtoSchema>;
export type StoryEffectiveRefDto = z.infer<typeof StoryEffectiveRefDtoSchema>;
export type StorySceneWorldAnchorInputDto = z.infer<typeof StorySceneWorldAnchorInputDtoSchema>;
export type StorySceneWorldAnchorSubjectDto = z.infer<typeof StorySceneWorldAnchorSubjectDtoSchema>;
export type StorySceneWorldAnchorDto = z.infer<typeof StorySceneWorldAnchorDtoSchema>;
export type SceneWorldContextDto = z.infer<typeof SceneWorldContextDtoSchema>;
export type StoryDto = z.infer<typeof StoryDtoSchema>;
export type StoryPhaseDto = z.infer<typeof StoryPhaseDtoSchema>;
export type StoryActDto = z.infer<typeof StoryActDtoSchema>;
export type ChapterBriefDto = z.infer<typeof ChapterBriefDtoSchema>;
export type StoryChapterDto = z.infer<typeof StoryChapterDtoSchema>;
export type StorySceneChapterRefDto = z.infer<typeof StorySceneChapterRefDtoSchema>;
export type StoryThreadSummaryDto = z.infer<typeof StoryThreadSummaryDtoSchema>;
export type StoryThreadDetailDto = z.infer<typeof StoryThreadDetailDtoSchema>;
export type StoryThreadWriteResponseDto = z.infer<typeof StoryThreadWriteResponseDtoSchema>;
export type StorySceneSummaryDto = z.infer<typeof StorySceneSummaryDtoSchema>;
export type StorySceneDetailDto = z.infer<typeof StorySceneDetailDtoSchema>;
export type StorySceneWriteResponseDto = z.infer<typeof StorySceneWriteResponseDtoSchema>;
export type ChapterPlotSceneDto = z.infer<typeof ChapterPlotSceneDtoSchema>;
export type ChapterPlotDetailDto = z.infer<typeof ChapterPlotDetailDtoSchema>;
export type ChapterWriterBriefStatus = z.infer<typeof ChapterWriterBriefStatusSchema>;
export type ChapterWriterBriefMode = z.infer<typeof ChapterWriterBriefModeSchema>;
export type ChapterWriterBriefReadingDto = z.infer<typeof ChapterWriterBriefReadingDtoSchema>;
export type ChapterWriterBriefSceneDto = z.infer<typeof ChapterWriterBriefSceneDtoSchema>;
export type ChapterWriterBriefDto = z.infer<typeof ChapterWriterBriefDtoSchema>;
export type StoryThreadTreeNodeDto = z.infer<typeof StoryThreadTreeNodeDtoSchema>;
export type StoryPhaseTreeNodeDto = z.infer<typeof StoryPhaseTreeNodeDtoSchema>;
export type StoryActTreeNodeDto = z.infer<typeof StoryActTreeNodeDtoSchema>;
export type PlotTreeDto = z.infer<typeof PlotTreeDtoSchema>;
export type StoryWorkbenchSceneDto = z.infer<typeof StoryWorkbenchSceneDtoSchema>;
export type StoryWorkbenchThreadDto = z.infer<typeof StoryWorkbenchThreadDtoSchema>;
export type StoryWorkbenchPhaseDto = z.infer<typeof StoryWorkbenchPhaseDtoSchema>;
export type PlotWorkbenchDto = z.infer<typeof PlotWorkbenchDtoSchema>;
export type UpdateStoryRequestDto = z.infer<typeof UpdateStoryRequestDtoSchema>;
export type CreateStoryPhaseRequestDto = z.infer<typeof CreateStoryPhaseRequestDtoSchema>;
export type UpdateStoryPhaseRequestDto = z.infer<typeof UpdateStoryPhaseRequestDtoSchema>;
export type ChapterBriefInputDto = z.infer<typeof ChapterBriefInputDtoSchema>;
export type CreateStoryActRequestDto = z.infer<typeof CreateStoryActRequestDtoSchema>;
export type UpdateStoryActRequestDto = z.infer<typeof UpdateStoryActRequestDtoSchema>;
export type CreateStoryChapterRequestDto = z.infer<typeof CreateStoryChapterRequestDtoSchema>;
export type UpdateStoryChapterRequestDto = z.infer<typeof UpdateStoryChapterRequestDtoSchema>;
export type ReorderStoryPhasesRequestDto = z.infer<typeof ReorderStoryPhasesRequestDtoSchema>;
export type CreateStoryThreadRequestDto = z.infer<typeof CreateStoryThreadRequestDtoSchema>;
export type UpdateStoryThreadRequestDto = z.infer<typeof UpdateStoryThreadRequestDtoSchema>;
export type ReorderStoryThreadsRequestDto = z.infer<typeof ReorderStoryThreadsRequestDtoSchema>;
export type CreateStorySceneRequestDto = z.infer<typeof CreateStorySceneRequestDtoSchema>;
export type UpdateStorySceneRequestDto = z.infer<typeof UpdateStorySceneRequestDtoSchema>;
export type ReorderStoryScenesRequestDto = z.infer<typeof ReorderStoryScenesRequestDtoSchema>;
