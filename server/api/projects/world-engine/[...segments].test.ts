import fs from "node:fs/promises";
import path from "node:path";
import {afterAll, beforeEach, describe, expect, it} from "vitest";
import {worldEngineFacade} from "nbook/server/world-engine";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";

const createdProjects: string[] = [];

describe("/api/projects/world-engine", {timeout: 30_000}, () => {
    beforeEach(() => {
        Object.assign(globalThis, {
            defineEventHandler: (handler: unknown) => handler,
            readBody: (event: {body?: unknown}) => event.body,
            getQuery: (event: {query?: Record<string, unknown>}) => event.query ?? {},
            createError: (input: {statusCode?: number; message?: string}) => {
                const error = new Error(input.message ?? "未知错误") as Error & {statusCode?: number};
                error.statusCode = input.statusCode;
                return error;
            },
        });
    });

    afterAll(async () => {
        for (const projectPath of createdProjects) {
            await closeProjectForTest(projectPath).catch(() => undefined);
            await worldEngineFacade.closeProject(projectPath);
            await removeProjectRoot(projectPath);
        }
        createdProjects.splice(0);
    });

    it("HTTP path segment 编码不合法时返回稳定 400", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "slices/%E0%A4%A")).rejects.toMatchObject({
            statusCode: 400,
            message: "API path 编码不合法：%E0%A4%A",
        });
    }, 30_000);

    it("未 open 的 Project 返回 PROJECT_NOT_OPEN", async () => {
        const projectPath = await createProject({open: false});
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await expect(callApi(handler, projectPath, "GET", "schema")).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath,
            },
        });
    });

    it("使用 patches 写入、编辑、删除切面，并通过 GET /state 全量查询", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        const first = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:10",
            title: "艾莉娜登场",
            summary: "初始体力记录",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100},
            ],
        });
        const createdSlice = await callApi(handler, projectPath, "GET", `slices/${readSliceId(first)}`);
        const second = await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:20",
            title: "受伤",
            patches: [{subjectId: "erina", path: "/hp", op: "increment", value: -10}],
        });
        const edited = await callApi(handler, projectPath, "POST", `slices/${readSliceId(first)}/edit`, {
            time: "复兴纪元1日 00:00:10",
            title: "体力修正",
            summary: "体力修正摘要",
            patches: [{subjectId: "erina", path: "/hp", op: "replace", value: 80}],
        });
        const queried = await callApi(handler, projectPath, "POST", "state/query", {subjectIds: ["erina"], attrs: ["hp"]});
        const full = await callApi(handler, projectPath, "GET", "state");
        const slices = await callApi(handler, projectPath, "GET", "slices", undefined, {withPatches: "true"});
        const singleSlice = await callApi(handler, projectPath, "GET", `slices/${readSliceId(first)}`);
        await callApi(handler, projectPath, "POST", `slices/${readSliceId(second)}/delete`);
        const afterDelete = await callApi(handler, projectPath, "POST", "state/query", {subjectIds: ["erina"], attrs: ["hp"]});

        expect(edited).toMatchObject({issues: [expect.objectContaining({code: "base-shifted", subjectId: "erina", attr: "hp"})]});
        expect(createdSlice).toMatchObject({title: "艾莉娜登场", summary: "初始体力记录"});
        expect(readSubjectState(queried, "erina").attrs.hp).toBe(70);
        expect(readSubjectState(full, "erina").attrs.hp).toBe(70);
        expect(readSlices(slices)[0]).toMatchObject({title: "体力修正", summary: "体力修正摘要"});
        expect(singleSlice).toMatchObject({title: "体力修正", summary: "体力修正摘要"});
        expect(readSlices(slices)[0]?.patches?.[0]).toMatchObject({subjectId: "erina", path: "/hp", op: "replace"});
        expect(readSubjectState(afterDelete, "erina").attrs.hp).toBe(80);
    });

    it("POST /state/query 继续拒绝未收窄查询，GET /state 允许 UI/debug 全量查询", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:10",
            title: "世界初始化",
            patches: [{subjectId: "world", type: "world", name: "世界", path: "/era", op: "replace", value: "复兴纪元"}],
        });

        await expect(callApi(handler, projectPath, "POST", "state/query", {})).rejects.toMatchObject({
            statusCode: 400,
            message: "state/query 必须提供 subjectIds 或 type",
        });
        expect(readSubjects(await callApi(handler, projectPath, "GET", "state")).map((subject) => subject.subjectId)).toEqual(["world"]);
    });

    it("collection 支持 remove + value，list remove + value 被 service 拒绝", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:10",
            title: "拿到物品",
            patches: [
                {subjectId: "old-sword", type: "item", name: "旧剑", path: "/durability", op: "replace", value: 80},
                {subjectId: "key", type: "item", name: "钥匙", path: "/durability", op: "replace", value: 100},
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/inventory", op: "append", value: "subject://old-sword"},
                {subjectId: "erina", path: "/inventory", op: "append", value: "subject://key"},
            ],
        });
        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:20",
            title: "交出旧剑",
            patches: [{subjectId: "erina", path: "/inventory", op: "remove", value: "subject://old-sword"}],
        });

        expect(readSubjectState(await callApi(handler, projectPath, "POST", "state/query", {subjectIds: ["erina"], attrs: ["inventory"]}), "erina").attrs.inventory).toEqual(["subject://key"]);
        await expect(callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:30",
            title: "错误删除经历",
            patches: [{subjectId: "erina", path: "/events", op: "remove", value: "醒来"}],
        })).rejects.toMatchObject({statusCode: 400, message: "/events 只有 collection 支持按值 remove"});
    });

    it("subjects/slices 支持 type 与 subject filter 查询", async () => {
        const projectPath = await createProject();
        const handler = (await import("nbook/server/api/projects/world-engine/[...segments]")).default;

        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:10",
            title: "双人登场",
            patches: [
                {subjectId: "erina", type: "character", name: "艾莉娜", path: "/events", op: "append", value: "遇见莫然"},
                {subjectId: "moran", type: "character", name: "莫然", path: "/events", op: "append", value: "遇见艾莉娜"},
            ],
        });
        await callApi(handler, projectPath, "POST", "slices", {
            time: "复兴纪元1日 00:00:20",
            title: "艾莉娜独行",
            patches: [{subjectId: "erina", path: "/events", op: "append", value: "独自调查"}],
        });

        expect(await callApi(handler, projectPath, "GET", "subjects", undefined, {type: "character"})).toEqual([
            {id: "erina", type: "character", name: "艾莉娜"},
            {id: "moran", type: "character", name: "莫然"},
        ]);
        expect(readSlices(await callApi(handler, projectPath, "GET", "slices", undefined, {subjectIds: "erina,moran", subjectMode: "all"})).map((slice) => slice.title)).toEqual(["双人登场"]);
    });
});

