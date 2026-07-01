import {describe, expect, it} from "vitest";

import {defaultImageTags} from "nbook/scripts/deploy/publish-ghcr-image.mjs";
import {askSelect} from "nbook/scripts/deploy/prompts.mjs";
import {resolveGhcrImageOption} from "nbook/scripts/deploy/shared.mjs";
import {
    defaultReleaseTag,
    ghcrReleaseOptions,
    imageForReleaseTag,
    normalizeReleaseTag,
    releaseKind,
    selectableGhcrReleases,
} from "nbook/scripts/deploy/ghcr-releases.mjs";

describe("GHCR release 选择", () => {
    it("默认镜像 tag 与 release workflow 保持一致", () => {
        expect(defaultImageTags("0.5.3")).toEqual(["v0.5.3", "latest"]);
        expect(defaultImageTags("0.5.3-canary.20260701.030929Z.69581b3e")).toEqual([
            "v0.5.3-canary.20260701.030929Z.69581b3e",
        ]);
    });

    it("用安装器版本生成默认 release tag 和镜像名", () => {
        expect(defaultReleaseTag("0.5.3-canary.1")).toBe("v0.5.3-canary.1");
        expect(normalizeReleaseTag("0.5.3")).toBe("v0.5.3");
        expect(imageForReleaseTag("0.5.3-canary.1")).toBe("ghcr.io/notnotype/neuro-book:v0.5.3-canary.1");
    });

    it("release 选择和完整 image override 互斥", async () => {
        await expect(resolveGhcrImageOption({
            interactive: false,
            image: "ghcr.io/notnotype/neuro-book:custom",
            release: "v0.5.3",
        })).rejects.toThrow("--image 和 --release 只能选择一个");

        await expect(resolveGhcrImageOption({
            interactive: false,
            image: null,
            release: "0.5.3",
        })).resolves.toBe("ghcr.io/notnotype/neuro-book:v0.5.3");
    });

    it("只列出 stable 与受支持的 prerelease channel", () => {
        const releases = selectableGhcrReleases([
            {tag_name: "v0.5.3", prerelease: false, draft: false},
            {tag_name: "v0.5.4-canary.1", prerelease: true, draft: false},
            {tag_name: "v0.5.4-preview.1", prerelease: true, draft: false},
            {tag_name: "v0.5.2", prerelease: false, draft: true},
            {tag_name: "", prerelease: false, draft: false},
        ]);

        expect(releases.map((release) => release.tag_name)).toEqual([
            "v0.5.3",
            "v0.5.4-canary.1",
        ]);
        expect(releaseKind(releases[0])).toBe("stable");
        expect(releaseKind(releases[1])).toBe("canary");
    });

    it("生成交互选择项时显示版本类型", () => {
        const options = ghcrReleaseOptions([
            {tag_name: "v0.5.3", prerelease: false, draft: false, published_at: "2026-07-01T00:00:00Z"},
            {tag_name: "v0.5.4-beta.1", prerelease: true, draft: false, published_at: null},
        ]);

        expect(options.map((option) => option.label)).toEqual([
            "v0.5.3 (stable)",
            "v0.5.4-beta.1 (beta)",
        ]);
    });

    it("通用选择 helper 不改写 release tag 大小写", async () => {
        await expect(askSelect({
            interactive: false,
            value: "v0.5.3-canary.20260701.030929Z.69581b3e",
            message: "GHCR 版本",
            options: [],
            initialValue: "v0.5.3",
        })).resolves.toBe("v0.5.3-canary.20260701.030929Z.69581b3e");
    });
});
