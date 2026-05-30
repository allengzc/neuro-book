import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash, randomUUID} from "node:crypto";
import {readProfileArtifactManifest, rehomeProfileArtifactItem, validateProfileArtifact, type ProfileArtifactManifestItem} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {readVariableDefinitionManifest, validateVariableDefinitionArtifact, type VariableDefinitionManifestItem} from "nbook/server/agent/variables/definition-artifact";
import {assertProjectWorkspaceDirectory, normalizeProjectPath} from "nbook/server/workspace-files/project-workspace";
import type {
    UserAssetsAssetSyncWarningDto,
    UserAssetsProfileSyncWarningDto,
    UserAssetsSyncConflictDetailDto,
    UserAssetsSyncResultDto,
} from "nbook/shared/dto/user-assets-sync.dto";

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
const SYSTEM_PROFILE_METADATA_PATH = path.join(SYSTEM_PROFILE_ROOT, ".system-profile-metadata.json");
const USER_PROFILE_SYNC_STATE_PATH = path.join(USER_PROFILE_ROOT, ".profile-sync-state.json");
const NOVEL_DIRECTORY_TEMPLATE_ROOT = path.join(SYSTEM_NBOOK_ROOT, "templates", "novel-directory-templates");
const USER_NOVEL_DIRECTORY_TEMPLATE_ROOT = path.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT, "templates", "novel-directory-templates");
const PROJECT_MANIFEST_FILE = "project.yaml";
const LEGACY_WORKSPACE_MANIFEST_FILE = "workspace.yaml";
const USER_ASSETS_DIFF_MAX_BYTES = 512 * 1024;
const execFileAsync = promisify(execFile);

export type WorkspaceRootKind = "novel" | typeof USER_ASSETS_WORKSPACE_KIND;
export type UserAssetsSyncResult = UserAssetsSyncResultDto;
export type UserAssetsProfileSyncWarning = UserAssetsProfileSyncWarningDto;
export type UserAssetsAssetSyncWarning = UserAssetsAssetSyncWarningDto;

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

type SystemManagedAssetItem = {
    assetPath: string;
    sha256: string;
    bytes: number;
};

type CompiledArtifactSyncResult = {
    ok: true;
    warning?: string;
} | {
    ok: false;
    message: string;
};

type StagedFileReplacement = {
    sourcePath: string;
    targetPath: string;
};

type StagedArtifactSyncResult = {
    ok: true;
    file: StagedFileReplacement;
} | {
    ok: false;
    message: string;
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
    return assertProjectWorkspaceDirectory(normalizeProjectPath(projectPathInput));
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
        await syncManagedSystemAssetsToUserAssets(result);
    }
    await syncSystemProfilesToUserAssets(result, nbookTargetRoot);
    await syncSystemVariableDefinitionsToUserAssets(result);
    return result;
}

