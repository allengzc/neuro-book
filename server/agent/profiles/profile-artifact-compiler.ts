import {createHash, randomUUID} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {builtinModules, createRequire} from "node:module";
import {availableParallelism} from "node:os";
import {setTimeout as sleep} from "node:timers/promises";
import {build, type Metafile, type Plugin} from "esbuild";
import {lock as lockFile} from "proper-lockfile";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import {generateVariableTypes, VARIABLE_TYPES_FILE_NAME, type VariableTypeGenerationDiagnostic} from "nbook/server/agent/variables/generated-types";
import {appLogger} from "nbook/server/app-logs/logger";
import {importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";

// Profile 核心 DSL / prepare wrapper 会被 bundle 进 artifact；共享依赖语义变化时必须提升版本，强制旧 bundle 重编。
export const PROFILE_ARTIFACT_COMPILER_VERSION = 7;
export const PROFILE_COMPILED_DIR_NAME = ".compiled";
export const PROFILE_COMPILED_ARTIFACTS_DIR_NAME = "artifacts";
export const PROFILE_COMPILED_MANIFEST_FILE = "manifest.json";
export const PROFILE_COMPILED_PUBLISH_LOCK = ".publish.lock";
export const PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_COMPILE_MAX_FILE_CONCURRENCY = 4;
const PROFILE_DEPENDENCY_HASH_CONCURRENCY = 16;

export type ProfileArtifactDependency = {
    path: string;
    sha256: string;
    bytes: number;
};

export type ProfileArtifactManifestItem = {
    status?: "loaded";
    fileName: string;
    profileKey: string;
    sourceSha256: string;
    sourceBytes: number;
    dependencyHash: string;
    artifactFileName: string;
    artifactSha256: string;
    artifactBytes: number;
    typeFileName?: string;
    typeSha256?: string;
    typeBytes?: number;
    typeDiagnostics?: VariableTypeGenerationDiagnostic[];
    registeredVariablePaths?: string[];
    dependencies: ProfileArtifactDependency[];
};

export type ProfileArtifactCompileFailure = {
    code: "compile_failed";
    message: string;
    stack?: string;
};

export type ProfileArtifactManifestFailureItem = {
    status: "compile_failed";
    fileName: string;
    profileKey: string;
    sourceSha256: string;
    sourceBytes: number;
    issues: ProfileArtifactCompileFailure[];
};

export type ProfileArtifactManifestEntry = ProfileArtifactManifestItem | ProfileArtifactManifestFailureItem;

export type ProfileArtifactManifest = {
    compilerVersion: typeof PROFILE_ARTIFACT_COMPILER_VERSION;
    generatedAt: string;
    profilesRoot: string;
    /** 包含 loaded 与 compile_failed 的完整发布账本。 */
    entries: ProfileArtifactManifestEntry[];
    /** 仅包含 loaded entry 的数组视图，供运行时 artifact 读取与旧调用点逐步迁移。 */
    profiles: ProfileArtifactManifestItem[];
};

export type CompileProfileArtifactsOptions = {
    profileRoot: string;
    fileName?: string;
    rootLabel?: string;
    skipFresh?: boolean;
    /** 为空时按 CLI/preflight disk-only 发布；HTTP runtime 可传 in-process 发布策略。 */
    publish?: ProfileReleasePublishOptions;
};

export type CompileProfileArtifactsResult = {
    manifest: ProfileArtifactManifest;
    compiledDir: string;
    manifestPath: string;
    compiled: ProfileArtifactManifestItem[];
};

export type StagedProfileArtifactsResult = CompileProfileArtifactsResult & {
    profileRoot: string;
    buildCompiledDir: string;
    sourceFilesAtStart: ProfileArtifactSourceFile[];
};

export type ProfileArtifactSourceFile = {
    fileName: string;
    absolutePath: string;
};

export type StagedProfileArtifactEntryResult = {
    profileRoot: string;
    buildCompiledDir: string;
    entry: ProfileArtifactManifestEntry;
    /** 为空表示该 profile 编译失败，entry 中会记录 compile_failed。 */
    compiled?: ProfileArtifactManifestItem;
};

export type ProfileReleasePublishMode = "disk_only" | "in_process";

export type ProfileReleaseRegistrySink = {
    publishProfileRelease(profileRoot: string, manifest: ProfileArtifactManifest): Promise<void> | void;
};

export type ProfileReleasePublishOptions = {
    mode: ProfileReleasePublishMode;
    registry?: ProfileReleaseRegistrySink;
};

export type ProfileReleaseOperation = "full" | "single" | "batch";

/**
 * release 已经写入磁盘，但 server 进程内 Registry 翻转失败。
 * 调用方不能再回滚与 manifest 匹配的 source，只能把请求作为强一致失败返回。
 */
export class ProfileReleaseCommittedButRegistryFailedError extends Error {
    readonly profileRoot: string;
    readonly manifest: ProfileArtifactManifest;
    readonly operation: ProfileReleaseOperation;
    override readonly cause: unknown;

    constructor(input: {
        profileRoot: string;
        manifest: ProfileArtifactManifest;
        operation: ProfileReleaseOperation;
        cause: unknown;
    }) {
        const message = `profile release 已写入磁盘，但 Registry 翻转失败：${input.profileRoot}`;
        super(message);
        this.name = "ProfileReleaseCommittedButRegistryFailedError";
        this.profileRoot = input.profileRoot;
        this.manifest = input.manifest;
        this.operation = input.operation;
        this.cause = input.cause;
    }
}

/**
 * 判断错误是否表示 release 已落盘但 Registry 未完成翻转。
 */
export function isProfileReleaseCommittedButRegistryFailedError(error: unknown): error is ProfileReleaseCommittedButRegistryFailedError {
    return error instanceof ProfileReleaseCommittedButRegistryFailedError;
}

/**
 * full replacement 发布前发现源码文件集合变化。
 */
export class ProfileArtifactSourceFileSetChangedError extends Error {
    constructor(readonly profileRoot: string) {
        super(`profile full compile 期间源码文件集合发生变化，已放弃发布：${profileRoot}`);
        this.name = "ProfileArtifactSourceFileSetChangedError";
    }
}

/**
 * full replacement 发布前发现同名源码内容变化。
 */
export class ProfileArtifactSourceContentChangedError extends Error {
    constructor(readonly profileRoot: string, readonly fileName: string) {
        super(`profile full compile 期间源码内容发生变化，已放弃发布：${fileName}`);
        this.name = "ProfileArtifactSourceContentChangedError";
    }
}

type ProfileFileEntry = ProfileArtifactSourceFile;

type ProfileCompileFileResult = {
    entry: ProfileArtifactManifestEntry;
    compiled?: ProfileArtifactManifestItem;
};

const artifactPromotionLocks = new Map<string, Promise<void>>();
const profileReleaseQueues = new Map<string, Promise<void>>();

/**
 * 编译开始前源码已消失。Coordinator 应把这类情况视为 generation 变化并重排，
 * 而不是发布 compile_failed 账本。
 */
export class ProfileArtifactSourceMissingError extends Error {}

/**
 * `.compiled` 指针持久化层。只有它负责把 staging artifact 安装到真实 root，
 * 并用 advisory lock 包住 manifest 原子替换。
 */
export class ProfileReleaseStore {
    constructor(readonly profileRoot: string) {}

    /**
     * 读取当前 profile release。返回值是规范化视图，包含 entries 与 loaded profiles 两个视图。
     */
    async read(): Promise<ProfileArtifactManifest> {
        return readProfileArtifactManifest(this.profileRoot);
    }

    /**
     * 将 staging 中的不可变 artifact 安装到真实 `.compiled`，再原子替换 manifest 指针。
     */
    async publishStaged(buildCompiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
        await commitCompiledArtifacts(buildCompiledDir, join(resolve(this.profileRoot), PROFILE_COMPILED_DIR_NAME), manifest);
    }

    /**
     * 将单个 profile entry 合并进当前 manifest。合并在 publish lock 内完成，
     * 避免并发单文件编译用旧 manifest 互相覆盖。
     */
    async publishStagedEntry(buildCompiledDir: string, entry: ProfileArtifactManifestEntry, profilesRoot?: string): Promise<ProfileArtifactManifest> {
        return commitCompiledArtifactEntry(buildCompiledDir, join(resolve(this.profileRoot), PROFILE_COMPILED_DIR_NAME), entry, profilesRoot);
    }

    /**
     * 将一批 profile entries 合并进当前 manifest。只替换同 fileName entry，
     * 保留发布期间其它写入方已经提交的账本项。
     */
    async publishStagedEntries(buildCompiledDir: string, entries: ProfileArtifactManifestEntry[], profilesRoot?: string): Promise<ProfileArtifactManifest> {
        return commitCompiledArtifactEntries(buildCompiledDir, join(resolve(this.profileRoot), PROFILE_COMPILED_DIR_NAME), entries, profilesRoot);
    }
}

/**
 * profile release 的唯一发布入口。CLI/preflight 使用 disk-only 模式；
 * HTTP runtime 后续接入 Registry 时使用 in-process 模式同步翻内存。
 */
export class ProfileReleasePublisher {
    private readonly store: ProfileReleaseStore;

    constructor(readonly input: {profileRoot: string} & ProfileReleasePublishOptions) {
        if (input.mode === "in_process" && !input.registry) {
            throw new Error("in_process profile release 必须提供 Registry sink。");
        }
        this.store = new ProfileReleaseStore(input.profileRoot);
    }

    /**
     * 发布 staging 编译结果。磁盘提交完成后，in-process 模式才翻转 Registry。
     */
    async publishStaged(buildCompiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
        await withProfileReleaseQueue(this.input.profileRoot, async () => {
            await this.store.publishStaged(buildCompiledDir, manifest);
            await this.publishRegistry(manifest, "full");
        });
    }

    /**
     * 发布单文件 staging entry。Publisher 是唯一允许把 entry 合并入 manifest 的 seam。
     */
    async publishStagedEntry(buildCompiledDir: string, entry: ProfileArtifactManifestEntry, profilesRoot?: string): Promise<ProfileArtifactManifest> {
        return withProfileReleaseQueue(this.input.profileRoot, async () => {
            const manifest = await this.store.publishStagedEntry(buildCompiledDir, entry, profilesRoot);
            await this.publishRegistry(manifest, "single");
            return manifest;
        });
    }

    /**
     * 发布一批 staging entries。用于 assets sync 这类 patch release，
     * 避免用旧 full manifest 覆盖并发发布。
     */
    async publishStagedEntries(buildCompiledDir: string, entries: ProfileArtifactManifestEntry[], profilesRoot?: string): Promise<ProfileArtifactManifest> {
        return withProfileReleaseQueue(this.input.profileRoot, async () => {
            const manifest = await this.store.publishStagedEntries(buildCompiledDir, entries, profilesRoot);
            await this.publishRegistry(manifest, "batch");
            return manifest;
        });
    }

    /**
     * 磁盘 release 已经提交后翻转 Registry；失败时只允许抛 committed error。
     */
    private async publishRegistry(manifest: ProfileArtifactManifest, operation: ProfileReleaseOperation): Promise<void> {
        if (this.input.mode !== "in_process") {
            return;
        }
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                await this.input.registry!.publishProfileRelease(this.input.profileRoot, manifest);
                return;
            } catch (error) {
                lastError = error;
                if (attempt === 0) {
                    await sleep(50);
                }
            }
        }
        void appLogger.warn("agent.profileRelease.registryPublishFailedAfterDiskCommit", {
            profileRoot: this.input.profileRoot,
            operation,
            error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        throw new ProfileReleaseCommittedButRegistryFailedError({
            profileRoot: this.input.profileRoot,
            manifest,
            operation,
            cause: lastError,
        });
    }
}

/**
 * 编译 profile root 下的 profile 源码，生成 runtime 可加载的 `.compiled` 产物。
 */
export async function compileProfileArtifacts(options: CompileProfileArtifactsOptions): Promise<CompileProfileArtifactsResult> {
    const staged = await stageProfileArtifacts(options);
    try {
        if (!options.fileName) {
            await assertProfileFullReleaseFresh(staged.profileRoot, staged.sourceFilesAtStart, staged.manifest.entries);
        }
        await new ProfileReleasePublisher({
            profileRoot: staged.profileRoot,
            mode: options.publish?.mode ?? "disk_only",
            registry: options.publish?.registry,
        }).publishStaged(staged.buildCompiledDir, staged.manifest);
        return {
            manifest: staged.manifest,
            compiledDir: staged.compiledDir,
            manifestPath: staged.manifestPath,
            compiled: staged.compiled,
        };
    } finally {
        await cleanupProfileArtifactStaging(staged.buildCompiledDir);
    }
}

/**
 * 只生成 staging artifact 与下一版 manifest，不发布到真实 `.compiled`。
 * HTTP runtime worker 使用该函数把发布权交回 server 主线程。
 */
export async function stageProfileArtifacts(options: CompileProfileArtifactsOptions): Promise<StagedProfileArtifactsResult> {
    const profileRoot = resolve(options.profileRoot);
    const compiledDir = join(profileRoot, PROFILE_COMPILED_DIR_NAME);
    const fullCompile = !options.fileName;
    const buildCompiledDir = resolve(process.cwd(), ".agent", "workspace", "profile-artifact-build", randomUUID());
    await mkdir(buildCompiledDir, {recursive: true});
    const existingManifest = await readProfileArtifactManifest(profileRoot);
    const targetFiles = options.fileName
        ? [resolveProfileFile(profileRoot, options.fileName)]
        : await findProfileFiles(profileRoot);
    const manifestEntries: ProfileArtifactManifestEntry[] = [];
    const compiled: ProfileArtifactManifestItem[] = [];

    try {
        const compileResults = await mapConcurrent(targetFiles, profileCompileConcurrency(targetFiles.length), async (file): Promise<ProfileCompileFileResult> => {
            const existingItem = existingManifest.profiles.find((item) => item.fileName === file.fileName);
            if (options.skipFresh && existingItem && (await validateProfileArtifact(profileRoot, existingItem, {requireTypeArtifact: true})).fresh) {
                return {entry: existingItem};
            }
            try {
                const item = await compileProfileFile(profileRoot, buildCompiledDir, file);
                return {entry: item, compiled: item};
            } catch (error) {
                return {entry: await compileFailureEntry(file, error)};
            }
        });
        for (const result of compileResults) {
            manifestEntries.push(result.entry);
            if (result.compiled) {
                compiled.push(result.compiled);
            }
        }

        const nextEntries = (fullCompile
            ? manifestEntries
            : [
                ...existingManifest.entries.filter((item) => !manifestEntries.some((next) => next.fileName === item.fileName)),
                ...manifestEntries,
            ]).sort((left, right) => left.fileName.localeCompare(right.fileName));
        const nextProfiles = nextEntries.filter(isLoadedManifestEntry);
        const manifest: ProfileArtifactManifest = {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: profilesEqual(existingManifest.entries, nextEntries) ? existingManifest.generatedAt : new Date().toISOString(),
            profilesRoot: options.rootLabel ?? normalizeArtifactPath(profileRoot),
            entries: nextEntries,
            profiles: nextProfiles,
        };
        const manifestPath = profileArtifactManifestPath(profileRoot);
        return {
            manifest,
            compiledDir,
            manifestPath,
            compiled,
            profileRoot,
            buildCompiledDir,
            sourceFilesAtStart: targetFiles,
        };
    } catch (error) {
        await cleanupProfileArtifactStaging(buildCompiledDir);
        throw error;
    }
}

/**
 * 判断 full compile 期间 profile 源文件集合是否发生变化。
 */
export async function profileSourceFileSetChangedSinceCompile(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[]): Promise<boolean> {
    const started = profileSourceFileNames(filesAtStart);
    const current = profileSourceFileNames(await listProfileArtifactSourceFiles(profileRoot));
    if (started.length !== current.length) {
        return true;
    }
    return started.some((fileName, index) => fileName !== current[index]);
}

/**
 * full replacement 发布前统一执行 source file set gate。
 */
export async function assertProfileSourceFileSetUnchanged(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[]): Promise<void> {
    if (await profileSourceFileSetChangedSinceCompile(profileRoot, filesAtStart)) {
        throw new ProfileArtifactSourceFileSetChangedError(profileRoot);
    }
}

/**
 * full replacement 发布前统一执行 freshness gate：源码集合和每个 entry 对应源码内容都必须未变化。
 */
export async function assertProfileFullReleaseFresh(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[], entries: ProfileArtifactManifestEntry[]): Promise<void> {
    await assertProfileSourceFileSetUnchanged(profileRoot, filesAtStart);
    for (const entry of entries) {
        const current = await hashFile(join(profileRoot, ...entry.fileName.split("/"))).catch(() => null);
        if (!current || current.sha256 !== entry.sourceSha256 || current.bytes !== entry.sourceBytes) {
            throw new ProfileArtifactSourceContentChangedError(profileRoot, entry.fileName);
        }
    }
}

/**
 * 判断 full replacement 发布前源码集合或同名源码内容是否已经变化。
 */
export async function profileFullReleaseChangedSinceCompile(profileRoot: string, filesAtStart: ProfileArtifactSourceFile[], entries: ProfileArtifactManifestEntry[]): Promise<boolean> {
    try {
        await assertProfileFullReleaseFresh(profileRoot, filesAtStart, entries);
        return false;
    } catch (error) {
        if (error instanceof ProfileArtifactSourceFileSetChangedError || error instanceof ProfileArtifactSourceContentChangedError) {
            return true;
        }
        throw error;
    }
}

/**
 * 生成稳定排序的 profile source fileName 视图。
 */
function profileSourceFileNames(files: ProfileArtifactSourceFile[]): string[] {
    return files.map((file) => file.fileName).sort((left, right) => left.localeCompare(right));
}

/**
 * 清理 profile artifact staging 目录。清理失败不改变 release 主结果。
 */
export async function cleanupProfileArtifactStaging(buildCompiledDir: string): Promise<void> {
    await rm(buildCompiledDir, {recursive: true, force: true}).catch((error) => {
        void appLogger.warn("agent.profileArtifact.stagingCleanupFailed", {
            buildCompiledDir,
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

/**
 * 只编译一个 profile 源码到独立 staging，并返回单条 manifest entry。
 * worker 池全量编译使用它做 fan-out，主线程再 fan-in 成一次 manifest 发布。
 */
export async function stageProfileArtifactEntry(options: {
    profileRoot: string;
    fileName: string;
}): Promise<StagedProfileArtifactEntryResult> {
    const profileRoot = resolve(options.profileRoot);
    const buildCompiledDir = resolve(process.cwd(), ".agent", "workspace", "profile-artifact-build", randomUUID());
    await mkdir(buildCompiledDir, {recursive: true});
    try {
        const file = resolveProfileFile(profileRoot, options.fileName);
        try {
            const item = await compileProfileFile(profileRoot, buildCompiledDir, file);
            return {
                profileRoot,
                buildCompiledDir,
                entry: item,
                compiled: item,
            };
        } catch (error) {
            return {
                profileRoot,
                buildCompiledDir,
                entry: await compileFailureEntry(file, error),
            };
        }
    } catch (error) {
        await cleanupProfileArtifactStaging(buildCompiledDir);
        throw error;
    }
}

/**
 * 列出 profile root 下所有可编译 profile 源文件。
 */
export async function listProfileArtifactSourceFiles(profileRoot: string): Promise<ProfileArtifactSourceFile[]> {
    return findProfileFiles(resolve(profileRoot));
}

/**
 * 读取 `.compiled/manifest.json`。缺失或格式不匹配时返回空 manifest。
 */
export async function readProfileArtifactManifest(profileRoot: string): Promise<ProfileArtifactManifest> {
    const root = resolve(profileRoot);
    try {
        const value = JSON.parse(await readFile(profileArtifactManifestPath(root), "utf8")) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return emptyArtifactManifest(root);
        }
        const record = value as Record<string, unknown>;
        if (record.compilerVersion !== PROFILE_ARTIFACT_COMPILER_VERSION) {
            return emptyArtifactManifest(root);
        }
        const rawEntries = normalizeManifestProfileEntries(record.profiles);
        if (!rawEntries) {
            return emptyArtifactManifest(root);
        }
        const entries = rawEntries.flatMap(parseManifestEntry);
        if (entries.length !== rawEntries.length) {
            return emptyArtifactManifest(root);
        }
        const profiles = entries.filter(isLoadedManifestEntry);
        return {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date(0).toISOString(),
            profilesRoot: typeof record.profilesRoot === "string" ? record.profilesRoot : normalizeArtifactPath(root),
            entries,
            profiles,
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return emptyArtifactManifest(root);
        }
        throw error;
    }
}

function normalizeManifestProfileEntries(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
        return value;
    }
    if (!value || typeof value !== "object") {
        return null;
    }
    return Object.values(value);
}

function parseManifestEntry(item: unknown): ProfileArtifactManifestEntry[] {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
    }
    const profile = item as Record<string, unknown>;
    if (profile.status === "compile_failed") {
        return parseFailedManifestEntry(profile);
    }
    return parseLoadedManifestEntry(profile);
}

function parseLoadedManifestEntry(profile: Record<string, unknown>): ProfileArtifactManifestItem[] {
    const artifactSha256 = typeof profile.artifactSha === "string" ? profile.artifactSha : profile.artifactSha256;
    const typeSha256 = typeof profile.typeSha === "string" ? profile.typeSha : profile.typeSha256;
    const artifactFileName = typeof profile.artifactFileName === "string"
        ? profile.artifactFileName
        : typeof artifactSha256 === "string"
            ? `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactSha256}.mjs`
            : undefined;
    const typeFileName = typeof profile.typeFileName === "string"
        ? profile.typeFileName
        : typeof artifactSha256 === "string" && typeof typeSha256 === "string"
            ? `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactSha256}.${VARIABLE_TYPES_FILE_NAME}`
            : undefined;
    if (
        (profile.status !== undefined && profile.status !== "loaded")
        || typeof profile.fileName !== "string"
        || typeof profile.profileKey !== "string"
        || typeof profile.sourceSha256 !== "string"
        || typeof profile.sourceBytes !== "number"
        || typeof profile.dependencyHash !== "string"
        || typeof artifactFileName !== "string"
        || typeof artifactSha256 !== "string"
        || typeof profile.artifactBytes !== "number"
        || !Array.isArray(profile.dependencies)
    ) {
        return [];
    }
    const dependencies = profile.dependencies.flatMap((dependency): ProfileArtifactDependency[] => {
        if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
            return [];
        }
        const value = dependency as Record<string, unknown>;
        return typeof value.path === "string" && typeof value.sha256 === "string" && typeof value.bytes === "number"
            ? [{path: value.path, sha256: value.sha256, bytes: value.bytes}]
            : [];
    });
    if (dependencies.length !== profile.dependencies.length) {
        return [];
    }
    return [{
        status: "loaded",
        fileName: profile.fileName,
        profileKey: profile.profileKey,
        sourceSha256: profile.sourceSha256,
        sourceBytes: profile.sourceBytes,
        dependencyHash: profile.dependencyHash,
        artifactFileName,
        artifactSha256,
        artifactBytes: profile.artifactBytes,
        typeFileName,
        typeSha256: typeof typeSha256 === "string" ? typeSha256 : undefined,
        typeBytes: typeof profile.typeBytes === "number" ? profile.typeBytes : undefined,
        typeDiagnostics: Array.isArray(profile.typeDiagnostics) ? profile.typeDiagnostics as VariableTypeGenerationDiagnostic[] : undefined,
        registeredVariablePaths: Array.isArray(profile.registeredVariablePaths) ? profile.registeredVariablePaths.filter((item): item is string => typeof item === "string") : undefined,
        dependencies,
    }];
}

function parseFailedManifestEntry(profile: Record<string, unknown>): ProfileArtifactManifestFailureItem[] {
    if (
        typeof profile.fileName !== "string"
        || typeof profile.profileKey !== "string"
        || typeof profile.sourceSha256 !== "string"
        || typeof profile.sourceBytes !== "number"
        || !Array.isArray(profile.issues)
    ) {
        return [];
    }
    const issues = profile.issues.flatMap((issue): ProfileArtifactCompileFailure[] => {
        if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
            return [];
        }
        const value = issue as Record<string, unknown>;
        return value.code === "compile_failed" && typeof value.message === "string"
            ? [{
                code: "compile_failed",
                message: value.message,
                stack: typeof value.stack === "string" ? value.stack : undefined,
            }]
            : [];
    });
    if (issues.length !== profile.issues.length) {
        return [];
    }
    return [{
        status: "compile_failed",
        fileName: profile.fileName,
        profileKey: profile.profileKey,
        sourceSha256: profile.sourceSha256,
        sourceBytes: profile.sourceBytes,
        issues,
    }];
}

function isLoadedManifestEntry(entry: ProfileArtifactManifestEntry): entry is ProfileArtifactManifestItem {
    return entry.status !== "compile_failed";
}

/**
 * 返回指定 profile root 下的 manifest 文件路径。
 */
export function profileArtifactManifestPath(profileRoot: string): string {
    return join(resolve(profileRoot), PROFILE_COMPILED_DIR_NAME, PROFILE_COMPILED_MANIFEST_FILE);
}

/**
 * 验证 manifest item 对应的源码、依赖和 artifact 是否仍然新鲜。
 */
export async function validateProfileArtifact(profileRoot: string, item: ProfileArtifactManifestItem, options: {
    requireTypeArtifact?: boolean;
    checkDependencies?: boolean;
} = {}): Promise<{
    fresh: boolean;
    reason?: "source_changed" | "dependency_changed" | "artifact_missing" | "artifact_changed" | "type_artifact_missing" | "type_artifact_changed";
}> {
    const root = resolve(profileRoot);
    const sourcePath = join(root, ...item.fileName.split("/"));
    const sourceHash = await hashFile(sourcePath).catch(() => null);
    if (!sourceHash || sourceHash.sha256 !== item.sourceSha256 || sourceHash.bytes !== item.sourceBytes) {
        return {fresh: false, reason: "source_changed"};
    }
    const artifactPath = join(root, PROFILE_COMPILED_DIR_NAME, item.artifactFileName);
    if (!existsSync(artifactPath)) {
        return {fresh: false, reason: "artifact_missing"};
    }
    const artifactHash = await hashFile(artifactPath);
    if (artifactHash.sha256 !== item.artifactSha256 || artifactHash.bytes !== item.artifactBytes) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (await artifactHasNitroImportMetaShim(artifactPath)) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (isProductRuntimeRoot() && !await artifactHasProductRequireShim(artifactPath)) {
        return {fresh: false, reason: "artifact_changed"};
    }
    if (!options.requireTypeArtifact) {
        if (options.checkDependencies === false) {
            return {fresh: true};
        }
        return validateProfileArtifactDependencies(item);
    }
    if (!item.typeFileName || !item.typeSha256 || item.typeBytes === undefined) {
        return {fresh: false, reason: "type_artifact_missing"};
    }
    const typeArtifactHash = await hashFile(join(root, PROFILE_COMPILED_DIR_NAME, item.typeFileName)).catch(() => null);
    if (!typeArtifactHash) {
        return {fresh: false, reason: "type_artifact_missing"};
    }
    if (typeArtifactHash.sha256 !== item.typeSha256 || typeArtifactHash.bytes !== item.typeBytes) {
        return {fresh: false, reason: "type_artifact_changed"};
    }
    if (options.checkDependencies === false) {
        return {fresh: true};
    }
    return validateProfileArtifactDependencies(item);
}

async function validateProfileArtifactDependencies(item: ProfileArtifactManifestItem): Promise<{
    fresh: boolean;
    reason?: "dependency_changed";
}> {
    for (const dependency of item.dependencies) {
        const current = await hashFile(resolveArtifactPath(dependency.path)).catch(() => null);
        if (!current || current.sha256 !== dependency.sha256 || current.bytes !== dependency.bytes) {
            return {fresh: false, reason: "dependency_changed"};
        }
    }
    return {fresh: true};
}

/**
 * 复制系统 artifact manifest entry 到另一个 profile root 时，重写入口源码依赖路径。
 * bundle artifact 本身不变，但用户覆盖的源码 hash 应绑定用户侧源码文件。
 */
export function rehomeProfileArtifactItem(item: ProfileArtifactManifestItem, input: {
    fromRootLabel: string;
    toRootLabel: string;
}): ProfileArtifactManifestItem {
    const fromPrefix = input.fromRootLabel.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    const toPrefix = input.toRootLabel.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    return {
        ...item,
        dependencies: item.dependencies.map((dependency) => {
            const dependencyPath = dependency.path.replace(/[\\/]+/g, "/");
            if (dependencyPath === `${fromPrefix}/${item.fileName}`) {
                return {
                    ...dependency,
                    path: `${toPrefix}/${item.fileName}`,
                };
            }
            return dependency;
        }),
    };
}

/**
 * 将 artifact manifest 里的依赖路径解析回当前 checkout 下的真实路径。
 */
export function resolveArtifactPath(filePath: string): string {
    if (isAbsolute(filePath) || /^[A-Za-z]:\//.test(filePath)) {
        return resolve(filePath);
    }
    return resolve(process.cwd(), filePath);
}

/**
 * 计算文件 sha256 与大小。
 */
export async function hashFile(filePath: string): Promise<{sha256: string; bytes: number}> {
    const bytes = await readFile(filePath);
    return {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
    };
}

function profileCompileConcurrency(fileCount: number): number {
    if (fileCount <= 1) {
        return 1;
    }
    return Math.max(1, Math.min(fileCount, PROFILE_COMPILE_MAX_FILE_CONCURRENCY, Math.max(1, availableParallelism() - 2)));
}

async function mapConcurrent<TInput, TOutput>(items: TInput[], concurrency: number, task: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
    const results: TOutput[] = new Array<TOutput>(items.length);
    let nextIndex = 0;
    const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            const item = items[index]!;
            results[index] = await task(item);
        }
    });
    await Promise.all(workers);
    return results;
}

