import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import {WorkspaceWriteConflictDtoSchema} from "nbook/shared/dto/workspace-file-conflict.dto";

const createdRoots: string[] = [];
const originalReadBody = (globalThis as typeof globalThis & {readBody?: unknown}).readBody;
const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const originalDefineRouteMeta = (globalThis as typeof globalThis & {defineRouteMeta?: unknown}).defineRouteMeta;
let readBodyMock: ReturnType<typeof vi.fn>;

describe("PUT /api/workspace-files/write", () => {
    beforeEach(() => {
        vi.resetModules();
        readBodyMock = vi.fn();
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: <THandler>(handler: THandler) => THandler;
            defineRouteMeta?: (meta: unknown) => void;
            readBody?: typeof readBodyMock;
        };
        globals.defineEventHandler = (handler) => handler;
        globals.defineRouteMeta = () => undefined;
        globals.readBody = readBodyMock;
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));
    });

    afterEach(async () => {
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: unknown;
            defineRouteMeta?: unknown;
            readBody?: unknown;
        };
        globals.defineEventHandler = originalDefineEventHandler;
        globals.defineRouteMeta = originalDefineRouteMeta;
        globals.readBody = originalReadBody;
        vi.doUnmock("nbook/server/utils/prisma");
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("真实文件版本变化时会返回写入冲突", async () => {
        const root = path.join(".agent", "workspace-write-conflict-test", randomUUID());
        const filePath = "note.md";
        createdRoots.push(root);
        await fs.mkdir(root, {recursive: true});
        await fs.writeFile(path.join(root, filePath), "共同基线\n", "utf-8");
        const baseNode = await statWorkspacePath(root, filePath);
        vi.doMock("nbook/server/workspace-files/novel-workspace", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/workspace-files/novel-workspace")>();
            return {
                ...actual,
                resolveWorkspaceRootInput: vi.fn(async () => root),
            };
        });

        await fs.writeFile(path.join(root, filePath), "真实文件\n", "utf-8");
        await fs.utimes(path.join(root, filePath), new Date(), new Date(baseNode.mtimeMs + 5000));
        readBodyMock.mockResolvedValue({
            projectPath: "workspace/test-project",
            path: filePath,
            content: "网页编辑\n",
            baseContent: "共同基线\n",
            expectedMtimeMs: baseNode.mtimeMs,
        });

        const handler = (await import("nbook/server/api/workspace-files/write.put")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: expect.objectContaining({
                kind: "workspace_write_conflict",
                path: filePath,
                localContent: "网页编辑\n",
                remoteContent: "真实文件\n",
            }),
        });

        try {
            await handler({} as never);
        } catch (error) {
            const parsed = WorkspaceWriteConflictDtoSchema.safeParse((error as {data?: unknown}).data);
            expect(parsed.success).toBe(true);
        }
    });

    it("Project root 未 open 时返回 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/workspace-files/novel-workspace", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/workspace-files/novel-workspace")>();
            return {
                ...actual,
                resolveWorkspaceRootInput: vi.fn(async () => "workspace/not-open"),
            };
        });
        readBodyMock.mockResolvedValue({
            projectPath: "workspace/not-open",
            path: "note.md",
            content: "不会写入\n",
        });

        const handler = (await import("nbook/server/api/workspace-files/write.put")).default;
        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath: "workspace/not-open",
            },
        });
    });
});
