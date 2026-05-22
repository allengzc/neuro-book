import {describe, expect, it, vi} from "vitest";
import {
    createAgentV3Session,
    detachAgentV3Agent,
    getAgentV3Agent,
    invokeAgentV3Session,
    pushAgentV3Event,
    toInvokeInput,
} from "nbook/server/agent/http";

describe("agent-v3 http helpers", () => {
    it("createAgentV3Session 调用 harness.createAgent", async () => {
        const createAgent = vi.fn(async () => ({
            sessionId: 7,
            profileKey: "leader.default",
            title: "Leader",
        }));

        await expect(createAgentV3Session({
            profileKey: "leader.default",
            input: {role: "tester"},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            parentSessionId: 1,
        }, {createAgent} as never)).resolves.toEqual(expect.objectContaining({
            sessionId: 7,
        }));

        expect(createAgent).toHaveBeenCalledWith({
            profileKey: "leader.default",
            input: {role: "tester"},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            parentSessionId: 1,
        });
    });

    it("invokeAgentV3Session 调用 harness.invokeAgent", async () => {
        const invokeAgent = vi.fn(async () => ({
            sessionId: 12,
            invocationId: "run-1",
            status: "completed",
            events: [],
        }));

        await invokeAgentV3Session(12, {
            mode: "prompt",
            message: {text: "hello"},
        }, {invokeAgent} as never);

        expect(invokeAgent).toHaveBeenCalledWith({
            sessionId: 12,
            mode: "prompt",
            message: {text: "hello"},
            resolution: undefined,
            block: undefined,
            onEvent: undefined,
        });
    });

    it("getAgentV3Agent 支持 owner 列表和单 agent 查询", async () => {
        const getAgent = vi.fn(async () => []);

        await getAgentV3Agent(undefined, {ownerSessionId: 1}, {getAgent} as never);
        await getAgentV3Agent(2, {}, {getAgent} as never);

        expect(getAgent).toHaveBeenNthCalledWith(1, undefined, 1);
        expect(getAgent).toHaveBeenNthCalledWith(2, 2, undefined);
    });

    it("detachAgentV3Agent 调用 harness.detachAgent", async () => {
        const detachAgent = vi.fn(async () => ({
            sessionId: 3,
            detached: true,
        }));

        await detachAgentV3Agent(3, {ownerSessionId: 1}, {detachAgent} as never);

        expect(detachAgent).toHaveBeenCalledWith(3, 1);
    });

    it("pushAgentV3Event 使用事件 type 作为 SSE event name", async () => {
        const push = vi.fn(async () => {});

        await pushAgentV3Event({push}, {type: "agent_start"});
        await pushAgentV3Event({push}, {
            type: "result",
            result: {
                status: "completed",
            },
        });

        expect(push).toHaveBeenNthCalledWith(1, {
            event: "agent_start",
            data: JSON.stringify({type: "agent_start"}),
        });
        expect(push).toHaveBeenNthCalledWith(2, {
            event: "result",
            data: JSON.stringify({
                type: "result",
                result: {
                    status: "completed",
                },
            }),
        });
    });

    it("toInvokeInput 保留 streaming onEvent callback", () => {
        const onEvent = vi.fn();

        expect(toInvokeInput(4, {
            mode: "continue",
            resolution: {
                kind: "tool_approval",
                toolCallId: "tool-1",
                approved: true,
            },
        }, onEvent)).toEqual({
            sessionId: 4,
            mode: "continue",
            message: undefined,
            resolution: {
                kind: "tool_approval",
                toolCallId: "tool-1",
                approved: true,
            },
            block: undefined,
            onEvent,
        });
    });
});
