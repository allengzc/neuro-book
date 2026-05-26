import {z} from "zod";
import {
    withWriteDiagnosticsSchema,
} from "nbook/shared/dto/write-response";

export const ChapterStatusSchema = z.enum(["NOT_STARTED", "DRAFT", "REVISING", "DONE"]);

export type ChapterStatusDto = z.infer<typeof ChapterStatusSchema>;

const NonEmptyStringSchema = z.string().trim().min(1, "不能为空");

/**
 * 小说列表条目。
 */
export const NovelListItemDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    workspaceSlug: z.string(),
    projectPath: z.string(),
    /**
     * 非空表示 Project Manifest 当前无法解析，项目仍可进入文件树修复。
     */
    manifestError: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    volumeCount: z.number().int().nonnegative(),
    chapterCount: z.number().int().nonnegative(),
    totalWords: z.number().int().nonnegative(),
});

/**
 * 章节列表简要信息。
 */
export const ChapterSummaryDtoSchema = z.object({
    id: z.string(),
    novelId: z.string(),
    volumeId: z.string(),
    title: z.string(),
    status: ChapterStatusSchema,
    summary: z.string(),
    characters: z.array(z.string()),
    todos: z.array(z.string()),
    wordCount: z.number().int().nonnegative(),
    sortOrder: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/**
 * 分卷信息。
 */
export const VolumeDtoSchema = z.object({
    id: z.string(),
    novelId: z.string(),
    title: z.string(),
    summary: z.string(),
    sortOrder: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
    chapters: z.array(ChapterSummaryDtoSchema),
});

/**
 * 小说树结构。
 */
export const NovelTreeDtoSchema = z.object({
    novel: z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
        workspaceSlug: z.string(),
        projectPath: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
    }),
    volumes: z.array(VolumeDtoSchema),
    totalVolumes: z.number().int().nonnegative(),
    totalChapters: z.number().int().nonnegative(),
    totalWords: z.number().int().nonnegative(),
});

/**
 * 章节详情。
 */
export const ChapterDetailDtoSchema = ChapterSummaryDtoSchema.extend({
    content: z.string(),
});

export const ChapterDetailWriteResponseDtoSchema = withWriteDiagnosticsSchema(ChapterDetailDtoSchema);

/**
 * 新建小说请求。
 */
export const CreateNovelRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(120, "title 过长"),
    summary: z.string().max(2_000, "summary 过长").optional(),
});

/**
 * 更新小说请求。
 */
export const UpdateNovelRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(120, "title 过长").optional(),
    summary: z.string().max(2_000, "summary 过长").optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined, {
    message: "至少提供一个更新字段",
});

/**
 * 新建分卷请求。
 */
export const CreateVolumeRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(120, "title 过长"),
    summary: z.string().max(2_000, "summary 过长").optional(),
});

/**
 * 更新分卷请求。
 */
export const UpdateVolumeRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(120, "title 过长").optional(),
    summary: z.string().max(2_000, "summary 过长").optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined, {
    message: "至少提供一个更新字段",
});

/**
 * 分卷重排条目。
 * `items` 必须覆盖当前小说的全部分卷，且 `sortOrder` 从 0 开始连续递增。
 */
export const ReorderVolumeItemDtoSchema = z.object({
    volumeId: z.string().trim().min(1, "volumeId 不能为空"),
    sortOrder: z.number().int().nonnegative(),
});

/**
 * 重排分卷请求。
 */
export const ReorderVolumesRequestDtoSchema = z.object({
    items: z.array(ReorderVolumeItemDtoSchema).min(1, "items 不能为空"),
});

/**
 * 新建章节请求。
 */
export const CreateChapterRequestDtoSchema = z.object({
    volumeId: z.string().trim().min(1, "volumeId 不能为空"),
    title: NonEmptyStringSchema.max(120, "title 过长"),
    status: ChapterStatusSchema.optional(),
    summary: z.string().max(5_000, "summary 过长").optional(),
    characters: z.array(z.string().trim().min(1, "角色名不能为空")).max(50, "characters 过多").optional(),
    todos: z.array(z.string().trim().min(1, "待办不能为空")).max(50, "todos 过多").optional(),
});

/**
 * 更新章节元数据请求。
 */
export const UpdateChapterMetaRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(120, "title 过长").optional(),
    status: ChapterStatusSchema.optional(),
    summary: z.string().max(5_000, "summary 过长").optional(),
    characters: z.array(z.string().trim().min(1, "角色名不能为空")).max(50, "characters 过多").optional(),
    todos: z.array(z.string().trim().min(1, "待办不能为空")).max(50, "todos 过多").optional(),
}).refine((value) => (
    value.title !== undefined
    || value.status !== undefined
    || value.summary !== undefined
    || value.characters !== undefined
    || value.todos !== undefined
), {
    message: "至少提供一个更新字段",
});

/**
 * 更新章节正文请求。
 */
export const UpdateChapterContentRequestDtoSchema = z.object({
    content: z.string().max(200_000, "content 过长"),
});

/**
 * 章节重排条目。
 * `items` 必须覆盖当前小说的全部章节。
 * 每个目标分卷内的 `sortOrder` 必须从 0 开始连续递增，因此允许跨篇移动。
 */
export const ReorderChapterItemDtoSchema = z.object({
    chapterId: z.string().trim().min(1, "chapterId 不能为空"),
    volumeId: z.string().trim().min(1, "volumeId 不能为空"),
    sortOrder: z.number().int().nonnegative(),
});

/**
 * 重排章节请求。
 */
export const ReorderChaptersRequestDtoSchema = z.object({
    items: z.array(ReorderChapterItemDtoSchema).min(1, "items 不能为空"),
});

export type NovelListItemDto = z.infer<typeof NovelListItemDtoSchema>;
export type ChapterSummaryDto = z.infer<typeof ChapterSummaryDtoSchema>;
export type VolumeDto = z.infer<typeof VolumeDtoSchema>;
export type NovelTreeDto = z.infer<typeof NovelTreeDtoSchema>;
export type ChapterDetailDto = z.infer<typeof ChapterDetailDtoSchema>;
export type ChapterDetailWriteResponseDto = z.infer<typeof ChapterDetailWriteResponseDtoSchema>;
export type CreateNovelRequestDto = z.infer<typeof CreateNovelRequestDtoSchema>;
export type UpdateNovelRequestDto = z.infer<typeof UpdateNovelRequestDtoSchema>;
export type CreateVolumeRequestDto = z.infer<typeof CreateVolumeRequestDtoSchema>;
export type UpdateVolumeRequestDto = z.infer<typeof UpdateVolumeRequestDtoSchema>;
export type ReorderVolumesRequestDto = z.infer<typeof ReorderVolumesRequestDtoSchema>;
export type CreateChapterRequestDto = z.infer<typeof CreateChapterRequestDtoSchema>;
export type UpdateChapterMetaRequestDto = z.infer<typeof UpdateChapterMetaRequestDtoSchema>;
export type UpdateChapterContentRequestDto = z.infer<typeof UpdateChapterContentRequestDtoSchema>;
export type ReorderChaptersRequestDto = z.infer<typeof ReorderChaptersRequestDtoSchema>;
