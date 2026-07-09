import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const WORKSPACE_CONTAINER_ROOT = "workspace";
export const WORKSPACE_NBOOK_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");

const SYSTEM_ASSETS_RELATIVE_ROOT = path.join("assets", "workspace", ".nbook");
const MODULE_APPLICATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type WorkspaceAssetRootContext = {
    applicationRoot?: string;
    systemNbookRoot?: string;
    workspaceContainerRoot?: string;
    userNbookRoot?: string;
};

let workspaceAssetRootContext: WorkspaceAssetRootContext | null = null;

/**
 * 测试专用：覆盖 Workspace assets 的真实磁盘 root。生产代码不应调用它。
 */
export function setWorkspaceAssetRootContextForTest(context: WorkspaceAssetRootContext | null): void {
    workspaceAssetRootContext = context ? normalizeWorkspaceAssetRootContext(context) : null;
}

/**
 * 测试专用：读取当前 Workspace assets root 覆盖值，用于嵌套隔离 fixture 恢复外层 context。
 */
export function getWorkspaceAssetRootContextForTest(): WorkspaceAssetRootContext | null {
    return workspaceAssetRootContext ? {...workspaceAssetRootContext} : null;
}

/**
 * 测试专用：在临时 root context 中执行任务，并在结束后恢复旧 context。
 */
export async function withWorkspaceAssetRootContextForTest<T>(context: WorkspaceAssetRootContext, task: () => Promise<T>): Promise<T> {
    const previous = workspaceAssetRootContext;
    setWorkspaceAssetRootContextForTest(context);
    try {
        return await task();
    } finally {
        workspaceAssetRootContext = previous;
    }
}

/**
 * 推断应用项目根目录，优先从当前 cwd 向上寻找系统 workspace assets。
 */
export function resolveApplicationRoot(startPath = process.cwd()): string {
    if (workspaceAssetRootContext?.applicationRoot) {
        return workspaceAssetRootContext.applicationRoot;
    }
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
    if (workspaceAssetRootContext?.systemNbookRoot) {
        return workspaceAssetRootContext.systemNbookRoot;
    }
    return path.join(resolveApplicationRoot(startPath), SYSTEM_ASSETS_RELATIVE_ROOT);
}

/**
 * 推断运行时 Workspace Root，兼容从项目根、Workspace Root 或 Project Workspace 内执行。
 */
export function resolveWorkspaceContainerRoot(startPath = process.cwd()): string {
    if (workspaceAssetRootContext?.workspaceContainerRoot) {
        return workspaceAssetRootContext.workspaceContainerRoot;
    }
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
    if (workspaceAssetRootContext?.userNbookRoot) {
        return workspaceAssetRootContext.userNbookRoot;
    }
    return path.join(resolveWorkspaceContainerRoot(startPath), ".nbook");
}

function normalizeWorkspaceAssetRootContext(context: WorkspaceAssetRootContext): WorkspaceAssetRootContext {
    return {
        applicationRoot: context.applicationRoot ? path.resolve(context.applicationRoot) : undefined,
        systemNbookRoot: context.systemNbookRoot ? path.resolve(context.systemNbookRoot) : undefined,
        workspaceContainerRoot: context.workspaceContainerRoot ? path.resolve(context.workspaceContainerRoot) : undefined,
        userNbookRoot: context.userNbookRoot ? path.resolve(context.userNbookRoot) : undefined,
    };
}
