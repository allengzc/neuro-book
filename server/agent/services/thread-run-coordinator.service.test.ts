import {AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage} from "@langchain/core/messages";
import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {describe, expect, it, vi} from "vitest";
import {ThreadRunCoordinator} from "nbook/server/agent/services/thread-run-coordinator.service";
import {ThreadMessageService} from "nbook/server/agent/services/thread-message.service";
import {ActiveRunSession} from "nbook/server/agent/runtime/live-run-registry";
import {TOOL_RESULT_RAW_KEY} from "nbook/server/agent/tools/shared/tool-message";
import {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {AgentStreamEvent, AgentThreadMetadata, AgentVariableScope} from "nbook/server/agent/types";

class TestLeaderProfile extends AgentProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "测试 Leader";
    readonly inputSchema = z.object({
        prompt: z.string(),
    });
    readonly allowedToolKeys = [];

    /**
     * 测试中不需要真实 prompt 组装。
     */
    async prepare(_runtime: ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>) {
        return {
            modelMessages: [],
            persistedMessages: {
                prepend: [],
                append: [],
            },
            immediateMetadata: {},
            completedMetadata: {},
        };
    }
}

class MetadataLeaderProfile extends TestLeaderProfile {
    constructor(private readonly metadata: {
        immediateMetadata?: AgentThreadMetadata;
        completedMetadata?: AgentThreadMetadata;
    }) {
        super();
    }

    /**
     * 测试 metadata 提交时机。
     */
    override async prepare(_runtime: ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>) {
        return {
            modelMessages: [],
            persistedMessages: {
                prepend: [],
                append: [],
            },
            immediateMetadata: this.metadata.immediateMetadata ?? {},
            completedMetadata: this.metadata.completedMetadata ?? {},
        };
    }
}

/**
 * 构造一个只产出固定事件序列的异步流。
 */
async function* createStream(events: unknown[]): AsyncIterable<unknown> {
    for (const event of events) {
        yield event;
    }
}

/**
 * 构造一个会抛错的异步流。
 */
async function* createFailingStream(error: Error): AsyncIterable<unknown> {
    throw error;
}