export async function readUserAssetsSyncConflictDetail(input: {
    kind: "profile" | "asset";
    fileName?: string;
    assetPath?: string;
}): Promise<UserAssetsSyncConflictDetailDto> {
    if (input.kind === "profile") {
        const fileName = normalizeSafeRelativePath(input.fileName ?? "");
        if (!fileName) {
            throw new Error("fileName 不能为空");
        }
        const metadata = await readSystemProfileMetadata();
        const item = metadata.profiles.find((profile) => profile.fileName === fileName);
        if (!item) {
            throw new Error(`未找到系统 profile metadata: ${fileName}`);
        }
        const syncState = await readUserProfileSyncState();
        const stateItem = syncState.profiles.find((profile) => profile.fileName === fileName);
        const systemPath = resolveInsideRoot(SYSTEM_PROFILE_ROOT, fileName);
        const userPath = resolveInsideRoot(USER_PROFILE_ROOT, fileName);
        const [systemFile, userFile] = await Promise.all([
            readTextFileForDiff(systemPath),
            readTextFileForDiff(userPath),
        ]);
        return {
            kind: "profile",
            fileName,
            label: item.profileKey,
            systemContent: systemFile.content,
            userContent: userFile.content,
            language: inferDiffLanguage(fileName),
            systemSha256: systemFile.sha256,
            userSha256: userFile.sha256,
            systemBytes: systemFile.bytes,
            userBytes: userFile.bytes,
            lastSyncedUserHash: stateItem?.lastSyncedUserHash,
            upstreamHash: stateItem?.upstreamHash,
            diffable: systemFile.diffable && userFile.diffable,
            reason: systemFile.reason ?? userFile.reason,
        };
    }

    const assetPath = normalizeSafeRelativePath(input.assetPath ?? "");
    if (!assetPath) {
        throw new Error("assetPath 不能为空或包含非法片段");
    }
    await assertReadableUserAssetsSyncAssetPath(assetPath);
    const syncState = await readUserProfileSyncState();
    const stateItem = findUserAssetSyncState(syncState, assetPath);
    const roots = resolveUserAssetConflictRoots(assetPath);
    const [systemFile, userFile] = await Promise.all([
        readTextFileForDiff(roots.systemPath),
        readTextFileForDiff(roots.userPath),
    ]);
    return {
        kind: "asset",
        assetPath,
        label: assetPath,
        systemContent: systemFile.content,
        userContent: userFile.content,
        language: inferDiffLanguage(assetPath),
        systemSha256: systemFile.sha256,
        userSha256: userFile.sha256,
        systemBytes: systemFile.bytes,
        userBytes: userFile.bytes,
        lastSyncedUserHash: stateItem?.lastSyncedUserHash,
        upstreamHash: stateItem?.upstreamHash,
        diffable: systemFile.diffable && userFile.diffable,
        reason: systemFile.reason ?? userFile.reason,
    };
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
        await normalizeNovelDirectoryTemplateArtifacts(mergedRoot);
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
 * 清理旧模板产物，避免用户覆盖层把 Project Workspace 又带回 workspace.yaml 心智。
 */
async function normalizeNovelDirectoryTemplateArtifacts(templateRoot: string): Promise<void> {
    await fs.rm(path.join(templateRoot, LEGACY_WORKSPACE_MANIFEST_FILE), {force: true});
    const statusPath = path.join(templateRoot, "PROJECT-STATUS.md");
    try {
        const content = await fs.readFile(statusPath, "utf-8");
        const normalizedContent = content.replaceAll("`workspace.yaml`", `\`${PROJECT_MANIFEST_FILE}\``);
        if (normalizedContent !== content) {
            await fs.writeFile(statusPath, normalizedContent, "utf-8");
        }
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return;
        }
        throw error;
    }
}

/**
 * 同步系统 .nbook 内默认受管理资源；黑名单只保留本地状态、运行记录和编译产物。
 */
