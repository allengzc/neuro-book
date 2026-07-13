import {createHash} from "node:crypto";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {importInstallation, inspectImport} from "#manager/instance-import";
import {writeInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import type {InstallationManifest} from "#manager/types";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("实例离线导入", () => {
    it("服务停机只产生warning，确认后可导入", async () => {
        const root = await fixture();
        const configPath = join(root, "manager-home", "config.json");
        const inspection = await inspectImport(root);
        expect(inspection.blockers).toEqual([]);
        expect(inspection.importable).toBe(true);
        expect(inspection.warnings.some((issue) => issue.code === "service.offline-unchecked")).toBe(true);
        await expect(importInstallation({root, configPath})).rejects.toThrow("--yes");
        const result = await importInstallation({root, configPath, acceptWarnings: true});
        expect(result.instance.root).toBe(root);
    });

    it("checksum blocker不能被acceptWarnings绕过", async () => {
        const root = await fixture();
        await writeFile(join(root, ".runtime", "manager", "0.1.0", "neuro-book.mjs"), "corrupted", "utf8");
        const inspection = await inspectImport(root);
        expect(inspection.importable).toBe(false);
        await expect(importInstallation({root, configPath: join(root, "config.json"), acceptWarnings: true})).rejects.toThrow("checksum");
    });
});

async function fixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-import-"));
    roots.push(root);
    const manager = join(root, ".runtime", "manager", "0.1.0", "neuro-book.mjs");
    const wrapper = join(root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book");
    await mkdir(join(root, ".deploy"), {recursive: true});
    await mkdir(join(root, "workspace"), {recursive: true});
    await mkdir(join(root, "logs"), {recursive: true});
    await mkdir(join(manager, ".."), {recursive: true});
    await mkdir(join(wrapper, ".."), {recursive: true});
    const bundle = "console.log('manager')\n";
    await writeFile(manager, bundle, "utf8");
    await writeFile(wrapper, process.platform === "win32" ? ".runtime\\manager\\0.1.0\\neuro-book.mjs" : ".runtime/manager/0.1.0/neuro-book.mjs", "utf8");
    await writeFile(join(root, "config.yaml"), "server: {}\n", "utf8");
    const revision = "b".repeat(40);
    const now = new Date().toISOString();
    const manifest: InstallationManifest = {
        schemaVersion: 3, profile: "source-dev", managerVersion: "0.1.0", appVersion: "1.0.0", channel: "canary", sourceRevision: revision, stateRoot: ".",
        components: {
            source: {provider: "git", version: "1.0.0", revision, path: ".", repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: createHash("sha256").update(bundle).digest("hex")},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"}, applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"}, tools: {git: {provider: "system", version: "git version 2", executable: "git"}},
        }, installedAt: now, updatedAt: now,
    };
    await writeInstallationManifest(installationPaths(root).manifest, manifest);
    return root;
}
