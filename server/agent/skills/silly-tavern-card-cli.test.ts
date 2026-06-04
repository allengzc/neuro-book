import path from "node:path";
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {afterEach, describe, expect, it} from "vitest";
import {
    inspectCard,
    loadCardInput,
    runCli,
    slugify,
} from "nbook/assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card";
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
        const catalog = new SkillCatalog(
            path.resolve("assets/workspace/.nbook/agent/skills"),
            emptyUserRoot,
        );
        const canonicalSkill = await catalog.get("novel-import-silly-tavern-card");

        expect(canonicalSkill?.source).toBe("system");
        expect(canonicalSkill?.description).toContain("SillyTavern");
        expect(canonicalSkill?.description).toContain("worldbooks");
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
        const lorebookFiles = await listLorebookIndexFiles(workspace);
        expect(lorebookFiles.length).toBeGreaterThan(5);
        expect(lorebookFiles[0]).toContain(`${path.sep}lorebook${path.sep}`);
        expect(path.basename(path.dirname(lorebookFiles[0]))).toMatch(/^\d{6}-/);
        const firstLorebook = await readFile(lorebookFiles[0], "utf-8");
        expect(firstLorebook).toContain("sillyTavernWorldbook:");
        expect(firstLorebook).toContain("insertion_order:");
        expect(firstLorebook).toContain("extensions:");
        const report = await readFile(path.join(workspace, unpackDir, "import-report.md"), "utf-8");
        expect(report).toContain("Import Mapping");
        expect(report).toContain("Skipped Dynamic Content");
        expect(report).toContain("Classification Review Queue");
        expect(report).toContain("Recommended Next Steps");

        await expect(runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace])).rejects.toThrow("文件已存在");

        const unknownJson = path.join(workspace, "unknown.json");
        await writeFile(unknownJson, "{\"hello\":\"world\"}\n", "utf-8");
        await runCli(["bun", "silly-tavern-card", "unpack", unknownJson, "--project", workspace, "--out", "reference/unknown"]);
        await expect(runCli(["bun", "silly-tavern-card", "import", "reference/unknown/unknown", "--project", workspace, "--force"])).rejects.toThrow("不是可识别");
    });

    it("按确定性分类把稳定 worldbook 映射到 lorebook 根目录，并跳过动态条目", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);

        const unpackDir = `reference/silly-tavern/${slugify("Synthetic ST Card")}`;
        const inspectJson = JSON.parse(await readFile(path.join(workspace, unpackDir, "inspect.json"), "utf-8")) as {
            mappingSummary: {skippedDynamic: number; needsReview: number; lorebookTargets: Record<string, number>};
        };
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/character"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/location"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/faction"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/rule"]).toBeUndefined();
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/world/rule"]).toBeGreaterThanOrEqual(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/item"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/event"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/system"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/note"]).toBeGreaterThanOrEqual(3);
        expect(inspectJson.mappingSummary.skippedDynamic).toBe(1);
        expect(inspectJson.mappingSummary.needsReview).toBeGreaterThanOrEqual(3);

        const logs = await captureConsoleLog(() => runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace, "--json"]));
        const importJson = JSON.parse(logs.join("\n")) as {
            mappingSummary: {skippedDynamic: number; needsReview: number; lorebookTargets: Record<string, number>};
        };
        expect(importJson.mappingSummary.skippedDynamic).toBe(1);
        expect(importJson.mappingSummary.needsReview).toBeGreaterThanOrEqual(3);
        expect(importJson.mappingSummary.lorebookTargets["lorebook/rule"]).toBeUndefined();

        await expect(stat(path.join(workspace, "lorebook", "character", slugify("000001-Synthetic-ST-Card-角色-艾丽丝"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "location", slugify("000002-Synthetic-ST-Card-地点-白塔"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "faction", slugify("000003-Synthetic-ST-Card-势力-银月公会"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "rule"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "lorebook", "world", "rule", slugify("000004-Synthetic-ST-Card-规则-魔法体系"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "item", slugify("000005-Synthetic-ST-Card-物品-世界之心"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "event", slugify("000006-Synthetic-ST-Card-事件-黄昏战争"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "system", slugify("000009-Synthetic-ST-Card-系统-炼金玩法"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000008-Synthetic-ST-Card-神秘条目"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000010-Synthetic-ST-Card-角色-地点-混合条目"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000011-Synthetic-ST-Card-状态栏格式"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "system", slugify("000011-Synthetic-ST-Card-状态栏格式"), "index.md"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000007-Synthetic-ST-Card-InitVar-状态变量"), "index.md"))).rejects.toThrow();

        const importedCharacter = await readFile(path.join(workspace, "lorebook", "character", slugify("000001-Synthetic-ST-Card-角色-艾丽丝"), "index.md"), "utf-8");
        expect(importedCharacter).toContain("primaryCategory: \"character\"");
        expect(importedCharacter).toContain("classification:");
        const pendingNote = await readFile(path.join(workspace, "lorebook", "note", slugify("000008-Synthetic-ST-Card-神秘条目"), "index.md"), "utf-8");
        expect(pendingNote).toContain("status: \"pending\"");
        const mixedNote = await readFile(path.join(workspace, "lorebook", "note", slugify("000010-Synthetic-ST-Card-角色-地点-混合条目"), "index.md"), "utf-8");
        expect(mixedNote).toContain("status: \"pending\"");
        const statusUiNote = await readFile(path.join(workspace, "lorebook", "note", slugify("000011-Synthetic-ST-Card-状态栏格式"), "index.md"), "utf-8");
        expect(statusUiNote).toContain("status: \"pending\"");
        expect(statusUiNote).toContain("reviewFlags:");
        expect(statusUiNote).toContain("status-ui");
        const report = await readFile(path.join(workspace, unpackDir, "import-report.md"), "utf-8");
        expect(report).toContain("lorebook/character: 1");
        expect(report).toContain("lorebook/world/rule: 1");
        expect(report).toContain("Classification Review Queue");
        expect(report).toContain("Pending Lorebook Notes");
        expect(report).toContain("Recommended Next Steps");
        expect(report).toContain("InitVar 状态变量");
        expect(report).toContain("角色-地点-混合条目");
        expect(report).toContain("状态栏格式");
        expect(report).toContain("subject knowledge generated: no");
    });

    it("--rp 只生成 simulation-migration 候选，不创建 simulation 运行态", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);

        const unpackDir = `reference/silly-tavern/${slugify("Synthetic ST Card")}`;
        await runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace, "--rp"]);

        const migrationDir = path.join(workspace, unpackDir, "simulation-migration");
        await expect(stat(path.join(migrationDir, "README.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "simulator-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "writer-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "subject-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "entity-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "unsupported-runtime.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "simulation", "subjects"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "simulation", "entities"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "simulation", "runs"))).rejects.toThrow();

        const unsupported = await readFile(path.join(migrationDir, "unsupported-runtime.md"), "utf-8");
        expect(unsupported).toContain("Unsupported Runtime");
        expect(unsupported).toContain("InitVar 状态变量");
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

async function listLorebookIndexFiles(workspace: string): Promise<string[]> {
    const roots = ["character", "location", "faction", "world/rule", "item", "event", "system", "note"];
    const files: string[] = [];
    for (const root of roots) {
        const rootPath = path.join(workspace, "lorebook", root);
        let entries: string[] = [];
        try {
            entries = await readdir(rootPath);
        } catch {
            continue;
        }
        for (const entry of entries) {
            files.push(path.join(rootPath, entry, "index.md"));
        }
    }
    return files.sort();
}

async function createSyntheticCard(tempRoots: string[]): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "st-card-synthetic-"));
    tempRoots.push(root);
    const file = path.join(root, "synthetic.raw.json");
    await writeFile(file, JSON.stringify({
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
            name: "Synthetic ST Card",
            character_book: {
                entries: [
                    syntheticEntry(1, "角色-艾丽丝", "背景故事: 艾丽丝是白塔守望者。\n性格: 冷静。"),
                    syntheticEntry(2, "地点-白塔", "白塔位于北境边缘，是古代观测站。"),
                    syntheticEntry(3, "势力-银月公会", "银月公会成员负责守护商路。"),
                    syntheticEntry(4, "规则-魔法体系", "施法必须消耗以太，并接受判定。"),
                    syntheticEntry(5, "物品-世界之心", "持有世界之心者可以感到异常力量，用途未知。"),
                    syntheticEntry(6, "事件-黄昏战争", "黄昏战争发生于旧历末年，是主线导火索。"),
                    syntheticEntry(7, "InitVar 状态变量", "[InitVar]\n<UpdateVariable name=\"favor\" />"),
                    syntheticEntry(8, "神秘条目", "一段没有明显结构的描述。"),
                    syntheticEntry(9, "系统-炼金玩法", "炼金玩法包含背包、任务栏和日程。"),
                    syntheticEntry(10, "角色-地点-混合条目", "背景故事: 艾丽丝来自白塔。\n白塔位于北境边缘。"),
                    syntheticEntry(11, "状态栏格式", "状态栏必须输出好感度、背包栏和日程面板。"),
                ],
            },
        },
    }, null, 2) + "\n", "utf-8");
    return file;
}

function syntheticEntry(insertionOrder: number, comment: string, content: string): Record<string, unknown> {
    return {
        uid: insertionOrder,
        comment,
        content,
        disable: false,
        constant: false,
        insertion_order: insertionOrder,
        keys: [],
        secondary_keys: [],
        extensions: {position: 0},
    };
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

