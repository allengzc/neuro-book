import {AIMessage, ToolMessage} from "@langchain/core/messages";
import {describe, expect, it} from "vitest";
import {toAgentMessageCreateInput, toLangChainMessage, toModelHistoryMessages, toStoredMessage} from "nbook/server/agent/messages/codec";
import {createAgentMessage} from "nbook/server/agent/test/fixtures";

describe("agent message codec", () => {
    it("使用 LangChain StoredMessage 保留 assistant 扩展字段", () => {
        const source = new AIMessage({
            id: "assistant-1",
            content: "完成",
            additional_kwargs: {
                reasoning_content: "需要读取文件",
                thinking: "需要读取文件",
            },
            tool_calls: [{
                id: "call-1",
                name: "read_file",
                args: {
                    filePath: "AGENTS.md",
                },
                type: "tool_call",
            }],
            usage_metadata: {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15,
            },
        });
        const input = toAgentMessageCreateInput(source, {
            id: "assistant-1",
            createdAt: "2026-04-05T00:00:00.000Z",
        });
        const storedMessage = toStoredMessage(input, {
            id: "assistant-1",
            status: "done",
            createdAt: "2026-04-05T00:00:00.000Z",
        });

        const restored = toLangChainMessage(createAgentMessage({
            id: "assistant-1",
            origin: "assistant_output",
            storedMessage,
        }));

        expect(AIMessage.isInstance(restored)).toBe(true);
        expect(restored.additional_kwargs.reasoning_content).toBe("需要读取文件");
        expect((restored as AIMessage).tool_calls).toMatchObject([{id: "call-1", name: "read_file"}]);
        expect((restored as AIMessage).usage_metadata?.total_tokens).toBe(15);
        expect(restored.additional_kwargs.messageId).toBe("assistant-1");
    });

    it("模型历史发送前会剥离 tool 内部 raw result", () => {
        const history = toModelHistoryMessages([
            createAgentMessage({
                id: "assistant-1",
                origin: "assistant_output",
                storedMessage: toStoredMessage(toAgentMessageCreateInput(new AIMessage({
                    id: "assistant-1",
                    content: "",
                    tool_calls: [{
                        id: "call-1",
                        name: "read_file",
                        args: {
                            filePath: "chapter.md",
                        },
                        type: "tool_call",
                    }],
                }), {
                    id: "assistant-1",
                }), {
                    id: "assistant-1",
                    status: "done",
                    createdAt: "2026-04-05T00:00:00.000Z",
                }),
            }),
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolArgs: "{\"filePath\":\"chapter.md\"}",
                rawAdditionalKwargs: {
                    assistantMessageId: "assistant-1",
                    toolResultRaw: {
                        ok: true,
                    },
                },
            }),
        ]);

        expect(ToolMessage.isInstance(history[1])).toBe(true);
        expect(history[1]?.additional_kwargs.assistantMessageId).toBe("assistant-1");
        expect("toolResultRaw" in (history[1]?.additional_kwargs ?? {})).toBe(false);
    });

    it("模型历史发送前会剥离 assistant content 内的工具调用块", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
                {id: "call-1", name: "execute_shell"},
            ], {
                content: [
                    {
                        type: "text",
                        text: "准备调用工具",
                    },
                    {
                        type: "tool_call",
                        id: "call-1",
                        name: "read_file",
                        args: {},
                    },
                    {
                        type: "tool_use",
                        id: "call-1",
                        name: "execute_shell",
                        input: {},
                    },
                ],
            }),
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "第一次",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
            createAgentMessage({
                id: "tool-message-2",
                role: "tool",
                origin: "tool_result",
                content: "第二次",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
        ]);

        const assistantMessage = history.find((message) => AIMessage.isInstance(message)) as AIMessage | undefined;

        expect(assistantMessage?.content).toEqual([{
            type: "text",
            text: "准备调用工具",
        }]);
        expect(assistantMessage?.tool_calls?.map((toolCall) => toolCall.id)).toEqual(["call-1", "call-1__turn_1"]);
    });

    it("模型历史会为缺失的 tool_call_id 补失败 ToolMessage", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
                {id: "call-2", name: "execute_shell"},
                {id: "call-3", name: "write_file"},
            ]),
            createAgentMessage({
                id: "call-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
            createAgentMessage({
                id: "call-2",
                role: "tool",
                origin: "tool_result",
                content: "命令成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-2",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
        ]);

        expect(history).toHaveLength(4);
        expect(history.filter((message) => ToolMessage.isInstance(message)).map((message) => (message as ToolMessage).tool_call_id)).toEqual([
            "call-1",
            "call-2",
            "call-3",
        ]);
        expect((history[3] as ToolMessage).status).toBe("error");
        expect(history[3]?.text).toContain("Tool call canceled by user before it returned.");
    });

    it("模型历史允许 tool results 与 tool_calls 顺序不同", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
                {id: "call-2", name: "execute_shell"},
            ]),
            createAgentMessage({
                id: "call-2",
                role: "tool",
                origin: "tool_result",
                content: "命令成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-2",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
            createAgentMessage({
                id: "call-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
        ]);

        expect(history.filter((message) => ToolMessage.isInstance(message)).map((message) => (message as ToolMessage).tool_call_id)).toEqual([
            "call-2",
            "call-1",
        ]);
    });

    it("模型历史会为重复 provider tool_call_id 生成请求内唯一 id", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
            ]),
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "第一次",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
            createAssistantToolCallMessage("assistant-2", [
                {id: "call-1", name: "read_file"},
            ]),
            createAgentMessage({
                id: "tool-message-2",
                role: "tool",
                origin: "tool_result",
                content: "第二次",
                assistantMessageId: "assistant-2",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
        ]);

        const assistantMessages = history.filter((message) => AIMessage.isInstance(message)) as AIMessage[];
        const toolMessages = history.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
        const firstToolCallId = assistantMessages[0]?.tool_calls?.[0]?.id;
        const secondToolCallId = assistantMessages[1]?.tool_calls?.[0]?.id;

        expect(firstToolCallId).toBe("call-1");
        expect(secondToolCallId).toBe("call-1__turn_2");
        expect(toolMessages.map((message) => message.tool_call_id)).toEqual([
            firstToolCallId,
            secondToolCallId,
        ]);
    });

    it("模型历史会同步修复 additional_kwargs.tool_calls 中的重复 id", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
            ], {
                mirrorToolCallsInAdditionalKwargs: true,
            }),
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "第一次",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
            createAssistantToolCallMessage("assistant-2", [
                {id: "call-1", name: "execute_shell"},
            ], {
                mirrorToolCallsInAdditionalKwargs: true,
            }),
            createAgentMessage({
                id: "tool-message-2",
                role: "tool",
                origin: "tool_result",
                content: "第二次",
                assistantMessageId: "assistant-2",
                toolCallId: "call-1",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
        ]);

        const assistantMessages = history.filter((message) => AIMessage.isInstance(message)) as AIMessage[];
        const secondRawToolCalls = assistantMessages[1]?.additional_kwargs.tool_calls as Array<{id: string}> | undefined;

        expect(assistantMessages[1]?.tool_calls?.[0]?.id).toBe("call-1__turn_2");
        expect(secondRawToolCalls?.[0]?.id).toBe("call-1__turn_2");
    });

    it("模型历史会修复同一 assistant 内重复的 tool_call_id", () => {
        const history = toModelHistoryMessages([
            createAssistantToolCallMessage("assistant-1", [
                {id: "call-1", name: "read_file"},
                {id: "call-1", name: "execute_shell"},
            ]),
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "第一次",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "read_file",
                toolStatus: "success",
            }),
            createAgentMessage({
                id: "tool-message-2",
                role: "tool",
                origin: "tool_result",
                content: "第二次",
                assistantMessageId: "assistant-1",
                toolCallId: "call-1",
                toolName: "execute_shell",
                toolStatus: "success",
            }),
        ]);

        const assistantMessage = history.find((message) => AIMessage.isInstance(message)) as AIMessage | undefined;
        const toolMessages = history.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
        const toolCallIds = assistantMessage?.tool_calls?.map((toolCall) => toolCall.id);

        expect(toolCallIds).toEqual(["call-1", "call-1__turn_1"]);
        expect(toolMessages.map((message) => message.tool_call_id)).toEqual(toolCallIds);
    });

    it("模型历史会丢弃孤立 ToolMessage", () => {
        const history = toModelHistoryMessages([
            createAgentMessage({
                id: "tool-message-1",
                role: "tool",
                origin: "tool_result",
                content: "读取成功",
                toolCallId: "call-1",
                toolName: "read_file",
            }),
        ]);

        expect(history).toEqual([]);
    });

    it("普通 LangChain 还原会保留产品历史 metadata", () => {
        const message = toLangChainMessage(createAgentMessage({
            role: "system",
            content: "你是 leader",
        }));

        expect(message.additional_kwargs.messageId).toBe("message-1");
        expect(message.additional_kwargs.messageStatus).toBe("done");
    });
});

function createAssistantToolCallMessage(
    id: string,
    toolCalls: Array<{id: string; name: string}>,
    options: {
        content?: AIMessage["content"];
        mirrorToolCallsInAdditionalKwargs?: boolean;
    } = {},
) {
    const normalizedToolCalls = toolCalls.map((toolCall) => ({
        ...toolCall,
        args: {},
        type: "tool_call" as const,
    }));
    const input = toAgentMessageCreateInput(new AIMessage({
        id,
        content: options.content ?? "",
        additional_kwargs: options.mirrorToolCallsInAdditionalKwargs ? {
            tool_calls: normalizedToolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function",
                function: {
                    name: toolCall.name,
                    arguments: "{}",
                },
            })),
        } : {},
        tool_calls: normalizedToolCalls,
    }), {
        id,
    });
    return createAgentMessage({
        id,
        storedMessage: toStoredMessage(input, {
            id,
            status: "done",
            createdAt: "2026-04-05T00:00:00.000Z",
        }),
    });
}
