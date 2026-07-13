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

    it("message_update 只公开增量，不重复携带完整 partial", () => {
        const partial = createAssistantTextMessage({text: "已经生成的长文本".repeat(1000)});
        const event: AgentEvent = {
            type: "message_update",
            message: partial,
            assistantMessageEvent: {
                type: "text_delta",
                contentIndex: 0,
                delta: "新增",
                partial,
            },
        };

        const projected = projectRuntimeEvent(event);

        expect(projected?.type).toBe("message_update");
        if (projected?.type !== "message_update") {
            throw new Error("预期 message_update");
        }
        if (projected.message.role !== "assistant") {
            throw new Error("预期 assistant message");
        }
        expect(projected.message.content).toEqual([]);
        expect(projected.assistantMessageEvent).toEqual(expect.objectContaining({
            type: "text_delta",
            delta: "新增",
            partial: expect.objectContaining({content: []}),
        }));
        expect(JSON.stringify(projected).length).toBeLessThan(2000);
    });

    it("write start 事件只公开内容预览和字节数，不公开完整 content", () => {
        const content = "开头" + "x".repeat(2000);
        const event: AgentEvent = {
            type: "tool_execution_start",
            toolCallId: "tool-write",
            toolName: "write",
            args: {path: "manuscript/01.md", content},
        };

        const projected = projectRuntimeEvent(event);

        expect(projected).toEqual(expect.objectContaining({
            type: "tool_execution_start",
            toolCallId: "tool-write",
            toolName: "write",
        }));
        expect(projected?.type === "tool_execution_start" ? projected.args : null).toEqual(expect.objectContaining({
            path: "manuscript/01.md",
            contentPreview: expect.stringContaining("开头"),
            contentBytes: Buffer.byteLength(content, "utf-8"),
            contentOmitted: true,
            omittedFields: ["content"],
        }));
        expect(projected?.type === "tool_execution_start" && (projected.args as {content?: string}).content).toBeUndefined();
    });

    it("apply_patch start 事件只公开 patch 预览、字节数和目标文件", () => {
        const patch = [
            "*** Begin Patch",
            "*** Update File: manuscript/01.md",
            "@@",
            "-old",
            `+${"new".repeat(800)}`,
            "*** End Patch",
        ].join("\n");
        const event: AgentEvent = {
            type: "tool_execution_start",
            toolCallId: "tool-patch",
            toolName: "apply_patch",
            args: {patch},
        };

        const projected = projectRuntimeEvent(event);

        expect(projected?.type === "tool_execution_start" ? projected.args : null).toEqual(expect.objectContaining({
            patchPreview: expect.stringContaining("*** Begin Patch"),
            patchBytes: Buffer.byteLength(patch, "utf-8"),
            patchOmitted: true,
            touchedFiles: ["manuscript/01.md"],
            omittedFields: ["patch"],
        }));
        expect(projected?.type === "tool_execution_start" && (projected.args as {patch?: string}).patch).toBeUndefined();
    });

    it("edit args 和 diff result 只公开预览，避免整段文本进入 replay", () => {
        const oldText = "old".repeat(700);
        const newText = "new".repeat(700);
        const startEvent: AgentEvent = {
            type: "tool_execution_start",
            toolCallId: "tool-edit",
            toolName: "edit",
            args: {path: "manuscript/01.md", edits: [{oldText, newText}]},
        };
        const endEvent: AgentEvent = {
            type: "tool_execution_end",
            toolCallId: "tool-edit",
            toolName: "edit",
            result: {
                content: [{type: "text", text: "ok"}],
                details: {diff: `-${oldText}\n+${newText}`, firstChangedLine: 1},
            },
            isError: false,
        };

        const projectedStart = projectRuntimeEvent(startEvent);
        const projectedEnd = projectRuntimeEvent(endEvent);
        const edits = projectedStart?.type === "tool_execution_start" ? (projectedStart.args as {edits: Array<Record<string, unknown>>}).edits : [];
        const details = projectedEnd?.type === "tool_execution_end" ? (projectedEnd.result as {details: Record<string, unknown>}).details : {};

        expect(edits[0]).toEqual(expect.objectContaining({
            oldTextPreview: expect.stringContaining("old"),
            oldTextBytes: Buffer.byteLength(oldText, "utf-8"),
            oldTextOmitted: true,
            newTextPreview: expect.stringContaining("new"),
            newTextBytes: Buffer.byteLength(newText, "utf-8"),
            newTextOmitted: true,
            omittedFields: ["oldText", "newText"],
        }));
        expect(edits[0]?.oldText).toBeUndefined();
        expect(edits[0]?.newText).toBeUndefined();
        expect(details).toEqual(expect.objectContaining({
            diffPreview: expect.stringContaining("-old"),
            diffOmitted: true,
            omittedFields: ["diff"],
        }));
        expect(details.diff).toBeUndefined();
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
