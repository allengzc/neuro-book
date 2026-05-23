import {createError} from "h3";
import {
    ConfigWorkspaceQueryDtoSchema,
    type ConfigWorkspaceQueryDto,
} from "nbook/shared/dto/config.dto";

/**
 * 校验 config API query，并把 Zod 错误转换为 HTTP 400。
 */
export function validateConfigWorkspaceQuery(query: unknown): ConfigWorkspaceQueryDto {
    const parsed = ConfigWorkspaceQueryDtoSchema.safeParse(query);
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: parsed.error.issues[0]?.message ?? "配置请求参数不合法",
        });
    }
    return parsed.data;
}
