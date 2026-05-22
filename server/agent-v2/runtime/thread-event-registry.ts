import type {AgentStreamEvent, ThreadId} from "nbook/server/agent/types";

type QueueItem = IteratorResult<AgentStreamEvent>;

/**
 * 简单异步队列。
 * 只负责把未来事件广播给订阅者；首帧快照由 API route 单独构造。
 */
class AsyncEventQueue implements AsyncIterable<AgentStreamEvent>, AsyncIterator<AgentStreamEvent> {
    private readonly buffered: QueueItem[] = [];
    private readonly waiting: Array<(item: QueueItem) => void> = [];
    private ended = false;

    /**
     * 推入一条事件。
     */
    push(event: AgentStreamEvent): void {
        if (this.ended) {
            return;
        }
        const item: QueueItem = {done: false, value: event};
        const resolver = this.waiting.shift();
        if (resolver) {
            resolver(item);
            return;
        }
        this.buffered.push(item);
    }

    /**
     * 结束当前订阅。
     */
    close(): void {
        if (this.ended) {
            return;
        }
        this.ended = true;
        const item: QueueItem = {done: true, value: undefined};
        for (const resolver of this.waiting.splice(0)) {
            resolver(item);
        }
    }

    next(): Promise<QueueItem> {
        const nextItem = this.buffered.shift();
        if (nextItem) {
            return Promise.resolve(nextItem);
        }
        if (this.ended) {
            return Promise.resolve({done: true, value: undefined});
        }
        return new Promise<QueueItem>((resolve) => {
            this.waiting.push(resolve);
        });
    }

    async return(): Promise<QueueItem> {
        this.close();
        return {done: true, value: undefined};
    }

    [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent> {
        return this;
    }
}

type ThreadEventChannel = {
    subscribers: Set<AsyncEventQueue>;
};

/**
 * Thread 级事件总线。
 * 首帧由调用方自行构造，这里只负责广播“订阅之后”的未来事件。
 */
export class ThreadEventRegistry {
    private readonly channels = new Map<ThreadId, ThreadEventChannel>();

    /**
     * 发布一条 thread 事件。
     */
    publish(threadId: ThreadId, event: AgentStreamEvent): void {
        const channel = this.getOrCreateChannel(threadId);
        for (const subscriber of channel.subscribers) {
            subscriber.push(event);
        }
    }

    /**
     * 订阅未来事件。
     */
    subscribe(threadId: ThreadId): AsyncIterable<AgentStreamEvent> {
        const channel = this.getOrCreateChannel(threadId);
        const queue = new AsyncEventQueue();
        channel.subscribers.add(queue);

        const self = this;
        return {
            [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent> {
                const iterator = queue[Symbol.asyncIterator]();
                return {
                    async next() {
                        return iterator.next();
                    },
                    async return() {
                        channel.subscribers.delete(queue);
                        const result = iterator.return
                            ? await iterator.return()
                            : {done: true as const, value: undefined};
                        self.cleanupChannel(threadId);
                        return result;
                    },
                };
            },
        };
    }

    /**
     * 在 thread 不再需要时尝试清理空 channel。
     */
    cleanup(threadId: ThreadId): void {
        this.cleanupChannel(threadId);
    }

    private getOrCreateChannel(threadId: ThreadId): ThreadEventChannel {
        const existing = this.channels.get(threadId);
        if (existing) {
            return existing;
        }
        const created: ThreadEventChannel = {
            subscribers: new Set(),
        };
        this.channels.set(threadId, created);
        return created;
    }

    private cleanupChannel(threadId: ThreadId): void {
        const channel = this.channels.get(threadId);
        if (!channel) {
            return;
        }
        if (channel.subscribers.size > 0) {
            return;
        }
        this.channels.delete(threadId);
    }
}
