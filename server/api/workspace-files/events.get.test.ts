import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

type WorkspaceFileEventsHandlerFactory = typeof import("nbook/server/api/workspace-files/events.get")["createWorkspaceFileEventsHandler"];

type TestEventStream = {
    push: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onClosed: ReturnType<typeof vi.fn>;
};

let createWorkspaceFileEventsHandler: WorkspaceFileEventsHandlerFactory;

/**
 * 等待 handler 跑过已经 resolve 的异步准备阶段。
 */
async function flushAsyncTasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GET /api/workspace-files/events", () => {
    beforeAll(async () => {
        globalThis.defineEventHandler = (handler: unknown) => handler;
        ({createWorkspaceFileEventsHandler} = await import("nbook/server/api/workspace-files/events.get"));
    });

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.getQuery = () => ({
            projectPath: "workspace/novel-1",
        });
    });

    it("客户端在订阅建立期间关闭时会在订阅返回后立刻清理", async () => {
        let closeHandler: (() => void) | null = null;
        const unsubscribe = vi.fn();
        let resolveSubscribe: ((value: () => void) => void) | null = null;
        const subscribePromise = new Promise<() => void>((resolve) => {
            resolveSubscribe = resolve;
        });
        const eventStream = createEventStreamMock({
            onClosed: vi.fn((handler: () => void) => {
                closeHandler = handler;
            }),
        });
        const handler = createWorkspaceFileEventsHandler({
            createEventStream: vi.fn(() => eventStream) as never,
            resolveWorkspaceRootInput: vi.fn(async () => "workspace/novel-1") as never,
            subscribeWorkspaceTreeIndex: vi.fn(() => subscribePromise) as never,
        });

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

    it("订阅创建本身不会等待 watcher ready 之后才发送 SSE 响应", async () => {
        const eventStream = createEventStreamMock();
        const handler = createWorkspaceFileEventsHandler({
            createEventStream: vi.fn(() => eventStream) as never,
            resolveWorkspaceRootInput: vi.fn(async () => "workspace/novel-1") as never,
            subscribeWorkspaceTreeIndex: vi.fn(async () => vi.fn()) as never,
        });

        await expect(handler({} as never)).resolves.toBe("sent");

        expect(eventStream.send).toHaveBeenCalledTimes(1);
    });

    it("客户端断开导致 push closed-stream 错误时会清理订阅", async () => {
        const unsubscribe = vi.fn();
        let subscribedHandler: ((payload: unknown) => Promise<void>) | null = null;
        const eventStream = createEventStreamMock({
            push: vi.fn(async () => {
                throw new TypeError("stream is closing or closed");
            }),
        });
        const handler = createWorkspaceFileEventsHandler({
            createEventStream: vi.fn(() => eventStream) as never,
            resolveWorkspaceRootInput: vi.fn(async () => "workspace/novel-1") as never,
            subscribeWorkspaceTreeIndex: vi.fn(async (_options: unknown, indexHandler: (payload: unknown) => Promise<void>) => {
                subscribedHandler = indexHandler;
                return unsubscribe;
            }) as never,
        });

        await expect(handler({} as never)).resolves.toBe("sent");

        await expect(subscribedHandler?.({
            type: "workspace_files_changed",
            root: "workspace/novel-1",
            sequence: 1,
            revision: 2,
            validatedAt: "2026-05-28T00:00:00.000Z",
            changedAt: "2026-05-28T00:00:00.000Z",
            events: [],
        })).resolves.toBeUndefined();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("会把 index 更新事件原样推送给前端", async () => {
        let subscribedHandler: ((payload: unknown) => Promise<void>) | null = null;
        const eventStream = createEventStreamMock();
        const handler = createWorkspaceFileEventsHandler({
            createEventStream: vi.fn(() => eventStream) as never,
            resolveWorkspaceRootInput: vi.fn(async () => "workspace/novel-1") as never,
            subscribeWorkspaceTreeIndex: vi.fn(async (_options: unknown, indexHandler: (payload: unknown) => Promise<void>) => {
                subscribedHandler = indexHandler;
                return vi.fn();
            }) as never,
        });

        await expect(handler({} as never)).resolves.toBe("sent");

        await subscribedHandler?.({
            type: "workspace_files_changed",
            root: "workspace/novel-1",
            sequence: 3,
            revision: 5,
            validatedAt: "2026-05-30T00:00:00.000Z",
            changedAt: "2026-05-30T00:00:01.000Z",
            events: [{kind: "add", path: "reference/silly-tavern/card.md"}],
        });

        expect(eventStream.push).toHaveBeenCalledWith({
            event: "workspace_files_changed",
            data: JSON.stringify({
                type: "workspace_files_changed",
                root: "workspace/novel-1",
                sequence: 3,
                revision: 5,
                validatedAt: "2026-05-30T00:00:00.000Z",
                changedAt: "2026-05-30T00:00:01.000Z",
                events: [{kind: "add", path: "reference/silly-tavern/card.md"}],
            }),
        });
    });
});

function createEventStreamMock(overrides: Partial<TestEventStream> = {}): TestEventStream {
    return {
        push: vi.fn(async () => {}),
        send: vi.fn(async () => "sent"),
        close: vi.fn(async () => {}),
        onClosed: vi.fn(),
        ...overrides,
    };
}
