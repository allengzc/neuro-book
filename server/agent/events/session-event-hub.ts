import {randomUUID} from "node:crypto";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";

const DEFAULT_REPLAY_LIMIT = 500;
const DEFAULT_REPLAY_BYTE_LIMIT = 4 * 1024 * 1024;
const DEFAULT_PINNED_REPLAY_BYTE_LIMIT = 16 * 1024 * 1024;
const DEFAULT_SUBSCRIBER_QUEUE_LIMIT = 500;
const DEFAULT_SUBSCRIBER_QUEUE_BYTE_LIMIT = 2 * 1024 * 1024;

export type AgentSessionEventCursor = {
    eventEpoch?: string;
    after?: number;
};

export type AgentSessionEventHubOptions = {
    replayLimit?: number;
    replayByteLimit?: number;
    pinnedReplayByteLimit?: number;
    subscriberQueueLimit?: number;
    subscriberQueueByteLimit?: number;
};

type Subscriber = {
    push(event: AgentSessionEventDto): void;
    close(): void;
};

class SessionEventSubscription implements AsyncIterable<AgentSessionEventDto>, AsyncIterator<AgentSessionEventDto>, Subscriber {
    private readonly queue: IteratorResult<AgentSessionEventDto>[] = [];
    private readonly maxQueueLength: number;
    private readonly maxQueueBytes: number;
    private resolver: ((value: IteratorResult<AgentSessionEventDto>) => void) | null = null;
    private closed = false;
    private queuedBytes = 0;

    constructor(input: {maxQueueLength: number; maxQueueBytes: number}) {
        this.maxQueueLength = input.maxQueueLength;
        this.maxQueueBytes = input.maxQueueBytes;
    }

    push(event: AgentSessionEventDto): void {
        if (this.closed) {
            return;
        }
        if (!this.resolver && this.wouldOverflow(event)) {
            this.queue.splice(0, this.queue.length);
            this.queuedBytes = 0;
            this.enqueue({
                done: false,
                value: {
                    eventEpoch: event.eventEpoch,
                    seq: event.seq,
                    sessionId: event.sessionId,
                    invocationId: event.invocationId,
                    kind: "session",
                    event: {
                        type: "snapshot_required",
                        reason: "event subscriber queue overflowed",
                    },
                },
            });
            return;
        }
        this.enqueue({done: false, value: event});
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.enqueue({done: true, value: undefined});
    }

    async next(): Promise<IteratorResult<AgentSessionEventDto>> {
        const item = this.queue.shift();
        if (item) {
            this.queuedBytes = Math.max(0, this.queuedBytes - eventBytes(item));
            return item;
        }
        if (this.closed) {
            return {done: true, value: undefined};
        }
        return new Promise((resolve) => {
            this.resolver = resolve;
        });
    }

    async return(): Promise<IteratorResult<AgentSessionEventDto>> {
        this.close();
        return {done: true, value: undefined};
    }

    [Symbol.asyncIterator](): AsyncIterator<AgentSessionEventDto> {
        return this;
    }

    private enqueue(item: IteratorResult<AgentSessionEventDto>): void {
        if (this.resolver) {
            const resolve = this.resolver;
            this.resolver = null;
            resolve(item);
            return;
        }
        this.queue.push(item);
        this.queuedBytes += eventBytes(item);
    }

    private wouldOverflow(event: AgentSessionEventDto): boolean {
        return this.queue.length >= this.maxQueueLength || this.queuedBytes + estimateEventBytes(event) > this.maxQueueBytes;
    }
}

/**
 * session 级事件中心。第一版只做单进程内存广播和 bounded replay。
 */
export class AgentSessionEventHub {
    readonly eventEpoch = randomUUID();
    private readonly replayLimit: number;
    private readonly replayByteLimit: number;
    private readonly pinnedReplayByteLimit: number;
    private readonly subscriberQueueLimit: number;
    private readonly subscriberQueueByteLimit: number;
    private readonly replayBySession = new Map<number, AgentSessionEventDto[]>();
    private readonly replayBytesBySession = new Map<number, number>();
    private readonly subscribersBySession = new Map<number, Set<Subscriber>>();
    private readonly seqBySession = new Map<number, number>();
    private readonly replayPinFirstSeqBySession = new Map<number, number>();

