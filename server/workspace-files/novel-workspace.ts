import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {readProfileArtifactManifest, rehomeProfileArtifactItem} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {readVariableDefinitionManifest} from "nbook/server/agent/variables/definition-artifact";
import {normalizeProjectPath, readProjectManifest} from "nbook/server/workspace-files/project-workspace";

export const WORKSPACE_CONTAINER_ROOT = "workspace";
export const USER_ASSETS_WORKSPACE_KIND = "user-assets";
export const USER_ASSETS_WORKSPACE_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
export const USER_NBOOK_ROOT = path.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
export const DEFAULT_NOVEL_WORKSPACE_SLUG = "silver-dragon-hime";

const SYSTEM_WORKSPACE_ROOT = path.resolve(process.cwd(), "assets", "workspace");
const SYSTEM_NBOOK_ROOT = path.join(SYSTEM_WORKSPACE_ROOT, ".nbook");
const SYSTEM_PROFILE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "agent", "profiles");
const USER_PROFILE_ROOT = path.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "profiles");
const SYSTEM_VARIABLE_DEFINITION_ROOT = path.join(SYSTEM_NBOOK_ROOT, "agent", "variables");
const USER_VARIABLE_DEFINITION_ROOT = path.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "variables");
const SYSTEM_WRITING_PRESETS_ROOT = path.join(SYSTEM_NBOOK_ROOT, "agent", "writing-presets");
const USER_WRITING_PRESETS_ROOT = path.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "writing-presets");
const SYSTEM_PROFILE_METADATA_PATH = path.join(SYSTEM_PROFILE_ROOT, ".system-profile-metadata.json");
const USER_PROFILE_SYNC_STATE_PATH = path.join(USER_PROFILE_ROOT, ".profile-sync-state.json");
const NOVEL_DIRECTORY_TEMPLATE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "templates", "novel-directory-templates");
const USER_NOVEL_DIRECTORY_TEMPLATE_ROOT = path.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT, "templates", "novel-directory-templates");

export type WorkspaceRootKind = "novel" | typeof USER_ASSETS_WORKSPACE_KIND;
export type UserAssetsSyncResult = {
    copied: number;
    skipped: number;
    updatedProfiles?: number;
    profileWarnings?: UserAssetsProfileSyncWarning[];
    updatedAssets?: number;
    assetWarnings?: UserAssetsAssetSyncWarning[];
};

export type UserAssetsProfileSyncWarning = {
    fileName: string;
    profileKey: string;
    message: string;
};

export type UserAssetsAssetSyncWarning = {
    assetPath: string;
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
    assets?: UserAssetSyncStateItem[];
};

type UserProfileSyncStateItem = {
    fileName: string;
    profileKey: string;
    upstreamHash: string;
    lastSyncedUserHash: string;
    syncedAt: string;
};