async function syncManagedSystemAssetsToUserAssets(result: UserAssetsSyncResult): Promise<void> {
    const syncState = await readUserProfileSyncState();
    const assets = await listManagedSystemAssets();
    let stateChanged = false;
    for (const item of assets) {
        const systemPath = resolveInsideRoot(SYSTEM_NBOOK_ROOT, item.assetPath);
        const userPath = resolveInsideRoot(path.resolve(process.cwd(), USER_NBOOK_ROOT), item.assetPath);
        const stateItem = findUserAssetSyncState(syncState, item.assetPath);
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
            result.copied += 1;
            stateChanged = true;
            continue;
        }

        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            upsertUserAssetSyncState(syncState, item, currentUserHash);
            result.skipped += 1;
            stateChanged = true;
            continue;
        }
        const previousHash = await readGitHeadAssetHash(path.posix.join("assets/workspace/.nbook", item.assetPath));
        if (previousHash && currentUserHash === previousHash) {
            await fs.copyFile(systemPath, userPath);
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.updatedAssets = (result.updatedAssets ?? 0) + 1;
            stateChanged = true;
            continue;
        }
        if (!stateItem) {
            result.assetWarnings?.push({
                assetPath: item.assetPath,
                message: "系统 .nbook asset 有 metadata，但用户覆盖缺少 sync state，已保留用户文件。",
            });
            continue;
        }
        if (currentUserHash !== stateItem.lastSyncedUserHash) {
            if (item.sha256 !== stateItem.upstreamHash) {
                result.assetWarnings?.push({
                    assetPath: item.assetPath,
                    message: "系统 .nbook asset 已更新，但用户覆盖已手改，未自动覆盖。",
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
            const artifactSync = await syncCompiledProfileArtifact(item.fileName);
            if (!artifactSync.ok) {
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                continue;
            }
            if (artifactSync.warning) {
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.warning});
            }
            upsertUserProfileSyncState(syncState, item, hash.sha256);
            stateChanged = true;
            continue;
        }
        if (!await pathExists(userPath)) {
            await fs.mkdir(path.dirname(userPath), {recursive: true});
            const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
            const artifactSync = await syncCompiledProfileArtifact(item.fileName);
            if (!artifactSync.ok) {
                await sourceCopy.rollback();
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                continue;
            }
            if (artifactSync.warning) {
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.warning});
            }
            await sourceCopy.commit();
            const hash = await sha256File(userPath);
            upsertUserProfileSyncState(syncState, item, hash.sha256);
            result.updatedProfiles = (result.updatedProfiles ?? 0) + 1;
            stateChanged = true;
            continue;
        }
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            const artifactSync = await syncCompiledProfileArtifact(item.fileName);
            if (!artifactSync.ok) {
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
                continue;
            }
            if (artifactSync.warning) {
                result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.warning});
            }
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
        const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
        const artifactSync = await syncCompiledProfileArtifact(item.fileName);
        if (!artifactSync.ok) {
            await sourceCopy.rollback();
            result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.message});
            continue;
        }
        if (artifactSync.warning) {
            result.profileWarnings?.push({fileName: item.fileName, profileKey: item.profileKey, message: artifactSync.warning});
        }
        await sourceCopy.commit();
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
    const stateItem = findUserAssetSyncState(syncState, item.assetPath);
    let stateChanged = false;
    if (!stateItem && await pathExists(userPath) && await sameFile(systemPath, userPath)) {
        const hash = await sha256File(userPath);
        const artifactSync = await syncCompiledVariableDefinitionArtifact();
        if (!artifactSync.ok) {
            result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.message});
        } else {
            if (artifactSync.warning) {
                result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.warning});
            }
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            stateChanged = true;
        }
    } else if (!await pathExists(userPath)) {
        await fs.mkdir(path.dirname(userPath), {recursive: true});
        const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
        const artifactSync = await syncCompiledVariableDefinitionArtifact();
        if (!artifactSync.ok) {
            await sourceCopy.rollback();
            result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.message});
        } else {
            if (artifactSync.warning) {
                result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.warning});
            }
            await sourceCopy.commit();
            const hash = await sha256File(userPath);
            upsertUserAssetSyncState(syncState, item, hash.sha256);
            result.updatedAssets = (result.updatedAssets ?? 0) + 1;
            stateChanged = true;
        }
    } else {
        const currentUserHash = (await sha256File(userPath)).sha256;
        if (currentUserHash === item.sha256) {
            const artifactSync = await syncCompiledVariableDefinitionArtifact();
            if (!artifactSync.ok) {
                result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.message});
            } else {
                if (artifactSync.warning) {
                    result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.warning});
                }
                upsertUserAssetSyncState(syncState, item, currentUserHash);
                stateChanged = true;
            }
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
            const sourceCopy = await replaceFileWithRollback(systemPath, userPath);
            const artifactSync = await syncCompiledVariableDefinitionArtifact();
            if (!artifactSync.ok) {
                await sourceCopy.rollback();
                result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.message});
            } else {
                if (artifactSync.warning) {
                    result.assetWarnings?.push({assetPath: item.assetPath, message: artifactSync.warning});
                }
                await sourceCopy.commit();
                const hash = await sha256File(userPath);
                upsertUserAssetSyncState(syncState, item, hash.sha256);
                result.updatedAssets = (result.updatedAssets ?? 0) + 1;
                stateChanged = true;
            }
        }
    }
    if (stateChanged) {
        await writeUserProfileSyncState(syncState);
    }
}

async function listManagedSystemAssets(): Promise<SystemManagedAssetItem[]> {
    const result: SystemManagedAssetItem[] = [];
    await collectManagedSystemAssets(SYSTEM_NBOOK_ROOT, "", result);
    return result.sort((left, right) => left.assetPath.localeCompare(right.assetPath));
}

