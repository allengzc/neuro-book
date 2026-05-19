import {AIMessage, AIMessageChunk, HumanMessage, ToolMessage} from "@langchain/core/messages";
import type {AgentRunnerEvent} from "nbook/server/agent/runtime/thread-runner";
import {tool} from "@langchain/core/tools";
import {z} from "zod";
import {describe, expect, it, vi} from "vitest";
import {AgentThreadRunner} from "nbook/server/agent/runtime/thread-runner";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {BoundAgentTool} from "nbook/server/agent/tools/tool-registry";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";

/**
 * 构造异步消息流。
 */
async function* streamMessages(messages: Array<AIMessage | AIMessageChunk>) {
    for (const message of messages) {
        yield message;
    }
}

describe("AgentThreadRunner", () => {
    it("会自己执行 model -> tool -> model 的 ReAct 循环", async () => {
        const execute = vi.fn(async (input: {path: string}, context: AgentToolContext) => {
            context.writeToolOutput("读取中");
            return {
                content: `文件 ${input.path} 的内容`,
                toolArgs: JSON.stringify(input),
            };
        });
        const publishToolOutputDelta = vi.fn();
        const boundTool: BoundAgentTool = {
            definition: {
                key: "read_file",
                description: "read file",
                schema: z.object({
                    path: z.string(),
                }),
                execute,
            },
            langChainTool: tool(async () => "unused", {
                name: "read_file",
                description: "read file",
                schema: z.object({
                    path: z.string(),
                }),
            }),
            context: {
                agentGateway: {
                    publishToolOutputDelta,
                } as never,
                threadId: "1",
                profileKey: "leader.default",
                profile: {
                    key: "leader.default",
                } as never,
                runOptions: {},
                writeToolOutput: () => {},
                getHistory: async () => [],
                getScope: () => ({}) as never,
                setIde: () => ({}) as never,
                setStudio: () => ({}) as never,
            },
            invoke: vi.fn(),
        };
        const model = {
            bindTools: vi.fn(() => model),
            stream: vi.fn(async (messages: unknown[]) => {
                const hasToolResult = messages.some((message) => ToolMessage.isInstance(message));
                if (!hasToolResult) {
                    return streamMessages([
                        new AIMessageChunk({
                            content: "先读文件",
                            tool_call_chunks: [{
                                index: 0,
                                id: "call-read-1",
                                name: "read_file",
                                args: "{\"path\":\"chapter.md\"}",
                            }],
                        }),
                    ]);
                }
                return streamMessages([
                    new AIMessageChunk("读完了"),
                ]);
            }),
        };
        const runner = new AgentThreadRunner({
            getChatModel: () => model as never,
        });

        const events: AgentRunnerEvent[] = [];
        const stream = await runner.streamPreparedEvents(
            createThreadRecord(),
            "leader.default",
            [new HumanMessage("读一下 chapter.md")],
            [boundTool],
        );
        for await (const event of stream) {
            events.push(event);
        }

        expect(model.bindTools).toHaveBeenCalledTimes(1);
        expect(model.stream).toHaveBeenCalledTimes(2);
        expect(execute).toHaveBeenCalledWith({path: "chapter.md"}, expect.any(Object));
        expect(publishToolOutputDelta).toHaveBeenCalledWith("1", "call-read-1", "读取中");
        expect(events.map((event) => event.type)).toEqual([
            "model_delta",
            "model_end",
            "tool_start",
            "tool_end",
            "tool_batch_end",
            "model_delta",
            "model_end",
        ]);
        expect(events.find((event) => event.type === "tool_end")).toMatchObject({
            output: expect.objectContaining({
                text: expect.stringContaining("chapter.md"),
            }),
        });
    });

    it("会为缺失 id 的 tool call 补齐同一个 tool_call_id", async () => {
        const execute = vi.fn(async (input: {path: string}) => ({
            content: `文件 ${input.path} 的内容`,
            toolArgs: JSON.stringify(input),
        }));
        const boundTool = createBoundReadFileTool(execute);
        let secondCallMessages: unknown[] = [];
        const model = {
            bindTools: vi.fn(() => model),
            stream: vi.fn(async (messages: unknown[]) => {
                const hasToolResult = messages.some((message) => ToolMessage.isInstance(message));
                if (!hasToolResult) {
                    return streamMessages([
                        new AIMessageChunk({
                            content: "",
                            tool_call_chunks: [{
                                index: 0,
                                name: "read_file",
                                args: "{\"path\":\"chapter.md\"}",
                            }],
                        }),
                    ]);
                }
                secondCallMessages = messages;
                return streamMessages([
                    new AIMessageChunk("读完了"),
                ]);
            }),
        };
        const runner = new AgentThreadRunner({
            getChatModel: () => model as never,
        });

        const events: AgentRunnerEvent[] = [];
        const stream = await runner.streamPreparedEvents(
            createThreadRecord(),
            "leader.default",
            [new HumanMessage("读一下 chapter.md")],
            [boundTool],
        );
        for await (const event of stream) {
            events.push(event);
        }

        const assistantWithToolCall = secondCallMessages.find((message) => AIMessage.isInstance(message) && Boolean(message.tool_calls?.length)) as AIMessage | undefined;
        const toolResult = secondCallMessages.find((message) => ToolMessage.isInstance(message)) as ToolMessage | undefined;
        const toolStart = events.find((event) => event.type === "tool_start");
        const toolEnd = events.find((event) => event.type === "tool_end");
        const toolCallId = assistantWithToolCall?.tool_calls?.[0]?.id;

        expect(toolCallId).toMatch(/^tool-call-/);
        expect(toolResult?.tool_call_id).toBe(toolCallId);
        expect(toolStart).toMatchObject({toolCallId});
        expect(toolEnd).toMatchObject({toolCallId});
    });

    it("同一批 tool calls 会并发执行", async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const execute = vi.fn(async (input: {path: string}) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 20));
            inFlight -= 1;
            return {
                content: `文件 ${input.path} 的内容`,
                toolArgs: JSON.stringify(input),
            };
        });
        const boundTool = createBoundReadFileTool(execute);
        const model = {
            bindTools: vi.fn(() => model),
            stream: vi.fn(async (messages: unknown[]) => {
                const hasToolResult = messages.some((message) => ToolMessage.isInstance(message));
                if (!hasToolResult) {
                    return streamMessages([
                        new AIMessageChunk({
                            content: "",
                            tool_call_chunks: [
                                {
                                    index: 0,
                                    id: "call-read-1",
                                    name: "read_file",
                                    args: "{\"path\":\"chapter-1.md\"}",
                                },
                                {
                                    index: 1,
                                    id: "call-read-2",
                                    name: "read_file",
                                    args: "{\"path\":\"chapter-2.md\"}",
                                },
                            ],
                        }),
                    ]);
                }
                return streamMessages([
                    new AIMessageChunk("都读完了"),
                ]);
            }),
        };
        const runner = new AgentThreadRunner({
            getChatModel: () => model as never,
        });

        const events: AgentRunnerEvent[] = [];
        const stream = await runner.streamPreparedEvents(
            createThreadRecord(),
            "leader.default",
            [new HumanMessage("读两份资料")],
            [boundTool],
        );
        for await (const event of stream) {
            events.push(event);
        }

        expect(execute).toHaveBeenCalledTimes(2);
        expect(maxInFlight).toBe(2);
        expect(events.map((event) => event.type)).toEqual([
            "model_delta",
            "model_end",
            "tool_start",
            "tool_start",
            "tool_end",
            "tool_end",
            "tool_batch_end",
            "model_delta",
            "model_end",
        ]);
    });

    it("流式参数和聚合参数不一致时优先使用 raw tool_call_chunks 参数", async () => {
        const execute = vi.fn(async (input: {subagentThreadId: string; input: {prompt: string}}) => ({
            content: `调用 ${input.subagentThreadId}: ${input.input.prompt}`,
            toolArgs: JSON.stringify(input),
        }));
        const boundTool = createBoundInvokeSubagentTool(execute);
        const model = {
            bindTools: vi.fn(() => model),
            stream: vi.fn(async (messages: unknown[]) => {
                const hasToolResult = messages.some((message) => ToolMessage.isInstance(message));
                if (!hasToolResult) {
                    return streamMessages([
                        Object.assign(new AIMessageChunk({
                            content: "",
                            tool_call_chunks: [{
                                index: 0,
                                id: "call-subagent-1",
                                name: "invoke_subagent",
                                args: "{\"subagentThreadId\":\"203\",\"input\":{\"prompt\":\"正确对象\"}}",
                            }],
                        }), {
                            tool_calls: [{
                                id: "call-subagent-1",
                                name: "invoke_subagent",
                                args: {
                                    subagentThreadId: "203",
                                    input: "{\"prompt\":\"错误字符串\"}",
                                },
                                type: "tool_call",
                            }],
                        }),
                    ]);
                }
                return streamMessages([
                    new AIMessageChunk("调用完成"),
                ]);
            }),
        };
        const runner = new AgentThreadRunner({
            getChatModel: () => model as never,
        });

        const stream = await runner.streamPreparedEvents(
            createThreadRecord(),
            "leader.default",
            [new HumanMessage("调用 subagent")],
            [boundTool],
        );
        for await (const _event of stream) {
            // drain stream
        }

        expect(execute).toHaveBeenCalledWith({
            subagentThreadId: "203",
            input: {
                prompt: "正确对象",
            },
        }, expect.any(Object));
    });

    it("流式参数不完整时会回退使用聚合 tool_calls 参数", async () => {
        const execute = vi.fn(async (input: {subagentThreadId: string; input: {prompt: string}}) => ({
            content: `调用 ${input.subagentThreadId}: ${input.input.prompt}`,
            toolArgs: JSON.stringify(input),
        }));
        const boundTool = createBoundInvokeSubagentTool(execute);
        const model = {
            bindTools: vi.fn(() => model),
            stream: vi.fn(async (messages: unknown[]) => {
                const hasToolResult = messages.some((message) => ToolMessage.isInstance(message));
                if (!hasToolResult) {
                    return streamMessages([
                        Object.assign(new AIMessageChunk({
                            content: "",
                            tool_call_chunks: [{
                                index: 0,
                                id: "call-subagent-1",
                                name: "invoke_subagent",
                                args: "{\"subagentThreadId\":\"203\",",
                            }],
                        }), {
                            tool_calls: [{
                                id: "call-subagent-1",
                                name: "invoke_subagent",
                                args: {
                                    subagentThreadId: "203",
                                    input: {
                                        prompt: "聚合参数",
                                    },
                                },
                                type: "tool_call",
                            }],
                        }),
                    ]);
                }
                return streamMessages([
                    new AIMessageChunk("调用完成"),
                ]);
            }),
        };
        const runner = new AgentThreadRunner({
            getChatModel: () => model as never,
        });

        const stream = await runner.streamPreparedEvents(
            createThreadRecord(),
            "leader.default",
            [new HumanMessage("调用 subagent")],
            [boundTool],
        );
        for await (const _event of stream) {
            // drain stream
        }

        expect(execute).toHaveBeenCalledWith({
            subagentThreadId: "203",
            input: {
                prompt: "聚合参数",
            },
        }, expect.any(Object));
    });
});

