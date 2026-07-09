import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/config/profile-home/reset", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("defineRouteMeta", () => undefined);
    });

    it("Project 未 open 时返回稳定 PROJECT_NOT_OPEN", async () => {
        vi.doMock("h3", async (importOriginal) => {
            const actual = await importOriginal<typeof import("h3")>();
            return {
                ...actual,
                getQuery: vi.fn(() => ({
                    workspaceKind: "novel",
                    projectPath: "workspace/config-route-not-open",
                })),
            };
        });
        vi.doMock("nbook/server/utils/novel-chapter", async (importOriginal) => {
            const actual = await importOriginal<typeof import("nbook/server/utils/novel-chapter")>();
            return {
                ...actual,
                validateBody: vi.fn(async () => ({profileKey: "writer"})),
            };
        });
        vi.doMock("nbook/server/config/query", () => ({
            validateConfigEditorSnapshotQuery: vi.fn(() => ({
                workspaceKind: "novel",
                projectPath: "workspace/config-route-not-open",
            })),
        }));
        vi.doMock("nbook/server/config/config-service", async () => {
            const {ProjectNotOpenError} = await import("nbook/server/workspace-files/project-session");
            return {
                resetProjectProfileHome: vi.fn(async () => {
                    throw new ProjectNotOpenError("workspace/config-route-not-open");
                }),
            };
        });

        const handler = (await import("nbook/server/api/config/profile-home/reset.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath: "workspace/config-route-not-open",
            },
        });
    });
});
