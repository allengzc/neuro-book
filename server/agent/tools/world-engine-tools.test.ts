import fs from "node:fs/promises";
import path from "node:path";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createBuiltinTools} from "nbook/server/agent/tools";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {worldEngineFacade} from "nbook/server/world-engine";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";

describe("world engine agent tools", () => {
    let projectPath: string;
    let projectRoot: string;
    let context: ToolExecutionContext;

    beforeEach(async () => {
        projectPath = await createProject();
        projectRoot = path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length));
        context = {
            harness: {} as ToolExecutionContext["harness"],
            sessionId: 1,
            profileKey: "test.world-engine-tools",
            workspaceRoot: resolveWorkspaceContainerRoot(),
            workspaceKey: "global",
        };
    });

    afterEach(async () => {
        await worldEngineFacade.closeProject(projectPath);
        await removeProjectRoot(projectRoot);
    });

    it("内置工具注册只暴露新的 world engine 工具", () => {
        const builtinKeys = createBuiltinTools().map((tool) => tool.key);
        const worldKeys = createWorldEngineTools().map((tool) => tool.key);

        expect(worldKeys).toEqual(["execute_world_query", "write_world_slice"]);
        expect(builtinKeys).toContain("execute_world_query");
        expect(builtinKeys).toContain("write_world_slice");
        expect(builtinKeys).not.toContain("get_world_state");
        expect(builtinKeys).not.toContain("list_world_slices");
        expect(builtinKeys).not.toContain("edit_world_slice");
        expect(builtinKeys).not.toContain("delete_world_slice");
        expect(builtinKeys).not.toContain("create_world_subject");
        expect(builtinKeys).not.toContain("get_world_schema");
        expect(builtinKeys).not.toContain("list_world_subjects");
    });

    it("execute_world_query 执行 inline code", async () => {
        await worldEngineFacade.createSubject(projectPath, {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            at: BigInt(0),
        });
        await worldEngineFacade.createSubject(projectPath, {
            id: "moran",
            type: "character",
            name: "莫然",
            at: BigInt(1),
        });

        const result = await executeTool("execute_world_query", context, {
            projectPath,
            code: `
                const characters = await world.list("character");
                return characters;
            `,
        });

        expect(result.details).toEqual([
            {id: "erina", type: "character", name: "艾莉娜"},
            {id: "moran", type: "character", name: "莫然"},
        ]);
        expect(readText(result)).toContain('"erina"');
    });

    it("write_world_slice 写入后可用 execute_world_query 查询", async () => {
        await worldEngineFacade.createSubject(projectPath, {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            at: BigInt(0),
        });

        const written = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1日 00:00:10",
            title: "城北遭遇",
            patches: [
                {subjectId: "erina", path: "/hp", op: "increment", value: -30, summary: "伏击受伤"},
                {subjectId: "erina", path: "/events", op: "append", value: "城北遭遇伏击", summary: "记录遭遇"},
            ],
        });
        const queried = await executeTool("execute_world_query", context, {
            projectPath,
            code: `
                const erina = await world.get("erina");
                return { hp: erina.hp, events: erina.events };
            `,
        });

        expect(written.details).toEqual({sliceId: expect.any(String), issues: []});
        expect(queried.details).toEqual({hp: 70, events: ["城北遭遇伏击"]});
    });

    it("write_world_slice 支持 collection 按值 remove", async () => {
        await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1日 00:00:11",
            title: "获得旧剑",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "coin"},
            ],
        });
        await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1日 00:00:12",
            title: "交出旧剑",
            patches: [
                {subjectId: "erina", path: "/inventory", op: "remove", value: "old-sword"},
            ],
        });

        const queried = await executeTool("execute_world_query", context, {
            projectPath,
            code: `
                const erina = await world.get("erina");
                return erina.inventory;
            `,
        });

        expect(queried.details).toEqual(["coin"]);
    });

    it("write_world_slice 首写新 subject 时按 type 自动注册并应用 schema 默认值（C1）", async () => {
        // 未事先 createSubject：仅靠 patch 上的 type 触发自动注册。
        const written = await executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1日 00:00:20",
            title: "薇洛丝登场",
            patches: [
                {subjectId: "weiluosi", path: "/name", op: "replace", value: "薇洛丝", type: "character", name: "薇洛丝"},
                {subjectId: "weiluosi", path: "/events", op: "append", value: "在祭坛醒来", summary: "记录登场"},
            ],
        });
        expect(written.details).toEqual({sliceId: expect.any(String), issues: []});

        // 自动注册后应能被 world.get / world.list 查到，且 schema 默认值（hp=100）已应用。
        const queried = await executeTool("execute_world_query", context, {
            projectPath,
            code: `
                const w = await world.get("weiluosi");
                const list = await world.list("character");
                return { hp: w.hp, events: w.events, listed: list.map(s => s.id) };
            `,
        });
        expect(queried.details).toEqual({hp: 100, events: ["在祭坛醒来"], listed: ["weiluosi"]});
    });

    it("write_world_slice 首写未声明 type 时报错引导", async () => {
        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1日 00:00:30",
            title: "缺类型",
            patches: [
                {subjectId: "ghost", path: "/hp", op: "increment", value: -1},
            ],
        })).rejects.toThrow(/subject 尚未登记：ghost/);
    });

    it("write_world_slice 首写失败时不会留下半注册 subject", async () => {
        await expect(executeTool("write_world_slice", context, {
            projectPath,
            time: "复兴纪元1日 00:00:40",
            title: "非法首写",
            patches: [
                {subjectId: "broken-first-write", path: "/name", op: "replace", type: "character", name: "失败首写"},
            ],
        })).rejects.toThrow("使用 replace 时必须提供 value");

        const queried = await executeTool("execute_world_query", context, {
            projectPath,
            code: `
                const characters = await world.list("character");
                return characters.map(s => s.id);
            `,
        });
        expect(queried.details).toEqual([]);
    });

    it("execute_world_query 失败时保存调试脚本", async () => {
        await worldEngineFacade.createSubject(projectPath, {
            id: "erina",
            type: "character",
            name: "艾莉娜",
            at: BigInt(0),
        });

        let savedPath: string | undefined;
        try {
            await executeTool("execute_world_query", context, {
                projectPath,
                code: `
                    const hero = await world.get("erina");
                    return hero.name + (;
                `,
            });
            throw new Error("测试期望 execute_world_query 抛错");
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            expect(error.message).toContain("查询执行失败");
            const match = error.message.match(/失败的代码已保存到：(\.temp\/world-query-[a-f0-9]+\.js)/);
            expect(match?.[1]).toBeDefined();
            savedPath = match?.[1];
            if (savedPath) {
                const savedCode = await fs.readFile(path.join(context.workspaceRoot, savedPath), "utf-8");
                expect(savedCode).toContain("return hero.name + (;");
            }
        } finally {
            if (savedPath) {
                await fs.rm(path.join(context.workspaceRoot, savedPath), {force: true});
            }
        }
    });
});

