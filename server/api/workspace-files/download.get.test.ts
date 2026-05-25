import {Readable} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/workspace-files/download", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("只按 projectPath 解析 Project Workspace，忽略 root 查询参数", async () => {
        const resolveNovelWorkspaceRoot = vi.fn(async () => "workspace/novel-1");
        const createWorkspaceZipStream = vi.fn(async () => ({
            root: "workspace/novel-1",
            filename: "novel-1.zip",
            stream: Readable.from([]),
        }));

        vi.stubGlobal("getQuery", () => ({
            projectPath: "workspace/novel-1",
            root: "server",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn((_event, stream) => stream),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveNovelWorkspaceRoot,
            ensureUserAssetsWorkspaceRoot: vi.fn(),
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
            USER_ASSETS_WORKSPACE_ROOT: "workspace/.nbook",
        }));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createWorkspaceZipStream,
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await handler({} as never);

        expect(resolveNovelWorkspaceRoot).toHaveBeenCalledWith("workspace/novel-1");
        expect(createWorkspaceZipStream).toHaveBeenCalledWith("workspace/novel-1");
    });

    it("缺少 projectPath 时拒绝下载", async () => {
        vi.stubGlobal("getQuery", () => ({
            root: "workspace/novel-1",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn(),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveNovelWorkspaceRoot: vi.fn(),
            ensureUserAssetsWorkspaceRoot: vi.fn(),
            USER_ASSETS_WORKSPACE_KIND: "user-assets",
            USER_ASSETS_WORKSPACE_ROOT: "workspace/.nbook",
        }));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createWorkspaceZipStream: vi.fn(),
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 400,
            message: "projectPath 不能为空",
        });
    });
});
