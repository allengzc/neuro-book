import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {builtinModules} from "node:module";
import {build, type Metafile, type Plugin} from "esbuild";
import type {VariableDefinition, VariableNamespace, VariableAccessorIssue} from "nbook/server/agent/variables/types";
import {hashFile, resolveArtifactPath} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {generateVariableTypes, VARIABLE_TYPES_FILE_NAME, type VariableTypeGenerationDiagnostic} from "nbook/server/agent/variables/generated-types";

export const VARIABLE_DEFINITION_COMPILER_VERSION = 1;
export const VARIABLE_DEFINITION_COMPILED_DIR = ".compiled";
export const VARIABLE_DEFINITION_MANIFEST_FILE = "manifest.json";

export type VariableDefinitionDependency = {
    path: string;
    sha256: string;
    bytes: number;
};

export type VariableDefinitionManifestItem = {
    fileName: string;
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
    registeredPaths: string[];
    dependencies: VariableDefinitionDependency[];
};

export type VariableDefinitionManifest = {
    compilerVersion: typeof VARIABLE_DEFINITION_COMPILER_VERSION;
    generatedAt: string;
    definitionsRoot: string;
    definitions: VariableDefinitionManifestItem[];
};

type DefinitionFileEntry = {
    fileName: string;
    absolutePath: string;
};

/**
 * 编译变量 definition root，生成运行时 `.compiled` artifact。
 */
export async function compileVariableDefinitions(options: {definitionRoot: string; rootLabel?: string}): Promise<VariableDefinitionManifest> {
    const definitionRoot = resolve(options.definitionRoot);
    const compiledDir = join(definitionRoot, VARIABLE_DEFINITION_COMPILED_DIR);
    const buildCompiledDir = resolve(process.cwd(), ".agent", "workspace", "variable-definition-build", randomUUID());
    await mkdir(buildCompiledDir, {recursive: true});
    const existingManifest = await readVariableDefinitionManifest(definitionRoot);
    const files = await findDefinitionFiles(definitionRoot);
    const definitions: VariableDefinitionManifestItem[] = [];
    try {
        for (const file of files) {
            definitions.push(await compileDefinitionFile(definitionRoot, buildCompiledDir, file));
        }
        const nextDefinitions = definitions.sort((left, right) => left.fileName.localeCompare(right.fileName));
        const manifest: VariableDefinitionManifest = {
            compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
            generatedAt: definitionsEqual(existingManifest.definitions, nextDefinitions) ? existingManifest.generatedAt : new Date().toISOString(),
            definitionsRoot: options.rootLabel ?? normalizeArtifactPath(definitionRoot),
            definitions: nextDefinitions,
        };
        await commitArtifacts(buildCompiledDir, compiledDir, manifest);
        return manifest;
    } finally {
        await rm(buildCompiledDir, {recursive: true, force: true});
    }
}

/**
 * 加载 hash 匹配的 definition artifact。
 */
export async function loadCompiledVariableDefinitions(input: {
    definitionRoot: string;
    namespace: Extract<VariableNamespace, "global" | "project">;
}): Promise<{definitions: VariableDefinition[]; issues: VariableAccessorIssue[]}> {
    const root = resolve(input.definitionRoot);
    const sourceFiles = await findDefinitionFiles(root);
    const manifest = await readVariableDefinitionManifest(root);
    const definitions: VariableDefinition[] = [];
    const issues: VariableAccessorIssue[] = [];
    for (const file of sourceFiles) {
        const item = manifest.definitions.find((entry) => entry.fileName === file.fileName);
        if (!item) {
            issues.push(issue("not_compiled", input.namespace, file.fileName, `变量 definition 未编译：${file.fileName}`));
            continue;
        }
        const validation = await validateVariableDefinitionArtifact(root, item);
        if (!validation.fresh) {
            issues.push(issue("compile_stale", input.namespace, file.fileName, `变量 definition 已过期：${file.fileName} (${validation.reason})`));
            continue;
        }
        try {
            const loaded = await importDefinitions(join(root, VARIABLE_DEFINITION_COMPILED_DIR, item.artifactFileName), item.artifactSha256);
            for (const definition of loaded) {
                if (definition.namespace !== input.namespace) {
                    throw new Error(`${file.fileName} 只能注册 ${input.namespace}.*，实际为 ${definition.namespace}.${definition.key}`);
                }
                definitions.push(definition);
            }
        } catch (error) {
            issues.push(issue("compiled_load_failed", input.namespace, file.fileName, error instanceof Error ? error.message : String(error)));
        }
    }
    return {definitions, issues};
}

