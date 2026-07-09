import {access, constants} from "node:fs";
import {homedir} from "node:os";
import {isAbsolute, resolve} from "node:path";
import {promisify} from "node:util";

const accessAsync = promisify(access);

/**
 * 解析模型传入的路径。普通 Project agent 的 cwd 是 Workspace Root；
 * `workspace/<project>/...` 作为完整 Project Path 输入时会归一到 `<project>/...`。
 */
export function resolveWorkspacePath(filePath: string, workspaceRoot: string, projectPath?: string): string {
    const expanded = expandPath(filePath);
    if (isAbsolute(expanded)) {
        return expanded;
    }
    return resolve(workspaceRoot, normalizeWorkspaceAlias(expanded, workspaceRoot, projectPath));
}

/**
 * 检测常见图片 MIME 类型。
 */
export function detectImageMimeType(filePath: string): string | null {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".png")) {
        return "image/png";
    }
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        return "image/jpeg";
    }
    if (lower.endsWith(".gif")) {
        return "image/gif";
    }
    if (lower.endsWith(".webp")) {
        return "image/webp";
    }
    return null;
}

/**
 * 确认路径可读。
 */
export async function assertReadable(filePath: string): Promise<void> {
    await accessAsync(filePath, constants.R_OK);
}

/**
 * 确认路径可读写。
 */
export async function assertWritable(filePath: string): Promise<void> {
    await accessAsync(filePath, constants.R_OK | constants.W_OK);
}

/**
 * 生成简短 unified diff，供 edit/apply_patch details 使用。
 */
export function firstChangedLine(diffText: string): number | undefined {
    const hunk = diffText.split("\n").find((line) => line.startsWith("@@"));
    const match = /\+(\d+)/.exec(hunk ?? "");
    return match ? Number(match[1]) : undefined;
}

function expandPath(filePath: string): string {
    const normalized = filePath.startsWith("@") ? filePath.slice(1) : filePath;
    if (normalized === "~") {
        return homedir();
    }
    if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
        return homedir() + normalized.slice(1);
    }
    return normalized;
}

function normalizeWorkspaceAlias(filePath: string, workspaceRoot: string, projectPath?: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const workspaceRootIsContainer = isWorkspaceContainerRoot(workspaceRoot);
    if (workspaceRootIsContainer && (normalizedPath === "workspace" || normalizedPath.startsWith("workspace/"))) {
        return stripWorkspaceContainer(normalizedPath);
    }
    const normalizedProjectPath = projectPath?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (normalizedProjectPath && isSameWorkspaceAlias(normalizedPath, normalizedProjectPath)) {
        return workspaceRootIsContainer
            ? stripWorkspaceContainer(normalizedPath)
            : stripWorkspaceRoot(normalizedPath, normalizedProjectPath);
    }
    const inferredProjectPath = inferProjectPath(workspaceRoot);
    if (inferredProjectPath && isSameWorkspaceAlias(normalizedPath, inferredProjectPath)) {
        return stripWorkspaceRoot(normalizedPath, inferredProjectPath);
    }
    if (isCurrentWorkspaceAlias(normalizedPath) && isProjectWorkspaceRoot(workspaceRoot)) {
        return normalizedPath.slice("workspace/".length);
    }
    return filePath;
}

function isSameWorkspaceAlias(filePath: string, workspacePath: string): boolean {
    return filePath === workspacePath || filePath.startsWith(`${workspacePath}/`);
}

function isCurrentWorkspaceAlias(filePath: string): boolean {
    return filePath === "workspace/lorebook"
        || filePath.startsWith("workspace/lorebook/")
        || filePath === "workspace/manuscript"
        || filePath.startsWith("workspace/manuscript/")
        || filePath === "workspace/.agent"
        || filePath.startsWith("workspace/.agent/");
}

function stripWorkspaceRoot(filePath: string, workspacePath: string): string {
    return filePath === workspacePath ? "." : filePath.slice(workspacePath.length + 1);
}

function stripWorkspaceContainer(filePath: string): string {
    return filePath === "workspace" ? "." : filePath.slice("workspace/".length);
}

function isWorkspaceContainerRoot(workspaceRoot: string): boolean {
    const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/g, "");
    return normalizedRoot.split("/").filter(Boolean).at(-1) === "workspace";
}

function inferProjectPath(workspaceRoot: string): string | null {
    const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/g, "");
    const segments = normalizedRoot.split("/").filter(Boolean);
    const workspaceIndex = segments.lastIndexOf("workspace");
    if (workspaceIndex < 0 || !segments[workspaceIndex + 1] || segments[workspaceIndex + 2]) {
        return null;
    }
    return `workspace/${segments[workspaceIndex + 1]}`;
}

function isProjectWorkspaceRoot(workspaceRoot: string): boolean {
    return Boolean(inferProjectPath(workspaceRoot));
}
