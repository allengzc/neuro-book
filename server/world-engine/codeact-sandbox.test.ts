/**
 * Phase 3: CodeAct Sandbox 测试
 */

import { describe, test, expect } from "bun:test";
import { executeCodeAct } from "./codeact-sandbox";
import type { WorldApi } from "./codeact-sandbox";

describe("CodeAct Sandbox", () => {
    describe("基础执行", () => {
        test("执行简单代码", async () => {
            const mockApi = createMockWorldApi({
                async get() { return { hp: 100 }; },
            });

            const result = await executeCodeAct("return 1 + 1", mockApi);
            expect(result).toBe(2);
        });

        test("可以访问 world API", async () => {
            const mockApi = createMockWorldApi({
                async get(id: string) {
                    return id === "test" ? { hp: 100 } : null;
                },
            });

            const result = await executeCodeAct(
                `const data = await world.get("test"); return data.hp;`,
                mockApi,
            );
            expect(result).toBe(100);
        });

        test("支持 async/await", async () => {
            const mockApi = createMockWorldApi({
                async list() { return [{ id: "a", name: "A" }]; },
            });

            const result = await executeCodeAct(
                `const items = await world.list("character"); return items.length;`,
                mockApi,
            );
            expect(result).toBe(1);
        });
    });

    describe("安全限制", () => {
        test("异步代码超时限制", async () => {
            const mockApi = createMockWorldApi();

            await expect(
                executeCodeAct(
                    "await new Promise((resolve) => setTimeout(resolve, 200)); return 'done';",
                    mockApi,
                    { timeout: 50 },
                ),
            ).rejects.toThrow("执行超时");
        });

        test("结果大小限制", async () => {
            const mockApi = createMockWorldApi();

            await expect(
                executeCodeAct(
                    "return Array(10000).fill('x').join('')",
                    mockApi,
                    { maxResultSize: 100 },
                ),
            ).rejects.toThrow("查询结果超过");
        });
    });

    describe("允许的内置对象", () => {
        test("可以使用 Math", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct("return Math.sqrt(16)", mockApi);
            expect(result).toBe(4);
        });

        test("可以使用 JSON", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct(
                'return JSON.parse(\'{"a": 1}\')',
                mockApi,
            );
            expect(result).toEqual({ a: 1 });
        });

        test("可以使用 Array/Object", async () => {
            const mockApi = createMockWorldApi();

            const result = await executeCodeAct(
                "return Object.keys({ a: 1, b: 2 })",
                mockApi,
            );
            expect(result).toEqual(["a", "b"]);
        });
    });
});

function createMockWorldApi(overrides: Partial<WorldApi> = {}): WorldApi {
    return {
        async get() { return null; },
        async getMany() { return []; },
        async list() { return []; },
        async findRefs() { return []; },
        async searchText() { return []; },
        async slices() { return []; },
        async getSlice() { return null; },
        parseTime() { return BigInt(0); },
        formatTime(instant: bigint) { return instant.toString(); },
        now() { return BigInt(0); },
        ...overrides,
    };
}
