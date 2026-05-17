/**
 * 清理当前登录 session。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    await clearUserSession(event);
    return {ok: true};
});
