import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {builtinModules, createRequire} from "node:module";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build, type Plugin} from "esbuild";
import type * as TypeScript from "typescript";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TypeScript;

const importCache = new Map<string, Promise<unknown>>();
const STALE_TEMP_FILE_AGE_MS = 10 * 60 * 1000;
const BARE_PACKAGE_SPECIFIER_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[^\\/:*?"<>|\s]+)*$/;
const NODE_BUILTIN_MODULES = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, "")));

/**
 * 以内容 hash 加载 Project Workspace 里的单文件 TypeScript 配置。
 *
 * World Engine 明确只支持 `calendar.ts` 与 `schema/index.ts` 两个单文件入口。
 * 本地文件、绝对路径和 URL import 会造成依赖图缓存语义不清，因此在导入前直接拒绝；
 * `zod`、`nbook/world-engine/schema` 这类包级 import 与 `node:` 内置模块仍由运行时正常解析。
 */
export async function importSingleFileTypeScriptConfig<TModule extends object>(
    filePath: string,
    label: string,
): Promise<TModule> {
    const content = await fs.readFile(filePath);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const cachePath = path.join(path.dirname(filePath), `.world-engine-${label}-${hash}.ts`);
    const cached = importCache.get(cachePath);
    if (cached) {
        return await cached as TModule;
    }

    const pending = importValidatedHashedTypeScript<TModule>(filePath, cachePath, content, label);
    importCache.set(cachePath, pending);
    try {
        return await pending;
    } catch (error) {
        importCache.delete(cachePath);
        throw error;
    }
}

/** 用 TypeScript AST 与 esbuild 双重确认配置入口没有本地文件、绝对路径或 URL 依赖。 */
async function assertSingleFileConfig(filePath: string, source: string, label: string): Promise<void> {
    const rejectedSpecifiers = new Set<string>();
    for (const specifier of collectRejectedSpecifiers(source)) {
        rejectedSpecifiers.add(specifier);
    }
    if (rejectedSpecifiers.size === 0) {
        for (const specifier of await collectBundledRejectedSpecifiers(filePath)) {
            rejectedSpecifiers.add(specifier);
        }
    }
    if (rejectedSpecifiers.size > 0) {
        throw new Error(singleFileConfigError(label, [...rejectedSpecifiers].sort()));
    }
}