async function compileFailureEntry(file: ProfileFileEntry, error: unknown): Promise<ProfileArtifactManifestFailureItem> {
    const sourceHash = await hashFile(file.absolutePath);
    const message = error instanceof Error ? error.message : String(error);
    return {
        status: "compile_failed",
        fileName: file.fileName,
        profileKey: await profileKeyFromSource(file),
        sourceSha256: sourceHash.sha256,
        sourceBytes: sourceHash.bytes,
        issues: [{
            code: "compile_failed",
            message,
            stack: process.env.NODE_ENV === "production" || !(error instanceof Error) ? undefined : error.stack,
        }],
    };
}

async function profileKeyFromSource(file: ProfileFileEntry): Promise<string> {
    const source = await readFile(file.absolutePath, "utf8").catch(() => "");
    const match = source.match(/\bkey\s*:\s*["'`]([^"'`]+)["'`]/u);
    return match?.[1] ?? profileKeyFromFileName(file.fileName);
}

function profileKeyFromFileName(fileName: string): string {
    return basename(fileName).replace(/\.profile\.(tsx|ts|mjs|js)$/u, "");
}

async function compileProfileFile(profileRoot: string, compiledDir: string, file: ProfileFileEntry): Promise<ProfileArtifactManifestItem> {
    const sourceHash = await hashFile(file.absolutePath);
    const temporaryStem = stableArtifactStem(file.fileName, /\.profile\.(tsx|ts|mjs|js)$/);
    const temporaryOutputPath = join(compiledDir, `${temporaryStem}.${randomUUID()}.building.mjs`);
    const temporaryTypePath = join(compiledDir, `${temporaryStem}.${randomUUID()}.building.${VARIABLE_TYPES_FILE_NAME}`);
    const tsconfigPath = resolve(process.cwd(), "tsconfig.json");
    let dependencies: ProfileArtifactDependency[];

    try {
        const result = await build({
            absWorkingDir: process.cwd(),
            banner: {
                js: runtimeRequireBanner(),
            },
            bundle: true,
            entryPoints: [file.absolutePath],
            format: "esm",
            jsx: "automatic",
            jsxImportSource: "nbook/server/agent/profiles/profile-dsl",
            logLevel: "silent",
            metafile: true,
            nodePaths: runtimeNodePaths(),
            outfile: temporaryOutputPath,
            platform: "node",
            plugins: [repoAliasBundlePlugin()],
            target: "esnext",
            tsconfig: tsconfigPath,
        });
        if (!result.metafile) {
            throw new Error(`profile ${file.fileName} 编译缺少 esbuild metafile。`);
        }
        dependencies = await readArtifactDependencies(result.metafile, tsconfigPath);
        const dependencyHash = hashArtifactDependencies(file.absolutePath, dependencies);
        const artifactHash = await hashFile(temporaryOutputPath);
        const artifactFileName = `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactHash.sha256}.mjs`;
        const artifactPath = join(compiledDir, ...artifactFileName.split("/"));
        const profile = await importCompiledProfile(temporaryOutputPath, artifactHash);
        const typeFileName = `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${artifactHash.sha256}.${VARIABLE_TYPES_FILE_NAME}`;
        const typePath = join(compiledDir, ...typeFileName.split("/"));
        const generatedTypes = generateVariableTypes(profile.variableDefinitions ?? [], {
            header: `Session variable authoring types generated from ${file.fileName}.`,
        });
        await writeFile(temporaryTypePath, generatedTypes.text, "utf8");
        const typeHash = await hashFile(temporaryTypePath);
        await promoteImmutableArtifact(temporaryOutputPath, artifactPath, artifactHash);
        await promoteImmutableArtifact(temporaryTypePath, typePath, typeHash);
        return {
            status: "loaded",
            fileName: file.fileName,
            profileKey: profile.manifest.key,
            sourceSha256: sourceHash.sha256,
            sourceBytes: sourceHash.bytes,
            dependencyHash,
            artifactFileName,
            artifactSha256: artifactHash.sha256,
            artifactBytes: artifactHash.bytes,
            typeFileName,
            typeSha256: typeHash.sha256,
            typeBytes: typeHash.bytes,
            typeDiagnostics: generatedTypes.diagnostics,
            registeredVariablePaths: (profile.variableDefinitions ?? []).map((definition) => `${definition.namespace}.${definition.key}`).sort(),
            dependencies,
        };
    } finally {
        await rm(temporaryOutputPath, {force: true});
        await rm(temporaryTypePath, {force: true});
    }
}

async function importCompiledProfile(artifactPath: string, artifactHash: {sha256: string; bytes: number}): Promise<AgentProfile> {
    const mod = await importRuntimeArtifact<{default?: unknown}>(artifactPath, {
        cacheKey: artifactHash.sha256,
        cacheNamespace: "profile-compiler",
        expectedBytes: artifactHash.bytes,
    });
    const profile = mod.default;
    if (!isProfile(profile)) {
        throw new Error(`compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
    }
    return profile;
}