export async function readVariableDefinitionManifest(definitionRoot: string): Promise<VariableDefinitionManifest> {
    const root = resolve(definitionRoot);
    try {
        const value = JSON.parse(await readFile(join(root, VARIABLE_DEFINITION_COMPILED_DIR, VARIABLE_DEFINITION_MANIFEST_FILE), "utf8")) as Partial<VariableDefinitionManifest>;
        if (value.compilerVersion !== VARIABLE_DEFINITION_COMPILER_VERSION || !Array.isArray(value.definitions)) {
            return emptyManifest(root);
        }
        return {
            compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
            generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : new Date(0).toISOString(),
            definitionsRoot: typeof value.definitionsRoot === "string" ? value.definitionsRoot : normalizeArtifactPath(root),
            definitions: value.definitions.filter(isManifestItem),
        };
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return emptyManifest(root);
        }
        throw error;
    }
}

export async function validateVariableDefinitionArtifact(root: string, item: VariableDefinitionManifestItem): Promise<{fresh: boolean; reason?: string}> {
    const sourceHash = await hashFile(join(root, ...item.fileName.split("/"))).catch(() => null);
    if (!sourceHash || sourceHash.sha256 !== item.sourceSha256 || sourceHash.bytes !== item.sourceBytes) {
        return {fresh: false, reason: "source_changed"};
    }
    const artifactHash = await hashFile(join(root, VARIABLE_DEFINITION_COMPILED_DIR, item.artifactFileName)).catch(() => null);
    if (!artifactHash) {
        return {fresh: false, reason: "artifact_missing"};
    }
    if (artifactHash.sha256 !== item.artifactSha256 || artifactHash.bytes !== item.artifactBytes) {
        return {fresh: false, reason: "artifact_changed"};
    }
    for (const dependency of item.dependencies) {
        const current = await hashFile(resolveArtifactPath(dependency.path)).catch(() => null);
        if (!current || current.sha256 !== dependency.sha256 || current.bytes !== dependency.bytes) {
            return {fresh: false, reason: "dependency_changed"};
        }
    }
    return {fresh: true};
}

async function compileDefinitionFile(root: string, compiledDir: string, file: DefinitionFileEntry): Promise<VariableDefinitionManifestItem> {
    const sourceHash = await hashFile(file.absolutePath);
    const artifactStem = stableArtifactStem(file.fileName, /\.(tsx|ts|mjs|js)$/);
    const temporaryOutputPath = join(compiledDir, `${artifactStem}.${randomUUID()}.building.mjs`);
    const temporaryTypePath = join(compiledDir, `${artifactStem}.${randomUUID()}.building.${VARIABLE_TYPES_FILE_NAME}`);
    const tsconfigPath = resolve(process.cwd(), "tsconfig.json");
    try {
        const result = await build({
            absWorkingDir: process.cwd(),
            bundle: true,
            entryPoints: [file.absolutePath],
            format: "esm",
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
            throw new Error(`variable definition ${file.fileName} 编译缺少 esbuild metafile。`);
        }
        const dependencies = await readDependencies(result.metafile, tsconfigPath);
        const dependencyHash = hashDependencies(file.absolutePath, dependencies);
        const artifactFileName = `${artifactStem}.mjs`;
        const artifactPath = join(compiledDir, artifactFileName);
        const artifactHash = await hashFile(temporaryOutputPath);
        const definitions = await importDefinitions(temporaryOutputPath, artifactHash.sha256);
        const typeFileName = `${artifactStem}.${VARIABLE_TYPES_FILE_NAME}`;
        const typePath = join(compiledDir, typeFileName);
        const generatedTypes = generateVariableTypes(definitions, {
            header: `Variable definition types generated from ${file.fileName}.`,
        });
        await writeFile(temporaryTypePath, generatedTypes.text, "utf8");
        const typeHash = await hashFile(temporaryTypePath);
        await promoteArtifact(temporaryOutputPath, artifactPath);
        await promoteArtifact(temporaryTypePath, typePath);
        return {
            fileName: file.fileName,
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
            registeredPaths: definitions.map((definition) => `${definition.namespace}.${definition.key}`).sort(),
            dependencies,
        };
    } finally {
        await rm(temporaryOutputPath, {force: true});
        await rm(temporaryTypePath, {force: true});
    }
}

async function importDefinitions(artifactPath: string, artifactHash: string): Promise<VariableDefinition[]> {
    const mod = await import(`${pathToFileURL(artifactPath).href}?definition=${artifactHash}`) as {default?: unknown; definitions?: unknown};
    const value = mod.definitions ?? mod.default;
    if (!Array.isArray(value) || !value.every(isVariableDefinition)) {
        throw new Error(`compiled variable definition 没有导出 VariableDefinition[]：${artifactPath}`);
    }
    return value;
}

function isVariableDefinition(value: unknown): value is VariableDefinition {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && "namespace" in value && "key" in value && "schema" in value);
}