async function collectManagedSystemAssets(root: string, relativeRoot: string, result: SystemManagedAssetItem[]): Promise<void> {
    const entries = await fs.readdir(path.join(root, relativeRoot), {withFileTypes: true});
    for (const entry of entries) {
        const relativePath = path.posix.join(relativeRoot.split(path.sep).join("/"), entry.name);
        if (entry.isDirectory()) {
            await collectManagedSystemAssets(root, relativePath, result);
            continue;
        }
        if (!entry.isFile() || isManagedAssetBlacklisted(relativePath)) {
            continue;
        }
        const absolutePath = path.join(root, relativePath);
        result.push({
            assetPath: relativePath,
            ...await sha256File(absolutePath),
        });
    }
}

function isManagedAssetBlacklisted(assetPath: string): boolean {
    const normalized = assetPath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return normalized === "config.json"
        || normalized === "neuro-book.sqlite"
        || normalized === "agent/session-seq.json"
        || normalized === "agent/profiles/.profile-sync-state.json"
        || normalized === "agent/profiles/.system-profile-metadata.json"
        || normalized.startsWith("agent/sessions/")
        || normalized.startsWith("agent/profiles/")
        || normalized === "agent/variables/definitions.ts"
        || parts.includes(".compiled");
}

async function assertReadableUserAssetsSyncAssetPath(assetPath: string): Promise<void> {
    if (assetPath === "agent/variables/definitions.ts") {
        return;
    }
    const assets = await listManagedSystemAssets();
    if (!assets.some((asset) => asset.assetPath === assetPath)) {
        throw new Error(`assetPath 不属于可读取的系统同步资源: ${assetPath}`);
    }
}

async function syncCompiledProfileArtifact(fileName: string): Promise<CompiledArtifactSyncResult> {
    const systemManifest = await readProfileArtifactManifest(SYSTEM_PROFILE_ROOT);
    const item = systemManifest.profiles.find((profile) => profile.fileName === fileName);
    if (!item) {
        return {ok: false, message: `系统 profile ${fileName} 缺少 compiled manifest entry，未同步 compiled artifact。`};
    }
    const userCompiledRoot = path.join(USER_PROFILE_ROOT, ".compiled");
    await fs.mkdir(userCompiledRoot, {recursive: true});
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
    const previousProfiles = userManifest.profiles;
    nextManifest.generatedAt = JSON.stringify(previousProfiles) === JSON.stringify(nextManifest.profiles) ? userManifest.generatedAt : new Date().toISOString();
    const nextItem = nextManifest.profiles.find((profile) => profile.fileName === item.fileName);
    if (!nextItem) {
        return {ok: false, message: `系统 profile ${item.profileKey} 同步 compiled manifest 失败：缺少目标 entry。`};
    }
    const artifactSync = await stageVerifiedArtifact(
        path.join(SYSTEM_PROFILE_ROOT, ".compiled", item.artifactFileName),
        path.join(userCompiledRoot, item.artifactFileName),
        item,
        "artifact",
    );
    if (!artifactSync.ok) {
        return {ok: false, message: `系统 profile ${item.profileKey} compiled artifact 同步失败：${artifactSync.message}`};
    }
    const stagedReplacements: StagedFileReplacement[] = [artifactSync.file];
    if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
        const typeSync = await stageVerifiedArtifact(
            path.join(SYSTEM_PROFILE_ROOT, ".compiled", item.typeFileName),
            path.join(userCompiledRoot, item.typeFileName),
            item,
            "type",
        );
        if (!typeSync.ok) {
            await cleanupStagedReplacements(stagedReplacements);
            return {ok: false, message: `系统 profile ${item.profileKey} type artifact 同步失败：${typeSync.message}`};
        }
        stagedReplacements.push(typeSync.file);
    }
    const manifestPath = path.join(userCompiledRoot, "manifest.json");
    const manifestStagePath = `${manifestPath}.${randomUUID()}.syncing`;
    await fs.writeFile(manifestStagePath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf-8");
    stagedReplacements.push({sourcePath: manifestStagePath, targetPath: manifestPath});
    await replaceFilesWithRollback(stagedReplacements);
    await pruneCompiledDirectory(userCompiledRoot, nextManifest.profiles.flatMap((profile) => [profile.artifactFileName, profile.typeFileName]));
    const validation = await validateProfileArtifact(USER_PROFILE_ROOT, nextItem);
    if (!validation.fresh && validation.reason !== "dependency_changed") {
        return {ok: true, warning: `系统 profile ${item.profileKey} 同步后仍不可运行：${validation.reason ?? "unknown"}。`};
    }
    return {ok: true};
}

