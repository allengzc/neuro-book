import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/projects/rag/overview", {timeout: 30_000}, () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
    });

    it("Project 未 open 时返回稳定 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/utils/novel-chapter", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/utils/novel-chapter")>();
            return {
                ...actual,
                requireProjectPathQuery: vi.fn(() => "workspace/rag-not-open"),
            };
        });

        const handler = (await import("nbook/server/api/projects/rag/overview.get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath: "workspace/rag-not-open",
            },
        });
    });
});
