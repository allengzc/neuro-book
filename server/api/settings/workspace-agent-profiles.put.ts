/**
 * 旧 workspace 默认 profile 设置 API 已等待迁移到新 Agent profile catalog。
 */
export default defineEventHandler(() => {
    throw createError({
        statusCode: 501,
        statusMessage: "Workspace agent profile settings API removed",
        message: "旧 workspace 默认 profile 设置接口已移除；后续会接入新 Agent profile catalog。",
    });
});
