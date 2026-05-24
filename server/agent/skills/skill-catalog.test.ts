import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";

describe("SkillCatalog", () => {
    let root: string;
    let systemRoot: string;
    let userRoot: string;

    beforeEach(async () => {
        root = resolve(".agent", "agent-skill-catalog-test", randomUUID());
        systemRoot = join(root, "assets", ".nbook", "agent", "skills");
        userRoot = join(root, "workspace", ".nbook", "agent", "skills");
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("只扫描 .nbook skill root，并读取 frontmatter", async () => {
        await writeSkill(systemRoot, "writer", `---
name: Writer Skill
description: Write prose.
when_to_use:
  - 用户需要写正文时
  - 用户显式提到写作 skill 时
---
# Body
`);
        const catalog = new SkillCatalog(systemRoot, userRoot);

        await expect(catalog.get("writer")).resolves.toEqual(expect.objectContaining({
            key: "writer",
            name: "Writer Skill",
            description: "Write prose.",
            whenToUse: "用户需要写正文时；用户显式提到写作 skill 时",
            source: "system",
        }));
    });

    it("用户同名 skill 目录整体覆盖系统目录", async () => {
        await writeSkill(systemRoot, "writer", `---
name: System Writer
---
`);
        await writeSkill(userRoot, "writer", `---
name: User Writer
---
`);
        const catalog = new SkillCatalog(systemRoot, userRoot);

        await expect(catalog.list()).resolves.toEqual([
            expect.objectContaining({
                key: "writer",
                name: "User Writer",
                source: "user",
            }),
        ]);
    });

    it("缺少 SKILL.md 的目录不可见", async () => {
        await mkdir(join(systemRoot, "empty"), {recursive: true});
        const catalog = new SkillCatalog(systemRoot, userRoot);

        await expect(catalog.get("empty")).resolves.toBeNull();
    });

    it("默认系统 catalog 包含 profile-system-guide 和已迁移 v2 skills", async () => {
        const catalog = new SkillCatalog();

        const skills = await catalog.list();
        const keys = skills.map((skill) => skill.key);
        const skill = skills.find((item) => item.key === "profile-system-guide");

        expect(skill?.source).toBe("system");
        expect(skill?.skillPath.replaceAll("\\", "/")).toContain("assets/workspace/.nbook/agent/skills/profile-system-guide/SKILL.md");
        expect(skill?.description).toContain("harness");
        expect(keys).toEqual(expect.arrayContaining([
            "番茄小说导入",
            "角色设计流程",
            "剧情规划流程",
            "开局剧情设计",
            "世界模拟",
            "世界书初始化流程",
            "爽文",
            "小说初始化流程",
            "小说灵感探索流程",
            "skill-creator",
            "skill-creator-zh",
            "tsx-profile-editing",
        ]));
    });
});

async function writeSkill(root: string, key: string, source: string): Promise<void> {
    const skillRoot = join(root, key);
    await mkdir(skillRoot, {recursive: true});
    await writeFile(join(skillRoot, "SKILL.md"), source, "utf8");
}