async function syncCompiledVariableDefinitionArtifact(): Promise<CompiledArtifactSyncResult> {
    const systemManifest = await readVariableDefinitionManifest(SYSTEM_VARIABLE_DEFINITION_ROOT);
    const item = systemManifest.definitions.find((definition) => definition.fileName === "definitions.ts");
    if (!item) {
        return {ok: false, message: "系统 variable definition 缺少 compiled manifest entry，未同步 compiled artifact。"};
    }
    const userCompiledRoot = path.join(USER_VARIABLE_DEFINITION_ROOT, ".compiled");
    await fs.mkdir(userCompiledRoot, {recursive: true});
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
    const nextManifest = {
        ...userManifest,
        generatedAt: userManifest.generatedAt,
        definitionsRoot: "workspace/.nbook/agent/variables",
        definitions: [
            ...userManifest.definitions.filter((definition) => definition.fileName !== item.fileName),
            nextItem,
        ].sort((left, right) => left.fileName.localeCompare(right.fileName)),
    };
    nextManifest.generatedAt = JSON.stringify(userManifest.definitions) === JSON.stringify(nextManifest.definitions) ? userManifest.generatedAt : new Date().toISOString();
    const artifactSync = await stageVerifiedArtifact(
        path.join(SYSTEM_VARIABLE_DEFINITION_ROOT, ".compiled", item.artifactFileName),
        path.join(userCompiledRoot, item.artifactFileName),
        item,
        "artifact",
    );
    if (!artifactSync.ok) {
        return {ok: false, message: `系统 variable definition compiled artifact 同步失败：${artifactSync.message}`};
    }
    const stagedReplacements: StagedFileReplacement[] = [artifactSync.file];
    if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
        const typeSync = await stageVerifiedArtifact(
            path.join(SYSTEM_VARIABLE_DEFINITION_ROOT, ".compiled", item.typeFileName),
            path.join(userCompiledRoot, item.typeFileName),
            item,
            "type",
        );
        if (!typeSync.ok) {
            await cleanupStagedReplacements(stagedReplacements);
            return {ok: false, message: `系统 variable definition type artifact 同步失败：${typeSync.message}`};
        }
        stagedReplacements.push(typeSync.file);
    }
    const manifestPath = path.join(userCompiledRoot, "manifest.json");
    const manifestStagePath = `${manifestPath}.${randomUUID()}.syncing`;
    await fs.writeFile(manifestStagePath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf-8");
    stagedReplacements.push({sourcePath: manifestStagePath, targetPath: manifestPath});
    await replaceFilesWithRollback(stagedReplacements);
    await pruneCompiledDirectory(userCompiledRoot, nextManifest.definitions.flatMap((definition) => [definition.artifactFileName, definition.typeFileName]));
    const validation = await validateVariableDefinitionArtifact(USER_VARIABLE_DEFINITION_ROOT, nextItem);
    if (!validation.fresh && validation.reason !== "dependency_changed") {
        return {ok: true, warning: `系统 variable definition 同步后仍不可运行：${validation.reason ?? "unknown"}。`};
    }
    return {ok: true};
}

