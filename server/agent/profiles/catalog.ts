import {createHash, randomUUID} from "node:crypto";
import {fileURLToPath, pathToFileURL} from "node:url";
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {basename, join, resolve} from "node:path";
import {build, type Metafile} from "esbuild";
import {Value} from "typebox/value";
import type {JsonValue} from "nbook/server/agent/messages/types";
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

type LoadedProfileCatalog = {
    profiles: Map<string, ProfileSource>;
    issues: AgentProfileIssue[];
};

type ProfileFileEntry = {
    file: string;
    mtimeMs: number;
    size: number;
};

type ProfileInventory = {
    system: ProfileFileEntry[];
    user: ProfileFileEntry[];
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

const PROFILE_TSX_PARENT_URL = pathToFileURL(resolve(process.cwd(), "server", "agent", "profiles", "catalog.ts")).href;
const PROFILE_MODULE_CACHE_ROOT = resolve(process.cwd(), ".agent", "workspace", "profile-module-cache");
const PROFILE_MODULE_CACHE_VERSION = 1;

type ProfileModuleCacheDependency = {
    path: string;
    sha256: string;
    bytes: number;
};

type ProfileModuleCacheManifest = {
    version: typeof PROFILE_MODULE_CACHE_VERSION;
    outputHash: string;
    dependencies: ProfileModuleCacheDependency[];
};

/**
 * 动态 profile catalog。用户 profile 按 key 覆盖系统 profile。
 */
export class AgentProfileCatalog {
    private readonly memoryProfiles = new Map<string, ProfileSource>();
    private memoryRevision = 0;
    private catalogCache?: CatalogCache;
    private pendingCatalogLoad?: PendingCatalogLoad;

    constructor(
        private readonly systemRoot = resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles"),
        private readonly userRoot = resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles"),
        private readonly moduleCacheRoot = PROFILE_MODULE_CACHE_ROOT,
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
     * 返回指定 profile。用户文件覆盖系统文件和内存 builtin。
     */
    async get(profileKey: string): Promise<AgentProfile> {
        const catalog = await this.loadAll();
        const profile = catalog.profiles.get(profileKey)?.profile;
        if (!profile) {
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
        return {
            profiles: [...catalog.profiles.values()].map(({profile, source, sourcePath, builtin, issue}): AgentCatalogItem => ({
                key: profile.manifest.key,
                name: profile.manifest.name,
                description: profile.manifest.description,
                allowedToolKeys: profile.allowedToolKeys,
                inputSchema: profile.inputSchema,
                outputSchema: profile.outputSchema,
                source,
                sourcePath,
                builtin,
                loadStatus: this.issueIsFatal(issue) ? "error" : "loaded",
                issue,
            })).sort((left, right) => left.key.localeCompare(right.key)),
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
        const issues: AgentProfileIssue[] = [];
        const shadowWarnings = await this.readProfileShadowWarnings(inventory.user);
        const system = await this.loadDirectory(inventory.system, "system", true);
        issues.push(...system.issues);
        for (const source of system.sources) {
            profiles.set(source.profile.manifest.key, source);
        }
        const user = await this.loadDirectory(inventory.user, "user", false);
        issues.push(...user.issues);
        for (const source of user.sources) {
            const shadowWarning = source.sourcePath ? shadowWarnings.find((warning) => warning.profileKey === source.profile.manifest.key) : undefined;
            if (shadowWarning) {
                source.issue = source.issue ?? shadowWarning.issue;
                issues.push(shadowWarning.issue);
            }
            profiles.set(source.profile.manifest.key, source);
        }
        return {
            profiles,
            issues,
        };
    }

    private async loadDirectory(files: ProfileFileEntry[], source: AgentProfileSourceKind, builtin: boolean): Promise<{
        sources: ProfileSource[];
        issues: AgentProfileIssue[];
    }> {
        const sources: ProfileSource[] = [];
        const issues: AgentProfileIssue[] = [];
        for (const file of files) {
            try {
                const profile = await this.importProfile(file);
                const locked = this.applyBuiltinSchemaLock(profile, source, file.file);
                const filenameIssue = this.filenameIssue(locked.profile, source, file.file);
                sources.push({
                    profile: locked.profile,
                    sourcePath: file.file,
                    builtin,
                    source,
                    issue: locked.issue ?? filenameIssue,
                });
                if (locked.issue) {
                    issues.push(locked.issue);
                }
                if (filenameIssue) {
                    issues.push(filenameIssue);
                }
            } catch (error) {
                issues.push(this.issueFromError(error, source, file.file));
            }
        }
        return {
            sources,
            issues,
        };
    }

    private async readProfileInventory(): Promise<ProfileInventory> {
        const [system, user] = await Promise.all([
            this.findProfileFiles(this.systemRoot),
            this.findProfileFiles(this.userRoot),
        ]);
        return {system, user};
    }

    private async findProfileFiles(root: string): Promise<ProfileFileEntry[]> {
        if (!existsSync(root)) {
            return [];
        }
        const files: ProfileFileEntry[] = [];
        const entries = await readdir(root, {withFileTypes: true});
        for (const entry of entries) {
            const fullPath = join(root, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.findProfileFiles(fullPath));
                continue;
            }
            if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
                const fileStat = await stat(fullPath);
                files.push({
                    file: fullPath,
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
            profileModuleDependencies: await this.profileModuleDependencySignatures(inventory),
        });
    }

    private async profileModuleDependencySignatures(inventory: ProfileInventory): Promise<unknown[]> {
        const files = [...inventory.system, ...inventory.user].filter((entry) => /\.(tsx|ts)$/.test(entry.file));
        if (files.length === 0) {
            return [];
        }
        const tsconfigPath = resolve(process.cwd(), "tsconfig.json");
        const tsconfigBytes = await readFile(tsconfigPath);
        return Promise.all(files.map((entry) => profileModuleDependencySignature(entry.file, this.moduleCacheRoot, tsconfigBytes)));
    }

    private async importProfile(entry: ProfileFileEntry): Promise<AgentProfile> {
        const moduleUrl = `${pathToFileURL(entry.file).href}?mtime=${entry.mtimeMs}&size=${entry.size}`;
        const mod = await this.importTsModule(moduleUrl) as {
            default?: unknown;
        };
        const profile = mod.default;
        if (!this.isProfile(profile)) {
            throw new ProfileCatalogError(this.profileIssueCode(profile), `profile 文件没有默认导出有效的 defineAgentProfile 结果：${entry.file}`);
        }
        return profile;
    }

    private async importTsModule(moduleUrl: string): Promise<unknown> {
        if (/\.(tsx|ts)(?:[?#]|$)/.test(moduleUrl)) {
            return this.importTsx(moduleUrl);
        }
        try {
            return await import(moduleUrl);
        } catch (error) {
            if (!this.shouldFallbackToTsx(error)) {
                throw error;
            }
            return this.importTsx(moduleUrl);
        }
    }

    private async importTsx(moduleUrl: string): Promise<unknown> {
        const compiledModuleUrl = await compileProfileModule(moduleUrl, this.moduleCacheRoot);
        return import(compiledModuleUrl);
    }

    private shouldFallbackToTsx(error: unknown): boolean {
        return error instanceof Error
            && (
                "code" in error && error.code === "ERR_UNKNOWN_FILE_EXTENSION"
                || error.message.includes("Unknown file extension")
            );
    }

    private isProfile(value: unknown): value is AgentProfile {
        return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "inputSchema" in value
            && "allowedToolKeys" in value
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

    private issueFromError(error: unknown, source: AgentProfileSourceKind, sourcePath: string): AgentProfileIssue {
        const code = error instanceof ProfileCatalogError ? error.code : "load_failed";
        const message = error instanceof Error ? error.message : String(error);
        return {
            code,
            message,
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

    private issueIsFatal(issue: AgentProfileIssue | undefined): boolean {
        return Boolean(issue && issue.code !== "filename_mismatch" && issue.code !== "builtin_schema_locked" && issue.code !== "system_profile_shadowed");
    }

    private async readProfileShadowWarnings(userFiles: ProfileFileEntry[]): Promise<ProfileShadowWarning[]> {
        const metadata = await readSystemProfileMetadata();
        if (metadata.profiles.length === 0) {
            return [];
        }
        const warnings: ProfileShadowWarning[] = [];
        for (const item of metadata.profiles) {
            const userFile = userFiles.find((file) => this.relativeProfilePath(file.file, this.userRoot) === item.fileName);
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

    private relativeProfilePath(sourcePath: string, root: string): string {
        return sourcePath.slice(root.length).replace(/^[\\/]+/, "").split(/[\\/]+/).join("/");
    }
}

async function compileProfileModule(moduleUrl: string, moduleCacheRoot: string): Promise<string> {
    const sourceUrl = new URL(moduleUrl);
    const sourcePath = fileURLToPath(sourceUrl);
    const sourceBytes = await readFile(sourcePath);
    const tsconfigPath = resolve(process.cwd(), "tsconfig.json");
    const tsconfigBytes = await readFile(tsconfigPath);
    const entryHash = hashProfileModuleEntry(sourcePath, sourceBytes, tsconfigBytes);
    await mkdir(moduleCacheRoot, {recursive: true});

    const manifestPath = resolve(moduleCacheRoot, `${entryHash}.deps.json`);
    const cached = await readProfileModuleCacheManifest(manifestPath);
    const cachedHash = cached ? await validateProfileModuleCache(cached, moduleCacheRoot) : null;
    if (cachedHash) {
        return `${pathToFileURL(resolve(moduleCacheRoot, `${cachedHash}.mjs`)).href}?profile=${cachedHash}`;
    }

    const temporaryOutputPath = resolve(moduleCacheRoot, `${entryHash}.${randomUUID()}.building.mjs`);
    let temporaryMoved = false;
    try {
        const result = await build({
            absWorkingDir: process.cwd(),
            bundle: true,
            entryPoints: [sourcePath],
            format: "esm",
            jsx: "automatic",
            jsxImportSource: "nbook/server/agent/profiles/profile-dsl",
            logLevel: "silent",
            metafile: true,
            outfile: temporaryOutputPath,
            packages: "external",
            platform: "node",
            target: "esnext",
            tsconfig: tsconfigPath,
        });
        if (!result.metafile) {
            throw new Error(`profile ${sourcePath} 编译缺少 esbuild metafile。`);
        }
        const dependencies = await readProfileModuleDependencies(result.metafile, tsconfigPath);
        const outputHash = hashProfileModuleDependencies(sourcePath, dependencies);
        const outputPath = resolve(moduleCacheRoot, `${outputHash}.mjs`);
        temporaryMoved = await promoteProfileModuleOutput(temporaryOutputPath, outputPath);
        await writeFile(manifestPath, `${JSON.stringify({
            version: PROFILE_MODULE_CACHE_VERSION,
            outputHash,
            dependencies,
        } satisfies ProfileModuleCacheManifest, null, 2)}\n`, "utf8");
        return `${pathToFileURL(outputPath).href}?profile=${outputHash}`;
    } finally {
        if (!temporaryMoved) {
            await rm(temporaryOutputPath, {force: true});
        }
    }
}

async function profileModuleDependencySignature(sourcePath: string, moduleCacheRoot: string, tsconfigBytes: Buffer): Promise<unknown> {
    const sourceBytes = await readFile(sourcePath);
    const entryHash = hashProfileModuleEntry(sourcePath, sourceBytes, tsconfigBytes);
    const manifest = await readProfileModuleCacheManifest(resolve(moduleCacheRoot, `${entryHash}.deps.json`));
    if (!manifest) {
        return {
            entry: normalizeProfileModuleCachePath(sourcePath),
            entryHash,
            dependencies: null,
        };
    }
    const dependencies = await Promise.all(manifest.dependencies.map(async (dependency) => {
        const current = await hashProfileModuleDependency(dependency.path).catch(() => null);
        return current ?? {
            path: dependency.path,
            sha256: "missing",
            bytes: -1,
        };
    }));
    return {
        entry: normalizeProfileModuleCachePath(sourcePath),
        entryHash,
        outputHash: manifest.outputHash,
        dependencies,
    };
}

async function readProfileModuleCacheManifest(manifestPath: string): Promise<ProfileModuleCacheManifest | null> {
    try {
        const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, unknown>;
        if (record.version !== PROFILE_MODULE_CACHE_VERSION || typeof record.outputHash !== "string" || !Array.isArray(record.dependencies)) {
            return null;
        }
        const dependencies = record.dependencies.flatMap((item): ProfileModuleCacheDependency[] => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return [];
            }
            const dependency = item as Record<string, unknown>;
            return typeof dependency.path === "string" && typeof dependency.sha256 === "string" && typeof dependency.bytes === "number"
                ? [{
                    path: dependency.path,
                    sha256: dependency.sha256,
                    bytes: dependency.bytes,
                }]
                : [];
        });
        return dependencies.length === record.dependencies.length
            ? {
                version: PROFILE_MODULE_CACHE_VERSION,
                outputHash: record.outputHash,
                dependencies,
            }
            : null;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function validateProfileModuleCache(manifest: ProfileModuleCacheManifest, moduleCacheRoot: string): Promise<string | null> {
    if (!/^[0-9a-f]{24}$/.test(manifest.outputHash) || !existsSync(resolve(moduleCacheRoot, `${manifest.outputHash}.mjs`))) {
        return null;
    }
    for (const dependency of manifest.dependencies) {
        const current = await hashProfileModuleDependency(dependency.path).catch(() => null);
        if (!current || current.sha256 !== dependency.sha256 || current.bytes !== dependency.bytes) {
            return null;
        }
    }
    return manifest.outputHash;
}

async function promoteProfileModuleOutput(temporaryOutputPath: string, outputPath: string): Promise<boolean> {
    if (existsSync(outputPath)) {
        return false;
    }
    try {
        await rename(temporaryOutputPath, outputPath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
            return false;
        }
        throw error;
    }
}

async function readProfileModuleDependencies(metafile: Metafile, tsconfigPath: string): Promise<ProfileModuleCacheDependency[]> {
    const paths = new Set<string>([tsconfigPath]);
    for (const inputPath of Object.keys(metafile.inputs)) {
        if (!inputPath.startsWith("<")) {
            paths.add(resolve(process.cwd(), inputPath));
        }
    }
    const dependencies = await Promise.all([...paths].sort((left, right) => left.localeCompare(right)).map(hashProfileModuleDependency));
    return dependencies.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashProfileModuleDependency(filePath: string): Promise<ProfileModuleCacheDependency> {
    const bytes = await readFile(filePath);
    return {
        path: normalizeProfileModuleCachePath(filePath),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
    };
}

function hashProfileModuleDependencies(sourcePath: string, dependencies: ProfileModuleCacheDependency[]): string {
    const hash = createHash("sha256")
        .update("profile-module-cache")
        .update("\0")
        .update(normalizeProfileModuleCachePath(sourcePath));
    for (const dependency of dependencies) {
        hash.update("\0")
            .update(dependency.path)
            .update("\0")
            .update(dependency.sha256)
            .update("\0")
            .update(String(dependency.bytes));
    }
    return hash.digest("hex").slice(0, 24);
}

function hashProfileModuleEntry(sourcePath: string, sourceBytes: Buffer, tsconfigBytes: Buffer): string {
    return createHash("sha256")
        .update(sourceBytes)
        .update("\0")
        .update(sourcePath)
        .update("\0")
        .update(tsconfigBytes)
        .digest("hex")
        .slice(0, 24);
}

function normalizeProfileModuleCachePath(filePath: string): string {
    return resolve(filePath).split(/[\\/]+/).join("/");
}

class ProfileCatalogError extends Error {
    constructor(readonly code: AgentProfileIssueCode, message: string) {
        super(message);
    }
}
