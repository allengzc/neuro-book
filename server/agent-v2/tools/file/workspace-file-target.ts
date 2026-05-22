import path from "node:path";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {workspacePathExists} from "nbook/server/workspace-files/workspace-files";

export type AgentFileTarget = {
    root: string;
    filePath: string;
};

/**
 * 将 Agent 看到的文件路径解析到真实工作区根。
 */
export async function resolveAgentFileTarget(context: AgentToolContext, filePath: string): Promise<AgentFileTarget> {
    const workspaceRoot = typeof context.getScope === "function" ? context.getScope().studio.workspace : null;
    const normalizedPath = filePath.replace(/\\/g, "/");
    if (!workspaceRoot) {
        return {root: ".", filePath};
    }

    const normalizedWorkspaceRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    if (path.isAbsolute(filePath)) {
        return resolveAbsoluteAgentFileTarget(filePath, normalizedWorkspaceRoot);
    }
    if (isWorkspaceContainerPath(normalizedPath)) {
        return {root: ".", filePath: normalizedPath};
    }
    if (isActiveWorkspaceContentPath(normalizedPath)) {
        return {
            root: normalizedWorkspaceRoot,
            filePath: normalizedPath,
        };
    }
    if (await workspacePathExists(normalizedWorkspaceRoot, normalizedPath)) {
        return {
            root: normalizedWorkspaceRoot,
            filePath: normalizedPath,
        };
    }
    if (await workspacePathExists("workspace", normalizedPath)) {
        return {
            root: "workspace",
            filePath: normalizedPath,
        };
    }

    return {root: ".", filePath};
}

/**
 * 解析工具资源键，供 read-before-write 校验使用。
 */
export async function resolveAgentFileResourceKey(context: AgentToolContext, filePath: string): Promise<string> {
    const target = await resolveAgentFileTarget(context, filePath);
    return path.resolve(process.cwd(), target.root, target.filePath);
}

/**
 * 判断相对路径是否直接指向当前小说 workspace 内的内容根。
 */
function isActiveWorkspaceContentPath(normalizedPath: string): boolean {
    return normalizedPath.startsWith("lorebook/")
        || normalizedPath.startsWith("manuscript/");
}

/**
 * 判断相对路径是否显式指向 workspace 容器。
 */
function isWorkspaceContainerPath(normalizedPath: string): boolean {
    return normalizedPath === "workspace" || normalizedPath.startsWith("workspace/");
}

/**
 * 解析项目内绝对路径。
 */
function resolveAbsoluteAgentFileTarget(filePath: string, workspaceRoot: string): AgentFileTarget {
    const absolutePath = path.resolve(filePath);
    const projectRoot = process.cwd();
    const currentWorkspaceRoot = path.resolve(projectRoot, workspaceRoot);

    if (absolutePath === currentWorkspaceRoot || absolutePath.startsWith(`${currentWorkspaceRoot}${path.sep}`)) {
        return {
            root: workspaceRoot,
            filePath: path.relative(currentWorkspaceRoot, absolutePath).split(path.sep).join("/") || ".",
        };
    }

    return {
        root: ".",
        filePath,
    };
}
