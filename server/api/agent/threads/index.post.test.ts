import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it("创建 leader 后会返回对应摘要 DTO", async () => {
        const agentSystem = {
            createLeaderThread: vi.fn(async () => ({id: "thread-1"})),
            listThreads: vi.fn(async () => [{
                id: "thread-1",
                kind: "leader",
                profileKey: "leader.default",
                title: "线程",
                summary: "摘要",
                status: "idle",
                lastMessageAt: new Date("2026-04-05T00:00:00.000Z"),
            }]),
        };
        const toAgentThreadSummaryDto = vi.fn((thread) => ({
            ...thread,
            mapped: true,
        }));

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({title: "线程"})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadSummaryDto,
        }));

        const handler = (await import("nbook/server/api/agent/threads/index.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.createLeaderThread).toHaveBeenCalledWith({title: "线程"});
        expect(agentSystem.listThreads).toHaveBeenCalledWith({
            kind: "leader",
            profileKey: "leader.default",
        });
        expect(result).toMatchObject({
            id: "thread-1",
            mapped: true,
        });
    });

    it("创建用户资产 leader 时会按 profileKey 查询摘要", async () => {
        const agentSystem = {
            createLeaderThread: vi.fn(async () => ({id: "thread-assets"})),
            listThreads: vi.fn(async () => [{
                id: "thread-assets",
                kind: "leader",
                profileKey: "leader.assets",
                title: "用户资产",
                summary: "摘要",
                status: "idle",
                lastMessageAt: new Date("2026-04-05T00:00:00.000Z"),
            }]),
        };

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({title: "用户资产", profileKey: "leader.assets"})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadSummaryDto: vi.fn((thread) => thread),
        }));

        const handler = (await import("nbook/server/api/agent/threads/index.post")).default;
        await handler({} as never);

        expect(agentSystem.createLeaderThread).toHaveBeenCalledWith({
            title: "用户资产",
            profileKey: "leader.assets",
        });
        expect(agentSystem.listThreads).toHaveBeenCalledWith({
            kind: "leader",
            profileKey: "leader.assets",
        });
    });

    it("创建后找不到摘要时会抛 500", async () => {
        const agentSystem = {
            createLeaderThread: vi.fn(async () => ({id: "thread-1"})),
            listThreads: vi.fn(async () => []),
        };

        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async () => ({title: "线程"})),
        }));
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
            toAgentThreadSummaryDto: vi.fn(),
        }));

        const handler = (await import("nbook/server/api/agent/threads/index.post")).default;

        await expect(handler({} as never)).rejects.toMatchObject({
            statusCode: 500,
            message: "创建线程后未找到摘要",
        });
    });
});
