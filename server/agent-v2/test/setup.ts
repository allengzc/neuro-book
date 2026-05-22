const globalForAgentTest = globalThis as typeof globalThis & {
    defineEventHandler: typeof defineEventHandler;
    createError: typeof createError;
};

/**
 * Nitro 在运行时注入的全局 defineEventHandler。
 * 测试里直接退化为 identity，便于直接调用 handler。
 */
globalForAgentTest.defineEventHandler = ((handler: unknown) => handler) as typeof defineEventHandler;

/**
 * Nitro 在运行时注入的全局 createError。
 * 测试里返回带状态码的 Error 对象，便于断言。
 */
globalForAgentTest.createError = ((input: {statusCode?: number; message?: string}) => {
    const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
    error.statusCode = input.statusCode;
    return error;
}) as typeof createError;