async function artifactHasProductRequireShim(artifactPath: string): Promise<boolean> {
    const head = (await readFile(artifactPath, "utf8")).slice(0, 2048);
    return head.includes("__nbookResolveProductRequireRoot");
}

async function artifactHasNitroImportMetaShim(artifactPath: string): Promise<boolean> {
    const head = (await readFile(artifactPath, "utf8")).slice(0, 2048);
    return head.includes("globalThis._importMeta_");
}

function isProfile(value: unknown): value is AgentProfile {
    return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "initialSchema" in value
            && "tools" in value
            && "rootToolKeys" in value
            && "prepare" in value
            && typeof (value as {prepare?: unknown}).prepare === "function",
    );
}

async function findProfileFiles(root: string, current = root): Promise<ProfileFileEntry[]> {
    if (!existsSync(current)) {
        return [];
    }
    const entries = await readdir(current, {withFileTypes: true});
    const files: ProfileFileEntry[] = [];
    for (const entry of entries) {
        if (entry.name === PROFILE_COMPILED_DIR_NAME) {
            continue;
        }
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findProfileFiles(root, fullPath));
            continue;
        }
        if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            files.push({
                fileName: relative(root, fullPath).split(/[\\/]+/).join("/"),
                absolutePath: fullPath,
            });
        }
    }
    return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function resolveProfileFile(profileRoot: string, fileName: string): ProfileFileEntry {
    const normalized = fileName.split(/[\\/]+/).filter(Boolean).join("/");
    if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || /^[A-Za-z]:/.test(fileName) || fileName.startsWith("/") || fileName.startsWith("\\")) {
        throw new Error("profile fileName 必须是 profile root 下的相对路径。");
    }
    if (!/\.profile\.(tsx|ts|mjs|js)$/.test(basename(normalized))) {
        throw new Error("profile 文件名必须使用 .profile.tsx/.profile.ts/.profile.mjs/.profile.js。");
    }
    const absolutePath = join(profileRoot, ...normalized.split("/"));
    if (!existsSync(absolutePath)) {
        throw new ProfileArtifactSourceMissingError(`profile 文件不存在：${normalized}`);
    }
    return {
        fileName: normalized,
        absolutePath,
    };
}

