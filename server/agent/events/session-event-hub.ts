import {randomUUID} from "node:crypto";
import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";

const DEFAULT_REPLAY_LIMIT = 500;

export type AgentSessionEventCursor = {
    eventEpoch?: string;
    after?: number;
};

type Subscriber = {
    push(event: AgentSessionEventDto): void;
    close(): void;
};

class SessionEventSubscription implements AsyncIterable<AgentSessionEventDto>, AsyncIterator<AgentSessionEventDto>, Subscriber {
    private readonly queue: IteratorResult<AgentSessionEventDto>[] = [];
    private resolver: ((value: IteratorResult<AgentSessionEventDto>) => void) | null = null;
    private closed = false;

    push(event: AgentSessionEventDto): void {
        if (this.closed) {
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
    }
}

/**
 * session 级事件中心。第一版只做单进程内存广播和 bounded replay。
 */
export class AgentSessionEventHub {
    readonly eventEpoch = randomUUID();
    private readonly replayLimit: number;
    private readonly replayBySession = new Map<number, AgentSessionEventDto[]>();
    private readonly subscribersBySession = new Map<number, Set<Subscriber>>();
    private readonly seqBySession = new Map<number, number>();

    constructor(replayLimit = DEFAULT_REPLAY_LIMIT) {
        this.replayLimit = replayLimit;
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
        if (replay.length > this.replayLimit) {
            replay.splice(0, replay.length - this.replayLimit);
        }
        this.replayBySession.set(nextEvent.sessionId, replay);

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
        const subscription = new SessionEventSubscription();
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
}
