/**
 * CodeAct Integration Tests
 *
 * 测试完整的 World Engine + CodeAct 查询流程。
 */

import {afterAll, afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
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

    afterAll(() => {
        for (const projectPath of createdProjects) {
            const projectRoot = join(
                resolveWorkspaceContainerRoot(),
                projectPath.slice("workspace/".length),
            );
            rmSync(projectRoot, {recursive: true, force: true});
        }
        createdProjects.splice(0);
    });

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
