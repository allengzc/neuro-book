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

export const StoryThreadStatusSchema = z.enum(["active", "draft", "paused", "done", "archived"]);
export const StorySceneStatusSchema = z.enum(["draft", "active", "written", "revised", "archived"]);
export const StoryPlotKindSchema = z.enum(["setup", "action", "conflict", "despair", "relief", "reward", "mystery", "reveal", "twist", "payoff", "result"]);
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

export const StoryPlotDtoSchema = z.object({
    id: z.string(),
    sceneId: z.string(),
    sortOrder: z.number().int().nonnegative(),
    kind: StoryPlotKindSchema,
    summary: z.string(),
    // `effect` 为空表示当前情节点未显式记录结果。
    effect: z.string().nullable(),
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
    // `chapterPath` 为空表示当前 Scene 还未挂入具体章节。
    chapterPath: z.string().nullable(),
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
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StoryThreadDetailDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StorySceneSummaryDtoSchema).optional(),
});
export const StoryThreadWriteResponseDtoSchema = withWriteDiagnosticsSchema(StoryThreadDetailDtoSchema);

export const StorySceneDetailDtoSchema = StorySceneSummaryDtoSchema.extend({
    plots: z.array(StoryPlotDtoSchema),
    refs: z.array(StoryRefDtoSchema),
    effectiveRefs: z.array(StoryEffectiveRefDtoSchema),
});
export const StorySceneWriteResponseDtoSchema = withWriteDiagnosticsSchema(StorySceneDetailDtoSchema);

export const ChapterPlotSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    threadTitle: z.string(),
    threadIsMain: z.boolean(),
    chapterPath: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    purpose: z.string().nullable(),
    plots: z.array(StoryPlotDtoSchema),
});

export const ChapterPlotDetailDtoSchema = z.object({
    chapterPath: z.string(),
    scenes: z.array(ChapterPlotSceneDtoSchema),
    totalScenes: z.number().int().nonnegative(),
    totalPlots: z.number().int().nonnegative(),
});
export const StoryPlotWriteResponseDtoSchema = withWriteDiagnosticsSchema(StoryPlotDtoSchema);

export const StoryThreadTreeNodeDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StorySceneSummaryDtoSchema),
});

export const StoryPhaseTreeNodeDtoSchema = StoryPhaseDtoSchema.extend({
    threads: z.array(StoryThreadTreeNodeDtoSchema),
});

export const PlotTreeDtoSchema = z.object({
    story: StoryDtoSchema,
    phases: z.array(StoryPhaseTreeNodeDtoSchema),
    ungroupedThreads: z.array(StoryThreadTreeNodeDtoSchema),
    totalPhases: z.number().int().nonnegative(),
    totalThreads: z.number().int().nonnegative(),
    totalScenes: z.number().int().nonnegative(),
    totalPlots: z.number().int().nonnegative(),
});