async function stageVerifiedArtifact(
    sourcePath: string,
    targetPath: string,
    item: ProfileArtifactManifestItem | VariableDefinitionManifestItem,
    kind: "artifact" | "type",
): Promise<StagedArtifactSyncResult> {
    const temporaryPath = `${targetPath}.${randomUUID()}.syncing`;
    const expectedSha256 = kind === "artifact" ? item.artifactSha256 : item.typeSha256;
    const expectedBytes = kind === "artifact" ? item.artifactBytes : item.typeBytes;
    if (!expectedSha256 || expectedBytes === undefined) {
        return {ok: false, message: `${kind} 缺少 manifest hash。`};
    }
    let staged = false;
    try {
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.copyFile(sourcePath, temporaryPath);
        const actual = await sha256File(temporaryPath);
        if (actual.sha256 !== expectedSha256 || actual.bytes !== expectedBytes) {
            return {ok: false, message: `${path.basename(targetPath)} hash 不匹配，expected ${expectedSha256}/${expectedBytes}, actual ${actual.sha256}/${actual.bytes}`};
        }
        staged = true;
        return {ok: true, file: {sourcePath: temporaryPath, targetPath}};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {ok: false, message};
    } finally {
        if (!staged) {
            await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
        }
    }
}

async function cleanupStagedReplacements(files: StagedFileReplacement[]): Promise<void> {
    await Promise.all(files.map((file) => fs.rm(file.sourcePath, {force: true})));
}

async function replaceFilesWithRollback(files: StagedFileReplacement[]): Promise<void> {
    const replacements: Array<{commit: () => Promise<void>; rollback: () => Promise<void>}> = [];
    try {
        for (const file of files) {
            replacements.push(await replaceFileWithRollback(file.sourcePath, file.targetPath));
        }
    } catch (error) {
        for (const replacement of replacements.toReversed()) {
            await replacement.rollback().catch(() => undefined);
        }
        await cleanupStagedReplacements(files);
        throw error;
    }
    try {
        for (const replacement of replacements) {
            await replacement.commit();
        }
    } finally {
        await cleanupStagedReplacements(files);
    }
}

async function replaceFileWithRollback(sourcePath: string, targetPath: string): Promise<{commit: () => Promise<void>; rollback: () => Promise<void>}> {
    const backupPath = `${targetPath}.${randomUUID()}.backup`;
    const hadOriginal = await pathExists(targetPath);
    let backupCreated = false;
    try {
        if (hadOriginal) {
            await fs.copyFile(targetPath, backupPath);
            backupCreated = true;
        }
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.copyFile(sourcePath, targetPath);
    } catch (error) {
        if (backupCreated) {
            try {
                await fs.copyFile(backupPath, targetPath);
                await fs.rm(backupPath, {force: true});
            } catch (restoreError) {
                const replaceMessage = error instanceof Error ? error.message : String(error);
                const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
                throw new Error(`替换文件失败，且恢复备份失败。备份已保留在 ${backupPath}。replace error: ${replaceMessage}; restore error: ${restoreMessage}`);
            }
        } else if (!hadOriginal) {
            await fs.rm(targetPath, {force: true}).catch(() => undefined);
        }
        throw error;
    }
    return {
        commit: async () => {
            await fs.rm(backupPath, {force: true});
        },
        rollback: async () => {
            if (hadOriginal) {
                await fs.copyFile(backupPath, targetPath);
                await fs.rm(backupPath, {force: true});
                return;
            }
            await fs.rm(targetPath, {force: true});
        },
    };
}

async function pruneCompiledDirectory(compiledRoot: string, referencedFiles: Array<string | undefined>): Promise<void> {
    const keep = new Set(["manifest.json", ...referencedFiles.filter((fileName): fileName is string => Boolean(fileName))]);
    const entries = await fs.readdir(compiledRoot, {withFileTypes: true}).catch(() => []);
    await Promise.all(entries
        .filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name) && !keep.has(entry.name))
        .map((entry) => fs.rm(path.join(compiledRoot, entry.name), {force: true})));
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

