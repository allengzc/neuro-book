import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build, type Metafile} from "esbuild";
import {z} from "zod";
import type {AgentThreadKind, BuiltinProfileKey, ProfileKey} from "nbook/server/agent/types";
import type {AgentProfile, RuntimeAgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {AgentProfileManifest} from "nbook/server/agent/profiles/define-agent-profile";

/**
 * profile 注册表接口。
 */
export interface AgentProfileRegistry {
    get<TKey extends ProfileKey>(profileKey: TKey): Promise<AgentProfile<TKey>>;
    list(): Promise<RuntimeAgentProfile[]>;
    listByKind(kind: AgentThreadKind): Promise<RuntimeAgentProfile[]>;
    register<TKey extends ProfileKey>(profile: AgentProfile<TKey>): void;
    registerContract(profile: RuntimeAgentProfile): void;
    refreshDynamicProfiles(): Promise<void>;
    inspectDynamicProfiles(): Promise<DynamicProfileInspection>;
}

/**
 * 支持 assets 动态覆盖的 profile 注册表。
 */
export class InMemoryAgentProfileRegistry implements AgentProfileRegistry {
    private readonly builtinProfiles = new Map<ProfileKey, RuntimeAgentProfile>();
    private readonly contractProfileKeys = new Set<ProfileKey>();
    private dynamicProfiles: Map<ProfileKey, RuntimeAgentProfile> | null = null;
    private dynamicErrors = new Map<ProfileKey, DynamicProfileError>();
    private dynamicFiles: DynamicProfileFile[] = [];

    constructor(
        private readonly workspaceRoot = process.cwd(),
    ) {}

    async get<TKey extends ProfileKey>(profileKey: TKey): Promise<AgentProfile<TKey>> {
        await this.refreshDynamicProfiles();
        const dynamicError = this.dynamicErrors.get(profileKey);
        if (dynamicError) {
            throw new Error(dynamicError.message);
        }
        const profile = this.dynamicProfiles?.get(profileKey) ?? this.builtinProfiles.get(profileKey);
        if (!profile) {
            throw new Error(`未注册的 profileKey: ${profileKey}`);
        }
        if (this.contractProfileKeys.has(profile.key) && !this.dynamicProfiles?.has(profile.key)) {
            throw new Error(`profile ${profileKey} 只有静态 contract，缺少可运行的 assets profile 实现`);
        }
        return profile as AgentProfile<TKey>;
    }

    async list(): Promise<RuntimeAgentProfile[]> {
        await this.refreshDynamicProfiles();
        const profiles = new Map<ProfileKey, RuntimeAgentProfile>(this.builtinProfiles);
        for (const [key, profile] of this.dynamicProfiles ?? []) {
            profiles.set(key, profile);
        }
        return [...profiles.values()];
    }

    async listByKind(kind: AgentThreadKind): Promise<RuntimeAgentProfile[]> {
        return (await this.list()).filter((profile) => profile.kind === kind);
    }

    register<TKey extends ProfileKey>(profile: AgentProfile<TKey>): void {
        this.builtinProfiles.set(profile.key, profile);
        this.contractProfileKeys.delete(profile.key);
    }

    registerContract(profile: RuntimeAgentProfile): void {
        this.builtinProfiles.set(profile.key, profile);
        this.contractProfileKeys.add(profile.key);
    }

    /**
     * 返回动态 profile 的加载快照，供 catalog/detail 展示错误和来源。
     */
    async inspectDynamicProfiles(): Promise<DynamicProfileInspection> {
        await this.refreshDynamicProfiles();
        return {
            contracts: [...this.builtinProfiles.values()],
            profiles: [...(this.dynamicProfiles?.values() ?? [])],
            files: [...this.dynamicFiles],
            errors: [...this.dynamicErrors.values()],
        };
    }

    /**
     * 刷新动态 profile 缓存。
     */
    async refreshDynamicProfiles(): Promise<void> {
        const nextProfiles = new Map<ProfileKey, RuntimeAgentProfile>();
        const nextErrors = new Map<ProfileKey, DynamicProfileError>();
        const profileFiles = await listProfileFiles(this.workspaceRoot);
        const nextFiles: DynamicProfileFile[] = [];

        for (const file of profileFiles) {
            const manifest = await readProfileManifestSafely(file.absolutePath);
            nextFiles.push({
                ...file,
                profileKey: manifest?.key ?? null,
                kind: manifest?.kind ?? null,
                name: manifest?.name ?? null,
                description: manifest?.description ?? null,
            });
            try {
                const profile = await loadDynamicProfile(file.absolutePath);
                const builtinProfile = this.builtinProfiles.get(profile.key as BuiltinProfileKey);
                assertBuiltinOverrideContract(profile, builtinProfile);
                nextProfiles.set(profile.key, overrideBuiltinSchemaContract(profile, builtinProfile));
            } catch (error) {
                const key = manifest?.key ?? `invalid:${file.absolutePath}`;
                nextErrors.set(key, normalizeProfileLoadError(file.absolutePath, file.relativePath, manifest?.key ?? null, error));
            }
        }

        this.dynamicProfiles = nextProfiles;
        this.dynamicErrors = nextErrors;
        this.dynamicFiles = nextFiles;
    }
}

type ProfileFile = {
    absolutePath: string;
    relativePath: string;
    source: "system" | "user";
};

export type DynamicProfileFile = ProfileFile & {
    profileKey: string | null;
    kind: AgentThreadKind | null;
    name: string | null;
    description: string | null;
};

export type DynamicProfileError = Error & {
    filePath: string;
    relativePath: string;
    profileKey: string | null;
    code: string;
};

export type DynamicProfileInspection = {
    contracts: RuntimeAgentProfile[];
    profiles: RuntimeAgentProfile[];
    files: DynamicProfileFile[];
    errors: DynamicProfileError[];
};

const PROFILE_ROOT_RELATIVE_PATH = path.join("agent", "profiles");
const DYNAMIC_PROFILE_BUILD_ROOT = path.resolve(process.cwd(), ".agent", "generated", "dynamic-profiles");
const ManifestSchema = z.object({
    key: z.string().trim().min(1),
    kind: z.enum(["leader", "subagent"]),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
});

/**
 * 列出动态 profile 文件。用户同相对路径覆盖系统文件。
 */
async function listProfileFiles(workspaceRoot: string): Promise<ProfileFile[]> {
    const filesByRelativePath = new Map<string, ProfileFile>();
    const systemRoot = path.join(workspaceRoot, "assets", PROFILE_ROOT_RELATIVE_PATH);
    const userRoot = path.join(workspaceRoot, "workspace", ".nbook", "assets", PROFILE_ROOT_RELATIVE_PATH);
    await appendProfileFiles(filesByRelativePath, systemRoot, systemRoot, "system");
    await appendProfileFiles(filesByRelativePath, userRoot, userRoot, "user");
    return [...filesByRelativePath.values()];
}

/**
 * 递归追加 profile 文件。
 */
async function appendProfileFiles(filesByRelativePath: Map<string, ProfileFile>, baseRoot: string, root: string, source: ProfileFile["source"]): Promise<void> {
    let entries: Array<import("node:fs").Dirent>;
    try {
        entries = await fs.readdir(root, {withFileTypes: true});
    } catch (error) {
        if (isMissingPathError(error)) {
            return;
        }
        throw error;
    }

    for (const entry of entries) {
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            await appendProfileFiles(filesByRelativePath, baseRoot, absolutePath, source);
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".profile.tsx")) {
            continue;
        }
        filesByRelativePath.set(path.relative(baseRoot, absolutePath), {
            absolutePath,
            relativePath: path.relative(baseRoot, absolutePath).split(path.sep).join("/"),
            source,
        });
    }
}

