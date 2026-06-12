import {existsSync} from "node:fs";
import {readFile, readdir, stat} from "node:fs/promises";
import {basename, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {Value} from "typebox/value";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {
    PROFILE_COMPILED_DIR_NAME,
    readProfileArtifactManifest,
    resolveArtifactPath,
    validateProfileArtifact,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestItem,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {readSystemProfileMetadata, sha256File} from "nbook/server/workspace-files/novel-workspace";
import type {
    AgentCatalogSnapshot,
    AgentCatalogItem,
    AgentProfile,
    AgentProfileIssue,
    AgentProfileIssueCode,
    AgentProfileSourceKind,
} from "nbook/server/agent/profiles/types";

type ProfileSource = {
    profile: AgentProfile;
    sourcePath?: string;
    builtin: boolean;
    source: AgentProfileSourceKind;
    issue?: AgentProfileIssue;
};

type UnloadedProfileSource = {
    key: string;
    name: string;
    description?: string;
    sourcePath: string;
    builtin: boolean;
    source: Exclude<AgentProfileSourceKind, "memory">;
    loadStatus: AgentCatalogItem["loadStatus"];
    issue: AgentProfileIssue;
};

type LoadedProfileCatalog = {
    profiles: Map<string, ProfileSource>;
    unloadedProfiles: Map<string, UnloadedProfileSource>;
    issues: AgentProfileIssue[];
};

type ProfileFileEntry = {
    file: string;
    fileName: string;
    mtimeMs: number;
    size: number;
};

type ProfileInventory = {
    system: ProfileFileEntry[];
    user: ProfileFileEntry[];
    systemManifest: ProfileArtifactManifest;
    userManifest: ProfileArtifactManifest;
};

type ProfileShadowWarning = {
    fileName: string;
    profileKey: string;
    issue: AgentProfileIssue;
};

type CatalogCache = {
    signature: string;
    catalog: LoadedProfileCatalog;
};

type PendingCatalogLoad = {
    signature: string;
    promise: Promise<LoadedProfileCatalog>;
};

const SYSTEM_PROFILE_ROOT = resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const USER_PROFILE_ROOT = resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles");

/**
 * 动态 profile catalog。用户 profile 按 key 覆盖系统 profile。
 * Runtime 只加载 `.compiled` artifact，不在普通请求中编译 TSX 源码。
 */
export class AgentProfileCatalog {
    private readonly memoryProfiles = new Map<string, ProfileSource>();
    private memoryRevision = 0;
    private catalogCache?: CatalogCache;
    private pendingCatalogLoad?: PendingCatalogLoad;

    constructor(
        private readonly systemRoot = SYSTEM_PROFILE_ROOT,
        private readonly userRoot = USER_PROFILE_ROOT,
        private readonly _legacyModuleCacheRoot?: string,
    ) {}

    /**
     * 注册内存 profile，主要给测试和最小内置 profile 使用。
     */
    register(profile: AgentProfile, builtin = true): void {
        this.memoryProfiles.set(profile.manifest.key, {
            profile,
            builtin,
            source: "memory",
        });
        this.memoryRevision += 1;
        this.catalogCache = undefined;
        this.pendingCatalogLoad = undefined;
    }

    /**
     * 清理 catalog 缓存。手动编译或源码保存后可显式刷新。
     */
    invalidate(): void {
        this.catalogCache = undefined;
        this.pendingCatalogLoad = undefined;
    }

    /**
     * 返回指定 profile。用户文件覆盖系统文件和内存 builtin。
     */
    async get(profileKey: string): Promise<AgentProfile> {
        const catalog = await this.loadAll();
        const profile = catalog.profiles.get(profileKey)?.profile;
        if (!profile) {
            const unloaded = catalog.unloadedProfiles.get(profileKey);
            if (unloaded?.issue) {
                throw new Error(`agent profile ${profileKey} 不可运行：${unloaded.issue.message}`);
            }
            throw new Error(`未找到 agent profile: ${profileKey}`);
        }
        return profile;
    }

    /**
     * 解析并校验 profile input。
     */
    parseInput(profile: AgentProfile, input: JsonValue): JsonValue {
        try {
            return Value.Parse(profile.inputSchema, input) as JsonValue;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`profile ${profile.manifest.key} input 校验失败：${message}`);
        }
    }

    /**
     * 提供给 profile prepare 的只读 snapshot。
     */
    async snapshot(options: {includeFileIssues?: boolean} = {}): Promise<AgentCatalogSnapshot> {
        const catalog = await this.loadAll();
        const loaded = [...catalog.profiles.values()].map(({profile, source, sourcePath, builtin, issue}): AgentCatalogItem => ({
            key: profile.manifest.key,
            name: profile.manifest.name,
            description: profile.manifest.description,
            toolKeys: profile.toolKeys,
            inputSchema: profile.inputSchema,
            outputSchema: profile.outputSchema,
            source,
            sourcePath,
            builtin,
            loadStatus: issue ? statusFromIssue(issue) : "loaded",
            issue,
        }));
        const unloaded = [...catalog.unloadedProfiles.values()].map((profile): AgentCatalogItem => ({
            key: profile.key,
            name: profile.name,
            description: profile.description,
            source: profile.source,
            sourcePath: profile.sourcePath,
            builtin: profile.builtin,
            loadStatus: profile.loadStatus,
            issue: profile.issue,
        }));
        return {
            profiles: [...loaded, ...unloaded].sort((left, right) => left.key.localeCompare(right.key)),
            issues: options.includeFileIssues === false
                ? catalog.issues.filter((issue) => Boolean(issue.profileKey))
                : catalog.issues,
        };
    }

    private async loadAll(): Promise<LoadedProfileCatalog> {
        const inventory = await this.readProfileInventory();
        const signature = await this.catalogSignature(inventory);
        if (this.catalogCache?.signature === signature) {
            return this.catalogCache.catalog;
        }
        if (this.pendingCatalogLoad?.signature === signature) {
            return this.pendingCatalogLoad.promise;
        }

        const promise = this.loadInventory(inventory).then((catalog) => {
            this.catalogCache = {signature, catalog};
            return catalog;
        }).finally(() => {
            if (this.pendingCatalogLoad?.promise === promise) {
                this.pendingCatalogLoad = undefined;
            }
        });
        this.pendingCatalogLoad = {signature, promise};
        return promise;
    }

    private async loadInventory(inventory: ProfileInventory): Promise<LoadedProfileCatalog> {
        const profiles = new Map<string, ProfileSource>(this.memoryProfiles);
        const unloadedProfiles = new Map<string, UnloadedProfileSource>();
        const issues: AgentProfileIssue[] = [];
        const shadowWarnings = await this.readProfileShadowWarnings(inventory.user);
        const system = await this.loadDirectory(inventory.system, inventory.systemManifest, "system", true);
        issues.push(...system.issues);
        for (const source of system.sources) {
            profiles.set(source.profile.manifest.key, source);
        }
        for (const source of system.unloadedSources) {
            profiles.delete(source.key);
            unloadedProfiles.set(source.key, source);
        }
        const user = await this.loadDirectory(inventory.user, inventory.userManifest, "user", false);
        issues.push(...user.issues);
        for (const source of user.sources) {
            const shadowWarning = source.sourcePath ? shadowWarnings.find((warning) => warning.profileKey === source.profile.manifest.key) : undefined;
            if (shadowWarning) {
                source.issue = source.issue ?? shadowWarning.issue;
                issues.push(shadowWarning.issue);
            }
            profiles.set(source.profile.manifest.key, source);
            unloadedProfiles.delete(source.profile.manifest.key);
        }
        for (const source of user.unloadedSources) {
            const existing = profiles.get(source.key);
            if (existing) {
                profiles.delete(source.key);
            }
            unloadedProfiles.set(source.key, source);
        }
        return {
            profiles,
            unloadedProfiles,
            issues,
        };
    }

    private async loadDirectory(files: ProfileFileEntry[], manifest: ProfileArtifactManifest, source: Exclude<AgentProfileSourceKind, "memory">, builtin: boolean): Promise<{
        sources: ProfileSource[];
        unloadedSources: UnloadedProfileSource[];
        issues: AgentProfileIssue[];
    }> {
        const sources: ProfileSource[] = [];
        const unloadedSources: UnloadedProfileSource[] = [];
        const issues: AgentProfileIssue[] = [];
        for (const file of files) {
            const manifestItem = manifest.profiles.find((item) => item.fileName === file.fileName);
            if (!manifestItem) {
                const issue = this.notCompiledIssue(source, file);
                issues.push(issue);
                unloadedSources.push(this.unloadedFromFile(file, source, builtin, "not_compiled", issue));
                continue;
            }
            const freshness = await validateProfileArtifact(source === "system" ? this.systemRoot : this.userRoot, manifestItem);
            let loadIssue: AgentProfileIssue | undefined;
            if (!freshness.fresh) {
                const issue = this.staleIssue(source, file, manifestItem, freshness.reason);
                if (source !== "user" || (freshness.reason !== "dependency_changed" && freshness.reason !== "source_changed")) {
                    issues.push(issue);
                    unloadedSources.push(this.unloadedFromManifest(file, manifestItem, source, builtin, "compile_stale", issue));
                    continue;
                }
                loadIssue = issue;
                issues.push(issue);
            }
            try {
                const profile = await this.importCompiledProfile(source === "system" ? this.systemRoot : this.userRoot, manifestItem);
                const locked = this.applyBuiltinSchemaLock(profile, source, file.file);
                const filenameIssue = this.filenameIssue(locked.profile, source, file.file);
                sources.push({
                    profile: locked.profile,
                    sourcePath: file.file,
                    builtin,
                    source,
                    issue: locked.issue ?? filenameIssue ?? loadIssue,
                });
                if (locked.issue) {
                    issues.push(locked.issue);
                }
                if (filenameIssue) {
                    issues.push(filenameIssue);
                }
            } catch (error) {
                const issue = this.issueFromError(error, source, file.file, manifestItem.profileKey, "compiled_load_failed");
                issues.push(issue);
                unloadedSources.push(this.unloadedFromManifest(file, manifestItem, source, builtin, "compiled_load_failed", issue));
            }
        }
        return {
            sources,
            unloadedSources,
            issues,
        };
    }

    private async readProfileInventory(): Promise<ProfileInventory> {
        const [system, user, systemManifest, userManifest] = await Promise.all([
            this.findProfileFiles(this.systemRoot),
            this.findProfileFiles(this.userRoot),
            readProfileArtifactManifest(this.systemRoot),
            readProfileArtifactManifest(this.userRoot),
        ]);
        return {system, user, systemManifest, userManifest};
    }

    private async findProfileFiles(root: string, current = root): Promise<ProfileFileEntry[]> {
        if (!existsSync(current)) {
            return [];
        }
        const files: ProfileFileEntry[] = [];
        const entries = await readdir(current, {withFileTypes: true});
        for (const entry of entries) {
            if (entry.name === PROFILE_COMPILED_DIR_NAME) {
                continue;
            }
            const fullPath = join(current, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.findProfileFiles(root, fullPath));
                continue;
            }
            if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
                const fileStat = await stat(fullPath);
                files.push({
                    file: fullPath,
                    fileName: this.relativeProfilePath(fullPath, root),
                    mtimeMs: fileStat.mtimeMs,
                    size: fileStat.size,
                });
            }
        }
        return files.sort((left, right) => left.file.localeCompare(right.file));
    }

    private async catalogSignature(inventory: ProfileInventory): Promise<string> {
        return JSON.stringify({
            memoryRevision: this.memoryRevision,
            systemRoot: this.systemRoot,
            userRoot: this.userRoot,
            system: inventory.system,
            user: inventory.user,
            systemManifest: inventory.systemManifest,
            userManifest: inventory.userManifest,
            systemDependencies: await dependencySignatures(inventory.systemManifest),
            userDependencies: await dependencySignatures(inventory.userManifest),
        });
    }

    private async importCompiledProfile(profileRoot: string, item: ProfileArtifactManifestItem): Promise<AgentProfile> {
        const artifactPath = join(profileRoot, PROFILE_COMPILED_DIR_NAME, item.artifactFileName);
        const mod = await import(`${pathToFileURL(artifactPath).href}?compiled=${item.artifactSha256}`) as {
            default?: unknown;
        };
        const profile = mod.default;
        if (!this.isProfile(profile)) {
            throw new ProfileCatalogError("invalid_export", `compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
        }
        return profile;
    }

    private isProfile(value: unknown): value is AgentProfile {
        return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "inputSchema" in value
            && "tools" in value
            && "toolKeys" in value
            && "prepare" in value
            && typeof (value as {prepare?: unknown}).prepare === "function",
        );
    }

    private profileIssueCode(value: unknown): AgentProfileIssueCode {
        if (value && typeof value === "object" && !("inputSchema" in value)) {
            return "schema_missing";
        }
        return "invalid_export";
    }

    private applyBuiltinSchemaLock(profile: AgentProfile, source: AgentProfileSourceKind, sourcePath: string): {
        profile: AgentProfile;
        issue?: AgentProfileIssue;
    } {
        const builtin = this.memoryProfiles.get(profile.manifest.key);
        if (!builtin?.builtin) {
            return {profile};
        }
        const inputChanged = !this.sameSchema(profile.inputSchema, builtin.profile.inputSchema);
        const outputChanged = !this.sameSchema(profile.outputSchema, builtin.profile.outputSchema);
        if (!inputChanged && !outputChanged) {
            return {profile};
        }
        const issue: AgentProfileIssue = {
            code: "builtin_schema_locked",
            message: `builtin profile ${profile.manifest.key} 的 Input/Output schema 被锁定，运行时将继续使用内置 schema。`,
            profileKey: profile.manifest.key,
            source,
            sourcePath,
        };
        return {
            profile: {
                ...profile,
                inputSchema: builtin.profile.inputSchema,
                outputSchema: builtin.profile.outputSchema,
            },
            issue,
        };
    }

    private issueFromError(error: unknown, source: AgentProfileSourceKind, sourcePath: string, profileKey?: string, fallbackCode: AgentProfileIssueCode = "load_failed"): AgentProfileIssue {
        const code = error instanceof ProfileCatalogError ? error.code : fallbackCode;
        const message = error instanceof Error ? error.message : String(error);
        return {
            code,
            message,
            profileKey,
            source,
            sourcePath,
        };
    }

    private filenameIssue(profile: AgentProfile, source: AgentProfileSourceKind, sourcePath: string): AgentProfileIssue | undefined {
        const fileName = basename(sourcePath).replace(/\.profile\.(tsx|ts|mjs|js)$/, "");
        if (fileName === profile.manifest.key) {
            return undefined;
        }
        return {
            code: "filename_mismatch",
            message: `profile 文件名建议与 manifest.key 保持一致：${fileName} -> ${profile.manifest.key}`,
            profileKey: profile.manifest.key,
            source,
            sourcePath,
        };
    }

    private sameSchema(left: unknown, right: unknown): boolean {
        return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    }

    private async readProfileShadowWarnings(userFiles: ProfileFileEntry[]): Promise<ProfileShadowWarning[]> {
        const metadata = await readSystemProfileMetadata();
        if (metadata.profiles.length === 0) {
            return [];
        }
        const warnings: ProfileShadowWarning[] = [];
        for (const item of metadata.profiles) {
            const userFile = userFiles.find((file) => file.fileName === item.fileName);
            if (!userFile) {
                continue;
            }
            const userHash = await sha256File(userFile.file);
            if (userHash.sha256 === item.sha256) {
                continue;
            }
            warnings.push({
                fileName: item.fileName,
                profileKey: item.profileKey,
                issue: {
                    code: "system_profile_shadowed",
                    message: `系统 profile ${item.profileKey} 与用户覆盖不同；运行时使用用户覆盖，系统更新不会自动覆盖手改内容。`,
                    profileKey: item.profileKey,
                    source: "user",
                    sourcePath: userFile.file,
                },
            });
        }
        return warnings;
    }

    private notCompiledIssue(source: Exclude<AgentProfileSourceKind, "memory">, file: ProfileFileEntry): AgentProfileIssue {
        return {
            code: "not_compiled",
            message: `profile ${file.fileName} 尚未编译，请先运行 Workbench 编译或 profile compile。`,
            profileKey: keyFromFileName(file.fileName),
            source,
            sourcePath: file.file,
        };
    }

    private staleIssue(source: Exclude<AgentProfileSourceKind, "memory">, file: ProfileFileEntry, manifestItem: ProfileArtifactManifestItem, reason?: "source_changed" | "dependency_changed" | "artifact_missing" | "artifact_changed" | "type_artifact_missing" | "type_artifact_changed"): AgentProfileIssue {
        if (source === "user" && reason === "source_changed") {
            return {
                code: "source_stale",
                message: `profile ${manifestItem.profileKey} 的源码已修改但尚未编译，当前继续使用上次编译产物；保存后的源码需要手动编译后才会生效。`,
                profileKey: manifestItem.profileKey,
                source,
                sourcePath: file.file,
            };
        }
        if (source === "user" && reason === "dependency_changed") {
            return {
                code: "dependency_stale",
                message: `profile ${manifestItem.profileKey} 的依赖已变化，当前继续使用上次编译产物；重新编译后可采用最新运行时能力。`,
                profileKey: manifestItem.profileKey,
                source,
                sourcePath: file.file,
            };
        }
        const message = reason === "artifact_missing"
            ? `profile ${manifestItem.profileKey} 缺少 compiled artifact，需要重新编译。`
            : reason === "artifact_changed"
                ? `profile ${manifestItem.profileKey} 的 compiled artifact 与 manifest 不匹配，需要重新同步或重新编译。`
                : reason === "type_artifact_missing"
                    ? `profile ${manifestItem.profileKey} 缺少 type artifact，需要重新编译。`
                    : reason === "type_artifact_changed"
                        ? `profile ${manifestItem.profileKey} 的 type artifact 与 manifest 不匹配，需要重新同步或重新编译。`
                : reason === "source_changed"
                    ? `profile ${manifestItem.profileKey} 的源码已修改，需要重新编译。`
                    : reason === "dependency_changed"
                        ? `profile ${manifestItem.profileKey} 的依赖已变化，建议重新编译。`
                        : `profile ${manifestItem.profileKey} 不可运行，需要重新编译。`;
        return {
            code: "compile_stale",
            message,
            profileKey: manifestItem.profileKey,
            source,
            sourcePath: file.file,
        };
    }

    private unloadedFromFile(file: ProfileFileEntry, source: Exclude<AgentProfileSourceKind, "memory">, builtin: boolean, loadStatus: UnloadedProfileSource["loadStatus"], issue: AgentProfileIssue): UnloadedProfileSource {
        return {
            key: issue.profileKey ?? keyFromFileName(file.fileName),
            name: keyFromFileName(file.fileName),
            sourcePath: file.file,
            builtin,
            source,
            loadStatus,
            issue,
        };
    }

    private unloadedFromManifest(file: ProfileFileEntry, manifestItem: ProfileArtifactManifestItem, source: Exclude<AgentProfileSourceKind, "memory">, builtin: boolean, loadStatus: UnloadedProfileSource["loadStatus"], issue: AgentProfileIssue): UnloadedProfileSource {
        return {
            key: manifestItem.profileKey,
            name: manifestItem.profileKey,
            sourcePath: file.file,
            builtin,
            source,
            loadStatus,
            issue,
        };
    }

    private relativeProfilePath(sourcePath: string, root: string): string {
        return relative(root, sourcePath).split(/[\\/]+/).join("/");
    }
}

function statusFromIssue(issue: AgentProfileIssue): AgentCatalogItem["loadStatus"] {
    if (issue.code === "filename_mismatch" || issue.code === "builtin_schema_locked" || issue.code === "system_profile_shadowed" || issue.code === "source_stale" || issue.code === "dependency_stale") {
        return "loaded";
    }
    if (issue.code === "not_compiled" || issue.code === "compile_stale" || issue.code === "compiled_load_failed" || issue.code === "source_error") {
        return issue.code;
    }
    return "source_error";
}

function keyFromFileName(fileName: string): string {
    return basename(fileName).replace(/\.profile\.(tsx|ts|mjs|js)$/, "");
}

async function dependencySignatures(manifest: ProfileArtifactManifest): Promise<unknown[]> {
    const dependencyPaths = [...new Set(manifest.profiles.flatMap((profile) => profile.dependencies.map((dependency) => dependency.path)))].sort();
    return Promise.all(dependencyPaths.map(async (filePath) => {
        try {
            const fileStat = await stat(resolveArtifactPath(filePath));
            return {
                path: filePath,
                mtimeMs: fileStat.mtimeMs,
                size: fileStat.size,
            };
        } catch {
            return {
                path: filePath,
                missing: true,
            };
        }
    }));
}

class ProfileCatalogError extends Error {
    constructor(readonly code: AgentProfileIssueCode, message: string) {
        super(message);
    }
}
