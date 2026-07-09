import {z} from "zod";

/**
 * Workspace 文件历史（Task 95）收件箱 DTO。
 * 只传摘要与 hash 引用，不内联全文——全文通过 snapshot 接口按需取。
 */

/** 收件箱条目摘要。 */
export const WorkspaceHistoryEntryDtoSchema = z.object({
    id: z.number(),
    /** ISO-8601 UTC */
    occurredAt: z.string(),
    actorKind: z.enum(["user", "agent", "system", "external"]),
    /** 归因细节：agent = sessionId、system = source、user = userId；external 为 null */
    actorDetail: z.string().nullable(),
    /** file.create / file.edit / file.delete / file.rename / file.revert / file.restore */
    operationType: z.string(),
});
export type WorkspaceHistoryEntryDto = z.infer<typeof WorkspaceHistoryEntryDtoSchema>;

/** 收件箱分组（每文件一组）。 */
export const WorkspaceHistoryInboxGroupDtoSchema = z.object({
    /** 现名（rename 已跟随） */
    path: z.string(),
    /** diff 基准内容 hash；null = 基准是「文件不存在」（按空文本 diff） */
    baseHash: z.string().nullable(),
    /** 账面末态内容 hash；null = 文件现已删除（按空文本 diff） */
    endHash: z.string().nullable(),
    entries: z.array(WorkspaceHistoryEntryDtoSchema),
});
export type WorkspaceHistoryInboxGroupDto = z.infer<typeof WorkspaceHistoryInboxGroupDtoSchema>;

export const WorkspaceHistoryInboxDtoSchema = z.object({
    groups: z.array(WorkspaceHistoryInboxGroupDtoSchema),
});
export type WorkspaceHistoryInboxDto = z.infer<typeof WorkspaceHistoryInboxDtoSchema>;

/** 快照全文。text = null 表示 body 不可用（超限 / 二进制 / 已被保留策略清理）。 */
export const WorkspaceHistorySnapshotDtoSchema = z.object({
    text: z.string().nullable(),
});
export type WorkspaceHistorySnapshotDto = z.infer<typeof WorkspaceHistorySnapshotDtoSchema>;
