import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {buildWritingReference, loadWritingReferencePresets, resolveWritingReferenceDirectory} from "nbook/server/agent/profiles/builtin/writer-writing-reference";

describe("writer-writing-reference", () => {
    it("可以动态发现默认文风参考正文", async () => {
        const reference = await buildWritingReference();

        expect(reference).toContain("<writing_reference>");
        expect(reference).toContain("# 第1章 反派魔法少女");
        expect(reference).toContain("# 第2章 反派的日常就是找茬");
        expect(reference).toContain("# 第3章 蹲点是反派的必备技能");
        expect(reference).not.toContain("key:");
        expect(reference).not.toContain("generatedFrom:");
    });

    it("会从源码目录 fallback 加载 writing-references", async () => {
        const directory = await resolveWritingReferenceDirectory([
            "C:/definitely-missing-writing-references",
            "server/agent/profiles/builtin/writing-references",
        ]);
        const references = await loadWritingReferencePresets();

        expect(directory.replace(/\\/g, "/")).toContain("server/agent/profiles/builtin/writing-references");
        expect(references.some((reference) => reference.key === "reborn-villain-loli-magic-girl.first-three-chapters")).toBe(true);
    });

    it("用户文风参考按同名文件覆盖且保留系统其他文件", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-writing-reference-"));
        const systemRoot = path.join(root, "system");
        const userRoot = path.join(root, "user");
        await fs.mkdir(systemRoot, {recursive: true});
        await fs.mkdir(userRoot, {recursive: true});
        await fs.writeFile(path.join(systemRoot, "base.md"), createReferenceFile("base", "系统基础", "system base"), "utf-8");
        await fs.writeFile(path.join(systemRoot, "override.md"), createReferenceFile("override", "系统覆盖前", "system override"), "utf-8");
        await fs.writeFile(path.join(userRoot, "override.md"), createReferenceFile("override", "用户覆盖后", "user override"), "utf-8");

        try {
            const presets = await loadWritingReferencePresets([userRoot, systemRoot]);

            expect(presets.map((item) => item.key)).toEqual(["base", "override"]);
            expect(presets.find((item) => item.key === "base")?.content).toContain("system base");
            expect(presets.find((item) => item.key === "override")?.label).toBe("用户覆盖后");
            expect(presets.find((item) => item.key === "override")?.content).toContain("user override");
        } finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });
});

function createReferenceFile(key: string, label: string, body: string): string {
    return [
        "---",
        `key: ${key}`,
        `label: ${label}`,
        "sourceTitle: test",
        "sourceChapters: test",
        "generatedFrom: test",
        "---",
        "",
        body,
    ].join("\n");
}
