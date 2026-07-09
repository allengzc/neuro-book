import {isAbsolute} from "node:path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {WORKSPACE_NBOOK_ROOT} from "nbook/server/workspace-files/workspace-assets-root";

const MANAGED_PROJECT_PATH_PATTERN = /^workspace\/[^/]+$/u;

/**
 * 解析受 ProjectSession 管理的 Project Path。只有 workspace/<slug> 归一形纳入显式生命周期模型；
 * `workspace/.nbook` 是 user-assets（Workspace Root .nbook），属控制面资源而非 Project，恒排除。
 */
export function managedProjectPath(projectPathInput: string | undefined): string | null {
    const projectPath = projectPathInput?.trim().replaceAll("\\", "/").replace(/\/+$/u, "") ?? "";
    if (!projectPath || isAbsolute(projectPath) || !MANAGED_PROJECT_PATH_PATTERN.test(projectPath)) {
        return null;
    }
    if (projectPath === WORKSPACE_NBOOK_ROOT) {
        return null;
    }
    return projectPath;
}

/**
 * Project Workspace 数据面守卫。外部绝对路径、Workspace Root、user-assets 与旧式非 managed path 不属于当前 ProjectSession。
 */
export function assertManagedProjectDataPlaneOpen(projectPathInput: string | undefined): void {
    const projectPath = managedProjectPath(projectPathInput);
    if (!projectPath) {
        return;
    }
    assertProjectOpen(projectPath);
    markProjectActivity(projectPath);
}
