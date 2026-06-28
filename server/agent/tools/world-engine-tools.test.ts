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
            profileKey: "leader.default",
            workspaceRoot: resolveWorkspaceContainerRoot(),
            workspaceKey: "global",
        };
    });

    afterEach(async () => {
        await worldEngineFacade.closeProject(projectPath);
        await removeProjectRoot(projectRoot);
    });

    it("内置工具注册只暴露 execute_world", () => {
        const builtinKeys = createBuiltinTools().map((tool) => tool.key);
        const worldKeys = createWorldEngineTools().map((tool) => tool.key);

        expect(worldKeys).toEqual(["execute_world"]);
        expect(builtinKeys).toContain("execute_world");
        expect(builtinKeys).not.toContain("execute_world_query");
        expect(builtinKeys).not.toContain("write_world_slice");
        expect(builtinKeys).not.toContain("delete_world_slice");
    });

    it("execute_world 在一个脚本内写入并查询，统一返回 data 和 issues", async () => {
        const result = await executeWorld(context, projectPath, `
            const time = world.parseTime("复兴纪元1日 00:00:10");
            const written = await world.writeSlice({
                time,
                title: "城北遭遇",
                summary: "艾莉娜在城北遭遇伏击",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "increment", value: -30, summary: "伏击受伤"},
                    {subjectId: "erina", path: "/events", op: "append", value: "城北遭遇伏击", summary: "记录遭遇"},
                ],
            });
            const erina = await world.get("erina");
            const slices = await world.slices({limit: 10, withPatches: true});
            return {written, hp: erina.hp, events: erina.events, patchId: slices[0].patches[0].patchId};
        `);

        expect(result.details).toEqual({
            data: {
                written: {sliceId: expect.any(String), issues: []},
                hp: 70,
                events: ["城北遭遇伏击"],
                patchId: expect.any(String),
            },
            issues: [],
        });
        expect(readText(result)).toContain('"hp": 70');
    });

    it("execute_world 支持 collection 按值 remove", async () => {
        const result = await executeWorld(context, projectPath, `
            await world.writeSlice({
                time: world.parseTime("复兴纪元1日 00:00:11"),
                title: "获得旧剑",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "old-sword"},
                    {subjectId: "erina", path: "/inventory", op: "append", value: "old-sword"},
                    {subjectId: "erina", path: "/inventory", op: "append", value: "coin"},
                ],
            });
            await world.writeSlice({
                time: world.parseTime("复兴纪元1日 00:00:12"),
                title: "交出旧剑",
                patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "old-sword"}],
            });
            const erina = await world.get("erina");
            return erina.inventory;
        `);

        expect(result.details).toEqual({data: ["coin"], issues: []});
    });

    it("editMutations 能精确修正已有 patch path，编辑后 patchId 失效需重读", async () => {
        const result = await executeWorld(context, projectPath, `
            const written = await world.writeSlice({
                time: world.parseTime("复兴纪元1日 00:00:20"),
                title: "误写 HP",
                patches: [
                    {subjectId: "erina", type: "character", name: "艾莉娜", path: "/HP", op: "replace", value: 40, summary: "误写大写路径"},
                ],
            });
            const before = await world.getSlice(written.sliceId);
            const wrongPatch = before.patches.find((patch) => patch.path === "/HP");
            await world.editMutations(written.sliceId, [
                {patchId: wrongPatch.patchId, set: {path: "/hp", summary: "修正为标准 hp 路径"}},
            ]);
            const after = await world.getSlice(written.sliceId);
            const erina = await world.get("erina");
            return {
                hp: erina.hp,
                beforePatchId: wrongPatch.patchId,
                afterPatchId: after.patches.find((patch) => patch.summary === "修正为标准 hp 路径").patchId,
                path: after.patches.find((patch) => patch.summary === "修正为标准 hp 路径").path,
            };
        `);

        expect(result.details).toEqual({
            data: {
                hp: 40,
                beforePatchId: expect.any(String),
                afterPatchId: expect.any(String),
                path: "/hp",
            },
            issues: [],
        });
        const data = (result.details as {data: {beforePatchId: string; afterPatchId: string}}).data;
        expect(data.afterPatchId).not.toBe(data.beforePatchId);
    });

    it("脚本 throw 会回滚前面已经执行的写入", async () => {
        await expect(executeWorld(context, projectPath, `
            await world.writeSlice({
                time: world.parseTime("复兴纪元1日 00:00:30"),
                title: "应回滚",
                patches: [{subjectId: "rollback", type: "character", name: "回滚者", path: "/hp", op: "replace", value: 1}],
            });
            throw new Error("主动回滚");
        `)).rejects.toThrow("主动回滚");

        const result = await executeWorld(context, projectPath, `
            const subjects = await world.list("character");
            return subjects.map((item) => item.id);
        `);
        expect(result.details).toEqual({data: [], issues: []});
    });

    it("writer profile 下 execute_world 保持只读", async () => {
        const writerContext = {...context, profileKey: "writer"};

        await expect(executeWorld(writerContext, projectPath, `
            return typeof world.writeSlice;
        `)).resolves.toMatchObject({
            details: {data: "undefined", issues: []},
        });
        await expect(executeWorld(writerContext, projectPath, `
            await world.writeSlice({
                time: world.parseTime("复兴纪元1日 00:00:40"),
                title: "writer 不应写入",
                patches: [{subjectId: "bad", type: "character", path: "/hp", op: "replace", value: 1}],
            });
        `)).rejects.toThrow();
    });

    it("execute_world 失败时保存调试脚本", async () => {
        let savedPath: string | undefined;
        try {
            await executeWorld(context, projectPath, `
                const hero = await world.get("erina");
                return hero.name + (;
            `);
            throw new Error("测试期望 execute_world 抛错");
        } catch (error) {
            if (!(error instanceof Error)) {
                throw error;
            }
            expect(error.message).toContain("世界引擎脚本执行失败");
            const match = error.message.match(/失败的代码已保存到：(\.temp\/world-execute-[a-f0-9]+\.js)/);
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

async function executeWorld(context: ToolExecutionContext, projectPath: string, code: string): Promise<AgentToolResult<unknown>> {
    const tool = createWorldEngineTools().find((item) => item.key === "execute_world");
    if (!tool?.executeWithContext) {
        throw new Error("missing world engine tool: execute_world");
    }
    return tool.executeWithContext(context, "execute_world-call", {projectPath, code});
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
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await fs.rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}
