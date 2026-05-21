import {AIMessage, AIMessageChunk, HumanMessage, ToolMessage} from "@langchain/core/messages";
import {describe, expect, it} from "vitest";
import {extractAssistantDeltaFromChunk} from "nbook/server/agent/runtime/thread-runner";
import type {AppConfig} from "nbook/server/utils/app-config";
import {
    buildModelSettingsDto,
    createConfiguredChatModel,
    convertDeepSeekMessagesToCompletionsParams,
    convertModelSettingsRequestToConfig,
    convertOpenAiCompatibleMessagesToCompletionsParams,
    normalizeOpenAiCompatibleReasoningMessage,
    normalizeDeepSeekUsageMetadata,
} from "nbook/server/utils/model";

function createMockOpenAiCompatibleModel(options: {stream?: boolean} = {}) {
    return createConfiguredChatModel({
        models: {
            defaultModelKey: "mock-provider/mock-model",
            providers: {
                "mock-provider": {
                    name: "Mock Provider",
                    adapter: {
                        type: "openai-compatible",
                        reasoningContentReplay: true,
                    },
                    options: {
                        apiKey: "test-key",
                        baseURL: "https://example.test/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: {
                        "mock-model": {
                            name: "Mock Model",
                            id: "mimo-v2.5-pro",
                            group: null,
                            enabled: true,
                            contextWindowTokens: null,
                        },
                    },
                },
            },
        },
    } satisfies Pick<AppConfig, "models">, options);
}

describe("model provider timeout settings", () => {
    it("保存模型设置时会保留 provider 请求超时时间", () => {
        const config = convertModelSettingsRequestToConfig({
            defaultModelKey: "mimo/mimo-2.5-pro",
            providers: [{
                id: "mimo",
                name: "MiMo",
                adapter: {
                    type: "openai-compatible",
                    reasoningContentReplay: true,
                },
                options: {
                    apiKey: " test-key ",
                    baseURL: " https://example.test/v1 ",
                    proxy: "",
                    timeoutMs: 180_000,
                    requestOptions: {
                        store: false,
                    },
                },
                models: [{
                    name: "MiMo 2.5 Pro",
                    id: "mimo-2.5-pro",
                    group: null,
                    enabled: true,
                    contextWindowTokens: null,
                }],
            }],
        });

        expect(config.providers.mimo?.options).toMatchObject({
            apiKey: "test-key",
            baseURL: "https://example.test/v1",
            timeoutMs: 180_000,
            requestOptions: {
                store: false,
            },
        });
    });

    it("读取模型设置时会返回 provider 请求超时时间", () => {
        const dto = buildModelSettingsDto({
            models: {
                defaultModelKey: "mimo/mimo-2.5-pro",
                providers: {
                    mimo: {
                        name: "MiMo",
                        adapter: {
                            type: "openai-compatible",
                            reasoningContentReplay: true,
                        },
                        options: {
                            apiKey: "test-key",
                            baseURL: "https://example.test/v1",
                            proxy: "",
                            timeoutMs: 240_000,
                            requestOptions: {
                                store: false,
                            },
                        },
                        models: {
                            "mimo-2.5-pro": {
                                name: "MiMo 2.5 Pro",
                                id: "mimo-2.5-pro",
                                group: null,
                                enabled: true,
                                contextWindowTokens: null,
                            },
                        },
                    },
                },
            },
        } satisfies Pick<AppConfig, "models">);

        expect(dto.providers[0]?.options.timeoutMs).toBe(240_000);
        expect(dto.providers[0]?.options.requestOptions).toEqual({
            store: false,
        });
    });

    it("创建聊天模型时会把 provider 请求超时传给 SDK", () => {
        const model = createConfiguredChatModel({
            models: {
                defaultModelKey: "pioneer/claude-sonnet-4-6",
                providers: {
                    pioneer: {
                        name: "Pioneer",
                        adapter: {
                            type: "openai-compatible",
                            reasoningContentReplay: true,
                        },
                        options: {
                            apiKey: "test-key",
                            baseURL: "https://api.pioneer.ai/v1",
                            proxy: "",
                            timeoutMs: 360_000,
                            requestOptions: {},
                        },
                        models: {
                            "claude-sonnet-4-6": {
                                name: "Claude Sonnet 4.6",
                                id: "claude-sonnet-4-6",
                                group: "pioneer",
                                enabled: true,
                                contextWindowTokens: null,
                            },
                        },
                    },
                },
            },
        } satisfies Pick<AppConfig, "models">);

        expect((model as unknown as {timeout?: number}).timeout).toBe(360_000);
    });

    it("创建聊天模型时会把 provider 请求扩展参数并入请求体", () => {
        const model = createConfiguredChatModel({
            models: {
                defaultModelKey: "pioneer/claude-sonnet-4-6",
                providers: {
                    pioneer: {
                        name: "Pioneer",
                        adapter: {
                            type: "openai-compatible",
                            reasoningContentReplay: true,
                        },
                        options: {
                            apiKey: "test-key",
                            baseURL: "https://api.pioneer.ai/v1",
                            proxy: "",
                            timeoutMs: 360_000,
                            requestOptions: {
                                store: false,
                                extra_body: {
                                    timeout: 360,
                                },
                            },
                        },
                        models: {
                            "claude-sonnet-4-6": {
                                name: "Claude Sonnet 4.6",
                                id: "claude-sonnet-4-6",
                                group: "pioneer",
                                enabled: true,
                                contextWindowTokens: null,
                            },
                        },
                    },
                },
            },
        } satisfies Pick<AppConfig, "models">);

        const params = (model as unknown as {invocationParams: () => Record<string, unknown>}).invocationParams();
        expect(params.store).toBe(false);
        expect(params.extra_body).toEqual({
            timeout: 360,
        });
    });
});

