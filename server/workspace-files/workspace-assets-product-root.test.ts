import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {resolveSystemNbookRoot, resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Product system assets root", () => {
    it("无根 node_modules 时使用 Product 内已修补的系统资产", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-product-assets-"));
        roots.push(root);
        await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
        const productRoot = join(root, ".output", "server", "assets", "workspace", ".nbook");
        await mkdir(productRoot, {recursive: true});

        expect(resolveSystemNbookRoot(root)).toBe(productRoot);
    });

    it("显式 State Root 不被祖先 workspace 目录覆盖", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-workspace-parent-"));
        roots.push(root);
        const applicationRoot = join(root, "workspace", "portable");
        const stateRoot = join(applicationRoot, "data");
        await mkdir(stateRoot, {recursive: true});
        const previousApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
        const previousStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
        process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        try {
            expect(resolveWorkspaceContainerRoot(applicationRoot)).toBe(resolve(stateRoot, "workspace"));
        } finally {
            restoreEnv("NEURO_BOOK_APPLICATION_ROOT", previousApplicationRoot);
            restoreEnv("NEURO_BOOK_STATE_ROOT", previousStateRoot);
        }
    });
});

/** 恢复测试前的进程环境。 */
function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
