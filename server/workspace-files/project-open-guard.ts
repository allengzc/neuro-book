import {createError} from "h3";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {assertManagedProjectDataPlaneOpen} from "nbook/server/workspace-files/project-data-plane-guard";

/**
 * 路由层 Project open 守卫：只有 `workspace/<slug>` 形式的 Project Workspace root 需要显式 open。
 * Workspace Root、user-assets 与绝对路径 root 都是控制面或非 Project 资源，按生命周期模型放行。
 */
export function assertProjectOpenForRoot(rootInput: string | undefined): void {
    const root = normalizeRootInput(rootInput);
    try {
        assertManagedProjectDataPlaneOpen(root);
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}

/**
 * 将 ProjectSession typed error 映射为稳定 HTTP 409，供 Nitro route handler 返回给前端。
 */
export function createProjectNotOpenHttpError(error: ProjectNotOpenError): Error {
    return createError({
        statusCode: 409,
        statusMessage: "Project not open",
        message: error.message,
        data: {
            code: "PROJECT_NOT_OPEN",
            projectPath: error.projectPath,
        },
    });
}

/**
 * 路由层 typed error wrapper：业务层只抛 ProjectNotOpenError，HTTP 层统一映射为稳定 409。
 */
export async function withProjectNotOpenHttpError<T>(handler: () => Promise<T> | T): Promise<T> {
    try {
        return await handler();
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
}

/**
 * 归一化 root 输入，保持与 workspace tree index 的 `workspace/<slug>` 判定一致。
 */
function normalizeRootInput(rootInput: string | undefined): string {
    return (rootInput?.trim() || "workspace").replace(/\\/g, "/").replace(/\/+$/u, "");
}
