import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import type {Novel, Prisma, PrismaClient} from "nbook/server/generated/prisma/client";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const WORKSPACE_CONTAINER_ROOT = "workspace";
export const USER_ASSETS_WORKSPACE_KIND = "user-assets";
export const USER_ASSETS_WORKSPACE_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
export const USER_NBOOK_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
export const DEFAULT_NOVEL_WORKSPACE_ID = "1";
export const DEFAULT_NOVEL_WORKSPACE_SLUG = "silver-dragon-hime";

const SYSTEM_WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/workspace");
const SYSTEM_NBOOK_ROOT = path.join(SYSTEM_WORKSPACE_ROOT, ".nbook");
const SYSTEM_PROFILE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "agent", "profiles");
const USER_PROFILE_ROOT = path.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "profiles");
const SYSTEM_PROFILE_METADATA_PATH = path.join(SYSTEM_PROFILE_ROOT, ".system-profile-metadata.json");
const USER_PROFILE_SYNC_STATE_PATH = path.join(USER_PROFILE_ROOT, ".profile-sync-state.json");
const NOVEL_DIRECTORY_TEMPLATE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "templates", "novel-directory-templates");
const USER_NOVEL_DIRECTORY_TEMPLATE_ROOT = path.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT, "templates", "novel-directory-templates");

export type NovelWorkspaceMetadata = {
    schemaVersion: 1;
    slug: string;
    displayName: string;
    novelId: string;
    createdAt: string;
    updatedAt: string;
};

export type WorkspaceRootKind = "novel" | typeof USER_ASSETS_WORKSPACE_KIND;
export type UserAssetsSyncResult = {
    copied: number;
    skipped: number;
    updatedProfiles?: number;
    profileWarnings?: UserAssetsProfileSyncWarning[];
};

export type UserAssetsProfileSyncWarning = {
    fileName: string;
    profileKey: string;
    message: string;
};

export type SystemProfileMetadata = {
    generatedAt: string;
    profilesRoot: string;
    profiles: SystemProfileMetadataItem[];
};

export type SystemProfileMetadataItem = {
    fileName: string;
    profileKey: string;
    sha256: string;
    bytes: number;
};

type UserProfileSyncState = {
    profiles: UserProfileSyncStateItem[];
};

type UserProfileSyncStateItem = {
    fileName: string;
    profileKey: string;
    upstreamHash: string;
    lastSyncedUserHash: string;
    syncedAt: string;
};

/**
 * 将小说 workspace slug 归一成安全目录名。
 */
export function normalizeWorkspaceSlug(value: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "novel";
}

/**
 * 根据标题生成基础 workspace slug。中文标题无法转写时回落到 novel。
 */
export function buildWorkspaceSlugBase(title: string): string {
    return normalizeWorkspaceSlug(title);
}

/**
 * 返回指定 Novel 的 workspace 根目录，格式为 workspace/<workspaceSlug>。
 */
export async function resolveNovelWorkspaceRoot(prismaClient: PrismaExecutor, novelIdInput: string): Promise<string> {
    const novelId = parseEntityId("novelId", novelIdInput);
    const novel = await prismaClient.novel.findUnique({
        where: {id: novelId},
        select: {workspaceSlug: true},
    });

    if (!novel) {
        throw createError({statusCode: 404, message: "小说不存在"});
    }

    return path.posix.join(WORKSPACE_CONTAINER_ROOT, novel.workspaceSlug);
}

/**
 * 优先使用显式 root；未指定 root 时按 novelId 解析小说 workspace。
 */
export async function resolveWorkspaceRootInput(
    prismaClient: PrismaExecutor,
    input: {root?: string; novelId?: string; workspaceKind?: WorkspaceRootKind},
): Promise<string | undefined> {
    if (input.workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        await ensureUserAssetsWorkspaceRoot();
        return USER_ASSETS_WORKSPACE_ROOT;
    }
    if (input.root?.trim()) {
        return input.root.trim();
    }
    if (input.novelId?.trim()) {
        return resolveNovelWorkspaceRoot(prismaClient, input.novelId);
    }
    return undefined;
}

/**
 * 确保全局用户 assets 工作区存在。
 */
export async function ensureUserAssetsWorkspaceRoot(): Promise<string> {
    const workspaceRoot = path.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT);
    await fs.mkdir(workspaceRoot, {recursive: true});
    return USER_ASSETS_WORKSPACE_ROOT;
}

/**
 * 将系统 assets 中缺失的文件补到用户 assets，不覆盖用户已经编辑过的文件。
 */
