import {cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {ProfileCompileWorkerService, resolveProfileCompileWorkerPathsForRoot, useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {runProfileCompile, runProfileCompileAll} from "nbook/server/agent/profiles/profile-compile-worker-runtime";

describe("profile compile worker runtime", () => {
    it("Product Root 无根 node_modules 时从 .output/server vendor 解析 tsx API", async () => {
        const productRoot = await createProductWorkerFixture();
        try {
            const paths = resolveProfileCompileWorkerPathsForRoot(productRoot);
            const normalizedApiUrl = paths.tsxApiUrl.replaceAll("\\", "/");
            const normalizedLoaderUrl = paths.tsxLoaderUrl.replaceAll("\\", "/");

            expect(normalizedApiUrl).toContain("/.output/server/node_modules/tsx/");
            expect(normalizedLoaderUrl).toContain("/.output/server/node_modules/tsx/");

            const tsxApi = await import(paths.tsxApiUrl) as {tsImport?: unknown};
            expect(typeof tsxApi.tsImport).toBe("function");
            await expect(pathExists(resolve(productRoot, "node_modules"))).resolves.toBe(false);
        } finally {
            await rm(productRoot, {recursive: true, force: true});
        }
    }, 120000);

    it("在 worker runtime 中编译 .profile.tsx 源码", async () => {
        await withCompiledRootSnapshot(async () => {
            const fileName = "builtin/leader.default.profile.tsx";
            const source = await readFile("workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx", "utf8");

            const result = await runProfileCompile({
                fileName,
                source,
                dryRun: false,
                preview: false,
            });

            expect(result.ok).toBe(true);
            expect(result.detail?.manifest?.key).toBe("leader.default");
            expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        });
    }, 120000);

    it("通过 worker service 后台编译 .profile.tsx 源码", async () => {
        await withCompiledRootSnapshot(async () => {
            const fileName = "builtin/leader.default.profile.tsx";
            const source = await readFile("workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx", "utf8");
            const worker = useProfileCompileWorker();

            try {
                const result = await worker.compile({
                    fileName,
                    source,
                    dryRun: false,
                    preview: false,
                });

                expect(result.ok).toBe(true);
                expect(result.detail?.manifest?.key).toBe("leader.default");
                expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
            } finally {
                worker.dispose();
            }
        });
    }, 120000);

    it("通过 worker runtime 全量编译用户 profile root", async () => {
        await withCompiledRootSnapshot(async () => {
            const result = await runProfileCompileAll({preview: false});

            expect(result.ok).toBe(true);
            expect(result.compiledCount).toBeGreaterThan(0);
            expect(result.profiles?.some((profile) => profile.profileKey === "leader.default")).toBe(true);
            expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
        });
    }, 120000);

    it("全量编译遇到坏 profile 时继续编译其它 profile", async () => {
        await withCompiledRootSnapshot(async () => {
            const brokenFile = resolve("workspace", ".nbook", "agent", "profiles", "broken-aggregate.profile.tsx");
            await writeFile(brokenFile, "export default ;\n", "utf8");
            try {
                const result = await runProfileCompileAll({preview: false});

                expect(result.ok).toBe(false);
                expect(result.profiles?.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                expect(result.issues).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        severity: "error",
                        fileName: "broken-aggregate.profile.tsx",
                    }),
                ]));
            } finally {
                await rm(brokenFile, {force: true});
            }
        });
    }, 120000);

    it("通过 worker service 后台全量编译用户 profile root", async () => {
        await withCompiledRootSnapshot(async () => {
            const worker = useProfileCompileWorker();
            try {
                const result = await worker.compileAll({preview: false});

                if (!result.ok) {
                    throw new Error(`worker compile-all failed: ${JSON.stringify(result.issues, null, 2)}`);
                }
                expect(result.ok).toBe(true);
                expect(result.compiledCount).toBeGreaterThan(0);
                expect(result.profiles?.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
            } finally {
                worker.dispose();
            }
        });
    }, 120000);

    it("源码覆盖编译不写入全局 profile module cache", async () => {
        await withCompiledRootSnapshot(async () => {
            const globalCacheRoot = resolve(".agent", "workspace", "profile-module-cache");
            await rm(globalCacheRoot, {recursive: true, force: true});
            await mkdir(globalCacheRoot, {recursive: true});
            const source = await readFile("workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx", "utf8");

            const result = await runProfileCompile({
                fileName: "builtin/leader.default.profile.tsx",
                source,
                dryRun: false,
                preview: false,
            });
            const cacheEntries = await readDirNames(globalCacheRoot);

            expect(result.ok).toBe(true);
            expect(cacheEntries.filter((name) => name.endsWith(".mjs"))).toEqual([]);
        });
    }, 120000);

    it("worker crash 返回结构化 issue，不向 endpoint 抛 rejected promise", async () => {
        const worker = new ProfileCompileWorkerService("test-crash");
        const running = worker.compile({
            fileName: "builtin/leader.default.profile.tsx",
            source: "export default null;",
            dryRun: false,
            preview: false,
        });

        worker.dispose();
        const result = await running;

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            stale: false,
            detail: null,
        }));
        expect(result.issues).toEqual([
            expect.objectContaining({
                severity: "error",
                code: "compile_worker_failed",
                fileName: "builtin/leader.default.profile.tsx",
            }),
        ]);
    });

    it("dry-run preview 不写入真实用户源码或 compiled artifact", async () => {
        const fileName = "builtin/leader.default.profile.tsx";
        const sourcePath = "workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx";
        const source = await readFile(sourcePath, "utf8");
        const compiledManifest = resolve("workspace", ".nbook", "agent", "profiles", ".compiled", "manifest.json");
        const originalManifest = await readFile(compiledManifest, "utf8").catch(() => null);
        await rm(compiledManifest, {force: true});
        try {
            const result = await runProfileCompile({
                fileName,
                source: source.replace("Neuro Book", "Dry Run Neuro Book"),
                dryRun: true,
                preview: true,
            });

            expect(result.ok).toBe(true);
            expect(result.preview?.ok).toBe(true);
            await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
            await expect(pathExists(compiledManifest)).resolves.toBe(false);
        } finally {
            if (originalManifest !== null) {
                await mkdir(resolve("workspace", ".nbook", "agent", "profiles", ".compiled"), {recursive: true});
                await writeFile(compiledManifest, originalManifest, "utf8");
            }
        }
    }, 120000);
});