async function executeTool(key: string, context: ToolExecutionContext, input: unknown): Promise<AgentToolResult<unknown>> {
    const tool = createWorldEngineTools().find((item) => item.key === key);
    if (!tool?.executeWithContext) {
        throw new Error(`missing world engine tool: ${key}`);
    }
    return tool.executeWithContext(context, `${key}-call`, input);
}

function readText(result: AgentToolResult<unknown>): string {
    const item = result.content[0];
    if (!item || item.type !== "text") {
        throw new Error("测试期望工具返回 text content");
    }
    return item.text;
}

async function createProject(): Promise<string> {
    const slug = `world-tools-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const root = path.join(resolveWorkspaceContainerRoot(), slug);
    await fs.mkdir(path.join(root, "world-engine/schema"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: World Tools Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine/schema/index.ts"), schemaFixture(), "utf-8");
    await fs.writeFile(path.join(root, "world-engine/calendar.ts"), calendarFixture(), "utf-8");
    return projectPath;
}

function schemaFixture(): string {
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
        "export const WorldSchema = {",
        "    character: z.object({",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        inventory: z.array(z.string()).unique().default([]).describe('背包'),",
        "        events: z.array(z.string()).default([]).describe('经历'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function calendarFixture(): string {
    return [
        "export default {",
        "    type: 'simple',",
        "    eraBefore: '复兴纪元',",
        "    eraAfter: '复兴纪元',",
        "    baseUnit: 'second',",
        "    units: [",
        "        {name: 'minute', parent: 'second', ratio: 60},",
        "        {name: 'hour', parent: 'minute', ratio: 60},",
        "        {name: 'day', parent: 'hour', ratio: 24},",
        "    ],",
        "    format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
        "};",
        "",
    ].join("\n");
}

async function removeProjectRoot(root: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            await fs.rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}
