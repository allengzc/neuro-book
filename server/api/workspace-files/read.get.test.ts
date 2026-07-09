import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/workspace-files/read", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
        vi.stubGlobal("getQuery", () => ({
            projectPath: "workspace/not-open",
            path: "note.md",
        }));
    });

    it("Project root 未 open 时返回 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceRootInput: vi.fn(async () => "workspace/not-open"),
        }));

        const handler = (await import("nbook/server/api/workspace-files/read.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath: "workspace/not-open",
            },
        });
    });
});
