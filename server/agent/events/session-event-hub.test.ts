import {describe, expect, it} from "vitest";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";

describe("AgentSessionEventHub", () => {
    it("支持多订阅者和 after replay", async () => {
        const hub = new AgentSessionEventHub();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });
        const first = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        const second = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 1})[Symbol.asyncIterator]();

        const nextEvent = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "new",
            },
        });

        await expect(first.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({seq: 1}),
        });
        await expect(first.next()).resolves.toEqual({
            done: false,
            value: nextEvent,
        });
        await expect(second.next()).resolves.toEqual({
            done: false,
            value: nextEvent,
        });

        await first.return?.();
        await second.return?.();
    });

    it("after 超出 replay buffer 时推送 snapshot_required", async () => {
        const hub = new AgentSessionEventHub(1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                kind: "session",
                event: {
                    type: "snapshot_required",
                    reason: "event replay buffer expired",
                },
            }),
        });

        await subscription.return?.();
    });

    it("snapshot_required 只发送给落后的订阅者，不广播给正常订阅者", async () => {
        const hub = new AgentSessionEventHub(1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        const latest = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        const stale = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        const current = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: latest.seq - 1})[Symbol.asyncIterator]();

        await expect(stale.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                kind: "session",
                event: expect.objectContaining({type: "snapshot_required"}),
            }),
        });
        await expect(current.next()).resolves.toEqual({
            done: false,
            value: latest,
        });

        await stale.return?.();
        await current.return?.();
    });

    it("snapshot_required 不推进 session seq，避免给正常订阅者制造缺口", async () => {
        const hub = new AgentSessionEventHub(1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        const stale = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        await expect(stale.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                seq: 2,
                event: expect.objectContaining({type: "snapshot_required"}),
            }),
        });

        const next = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "third",
            },
        });

        expect(next.seq).toBe(3);
        await stale.return?.();
    });

    it("不同 session 使用独立 seq，避免单 session 订阅误判 gap", () => {
        const hub = new AgentSessionEventHub();
        const first = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-1-first",
            },
        });
        hub.publish({
            sessionId: 2,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-2-first",
            },
        });
        hub.publish({
            sessionId: 2,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-2-second",
            },
        });
        const second = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "session-1-second",
            },
        });

        expect(first.seq).toBe(1);
        expect(second.seq).toBe(2);
        expect(hub.lastSeq(1)).toBe(2);
        expect(hub.lastSeq(2)).toBe(2);
        expect(hub.connectedEvent(1).event).toMatchObject({
            type: "connected",
            latestSeq: 2,
        });
    });

    it("connected handshake 暴露当前 eventEpoch 和 latestSeq", () => {
        const hub = new AgentSessionEventHub();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });

        expect(hub.connectedEvent(1)).toMatchObject({
            eventEpoch: hub.eventEpoch,
            seq: 1,
            event: {
                type: "connected",
                eventEpoch: hub.eventEpoch,
                latestSeq: 1,
            },
        });
    });

    it("after 来自未来时推送 snapshot_required", async () => {
        const hub = new AgentSessionEventHub();
        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 426})[Symbol.asyncIterator]();

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                eventEpoch: hub.eventEpoch,
                kind: "session",
                event: {
                    type: "snapshot_required",
                    reason: "event cursor is ahead of server",
                },
            }),
        });

        await subscription.return?.();
    });

    it("eventEpoch 不一致时不 replay 旧事件", async () => {
        const hub = new AgentSessionEventHub();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });
        const subscription = hub.subscribe(1, {eventEpoch: "old-epoch", after: 0})[Symbol.asyncIterator]();
        const next = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "new",
            },
        });

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: next,
        });
        await subscription.return?.();
    });
});
