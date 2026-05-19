import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {LocalSkillCatalogProvider} from "nbook/server/agent/skills/skill-catalog";

const createdWorkspacePaths: string[] = [];

/**
 * 创建临时 skills 根目录。
 */
async function createSkillWorkspace() {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-skill-catalog-"));
    createdWorkspacePaths.push(workspacePath);
    await fs.mkdir(path.join(workspacePath, "assets", "agent", "skills"), {recursive: true});
    return workspacePath;
}

/**
 * 在临时 skills 根目录下写入一个 skill。
 */
async function writeSkillFile(workspacePath: string, directoryName: string, fileName: "SKILL.md" | "skill.md", content: string): Promise<string> {
    const skillDirectoryPath = path.join(workspacePath, "assets", "agent", "skills", directoryName);
    await fs.mkdir(skillDirectoryPath, {recursive: true});
    const skillFilePath = path.join(skillDirectoryPath, fileName);
    await fs.writeFile(skillFilePath, content, "utf-8");
    return skillFilePath;
}

afterEach(async () => {
    await Promise.all(createdWorkspacePaths.splice(0).map(async (workspacePath) => {
        await fs.rm(workspacePath, {recursive: true, force: true});
    }));
});

describe("LocalSkillCatalogProvider", () => {
    it("会发现内置写作流程 skill，并保留爽文为通用节奏指导", async () => {
        const provider = new LocalSkillCatalogProvider(process.cwd());

        const catalog = await provider.list();
        const skillNames = catalog.map((skill) => skill.name);
        const shuangwenSkill = catalog.find((skill) => skill.name === "爽文");

        expect(skillNames).toContain("小说灵感探索流程");
        expect(skillNames).toContain("小说初始化流程");
        expect(skillNames).toContain("世界书初始化流程");
        expect(skillNames).toContain("角色设计流程");
        expect(skillNames).toContain("世界模拟");
        expect(skillNames).toContain("开局剧情设计");
        expect(skillNames).toContain("剧情规划流程");
        expect(skillNames).toContain("爽文");
        expect(skillNames).toContain("番茄小说导入");
        expect(skillNames).not.toContain("世界观设定流程");
        expect(shuangwenSkill?.description).toContain("通用商业网文节奏指导");
        expect(shuangwenSkill?.description).toContain("不绑定任何固定题材");

        const tomatoSkill = catalog.find((skill) => skill.name === "番茄小说导入");
        expect(tomatoSkill?.description).toContain("番茄小说");
        expect(tomatoSkill?.description).toContain("epub 转 Markdown");
    });

    it("会读取带 frontmatter 的 SKILL.md 并返回绝对路径", async () => {
        const workspacePath = await createSkillWorkspace();
        const expectedSkillPath = await writeSkillFile(workspacePath, "writer", "SKILL.md", [
            "---",
            "name: Writer",
            "description: 写作流程技能",
            "when_to_use:",
            "  - 用户显式要求写作",
            "---",
            "# Writer",
        ].join("\n"));
        const provider = new LocalSkillCatalogProvider(workspacePath);

        const catalog = await provider.list();
        expect(catalog).toEqual([{
            name: "Writer",
            description: "写作流程技能",
            whenToUse: "用户显式要求写作",
            headerText: ["name: Writer", "description: 写作流程技能", "when_to_use:", "  - 用户显式要求写作"].join("\n"),
            location: expectedSkillPath,
            displayLocation: "assets/agent/skills/writer/SKILL.md",
            source: "builtin",
        }]);
    });

    it("会兼容小写 skill.md，并跳过没有 frontmatter 的旧 skill", async () => {
        const workspacePath = await createSkillWorkspace();
        await writeSkillFile(workspacePath, "legacy", "skill.md", "# 旧技能\n没有 frontmatter");
        const expectedSkillPath = await writeSkillFile(workspacePath, "rag", "skill.md", [
            "---",
            "name: RAG",
            "description: 检索技能",
            "---",
            "# RAG",
        ].join("\n"));
        const provider = new LocalSkillCatalogProvider(workspacePath);

        const catalog = await provider.list();
        expect(catalog).toEqual([{
            name: "RAG",
            description: "检索技能",
            whenToUse: undefined,
            headerText: ["name: RAG", "description: 检索技能"].join("\n"),
            location: expectedSkillPath,
            displayLocation: "assets/agent/skills/rag/skill.md",
            source: "builtin",
        }]);
    });

    it("用户 assets 中的同名 skill 会覆盖内置 skill", async () => {
        const workspacePath = await createSkillWorkspace();
        await writeSkillFile(workspacePath, "builtin-writer", "SKILL.md", [
            "---",
            "name: Writer",
            "description: 内置写作流程",
            "---",
            "# Builtin",
        ].join("\n"));
        const userSkillDirectoryPath = path.join(workspacePath, "workspace", ".nbook", "assets", "agent", "skills", "writer");
        await fs.mkdir(userSkillDirectoryPath, {recursive: true});
        const userSkillPath = path.join(userSkillDirectoryPath, "SKILL.md");
        await fs.writeFile(userSkillPath, [
            "---",
            "name: Writer",
            "description: 用户写作流程",
            "---",
            "# User",
        ].join("\n"), "utf-8");
        const provider = new LocalSkillCatalogProvider(workspacePath);

        const catalog = await provider.list();
        expect(catalog).toEqual([expect.objectContaining({
            name: "Writer",
            description: "用户写作流程",
            location: userSkillPath,
            displayLocation: "workspace/.nbook/assets/agent/skills/writer/SKILL.md",
            source: "user",
        })]);
    });
});