async function createProject(options: {open?: boolean} = {}): Promise<string> {
    const slug = `world-engine-api-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const projectPath = `workspace/${slug}`;
    const root = projectRoot(projectPath);
    await fs.mkdir(path.join(root, "world-engine", "schema"), {recursive: true});
    await fs.writeFile(path.join(root, "project.yaml"), "kind: novel\ntitle: World Engine API Test\nsummary: ''\n", "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "schema", "index.ts"), schemaSource(), "utf-8");
    await fs.writeFile(path.join(root, "world-engine", "calendar.ts"), calendarSource(), "utf-8");
    createdProjects.push(projectPath);
    if (options.open !== false) {
        await openProjectForTest(projectPath);
    }
    return projectPath;
}

async function callApi(
    handler: (event: unknown) => Promise<unknown>,
    projectPath: string,
    method: string,
    segments: string,
    body?: unknown,
    query: Record<string, unknown> = {},
): Promise<unknown> {
    return handler({
        method,
        path: `/api/projects/world-engine/${segments}`,
        query: {projectPath, ...query},
        body,
        context: {params: {segments}},
    });
}

function readSliceId(input: unknown): string {
    if (typeof input === "object" && input !== null && "sliceId" in input && typeof input.sliceId === "string") {
        return input.sliceId;
    }
    throw new Error("测试没有拿到 sliceId");
}

function readSubjectState(input: unknown, subjectId: string): {subjectId: string; attrs: Record<string, unknown>} {
    const subjects = readSubjects(input);
    const subject = subjects.find((item) => item.subjectId === subjectId);
    if (!subject) {
        throw new Error(`测试没有拿到 subject state：${subjectId}`);
    }
    return subject;
}

function readSubjects(input: unknown): Array<{subjectId: string; attrs: Record<string, unknown>}> {
    if (typeof input === "object" && input !== null && "subjects" in input && Array.isArray(input.subjects)) {
        return input.subjects as Array<{subjectId: string; attrs: Record<string, unknown>}>;
    }
    throw new Error("测试没有拿到 subjects");
}

function readSlices(input: unknown): Array<{title: string; summary: string; patches?: Array<{subjectId: string; path: string; op: string}>}> {
    if (Array.isArray(input)) {
        return input as Array<{title: string; summary: string; patches?: Array<{subjectId: string; path: string; op: string}>}>;
    }
    throw new Error("测试没有拿到 slices");
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

function projectRoot(projectPath: string): string {
    return path.join(resolveWorkspaceContainerRoot(), projectPath.slice("workspace/".length));
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
        "    }),",
        "    character: z.object({",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        events: z.array(z.string()).default([]).describe('经历'),",
        "        inventory: z.array(Ref('item')).unique().default([]).describe('背包'),",
        "    }),",
        "    item: z.object({",
        "        durability: z.number().int().default(100).describe('耐久'),",
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
