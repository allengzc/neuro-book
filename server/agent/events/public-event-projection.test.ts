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

    it("非 request_user_input 工具的用户输入事件会公开 Low-Code formSpec", () => {
        const event = {
            type: "tool_user_input_required" as const,
            toolCallId: "tool-form",
            toolName: "enter_plan_mode",
            args: {reason: "need plan"},
            formSpec: {
                form: {
                    defaults: {approved: true},
                    fields: [{
                        path: "approved",
                        component: "radio" as const,
                        label: "是否批准？",
                        required: false,
                        options: [
                            {value: true, label: "批准"},
                            {value: false, label: "拒绝"},
                        ],
                    }],
                },
                prompt: "请审批",
                layout: "inline" as const,
            },
        };

        expect(projectRuntimeEvent(event)).toEqual({
            type: "tool.user-input-required",
            toolCallId: "tool-form",
            toolName: "enter_plan_mode",
            args: {reason: "need plan"},
            formSpec: {
                form: event.formSpec.form,
                resultSchema: undefined,
                prompt: "请审批",
                layout: "inline",
            },
        });
    });

    it("request_user_input 即使带历史 formSpec 也不会公开 Low-Code formSpec", () => {
        const event = {
            type: "tool_user_input_required" as const,
            toolCallId: "tool-request",
            toolName: "request_user_input",
            args: {questions: [{question: "给一个名字"}]},
            formSpec: {
                form: {
                    defaults: {},
                    fields: [{
                        path: "answer_0",
                        component: "textarea" as const,
                        label: "给一个名字",
                        required: false,
                        options: [],
                    }],
                },
            },
        };

        expect(projectRuntimeEvent(event)).toEqual({
            type: "tool.user-input-required",
            toolCallId: "tool-request",
            toolName: "request_user_input",
            args: {questions: [{question: "给一个名字"}]},
        });
    });
});
