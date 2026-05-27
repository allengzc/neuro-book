import path from "node:path";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {afterEach, describe, expect, it} from "vitest";
import {
    inspectCard,
    loadCardInput,
    runCli,
    slugify,
} from "nbook/assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";

describe("silly-tavern-card cli helpers", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("识别三张 raw 角色卡并统计 worldbook", async () => {
        const files = [
            ".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json",
            ".agent/workspace/cards/命定之诗/v4.2.1.raw.json",
            ".agent/workspace/cards/碧蓝档案/V1.5_1.raw.json",
        ];

        for (const file of files) {
            const loaded = await loadCardInput(path.resolve(file));
            const inspection = inspectCard(loaded);

            expect(inspection.kind).toBe("character-card");
            expect(inspection.name.length).toBeGreaterThan(0);
            expect(inspection.counts.worldbookEntries).toBeGreaterThan(0);
        }
    });

    it("识别 preset-like JSON，不当成角色卡", async () => {
        const loaded = await loadCardInput(path.resolve(".agent/workspace/cards/命定之诗/命定之诗Kemini5-3.8.json"));
        const inspection = inspectCard(loaded);

        expect(inspection.kind).toBe("preset");
        expect(inspection.warnings.join("\n")).toContain("preset");
    });

    it("统计 MVU/EJS 等动态 marker", async () => {
        const loaded = await loadCardInput(path.resolve(".agent/workspace/cards/命定之诗/v4.2.1.raw.json"));
        const inspection = inspectCard(loaded);

        expect(
            inspection.markers.initVar
            + inspection.markers.updateVariable
            + inspection.markers.ejs
            + inspection.markers.inject
            + inspection.markers.generate
            + inspection.markers.render,
        ).toBeGreaterThan(0);
    });

    it("slug 过滤 Windows 非法路径字符并保留中文", () => {
        expect(slugify("命定之诗: v4.2.1 / test")).toBe("命定之诗-v4.2.1-test");
        expect(slugify("   ")).toBe("silly-tavern-card");
    });

    it("暴露为 v3 skill catalog 可发现的系统 skill", async () => {
        const emptyUserRoot = await mkdtemp(path.join(tmpdir(), "st-card-empty-user-skills-"));
        tempRoots.push(emptyUserRoot);
        const skill = await new SkillCatalog(
            path.resolve("assets/workspace/.nbook/agent/skills"),
            emptyUserRoot,
        ).get("SillyTavern角色卡导入");

        expect(skill?.source).toBe("system");
        expect(skill?.description).toContain("SillyTavern");
        expect(skill?.whenToUse).toContain("酒馆角色卡");
    });

    it("import 写入 Project Workspace 并保护用户手改文件", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = path.resolve(".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json");

        await runCli(["bun", "silly-tavern-card", "import", input, "--workspace", workspace, "--rp"]);
        const lorebookPath = path.join(workspace, "lorebook", "note", "silly-tavern-2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload", "index.md");
        const generated = await readFile(lorebookPath, "utf-8");
        expect(generated).toContain("reference/silly-tavern/2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload/inspect.md");
        expect(JSON.parse(await readFile(`${lorebookPath}.generated.json`, "utf-8"))).toMatchObject({
            marker: "neuro-book:silly-tavern-card generated-sha256",
            target: "index.md",
        });

        await expect(runCli(["bun", "silly-tavern-card", "import", input, "--workspace", workspace])).rejects.toThrow("目标已存在");
        await runCli(["bun", "silly-tavern-card", "import", input, "--workspace", workspace, "--force"]);

        await writeFile(lorebookPath, `${generated}\n用户手改\n`, "utf-8");
        await expect(runCli(["bun", "silly-tavern-card", "import", input, "--workspace", workspace, "--force"])).rejects.toThrow("拒绝覆盖");
    });

    it("拒绝非 Project Workspace 和 unknown import", async () => {
        const notWorkspace = await mkdtemp(path.join(tmpdir(), "st-card-not-workspace-"));
        tempRoots.push(notWorkspace);
        const input = path.resolve(".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json");

        await expect(runCli(["bun", "silly-tavern-card", "inspect", input, "--workspace", notWorkspace])).rejects.toThrow("project.yaml");

        const workspace = await createProjectWorkspace(tempRoots);
        const unknownJson = path.join(workspace, "unknown.json");
        await writeFile(unknownJson, "{\"hello\":\"world\"}\n", "utf-8");

        await runCli(["bun", "silly-tavern-card", "inspect", unknownJson, "--workspace", workspace]);
        await expect(runCli(["bun", "silly-tavern-card", "import", unknownJson, "--workspace", workspace, "--force"])).rejects.toThrow("不是可识别");
    });
});

async function createProjectWorkspace(tempRoots: string[]): Promise<string> {
    const workspace = await mkdtemp(path.join(tmpdir(), "st-card-workspace-"));
    tempRoots.push(workspace);
    await writeFile(path.join(workspace, "project.yaml"), "kind: novel\ntitle: Test\n", "utf-8");
    return workspace;
}
