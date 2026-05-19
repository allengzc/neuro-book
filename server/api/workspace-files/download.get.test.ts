import {Readable} from "node:stream";
import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/workspace-files/download", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("只按 novelId 解析 workspace，忽略 root 查询参数", async () => {
        const resolveNovelWorkspaceRoot = vi.fn(async () => "workspace/novel-1");
        const createWorkspaceZipStream = vi.fn(async () => ({
            root: "workspace/novel-1",
            filename: "novel-1.zip",
            stream: Readable.from([]),
        }));

        vi.stubGlobal("getQuery", () => ({
            novelId: "1",
            root: "server",
        }));
        vi.doMock("h3", () => ({
            createError: (input: {statusCode?: number; message?: string}) => Object.assign(new Error(input.message), input),
            sendStream: vi.fn((_event, stream) => stream),
            setResponseHeader: vi.fn(),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveNovelWorkspaceRoot,
        }));
        vi.doMock("nbook/server/workspace-files/workspace-archive", () => ({
            createWorkspaceZipStream,
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/download.get")).default;
        await handler({} as never);

        expect(resolveNovelWorkspaceRoot).toHaveBeenCalledWith({}, "1");
        expect(createWorkspaceZipStream).toHaveBeenCalledWith("workspace/novel-1");
    });

    it("缺少 novelId 时拒绝下载", async () => {
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
            message: "novelId 不能为空",
        });
    });
});