type UserAssetSyncStateItem = {
    assetPath: string;
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
 * 返回指定 Project Path 的 Project Workspace 根目录。
 */
export async function resolveNovelWorkspaceRoot(projectPathInput: string): Promise<string> {
    const projectPath = normalizeProjectPath(projectPathInput);
    await readProjectManifest(projectPath);
    return projectPath;
}

/**
 * 按 projectPath 解析 Project Workspace；user-assets 只允许通过 workspaceKind 显式选择。
 */
export async function resolveWorkspaceRootInput(
    input: {projectPath?: string; workspaceKind?: WorkspaceRootKind},
): Promise<string | undefined> {
    if (input.workspaceKind === USER_ASSETS_WORKSPACE_KIND) {
        await ensureUserAssetsWorkspaceRoot();
        return USER_ASSETS_WORKSPACE_ROOT;
    }
    if (input.projectPath?.trim()) {
        return resolveNovelWorkspaceRoot(input.projectPath);
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
    const result: UserAssetsSyncResult = {copied: 0, skipped: 0, updatedProfiles: 0, profileWarnings: [], updatedAssets: 0, assetWarnings: []};
    if (await isDirectory(SYSTEM_NBOOK_ROOT)) {
        await copyMissingAssetEntries(SYSTEM_NBOOK_ROOT, nbookTargetRoot, result);
    }
    await syncSystemProfilesToUserAssets(result, nbookTargetRoot);
    await syncSystemVariableDefinitionsToUserAssets(result);
    await syncSystemWritingPresetsToUserAssets(result);
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
 * 把小说目录脚手架复制到 workspace，只补缺失文件，不覆盖用户已编辑内容。
 */
export async function copyNovelDirectoryTemplate(workspaceRoot: string): Promise<void> {
    const absoluteWorkspaceRoot = path.resolve(process.cwd(), workspaceRoot);
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
        await fs.cp(mergedRoot, absoluteWorkspaceRoot, {
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
        if (sourceRoot === SYSTEM_PROFILE_ROOT && (entry.name === ".compiled" || entry.name === ".system-profile-metadata.json")) {
            continue;
        }
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
            await syncCompiledProfileArtifact(item.fileName);
            stateChanged = true;
            continue;
        }
        if (!await pathExists(userPath)) {
            await fs.mkdir(path.dirname(userPath), {recursive: true});
            await fs.copyFile(systemPath, userPath);
            await syncCompiledProfileArtifact(item.fileName);
            const hash = await sha256File(userPath);
            upsertUserProfileSyncState(syncState, item, hash.sha256);
            result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
            stateChanged = true;
            continue;
        }
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            upsertUserProfileSyncState(syncState, item, currentUserHash);
            await syncCompiledProfileArtifact(item.fileName);
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
        await syncCompiledProfileArtifact(item.fileName);
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

async function syncSystemWritingPresetsToUserAssets(result: UserAssetsSyncResult): Promise<void> {
    if (!await isDirectory(SYSTEM_WRITING_PRESETS_ROOT)) {
        return;
    }
    const syncState = await readUserProfileSyncState();
    const assets = await listSystemWritingPresetAssets();
    let stateChanged = false;
    for (const item of assets) {
        const systemPath = path.join(SYSTEM_WRITING_PRESETS_ROOT, item.assetPath);
        const userPath = path.join(USER_WRITING_PRESETS_ROOT, item.assetPath);
        const stateItem = syncState.assets?.find((asset) => asset.assetPath === item.assetPath);
        if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            stateChanged = true;
            continue;
        }
        if (!await pathExists(userPath)) {
            await fs.mkdir(path.dirname(userPath), {recursive: true});
            await fs.copyFile(systemPath, userPath);
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.updatedAssets = (result.updatedAssets ?? 0) + 1;
            stateChanged = true;
            continue;
        }
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            upsertUserAssetSyncState(syncState, item, currentUserHash);
            stateChanged = true;
            continue;
        }
        if (!stateItem) {
            result.assetWarnings?.push({
                assetPath: item.assetPath,
                message: `系统 writing preset 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。`,
            });
            continue;
        }
        if (currentUserHash !== stateItem.lastSyncedUserHash) {
            if (item.sha256 !== stateItem.upstreamHash) {
                result.assetWarnings?.push({
                    assetPath: item.assetPath,
                    message: `系统 writing preset 已更新，但用户覆盖已手改，未自动覆盖。`,
                });
            }
            continue;
        }
        if (item.sha256 === stateItem.upstreamHash) {
            continue;
        }
        await fs.copyFile(systemPath, userPath);
        const hash = await sha256File(userPath);
        upsertUserAssetSyncState(syncState, item, hash.sha256);
        result.updatedAssets = (result.updatedAssets ?? 0) + 1;
        stateChanged = true;
    }
    if (stateChanged) {
        await writeUserProfileSyncState(syncState);
    }
}

async function syncSystemVariableDefinitionsToUserAssets(result: UserAssetsSyncResult): Promise<void> {
    const systemPath = path.join(SYSTEM_VARIABLE_DEFINITION_ROOT, "definitions.ts");
    if (!await pathExists(systemPath)) {
        return;
    }
    const item = {
        assetPath: "agent/variables/definitions.ts",
        ...await sha256File(systemPath),
    };
    const userPath = path.join(USER_VARIABLE_DEFINITION_ROOT, "definitions.ts");
    const syncState = await readUserProfileSyncState();
    const stateItem = syncState.assets?.find((asset) => asset.assetPath === item.assetPath);
    let stateChanged = false;
    if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
        const hash = await sha256File(userPath);
        upsertUserAssetSyncState(syncState, item, hash.sha256);
        await syncCompiledVariableDefinitionArtifact();
        stateChanged = true;
    } else if (!await pathExists(userPath)) {
        await fs.mkdir(path.dirname(userPath), {recursive: true});
        await fs.copyFile(systemPath, userPath);
        await syncCompiledVariableDefinitionArtifact();
        const hash = await sha256File(userPath);
        upsertUserAssetSyncState(syncState, item, hash.sha256);
        result.updatedAssets = (result.updatedAssets ?? 0) + 1;
        stateChanged = true;
    } else {
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            upsertUserAssetSyncState(syncState, item, currentUserHash);
            await syncCompiledVariableDefinitionArtifact();
            stateChanged = true;
        } else if (!stateItem) {
            result.assetWarnings?.push({
                assetPath: item.assetPath,
                message: "系统 variable definition 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。",
            });
        } else if (currentUserHash !== stateItem.lastSyncedUserHash) {
            if (item.sha256 !== stateItem.upstreamHash) {
                result.assetWarnings?.push({
                    assetPath: item.assetPath,
                    message: "系统 variable definition 已更新，但用户覆盖已手改，未自动覆盖。",
                });
            }
        } else if (item.sha256 !== stateItem.upstreamHash) {
            await fs.copyFile(systemPath, userPath);
            await syncCompiledVariableDefinitionArtifact();
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.updatedAssets = (result.updatedAssets ?? 0) + 1;
            stateChanged = true;
        }
    }
    if (stateChanged) {
        await writeUserProfileSyncState(syncState);
    }
}

async function listSystemWritingPresetAssets(): Promise<Array<{assetPath: string; sha256: string; bytes: number}>> {
    const result: Array<{assetPath: string; sha256: string; bytes: number}> = [];
    await collectSystemWritingPresetAssets(SYSTEM_WRITING_PRESETS_ROOT, "", result);
    return result.sort((left, right) => left.assetPath.localeCompare(right.assetPath));
}

async function collectSystemWritingPresetAssets(root: string, relativeRoot: string, result: Array<{assetPath: string; sha256: string; bytes: number}>): Promise<void> {
    const entries = await fs.readdir(path.join(root, relativeRoot), {withFileTypes: true});
    for (const entry of entries) {
        const relativePath = path.posix.join(relativeRoot.split(path.sep).join("/"), entry.name);
        if (entry.isDirectory()) {
            await collectSystemWritingPresetAssets(root, relativePath, result);
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
        }
        const absolutePath = path.join(root, relativePath);
        result.push({
            assetPath: relativePath,
            ...await sha256File(absolutePath),
        });
    }
}

async function syncCompiledProfileArtifact(fileName: string): Promise<void> {
    const systemManifest = await readProfileArtifactManifest(SYSTEM_PROFILE_ROOT);
    const item = systemManifest.profiles.find((profile) => profile.fileName === fileName);
    if (!item) {
        return;
    }
    const userCompiledRoot = path.join(USER_PROFILE_ROOT, ".compiled");
    await fs.mkdir(userCompiledRoot, {recursive: true});
    await fs.copyFile(
        path.join(SYSTEM_PROFILE_ROOT, ".compiled", item.artifactFileName),
        path.join(userCompiledRoot, item.artifactFileName),
    );
    if (item.typeFileName) {
        await fs.copyFile(
            path.join(SYSTEM_PROFILE_ROOT, ".compiled", item.typeFileName),
            path.join(userCompiledRoot, item.typeFileName),
        );
    }
    const userManifest = await readProfileArtifactManifest(USER_PROFILE_ROOT);
    const userSourceHash = await sha256File(path.join(USER_PROFILE_ROOT, item.fileName));
    const userItem = rehomeProfileArtifactItem(item, {
        fromRootLabel: "assets/workspace/.nbook/agent/profiles",
        toRootLabel: "workspace/.nbook/agent/profiles",
    });
    const nextManifest = {
        ...userManifest,
        generatedAt: new Date().toISOString(),
        profilesRoot: "workspace/.nbook/agent/profiles",
        profiles: [
            ...userManifest.profiles.filter((profile) => profile.fileName !== item.fileName),
            {
                ...userItem,
                sourceSha256: userSourceHash.sha256,
                sourceBytes: userSourceHash.bytes,
                dependencies: userItem.dependencies.map((dependency) => dependency.path.replace(/[\\/]+/g, "/") === `workspace/.nbook/agent/profiles/${item.fileName}`
                    ? {...dependency, sha256: userSourceHash.sha256, bytes: userSourceHash.bytes}
                    : dependency),
            },
        ].sort((left, right) => left.fileName.localeCompare(right.fileName)),
    };
    await fs.writeFile(
        path.join(userCompiledRoot, "manifest.json"),
        `${JSON.stringify(nextManifest, null, 2)}\n`,
        "utf-8",
    );
}

async function syncCompiledVariableDefinitionArtifact(): Promise<void> {
    const systemManifest = await readVariableDefinitionManifest(SYSTEM_VARIABLE_DEFINITION_ROOT);
    const item = systemManifest.definitions.find((definition) => definition.fileName === "definitions.ts");
    if (!item) {
        return;
    }
    const userCompiledRoot = path.join(USER_VARIABLE_DEFINITION_ROOT, ".compiled");
    await fs.mkdir(userCompiledRoot, {recursive: true});
    await fs.copyFile(
        path.join(SYSTEM_VARIABLE_DEFINITION_ROOT, ".compiled", item.artifactFileName),
        path.join(userCompiledRoot, item.artifactFileName),
    );
    if (item.typeFileName) {
        await fs.copyFile(
            path.join(SYSTEM_VARIABLE_DEFINITION_ROOT, ".compiled", item.typeFileName),
            path.join(userCompiledRoot, item.typeFileName),
        );
    }
    const userManifest = await readVariableDefinitionManifest(USER_VARIABLE_DEFINITION_ROOT);
    const userSourceHash = await sha256File(path.join(USER_VARIABLE_DEFINITION_ROOT, item.fileName));
    const nextItem = {
        ...item,
        sourceSha256: userSourceHash.sha256,
        sourceBytes: userSourceHash.bytes,
        dependencies: item.dependencies.map((dependency) => {
            const dependencyPath = dependency.path.replace(/[\\/]+/g, "/");
            if (dependencyPath === `assets/workspace/.nbook/agent/variables/${item.fileName}`) {
                return {
                    ...dependency,
                    path: `workspace/.nbook/agent/variables/${item.fileName}`,
                    sha256: userSourceHash.sha256,
                    bytes: userSourceHash.bytes,
                };
            }
            return dependency;
        }),
    };
    await fs.writeFile(
        path.join(userCompiledRoot, "manifest.json"),
        `${JSON.stringify({
            ...userManifest,
            generatedAt: new Date().toISOString(),
            definitionsRoot: "workspace/.nbook/agent/variables",
            definitions: [
                ...userManifest.definitions.filter((definition) => definition.fileName !== item.fileName),
                nextItem,
            ].sort((left, right) => left.fileName.localeCompare(right.fileName)),
        }, null, 2)}\n`,
        "utf-8",
    );
}

async function readUserProfileSyncState(): Promise<UserProfileSyncState> {
    try {
        const parsed = JSON.parse(await fs.readFile(USER_PROFILE_SYNC_STATE_PATH, "utf-8")) as UserProfileSyncState;
        return {
            profiles: parsed.profiles ?? [],
            assets: parsed.assets ?? [],
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {profiles: [], assets: []};
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

function upsertUserAssetSyncState(syncState: UserProfileSyncState, metadata: {assetPath: string; sha256: string}, userHash: string): void {
    const next: UserAssetSyncStateItem = {
        assetPath: metadata.assetPath,
        upstreamHash: metadata.sha256,
        lastSyncedUserHash: userHash,
        syncedAt: new Date().toISOString(),
    };
    syncState.assets ??= [];
    const index = syncState.assets.findIndex((item) => item.assetPath === metadata.assetPath);
    if (index >= 0) {
        syncState.assets[index] = next;
    } else {
        syncState.assets.push(next);
    }
    syncState.assets.sort((left, right) => left.assetPath.localeCompare(right.assetPath));
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

