import {describe, expect, it} from "vitest";

import {parseInstallationManifest, parseReleaseManifest} from "#manager/schema";

const SHA = "a".repeat(64);
const REVISION = "b".repeat(40);

describe("Manager manifest schema v3", () => {
    it("接受 Product Bun 的固定组件结构", () => {
        expect(parseInstallationManifest(productManifest()).profile).toBe("product-bun");
    });

    it("直接拒绝 schema v2", () => {
        expect(() => parseInstallationManifest({...productManifest(), schemaVersion: 2})).toThrow("schema v3");
    });

    it("拒绝路径越界与 Source/Product revision 不一致", () => {
        const invalidPath = productManifest();
        invalidPath.components.manager.path = "../manager.mjs";
        expect(() => parseInstallationManifest(invalidPath)).toThrow("Installation Root");

        const mismatch = productManifest();
        mismatch.components.product.revision = "c".repeat(40);
        expect(() => parseInstallationManifest(mismatch)).toThrow("revision");
    });

    it("验证 Release 平台唯一性和 GHCR revision", () => {
        const manifest = releaseManifest();
        expect(parseReleaseManifest(manifest).products[0]?.platform).toBe("windows-x64");
        manifest.products.push({...manifest.products[0]!});
        expect(() => parseReleaseManifest(manifest)).toThrow("重复 Product 平台");
    });
});

function productManifest() {
    return {
        schemaVersion: 3 as const,
        profile: "product-bun" as const,
        managerVersion: "0.1.0",
        appVersion: "0.8.0",
        channel: "stable" as const,
        sourceRevision: REVISION,
        stateRoot: "." as const,
        components: {
            source: {
                provider: "release" as const,
                version: "0.8.0",
                revision: REVISION,
                path: "." as const,
                files: ["package.json"],
                archiveSha256: SHA,
                sourceUrl: "https://example.com/source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            product: {
                provider: "release" as const,
                version: "0.8.0",
                revision: REVISION,
                path: ".output" as const,
                platform: "windows-x64" as const,
                archiveSha256: SHA,
                sourceUrl: "https://example.com/product.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            manager: {provider: "managed" as const, version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: SHA},
            managerRuntime: {provider: "system" as const, version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system" as const, version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function releaseManifest() {
    return {
        schemaVersion: 2 as const,
        version: "0.8.0",
        channel: "stable" as const,
        sourceRevision: REVISION,
        minManagerVersion: "0.1.0",
        source: {url: "https://example.com/source.zip", sha256: SHA, bytes: 1},
        products: [{url: "https://example.com/product.zip", sha256: SHA, bytes: 1, platform: "windows-x64" as const, sourceRevision: REVISION}],
        windowsPortable: {url: "https://example.com/portable.zip", sha256: SHA, bytes: 1},
        ghcr: {ref: "ghcr.io/notnotype/neuro-book:v0.8.0", digest: `sha256:${SHA}`, sourceRevision: REVISION},
    };
}