export async function syncSystemAssetsToUserAssets(): Promise<UserAssetsSyncResult> {
    await ensureUserAssetsWorkspaceRoot();
    const nbookTargetRoot = path.resolve(process.cwd(), USER_NBOOK_ROOT);
    const result: UserAssetsSyncResult = {copied: 0, skipped: 0, updatedProfiles: 0, profileWarnings: []};
    if (await isDirectory(SYSTEM_NBOOK_ROOT)) {
        await copyMissingAssetEntries(SYSTEM_NBOOK_ROOT, nbookTargetRoot, result);
    }
    await syncSystemProfilesToUserAssets(result, nbookTargetRoot);
    return result;
}

/**
 * 读取系统 profile metadata。不存在时返回空 metadata，兼容开发期首次生成前的状态。
 */
export async function readSystemProfileMetadata(): Promise<SystemProfileMetadata> {
    try {
        return JSON.parse(await fs.readFile(SYSTEM_PROFILE_METADATA_PATH, "utf-8")) as SystemProfileMetadata;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {
                generatedAt: new Date(0).toISOString(),
                profilesRoot: "assets/workspace/.nbook/agent/profiles",
                profiles: [],
            };
        }
        throw error;
    }
}

/**
 * 计算文件 sha256。系统 profile metadata 与用户 sync state 共用这一判断。
 */
export async function sha256File(filePath: string): Promise<{sha256: string; bytes: number}> {
    const buffer = await fs.readFile(filePath);
    return {
        sha256: createHash("sha256").update(buffer).digest("hex"),
        bytes: buffer.byteLength,
    };
}

/**
 * 给新小说分配唯一 workspace slug。当前快速开发阶段优先使用 novel-<id>。
 */
export function buildNovelIdWorkspaceSlug(novelId: number): string {
    if (novelId === 1) {
        return DEFAULT_NOVEL_WORKSPACE_SLUG;
    }
    return `novel-${String(novelId)}`;
}

/**
 * 写入 workspace.yaml 元数据。该文件用于人工识别与后续扩展，运行时绑定仍以数据库为准。
 */
export async function writeNovelWorkspaceMetadata(novel: Pick<Novel, "id" | "workspaceSlug" | "createdAt" | "updatedAt">): Promise<void> {
    const workspaceRoot = path.resolve(process.cwd(), WORKSPACE_CONTAINER_ROOT, novel.workspaceSlug);
    const metadata: NovelWorkspaceMetadata = {
        schemaVersion: 1,
        slug: novel.workspaceSlug,
        displayName: novel.workspaceSlug,
        novelId: String(novel.id),
        createdAt: novel.createdAt.toISOString(),
        updatedAt: novel.updatedAt.toISOString(),
    };

    await fs.mkdir(workspaceRoot, {recursive: true});
    await copyNovelDirectoryTemplate(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "workspace.yaml"), renderWorkspaceMetadata(metadata), "utf-8");
}

/**
 * 把小说目录脚手架复制到 workspace，只补缺失文件，不覆盖用户已编辑内容。
 */
export async function copyNovelDirectoryTemplate(workspaceRoot: string): Promise<void> {
    const mergedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-novel-template-"));
    try {
        await fs.cp(NOVEL_DIRECTORY_TEMPLATE_ROOT, mergedRoot, {
            recursive: true,
            force: true,
            errorOnExist: false,
        });
        if (await isDirectory(USER_NOVEL_DIRECTORY_TEMPLATE_ROOT)) {
            await fs.cp(USER_NOVEL_DIRECTORY_TEMPLATE_ROOT, mergedRoot, {
                recursive: true,
                force: true,
                errorOnExist: false,
            });
        }
        await fs.cp(mergedRoot, workspaceRoot, {
            recursive: true,
            force: false,
            errorOnExist: false,
        });
    } finally {
        await fs.rm(mergedRoot, {recursive: true, force: true});
    }
}

/**
 * 递归复制缺失资源；已存在的用户文件只统计为 skipped。
 */
async function copyMissingAssetEntries(sourceRoot: string, targetRoot: string, result: UserAssetsSyncResult): Promise<void> {
    const entries = await fs.readdir(sourceRoot, {withFileTypes: true});
    await fs.mkdir(targetRoot, {recursive: true});

    for (const entry of entries) {
        const sourcePath = path.join(sourceRoot, entry.name);
        const targetPath = path.join(targetRoot, entry.name);
        if (entry.isDirectory()) {
            await copyMissingAssetEntries(sourcePath, targetPath, result);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }

        try {
            await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
            result.copied += 1;
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
                result.skipped += 1;
                continue;
            }
            throw error;
        }
    }
}

