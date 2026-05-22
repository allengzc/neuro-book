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
        root = resolve(".agent", "agent-v3-skill-catalog-test", randomUUID());
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
---
# Body
`);
        const catalog = new SkillCatalog(systemRoot, userRoot);

        await expect(catalog.get("writer")).resolves.toEqual(expect.objectContaining({
            key: "writer",
            name: "Writer Skill",
            description: "Write prose.",
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
});

async function writeSkill(root: string, key: string, source: string): Promise<void> {
    const skillRoot = join(root, key);
    await mkdir(skillRoot, {recursive: true});
    await writeFile(join(skillRoot, "SKILL.md"), source, "utf8");
}