    constructor(options: number | AgentSessionEventHubOptions = DEFAULT_REPLAY_LIMIT) {
        const normalizedOptions = typeof options === "number" ? {replayLimit: options} : options;
        this.replayLimit = normalizedOptions.replayLimit ?? DEFAULT_REPLAY_LIMIT;
        this.replayByteLimit = normalizedOptions.replayByteLimit ?? DEFAULT_REPLAY_BYTE_LIMIT;
        this.pinnedReplayByteLimit = normalizedOptions.pinnedReplayByteLimit ?? DEFAULT_PINNED_REPLAY_BYTE_LIMIT;
        this.subscriberQueueLimit = normalizedOptions.subscriberQueueLimit ?? DEFAULT_SUBSCRIBER_QUEUE_LIMIT;
        this.subscriberQueueByteLimit = normalizedOptions.subscriberQueueByteLimit ?? DEFAULT_SUBSCRIBER_QUEUE_BYTE_LIMIT;
    }

    /**
     * 给事件分配 session 内递增序号并广播。
     */
    publish(event: Omit<AgentSessionEventDto, "seq" | "eventEpoch">): AgentSessionEventDto {
        const seq = this.lastSeq(event.sessionId) + 1;
        this.seqBySession.set(event.sessionId, seq);
        const nextEvent = {
            ...event,
            eventEpoch: this.eventEpoch,
            seq,
        } as AgentSessionEventDto;
        const replay = this.replayBySession.get(nextEvent.sessionId) ?? [];
        replay.push(nextEvent);
        this.replayBySession.set(nextEvent.sessionId, replay);
        this.replayBytesBySession.set(nextEvent.sessionId, (this.replayBytesBySession.get(nextEvent.sessionId) ?? 0) + estimateEventBytes(nextEvent));
        this.trimReplay(nextEvent.sessionId);

        for (const subscriber of this.subscribersBySession.get(nextEvent.sessionId) ?? []) {
            subscriber.push(nextEvent);
        }
        return nextEvent;
    }

    /**
     * 生成 SSE 连接握手事件。它只说明当前事件流身份，不参与 replay。
     */
    connectedEvent(sessionId: number): AgentSessionEventDto {
        const latestSeq = this.lastSeq(sessionId);
        return {
            eventEpoch: this.eventEpoch,
            seq: latestSeq,
            sessionId,
            kind: "session",
            event: {
                type: "connected",
                eventEpoch: this.eventEpoch,
                latestSeq,
            },
        };
    }

    /**
     * 订阅 session 事件。同 epoch 的 cursor 可 replay；跨 epoch 由 connected handshake 触发 snapshot 恢复。
     */
    subscribe(sessionId: number, cursor: AgentSessionEventCursor = {}): AsyncIterable<AgentSessionEventDto> {
        const subscription = new SessionEventSubscription({
            maxQueueLength: this.subscriberQueueLimit,
            maxQueueBytes: this.subscriberQueueByteLimit,
        });
        const subscribers = this.subscribersBySession.get(sessionId) ?? new Set<Subscriber>();
        subscribers.add(subscription);
        this.subscribersBySession.set(sessionId, subscribers);

        if (cursor.eventEpoch && cursor.eventEpoch !== this.eventEpoch) {
            return this.subscriptionIterable(subscription, subscribers);
        }

        const after = cursor.after;
        const replay = this.replayBySession.get(sessionId) ?? [];
        const latestSeq = this.lastSeq(sessionId);
        const firstSeq = replay[0]?.seq ?? latestSeq + 1;
        if (typeof after === "number" && after > latestSeq) {
            subscription.push(this.snapshotRequiredEvent(sessionId, "event cursor is ahead of server"));
        } else if (typeof after === "number" && after < firstSeq - 1) {
            subscription.push(this.snapshotRequiredEvent(sessionId, "event replay buffer expired"));
        } else {
            for (const event of replay) {
                if (typeof after !== "number" || event.seq > after) {
                    subscription.push(event);
                }
            }
        }

        return this.subscriptionIterable(subscription, subscribers);
    }

    private snapshotRequiredEvent(sessionId: number, reason: string): AgentSessionEventDto {
        return {
            eventEpoch: this.eventEpoch,
            seq: this.lastSeq(sessionId),
            sessionId,
            kind: "session",
            event: {
                type: "snapshot_required",
                reason,
            },
        };
    }