async function readArtifactDependencies(metafile: Metafile, tsconfigPath: string): Promise<ProfileArtifactDependency[]> {
    const paths = new Set<string>([tsconfigPath]);
    for (const inputPath of Object.keys(metafile.inputs)) {
        if (!inputPath.startsWith("<")) {
            paths.add(resolve(process.cwd(), inputPath));
        }
    }
    const dependencies = await mapConcurrent(
        [...paths].sort((left, right) => left.localeCompare(right)),
        PROFILE_DEPENDENCY_HASH_CONCURRENCY,
        artifactDependency,
    );
    return dependencies.sort((left, right) => left.path.localeCompare(right.path));
}

async function artifactDependency(filePath: string): Promise<ProfileArtifactDependency> {
    const hash = await hashFile(filePath);
    return {
        path: normalizeArtifactPath(filePath),
        sha256: hash.sha256,
        bytes: hash.bytes,
    };
}

function hashArtifactDependencies(sourcePath: string, dependencies: ProfileArtifactDependency[]): string {
    const hash = createHash("sha256")
        .update("profile-artifact")
        .update("\0")
        .update(String(PROFILE_ARTIFACT_COMPILER_VERSION))
        .update("\0")
        .update(normalizeArtifactPath(sourcePath));
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

async function promoteImmutableArtifact(temporaryOutputPath: string, outputPath: string, expected: {sha256: string; bytes: number}): Promise<boolean> {
    const previous = artifactPromotionLocks.get(outputPath) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = previous.then(() => new Promise<void>((resolveLock) => {
        release = resolveLock;
    }));
    artifactPromotionLocks.set(outputPath, current);
    await previous;
    try {
        return await promoteImmutableArtifactUnlocked(temporaryOutputPath, outputPath, expected);
    } finally {
        release();
        if (artifactPromotionLocks.get(outputPath) === current) {
            artifactPromotionLocks.delete(outputPath);
        }
    }
}

async function promoteImmutableArtifactUnlocked(temporaryOutputPath: string, outputPath: string, expected: {sha256: string; bytes: number}): Promise<boolean> {
    await mkdir(dirname(outputPath), {recursive: true});
    const existing = await hashFile(outputPath).catch(() => null);
    if (existing) {
        if (existing.sha256 !== expected.sha256 || existing.bytes !== expected.bytes) {
            throw new Error(`content-addressed artifact 已存在但内容不匹配：${outputPath}`);
        }
        await rm(temporaryOutputPath, {force: true});
        return false;
    }
    await renameWithRetry(temporaryOutputPath, outputPath);
    return true;
}

async function commitCompiledArtifacts(buildCompiledDir: string, compiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
    await mkdir(compiledDir, {recursive: true});
    await withCompiledPublishLock(compiledDir, async () => {
        for (const item of manifest.profiles) {
            await installManifestEntryArtifacts(buildCompiledDir, compiledDir, item);
        }
        await writeJsonIfChanged(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), serializeProfileArtifactManifest(manifest));
        await pruneCompiledArtifacts(compiledDir, manifest);
    });
}

