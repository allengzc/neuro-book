import {consola} from "consola";
import type {H3Event} from "h3";
import type {
    NovelListItemDto,
    UpdateNovelRequestDto,
} from "nbook/shared/dto/novel-chapter.dto";
import {z} from "zod";
import {listProjectWorkspaces, readProjectManifest, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";

type EntityIdLabel =
    | "storyId"
    | "phaseId"
    | "threadId"
    | "sceneId"
    | "plotId"
    | "entryId"
    | "parentId";

/**
 * 将数据库整数 ID 转成对外字符串。
 */
export function stringifyEntityId(id: number): string {
    return String(id);
}

/**
 * 将外部传入的 ID 解析为数据库整数。
 */
export function parseEntityId(label: EntityIdLabel, value: string): number {
    const normalized = value.trim();
    if (!normalized) {
        throwBadRequest(`${label} 不能为空`);
    }

    if (!/^\d+$/.test(normalized)) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    const parsedId = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
        throwBadRequest(`${label} 必须是正整数`);
    }

    return parsedId;
}

/**
 * 将可空 ID 解析为数据库整数。
 * 空值表示客户端未提供该字段。
 */
export function parseNullableEntityId(label: EntityIdLabel, value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    return parseEntityId(label, value);
}

/**
 * 抛出 400。
 */
const throwBadRequest = (message: string): never => {
    throw createError({
        statusCode: 400,
        message,
    });
};

/**
 * 将 Project manifest 映射为兼容现有前端的小说列表项。
 */
export function toNovelResponse(project: {projectPath: string; title: string; summary: string; updatedAt: string}): NovelListItemDto {
    const workspaceSlug = project.projectPath.split("/").at(-1) ?? project.projectPath;
    return {
        id: project.projectPath,
        title: project.title,
        summary: project.summary,
        workspaceSlug,
        projectPath: project.projectPath,
        createdAt: project.updatedAt,
        updatedAt: project.updatedAt,
        volumeCount: 0,
        chapterCount: 0,
        totalWords: 0,
    };
}

/**
 * 获取 Project Workspace 列表。
 */
export async function listNovels(): Promise<NovelListItemDto[]> {
    return (await listProjectWorkspaces()).map(toNovelResponse);
}

/**
 * 校验 Project Workspace 存在。
 */
export async function assertNovel(projectPath: string): Promise<NovelListItemDto> {
    const manifest = await readProjectManifest(projectPath);
    return toNovelResponse({
        projectPath,
        title: manifest.title,
        summary: manifest.summary,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * 读取 projectPath 路由参数。
 */
export function requireProjectPath(event: H3Event): string {
    const value = event.context.params?.projectPath ?? event.context.params?.novelId ?? "";
    if (!value.trim()) {
        throwBadRequest("projectPath 不能为空");
    }
    return decodeURIComponent(value);
}

/**
 * 读取 query 中的 projectPath。
 */
export function requireProjectPathQuery(event: H3Event): string {
    const query = getQuery(event);
    const value = query.projectPath;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
        throwBadRequest("projectPath query 不能为空");
    }
    return text;
}

/**
 * 统一校验请求体。
 */
export async function validateBody<T>(event: H3Event, schema: z.ZodSchema<T>): Promise<T> {
    const body = await readBody(event);
    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        consola.warn({
            method: event.method,
            path: event.path,
            body,
            issues: parseResult.error.issues,
        }, "请求体验证失败");
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
}

/**
 * 更新 Project manifest 基础信息。
 */
export async function updateNovelByTool(
    projectPath: string,
    input: UpdateNovelRequestDto,
): Promise<NovelListItemDto> {
    const current = await readProjectManifest(projectPath);
    const next = {
        ...current,
        title: input.title ?? current.title,
        summary: input.summary ?? current.summary,
    };
    await writeProjectManifest(projectPath, next);
    return toNovelResponse({
        projectPath,
        title: next.title,
        summary: next.summary,
        updatedAt: new Date().toISOString(),
    });
}
