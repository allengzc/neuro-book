import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {zipSync, strToU8} from "fflate";
import {afterEach, describe, expect, it} from "vitest";

import {rollbackProduct, rollbackReleaseSource, stageReleaseSource, switchReleaseSource} from "#manager/component";
import {removePath} from "#manager/files";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => removePath(root)));
});

describe("Release Source component", () => {
    it("只替换 Source 拥有的文件并可回滚", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-source-"));
        roots.push(root);
        await writeFile(join(root, "old.txt"), "old", "utf8");
        await writeFile(join(root, "config.yaml"), "user", "utf8");
        const bytes = zipSync({"new.txt": strToU8("new")});
        const staged = await stageReleaseSource({
            root,
            staging: join(root, ".deploy", "staging", "op"),
            asset: dataAsset(bytes),
            version: "1.0.0",
            revision: "b".repeat(40),
            previous: {
                provider: "release",
                version: "0.9.0",
                revision: "a".repeat(40),
                path: ".",
                files: ["old.txt"],
                checksum: "a".repeat(64),
                sourceUrl: "https://example.com/old.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
        });
        await switchReleaseSource({
            root,
            staged,
            backup: join(root, ".deploy", "backups", "op", "source"),
            previousFiles: ["old.txt"],
        });
        expect(await readFile(join(root, "new.txt"), "utf8")).toBe("new");
        expect(await readFile(join(root, "config.yaml"), "utf8")).toBe("user");

        await rollbackReleaseSource(
            root,
            join(root, ".deploy", "backups", "op", "source"),
            ["old.txt"],
            staged.component.files,
        );
        expect(await readFile(join(root, "old.txt"), "utf8")).toBe("old");
    });

    it("拒绝归档覆盖用户状态", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-source-forbidden-"));
        roots.push(root);
        const bytes = zipSync({"workspace/project.txt": strToU8("bad")});
        await expect(stageReleaseSource({
            root,
            staging: join(root, ".deploy", "staging", "op"),
            asset: dataAsset(bytes),
            version: "1.0.0",
            revision: "b".repeat(40),
        })).rejects.toThrow("禁止路径");
    });
});

describe("Product component rollback", () => {
    it("首次安装没有旧 Product 时删除已切换的新 Product", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-product-root-"));
        const backup = await mkdtemp(join(tmpdir(), "manager-product-backup-"));
        roots.push(root, backup);
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "new.txt"), "new", "utf8");

        await rollbackProduct(root, backup);

        await expect(stat(join(root, ".output"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("更新失败时恢复旧 Product", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-product-root-"));
        const backup = await mkdtemp(join(tmpdir(), "manager-product-backup-"));
        roots.push(root, backup);
        await mkdir(join(root, ".output"), {recursive: true});
        await mkdir(join(backup, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "new.txt"), "new", "utf8");
        await writeFile(join(backup, ".output", "old.txt"), "old", "utf8");

        await rollbackProduct(root, backup);

        expect(await readFile(join(root, ".output", "old.txt"), "utf8")).toBe("old");
        await expect(stat(join(root, ".output", "new.txt"))).rejects.toMatchObject({code: "ENOENT"});
    });
});

function dataAsset(bytes: Uint8Array): {url: string; sha256: string; bytes: number} {
    return {
        url: `data:application/zip;base64,${Buffer.from(bytes).toString("base64")}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
    };
}