/** 解析源码级 import/export，包含 esbuild 会擦除的 `import type` 和 TS import type expression。 */
function collectRejectedSpecifiers(source: string): string[] {
    const sourceFile = ts.createSourceFile("world-engine-config.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rejectedSpecifiers: string[] = [];
    const collect = (specifier: string): void => {
        if (classifySingleFileConfigSpecifier(specifier) === "rejected") {
            rejectedSpecifiers.push(specifier);
        }
    };
    const rejectDynamic = (kind: "import" | "require"): void => {
        rejectedSpecifiers.push(`动态 ${kind}(<non-literal>)`);
    };
    const visit = (node: TypeScript.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
            collect(node.moduleSpecifier.text);
        }
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression;
            if (expression && ts.isStringLiteralLike(expression)) {
                collect(expression.text);
            }
        }
        if (ts.isImportTypeNode(node)) {
            const argument = node.argument;
            if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
                collect(argument.literal.text);
            } else {
                rejectedSpecifiers.push("type import(<non-literal>)");
            }
        }
        if (ts.isCallExpression(node)) {
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
            if (!isDynamicImport && !isRequire) {
                ts.forEachChild(node, visit);
                return;
            }
            const [firstArg] = node.arguments;
            if (node.arguments.length !== 1 || !firstArg || !ts.isStringLiteralLike(firstArg)) {
                rejectDynamic(isDynamicImport ? "import" : "require");
            } else {
                collect(firstArg.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return rejectedSpecifiers;
}

/** 让 esbuild 解析入口文件，捕获运行时 import/export 的真实模块 specifier。 */
async function collectBundledRejectedSpecifiers(filePath: string): Promise<string[]> {
    const rejectedSpecifiers = new Set<string>();
    const plugin: Plugin = {
        name: "world-engine-single-file-config",
        setup(buildApi) {
            buildApi.onResolve({filter: /.*/}, (args) => {
                if (args.kind === "entry-point") {
                    return undefined;
                }
                if (classifySingleFileConfigSpecifier(args.path) === "rejected") {
                    rejectedSpecifiers.add(args.path);
                }
                return {path: args.path, external: true};
            });
        },
    };

    await build({
        entryPoints: [filePath],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        metafile: true,
        logLevel: "silent",
        plugins: [plugin],
    });

    return [...rejectedSpecifiers];
}

function classifySingleFileConfigSpecifier(specifier: string): "allowed" | "rejected" {
    if (isNodeBuiltinSpecifier(specifier) || isBarePackageSpecifier(specifier)) {
        return "allowed";
    }
    return "rejected";
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
    if (!specifier.startsWith("node:")) {
        return false;
    }
    return NODE_BUILTIN_MODULES.has(specifier.slice("node:".length));
}

function isBarePackageSpecifier(specifier: string): boolean {
    if (specifier.length === 0 || specifier !== specifier.trim()) {
        return false;
    }
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) {
        return false;
    }
    if (!BARE_PACKAGE_SPECIFIER_RE.test(specifier)) {
        return false;
    }
    if (NODE_BUILTIN_MODULES.has(specifier)) {
        return false;
    }
    const segments = specifier.split("/");
    return segments.every((segment) => segment !== "." && segment !== "..");
}

function singleFileConfigError(label: string, specifiers: string[]): string {
    const displayPath = configDisplayPath(label);
    return [
        `World Engine ${label} 配置必须是单文件：${displayPath} 不支持本地文件、绝对路径或 URL import/export。`,
        `发现：${specifiers.join(", ")}`,
        `请把 helper 合并到 ${displayPath}，或只使用 zod、nbook/world-engine/schema 等包级 import 与 node: 内置模块。动态 import/require 必须使用静态字符串并符合这条规则。`,
    ].join(" ");
}

function configDisplayPath(label: string): string {
    if (label === "calendar") {
        return "world-engine/calendar.ts";
    }
    if (label === "schema") {
        return "world-engine/schema/index.ts";
    }
    return label;
}

/** 校验后写入稳定临时文件并导入，确保并发加载共享同一条 pending promise。 */
async function importValidatedHashedTypeScript<TModule extends object>(
    filePath: string,
    cachePath: string,
    content: Buffer,
    label: string,
): Promise<TModule> {
    await assertSingleFileConfig(filePath, content.toString("utf-8"), label);
    return await importHashedTypeScript<TModule>(cachePath, content, label);
}

/** 写入稳定临时文件并导入，导入完成后清理磁盘文件。 */
async function importHashedTypeScript<TModule extends object>(cachePath: string, content: Buffer, label: string): Promise<TModule> {
    await cleanupStaleTempFiles(path.dirname(cachePath), label);
    await fs.writeFile(cachePath, content);
    try {
        return await import(pathToFileURL(cachePath).href) as TModule;
    } finally {
        await fs.rm(cachePath, {force: true}).catch(() => undefined);
    }
}

/** 清理异常中断留下的旧临时文件；保留近期文件，避免误删并发导入中的文件。 */
async function cleanupStaleTempFiles(directory: string, label: string): Promise<void> {
    const entries = await fs.readdir(directory, {withFileTypes: true}).catch(() => []);
    const now = Date.now();
    await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(`.world-engine-${label}-`) && entry.name.endsWith(".ts"))
        .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || now - stats.mtimeMs < STALE_TEMP_FILE_AGE_MS) {
                return;
            }
            await fs.rm(filePath, {force: true}).catch(() => undefined);
        }));
}
