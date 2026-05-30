import path from "node:path";
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
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

    it("inspect 只输出 overview，不生成解包文件", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = path.resolve(".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json");

        const logs = await captureConsoleLog(() => runCli(["bun", "silly-tavern-card", "inspect", input]));

        expect(logs.join("\n")).toContain("Overview");
        await expect(stat(path.join(workspace, "reference"))).rejects.toThrow();
    });

    it("unpack 生成稳定解包目录和单个 generated.json", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = path.resolve(".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json");

        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);
        const unpackDir = path.join(workspace, "reference", "silly-tavern", "2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload");
        const manifest = JSON.parse(await readFile(path.join(unpackDir, "generated.json"), "utf-8")) as {files: Record<string, unknown>};

        expect(await readFile(path.join(unpackDir, "raw", "card.json"), "utf-8")).toContain("chara_card_v3");
        expect(await readFile(path.join(unpackDir, "extensions", "tavern_helper.scripts.json"), "utf-8")).toContain("[");
        expect(await readFile(path.join(unpackDir, "extensions", "tavern_helper.variables.json"), "utf-8")).toContain("{");
        expect(await readFile(path.join(unpackDir, "extensions", "regex_scripts.json"), "utf-8")).toContain("[");
        const worldbookEntryFiles = await readdir(path.join(unpackDir, "worldbook", "entries"));
        expect(worldbookEntryFiles.length).toBeGreaterThan(0);
        expect(worldbookEntryFiles[0]).toMatch(/^\d{6}-/);
        const entryOrders = worldbookEntryFiles.map((file) => Number(file.slice(0, 6)));
        expect(entryOrders).toEqual([...entryOrders].sort((left, right) => left - right));
        const firstWorldbookEntry = await readFile(path.join(unpackDir, "worldbook", "entries", worldbookEntryFiles[0]), "utf-8");
        expect(firstWorldbookEntry).toContain("---\ntitle:");
        expect(firstWorldbookEntry).toContain("source: \"silly-tavern-worldbook\"");
        expect(firstWorldbookEntry).toContain("insertion_order:");
        expect(firstWorldbookEntry).toContain("extensions:");
        expect((await readdir(path.join(unpackDir, "extensions", "regex_scripts"))).length).toBeGreaterThan(0);
        expect((await readdir(path.join(unpackDir, "extensions", "tavern_helper", "scripts"))).length).toBeGreaterThan(0);
        expect(Object.keys(manifest.files).length).toBeGreaterThan(5);
        expect((await readdir(path.join(unpackDir, "raw"))).some((file) => file.endsWith(".generated.json"))).toBe(false);

        await expect(runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace])).rejects.toThrow("文件已存在");
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace, "--force"]);

        const overviewPath = path.join(unpackDir, "overview.md");
        await writeFile(overviewPath, `${await readFile(overviewPath, "utf-8")}\n用户手改\n`, "utf-8");
        await expect(runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace, "--force"])).rejects.toThrow("拒绝覆盖");
    });

    it("import 从解包目录导入 worldbook，并拒绝 unknown 解包", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = path.resolve(".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json");
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);

        const unpackDir = "reference/silly-tavern/2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload";
        await runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace, "--rp"]);
        const lorebookDirs = await readdir(path.join(workspace, "lorebook", "note"));
        expect(lorebookDirs.length).toBeGreaterThan(5);
        expect(lorebookDirs[0]).toMatch(/^\d{6}-/);
        const firstLorebook = await readFile(path.join(workspace, "lorebook", "note", lorebookDirs[0], "index.md"), "utf-8");
        expect(firstLorebook).toContain("sillyTavernWorldbook:");
        expect(firstLorebook).toContain("insertion_order:");
        expect(firstLorebook).toContain("extensions:");
        expect(await readFile(path.join(workspace, unpackDir, "import-report.md"), "utf-8")).toContain("lorebook/note/");

        await expect(runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace])).rejects.toThrow("文件已存在");

        const unknownJson = path.join(workspace, "unknown.json");
        await writeFile(unknownJson, "{\"hello\":\"world\"}\n", "utf-8");
        await runCli(["bun", "silly-tavern-card", "unpack", unknownJson, "--project", workspace, "--out", "reference/unknown"]);
        await expect(runCli(["bun", "silly-tavern-card", "import", "reference/unknown/unknown", "--project", workspace, "--force"])).rejects.toThrow("不是可识别");
    });

    it("拒绝非 Project Workspace", async () => {
        const notWorkspace = await mkdtemp(path.join(tmpdir(), "st-card-not-workspace-"));
        tempRoots.push(notWorkspace);
        const input = path.resolve(".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json");

        await expect(runCli(["bun", "silly-tavern-card", "unpack", input, "--project", notWorkspace])).rejects.toThrow("project.yaml");
    });
});

async function createProjectWorkspace(tempRoots: string[]): Promise<string> {
    const workspace = await mkdtemp(path.join(tmpdir(), "st-card-workspace-"));
    tempRoots.push(workspace);
    await writeFile(path.join(workspace, "project.yaml"), "kind: novel\ntitle: Test\n", "utf-8");
    return workspace;
}

async function captureConsoleLog(callback: () => Promise<void>): Promise<string[]> {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...items: unknown[]) => {
        logs.push(items.map(String).join(" "));
    };
    try {
        await callback();
        return logs;
    } finally {
        console.log = original;
    }
}