describe("normalizeDeepSeekUsageMetadata", () => {
    it("会把 DeepSeek raw usage 归一化到 LangChain usage_metadata", () => {
        const message = new AIMessage({
            content: "完成",
            response_metadata: {
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 20,
                    total_tokens: 120,
                    prompt_cache_hit_tokens: 64,
                    prompt_cache_miss_tokens: 36,
                },
            },
        });

        normalizeDeepSeekUsageMetadata(message);

        expect(message.usage_metadata).toEqual({
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_token_details: {
                cache_read: 64,
                cache_miss: 36,
            },
        });
    });
});

describe("convertDeepSeekMessagesToCompletionsParams", () => {
    it("会给当前用户轮次内的 assistant tool-call 回填 reasoning_content", () => {
        const params = convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "需要读取文件",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
        ], "deepseek-reasoner");

        expect(params[1]).toMatchObject({
            role: "assistant",
            reasoning_content: "需要读取文件",
        });
    });

    it("会把历史用户轮次中发生过 tool-call 的 reasoning_content 继续带入新请求", () => {
        const params = convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("上一轮"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "旧思考",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
            new HumanMessage("下一轮"),
        ], "deepseek-reasoner");

        expect(params[1]).toMatchObject({
            role: "assistant",
            reasoning_content: "旧思考",
        });
    });

    it("会兼容 reasoning 与 tool-call 被拆成相邻 assistant 消息的 LangGraph 中间态", () => {
        const params = convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "先思考再调用工具",
                },
            }),
            new AIMessage({
                content: "",
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
        ], "deepseek-reasoner");

        expect(params[2]).toMatchObject({
            role: "assistant",
            reasoning_content: "先思考再调用工具",
        });
    });

    it("会回传已有 assistant reasoning_content，非工具轮次交给 DeepSeek 忽略", () => {
        const params = convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("上一轮"),
            new AIMessage({
                content: "完成",
                additional_kwargs: {
                    reasoning_content: "普通思考",
                },
            }),
            new HumanMessage("下一轮"),
        ], "deepseek-reasoner");

        expect(params[1]).toMatchObject({
            role: "assistant",
            reasoning_content: "普通思考",
        });
    });

    it("工具轮次最终 assistant 即使没有 tool-call 也会回传 reasoning_content", () => {
        const params = convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "先调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
            new AIMessage({
                content: "最终回答",
                additional_kwargs: {
                    reasoning_content: "工具结果已拿到，整理答案",
                },
            }),
            new HumanMessage("下一轮"),
        ], "deepseek-reasoner");

        expect(params[3]).toMatchObject({
            role: "assistant",
            reasoning_content: "工具结果已拿到，整理答案",
        });
    });

    it("tool-call assistant 缺少 reasoning_content 时提前报错", () => {
        expect(() => convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
        ], "deepseek-reasoner")).toThrow(/缺少 reasoning_content/);
    });

    it("非 thinking DeepSeek 模型不要求 tool-call assistant 携带 reasoning_content", () => {
        const params = convertDeepSeekMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
        ], "deepseek-chat");

        expect(params[1]).toMatchObject({
            role: "assistant",
            tool_calls: expect.any(Array),
        });
        expect("reasoning_content" in params[1]!).toBe(false);
    });
});

