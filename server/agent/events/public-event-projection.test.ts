import {describe, expect, it} from "vitest";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import {projectRuntimeEvent} from "nbook/server/agent/events/public-event-projection";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";

describe("projectRuntimeEvent", () => {
    it("丢弃 Pi agent_end / turn_end 大字段，由 Run Kernel 生成轻量公开事件", () => {
        const assistant = createAssistantTextMessage({text: "large assistant"});
        const toolResult = createTextToolResult({
            toolCallId: "tool-1",
            toolName: "read",
            text: "large result",
        });

        const agentEnd: AgentEvent = {
            type: "agent_end",
            messages: [assistant, toolResult],
        };
        const turnEnd: AgentEvent = {
            type: "turn_end",
            message: assistant,
            toolResults: [toolResult],
        };

        expect(projectRuntimeEvent(agentEnd)).toBeNull();
        expect(projectRuntimeEvent(turnEnd)).toBeNull();
    });

    it("保留工具执行事件需要的 UI 字段", () => {
        const event: AgentEvent = {
            type: "tool_execution_end",
            toolCallId: "tool-1",
            toolName: "read",
            result: {content: [{type: "text", text: "ok"}]},
            isError: false,
        };

        expect(projectRuntimeEvent(event)).toEqual({
            type: "tool_execution_end",
            toolCallId: "tool-1",
            toolName: "read",
            result: {content: [{type: "text", text: "ok"}]},
            isError: false,
        });
    });
});
