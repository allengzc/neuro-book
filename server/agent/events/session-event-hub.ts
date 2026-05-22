import type {AgentSessionEventDto} from "nbook/shared/dto/agent-session.dto";

const DEFAULT_REPLAY_LIMIT = 500;

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
    private readonly replayLimit: number;
    private readonly replayBySession = new Map<number, AgentSessionEventDto[]>();
    private readonly subscribersBySession = new Map<number, Set<Subscriber>>();
    private seq = 0;

    constructor(replayLimit = DEFAULT_REPLAY_LIMIT) {
        this.replayLimit = replayLimit;
    }

    /**
     * 给事件分配全局递增序号并广播。
     */
    publish(event: Omit<AgentSessionEventDto, "seq">): AgentSessionEventDto {
        const nextEvent = {
            ...event,
            seq: ++this.seq,
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
     * 订阅 session 事件。after 太旧时先推送 snapshot_required。
     */
    subscribe(sessionId: number, after?: number): AsyncIterable<AgentSessionEventDto> {
        const subscription = new SessionEventSubscription();
        const subscribers = this.subscribersBySession.get(sessionId) ?? new Set<Subscriber>();
        subscribers.add(subscription);
        this.subscribersBySession.set(sessionId, subscribers);

        const replay = this.replayBySession.get(sessionId) ?? [];
        const firstSeq = replay[0]?.seq ?? this.seq + 1;
        if (typeof after === "number" && after < firstSeq - 1) {
            subscription.push({
                seq: ++this.seq,
                sessionId,
                kind: "session",
                event: {
                    type: "snapshot_required",
                    reason: "event replay buffer expired",
                },
            });
        } else {
            for (const event of replay) {
                if (typeof after !== "number" || event.seq > after) {
                    subscription.push(event);
                }
            }
        }

        const iterable = {
            [Symbol.asyncIterator]: () => subscription,
            return: async () => {
                subscribers.delete(subscription);
                subscription.close();
                return {done: true, value: undefined};
            },
        };
        return iterable;
    }

    /**
     * 当前最新事件序号。
     */
    get lastSeq(): number {
        return this.seq;
    }
}
