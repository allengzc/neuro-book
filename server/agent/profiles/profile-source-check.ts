import {randomUUID} from "node:crypto";
import {cp, mkdir, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, relative, resolve, sep} from "node:path";
import {createError} from "h3";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";

const DEFAULT_SYSTEM_PROFILE_ROOT = resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const DEFAULT_USER_PROFILE_ROOT = resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles");
const PROFILE_SOURCE_CHECK_ROOT = resolve(process.cwd(), ".agent", "workspace", "profile-source-check");

export type ProfileSourceCheckRoots = {
    systemProfileRoot?: string;
    userProfileRoot?: string;
};

/**
 * 在临时用户 profile root 中覆盖指定源码，并用真实 catalog loader 执行校验。
 */
export async function withProfileSourceOverride<T>(
    input: {
        fileName: string;
        source: string;
        roots?: ProfileSourceCheckRoots;
    },
    callback: (catalog: AgentProfileCatalog, userProfileRoot: string) => Promise<T>,
): Promise<T> {
    const sourceRoot = input.roots?.userProfileRoot ?? DEFAULT_USER_PROFILE_ROOT;
    const systemRoot = input.roots?.systemProfileRoot ?? DEFAULT_SYSTEM_PROFILE_ROOT;
    const temporaryRoot = resolve(PROFILE_SOURCE_CHECK_ROOT, randomUUID());
    try {
        if (existsSync(sourceRoot)) {
            await cp(sourceRoot, temporaryRoot, {recursive: true, force: true});
        }
        const targetPath = resolveProfileFilePath(input.fileName, temporaryRoot);
        await mkdir(dirname(targetPath), {recursive: true});
        await writeFile(targetPath, input.source, "utf8");
        const catalog = new AgentProfileCatalog(systemRoot, temporaryRoot, resolve(temporaryRoot, ".profile-module-cache"));
        return await callback(catalog, temporaryRoot);
    } finally {
        await rm(temporaryRoot, {recursive: true, force: true});
    }
}

/**
 * 将受控 fileName 解析到指定 profile root 内。
 */
function resolveProfileFilePath(fileName: string, root: string): string {
    const normalized = fileName.split(/[\\/]+/).filter(Boolean).join(sep);
    if (!/\.profile\.(tsx|ts|mjs|js)$/.test(normalized) || /^[A-Za-z]:/.test(fileName) || fileName.startsWith("/") || fileName.startsWith("\\")) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile fileName 必须是用户 profile root 下的相对路径。",
        });
    }
    const resolved = resolve(root, normalized);
    const relativePath = relative(root, resolved);
    if (!normalized || relativePath.startsWith("..") || /^[A-Za-z]:/.test(relativePath)) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile fileName 必须是用户 profile root 下的相对路径。",
        });
    }
    return resolved;
}
