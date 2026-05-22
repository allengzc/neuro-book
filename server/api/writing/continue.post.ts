import {
    NovelContinueRequestDtoSchema,
    type NovelContinueRequestDto,
} from "nbook/shared/dto/novel.dto";

/**
 * 校验续写请求参数，非法时直接抛出 HTTP 错误。
 */
const validateBody = (body: unknown): NovelContinueRequestDto => {
    const parseResult = NovelContinueRequestDtoSchema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
};

/**
 * AI 小说续写流式接口：
 * - 请求体：{ content, requirement }
 * - 返回：SSE(token/done/error)
 */
export default defineEventHandler(async (event) => {
    const body = await readBody(event);
    validateBody(body);
    throw createError({
        statusCode: 501,
        statusMessage: "Writing continue API disabled",
        message: "旧小说续写接口依赖 LangChain provider，已在 Agent v3 迁移中禁用；后续会改接 Pi provider。",
    });
});
