import {describe, expect, it} from "vitest";
import {applyRuntimeEventToMessages, applySessionEntryToMessages, deriveMessagesFromSessionSnapshot, isContinuationPointMessage, type AgentMessage} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";

const baseSnapshot = (entries: AgentSessionSnapshotDto["entries"]): AgentSessionSnapshotDto => ({
    eventEpoch: "epoch-1",
    summary: {
        sessionId: 1,
        profileKey: "leader.default",
        workspaceKey: "global",
        workspaceRoot: ".",
        status: "idle",
        updatedAt: 1,
        archived: false,
    },
    activeLeafId: null,
    activePathRevision: null,
    messages: [],
    tree: [],
    entries,
    linkedAgents: [],
    linkedByAgents: [],
    pendingApproval: null,
    steerQueue: [],
    followUpQueue: {
        status: "ready",
        items: [],
    },
    activeInvocation: null,
    model: null,
    thinkingLevel: null,
    effectiveThinkingLevel: "off",
    planModeActive: false,
    lastSeq: 0,
});

describe("agent message projection", () => {
    it("只在调用方允许时把工具已完成的 AI 卡片作为空输入继续断点", () => {
        expect(isContinuationPointMessage(undefined)).toBe(false);
        expect(isContinuationPointMessage({
            id: "user-1",
            type: "user",
            content: "继续",
        })).toBe(true);
        expect(isContinuationPointMessage({
            id: "ai-text",
            type: "ai",
            content: "普通回复",
        })).toBe(false);
        expect(isContinuationPointMessage({
            id: "ai-tool",
            type: "ai",
            content: "",
            toolCalls: [{
                id: "tool-1",
                index: 0,
                name: "bash",
                argsText: "{}",
                status: "success",
            }],
        }, {allowSettledAiToolCalls: true})).toBe(true);
        expect(isContinuationPointMessage({
            id: "ai-tool-completed-session",
            type: "ai",
            content: "",
            toolCalls: [{
                id: "tool-1",
                index: 0,
                name: "bash",
                argsText: "{}",
                status: "success",
            }],
        })).toBe(false);
        expect(isContinuationPointMessage({
            id: "ai-running-tool",
            type: "ai",
            content: "",
            toolCalls: [{
                id: "tool-1",
                index: 0,
                name: "bash",
                argsText: "{}",
                status: "running",
            }],
        })).toBe(false);
    });

    it("在对话顶部展示当前 profile system prompt", () => {
        const snapshot = baseSnapshot([]);
        snapshot.systemPrompt = "# Leader\n\n保持协作。";

        const messages = deriveMessagesFromSessionSnapshot(snapshot);

        expect(messages[0]).toEqual(expect.objectContaining({
            id: "system-prompt:1:leader.default",
            type: "system",
            systemDisplayKind: "prompt",
            systemLabel: "System Prompt",
            content: "# Leader\n\n保持协作。",
        }));
    });

    it("把 system-reminder custom_message 投影为轻量系统提醒", () => {
        const messages = deriveMessagesFromSessionSnapshot(baseSnapshot([{
            id: "reminder-1",
            parentId: null,
            timestamp: Date.now(),
            type: "custom_message",
            visibleToModel: true,
            message: {
                role: "custom",
                customType: "system-reminder",
                content: "<system-reminder>记得检查计划。</system-reminder>",
                display: true,
                timestamp: Date.now(),
            } as never,
        }]));

        expect(messages).toEqual([
            expect.objectContaining({
                id: "reminder-1",
                type: "system",
                systemDisplayKind: "reminder",
                systemLabel: "System Reminder",
                content: "<system-reminder>记得检查计划。</system-reminder>",
            }),
        ]);
    });

    it("把普通 custom_message 与 compaction/branch summary 投影为系统卡片", () => {
        const messages = deriveMessagesFromSessionSnapshot(baseSnapshot([
            {
                id: "custom-1",
                parentId: null,
                timestamp: Date.now(),
                type: "custom_message",
                visibleToModel: true,
                message: {
                    role: "custom",
                    customType: "note",
                    content: "运行期提示",
                    display: true,
                    timestamp: Date.now(),
                } as never,
            },
            {
                id: "compact-1",
                parentId: "custom-1",
                timestamp: Date.now(),
                type: "compaction",
                summary: "压缩摘要",
                firstKeptEntryId: null,
                tokensBefore: 100,
            },
            {
                id: "branch-1",
                parentId: "compact-1",
                timestamp: Date.now(),
                type: "branch_summary",
                fromLeafId: "a",
                toLeafId: "b",
                summary: "分支摘要",
            },
        ]));

        expect(messages.map((message) => ({
            id: message.id,
            label: message.systemLabel,
            content: message.content,
        }))).toEqual([
            {id: "custom-1", label: "Custom: note", content: "运行期提示"},
            {id: "compact-1", label: "Compaction", content: "压缩摘要"},
            {id: "branch-1", label: "Branch Summary", content: "分支摘要"},
        ]);
    });

    it("把已消费的 steer 历史消息展示为引导并隐藏模型前缀", () => {
        const messages = deriveMessagesFromSessionSnapshot(baseSnapshot([{
            id: "steer-1",
            parentId: null,
            timestamp: Date.now(),
            type: "message",
            origin: "harness",
            message: {
                role: "user",
                content: [{type: "text", text: "<user_steer>\n调整方向\n</user_steer>"}],
                timestamp: Date.now(),
            } as never,
        }]));

        expect(messages).toEqual([
            expect.objectContaining({
                id: "steer-1",
                type: "user",
                intent: "steer",
                content: "调整方向",
            }),
        ]);
    });

    it("session_entry 增量到达时直接显示已消费 steer", () => {
        const messages = applySessionEntryToMessages([], {
            id: "steer-live-1",
            parentId: null,
            timestamp: Date.now(),
            type: "message",
            origin: "harness",
            message: {
                role: "user",
                content: [{type: "text", text: "<user_steer>\n继续沿这个方向\n</user_steer>"}],
                timestamp: Date.now(),
            } as never,
        });

        expect(messages).toEqual([
            expect.objectContaining({
                id: "steer-live-1",
                type: "user",
                intent: "steer",
                content: "继续沿这个方向",
            }),
        ]);
    });

    it("把重启后缺少 toolResult 的普通工具调用标记为中断", () => {
        const messages = deriveMessagesFromSessionSnapshot(baseSnapshot([
            {
                id: "assistant-1",
                parentId: null,
                timestamp: Date.now(),
                type: "message",
                origin: "harness",
                message: {
                    role: "assistant",
                    content: [
                        {type: "toolCall", id: "call-ok", name: "bash", arguments: {command: "pwd"}},
                        {type: "toolCall", id: "call-stale", name: "read", arguments: {path: "novel-7/AGENTS.md"}},
                    ],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            total: 0,
                        },
                    },
                    stopReason: "toolUse",
                    timestamp: Date.now(),
                } as never,
            },
            {
                id: "tool-1",
                parentId: "assistant-1",
                timestamp: Date.now(),
                type: "message",
                origin: "harness",
                message: {
                    role: "toolResult",
                    toolCallId: "call-ok",
                    toolName: "bash",
                    content: [{type: "text", text: "/workspace"}],
                    isError: false,
                    timestamp: Date.now(),
                } as never,
            },
        ]));

        const assistant = messages.find((message) => message.id === "assistant-1");
        expect(assistant?.toolCalls?.find((toolCall) => toolCall.id === "call-ok")).toEqual(expect.objectContaining({
            status: "success",
        }));
        expect(assistant?.toolCalls?.find((toolCall) => toolCall.id === "call-stale")).toEqual(expect.objectContaining({
            status: "error",
            error: expect.stringContaining("服务重启"),
        }));
    });

    it("保留 pending approval 的缺失 toolResult 等待态", () => {
        const snapshot = baseSnapshot([{
            id: "assistant-approval",
            parentId: null,
            timestamp: Date.now(),
            type: "message",
            origin: "harness",
            message: {
                role: "assistant",
                content: [
                    {type: "toolCall", id: "approval-call", name: "request_user_input", arguments: {questions: [{question: "继续吗？"}]}},
                ],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        total: 0,
                    },
                },
                stopReason: "toolUse",
                timestamp: Date.now(),
            } as never,
        }]);
        snapshot.pendingApproval = {
            assistantMessageId: "assistant-approval",
            toolCallId: "approval-call",
            toolName: "request_user_input",
            args: {questions: [{question: "继续吗？"}]},
        };

        const messages = deriveMessagesFromSessionSnapshot(snapshot);

        expect(messages[0]?.toolCalls?.[0]?.status).toBe("streaming");
        expect(messages[0]?.toolCalls?.[0]?.error).toBeUndefined();
    });

    it("用 assistant thinking_delta 兜底追加思维链", () => {
        const previous: AgentMessage[] = [{
            id: "assistant:1",
            type: "ai" as const,
            content: "",
            status: "streaming" as const,
            thinking: "先分析",
        }];

        const messages = applyRuntimeEventToMessages(previous, {
            type: "message_update",
            message: {
                role: "assistant",
                content: [],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "stop",
                timestamp: 1,
            } as never,
            assistantMessageEvent: {
                type: "thinking_delta",
                contentIndex: 0,
                delta: "再判断",
                partial: {
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                    stopReason: "stop",
                    timestamp: 1,
                },
            } as never,
        });

        expect(messages[0]?.thinking).toBe("先分析再判断");
    });

    it("首帧 message_update 没有 previous message 时仍应用 text_delta", () => {
        const messages = applyRuntimeEventToMessages([], {
            type: "message_update",
            message: {
                role: "assistant",
                content: [],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "stop",
                timestamp: 1,
            } as never,
            assistantMessageEvent: {
                type: "text_delta",
                contentIndex: 0,
                delta: "你好",
                partial: {
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                    stopReason: "stop",
                    timestamp: 1,
                },
            } as never,
        });

        expect(messages[0]?.content).toBe("你好");
        expect(messages[0]?.assistantContent).toEqual([{type: "text", text: "你好"}]);
    });

    it("任意工具都能用 assistant toolcall_delta 流式追加工具参数", () => {
        const previous = [{
            id: "assistant:1",
            type: "ai" as const,
            content: "",
            status: "streaming" as const,
            toolCalls: [{
                id: "call-1",
                index: 0,
                name: "get_session",
                argsText: "{\"includeRecentMessages\":true,\"recentMessageRoles\":[\"",
                status: "streaming" as const,
                assistantMessageId: "assistant:1",
            }],
        }];

        const messages = applyRuntimeEventToMessages(previous, {
            type: "message_update",
            message: {
                role: "assistant",
                content: [],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "toolUse",
                timestamp: 1,
            } as never,
            assistantMessageEvent: {
                type: "toolcall_delta",
                contentIndex: 0,
                delta: "hello",
                partial: {
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                    stopReason: "toolUse",
                    timestamp: 1,
                },
            } as never,
        });

        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            name: "get_session",
            argsText: "{\"includeRecentMessages\":true,\"recentMessageRoles\":[\"hello",
        }));
    });

    it("toolcall_end 用真实 id 替换 content placeholder", () => {
        const previous: AgentMessage[] = [{
            id: "assistant:1",
            type: "ai",
            content: "",
            status: "streaming",
            toolCalls: [{
                id: "content-0",
                index: 0,
                name: "",
                argsText: "{\"path\":\"a.md\"}",
                status: "streaming",
                assistantMessageId: "assistant:1",
            }],
            assistantContent: [
                {type: "toolCall", id: "content-0", name: "", arguments: "{\"path\":\"a.md\"}"} as never,
            ],
        }];

        const messages = applyRuntimeEventToMessages(previous, {
            type: "message_update",
            message: {
                role: "assistant",
                content: [],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "toolUse",
                timestamp: 1,
            } as never,
            assistantMessageEvent: {
                type: "toolcall_end",
                contentIndex: 0,
                toolCall: {
                    type: "toolCall",
                    id: "call-real",
                    name: "write",
                    arguments: "{\"path\":\"a.md\"}",
                },
                partial: {
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                    stopReason: "toolUse",
                    timestamp: 1,
                },
            } as never,
        });

        expect(messages[0]?.toolCalls?.map((toolCall) => toolCall.id)).toEqual(["call-real"]);
    });

    it("按 contentIndex 合并交错的 thinking/text/toolCall block", () => {
        const previous = [{
            id: "assistant:1",
            type: "ai" as const,
            content: "正文",
            status: "streaming" as const,
            thinking: "思考",
            toolCalls: [
                {
                    id: "call-a",
                    index: 0,
                    name: "read",
                    argsText: "{\"path\":\"a",
                    status: "streaming" as const,
                    assistantMessageId: "assistant:1",
                },
                {
                    id: "call-b",
                    index: 1,
                    name: "write",
                    argsText: "{\"path\":\"b",
                    status: "streaming" as const,
                    assistantMessageId: "assistant:1",
                },
            ],
        }];

        const messages = applyRuntimeEventToMessages(previous, {
            type: "message_update",
            message: {
                role: "assistant",
                content: [],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "toolUse",
                timestamp: 1,
            } as never,
            assistantMessageEvent: {
                type: "toolcall_delta",
                contentIndex: 3,
                delta: ".md\"}",
                partial: {
                    role: "assistant",
                    content: [
                        {type: "thinking", thinking: "思考"},
                        {type: "text", text: "正文"},
                        {type: "toolCall", id: "call-a", name: "read", arguments: "{\"path\":\"a"},
                        {type: "toolCall", id: "call-b", name: "write", arguments: "{\"path\":\"b.md\"}"},
                    ],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                    stopReason: "toolUse",
                    timestamp: 1,
                },
            } as never,
        });

        expect(messages[0]?.thinking).toBe("思考");
        expect(messages[0]?.content).toBe("正文");
        expect(messages[0]?.toolCalls?.find((toolCall) => toolCall.id === "call-a")?.argsText).toBe("{\"path\":\"a");
        expect(messages[0]?.toolCalls?.find((toolCall) => toolCall.id === "call-b")?.argsText).toBe("{\"path\":\"b.md\"}");
    });

    it("partial 缺少完整 content 时仍按原始 contentIndex 更新工具参数", () => {
        const previous: AgentMessage[] = [{
            id: "assistant:1",
            type: "ai" as const,
            content: "正文",
            status: "streaming" as const,
            toolCalls: [{
                id: "call-b",
                index: 2,
                name: "write",
                argsText: "{\"path\":\"b",
                status: "streaming" as const,
                assistantMessageId: "assistant:1",
            }],
            assistantContent: [
                {type: "text", text: "正文"},
                {type: "thinking", thinking: "思考"},
                {type: "toolCall", id: "call-b", name: "write", arguments: "{\"path\":\"b"} as never,
            ],
        }];

        const messages = applyRuntimeEventToMessages(previous, {
            type: "message_update",
            message: {
                role: "assistant",
                content: [],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "toolUse",
                timestamp: 1,
            } as never,
            assistantMessageEvent: {
                type: "toolcall_delta",
                contentIndex: 2,
                delta: ".md\"}",
                partial: {
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "test",
                    model: "test",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                    },
                    stopReason: "toolUse",
                    timestamp: 1,
                },
            } as never,
        });

        expect(messages[0]?.content).toBe("正文");
        expect(messages[0]?.toolCalls?.find((toolCall) => toolCall.id === "call-b")?.argsText).toBe("{\"path\":\"b.md\"}");
    });

    it("tool_execution_start 没有已有 assistant toolCall 时创建 live 工具气泡", () => {
        const messages = applyRuntimeEventToMessages([], {
            type: "tool_execution_start",
            toolCallId: "invoke-1",
            toolName: "invoke_agent",
            args: {sessionId: 15, mode: "continue"},
        }, "invocation-1");

        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual(expect.objectContaining({
            id: "tool-execution:invoke-1",
            type: "ai",
            content: "",
            status: "streaming",
            invocationId: "invocation-1",
        }));
        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            id: "invoke-1",
            assistantMessageId: "tool-execution:invoke-1",
            name: "invoke_agent",
            status: "running",
            linkedSessionId: 15,
        }));
    });

    it("tool_execution_end 能更新 live fallback 工具气泡", () => {
        const runningMessages = applyRuntimeEventToMessages([], {
            type: "tool_execution_start",
            toolCallId: "invoke-1",
            toolName: "invoke_agent",
            args: {sessionId: 15},
        }, "invocation-1");

        const doneMessages = applyRuntimeEventToMessages(runningMessages, {
            type: "tool_execution_end",
            toolCallId: "invoke-1",
            toolName: "invoke_agent",
            result: {
                content: [{type: "text", text: "子 Agent 完成"}],
                details: {sessionId: 15, status: "completed"},
            },
            isError: false,
        });

        expect(doneMessages).toHaveLength(1);
        expect(doneMessages[0]?.status).toBe("done");
        expect(doneMessages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            id: "invoke-1",
            name: "invoke_agent",
            status: "success",
            result: "子 Agent 完成",
            linkedSessionId: 15,
        }));
    });

    it("真实 assistant toolCall 到达时移除同 id 的 live fallback 气泡", () => {
        const runningMessages = applyRuntimeEventToMessages([], {
            type: "tool_execution_start",
            toolCallId: "invoke-1",
            toolName: "invoke_agent",
            args: {sessionId: 15},
        });

        const messages = applyRuntimeEventToMessages(runningMessages, {
            type: "message_end",
            message: {
                role: "assistant",
                content: [
                    {type: "toolCall", id: "invoke-1", name: "invoke_agent", arguments: {sessionId: 15}},
                ],
                api: "test",
                provider: "test",
                model: "test",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
                },
                stopReason: "toolUse",
                timestamp: 1,
            } as never,
        });

        expect(messages.map((message) => message.id)).toEqual(["assistant:1"]);
        expect(messages[0]?.toolCalls?.[0]).toEqual(expect.objectContaining({
            id: "invoke-1",
            name: "invoke_agent",
            status: "running",
            linkedSessionId: 15,
        }));
    });

});