/**
 * 加载动态 TSX profile。
 */
async function loadDynamicProfile(filePath: string): Promise<RuntimeAgentProfile> {
    const compiledPath = await compileDynamicProfile(filePath);
    const loadedModule = await import(await toVersionedModuleUrl(compiledPath)) as {
        default?: unknown;
    };
    const profile = loadedModule.default;

    if (!isAgentProfile(profile)) {
        throw new Error("dynamic profile 必须 default export defineAgentProfile(...) 的返回值");
    }
    return profile;
}

/**
 * 读取 manifest 只用于错误归属，失败时返回 null。
 */
async function readProfileManifestSafely(filePath: string): Promise<AgentProfileManifest | null> {
    try {
        const compiledPath = await compileDynamicProfile(filePath);
        const loadedModule = await import(await toVersionedModuleUrl(compiledPath)) as {
            profileManifest?: unknown;
        };
        return ManifestSchema.parse(loadedModule.profileManifest);
    } catch {
        return null;
    }
}

/**
 * 编译动态 TSX profile 到 hash 命名的临时 ESM 文件。
 */
async function compileDynamicProfile(filePath: string): Promise<string> {
    await fs.mkdir(DYNAMIC_PROFILE_BUILD_ROOT, {recursive: true});
    const source = await fs.readFile(filePath, "utf-8");
    const sourceHash = createHash("sha256")
        .update(path.resolve(filePath))
        .update(source)
        .digest("hex")
        .slice(0, 16);
    const manifestPath = path.join(DYNAMIC_PROFILE_BUILD_ROOT, `${sourceHash}.meta.json`);
    const cachedFingerprint = await readCompiledFingerprint(manifestPath);
    const dependencyFingerprint = cachedFingerprint
        ? await buildDependencyFingerprint(cachedFingerprint.inputs)
        : null;
    const hash = dependencyFingerprint?.hash ?? sourceHash;
    const outputPath = path.join(DYNAMIC_PROFILE_BUILD_ROOT, `${hash}.mjs`);

    if (dependencyFingerprint && dependencyFingerprint.hash === cachedFingerprint?.hash) {
        try {
            await fs.access(outputPath);
            return outputPath;
        } catch (error) {
            if (!isMissingPathError(error)) {
                throw error;
            }
        }
    } else {
        try {
            await fs.rm(outputPath, {force: true});
        } catch {
            // 旧缓存清理失败不影响重新编译，后续 build 会覆盖输出。
        }
    }

    try {
        await fs.access(outputPath);
        if (!cachedFingerprint) {
            return outputPath;
        }
    } catch (error) {
        if (!isMissingPathError(error)) {
            throw error;
        }
    }

    const result = await build({
        entryPoints: [filePath],
        outfile: outputPath,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "esnext",
        jsx: "automatic",
        jsxImportSource: "nbook/server/agent/prompts",
        packages: "external",
        sourcemap: "inline",
        metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs)
        .map((inputPath) => path.resolve(inputPath))
        .filter((inputPath) => !inputPath.includes(`${path.sep}node_modules${path.sep}`));
    const nextFingerprint = await buildDependencyFingerprint(inputs);
    if (nextFingerprint.hash !== hash) {
        const nextOutputPath = path.join(DYNAMIC_PROFILE_BUILD_ROOT, `${nextFingerprint.hash}.mjs`);
        await fs.rename(outputPath, nextOutputPath).catch(async () => {
            await fs.copyFile(outputPath, nextOutputPath);
            await fs.rm(outputPath, {force: true});
        });
        await writeCompiledFingerprint(manifestPath, nextFingerprint);
        return nextOutputPath;
    }
    await writeCompiledFingerprint(manifestPath, nextFingerprint);

    return outputPath;
}

/**
 * 给动态 import 增加文件时间戳，避免同一路径被 ESM module cache 固定。
 */
async function toVersionedModuleUrl(filePath: string): Promise<string> {
    const stat = await fs.stat(filePath);
    const url = pathToFileURL(filePath);
    url.searchParams.set("v", `${String(stat.mtimeMs)}-${String(stat.size)}`);
    return url.href;
}

/**
 * 判断值是否为 AgentProfile。
 */
function isAgentProfile(value: unknown): value is RuntimeAgentProfile {
    return typeof value === "object"
        && value !== null
        && typeof (value as RuntimeAgentProfile).key === "string"
        && ((value as RuntimeAgentProfile).kind === "leader" || (value as RuntimeAgentProfile).kind === "subagent")
        && typeof (value as RuntimeAgentProfile).name === "string"
        && typeof (value as {inputSchema?: {parse?: unknown}}).inputSchema?.parse === "function"
        && Array.isArray((value as RuntimeAgentProfile).allowedToolKeys)
        && typeof (value as {prepare?: unknown}).prepare === "function";
}

/**
 * 覆盖 builtin key 时不允许修改 schema contract。
 */
function assertBuiltinOverrideContract(profile: RuntimeAgentProfile, builtinProfile: RuntimeAgentProfile | undefined): void {
    if (!builtinProfile) {
        return;
    }
    if (profile.kind !== builtinProfile.kind) {
        throw new Error(`builtin profile ${profile.key} 的 kind 不允许从 ${builtinProfile.kind} 改为 ${profile.kind}`);
    }
    if (!isSameJsonSchema(profile.inputSchema, builtinProfile.inputSchema)) {
        throw new Error(`builtin profile ${profile.key} 不允许修改 InputSchema`);
    }
    if (profile.outputSchema && builtinProfile.outputSchema && !isSameJsonSchema(profile.outputSchema, builtinProfile.outputSchema)) {
        throw new Error(`builtin profile ${profile.key} 不允许修改 OutputSchema`);
    }
    if (Boolean(profile.outputSchema) !== Boolean(builtinProfile.outputSchema)) {
        throw new Error(`builtin profile ${profile.key} 不允许修改 OutputSchema`);
    }
}

/**
 * builtin 覆盖只允许改实现，不让动态模块的 schema 对象替换静态契约。
 */
function overrideBuiltinSchemaContract(profile: RuntimeAgentProfile, builtinProfile: RuntimeAgentProfile | undefined): RuntimeAgentProfile {
    if (!builtinProfile) {
        return profile;
    }
    Object.defineProperty(profile, "inputSchema", {
        configurable: true,
        enumerable: true,
        value: builtinProfile.inputSchema,
    });
    Object.defineProperty(profile, "outputSchema", {
        configurable: true,
        enumerable: true,
        value: builtinProfile.outputSchema,
    });
    return profile;
}

type CompiledFingerprint = {
    hash: string;
    inputs: string[];
};

/**
 * 读取入口源码 hash 对应的依赖 fingerprint。
 */
async function readCompiledFingerprint(filePath: string): Promise<CompiledFingerprint | null> {
    try {
        return z.object({
            hash: z.string().trim().min(1),
            inputs: z.array(z.string().trim().min(1)),
        }).parse(JSON.parse(await fs.readFile(filePath, "utf-8")));
    } catch {
        return null;
    }
}

/**
 * 写入依赖 fingerprint，供入口源码未变时判断是否需要重编译。
 */
async function writeCompiledFingerprint(filePath: string, fingerprint: CompiledFingerprint): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(fingerprint, null, 2), "utf-8");
}

