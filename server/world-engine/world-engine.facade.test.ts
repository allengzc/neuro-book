import {afterAll, describe, expect, it} from "bun:test";
import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {PrismaLibSql} from "@prisma/adapter-libsql";
import fs from "node:fs/promises";
import path from "node:path";
import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";
import {resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

const createdProjects: string[] = [];
const createdFacades: WorldEngineFacade[] = [];

describe("WorldEngineFacade", () => {
    afterAll(async () => {
        await Promise.all(createdFacades.map((facade) => facade.closeProject("workspace/__test__")));
        await Promise.all(createdProjects.map((projectPath) => removeProjectRoot(projectPath)));
        createdFacades.splice(0);
        createdProjects.splice(0);
    });

    it("首写自动创建 subject，并应用 schema default 与 4-op patch", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const result = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 80},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "increment", value: -20},
                {subjectId: "erina", path: "/events", op: "append", value: "在祭坛醒来"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "events", "inventory"]});
        const subjects = await facade.listSubjects(projectPath);

        expect(result.issues).toEqual([]);
        expect(subjects).toEqual(expect.arrayContaining([
            {id: "erina", type: "character", name: "艾莉娜"},
            {id: "old-sword", type: "item", name: "旧剑"},
        ]));
        expect(state.subjects[0]?.attrs).toEqual({
            hp: 80,
            events: ["在祭坛醒来"],
            inventory: ["subject://old-sword"],
        });
    });

    it("collection append 去重，remove 可按值删除且幂等", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "获得物品",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 90},
                {subjectId: "key", type: "item", name: "钥匙", path: "/durability", op: "replace", value: 100},
                {subjectId: "coin", type: "item", name: "金币", path: "/durability", op: "replace", value: 100},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://key"},
            ],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "交出旧剑",
            patches: [
                {subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "remove", value: "subject://coin"},
            ],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["inventory"]});

        expect(state.subjects[0]?.attrs.inventory).toEqual(["subject://key"]);
    });

    it("编辑 collection remove 的 value 会重新计算下游 advisory", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "获得物品",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 90},
                {subjectId: "key", type: "item", name: "钥匙", path: "/durability", op: "replace", value: 100},
                {subjectId: "coin", type: "item", name: "金币", path: "/durability", op: "replace", value: 100},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://key"},
            ],
        });
        const removal = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "交出旧剑",
            patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"}],
        });
        const downstream = await facade.writeSlice(projectPath, {
            instant: 30n,
            title: "获得金币",
            patches: [{subjectId: "erina", path: "/inventory", op: "append", value: "subject://coin"}],
        });
        const edited = await facade.editSlice(projectPath, removal.sliceId, {
            instant: 20n,
            title: "交出钥匙",
            patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "subject://key"}],
        });
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["inventory"]});

        expect(edited.issues).toEqual([expect.objectContaining({code: "base-shifted", sliceId: downstream.sliceId, subjectId: "erina", attr: "inventory"})]);
        expect(state.subjects[0]?.attrs.inventory).toEqual(["subject://old-sword", "subject://coin"]);
    });

    it("list 拒绝按值 remove，保持时间顺序语义", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await expect(facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误删除经历",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "remove", value: "在祭坛醒来"},
            ],
        })).rejects.toThrow("只有 collection 支持按值 remove");
    });

    it("queryState 支持内部全量查询，同时 attrs 投影和 listLimit 生效", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "初始化世界",
            patches: [
                {subjectId: "world", type: "world", name: "世界", path: "/era", op: "replace", value: "复兴纪元"},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value: "醒来"},
                {subjectId: "erina", path: "/events", op: "append", value: "拿到旧剑"},
            ],
        });
        const full = await facade.queryState(projectPath, {});
        const narrowed = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["events"], listLimit: 1});

        expect(full.instant).toBe(10n);
        expect(full.subjects.map((subject) => subject.subjectId).sort()).toEqual(["erina", "world"]);
        expect(narrowed.subjects[0]?.attrs).toEqual({events: ["拿到旧剑"]});
    });

    it("编辑过去绝对 patch 会返回 base-shifted，删除基准后显形 broken-relative", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const base = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "体力基准",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100}],
        });
        await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "受伤",
            patches: [{subjectId: "erina", path: "/hp", op: "increment", value: -10}],
        });
        const edited = await facade.editSlice(projectPath, base.sliceId, {
            instant: 10n,
            title: "体力基准修正",
            patches: [{subjectId: "erina", path: "/hp", op: "replace", value: 80}],
        });
        const deleted = await facade.deleteSlice(projectPath, base.sliceId);

        expect(edited.issues).toEqual([expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "hp"})]);
        expect(deleted.issues).toEqual([expect.objectContaining({code: "broken-relative", subjectId: "erina", attr: "hp"})]);
    });

    it("ref 目标缺失在查询时报告 dangling-ref，并归属写入切面", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 5n,
            title: "地点存在",
            patches: [{subjectId: "old-place", type: "location", name: "旧地点", path: "/name", op: "replace", value: "旧地点"}],
        });
        const relation = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "错误地点",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/location", op: "replace", value: "subject://old-place"}],
        });
        await deleteWorldSubject(projectPath, "old-place");
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["location"]});

        expect(state.issues).toEqual([
            expect.objectContaining({code: "dangling-ref", sliceId: relation.sliceId, subjectId: "erina", attr: "location"}),
        ]);
    });

    it("listSlices subject filter 支持 any/all，deleteSlice 会回退状态", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const first = await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "艾莉娜登场",
            patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100}],
        });
        const second = await facade.writeSlice(projectPath, {
            instant: 20n,
            title: "双人同行",
            patches: [
                {subjectId: "erina", path: "/events", op: "append", value: "遇见莫然"},
                {subjectId: "moran", type: "character", name: "莫然", path: "/events", op: "append", value: "遇见艾莉娜"},
            ],
        });
        const any = await facade.listSlices(projectPath, {subjectIds: ["erina"], subjectMode: "any", withPatches: true});
        const all = await facade.listSlices(projectPath, {subjectIds: ["erina", "moran"], subjectMode: "all"});
        await facade.deleteSlice(projectPath, second.sliceId);
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "events"]});

        expect(any.map((slice) => slice.title)).toEqual(["艾莉娜登场", "双人同行"]);
        expect(all.map((slice) => slice.title)).toEqual(["双人同行"]);
        expect(state.subjects[0]?.attrs).toEqual({hp: 100, events: []});
    });

    it("calendar 可格式化和解析同一个 instant", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        const formatted = await facade.formatTime(projectPath, 3661n);
        const parsed = await facade.parseTime(projectPath, formatted);

        expect(formatted).toBe("复兴纪元1日 01:01:01");
        expect(parsed).toBe(3661n);
    });

    it("Project SQLite 使用 WorldPatch 表，不再创建 WorldMutation", async () => {
        const projectPath = await createProject();
        const facade = createFacade();

        await facade.writeSlice(projectPath, {
            instant: 10n,
            title: "建表验证",
            patches: [{subjectId: "world", type: "world", name: "世界", path: "/era", op: "replace", value: "复兴纪元"}],
        });

        expect(await tableExists(projectPath, "WorldPatch")).toBe(true);
        expect(await tableExists(projectPath, "WorldMutation")).toBe(false);
    });
});