    private subscriptionIterable(subscription: SessionEventSubscription, subscribers: Set<Subscriber>): AsyncIterable<AgentSessionEventDto> & {return(): Promise<IteratorResult<AgentSessionEventDto>>} {
        return {
            [Symbol.asyncIterator]: () => subscription,
            return: async () => {
                subscribers.delete(subscription);
                subscription.close();
                return {done: true, value: undefined};
            },
        };
    }

    /**
     * 当前 session 最新事件序号。
     */
    lastSeq(sessionId: number): number {
        return this.seqBySession.get(sessionId) ?? 0;
    }

    /**
     * 判断指定 cursor 之后的事件是否仍完整保留在 replay 中。
     * Snapshot 不能返回已经过期的 transcript anchor，否则客户端会在
     * snapshot_required 与同一个失效 cursor 之间反复恢复。
     */
    canReplayAfter(sessionId: number, after: number): boolean {
        const latestSeq = this.lastSeq(sessionId);
        if (after > latestSeq) {
            return false;
        }
        const replay = this.replayBySession.get(sessionId) ?? [];
        const firstSeq = replay[0]?.seq ?? latestSeq + 1;
        return after >= firstSeq - 1;
    }

    /**
     * 固定某个 session 的 replay 起点，确保运行中未落盘 transcript 可被刷新后的前端 replay。
     */
    pinReplayFrom(sessionId: number, firstSeq: number): void {
        const normalizedFirstSeq = Math.max(1, Math.floor(firstSeq));
        const current = this.replayPinFirstSeqBySession.get(sessionId);
        if (current === undefined || normalizedFirstSeq < current) {
            this.replayPinFirstSeqBySession.set(sessionId, normalizedFirstSeq);
            this.trimReplay(sessionId);
        }
    }

    /**
     * 解除 replay pin，并恢复默认 replayLimit 裁剪。
     */
    unpinReplay(sessionId: number): void {
        this.replayPinFirstSeqBySession.delete(sessionId);
        this.trimReplay(sessionId);
    }

    private trimReplay(sessionId: number): void {
        const replay = this.replayBySession.get(sessionId);
        if (!replay?.length) {
            this.replayBytesBySession.delete(sessionId);
            return;
        }
        const pinnedFirstSeq = this.replayPinFirstSeqBySession.get(sessionId);
        if (pinnedFirstSeq !== undefined) {
            const dropCount = replay.findIndex((event) => event.seq >= pinnedFirstSeq);
            if (dropCount > 0) {
                this.dropReplayEvents(sessionId, replay, dropCount);
            } else if (dropCount === -1) {
                this.dropReplayEvents(sessionId, replay, replay.length);
                return;
            }
            while (replay.length > 0 && (this.replayBytesBySession.get(sessionId) ?? 0) > this.pinnedReplayByteLimit) {
                this.dropReplayEvents(sessionId, replay, 1);
            }
            return;
        }
        if (replay.length > this.replayLimit) {
            this.dropReplayEvents(sessionId, replay, replay.length - this.replayLimit);
        }
        while (replay.length > 0 && (this.replayBytesBySession.get(sessionId) ?? 0) > this.replayByteLimit) {
            this.dropReplayEvents(sessionId, replay, 1);
        }
    }

    private dropReplayEvents(sessionId: number, replay: AgentSessionEventDto[], count: number): void {
        if (count <= 0) {
            return;
        }
        const removed = replay.splice(0, count);
        const removedBytes = removed.reduce((total, event) => total + estimateEventBytes(event), 0);
        const nextBytes = Math.max(0, (this.replayBytesBySession.get(sessionId) ?? 0) - removedBytes);
        if (replay.length === 0) {
            this.replayBytesBySession.delete(sessionId);
        } else {
            this.replayBytesBySession.set(sessionId, nextBytes);
        }
    }
}

function eventBytes(item: IteratorResult<AgentSessionEventDto>): number {
    if (item.done || !item.value) {
        return 0;
    }
    return estimateEventBytes(item.value);
}

function estimateEventBytes(event: AgentSessionEventDto): number {
    try {
        return Buffer.byteLength(JSON.stringify(event), "utf-8");
    } catch {
        return 1024;
    }
}
