import {access, constants} from "node:fs";
import {homedir} from "node:os";
import {isAbsolute, resolve} from "node:path";
import {promisify} from "node:util";

const accessAsync = promisify(access);

/**
 * 解析模型传入的路径。v3 第一版不做 workspaceRoot 沙箱，只把相对路径绑定到 workspaceRoot。
 */
export function resolveWorkspacePath(filePath: string, workspaceRoot: string): string {
    const expanded = expandPath(filePath);
    return isAbsolute(expanded) ? expanded : resolve(workspaceRoot, expanded);
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
