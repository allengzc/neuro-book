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
        const first = hub.subscribe(1, 0)[Symbol.asyncIterator]();
        const second = hub.subscribe(1, 1)[Symbol.asyncIterator]();

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

        const subscription = hub.subscribe(1, 0)[Symbol.asyncIterator]();

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

        const stale = hub.subscribe(1, 0)[Symbol.asyncIterator]();
        const current = hub.subscribe(1, latest.seq - 1)[Symbol.asyncIterator]();

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
});