/**
 * 根据依赖文件的路径和内容生成缓存指纹。
 */
async function buildDependencyFingerprint(inputs: string[]): Promise<CompiledFingerprint> {
    const hash = createHash("sha256");
    const normalizedInputs = [...new Set(inputs.map((input) => path.resolve(input)))].sort();
    for (const input of normalizedInputs) {
        hash.update(input);
        hash.update(await fs.readFile(input));
    }
    return {
        hash: hash.digest("hex").slice(0, 16),
        inputs: normalizedInputs,
    };
}

/**
 * 用 JSON Schema 结构比较 builtin contract，避免生产包里的模块对象身份误判。
 */
function isSameJsonSchema(left: z.ZodType, right: z.ZodType): boolean {
    return stableJsonStringify(z.toJSONSchema(left)) === stableJsonStringify(z.toJSONSchema(right));
}

/**
 * 稳定序列化 JSON，避免对象 key 顺序影响比较。
 */
function stableJsonStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableJsonStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

/**
 * 包装 profile 加载错误。
 */
function normalizeProfileLoadError(filePath: string, relativePath: string, profileKey: string | null, error: unknown): DynamicProfileError {
    const message = error instanceof Error ? error.message : String(error ?? "未知错误");
    const normalized = new Error(`动态 profile 加载失败: ${filePath}\n${message}`) as DynamicProfileError;
    normalized.filePath = filePath;
    normalized.relativePath = relativePath;
    normalized.profileKey = profileKey;
    normalized.code = "dynamic_profile_load_failed";
    if (error instanceof Error && error.stack) {
        normalized.stack = error.stack;
    }
    return normalized;
}

/**
 * 判断路径是否不存在。
 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