async function commitCompiledArtifactEntry(buildCompiledDir: string, compiledDir: string, entry: ProfileArtifactManifestEntry, profilesRoot?: string): Promise<ProfileArtifactManifest> {
    return commitCompiledArtifactEntries(buildCompiledDir, compiledDir, [entry], profilesRoot);
}

async function commitCompiledArtifactEntries(buildCompiledDir: string, compiledDir: string, entries: ProfileArtifactManifestEntry[], profilesRoot?: string): Promise<ProfileArtifactManifest> {
    await mkdir(compiledDir, {recursive: true});
    return withCompiledPublishLock(compiledDir, async () => {
        const existingManifest = await readProfileArtifactManifest(dirname(compiledDir));
        for (const entry of entries) {
            if (entry.status === "compile_failed") {
                continue;
            }
            await installManifestEntryArtifacts(buildCompiledDir, compiledDir, entry);
        }
        const replaceFileNames = new Set(entries.map((entry) => entry.fileName));
        const nextEntries = [
            ...existingManifest.entries.filter((item) => !replaceFileNames.has(item.fileName)),
            ...entries,
        ].sort((left, right) => left.fileName.localeCompare(right.fileName));
        const manifest: ProfileArtifactManifest = {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: profilesEqual(existingManifest.entries, nextEntries) ? existingManifest.generatedAt : new Date().toISOString(),
            profilesRoot: existingManifest.entries.length > 0 ? existingManifest.profilesRoot : profilesRoot ?? existingManifest.profilesRoot,
            entries: nextEntries,
            profiles: nextEntries.filter(isLoadedManifestEntry),
        };
        await writeJsonIfChanged(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), serializeProfileArtifactManifest(manifest));
        await pruneCompiledArtifacts(compiledDir, manifest);
        return manifest;
    });
}

