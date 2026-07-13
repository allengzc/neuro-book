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

    it("准确判断 snapshot cursor 是否仍可 replay", () => {
        const hub = new AgentSessionEventHub(2);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "first"},
        });
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "second"},
        });

        expect(hub.canReplayAfter(1, 0)).toBe(true);

        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {type: "invocation_aborted", reason: "third"},
        });

        expect(hub.canReplayAfter(1, 0)).toBe(false);
        expect(hub.canReplayAfter(1, 1)).toBe(true);
        expect(hub.canReplayAfter(1, 4)).toBe(false);
    });

    it("replay pin 激活时在容量内保留 pin 起点后的事件，解除后恢复 replayLimit 裁剪", async () => {
        const hub = new AgentSessionEventHub(3);
        const first = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.pinReplayFrom(1, first.seq);
        const second = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });
        const third = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "third",
            },
        });

        const pinned = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        await expect(pinned.next()).resolves.toEqual({done: false, value: first});
        await expect(pinned.next()).resolves.toEqual({done: false, value: second});
        await expect(pinned.next()).resolves.toEqual({done: false, value: third});
        await pinned.return?.();

        hub.unpinReplay(1);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "fourth",
            },
        });
        const unpinned = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        await expect(unpinned.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                kind: "session",
                event: expect.objectContaining({type: "snapshot_required"}),
            }),
        });
        await unpinned.return?.();
    });

    it("replay pin 不受普通 replayLimit 裁剪，避免运行中 transcript 被 snapshot 恢复吞掉", async () => {
        const hub = new AgentSessionEventHub(2);
        const first = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        hub.pinReplayFrom(1, first.seq);
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });
        const third = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "third",
            },
        });

        const stale = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        const current = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: third.seq - 1})[Symbol.asyncIterator]();

        await expect(stale.next()).resolves.toEqual({done: false, value: first});
        await expect(stale.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({seq: 2}),
        });
        await expect(stale.next()).resolves.toEqual({done: false, value: third});
        await expect(current.next()).resolves.toEqual({
            done: false,
            value: third,
        });

        await stale.return?.();
        await current.return?.();
    });

    it("replay pin 仍受 replayByteLimit 保护，超出后裁剪旧事件", async () => {
        const hub = new AgentSessionEventHub({
            replayLimit: 100,
            pinnedReplayByteLimit: 900,
        });
        const first = hub.publish({
            sessionId: 1,
            kind: "runtime",
            event: {
                type: "tool_execution_start",
                toolCallId: "write-1",
                toolName: "write",
                args: {contentPreview: "a".repeat(600)},
            },
        });
        hub.pinReplayFrom(1, first.seq);
        const second = hub.publish({
            sessionId: 1,
            kind: "runtime",
            event: {
                type: "tool_execution_start",
                toolCallId: "write-2",
                toolName: "write",
                args: {contentPreview: "b".repeat(600)},
            },
        });

        const stale = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        const current = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: second.seq - 1})[Symbol.asyncIterator]();

        await expect(stale.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                kind: "session",
                event: expect.objectContaining({
                    type: "snapshot_required",
                    reason: "event replay buffer expired",
                }),
            }),
        });
        await expect(current.next()).resolves.toEqual({
            done: false,
            value: second,
        });

        await stale.return?.();
        await current.return?.();
    });

    it("慢订阅者队列超限时丢弃积压并推送 snapshot_required", async () => {
        const hub = new AgentSessionEventHub({
            replayLimit: 100,
            subscriberQueueLimit: 1,
        });
        const subscription = hub.subscribe(1, {eventEpoch: hub.eventEpoch, after: 0})[Symbol.asyncIterator]();
        hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "first",
            },
        });
        const second = hub.publish({
            sessionId: 1,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "second",
            },
        });

        await expect(subscription.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                seq: second.seq,
                kind: "session",
                event: {
                    type: "snapshot_required",
                    reason: "event subscriber queue overflowed",
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
