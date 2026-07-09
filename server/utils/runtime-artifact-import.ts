import {copyFile, mkdir, stat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

type NativeImport = (specifier: string) => Promise<unknown>;
type RuntimeArtifactQuery = Record<string, string | number | bigint | boolean>;
type RuntimeArtifactImportOptions = {
    /** 非空时把 artifact 复制到带 cache key 的物理路径，避免 Bun 忽略 file URL query。 */
    cacheKey?: string;
    /** 校验已存在 cache 文件的字节数；为空时只按 cache key 命中。 */
    expectedBytes?: number;
    /** 不同 artifact 家族使用不同缓存目录，方便排查和后续清理。 */
    cacheNamespace?: string;
    /** 附加给 file URL 的 query，仅用于诊断或 Node module cache，不作为 Bun cache key。 */
    query?: RuntimeArtifactQuery;
};

const nativeImport = new Function("specifier", "return import(specifier)") as NativeImport;

/**
 * 导入运行时生成的 ESM artifact 文件。
 *
 * Product/Nitro 会接管普通 `import(variable)` 并尝试从 bundle 图里解析模块。
 * `.compiled/*.mjs`、World Engine hash `.mjs` 这类运行时落盘产物必须走这里，
 * 避免打包器把 Windows file URL / 绝对路径当成构建期依赖处理。
 */
export async function importRuntimeArtifact<TModule>(
    artifactPath: string,
    options: RuntimeArtifactImportOptions = {},
): Promise<TModule> {
    const importPath = options.cacheKey
        ? await prepareCachedArtifactPath(artifactPath, options)
        : artifactPath;
    return await importSpecifierNatively<TModule>(runtimeArtifactSpecifier(importPath, options.query ?? {}));
}

async function prepareCachedArtifactPath(artifactPath: string, options: RuntimeArtifactImportOptions): Promise<string> {
    const cacheRoot = resolve(process.cwd(), ".agent", "workspace", "runtime-artifact-import-cache", safeSegment(options.cacheNamespace ?? "default"));
    const cacheKey = safeSegment(options.cacheKey ?? "unknown");
    const importPath = join(cacheRoot, `${cacheKey}.mjs`);
    const existing = await stat(importPath).catch(() => null);
    if (existing && (options.expectedBytes === undefined || existing.size === options.expectedBytes)) {
        return importPath;
    }
    await mkdir(cacheRoot, {recursive: true});
    await copyFile(artifactPath, importPath);
    return importPath;
}

function safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "artifact";
}

function runtimeArtifactSpecifier(artifactPath: string, query: RuntimeArtifactQuery): string {
    const artifactUrl = pathToFileURL(artifactPath);
    for (const [key, value] of Object.entries(query)) {
        artifactUrl.searchParams.set(key, String(value));
    }
    return artifactUrl.href;
}

async function importSpecifierNatively<TModule>(specifier: string): Promise<TModule> {
    try {
        return await nativeImport(specifier) as TModule;
    } catch (error) {
        if (!isMissingDynamicImportCallback(error)) {
            throw error;
        }
        return await import(/* @vite-ignore */ specifier) as TModule;
    }
}

/** 判断当前宿主是否是缺少 eval/new Function 动态导入回调的测试 VM。 */
function isMissingDynamicImportCallback(error: unknown): boolean {
    return error instanceof TypeError
        && error.message.includes("dynamic import callback");
}
