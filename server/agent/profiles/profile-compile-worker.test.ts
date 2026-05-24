import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {ProfileCompileWorkerService, useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {runProfileCompile} from "nbook/server/agent/profiles/profile-compile-worker-runtime";

describe("profile compile worker runtime", () => {
    it("在 worker runtime 中编译 .profile.tsx 源码", async () => {
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
    }, 120000);

    it("通过 worker service 后台编译 .profile.tsx 源码", async () => {
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

    it("源码覆盖编译不写入全局 profile module cache", async () => {
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
    }, 120000);

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