async function withProfileReleaseQueue<T>(profileRoot: string, task: () => Promise<T>): Promise<T> {
    const key = resolve(profileRoot);
    const previous = profileReleaseQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const queued = run.then(() => undefined, () => undefined);
    profileReleaseQueues.set(key, queued);
    try {
        return await run;
    } finally {
        if (profileReleaseQueues.get(key) === queued) {
            profileReleaseQueues.delete(key);
        }
    }
}

async function installManifestEntryArtifacts(buildCompiledDir: string, compiledDir: string, item: ProfileArtifactManifestItem): Promise<void> {
    const sourcePath = join(buildCompiledDir, ...item.artifactFileName.split("/"));
    if (existsSync(sourcePath)) {
        await installImmutableArtifact(sourcePath, join(compiledDir, ...item.artifactFileName.split("/")), {
            sha256: item.artifactSha256,
            bytes: item.artifactBytes,
        });
    }
    if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
        const typeSourcePath = join(buildCompiledDir, ...item.typeFileName.split("/"));
        if (existsSync(typeSourcePath)) {
            await installImmutableArtifact(typeSourcePath, join(compiledDir, ...item.typeFileName.split("/")), {
                sha256: item.typeSha256,
                bytes: item.typeBytes,
            });
        }
    }
}