async function readDirNames(root: string): Promise<string[]> {
    try {
        const entries = await import("node:fs/promises").then(({readdir}) => readdir(root));
        return entries;
    } catch {
        return [];
    }
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function createProductWorkerFixture(): Promise<string> {
    const productRoot = await mkdtemp(resolve(tmpdir(), "nbook-profile-product-"));
    const outputRoot = resolve(productRoot, ".output", "server");
    await mkdir(resolve(outputRoot, "server", "agent", "profiles"), {recursive: true});
    await mkdir(resolve(outputRoot, ".nuxt"), {recursive: true});
    await writeFile(resolve(productRoot, "release-meta.json"), "{\"versionKind\":\"release\"}\n", "utf8");
    await writeFile(resolve(outputRoot, "index.mjs"), "", "utf8");
    await writeFile(resolve(outputRoot, ".nuxt", "tsconfig.server.json"), "{}", "utf8");
    await writeFile(resolve(outputRoot, "server", "agent", "profiles", "profile-compile-worker-entry.ts"), "", "utf8");
    await writeFile(resolve(outputRoot, "server", "agent", "profiles", "profile-compile-worker-runtime.ts"), "", "utf8");
    await copyRuntimePackage("tsx", productRoot);
    await copyRuntimePackage("get-tsconfig", productRoot);
    await copyRuntimePackage("resolve-pkg-maps", productRoot);
    await copyRuntimePackage("esbuild", productRoot);
    await copyRuntimePackage("@esbuild/win32-x64", productRoot);
    return productRoot;
}

async function copyRuntimePackage(packageName: string, productRoot: string): Promise<void> {
    const source = resolve("node_modules", ...packageName.split("/"));
    const target = resolve(productRoot, ".output", "server", "node_modules", ...packageName.split("/"));
    await mkdir(resolve(target, ".."), {recursive: true});
    await cp(source, target, {recursive: true});
}

async function withCompiledRootSnapshot(run: () => Promise<void>): Promise<void> {
    const compiledRoot = resolve("workspace", ".nbook", "agent", "profiles", ".compiled");
    const originalManifest = await readFile(resolve(compiledRoot, "manifest.json"), "utf8").catch(() => null);
    const originalEntries = new Set(await readDirNames(compiledRoot));
    try {
        await run();
    } finally {
        await restoreCompiledRoot(compiledRoot, originalEntries, originalManifest);
    }
}

async function restoreCompiledRoot(compiledRoot: string, originalEntries: Set<string>, originalManifest: string | null): Promise<void> {
    await mkdir(compiledRoot, {recursive: true});
    const currentEntries = await readdir(compiledRoot).catch(() => []);
    await Promise.all(currentEntries
        .filter((entry) => !originalEntries.has(entry))
        .map((entry) => rm(resolve(compiledRoot, entry), {force: true})));
    if (originalManifest === null) {
        await rm(resolve(compiledRoot, "manifest.json"), {force: true});
        return;
    }
    await writeFile(resolve(compiledRoot, "manifest.json"), originalManifest, "utf8");
}
