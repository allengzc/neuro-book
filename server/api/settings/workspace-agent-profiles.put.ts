/**
 * 旧 workspace 默认 profile 设置 API 已等待迁移到 Agent v3。
 */
export default defineEventHandler(() => {
    throw createError({
        statusCode: 501,
        statusMessage: "Workspace agent profile settings API removed",
        message: "旧 workspace 默认 profile 设置接口已移除；后续会接入 Agent v3 profile catalog。",
    });
});