async function syncSystemProfilesToUserAssets(result: UserAssetsSyncResult, nbookTargetRoot: string): Promise<void> {
    const metadata = await readSystemProfileMetadata();
    if (metadata.profiles.length === 0) {
        return;
    }
    const syncState = await readUserProfileSyncState();
    let stateChanged = false;
    for (const item of metadata.profiles) {
        const systemPath = path.join(SYSTEM_PROFILE_ROOT, item.fileName);
        const userPath = path.join(USER_PROFILE_ROOT, item.fileName);
        const stateItem = syncState.profiles.find((profile) => profile.fileName === item.fileName);
        if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
            const hash = await sha256File(userPath);
            upsertUserProfileSyncState(syncState, item, hash.sha256);
            stateChanged = true;
            continue;
        }
        if (!await pathExists(userPath)) {
            await fs.mkdir(path.dirname(userPath), {recursive: true});
            await fs.copyFile(systemPath, userPath);
            const hash = await sha256File(userPath);
            upsertUserProfileSyncState(syncState, item, hash.sha256);
            result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
            stateChanged = true;
            continue;
        }
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            upsertUserProfileSyncState(syncState, item, currentUserHash);
            stateChanged = true;
            continue;
        }
        if (!stateItem) {
            result.profileWarnings?.push({
                fileName: item.fileName,
                profileKey: item.profileKey,
                message: `系统 profile ${item.profileKey} 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。`,
            });
            continue;
        }
        if (currentUserHash !== stateItem.lastSyncedUserHash) {
            if (item.sha256 !== stateItem.upstreamHash) {
                result.profileWarnings?.push({
                    fileName: item.fileName,
                    profileKey: item.profileKey,
                    message: `系统 profile ${item.profileKey} 已更新，但用户覆盖已手改，未自动覆盖。`,
                });
            }
            continue;
        }
        if (item.sha256 === stateItem.upstreamHash) {
            continue;
        }
        await fs.copyFile(systemPath, userPath);
        const hash = await sha256File(userPath);
        upsertUserProfileSyncState(syncState, item, hash.sha256);
        result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
        stateChanged = true;
    }
    if (stateChanged) {
        await writeUserProfileSyncState(syncState);
    }
    await removeCopiedSystemMetadata(nbookTargetRoot);
}

async function readUserProfileSyncState(): Promise<UserProfileSyncState> {
    try {
        return JSON.parse(await fs.readFile(USER_PROFILE_SYNC_STATE_PATH, "utf-8")) as UserProfileSyncState;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {profiles: []};
        }
        throw error;
    }
}

async function writeUserProfileSyncState(syncState: UserProfileSyncState): Promise<void> {
    await fs.mkdir(path.dirname(USER_PROFILE_SYNC_STATE_PATH), {recursive: true});
    await fs.writeFile(USER_PROFILE_SYNC_STATE_PATH, `${JSON.stringify(syncState, null, 2)}\n`, "utf-8");
}

function upsertUserProfileSyncState(syncState: UserProfileSyncState, metadata: SystemProfileMetadataItem, userHash: string): void {
    const next: UserProfileSyncStateItem = {
        fileName: metadata.fileName,
        profileKey: metadata.profileKey,
        upstreamHash: metadata.sha256,
        lastSyncedUserHash: userHash,
        syncedAt: new Date().toISOString(),
    };
    const index = syncState.profiles.findIndex((item) => item.fileName === metadata.fileName);
    if (index >= 0) {
        syncState.profiles[index] = next;
    } else {
        syncState.profiles.push(next);
    }
    syncState.profiles.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function sameFile(leftPath: string, rightPath: string): Promise<boolean> {
    if (!await pathExists(leftPath) || !await pathExists(rightPath)) {
        return false;
    }
    const [left, right] = await Promise.all([
        sha256File(leftPath),
        sha256File(rightPath),
    ]);
    return left.sha256 === right.sha256;
}

async function removeCopiedSystemMetadata(nbookTargetRoot: string): Promise<void> {
    const copiedMetadataPath = path.join(nbookTargetRoot, "agent", "profiles", ".system-profile-metadata.json");
    if (copiedMetadataPath === SYSTEM_PROFILE_METADATA_PATH) {
        return;
    }
    await fs.rm(copiedMetadataPath, {force: true});
}

/**
 * 判断路径是否为目录。
 */
async function isDirectory(directoryPath: string): Promise<boolean> {
    try {
        return (await fs.stat(directoryPath)).isDirectory();
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

/**
 * 渲染最小 workspace 元数据 YAML。
 */
function renderWorkspaceMetadata(metadata: NovelWorkspaceMetadata): string {
    return [
        "schemaVersion: 1",
        `slug: ${metadata.slug}`,
        `displayName: ${metadata.displayName}`,
        `novelId: "${metadata.novelId}"`,
        `createdAt: "${metadata.createdAt}"`,
        `updatedAt: "${metadata.updatedAt}"`,
        "",
    ].join("\n");
}