function createBoundReadFileTool(execute: BoundAgentTool["definition"]["execute"]): BoundAgentTool {
    return {
        definition: {
            key: "read_file",
            description: "read file",
            schema: z.object({
                path: z.string(),
            }),
            execute,
        },
        langChainTool: tool(async () => "unused", {
            name: "read_file",
            description: "read file",
            schema: z.object({
                path: z.string(),
            }),
        }),
        context: {
            agentGateway: {
                publishToolOutputDelta: vi.fn(),
            } as never,
            threadId: "1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            } as never,
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => ({}) as never,
            setIde: () => ({}) as never,
            setStudio: () => ({}) as never,
        },
        invoke: vi.fn(),
    };
}

function createBoundInvokeSubagentTool(execute: BoundAgentTool["definition"]["execute"]): BoundAgentTool {
    const schema = z.object({
        subagentThreadId: z.string(),
        input: z.object({
            prompt: z.string(),
        }),
    });

    return {
        definition: {
            key: "invoke_subagent",
            description: "invoke subagent",
            schema,
            execute,
        },
        langChainTool: tool(async () => "unused", {
            name: "invoke_subagent",
            description: "invoke subagent",
            schema,
        }),
        context: {
            agentGateway: {
                publishToolOutputDelta: vi.fn(),
            } as never,
            threadId: "1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            } as never,
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => ({}) as never,
            setIde: () => ({}) as never,
            setStudio: () => ({}) as never,
        },
        invoke: vi.fn(),
    };
}
