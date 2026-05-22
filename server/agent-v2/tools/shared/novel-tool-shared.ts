import {z} from "zod";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";

export const NovelTitleSchema = z.string().trim().min(1, "title 不能为空").max(120, "title 过长").describe("Novel title (1–120 characters).");
export const NovelSummarySchema = z.string().max(2_000, "summary 过长").describe("Novel summary (max 2000 characters).");

/**
 * 从当前 scope 中解析小说上下文。
 */
export function resolveToolNovelId(context: AgentToolContext): number {
    const novelId = context.getScope().studio.novelId;
    if (!novelId) {
        throw new Error("当前线程缺少 scope.studio.novelId，无法执行小说相关工具");
    }
    const parsedNovelId = Number(novelId);
    if (!Number.isInteger(parsedNovelId) || parsedNovelId <= 0) {
        throw new Error(`scope.studio.novelId 非法: ${novelId}`);
    }
    return parsedNovelId;
}