describe("convertOpenAiCompatibleMessagesToCompletionsParams", () => {
    it("默认会给 assistant tool-call 回填 reasoning_content", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "需要调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
        ], "mimo-v2.5-pro");

        expect(params[1]).toMatchObject({
            role: "assistant",
            reasoning_content: "需要调用工具",
        });
    });

    it("会从 LangChain 标准 reasoning block 回填 reasoning_content", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: [{
                    type: "reasoning",
                    reasoning: "标准思考块",
                }, {
                    type: "text",
                    text: "",
                }],
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {
                        filePath: "AGENTS.md",
                    },
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "文件内容",
                tool_call_id: "call-1",
            }),
        ], "mimo-v2.5-pro");

        expect(params[1]).toMatchObject({
            role: "assistant",
            reasoning_content: "标准思考块",
        });
    });

    it("关闭 reasoningContentReplay 后不会回填 reasoning_content", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "需要调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
        ], "mimo-v2.5-pro", {
            reasoningContentReplay: false,
        });

        expect("reasoning_content" in params[1]!).toBe(false);
    });

    it("非严格模式不会误伤没有 reasoning_content 的普通工具调用历史", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("查一下"),
            new AIMessage({
                content: "",
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
        ], "普通 OpenAI 兼容模型");

        expect(params[1]).toMatchObject({
            role: "assistant",
            tool_calls: expect.any(Array),
        });
        expect("reasoning_content" in params[1]!).toBe(false);
    });

    it("最终请求参数会使用已归一化的 raw tool_call id", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("上一轮"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "第一次调用工具",
                    tool_calls: [{
                        id: "call-1",
                        type: "function",
                        function: {
                            name: "read_file",
                            arguments: "{}",
                        },
                    }],
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "第一次",
                tool_call_id: "call-1",
            }),
            new HumanMessage("下一轮"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "第二次调用工具",
                    tool_calls: [{
                        id: "call-1__turn_2",
                        type: "function",
                        function: {
                            name: "read_file",
                            arguments: "{}",
                        },
                    }],
                },
                tool_calls: [{
                    id: "call-1__turn_2",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "第二次",
                tool_call_id: "call-1__turn_2",
            }),
        ], "mimo-v2.5-pro");

        const toolCallIds = params
            .filter((param): param is typeof param & {tool_calls: Array<{id: string}>} => "tool_calls" in param && Array.isArray(param.tool_calls))
            .flatMap((param) => param.tool_calls.map((toolCall) => toolCall.id));

        expect(toolCallIds).toEqual(["call-1", "call-1__turn_2"]);
        expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
    });

    it("最终请求参数不会在 content 内保留工具调用块", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("上一轮"),
            new AIMessage({
                content: [{
                    type: "text",
                    text: "准备调用工具",
                }],
                additional_kwargs: {
                    reasoning_content: "需要调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "第一次",
                tool_call_id: "call-1",
            }),
        ], "mimo-v2.5-pro");

        expect(params[1]).toMatchObject({
            role: "assistant",
            tool_calls: expect.any(Array),
        });
        expect(params[1]?.content).toEqual([{
            type: "text",
            text: "准备调用工具",
        }]);
    });

    it("最终请求参数会清理 content 内残留的工具调用块", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("上一轮"),
            new AIMessage({
                content: [{
                    type: "text",
                    text: "准备调用工具",
                }, {
                    type: "tool_call",
                    id: "call-1",
                    name: "read_file",
                    args: {},
                }, {
                    type: "tool_use",
                    id: "call-1",
                    name: "write_file",
                    input: {},
                }],
                additional_kwargs: {
                    reasoning_content: "需要调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "第一次",
                tool_call_id: "call-1",
            }),
        ], "mimo-v2.5-pro");

        expect(params[1]?.content).toEqual([{
            type: "text",
            text: "准备调用工具",
        }]);
        expect(JSON.stringify(params[1]?.content)).not.toContain("tool_use");
        expect(JSON.stringify(params[1]?.content)).not.toContain("tool_call");
    });

    it("最终请求参数会兜底修复重复 tool_call id 并同步 tool result", () => {
        const params = convertOpenAiCompatibleMessagesToCompletionsParams([
            new HumanMessage("上一轮"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "第一次调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "read_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "第一次",
                tool_call_id: "call-1",
            }),
            new HumanMessage("下一轮"),
            new AIMessage({
                content: "",
                additional_kwargs: {
                    reasoning_content: "第二次调用工具",
                },
                tool_calls: [{
                    id: "call-1",
                    name: "write_file",
                    args: {},
                    type: "tool_call",
                }],
            }),
            new ToolMessage({
                content: "第二次",
                tool_call_id: "call-1",
            }),
        ], "mimo-v2.5-pro");

        const toolCallIds = params
            .filter((param): param is typeof param & {tool_calls: Array<{id: string}>} => "tool_calls" in param && Array.isArray(param.tool_calls))
            .flatMap((param) => param.tool_calls.map((toolCall) => toolCall.id));
        const toolResultIds = params
            .filter((param): param is typeof param & {tool_call_id: string} => param.role === "tool")
            .map((param) => param.tool_call_id);

        expect(toolCallIds).toEqual(["call-1", "call-1__turn_2"]);
        expect(toolResultIds).toEqual(toolCallIds);
        expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
    });
});

