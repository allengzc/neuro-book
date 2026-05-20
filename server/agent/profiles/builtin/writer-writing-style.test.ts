import fs from "node:fs/promises";
import os from "node:os";
import {describe, expect, it} from "vitest";
import path from "node:path";
import {buildWritingStyle, loadWritingStylePresets, resolveWritingStyleDirectory} from "nbook/server/agent/profiles/builtin/writer-writing-style";

describe("writer writing style", () => {
    it("会在打包目录缺失时回退到源码 writing-styles 目录", async () => {
        const sourceDirectory = path.join(process.cwd(), "server", "agent", "profiles", "builtin", "writing-styles");

        await expect(resolveWritingStyleDirectory([
            path.join(process.cwd(), ".nuxt", "dev", "writing-styles"),
            sourceDirectory,
        ])).resolves.toBe(sourceDirectory);
    });

    it("会加载默认反派萝莉轻喜剧文风", async () => {
        const style = await buildWritingStyle();

        expect(style).toContain('<writing_style preset="反派萝莉轻喜剧" key="reborn-villain-loli-magic-girl.first-three-chapters.style" source="转生反派萝莉，找茬魔法少女·前三章">');
        expect(style).toContain("文体定位：反派萝莉轻喜剧");
        expect(style).toContain("正确示例");
        expect(style).toContain("错误示例");
        expect(style).toContain("典型例文");
        expect(style).toContain("栗见正咬着一片烤得半焦的吐司");
        expect(style).toContain("空腹作恶不利于长远发展");
        expect(style).not.toContain("# 第1章 反派魔法少女");
        expect(style).not.toContain("苏天晴");
    });

    it("会仍然加载北棱特调文风", async () => {
        const style = await buildWritingStyle({
            preset: "darkside-kitten.beileng-special",
        });

        expect(style).toContain('<writing_style preset="北棱特调" key="darkside-kitten.beileng-special" source="【DarkSide-小猫之神】v1.1">');
        expect(style).toContain("在遣词造句方面，不一定需要严格遵循语法规则与词语搭配");
    });

    it("用户文风按同名文件覆盖且保留系统其他文件", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-writing-style-"));
        const systemRoot = path.join(root, "system");
        const userRoot = path.join(root, "user");
        await fs.mkdir(systemRoot, {recursive: true});
        await fs.mkdir(userRoot, {recursive: true});
        await fs.writeFile(path.join(systemRoot, "base.md"), createStyleFile("base", "系统基础", "system base"), "utf-8");
        await fs.writeFile(path.join(systemRoot, "override.md"), createStyleFile("override", "系统覆盖前", "system override"), "utf-8");
        await fs.writeFile(path.join(userRoot, "override.md"), createStyleFile("override", "用户覆盖后", "user override"), "utf-8");

        try {
            const presets = await loadWritingStylePresets([userRoot, systemRoot]);

            expect(presets.map((item) => item.key)).toEqual(["base", "override"]);
            expect(presets.find((item) => item.key === "base")?.content).toContain("system base");
            expect(presets.find((item) => item.key === "override")?.label).toBe("用户覆盖后");
            expect(presets.find((item) => item.key === "override")?.content).toContain("user override");
        } finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });
});

function createStyleFile(key: string, label: string, body: string): string {
    return [
        "---",
        `key: ${key}`,
        `label: ${label}`,
        "sourcePreset: test",
        "identifier: test",
        "name: test",
        "enabled: true",
        "role: null",
        "---",
        "",
        body,
    ].join("\n");
}
