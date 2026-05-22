import {createError} from "h3";
import {WorkspaceSettingsQueryDtoSchema, type WorkspaceSettingsQueryDto} from "nbook/shared/dto/workspace-settings.dto";

/**
 * 校验 workspace settings query，并把 Zod 错误转换为 HTTP 400。
 */
export function validateWorkspaceSettingsQuery(query: unknown): WorkspaceSettingsQueryDto {
    const parsed = WorkspaceSettingsQueryDtoSchema.safeParse(query);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "请求参数不合法",
        });
    }
    return parsed.data;
}
