import {mkdir, readFile, rm} from "node:fs/promises";
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
            preview: false,
        });
        const cacheEntries = await readDirNames(globalCacheRoot);

        expect(result.ok).toBe(true);
        expect(cacheEntries.filter((name) => name.endsWith(".mjs"))).toEqual([]);
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