function serializeProfileArtifactManifest(manifest: ProfileArtifactManifest): unknown {
    return {
        compilerVersion: manifest.compilerVersion,
        generatedAt: manifest.generatedAt,
        profilesRoot: manifest.profilesRoot,
        profiles: Object.fromEntries(manifest.entries.map((entry) => [entry.profileKey, serializeManifestEntry(entry)])),
    };
}

function serializeManifestEntry(entry: ProfileArtifactManifestEntry): unknown {
    if (entry.status === "compile_failed") {
        return entry;
    }
    return {
        status: "loaded",
        fileName: entry.fileName,
        profileKey: entry.profileKey,
        sourceSha256: entry.sourceSha256,
        sourceBytes: entry.sourceBytes,
        dependencyHash: entry.dependencyHash,
        artifactSha: entry.artifactSha256,
        artifactBytes: entry.artifactBytes,
        typeSha: entry.typeSha256,
        typeBytes: entry.typeBytes,
        typeDiagnostics: entry.typeDiagnostics,
        registeredVariablePaths: entry.registeredVariablePaths,
        dependencies: entry.dependencies,
    };
}

async function withCompiledPublishLock<T>(compiledDir: string, task: () => Promise<T>): Promise<T> {
    const release = await lockFile(compiledDir, {
        lockfilePath: join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK),
        realpath: false,
        stale: 30_000,
        update: 10_000,
        retries: {
            retries: 20,
            factor: 1.2,
            minTimeout: 50,
            maxTimeout: 500,
        },
    });
    try {
        return await task();
    } finally {
        await release();
    }
}

async function installImmutableArtifact(sourcePath: string, outputPath: string, expected: {sha256: string; bytes: number}): Promise<void> {
    await mkdir(dirname(outputPath), {recursive: true});
    const existing = await hashFile(outputPath).catch(() => null);
    if (existing) {
        if (existing.sha256 === expected.sha256 && existing.bytes === expected.bytes) {
            return;
        }
        void appLogger.warn("agent.profileArtifact.corruptArtifactReplaced", {
            outputPath,
            expectedSha256: expected.sha256,
            expectedBytes: expected.bytes,
            actualSha256: existing.sha256,
            actualBytes: existing.bytes,
        });
    }
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    try {
        await copyFile(sourcePath, temporaryPath);
        const copied = await hashFile(temporaryPath);
        if (copied.sha256 !== expected.sha256 || copied.bytes !== expected.bytes) {
            throw new Error(`content-addressed artifact 写入校验失败：${outputPath}`);
        }
        if (existing) {
            await rm(outputPath, {force: true});
        }
        await renameWithRetry(temporaryPath, outputPath);
    } finally {
        await rm(temporaryPath, {force: true});
    }
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
    const next = `${JSON.stringify(value, null, 2)}\n`;
    const current = await readFile(filePath, "utf8").catch(() => null);
    if (current === next) {
        return;
    }
    await mkdir(dirname(filePath), {recursive: true});
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, next, "utf8");
        await renameWithRetry(temporaryPath, filePath);
    } finally {
        await rm(temporaryPath, {force: true});
    }
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
    const delays = [20, 50, 100, 200, 400];
    for (let attempt = 0; ; attempt += 1) {
        try {
            await rename(sourcePath, targetPath);
            return;
        } catch (error) {
            if (attempt >= delays.length || !isTransientRenameError(error)) {
                throw error;
            }
            await sleep(delays[attempt]!);
        }
    }
}

function isTransientRenameError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return false;
    }
    return error.code === "EPERM" || error.code === "EBUSY" || error.code === "EACCES";
}

async function pruneCompiledArtifacts(compiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
    const keep = new Set([
        PROFILE_COMPILED_MANIFEST_FILE,
        ...manifest.profiles.flatMap((item) => [item.artifactFileName, item.typeFileName].filter((name): name is string => Boolean(name))),
    ]);
    const entries = await readdir(compiledDir, {withFileTypes: true}).catch(() => []);
    await Promise.all(entries
        .filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name) && !keep.has(entry.name))
        .map((entry) => rm(join(compiledDir, entry.name), {force: true})));
    await pruneContentAddressedArtifacts(compiledDir, keep);
}