function findUserAssetSyncState(syncState: UserProfileSyncState, assetPath: string): UserAssetSyncStateItem | undefined {
    const exact = syncState.assets?.find((item) => item.assetPath === assetPath);
    if (exact) {
        return exact;
    }
    const writingPresetPrefix = "agent/writing-presets/";
    if (assetPath.startsWith(writingPresetPrefix)) {
        const legacyPath = assetPath.slice(writingPresetPrefix.length);
        return syncState.assets?.find((item) => item.assetPath === legacyPath);
    }
    return undefined;
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

/**
 * 读取当前 Git HEAD 中的系统 asset hash，用于迁移缺少 sync state 的未手改旧副本。
 */
async function readGitHeadAssetHash(assetPath: string): Promise<string | null> {
    try {
        const {stdout} = await execFileAsync("git", ["show", `HEAD:${assetPath}`], {
            cwd: process.cwd(),
            encoding: "buffer",
            maxBuffer: 10 * 1024 * 1024,
        });
        const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
        return createHash("sha256").update(buffer).digest("hex");
    } catch {
        return null;
    }
}

async function removeCopiedSystemMetadata(nbookTargetRoot: string): Promise<void> {
    const copiedMetadataPath = path.join(nbookTargetRoot, "agent", "profiles", ".system-profile-metadata.json");
    if (copiedMetadataPath === SYSTEM_PROFILE_METADATA_PATH) {
        return;
    }
    await fs.rm(copiedMetadataPath, {force: true});
}

/**
 * 规范化用户传入的相对路径，禁止绝对路径和上跳路径。
 */
function normalizeSafeRelativePath(value: string): string {
    const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("\0") || path.posix.isAbsolute(normalized)) {
        return "";
    }
    const parts = normalized.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
        return "";
    }
    return parts.join("/");
}

/**
 * 将相对路径解析到指定 root 内，防止 detail API 读出 user-assets 边界。
 */
function resolveInsideRoot(root: string, relativePath: string): string {
    const normalized = normalizeSafeRelativePath(relativePath);
    if (!normalized) {
        throw new Error("路径不能为空或包含非法片段");
    }
    const absoluteRoot = path.resolve(root);
    const resolved = path.resolve(absoluteRoot, normalized);
    const relative = path.relative(absoluteRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`路径越界: ${relativePath}`);
    }
    return resolved;
}

/**
 * asset warning 只允许读取 Workspace Root .nbook 与系统 bundled .nbook 的同名资源。
 */
function resolveUserAssetConflictRoots(assetPath: string): {systemPath: string; userPath: string} {
    const normalized = normalizeSafeRelativePath(assetPath);
    if (!normalized) {
        throw new Error("assetPath 不能为空或包含非法片段");
    }
    return {
        systemPath: resolveInsideRoot(SYSTEM_NBOOK_ROOT, normalized),
        userPath: resolveInsideRoot(path.resolve(process.cwd(), USER_NBOOK_ROOT), normalized),
    };
}

/**
 * 读取可 diff 文本文件；大文件和二进制文件交给调用方显示不可 diff 提示。
 */
async function readTextFileForDiff(filePath: string): Promise<{
    content: string;
    sha256: string;
    bytes: number;
    diffable: boolean;
    reason?: "missing" | "binary" | "too_large";
}> {
    if (!await pathExists(filePath)) {
        return {
            content: "",
            sha256: "",
            bytes: 0,
            diffable: false,
            reason: "missing",
        };
    }
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
        throw new Error("目录不能用于文本 diff");
    }
    const buffer = await fs.readFile(filePath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (stat.size > USER_ASSETS_DIFF_MAX_BYTES) {
        return {
            content: "",
            sha256,
            bytes: buffer.byteLength,
            diffable: false,
            reason: "too_large",
        };
    }
    if (buffer.includes(0)) {
        return {
            content: "",
            sha256,
            bytes: buffer.byteLength,
            diffable: false,
            reason: "binary",
        };
    }
    return {
        content: buffer.toString("utf-8"),
        sha256,
        bytes: buffer.byteLength,
        diffable: true,
    };
}

/**
 * 为 Monaco diff 推断语言，保持为通用组件提供稳定的 language。
 */
function inferDiffLanguage(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts") {
        return "typescript";
    }
    if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
        return "javascript";
    }
    if (extension === ".json") {
        return "json";
    }
    if (extension === ".yaml" || extension === ".yml") {
        return "yaml";
    }
    if (extension === ".css") {
        return "css";
    }
    if (extension === ".html" || extension === ".vue") {
        return "html";
    }
    return "markdown";
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

