import {mkdtemp, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";

describe("importRuntimeArtifact", () => {
    it("通过原生动态 import 加载运行时生成的 mjs artifact", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-runtime-artifact-"));
        try {
            const artifactPath = join(root, "runtime artifact.mjs");
            await writeFile(artifactPath, "export const value = 'loaded'; export default {answer: 42};\n", "utf8");

            const mod = await importRuntimeArtifact<{default: {answer: number}; value: string}>(artifactPath);

            expect(mod.value).toBe("loaded");
            expect(mod.default.answer).toBe(42);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("用物理 cache key 区分同一路径 artifact", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-runtime-artifact-query-"));
        const cacheRoot = resolve(".agent", "workspace", "runtime-artifact-import-cache", "test");
        try {
            const artifactPath = join(root, "runtime-artifact.mjs");
            await writeFile(artifactPath, "export const version = 1;\n", "utf8");

            const first = await importRuntimeArtifact<{version: number}>(artifactPath, {
                cacheKey: "version-1",
                cacheNamespace: "test",
            });
            await writeFile(artifactPath, "export const version = 2;\n", "utf8");
            const second = await importRuntimeArtifact<{version: number}>(artifactPath, {
                cacheKey: "version-2",
                cacheNamespace: "test",
            });

            expect(first.version).toBe(1);
            expect(second.version).toBe(2);
            await expect(readdir(cacheRoot)).resolves.toEqual(["version-1.mjs", "version-2.mjs"]);
        } finally {
            await rm(root, {recursive: true, force: true});
            await rm(cacheRoot, {recursive: true, force: true});
        }
    });
});