async function pruneContentAddressedArtifacts(compiledDir: string, keep: Set<string>): Promise<void> {
    const artifactsDir = join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME);
    const entries = await readdir(artifactsDir, {withFileTypes: true}).catch(() => []);
    const now = Date.now();
    await Promise.all(entries
        .filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name))
        .map(async (entry) => {
            const relativeName = `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${entry.name}`;
            if (keep.has(relativeName)) {
                return;
            }
            const filePath = join(artifactsDir, entry.name);
            const fileStat = await stat(filePath).catch(() => null);
            if (!fileStat || now - fileStat.mtimeMs < PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS) {
                return;
            }
            await rm(filePath, {force: true});
        }));
}

/**
 * Product Root 没有根 node_modules，profile 编译需要从 Nitro vendor 解析包。
 */
function runtimeNodePaths(): string[] {
    if (!isProductRuntimeRoot()) {
        return [];
    }
    const runtimeNodeModules = resolve(process.cwd(), ".output", "server", "node_modules");
    return existsSync(runtimeNodeModules) ? [runtimeNodeModules] : [];
}

/**
 * Product Runtime 的动态 artifact 不在 `.output/server` 下，不能用 artifact
 * 自身位置解析 native/dynamic require；否则会越过 Nitro vendor。
 */
function runtimeRequireBanner(): string {
    const artifactUrl = runtimeImportMetaUrlExpression();
    const compilerVersionBanner = `/* nbook-profile-artifact-compiler-version:${PROFILE_ARTIFACT_COMPILER_VERSION} */`;
    if (!isProductRuntimeRoot()) {
        return `${compilerVersionBanner}import {createRequire as __nbookCreateRequire} from "node:module";const require=__nbookCreateRequire(${artifactUrl});`;
    }
    return [
        compilerVersionBanner,
        'import {createRequire as __nbookCreateRequire} from "node:module";',
        'import {existsSync as __nbookExistsSync} from "node:fs";',
        'import {dirname as __nbookDirname, resolve as __nbookResolve} from "node:path";',
        'import {fileURLToPath as __nbookFileURLToPath} from "node:url";',
        `function __nbookResolveProductRequireRoot(){const cwdEntry=__nbookResolve(process.cwd(),".output","server","index.mjs");if(__nbookExistsSync(cwdEntry))return cwdEntry;let current=__nbookDirname(__nbookFileURLToPath(${artifactUrl}));while(true){const entry=__nbookResolve(current,".output","server","index.mjs");if(__nbookExistsSync(entry))return entry;const parent=__nbookDirname(current);if(parent===current)return ${artifactUrl};current=parent;}}`,
        "const require=__nbookCreateRequire(__nbookResolveProductRequireRoot());",
    ].join("");
}

function runtimeImportMetaUrlExpression(): string {
    return ["import", ".", "meta", ".", "url"].join("");
}

function repoAliasBundlePlugin(): Plugin {
    const nodeModuleNames = new Set([
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
    ]);
    const requireFromRuntime = createRequire(pathToFileURL(resolvePackageRequireRoot()));
    return {
        name: "nbook-repo-alias-bundle",
        setup(buildApi) {
            buildApi.onResolve({filter: /^(nbook|neuro_book)\//}, (args) => {
                const relativePath = args.path.replace(/^(nbook|neuro_book)\//, "");
                return {
                    path: resolveRepoAliasPath(relativePath),
                };
            });
            buildApi.onResolve({filter: /^[^./].*/}, (args) => nodeModuleNames.has(args.path)
                ? {path: args.path, external: true}
                : resolveBarePackage(args.path, requireFromRuntime));
        },
    };
}

function resolvePackageRequireRoot(): string {
    const outputEntry = resolve(process.cwd(), ".output", "server", "index.mjs");
    if (isProductRuntimeRoot() && existsSync(outputEntry)) {
        return outputEntry;
    }
    return resolve(process.cwd(), "package.json");
}

function isProductRuntimeRoot(): boolean {
    return existsSync(resolve(process.cwd(), ".output", "server", "index.mjs"))
        && Boolean(productPackageManifestPath());
}

/**
 * Product Root 可能来自 `product:stage`，也可能是 GHCR / 通用 `.output`
 * runner。后者只有 `.output/server/package.json`，且不带根 node_modules。
 */
function productPackageManifestPath(): string | null {
    const rootPackage = resolve(process.cwd(), "package.json");
    if (packageManifestName(rootPackage) === "neuro-book-product") {
        return rootPackage;
    }
    const outputPackage = resolve(process.cwd(), ".output", "server", "package.json");
    if (packageManifestName(outputPackage) === "neuro-book-output" && !existsSync(resolve(process.cwd(), "node_modules"))) {
        return outputPackage;
    }
    return null;
}

function packageManifestName(path: string): string | null {
    try {
        const manifest = JSON.parse(readFileSync(path, "utf8")) as {name?: unknown};
        return typeof manifest.name === "string" ? manifest.name : null;
    } catch {
        return null;
    }
}

function resolveBarePackage(specifier: string, requireFromRuntime: NodeJS.Require): {path: string; external?: boolean} | undefined {
    try {
        const resolved = requireFromRuntime.resolve(specifier);
        return isAbsolute(resolved) ? {path: resolved} : {path: specifier, external: true};
    } catch {
        return undefined;
    }
}

function resolveRepoAliasPath(relativePath: string): string {
    const basePath = resolve(process.cwd(), relativePath);
    const candidates = [
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
        join(basePath, "index.js"),
        join(basePath, "index.mjs"),
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        basePath,
    ];
    const resolved = candidates.find((candidate) => existsSync(candidate));
    return resolved ?? basePath;
}

function emptyArtifactManifest(profileRoot: string): ProfileArtifactManifest {
    return {
        compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        profilesRoot: normalizeArtifactPath(profileRoot),
        entries: [],
        profiles: [],
    };
}

function profilesEqual(left: ProfileArtifactManifestEntry[], right: ProfileArtifactManifestEntry[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function stableArtifactStem(fileName: string, extensionPattern: RegExp): string {
    const withoutExtension = fileName.replace(extensionPattern, "");
    const stem = withoutExtension
        .split(/[\\/]+/)
        .filter(Boolean)
        .join("__")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return stem || "artifact";
}

function normalizeArtifactPath(filePath: string): string {
    const absolutePath = resolve(filePath);
    const relativePath = relative(process.cwd(), absolutePath).split(/[\\/]+/).join("/");
    if (relativePath && !relativePath.startsWith("../") && relativePath !== ".." && !/^[A-Za-z]:/.test(relativePath)) {
        return relativePath;
    }
    return absolutePath.split(/[\\/]+/).join("/");
}