describe("ThreadRunCoordinator", () => {
    it("run 结束时保留工具运行中写入的 Plan Mode metadata", async () => {
        const touchAfterRun = vi.fn(async () => createThreadRecord({
            runStatus: "completed",
        }));
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([]),
            } as never,
            threadRepository: {
                findById: vi.fn(async () => createThreadRecord({
                    metadata: {
                        planMode: {
                            active: true,
                            enteredAt: "2026-05-04T00:00:00.000Z",
                            turnsSinceReminder: 0,
                            reminderCount: 0,
                            needsExitReminder: false,
                            hasExited: false,
                        },
                    },
                })),
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun,
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages: {
                finalizeAssistantSuccess: vi.fn(async () => []),
                buildSummary: vi.fn(() => "done"),
            } as unknown as ThreadMessageService,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(touchAfterRun).toHaveBeenCalledWith("1", expect.objectContaining({
            metadata: expect.objectContaining({
                planMode: expect.objectContaining({
                    active: true,
                }),
            }),
        }));
    });

    it("run 开始写入 Plan Mode reminder 历史后立即提交对应 metadata", async () => {
        const updateMetadata = vi.fn(async () => createThreadRecord());
        const touchAfterRun = vi.fn(async () => createThreadRecord({
            runStatus: "completed",
        }));
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([]),
            } as never,
            threadRepository: {
                findById: vi.fn(async () => createThreadRecord()),
                updateMetadata,
                touchAfterRun,
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages: {
                finalizeAssistantSuccess: vi.fn(async () => []),
                buildSummary: vi.fn(() => "done"),
            } as unknown as ThreadMessageService,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {
                planModeReminder: "full",
                planModeCommitMetadata: {
                    planMode: {
                        active: true,
                        enteredAt: "2026-05-04T00:00:00.000Z",
                        turnsSinceReminder: 0,
                        reminderCount: 1,
                        needsExitReminder: false,
                        hasExited: false,
                    },
                },
            },
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            planMode: expect.objectContaining({
                reminderCount: 1,
            }),
        }));
        expect(touchAfterRun).toHaveBeenCalledWith("1", expect.objectContaining({
            metadata: expect.objectContaining({
                planMode: expect.objectContaining({
                    reminderCount: 1,
                }),
            }),
        }));
    });

    it("run completed 后才提交 profile completed metadata", async () => {
        const updateMetadata = vi.fn(async () => createThreadRecord());
        const touchAfterRun = vi.fn(async () => createThreadRecord({
            runStatus: "completed",
        }));
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([]),
            } as never,
            threadRepository: {
                findById: vi.fn(async () => createThreadRecord()),
                updateMetadata,
                touchAfterRun,
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages: {
                finalizeAssistantSuccess: vi.fn(async () => []),
                buildSummary: vi.fn(() => "done"),
            } as unknown as ThreadMessageService,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new MetadataLeaderProfile({
                immediateMetadata: {
                    watchedVariables: {
                        "scope.studio.workspace": {
                            fingerprint: "\"novel\"",
                            hasValue: true,
                            value: "novel",
                        },
                    },
                },
                completedMetadata: {
                    reminders: {
                        workspace: {
                            fingerprint: "\"novel\"",
                            injectedAtTurn: 1,
                        },
                    },
                },
            }),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            watchedVariables: expect.objectContaining({
                "scope.studio.workspace": expect.objectContaining({
                    value: "novel",
                }),
            }),
        }));
        expect(updateMetadata).not.toHaveBeenCalledWith("1", expect.objectContaining({
            reminders: expect.anything(),
        }));
        expect(touchAfterRun).toHaveBeenCalledWith("1", expect.objectContaining({
            metadata: expect.objectContaining({
                reminders: expect.objectContaining({
                    workspace: expect.objectContaining({
                        injectedAtTurn: 1,
                    }),
                }),
            }),
        }));
    });

    it("run stopped 会保留已写入历史的 Plan Mode reminder metadata", async () => {
        const abortError = new Error("aborted");
        abortError.name = "AbortError";
        const touchAfterRun = vi.fn(async () => createThreadRecord({
            runStatus: "stopped",
        }));
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createFailingStream(abortError),
            } as never,
            threadRepository: {
                findById: vi.fn(async () => createThreadRecord()),
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun,
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages: {
                finalizeAssistantStopped: vi.fn(async () => []),
                buildSummary: vi.fn(() => "stopped"),
            } as unknown as ThreadMessageService,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => true),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {
                planModeReminder: "full",
                planModeCommitMetadata: {
                    planMode: {
                        active: true,
                        enteredAt: "2026-05-04T00:00:00.000Z",
                        turnsSinceReminder: 0,
                        reminderCount: 1,
                        needsExitReminder: false,
                        hasExited: false,
                    },
                },
            },
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(touchAfterRun).toHaveBeenCalledWith("1", expect.objectContaining({
            status: "stopped",
            metadata: expect.objectContaining({
                planMode: expect.objectContaining({
                    reminderCount: 1,
                }),
            }),
        }));
    });

    it("会把 system_prompt 前插到历史树根部，而不是追加到活动光标后", async () => {
        const prependMessages = vi.fn(async () => []);
        const appendMessages = vi.fn(async () => []);
        const insertMessagesBefore = vi.fn(async () => []);
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([]),
            } as never,
            threadRepository: {
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages: {
                finalizeAssistantSuccess: vi.fn(async () => []),
                buildSummary: vi.fn(() => ""),
            } as unknown as ThreadMessageService,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: {
                prepare: vi.fn(async () => ({
                    modelMessages: [],
                    persistedMessages: {
                        prepend: [{
                            message: new SystemMessage("你是 leader"),
                        }],
                        append: [{
                            message: new HumanMessage("变量变更"),
                        }],
                    },
                    immediateMetadata: {},
                    completedMetadata: {},
                })),
            } as unknown as AgentProfile<"leader.default">,
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {
                prependMessages,
                appendMessages,
                insertMessagesBefore,
            } as unknown as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(prependMessages).toHaveBeenCalledWith("1", {
            messages: [
                expect.objectContaining({
                    message: expect.objectContaining({
                        content: "你是 leader",
                    }),
                }),
            ],
        });
        expect(appendMessages).toHaveBeenCalledWith("1", {
            messages: [
                expect.objectContaining({
                    message: expect.objectContaining({
                        content: "变量变更",
                    }),
                }),
            ],
        });
        expect(insertMessagesBefore).not.toHaveBeenCalled();
    });

    it("continue 模式会把 AppendingSet 历史消息插入到尾部用户输入之前", async () => {
        const appendMessages = vi.fn(async () => []);
        const insertMessagesBefore = vi.fn(async () => []);
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([]),
            } as never,
            threadRepository: {
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages: {
                finalizeAssistantSuccess: vi.fn(async () => []),
                buildSummary: vi.fn(() => ""),
            } as unknown as ThreadMessageService,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: {
                prepare: vi.fn(async () => ({
                    modelMessages: [],
                    persistedMessages: {
                        prepend: [],
                        append: [{
                            message: new SystemMessage("workspace reminder"),
                        }],
                        appendBeforeMessageId: "user-current",
                    },
                    immediateMetadata: {},
                    completedMetadata: {},
                })),
                ingest: vi.fn(async (input) => input.messages),
            } as unknown as AgentProfile<"leader.default">,
            input: {
                mode: "continue",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {
                appendMessages,
                insertMessagesBefore,
            } as unknown as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(insertMessagesBefore).toHaveBeenCalledWith("1", {
            beforeMessageId: "user-current",
            messages: [
                expect.objectContaining({
                    message: expect.objectContaining({
                        content: "workspace reminder",
                    }),
                }),
            ],
        });
        expect(appendMessages).not.toHaveBeenCalled();
    });

    it("会发布完整的 tool 成功链路并更新线程终态", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "先回答",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        vi.spyOn(threadMessages, "finalizeAssistantSuccess").mockResolvedValue([
            new AIMessage({
                content: "后续回答",
                additional_kwargs: {
                    messageId: "assistant-2",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:01.000Z",
                },
            }),
        ]);
        vi.spyOn(threadMessages, "buildSummary").mockReturnValue("最终总结");

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "先回答",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-1",
                                        name: "read_file",
                                        args: "{\"filePath\":\"chapter.md\"}",
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "read_file",
                        run_id: "run-tool-1",
                        data: {
                            input: "{\"filePath\":\"chapter.md\"}",
                        },
                    },
                    {
                        event: "on_tool_end",
                        name: "read_file",
                        run_id: "run-tool-1",
                        data: {
                            output: "文件内容",
                        },
                    },
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "后续回答",
                                tool_call_chunks: [],
                            },
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(threadMessages.finalizeAssistantIteration).toHaveBeenCalledTimes(1);
        expect(threadMessages.persistToolMessage).toHaveBeenCalledTimes(1);
        expect(threadMessages.finalizeAssistantSuccess).toHaveBeenCalledTimes(1);
        expect(publishedEvents.map((event) => event.type)).toEqual([
            "assistant_delta",
            "tool_call_started",
            "tool_args_delta",
            "tool_exec_started",
            "assistant_done",
            "tool_finished",
            "assistant_delta",
            "assistant_done",
            "run_state",
        ]);
        expect(publishedEvents.at(-1)).toMatchObject({
            type: "run_state",
            status: "completed",
        });
    });

    it("会把 invoke_subagent 参数中的数字 subagentThreadId 归一化后绑定 live tool", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        vi.spyOn(threadMessages, "finalizeAssistantSuccess").mockResolvedValue([
            new AIMessage({
                content: "完成",
                additional_kwargs: {
                    messageId: "assistant-2",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:01.000Z",
                },
            }),
        ]);
        vi.spyOn(threadMessages, "buildSummary").mockReturnValue("完成");

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [{
                                    index: 0,
                                    id: "call-subagent-1",
                                    name: "invoke_subagent",
                                    args: JSON.stringify({
                                        subagentThreadId: 203,
                                        input: {
                                            prompt: "写一章正文",
                                            plotPoints: ["30"],
                                            lorebookEntries: [{
                                                path: "lorebook/character/test/",
                                            }],
                                        },
                                    }),
                                }],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "invoke_subagent",
                        run_id: "run-subagent-1",
                        data: {
                            input: JSON.stringify({
                                subagentThreadId: 203,
                                input: {
                                    prompt: "写一章正文",
                                    plotPoints: ["30"],
                                    lorebookEntries: [{
                                        path: "lorebook/character/test/",
                                    }],
                                },
                            }),
                        },
                    },
                    {
                        event: "on_tool_end",
                        name: "invoke_subagent",
                        run_id: "run-subagent-1",
                        data: {
                            output: "完成",
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "tool_call_started",
            subagentThreadId: "203",
        }));
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "tool_exec_started",
            subagentThreadId: "203",
        }));
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "tool_finished",
            subagentThreadId: "203",
        }));
    });

    it("会把重叠 assistant/thinking chunk 归一化后再广播并落盘", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const finalizeAssistantSuccess = vi.spyOn(threadMessages, "finalizeAssistantSuccess");
        vi.spyOn(threadMessages, "buildSummary").mockReturnValue("按照你提供的模板");

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: new AIMessageChunk({
                                content: "按照你",
                                additional_kwargs: {
                                    reasoning_content: "第一段思考",
                                },
                            }),
                        },
                    },
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: new AIMessageChunk({
                                content: "按照你提供的",
                                additional_kwargs: {
                                    reasoning_content: "第一段思考，继续展开",
                                },
                            }),
                        },
                    },
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: new AIMessageChunk({
                                content: "提供的模板",
                            }),
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(publishedEvents.filter((event) => event.type === "assistant_delta")).toEqual([
            expect.objectContaining({
                type: "assistant_delta",
                chunkText: "按照你",
            }),
            expect.objectContaining({
                type: "assistant_delta",
                chunkText: "提供的",
            }),
            expect.objectContaining({
                type: "assistant_delta",
                chunkText: "模板",
            }),
        ]);
        expect(publishedEvents.filter((event) => event.type === "thinking_delta")).toEqual([
            expect.objectContaining({
                type: "thinking_delta",
                chunkText: "第一段思考",
            }),
            expect.objectContaining({
                type: "thinking_delta",
                chunkText: "，继续展开",
            }),
        ]);
        expect(session.snapshot.text).toBe("按照你提供的模板");
        expect(session.snapshot.thinkingText).toBe("第一段思考，继续展开");
        expect(finalizeAssistantSuccess).toHaveBeenCalledWith("1", session, null, null, expect.any(Function));
    });

    it("会从模型层归一化后的 usage_metadata 读取 KV cache 命中和未命中 token", async () => {
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const finalizeAssistantSuccess = vi.spyOn(threadMessages, "finalizeAssistantSuccess").mockResolvedValue([]);
        const updateMetadata = vi.fn(async () => createThreadRecord());
        const publishThreadSnapshot = vi.fn(async () => undefined);

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: new AIMessageChunk({
                                content: "完成",
                            }),
                        },
                    },
                    {
                        event: "on_chat_model_end",
                        data: {
                            output: new AIMessage({
                                content: "完成",
                                usage_metadata: {
                                    input_tokens: 100,
                                    output_tokens: 20,
                                    total_tokens: 120,
                                    input_token_details: {
                                        cache_read: 64,
                                        cache_miss: 36,
                                    },
                                } as AIMessage["usage_metadata"],
                            }),
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishThreadSnapshot,
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(finalizeAssistantSuccess).toHaveBeenCalledWith("1", session, {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            cacheReadTokens: 64,
            cacheMissTokens: 36,
            cacheCreationTokens: null,
        }, null, expect.any(Function));
        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            usageSummary: expect.objectContaining({
                lastRun: expect.objectContaining({
                    inputTokens: 100,
                    outputTokens: 20,
                    totalTokens: 120,
                }),
            }),
        }));
        expect(publishThreadSnapshot).toHaveBeenCalledWith("1");
    });

    it("流执行失败时会落盘失败消息并广播 failed run_state", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantFailure").mockResolvedValue([
            new AIMessage({
                content: "请求失败：boom",
                additional_kwargs: {
                    messageId: "assistant-error-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:02.000Z",
                },
            }),
        ]);
        vi.spyOn(threadMessages, "buildSummary").mockReturnValue("boom");

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createFailingStream(new Error("boom")),
            } as never,
            threadRepository: {
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "failed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(threadMessages.finalizeAssistantFailure).toHaveBeenCalledWith("1", session, "boom", null, null, expect.any(Function));
        expect(publishedEvents.at(-1)).toMatchObject({
            type: "run_state",
            status: "failed",
            error: "boom",
        });
    });

    it("request_user_input 会挂起线程并切到 waiting_user", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const updateRunStatus = vi.fn(async () => createThreadRecord({
            runStatus: "waiting_user",
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "我需要你确认一下偏好",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "我需要你确认一下偏好",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-ask-1",
                                        name: "request_user_input",
                                        args: JSON.stringify({
                                            questions: [{
                                                header: "偏好",
                                                question: "你现在更想把时间花在哪件事上？",
                                                options: [
                                                    {label: "写代码", recommended: true},
                                                    {label: "学点东西"},
                                                ],
                                            }],
                                        }),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {
                            input: {
                                questions: [{
                                    header: "偏好",
                                    question: "你现在更想把时间花在哪件事上？",
                                    options: [
                                        {label: "写代码", recommended: true},
                                        {label: "学点东西"},
                                    ],
                                }],
                            },
                        },
                    },
                    {
                        event: "on_tool_end",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {
                            output: {
                                kind: "pending_user_input",
                            },
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus,
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new MetadataLeaderProfile({
                completedMetadata: {
                    reminders: {
                        workspace: {
                            fingerprint: "\"novel\"",
                            injectedAtTurn: 1,
                        },
                    },
                },
            }),
            input: {
                prompt: "hello",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {
                planModeReminder: "full",
                planModeCommitMetadata: {
                    planMode: {
                        active: true,
                        enteredAt: "2026-05-04T00:00:00.000Z",
                        turnsSinceReminder: 0,
                        reminderCount: 1,
                        needsExitReminder: false,
                        hasExited: false,
                    },
                },
            },
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(threadMessages.finalizeAssistantIteration).toHaveBeenCalledTimes(1);
        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.objectContaining({
                status: "pending",
                questions: [
                    expect.objectContaining({
                        toolName: "request_user_input",
                    }),
                ],
            }),
        }));
        expect(updateRunStatus).toHaveBeenCalledWith("1", "waiting_user");
        const updateMetadataCalls = updateMetadata.mock.calls as unknown as Array<[string, AgentThreadMetadata]>;
        for (const [, metadata] of updateMetadataCalls) {
            expect(metadata).not.toEqual(expect.objectContaining({
                reminders: expect.anything(),
            }));
        }
        expect(updateMetadataCalls.some(([, metadata]) => metadata.planMode?.reminderCount === 1)).toBe(true);
        const lastUpdateMetadataCall = updateMetadataCalls.at(-1) as [
            string,
            {pendingUserInputSession: {questions: Array<{toolArgsText: string}>}},
        ] | undefined;
        const toolArgsText = lastUpdateMetadataCall?.[1].pendingUserInputSession.questions[0]?.toolArgsText ?? "";
        expect(JSON.parse(toolArgsText)).toMatchObject({
            questions: [expect.objectContaining({question: "你现在更想把时间花在哪件事上？"})],
        });
        expect(publishedEvents.at(-1)).toMatchObject({
            type: "run_state",
            status: "waiting_user",
        });
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "user_input_requested",
            session: expect.objectContaining({
                questions: expect.any(Array),
            }),
        }));
    });

    it("enter_plan_mode 会挂起审批而不是立即完成工具", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const updateRunStatus = vi.fn(async () => createThreadRecord({
            runStatus: "waiting_user",
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-plan-1",
                                        name: "enter_plan_mode",
                                        args: JSON.stringify({}),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "enter_plan_mode",
                        run_id: "run-plan-1",
                        data: {
                            input: {},
                        },
                    },
                    {
                        event: "on_tool_end",
                        name: "enter_plan_mode",
                        run_id: "run-plan-1",
                        data: {
                            output: {
                                kind: "pending_tool_approval",
                                action: "enter_plan_mode",
                                planDirectoryPath: "workspace/.agent/{thread_id}/",
                            },
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus,
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "plan",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        await coordinator.runThread(createThreadRecord(), runtime, [], session);

        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.objectContaining({
                questions: [
                    expect.objectContaining({
                        toolName: "enter_plan_mode",
                        kind: "tool_approval",
                        approvalAction: "enter_plan_mode",
                    }),
                ],
            }),
        }));
        expect(updateRunStatus).toHaveBeenCalledWith("1", "waiting_user");
        expect(persistToolMessage).not.toHaveBeenCalled();
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "user_input_requested",
            session: expect.objectContaining({
                questions: [expect.objectContaining({toolName: "enter_plan_mode"})],
            }),
        }));
    });

    it("exit_plan_mode 没有计划文件时仍挂起审批", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const workspaceRoot = `workspace/nbook-empty-plan-${Date.now()}`;
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-plan-1",
                                        name: "exit_plan_mode",
                                        args: JSON.stringify({}),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "exit_plan_mode",
                        run_id: "run-plan-1",
                        data: {input: {}},
                    },
                    {
                        event: "on_tool_end",
                        name: "exit_plan_mode",
                        run_id: "run-plan-1",
                        data: {
                            output: new ToolMessage({
                                content: "Plan Mode approval requested: exit",
                                tool_call_id: "call-plan-1",
                                name: "exit_plan_mode",
                                additional_kwargs: {
                                    [TOOL_RESULT_RAW_KEY]: {
                                        kind: "pending_tool_approval",
                                        action: "exit_plan_mode",
                                    },
                                },
                            }),
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus: vi.fn(async () => createThreadRecord({runStatus: "waiting_user"})),
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "plan"},
            scope: {
                studio: {workspace: workspaceRoot},
            } as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        try {
            await coordinator.runThread(createThreadRecord(), runtime, [], session);
        } finally {
            await fs.rm(path.join(process.cwd(), workspaceRoot), {recursive: true, force: true});
        }

        expect(persistToolMessage).not.toHaveBeenCalled();
        expect(updateMetadata.mock.calls).toContainEqual([
            "1",
            expect.objectContaining({
                pendingUserInputSession: expect.objectContaining({
                    questions: [expect.objectContaining({
                        toolName: "exit_plan_mode",
                    })],
                }),
            }),
        ]);
        const metadataCalls = updateMetadata.mock.calls as unknown as Array<[string, {pendingUserInputSession?: {questions?: Array<Record<string, unknown>>}}]>;
        const pendingQuestion = metadataCalls
            .map((call) => call[1].pendingUserInputSession?.questions?.[0])
            .find((question) => question?.toolName === "exit_plan_mode");
        expect(pendingQuestion).not.toHaveProperty("planFilePath");
        expect(pendingQuestion).not.toHaveProperty("planContent");
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "user_input_requested",
            session: expect.objectContaining({
                questions: [expect.objectContaining({
                    toolName: "exit_plan_mode",
                })],
            }),
        }));
    });

    it("exit_plan_mode 携带计划文件路径时会读取该文件挂起审批", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const workspaceRoot = `workspace/nbook-plan-preview-${Date.now()}`;
        const planDir = path.join(process.cwd(), workspaceRoot, ".agent", "1");
        await fs.mkdir(planDir, {recursive: true});
        await fs.writeFile(path.join(planDir, "explicit.md"), "# 新计划\n\n执行。", "utf-8");
        await fs.mkdir(path.join(planDir, "notes"), {recursive: true});
        await fs.writeFile(path.join(planDir, "walkthrough.md"), "# Walkthrough\n\n记录。", "utf-8");
        await fs.writeFile(path.join(planDir, "notes", "review.md"), "# Review\n\n检查。", "utf-8");
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-plan-1",
                                        name: "exit_plan_mode",
                                        args: JSON.stringify({planFilePath: "notes/review.md"}),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "exit_plan_mode",
                        run_id: "run-plan-1",
                        data: {input: {planFilePath: "notes/review.md"}},
                    },
                    {
                        event: "on_tool_end",
                        name: "exit_plan_mode",
                        run_id: "run-plan-1",
                        data: {
                            output: new ToolMessage({
                                content: "Plan Mode approval requested: exit",
                                tool_call_id: "call-plan-1",
                                name: "exit_plan_mode",
                                additional_kwargs: {
                                    [TOOL_RESULT_RAW_KEY]: {
                                        kind: "pending_tool_approval",
                                        action: "exit_plan_mode",
                                        planFilePath: "notes/review.md",
                                    },
                                },
                            }),
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus: vi.fn(async () => createThreadRecord({runStatus: "waiting_user"})),
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "plan"},
            scope: {
                studio: {workspace: workspaceRoot},
            } as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        try {
            await coordinator.runThread(createThreadRecord(), runtime, [], session);
        } finally {
            await fs.rm(path.join(process.cwd(), workspaceRoot), {recursive: true, force: true});
        }

        expect(updateMetadata.mock.calls).toContainEqual([
            "1",
            expect.objectContaining({
                pendingUserInputSession: expect.objectContaining({
                    questions: [
                        expect.objectContaining({
                            toolName: "exit_plan_mode",
                            planFilePath: `${workspaceRoot}/.agent/1/notes/review.md`,
                            planContent: "# Review\n\n检查。",
                        }),
                    ],
                }),
            }),
        ]);
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "user_input_requested",
            session: expect.objectContaining({
                questions: [expect.objectContaining({
                    planFilePath: `${workspaceRoot}/.agent/1/notes/review.md`,
                    planContent: "# Review\n\n检查。",
                })],
            }),
        }));
    });

    it("exit_plan_mode 计划文件读取失败时返回工具错误且不挂起审批", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const workspaceRoot = `workspace/nbook-missing-plan-${Date.now()}`;
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        const updateMetadata = vi.fn(async () => createThreadRecord());
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [{
                                    index: 0,
                                    id: "call-plan-1",
                                    name: "exit_plan_mode",
                                    args: JSON.stringify({planFilePath: "missing.md"}),
                                }],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "exit_plan_mode",
                        run_id: "run-plan-1",
                        data: {input: {planFilePath: "missing.md"}},
                    },
                    {
                        event: "on_tool_end",
                        name: "exit_plan_mode",
                        run_id: "run-plan-1",
                        data: {
                            output: new ToolMessage({
                                content: "Plan Mode approval requested: exit",
                                tool_call_id: "call-plan-1",
                                name: "exit_plan_mode",
                                additional_kwargs: {
                                    [TOOL_RESULT_RAW_KEY]: {
                                        kind: "pending_tool_approval",
                                        action: "exit_plan_mode",
                                        planFilePath: "missing.md",
                                    },
                                },
                            }),
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "plan"},
            scope: {
                studio: {workspace: workspaceRoot},
            } as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
        const session = new ActiveRunSession("thread-1", "leader.default");

        try {
            await coordinator.runThread(createThreadRecord(), runtime, [], session);
        } finally {
            await fs.rm(path.join(process.cwd(), workspaceRoot), {recursive: true, force: true});
        }

        expect(updateMetadata).not.toHaveBeenCalledWith(
            "1",
            expect.objectContaining({
                pendingUserInputSession: expect.anything(),
            }),
        );
        const persistedToolMessage = persistToolMessage.mock.calls[0]?.[1] as ToolMessage | undefined;
        expect(persistToolMessage.mock.calls[0]?.[0]).toBe("1");
        expect(persistToolMessage.mock.calls[0]?.[2]).toBe("error");
        expect(String(persistedToolMessage?.content ?? "")).toContain("ENOENT");
        expect(publishedEvents).not.toContainEqual(expect.objectContaining({
            type: "user_input_requested",
        }));
    });

    it("skill 会挂起审批并保留原始 skill 参数", async () => {
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const updateRunStatus = vi.fn(async () => createThreadRecord({
            runStatus: "waiting_user",
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [{
                                    index: 0,
                                    id: "call-skill-1",
                                    name: "skill",
                                    args: JSON.stringify({skill: "爽文"}),
                                }],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "skill",
                        run_id: "run-skill-1",
                        data: {
                            input: JSON.stringify({skill: "爽文"}),
                        },
                    },
                    {
                        event: "on_tool_end",
                        name: "skill",
                        run_id: "run-skill-1",
                        data: {
                            output: {
                                kind: "pending_tool_approval",
                                action: "skill",
                                skill: "爽文",
                            },
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus,
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "use skill",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.objectContaining({
                questions: [expect.objectContaining({
                    toolName: "skill",
                    kind: "tool_approval",
                    approvalAction: "skill",
                    approvalToolArgsText: JSON.stringify({skill: "爽文"}),
                })],
            }),
        }));
        expect(updateRunStatus).toHaveBeenCalledWith("1", "waiting_user");
        expect(persistToolMessage).not.toHaveBeenCalled();
    });

    it("skill 参数错误时不会挂起审批", async () => {
        const updateMetadata = vi.fn(async () => createThreadRecord());
        const updateRunStatus = vi.fn(async () => createThreadRecord({
            runStatus: "completed",
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue();
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [{
                                    index: 0,
                                    id: "call-skill-1",
                                    name: "skill",
                                    args: JSON.stringify({name: "爽文"}),
                                }],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "skill",
                        run_id: "run-skill-1",
                        data: {
                            input: JSON.stringify({name: "爽文"}),
                        },
                    },
                    {
                        event: "on_tool_end",
                        name: "skill",
                        run_id: "run-skill-1",
                        data: {
                            output: {
                                content: "Invalid skill arguments.\n- skill: skill is required",
                                status: "error",
                            },
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus,
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn(),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {
                prompt: "use skill",
            },
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(updateMetadata).not.toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.anything(),
        }));
        expect(updateRunStatus).not.toHaveBeenCalledWith("1", "waiting_user");
        expect(persistToolMessage).toHaveBeenCalledWith("1", expect.objectContaining({
            name: "skill",
            text: expect.stringContaining("Invalid skill arguments"),
        }), "success", expect.any(Function));
    });

    it("同一条 AIMessage 可以连续挂起多个 request_user_input", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);

        const firstInput = {
            questions: [{
                header: "题材",
                question: "请选择小说题材",
                options: [
                    {label: "奇幻"},
                    {label: "科幻"},
                ],
            }],
        };
        const secondInput = {
            questions: [{
                header: "视角",
                question: "请选择叙事视角",
                options: [
                    {label: "第一人称"},
                    {label: "第三人称"},
                ],
            }],
        };

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-ask-1",
                                        name: "request_user_input",
                                        args: JSON.stringify(firstInput),
                                    },
                                    {
                                        index: 1,
                                        id: "call-ask-2",
                                        name: "request_user_input",
                                        args: JSON.stringify(secondInput),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {input: JSON.stringify(firstInput)},
                    },
                    {
                        event: "on_tool_end",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {output: {kind: "pending_user_input"}},
                    },
                    {
                        event: "on_tool_start",
                        name: "request_user_input",
                        run_id: "run-ask-2",
                        data: {input: JSON.stringify(secondInput)},
                    },
                    {
                        event: "on_tool_end",
                        name: "request_user_input",
                        run_id: "run-ask-2",
                        data: {output: {kind: "pending_user_input"}},
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus: vi.fn(async () => createThreadRecord({runStatus: "waiting_user"})),
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "hello"},
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.objectContaining({
                questions: [
                    expect.objectContaining({toolName: "request_user_input"}),
                    expect.objectContaining({toolName: "request_user_input"}),
                ],
            }),
        }));
        const lastUpdateMetadataCall = updateMetadata.mock.calls.at(-1) as [
            string,
            {pendingUserInputSession: {questions: Array<{toolNodeId: string}>}},
        ] | undefined;
        const pendingSession = lastUpdateMetadataCall?.[1].pendingUserInputSession;
        expect(new Set(pendingSession?.questions.map((question) => question.toolNodeId)).size).toBe(2);
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "user_input_requested",
            session: expect.objectContaining({
                questions: expect.arrayContaining([
                    expect.objectContaining({toolName: "request_user_input"}),
                    expect.objectContaining({toolName: "request_user_input"}),
                ]),
            }),
        }));
    });

    it("request_user_input 与普通工具同轮并行时会先持久化普通工具再挂起", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const updateRunStatus = vi.fn(async () => createThreadRecord({
            runStatus: "waiting_user",
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "我先查文件，同时问一个偏好。",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue(undefined);
        const input = {
            questions: [{
                header: "偏好",
                question: "是否保留旧设定？",
                options: [
                    {label: "保留"},
                    {label: "删除"},
                ],
            }],
        };

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "我先查文件，同时问一个偏好。",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-read-1",
                                        name: "read_file",
                                        args: JSON.stringify({filePath: "README.md"}),
                                    },
                                    {
                                        index: 1,
                                        id: "call-ask-1",
                                        name: "request_user_input",
                                        args: JSON.stringify(input),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {input: JSON.stringify(input)},
                    },
                    {
                        event: "on_tool_start",
                        name: "read_file",
                        run_id: "run-read-1",
                        data: {input: JSON.stringify({filePath: "README.md"})},
                    },
                    {
                        event: "on_tool_end",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {output: {kind: "pending_user_input"}},
                    },
                    {
                        event: "on_tool_end",
                        name: "read_file",
                        run_id: "run-read-1",
                        data: {output: "文件内容"},
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus,
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "hello"},
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(persistToolMessage).toHaveBeenCalledWith("1", expect.objectContaining({
            name: "read_file",
            text: "文件内容",
        }), "success", expect.any(Function));
        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.objectContaining({
                questions: [expect.objectContaining({toolName: "request_user_input"})],
            }),
        }));
        expect(updateRunStatus).toHaveBeenCalledWith("1", "waiting_user");
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "tool_finished",
            status: "success",
            toolCall: expect.objectContaining({
                toolName: "read_file",
            }),
        }));
    });

    it("request_user_input pending 后出现下一轮 assistant delta 时不失败并挂起", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const updateMetadata = vi.fn(async () => createThreadRecord({
            metadata: {
                pendingUserInputSession: {
                    assistantMessageId: "thread-1-assistant-1",
                    status: "pending",
                    questions: [],
                },
            },
        }));
        const updateRunStatus = vi.fn(async () => createThreadRecord({
            runStatus: "waiting_user",
        }));
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "我需要确认偏好。",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        const input = {
            questions: [{
                header: "偏好",
                question: "是否保留旧设定？",
                options: [
                    {label: "保留"},
                    {label: "删除"},
                ],
            }],
        };

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "我需要确认偏好。",
                                tool_call_chunks: [
                                    {
                                        index: 0,
                                        id: "call-ask-1",
                                        name: "request_user_input",
                                        args: JSON.stringify(input),
                                    },
                                ],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {input: JSON.stringify(input)},
                    },
                    {
                        event: "on_tool_end",
                        name: "request_user_input",
                        run_id: "run-ask-1",
                        data: {output: {kind: "pending_user_input"}},
                    },
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "这段不会在等待用户答案前继续落库。",
                                tool_call_chunks: [],
                            },
                        },
                    },
                ]),
            } as never,
            threadRepository: {
                updateMetadata,
                updateRunStatus,
                touchAfterRun: vi.fn(async () => createThreadRecord()),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((error: unknown) => error instanceof Error ? error.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "hello"},
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        expect(updateMetadata).toHaveBeenCalledWith("1", expect.objectContaining({
            pendingUserInputSession: expect.objectContaining({
                questions: [expect.objectContaining({toolName: "request_user_input"})],
            }),
        }));
        expect(updateRunStatus).toHaveBeenCalledWith("1", "waiting_user");
        expect(publishedEvents.at(-1)).toMatchObject({
            type: "run_state",
            status: "waiting_user",
        });
        expect(publishedEvents).not.toContainEqual(expect.objectContaining({
            type: "run_state",
            status: "failed",
        }));
    });

    it("工具错误事件会压缩堆栈后再返回给模型", async () => {
        const publishedEvents: AgentStreamEvent[] = [];
        const threadMessages = new ThreadMessageService({
            appendMessages: async () => [],
        } as unknown as AgentMessageStore);
        const persistToolMessage = vi.spyOn(threadMessages, "persistToolMessage").mockResolvedValue(undefined);
        vi.spyOn(threadMessages, "finalizeAssistantIteration").mockResolvedValue([
            new AIMessage({
                content: "我来读文件。",
                additional_kwargs: {
                    messageId: "assistant-1",
                    messageStatus: "done",
                    messageCreatedAt: "2026-04-05T00:00:00.000Z",
                },
            }),
        ]);
        vi.spyOn(threadMessages, "finalizeAssistantSuccess").mockResolvedValue([]);
        vi.spyOn(threadMessages, "buildSummary").mockReturnValue("done");
        const error = new Error("ENOENT: no such file or directory, stat 'C:\\repo\\workspace\\silver-dragon-hime\\.agent\\plan\\current.md'");
        error.stack = [
            error.message,
            "    at async Object.stat (node:internal/fs/promises:1030:18)",
            "    at async readWorkspaceTextFile (file:///C:/repo/.nuxt/dev/index.mjs:4075:16)",
            "    at async file:///C:/repo/node_modules/@langchain/core/dist/tools/index.js:306:22",
        ].join("\n");

        const coordinator = new ThreadRunCoordinator({
            threadRunner: {
                streamPreparedEvents: async () => createStream([
                    {
                        event: "on_chat_model_stream",
                        data: {
                            chunk: {
                                text: "我来读文件。",
                                tool_call_chunks: [{
                                    index: 0,
                                    id: "call-read-1",
                                    name: "read_file",
                                    args: JSON.stringify({filePath: "workspace/silver-dragon-hime/.agent/plan/current.md"}),
                                }],
                            },
                        },
                    },
                    {
                        event: "on_tool_start",
                        name: "read_file",
                        run_id: "run-read-1",
                        data: {input: JSON.stringify({filePath: "workspace/silver-dragon-hime/.agent/plan/current.md"})},
                    },
                    {
                        event: "on_tool_error",
                        name: "read_file",
                        run_id: "run-read-1",
                        data: {error},
                    },
                ]),
            } as never,
            threadRepository: {
                findById: vi.fn(async () => createThreadRecord()),
                updateMetadata: vi.fn(async () => createThreadRecord()),
                touchAfterRun: vi.fn(async () => createThreadRecord({
                    runStatus: "completed",
                })),
            } as never,
            threadEvents: {
                publish: vi.fn((_threadId: string, event: AgentStreamEvent) => {
                    publishedEvents.push(event);
                }),
            } as never,
            threadMessages,
            refreshThreadAgentScope: vi.fn(async () => ({}) as AgentVariableScope),
            subscribeThreadActive: vi.fn(),
            loadThreadHistoryMessages: vi.fn(async () => []),
            publishHistorySnapshot: vi.fn(async () => undefined),
            publishThreadSnapshot: vi.fn(async () => undefined),
            closeRun: vi.fn(),
            stringifyError: vi.fn((caught: unknown) => caught instanceof Error ? caught.message : "unknown"),
            isAbortError: vi.fn(() => false),
        });
        const runtime = {
            thread: createThreadRecord(),
            profile: new TestLeaderProfile(),
            input: {prompt: "hello"},
            scope: {} as AgentVariableScope<"leader.default">,
            skillCatalog: [],
            options: {},
            messageStore: {} as AgentMessageStore,
            loadHistoryMessages: async () => [],
            threadRepository: {} as never,
            variableStore: {} as never,
        } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;

        await coordinator.runThread(createThreadRecord(), runtime, [], new ActiveRunSession("thread-1", "leader.default"));

        const message = persistToolMessage.mock.calls[0]?.[1];
        expect(message?.text).toContain("Error: ENOENT");
        expect(message?.text).not.toContain("at async");
        expect(message?.text).not.toContain(".nuxt/dev/index.mjs");
        expect(message?.text).not.toContain("node_modules");
        expect(JSON.stringify(message?.additional_kwargs)).not.toContain("stack");
        expect(publishedEvents).toContainEqual(expect.objectContaining({
            type: "tool_finished",
            status: "error",
            toolCall: expect.objectContaining({
                outputText: expect.not.stringContaining("at async"),
            }),
        }));
    });
});