export const StoryWorkbenchSceneDtoSchema = StorySceneSummaryDtoSchema.extend({
    plots: z.array(StoryPlotDtoSchema),
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
    totalPlots: z.number().int().nonnegative(),
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
    // `chapterPath` 为空表示当前 Scene 还未挂入具体章节。
    chapterPath: z.string().trim().min(1, "chapterPath 不能为空").nullable().optional().describe("Chapter content-node path to attach this scene to. Null if not yet placed in a chapter."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable scene title."),
    status: StorySceneStatusSchema.optional().describe("Scene status (draft, active, written, revised, archived)."),
    summary: StorySummarySchema.optional().describe("Scene summary (max 5000 characters)."),
    // `purpose` 为空表示显式清空场景功能说明。
    purpose: StorySummarySchema.nullable().optional().describe("Scene purpose/function description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the scene. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    refs: StoryRefsInputSchema.optional().describe("Structured references (max 100). Use workspace content-node paths for lore, e.g. lorebook/character/foo/. Use thread://, scene://, plot:// for plot entities. pending:// is not supported."),
});

export const UpdateStorySceneRequestDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空").optional().describe("Thread ID to move this scene to."),
    // `chapterPath` 为空表示从章节顺序中移除当前 Scene。
    chapterPath: z.string().trim().min(1, "chapterPath 不能为空").nullable().optional().describe("Chapter content-node path. Null removes the scene from chapter ordering."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable scene title."),
    status: StorySceneStatusSchema.optional().describe("Scene status (draft, active, written, revised, archived)."),
    summary: StorySummarySchema.optional().describe("Scene summary (max 5000 characters)."),
    // `purpose` 为空表示显式清空场景功能说明。
    purpose: StorySummarySchema.nullable().optional().describe("Scene purpose/function description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the scene. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    refs: StoryRefsInputSchema.optional().describe("Structured references (max 100). Use workspace content-node paths for lore, e.g. lorebook/character/foo/. Use thread://, scene://, plot:// for plot entities. pending:// is not supported."),
}).refine((value) => (
    value.threadId !== undefined
    || value.chapterPath !== undefined
    || value.title !== undefined
    || value.status !== undefined
    || value.summary !== undefined
    || value.purpose !== undefined
    || value.writingTip !== undefined
    || value.note !== undefined
    || value.refs !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStorySceneItemDtoSchema = z.object({
    sceneId: z.string().trim().min(1, "sceneId 不能为空"),
    threadId: z.string().trim().min(1, "threadId 不能为空"),
    // `chapterPath` 为空表示该 Scene 当前不挂入正文顺序。
    chapterPath: z.string().trim().min(1, "chapterPath 不能为空").nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    // `chapterSortOrder` 为空表示该 Scene 当前不挂入正文顺序。
    chapterSortOrder: z.number().int().nonnegative().nullable(),
});

export const ReorderStoryScenesRequestDtoSchema = z.object({
    items: z.array(ReorderStorySceneItemDtoSchema).min(1, "items 不能为空"),
});

export const CreateStoryPlotRequestDtoSchema = z.object({
    sceneId: z.string().trim().min(1, "sceneId 不能为空").describe("Scene ID to attach this plot to."),
    kind: StoryPlotKindSchema.describe("Plot kind (setup, action, conflict, despair, relief, reward, mystery, reveal, twist, payoff, result)."),
    summary: StorySummarySchema.optional().describe("Plot summary (max 5000 characters)."),
    // `effect` 为空表示显式清空结果描述。
    effect: StorySummarySchema.nullable().optional().describe("Plot effect/outcome description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for this plot. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
});

export const UpdateStoryPlotRequestDtoSchema = z.object({
    sceneId: z.string().trim().min(1, "sceneId 不能为空").optional().describe("Scene ID to move this plot to."),
    kind: StoryPlotKindSchema.optional().describe("Plot kind (setup, action, conflict, despair, relief, reward, mystery, reveal, twist, payoff, result)."),
    summary: StorySummarySchema.optional().describe("Plot summary (max 5000 characters)."),
    // `effect` 为空表示显式清空结果描述。
    effect: StorySummarySchema.nullable().optional().describe("Plot effect/outcome description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for this plot. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
}).refine((value) => (
    value.sceneId !== undefined
    || value.kind !== undefined
    || value.summary !== undefined
    || value.effect !== undefined
    || value.writingTip !== undefined
    || value.note !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStoryPlotItemDtoSchema = z.object({
    plotId: z.string().trim().min(1, "plotId 不能为空"),
    sceneId: z.string().trim().min(1, "sceneId 不能为空"),
    sortOrder: z.number().int().nonnegative(),
});

export const ReorderStoryPlotsRequestDtoSchema = z.object({
    items: z.array(ReorderStoryPlotItemDtoSchema).min(1, "items 不能为空"),
});

export type StoryThreadStatusDto = z.infer<typeof StoryThreadStatusSchema>;
export type StorySceneStatusDto = z.infer<typeof StorySceneStatusSchema>;
export type StoryPlotKindDto = z.infer<typeof StoryPlotKindSchema>;
export type StoryRefTargetKindDto = z.infer<typeof StoryRefTargetKindSchema>;
export type StoryRefVisibilityDto = z.infer<typeof StoryRefVisibilitySchema>;
export type StoryRefDto = z.infer<typeof StoryRefDtoSchema>;
export type StoryEffectiveRefDto = z.infer<typeof StoryEffectiveRefDtoSchema>;
export type StoryDto = z.infer<typeof StoryDtoSchema>;
export type StoryPhaseDto = z.infer<typeof StoryPhaseDtoSchema>;
export type StoryThreadSummaryDto = z.infer<typeof StoryThreadSummaryDtoSchema>;
export type StoryThreadDetailDto = z.infer<typeof StoryThreadDetailDtoSchema>;
export type StoryThreadWriteResponseDto = z.infer<typeof StoryThreadWriteResponseDtoSchema>;
export type StorySceneSummaryDto = z.infer<typeof StorySceneSummaryDtoSchema>;
export type StorySceneDetailDto = z.infer<typeof StorySceneDetailDtoSchema>;
export type StorySceneWriteResponseDto = z.infer<typeof StorySceneWriteResponseDtoSchema>;
export type ChapterPlotSceneDto = z.infer<typeof ChapterPlotSceneDtoSchema>;
export type ChapterPlotDetailDto = z.infer<typeof ChapterPlotDetailDtoSchema>;
export type StoryPlotDto = z.infer<typeof StoryPlotDtoSchema>;
export type StoryPlotWriteResponseDto = z.infer<typeof StoryPlotWriteResponseDtoSchema>;
export type StoryThreadTreeNodeDto = z.infer<typeof StoryThreadTreeNodeDtoSchema>;
export type StoryPhaseTreeNodeDto = z.infer<typeof StoryPhaseTreeNodeDtoSchema>;
export type PlotTreeDto = z.infer<typeof PlotTreeDtoSchema>;
export type StoryWorkbenchSceneDto = z.infer<typeof StoryWorkbenchSceneDtoSchema>;
export type StoryWorkbenchThreadDto = z.infer<typeof StoryWorkbenchThreadDtoSchema>;
export type StoryWorkbenchPhaseDto = z.infer<typeof StoryWorkbenchPhaseDtoSchema>;
export type PlotWorkbenchDto = z.infer<typeof PlotWorkbenchDtoSchema>;
export type UpdateStoryRequestDto = z.infer<typeof UpdateStoryRequestDtoSchema>;
export type CreateStoryPhaseRequestDto = z.infer<typeof CreateStoryPhaseRequestDtoSchema>;
export type UpdateStoryPhaseRequestDto = z.infer<typeof UpdateStoryPhaseRequestDtoSchema>;
export type ReorderStoryPhasesRequestDto = z.infer<typeof ReorderStoryPhasesRequestDtoSchema>;
export type CreateStoryThreadRequestDto = z.infer<typeof CreateStoryThreadRequestDtoSchema>;
export type UpdateStoryThreadRequestDto = z.infer<typeof UpdateStoryThreadRequestDtoSchema>;
export type ReorderStoryThreadsRequestDto = z.infer<typeof ReorderStoryThreadsRequestDtoSchema>;
export type CreateStorySceneRequestDto = z.infer<typeof CreateStorySceneRequestDtoSchema>;
export type UpdateStorySceneRequestDto = z.infer<typeof UpdateStorySceneRequestDtoSchema>;
export type ReorderStoryScenesRequestDto = z.infer<typeof ReorderStoryScenesRequestDtoSchema>;
export type CreateStoryPlotRequestDto = z.infer<typeof CreateStoryPlotRequestDtoSchema>;
export type UpdateStoryPlotRequestDto = z.infer<typeof UpdateStoryPlotRequestDtoSchema>;
export type ReorderStoryPlotsRequestDto = z.infer<typeof ReorderStoryPlotsRequestDtoSchema>;
