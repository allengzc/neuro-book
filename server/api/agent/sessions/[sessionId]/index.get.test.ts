import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/agent/sessions/:sessionId", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("Project 未 open 时返回稳定 PROJECT_NOT_OPEN", async () => {
        vi.doMock("nbook/server/agent/http", async () => {
            const {ProjectNotOpenError} = await import("nbook/server/workspace-files/project-session");
            return {
                requireAgentSessionId: vi.fn(() => 12),
                getAgentSessionSnapshot: vi.fn(async () => {
                    throw new ProjectNotOpenError("workspace/session-route-not-open");
                }),
            };
        });
        vi.doMock("nbook/server/utils/server-timing", () => ({
            createServerTiming: vi.fn(() => ({
                mark: vi.fn(),
            })),
        }));

        const handler = (await import("nbook/server/api/agent/sessions/[sessionId]/index.get")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 409,
            data: {
                code: "PROJECT_NOT_OPEN",
                projectPath: "workspace/session-route-not-open",
            },
        });
    });
});
