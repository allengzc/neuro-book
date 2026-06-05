import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const WORKSPACE_CONTAINER_ROOT = "workspace";
export const WORKSPACE_NBOOK_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");

const SYSTEM_ASSETS_RELATIVE_ROOT = path.join("assets", "workspace", ".nbook");
const MODULE_APPLICATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 推断应用项目根目录，优先从当前 cwd 向上寻找系统 workspace assets。
 */
export function resolveApplicationRoot(startPath = process.cwd()): string {
    let currentPath = path.resolve(startPath);
    while (true) {
        if (fs.existsSync(path.join(currentPath, SYSTEM_ASSETS_RELATIVE_ROOT))) {
            return currentPath;
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            break;
        }
        currentPath = parentPath;
    }

    if (fs.existsSync(path.join(MODULE_APPLICATION_ROOT, SYSTEM_ASSETS_RELATIVE_ROOT))) {
        return MODULE_APPLICATION_ROOT;
    }
    return path.resolve(startPath);
}

/**
 * 解析随应用发布的系统 Workspace Root `.nbook` 模板层。
 */
export function resolveSystemNbookRoot(startPath = process.cwd()): string {
    return path.join(resolveApplicationRoot(startPath), SYSTEM_ASSETS_RELATIVE_ROOT);
}

/**
 * 推断运行时 Workspace Root，兼容从项目根、Workspace Root 或 Project Workspace 内执行。
 */
export function resolveWorkspaceContainerRoot(startPath = process.cwd()): string {
    const cwd = path.resolve(startPath);
    let currentPath = cwd;
    while (true) {
        if (path.basename(currentPath) === WORKSPACE_CONTAINER_ROOT) {
            return currentPath;
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            break;
        }
        currentPath = parentPath;
    }

    return path.join(resolveApplicationRoot(startPath), WORKSPACE_CONTAINER_ROOT);
}

/**
 * 解析运行时 Workspace Root `.nbook` 用户覆盖层。
 */
export function resolveUserNbookRoot(startPath = process.cwd()): string {
    return path.join(resolveWorkspaceContainerRoot(startPath), ".nbook");
}
