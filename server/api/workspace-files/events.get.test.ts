import {beforeEach, describe, expect, it, vi} from "vitest";

/**
 * 等待 handler 跑过已经 resolve 的异步准备阶段。
 */
async function flushAsyncTasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GET /api/workspace-files/events", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("getQuery", () => ({
            projectPath: "workspace/novel-1",
        }));
    });

    it("客户端在订阅建立期间关闭时会在订阅返回后立刻清理", async () => {
        let closeHandler: (() => void) | null = null;
        const unsubscribe = vi.fn();
        let resolveSubscribe: ((value: () => void) => void) | null = null;
        const subscribePromise = new Promise<() => void>((resolve) => {
            resolveSubscribe = resolve;
        });
        const eventStream = {
            push: vi.fn(async () => {}),
            send: vi.fn(async () => "sent"),
            close: vi.fn(async () => {}),
            onClosed: vi.fn((handler: () => void) => {
                closeHandler = handler;
            }),
        };

        vi.doMock("h3", () => ({
            createEventStream: vi.fn(() => eventStream),
        }));
        vi.doMock("nbook/server/workspace-files/novel-workspace", () => ({
            resolveWorkspaceRootInput: vi.fn(async () => "workspace/novel-1"),
        }));
        vi.doMock("nbook/server/workspace-files/workspace-file-events", () => ({
            subscribeWorkspaceFileEvents: vi.fn(() => subscribePromise),
        }));
        vi.doMock("nbook/server/utils/prisma", () => ({
            prisma: {},
        }));

        const handler = (await import("nbook/server/api/workspace-files/events.get")).default;
        const resultPromise = handler({} as never);
        await flushAsyncTasks();

        expect(eventStream.onClosed).toHaveBeenCalledTimes(1);
        closeHandler?.();
        expect(unsubscribe).not.toHaveBeenCalled();

        resolveSubscribe?.(unsubscribe);
        await expect(resultPromise).resolves.toBe("sent");

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(eventStream.close).toHaveBeenCalledTimes(1);
    });
});
