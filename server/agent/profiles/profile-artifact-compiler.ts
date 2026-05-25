import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {builtinModules} from "node:module";
import {build, type Metafile, type Plugin} from "esbuild";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import {generateVariableTypes, VARIABLE_TYPES_FILE_NAME, type VariableTypeGenerationDiagnostic} from "nbook/server/agent/variables/generated-types";

export const PROFILE_ARTIFACT_COMPILER_VERSION = 1;
export const PROFILE_COMPILED_DIR_NAME = ".compiled";
export const PROFILE_COMPILED_MANIFEST_FILE = "manifest.json";

export type ProfileArtifactDependency = {
    path: string;
    sha256: string;
    bytes: number;
};

export type ProfileArtifactManifestItem = {
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

export type ProfileArtifactManifest = {
    compilerVersion: typeof PROFILE_ARTIFACT_COMPILER_VERSION;
    generatedAt: string;
    profilesRoot: string;
    profiles: ProfileArtifactManifestItem[];
};

export type CompileProfileArtifactsOptions = {
    profileRoot: string;
    fileName?: string;
    rootLabel?: string;
};

export type CompileProfileArtifactsResult = {
    manifest: ProfileArtifactManifest;
    compiledDir: string;
    manifestPath: string;
    compiled: ProfileArtifactManifestItem[];
};

type ProfileFileEntry = {
    fileName: string;
    absolutePath: string;
};

/**
 * 编译 profile root 下的 profile 源码，生成 runtime 可加载的 `.compiled` 产物。
 */
export async function compileProfileArtifacts(options: CompileProfileArtifactsOptions): Promise<CompileProfileArtifactsResult> {
    const profileRoot = resolve(options.profileRoot);
    const compiledDir = join(profileRoot, PROFILE_COMPILED_DIR_NAME);
    const fullCompile = !options.fileName;
    const buildCompiledDir = fullCompile
        ? resolve(process.cwd(), ".agent", "workspace", "profile-artifact-build", randomUUID())
        : compiledDir;
    await mkdir(buildCompiledDir, {recursive: true});
    const existingManifest = await readProfileArtifactManifest(profileRoot);
    const targetFiles = options.fileName
        ? [resolveProfileFile(profileRoot, options.fileName)]
        : await findProfileFiles(profileRoot);
    const compiled: ProfileArtifactManifestItem[] = [];

    try {
        for (const file of targetFiles) {
            const item = await compileProfileFile(profileRoot, buildCompiledDir, file);
            compiled.push(item);
        }

        const nextProfiles = (fullCompile
            ? compiled
            : [
                ...existingManifest.profiles.filter((item) => !compiled.some((next) => next.fileName === item.fileName)),
                ...compiled,
            ]).sort((left, right) => left.fileName.localeCompare(right.fileName));
        const manifest: ProfileArtifactManifest = {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: profilesEqual(existingManifest.profiles, nextProfiles) ? existingManifest.generatedAt : new Date().toISOString(),
            profilesRoot: options.rootLabel ?? normalizeArtifactPath(profileRoot),
            profiles: nextProfiles,
        };
        const manifestPath = profileArtifactManifestPath(profileRoot);
        if (fullCompile) {
            await commitCompiledArtifacts(buildCompiledDir, compiledDir, manifest);
        } else {
            await mkdir(compiledDir, {recursive: true});
            await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        }
        return {
            manifest,
            compiledDir,
            manifestPath,
            compiled,
        };
    } finally {
        if (fullCompile) {
            await rm(buildCompiledDir, {recursive: true, force: true});
        }
    }
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
        if (record.compilerVersion !== PROFILE_ARTIFACT_COMPILER_VERSION || !Array.isArray(record.profiles)) {
            return emptyArtifactManifest(root);
        }
        const profiles = record.profiles.flatMap((item): ProfileArtifactManifestItem[] => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return [];
            }
            const profile = item as Record<string, unknown>;
            if (
                typeof profile.fileName !== "string"
                || typeof profile.profileKey !== "string"
                || typeof profile.sourceSha256 !== "string"
                || typeof profile.sourceBytes !== "number"
                || typeof profile.dependencyHash !== "string"
                || typeof profile.artifactFileName !== "string"
                || typeof profile.artifactSha256 !== "string"
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
                fileName: profile.fileName,
                profileKey: profile.profileKey,
                sourceSha256: profile.sourceSha256,
                sourceBytes: profile.sourceBytes,
                dependencyHash: profile.dependencyHash,
                artifactFileName: profile.artifactFileName,
                artifactSha256: profile.artifactSha256,
                artifactBytes: profile.artifactBytes,
                typeFileName: typeof profile.typeFileName === "string" ? profile.typeFileName : undefined,
                typeSha256: typeof profile.typeSha256 === "string" ? profile.typeSha256 : undefined,
                typeBytes: typeof profile.typeBytes === "number" ? profile.typeBytes : undefined,
                typeDiagnostics: Array.isArray(profile.typeDiagnostics) ? profile.typeDiagnostics as VariableTypeGenerationDiagnostic[] : undefined,
                registeredVariablePaths: Array.isArray(profile.registeredVariablePaths) ? profile.registeredVariablePaths.filter((item): item is string => typeof item === "string") : undefined,
                dependencies,
            }];
        });
        if (profiles.length !== record.profiles.length) {
            return emptyArtifactManifest(root);
        }
        return {
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date(0).toISOString(),
            profilesRoot: typeof record.profilesRoot === "string" ? record.profilesRoot : normalizeArtifactPath(root),
            profiles,
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return emptyArtifactManifest(root);
        }
        throw error;
    }
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
export async function validateProfileArtifact(profileRoot: string, item: ProfileArtifactManifestItem): Promise<{
    fresh: boolean;
    reason?: "source_changed" | "dependency_changed" | "artifact_missing" | "artifact_changed";
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
    if (item.typeFileName && item.typeSha256 && item.typeBytes !== undefined) {
        const typeHash = await hashFile(join(root, PROFILE_COMPILED_DIR_NAME, item.typeFileName)).catch(() => null);
        if (!typeHash) {
            return {fresh: false, reason: "artifact_missing"};
        }
        if (typeHash.sha256 !== item.typeSha256 || typeHash.bytes !== item.typeBytes) {
            return {fresh: false, reason: "artifact_changed"};
        }
    }
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

async function compileProfileFile(profileRoot: string, compiledDir: string, file: ProfileFileEntry): Promise<ProfileArtifactManifestItem> {
    const sourceHash = await hashFile(file.absolutePath);
    const artifactBase = `${file.fileName.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/\.profile\.(tsx|ts|mjs|js)$/, "")}.${sourceHash.sha256.slice(0, 16)}.${randomUUID()}`;
    const temporaryOutputPath = join(compiledDir, `${artifactBase}.building.mjs`);
    const tsconfigPath = resolve(process.cwd(), "tsconfig.json");
    let dependencies: ProfileArtifactDependency[];

    try {
        const result = await build({
            absWorkingDir: process.cwd(),
            bundle: true,
            entryPoints: [file.absolutePath],
            format: "esm",
            jsx: "automatic",
            jsxImportSource: "nbook/server/agent/profiles/profile-dsl",
            logLevel: "silent",
            metafile: true,
            outfile: temporaryOutputPath,
            packages: "external",
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
        const artifactFileName = `${dependencyHash}.mjs`;
        const artifactPath = join(compiledDir, artifactFileName);
        await promoteArtifact(temporaryOutputPath, artifactPath);
        const artifactHash = await hashFile(artifactPath);
        const profile = await importCompiledProfile(artifactPath, artifactHash.sha256);
        const typeFileName = `${dependencyHash}.${VARIABLE_TYPES_FILE_NAME}`;
        const typePath = join(compiledDir, typeFileName);
        const generatedTypes = generateVariableTypes(profile.variableDefinitions ?? [], {
            header: `Session variable authoring types generated from ${file.fileName}.`,
        });
        await writeFile(typePath, generatedTypes.text, "utf8");
        const typeHash = await hashFile(typePath);
        return {
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
    }
}

async function importCompiledProfile(artifactPath: string, artifactHash: string): Promise<AgentProfile> {
    const mod = await import(`${pathToFileURL(artifactPath).href}?compiled=${artifactHash}`) as {default?: unknown};
    const profile = mod.default;
    if (!isProfile(profile)) {
        throw new Error(`compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
    }
    return profile;
}

function isProfile(value: unknown): value is AgentProfile {
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
        throw new Error(`profile 文件不存在：${normalized}`);
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
    const dependencies = await Promise.all([...paths].sort((left, right) => left.localeCompare(right)).map(artifactDependency));
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

async function promoteArtifact(temporaryOutputPath: string, outputPath: string): Promise<boolean> {
    if (existsSync(outputPath)) {
        return false;
    }
    await mkdir(dirname(outputPath), {recursive: true});
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

async function commitCompiledArtifacts(buildCompiledDir: string, compiledDir: string, manifest: ProfileArtifactManifest): Promise<void> {
    await mkdir(compiledDir, {recursive: true});
    for (const item of manifest.profiles) {
        const sourcePath = join(buildCompiledDir, item.artifactFileName);
        if (existsSync(sourcePath)) {
            await copyFile(sourcePath, join(compiledDir, item.artifactFileName));
        }
        if (item.typeFileName) {
            const typeSourcePath = join(buildCompiledDir, item.typeFileName);
            if (existsSync(typeSourcePath)) {
                await copyFile(typeSourcePath, join(compiledDir, item.typeFileName));
            }
        }
    }
    await writeFile(
        join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
    );
}

function repoAliasBundlePlugin(): Plugin {
    const nodeModuleNames = new Set([
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
    ]);
    return {
        name: "nbook-repo-alias-bundle",
        setup(buildApi) {
            buildApi.onResolve({filter: /^(nbook|neuro_book)\//}, (args) => {
                const relativePath = args.path.replace(/^(nbook|neuro_book)\//, "");
                return {
                    path: resolveRepoAliasPath(relativePath),
                };
            });
            buildApi.onResolve({filter: /^[^./].*/}, (args) => {
                if (resolve(args.path) === args.path || /^[A-Za-z]:[\\/]/.test(args.path)) {
                    return undefined;
                }
                if (args.path.startsWith("nbook/") || args.path.startsWith("neuro_book/") || nodeModuleNames.has(args.path)) {
                    return undefined;
                }
                return {
                    path: args.path,
                    external: true,
                };
            });
        },
    };
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
        profiles: [],
    };
}

function profilesEqual(left: ProfileArtifactManifestItem[], right: ProfileArtifactManifestItem[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeArtifactPath(filePath: string): string {
    const absolutePath = resolve(filePath);
    const relativePath = relative(process.cwd(), absolutePath).split(/[\\/]+/).join("/");
    if (relativePath && !relativePath.startsWith("../") && relativePath !== ".." && !/^[A-Za-z]:/.test(relativePath)) {
        return relativePath;
    }
    return absolutePath.split(/[\\/]+/).join("/");
}