async function findDefinitionFiles(root: string): Promise<DefinitionFileEntry[]> {
    if (!existsSync(root)) {
        return [];
    }
    const result: DefinitionFileEntry[] = [];
    const entries = await readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.name === VARIABLE_DEFINITION_COMPILED_DIR) {
            continue;
        }
        const absolutePath = join(root, entry.name);
        if (entry.isFile() && /^definitions\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            result.push({fileName: entry.name, absolutePath});
        }
    }
    return result.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function readDependencies(metafile: Metafile, tsconfigPath: string): Promise<VariableDefinitionDependency[]> {
    const paths = new Set<string>([tsconfigPath]);
    for (const inputPath of Object.keys(metafile.inputs)) {
        if (!inputPath.startsWith("<")) {
            paths.add(resolve(process.cwd(), inputPath));
        }
    }
    return Promise.all([...paths].sort((left, right) => left.localeCompare(right)).map(async (filePath) => ({
        path: normalizeArtifactPath(filePath),
        ...await hashFile(filePath),
    })));
}

function hashDependencies(sourcePath: string, dependencies: VariableDefinitionDependency[]): string {
    const hash = createHash("sha256")
        .update("variable-definition-artifact")
        .update("\0")
        .update(String(VARIABLE_DEFINITION_COMPILER_VERSION))
        .update("\0")
        .update(normalizeArtifactPath(sourcePath));
    for (const dependency of dependencies) {
        hash.update("\0").update(dependency.path).update("\0").update(dependency.sha256).update("\0").update(String(dependency.bytes));
    }
    return hash.digest("hex").slice(0, 24);
}

async function promoteArtifact(temporaryOutputPath: string, outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), {recursive: true});
    await rm(outputPath, {force: true});
    try {
        await rename(temporaryOutputPath, outputPath);
    } catch (error) {
        throw error;
    }
}

async function commitArtifacts(buildDir: string, compiledDir: string, manifest: VariableDefinitionManifest): Promise<void> {
    await mkdir(compiledDir, {recursive: true});
    for (const item of manifest.definitions) {
        const sourcePath = join(buildDir, item.artifactFileName);
        if (existsSync(sourcePath)) {
            await copyFile(sourcePath, join(compiledDir, item.artifactFileName));
        }
        if (item.typeFileName) {
            const typeSourcePath = join(buildDir, item.typeFileName);
            if (existsSync(typeSourcePath)) {
                await copyFile(typeSourcePath, join(compiledDir, item.typeFileName));
            }
        }
    }
    await writeFile(join(compiledDir, VARIABLE_DEFINITION_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await pruneArtifacts(compiledDir, manifest);
}

async function pruneArtifacts(compiledDir: string, manifest: VariableDefinitionManifest): Promise<void> {
    const keep = new Set([
        VARIABLE_DEFINITION_MANIFEST_FILE,
        ...manifest.definitions.flatMap((item) => [item.artifactFileName, item.typeFileName].filter((name): name is string => Boolean(name))),
    ]);
    const entries = await readdir(compiledDir, {withFileTypes: true}).catch(() => []);
    await Promise.all(entries
        .filter((entry) => entry.isFile() && /\.(mjs|types\.d\.ts)$/.test(entry.name) && !keep.has(entry.name))
        .map((entry) => rm(join(compiledDir, entry.name), {force: true})));
}

function repoAliasBundlePlugin(): Plugin {
    const nodeModuleNames = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
    return {
        name: "nbook-variable-definition-bundle",
        setup(buildApi) {
            buildApi.onResolve({filter: /^(nbook|neuro_book)\//}, (args) => ({
                path: resolveRepoAliasPath(args.path.replace(/^(nbook|neuro_book)\//, "")),
            }));
            buildApi.onResolve({filter: /^[^./].*/}, (args) => {
                if (resolve(args.path) === args.path || /^[A-Za-z]:[\\/]/.test(args.path)) {
                    return undefined;
                }
                if (args.path.startsWith("nbook/") || args.path.startsWith("neuro_book/") || nodeModuleNames.has(args.path)) {
                    return undefined;
                }
                return {path: args.path, external: true};
            });
        },
    };
}

function resolveRepoAliasPath(relativePath: string): string {
    const basePath = resolve(process.cwd(), relativePath);
    const candidates = [join(basePath, "index.ts"), join(basePath, "index.tsx"), join(basePath, "index.js"), join(basePath, "index.mjs"), `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, `${basePath}.mjs`, basePath];
    return candidates.find((candidate) => existsSync(candidate)) ?? basePath;
}

function normalizeArtifactPath(filePath: string): string {
    if (isAbsolute(filePath)) {
        return relative(process.cwd(), filePath).split(/[\\/]+/).join("/");
    }
    return filePath.split(/[\\/]+/).join("/");
}

function emptyManifest(root: string): VariableDefinitionManifest {
    return {
        compilerVersion: VARIABLE_DEFINITION_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        definitionsRoot: normalizeArtifactPath(root),
        definitions: [],
    };
}

function definitionsEqual(left: VariableDefinitionManifestItem[], right: VariableDefinitionManifestItem[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function isManifestItem(value: unknown): value is VariableDefinitionManifestItem {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as {fileName?: unknown}).fileName === "string" && typeof (value as {artifactFileName?: unknown}).artifactFileName === "string");
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

function issue(code: VariableAccessorIssue["code"], namespace: VariableNamespace, path: string, message: string): VariableAccessorIssue {
    return {code, path: `${namespace}.${path}`, message};
}
