/**
 * CodeAct Integration Tests
 *
 * 测试完整的 World Engine + CodeAct 查询流程。
 */

import {afterAll, afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdirSync, writeFileSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {resolveWorkspaceContainerRoot} from "nbook/server/workspace-files/workspace-assets-root";
import {WorldEngineFacade} from "./world-engine.facade";

const createdProjects: string[] = [];

describe("CodeAct Integration", () => {
    let facade: WorldEngineFacade;
    let testProjectPath: string;

    beforeEach(async () => {
        const slug = `codeact-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        testProjectPath = `workspace/${slug}`;
        const projectRoot = join(resolveWorkspaceContainerRoot(), slug);

        mkdirSync(join(projectRoot, "world-engine/schema"), {recursive: true});

        writeFileSync(
            join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: CodeAct Test\nsummary: ''\n",
            "utf-8",
        );
        writeFileSync(join(projectRoot, "world-engine/schema/index.ts"), zodSchemaFixture(), "utf-8");
        writeFileSync(join(projectRoot, "world-engine/calendar.ts"), calendarFixture(), "utf-8");

        createdProjects.push(testProjectPath);
        facade = new WorldEngineFacade();
    });

    afterEach(async () => {
        await facade.closeProject(testProjectPath);
    });

    afterAll(async () => {
        for (const projectPath of createdProjects) {
            const projectRoot = join(
                resolveWorkspaceContainerRoot(),
                projectPath.slice("workspace/".length),
            );
            await removeProjectRoot(projectRoot);
        }
        createdProjects.splice(0);
    }, 30_000);

    test("Execute simple query with world.get()", async () => {
        const createResult = await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        expect(createResult.subjectId).toBe("hero");

        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1001),
            title: "设置英雄属性",
            patches: [
                {subjectId: "hero", path: "/name", op: "replace", value: "张三"},
                {subjectId: "hero", path: "/hp", op: "replace", value: 100},
                {subjectId: "hero", path: "/level", op: "replace", value: 1},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const hero = await world.get("hero");
            return hero;
        `);

        expect(result).toEqual({
            name: "张三",
            hp: 100,
            level: 1,
            inventory: [],
        });
    });

    test("Execute query with deref", async () => {
        await facade.createSubject(testProjectPath, {
            id: "village",
            type: "location",
            name: "新手村",
            at: BigInt(1000),
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1001),
            title: "设置地点属性",
            patches: [
                {subjectId: "village", path: "/name", op: "replace", value: "新手村"},
                {subjectId: "village", path: "/description", op: "replace", value: "冒险开始的地方"},
            ],
        });

        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1002),
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1003),
            title: "到达新手村",
            patches: [
                {subjectId: "hero", path: "/name", op: "replace", value: "张三"},
                {subjectId: "hero", path: "/hp", op: "replace", value: 100},
                {subjectId: "hero", path: "/level", op: "replace", value: 1},
                {subjectId: "hero", path: "/location", op: "replace", value: "subject://village"},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const hero = await world.get("hero", { deref: true });
            return hero;
        `);

        expect(result).toMatchObject({
            name: "张三",
            hp: 100,
            level: 1,
            inventory: [],
            location: {
                __ref: "subject://village",
                name: "新手村",
                description: "冒险开始的地方",
            },
        });
    });

    test("findRefs 返回 JSON Pointer 路径", async () => {
        await facade.createSubject(testProjectPath, {
            id: "village",
            type: "location",
            name: "新手村",
            at: BigInt(1000),
        });
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1001),
        });
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1002),
            title: "到达新手村",
            patches: [
                {subjectId: "hero", path: "/location", op: "replace", value: "subject://village"},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            return await world.findRefs("village", "character");
        `);

        expect(result).toEqual([{subjectId: "hero", attr: "/location"}]);
    });

    test("slices withPatches 返回 patchId", async () => {
        await facade.writeSlice(testProjectPath, {
            instant: BigInt(1000),
            title: "英雄登场",
            patches: [
                {subjectId: "hero", type: "character", name: "英雄", path: "/hp", op: "replace", value: 90},
            ],
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const slices = await world.slices({withPatches: true});
            return slices.map((slice) => ({
                title: slice.title,
                patchId: slice.patches.find((patch) => patch.path === "/hp").patchId,
            }));
        `);

        expect(result).toEqual([{title: "英雄登场", patchId: expect.any(String)}]);
    });

    test("Failed code rejects", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        await expect(
            facade.executeCodeActQuery(testProjectPath, `
                const hero = await world.get("hero");
                return hero.name + (;
            `),
        ).rejects.toThrow();
    });

    test("Execute query with world.list()", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero1",
            type: "character",
            name: "英雄1",
            at: BigInt(1000),
        });
        await facade.createSubject(testProjectPath, {
            id: "hero2",
            type: "character",
            name: "英雄2",
            at: BigInt(1001),
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const characters = await world.list("character");
            return characters;
        `);

        expect(result).toEqual([
            {id: "hero1", name: "英雄1", type: "character"},
            {id: "hero2", name: "英雄2", type: "character"},
        ]);
    });

    test("Execute query with world.now()", async () => {
        await facade.createSubject(testProjectPath, {
            id: "hero",
            type: "character",
            name: "英雄",
            at: BigInt(1000),
        });

        const result = await facade.executeCodeActQuery(testProjectPath, `
            const currentTime = world.now();
            return currentTime;
        `);

        expect(typeof result).toBe("bigint");
        expect(result).toBeGreaterThanOrEqual(BigInt(1000));
    });

    test("executeCodeActWorld 读写合一并统一返回 issues", async () => {
        const result = await facade.executeCodeActWorld(testProjectPath, `
            const time = world.parseTime("测试纪元1日 00:20:00");
            const written = await world.writeSlice({
                time,
                title: "英雄登场",
                patches: [
                    {subjectId: "hero", type: "character", name: "英雄", path: "/hp", op: "replace", value: 88},
                ],
            });
            const hero = await world.get("hero");
            const slice = await world.getSlice(written.sliceId);
            return {
                hp: hero.hp,
                formatted: world.formatTime(time),
                patchId: slice.patches.find((patch) => patch.path === "/hp").patchId,
            };
        `, "readwrite");

        expect(result).toEqual({
            data: {
                hp: 88,
                formatted: "测试纪元1日 00:20:00",
                patchId: expect.any(String),
            },
            issues: [],
        });
    });

    test("executeCodeActWorld editMutations 精确修正 patch", async () => {
        const result = await facade.executeCodeActWorld(testProjectPath, `
            const written = await world.writeSlice({
                time: world.parseTime("测试纪元1日 00:21:00"),
                title: "误写 HP",
                patches: [
                    {subjectId: "hero", type: "character", name: "英雄", path: "/HP", op: "replace", value: 77},
                ],
            });
            const before = await world.getSlice(written.sliceId);
            const wrong = before.patches.find((patch) => patch.path === "/HP");
            await world.editMutations(written.sliceId, [
                {patchId: wrong.patchId, set: {path: "/hp", summary: "修正 hp 路径"}},
            ]);
            const after = await world.getSlice(written.sliceId);
            const hero = await world.get("hero");
            return {
                hp: hero.hp,
                beforePatchId: wrong.patchId,
                afterPatchId: after.patches.find((patch) => patch.summary === "修正 hp 路径").patchId,
                path: after.patches.find((patch) => patch.summary === "修正 hp 路径").path,
            };
        `, "readwrite");

        expect(result).toEqual({
            data: {
                hp: 77,
                beforePatchId: expect.any(String),
                afterPatchId: expect.any(String),
                path: "/hp",
            },
            issues: [],
        });
        const data = result.data as {beforePatchId: string; afterPatchId: string};
        expect(data.afterPatchId).not.toBe(data.beforePatchId);
    });

    test("executeCodeActWorld throw 后回滚写入", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            await world.writeSlice({
                time: world.parseTime("测试纪元1日 00:22:00"),
                title: "应回滚",
                patches: [
                    {subjectId: "rollback", type: "character", name: "回滚者", path: "/hp", op: "replace", value: 1},
                ],
            });
            throw new Error("主动回滚");
        `, "readwrite")).rejects.toThrow("主动回滚");

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const subjects = await world.list("character");
            return subjects.map((subject) => subject.id);
        `, "readonly");

        expect(result).toEqual({data: [], issues: []});
    });

    test("executeCodeActWorld 超时后回滚写入", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            await world.writeSlice({
                time: world.parseTime("测试纪元1日 00:23:00"),
                title: "超时回滚",
                patches: [
                    {subjectId: "timeout-rollback", type: "character", name: "超时者", path: "/hp", op: "replace", value: 1},
                ],
            });
            await new Promise((resolve) => setTimeout(resolve, 200));
            return "done";
        `, "readwrite", {timeout: 50})).rejects.toThrow("执行超时");

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const subjects = await world.list("character");
            return subjects.map((subject) => subject.id);
        `, "readonly");

        expect(result).toEqual({data: [], issues: []});
    });

    test("executeCodeActWorld 超时关闭事务后后台写入不能落库", async () => {
        await expect(facade.executeCodeActWorld(testProjectPath, `
            setTimeout(async () => {
                try {
                    await world.writeSlice({
                        time: world.parseTime("测试纪元1日 00:24:00"),
                        title: "后台写入应失败",
                        patches: [
                            {subjectId: "late-timeout-write", type: "character", name: "迟到写入", path: "/hp", op: "replace", value: 1},
                        ],
                    });
                } catch {
                    // 预期：外层超时后事务已关闭，后台写入会失败。
                }
            }, 100);
            await new Promise((resolve) => setTimeout(resolve, 250));
            return "done";
        `, "readwrite", {timeout: 50})).rejects.toThrow("执行超时");

        await new Promise((resolve) => setTimeout(resolve, 250));

        const result = await facade.executeCodeActWorld(testProjectPath, `
            const subjects = await world.list("character");
            return subjects.map((subject) => subject.id);
        `, "readonly");

        expect(result).toEqual({data: [], issues: []});
    });
});

function zodSchemaFixture(): string {
    return [
        'import {z} from "zod";',
        "",
        "function Ref(targetType: string) {",
        "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
        "}",
        "",
        "export const WorldSchema = {",
        "    character: z.object({",
        "        name: z.string().optional().describe('姓名'),",
        "        hp: z.number().int().default(100).describe('生命值'),",
        "        level: z.number().int().default(1).describe('等级'),",
        "        inventory: z.array(z.string()).default([]).describe('背包'),",
        "        location: Ref('location').optional().describe('当前位置'),",
        "    }),",
        "    location: z.object({",
        "        name: z.string().optional().describe('地点名称'),",
        "        description: z.string().optional().describe('地点描述'),",
        "    }),",
        "} as const;",
        "",
    ].join("\n");
}

function calendarFixture(): string {
    return [
        "export default {",
        "    type: 'simple',",
        "    eraBefore: '测试纪元',",
        "    eraAfter: '测试纪元',",
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

async function removeProjectRoot(projectRoot: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await rm(projectRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}
