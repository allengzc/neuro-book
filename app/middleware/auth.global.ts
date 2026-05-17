import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

/**
 * 前端路由鉴权，只负责页面跳转体验。
 */
export default defineNuxtRouteMiddleware(async (to) => {
    const normalizeRedirect = (value: unknown): string => {
        if (typeof value !== "string") {
            return "/";
        }
        const trimmed = value.trim();
        return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : "/";
    };

    if (to.path === "/login") {
        const session = await $fetch<AuthSessionDto>("/api/auth/me").catch(() => ({authEnabled: true, user: null}));
        if (!session.authEnabled || session.user) {
            return navigateTo(normalizeRedirect(to.query.redirect));
        }
        return;
    }

    const session = await $fetch<AuthSessionDto>("/api/auth/me").catch(() => ({authEnabled: true, user: null}));
    if (!session.authEnabled) {
        return;
    }

    if (!session.user) {
        return navigateTo({
            path: "/login",
            query: {
                redirect: to.fullPath,
            },
        });
    }

    if (to.path.startsWith("/admin") && session.user.role !== "admin") {
        throw createError({
            statusCode: 403,
            message: "需要管理员权限",
        });
    }
});
