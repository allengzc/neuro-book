import {getCurrentUser, isAuthEnabled} from "nbook/server/utils/auth";

const publicApiPaths = new Set([
    "/api/app/version",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/_auth/session",
]);

/**
 * 判断当前路径是否不需要鉴权。
 */
export function isPublicPath(pathname: string): boolean {
    if (pathname === "/login") {
        return true;
    }
    if (publicApiPaths.has(pathname)) {
        return true;
    }
    if (pathname.startsWith("/_nuxt/") || pathname.startsWith("/__nuxt")) {
        return true;
    }
    if (pathname === "/favicon.ico" || pathname === "/robots.txt") {
        return true;
    }
    return /\.(?:css|js|mjs|map|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(pathname);
}

/**
 * 判断当前请求是否是 API 请求。
 */
function isApiRequest(pathname: string): boolean {
    return pathname.startsWith("/api/");
}

/**
 * 全站服务端鉴权守卫。
 */
export default defineEventHandler(async (event) => {
    if (!isAuthEnabled()) {
        return;
    }

    const url = getRequestURL(event);
    const pathname = url.pathname;
    if (isPublicPath(pathname)) {
        return;
    }

    const user = await getCurrentUser(event);
    if (user) {
        return;
    }

    if (isApiRequest(pathname)) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }

    const redirectTarget = `${url.pathname}${url.search}`;
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(redirectTarget)}`, 302);
});
