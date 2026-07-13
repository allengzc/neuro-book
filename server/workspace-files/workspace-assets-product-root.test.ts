import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {resolveSystemNbookRoot} from "nbook/server/workspace-files/workspace-assets-root";

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
});