describe("normalizeOpenAiCompatibleReasoningMessage", () => {
    it("会把 reasoning_content 暴露为 LangChain 标准 reasoning block", () => {
        const message = normalizeOpenAiCompatibleReasoningMessage(new AIMessage({
            content: "正文",
            additional_kwargs: {
                reasoning_content: "思考",
            },
        }));

        expect(message.contentBlocks).toEqual([
            {
                type: "reasoning",
                reasoning: "思考",
            },
            {
                type: "text",
                text: "正文",
            },
        ]);
    });
});

describe("NeuroBookChatOpenAICompatible", () => {
    it("流式 delta 缺少 role 时仍输出 AIMessageChunk 供 thread-runner 提取 thinking", async () => {
        const model = createMockOpenAiCompatibleModel();
        const patchableModel = model as unknown as {
            /**
             * 测试替换网络层，避免真实访问 provider。
             */
            completionWithRetry: () => Promise<AsyncIterable<unknown>>;
        };
        patchableModel.completionWithRetry = async () => (async function* () {
            yield {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                created: 0,
                model: "mimo-v2.5-pro",
                choices: [{
                    index: 0,
                    delta: {
                        reasoning_content: "先分析问题",
                    },
                    finish_reason: null,
                }],
            };
            yield {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                created: 0,
                model: "mimo-v2.5-pro",
                choices: [{
                    index: 0,
                    delta: {
                        content: "完成",
                    },
                    finish_reason: null,
                }],
            };
            yield {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                created: 0,
                model: "mimo-v2.5-pro",
                choices: [],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 20,
                    total_tokens: 120,
                    prompt_tokens_details: {
                        cached_tokens: 64,
                    },
                    completion_tokens_details: {
                        reasoning_tokens: 11,
                    },
                },
            };
        })();

        const chunks = [];
        for await (const chunk of await model.stream([new HumanMessage("测试")])) {
            chunks.push(chunk);
        }

        expect(AIMessageChunk.isInstance(chunks[0])).toBe(true);
        expect(extractAssistantDeltaFromChunk(chunks[0] as AIMessageChunk)).toMatchObject({
            thinkingText: "先分析问题",
        });
        expect((chunks.at(-1) as AIMessageChunk).usage_metadata).toEqual({
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_token_details: {
                cache_read: 64,
            },
            output_token_details: {
                reasoning: 11,
            },
        });
    });

    it("非流式响应会保留 OpenAI-compatible usage details", async () => {
        const model = createMockOpenAiCompatibleModel({
            stream: false,
        });
        const patchableModel = model as unknown as {
            /**
             * 测试替换网络层，避免真实访问 provider。
             */
            completionWithRetry: () => Promise<unknown>;
        };
        patchableModel.completionWithRetry = async () => ({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 0,
            model: "mimo-v2.5-pro",
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: "完成",
                },
                finish_reason: "stop",
            }],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
                prompt_tokens_details: {
                    audio_tokens: 3,
                    cached_tokens: 64,
                },
                completion_tokens_details: {
                    audio_tokens: 2,
                    reasoning_tokens: 11,
                },
            },
        });

        const message = await model.invoke([new HumanMessage("测试")]);

        expect(message.usage_metadata).toEqual({
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_token_details: {
                audio: 3,
                cache_read: 64,
            },
            output_token_details: {
                audio: 2,
                reasoning: 11,
            },
        });
    });
});