function createFacade(): WorldEngineFacade {
    const facade = new WorldEngineFacade();
    createdFacades.push(facade);
    return facade;
}

async function createProject(): Promise<string> {
    const slug = `world-engine-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const root = projectRoot(projectPath);
    await fs.mkdir(path.join(root, "world-engine", "schema"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: World Engine Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "schema", "index.ts"), schemaSource(), "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "calendar.ts"), calendarSource(), "utf-8");
    createdProjects.push(projectPath);
    return projectPath;
}

function projectRoot(projectPath: string): string {
    return path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length));
}

async function tableExists(projectPath: string, table: string): Promise<boolean> {
    const client = new PrismaClient({adapter: new PrismaLibSql({url: toSqliteFileUrl(resolveProjectDatabasePath(projectPath))})});
    try {
        const rows = await client.$queryRawUnsafe<Array<{name: string}>>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table);
        return rows.length > 0;
    } finally {
        await client.$disconnect();
    }
}

async function deleteWorldSubject(projectPath: string, subjectId: string): Promise<void> {
    const client = new PrismaClient({adapter: new PrismaLibSql({url: toSqliteFileUrl(resolveProjectDatabasePath(projectPath))})});
    try {
        await client.worldSubject.delete({where: {id: subjectId}});
    } finally {
        await client.$disconnect();
    }
}

async function removeProjectRoot(projectPath: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        collectReleasedSqliteHandles();
        try {
            await fs.rm(projectRoot(projectPath), {recursive: true, force: true});
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

function schemaSource(): string {
    return [
        'import {z} from "zod";',
        "",
        'declare module "zod" {',
        '    interface ZodArray<T extends z.ZodTypeAny, Cardinality extends z.ArrayCardinality = "many"> {',
        "        unique(): this;",
        "    }",
        "}",
        "z.ZodArray.prototype.unique = function() {",
        "    (this as any)._def.unique = true;",
        "    return this;",
        "};",
        "function Ref(targetType: string) {",
        "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
        "}",
        "export const WorldSchema = {",
        "    world: z.object({",
        "        era: z.string().default('复兴纪元').describe('纪元'),",
        "        events: z.array(z.string()).default([]).describe('世界事件'),",
        "    }),",
        "    character: z.object({",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        events: z.array(z.string()).default([]).describe('经历'),",
        "        inventory: z.array(Ref('item')).unique().default([]).describe('背包'),",
        "        location: Ref('location').optional().describe('当前位置'),",
        "    }),",
        "    item: z.object({",
        "        durability: z.number().int().default(100).describe('耐久'),",
        "    }),",
        "    location: z.object({",
        "        name: z.string().optional().describe('名称'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function calendarSource(): string {
    return [
        "export default {",
        "  type: 'simple',",
        "  eraBefore: '复兴纪元',",
        "  eraAfter: '复兴纪元',",
        "  baseUnit: 'second',",
        "  units: [",
        "    {name: 'minute', parent: 'second', ratio: 60},",
        "    {name: 'hour', parent: 'minute', ratio: 60},",
        "    {name: 'day', parent: 'hour', ratio: 24},",
        "  ],",
        "  format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
        "};",
        "",
    ].join("\n");
}
