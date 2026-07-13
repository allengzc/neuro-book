import {join, resolve} from "node:path";

import {describe, expect, it} from "vitest";

import {installationPaths} from "#manager/paths";

describe("Installation Root 路径", () => {
    it("普通安装以根目录作为 State Root", () => {
        const root = resolve("fixtures", "neuro-book");
        const paths = installationPaths(root);
        expect(paths.state).toBe(root);
        expect(paths.manifest).toBe(join(root, ".deploy", "installation.json"));
    });

    it("Windows Portable 使用 data State Root", () => {
        const root = resolve("fixtures", "neuro-book");
        const paths = installationPaths(root, true);
        expect(paths.state).toBe(join(root, "data"));
    });
});
