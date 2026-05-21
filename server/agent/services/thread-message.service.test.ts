import {AIMessage, ToolMessage} from "@langchain/core/messages";
import {describe, expect, it, vi} from "vitest";
import {ThreadMessageService} from "nbook/server/agent/services/thread-message.service";
import {ActiveRunSession} from "nbook/server/agent/runtime/live-run-registry";
import type {AgentMessageAppendInput, AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import {toStoredMessage} from "nbook/server/agent/messages/codec";
import {createAgentMessage} from "nbook/server/agent/test/fixtures";
import type {AgentMessageCreateInput} from "nbook/server/agent/types";

describe("ThreadMessageService", () => {
    it("成功结束时会落盘 assistant 正文和 thinking", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.appendThinkingText("思考中");
        session.appendAssistantText("完成回答");

        const messages = await service.finalizeAssistantSuccess("thread-1", session);

        expect(appendMessages).toHaveBeenCalledTimes(1);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toBeInstanceOf(AIMessage);
        expect(messages[0]?.text).toBe("完成回答");
        expect(appendMessages.mock.calls[0]?.[1].messages[0]).toMatchObject({
            message: expect.objectContaining({
                content: "完成回答",
                additional_kwargs: expect.objectContaining({
                    thinking: "思考中",
                }),
            }),
        });
    });

    it("会把工具调用写入 assistant tool_calls", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-1",
        });
        session.appendToolArgs(session.snapshot.tools[0]!.toolNodeId, "{\"filePath\":\"AGENTS.md\"}");

        const messages = await service.finalizeAssistantIteration("thread-1", session);

        expect(messages[0]).toBeInstanceOf(AIMessage);
        expect((messages[0] as AIMessage).tool_calls).toMatchObject([{
            id: "call-1",
            name: "read_file",
            args: {
                filePath: "AGENTS.md",
            },
        }]);
        expect(appendMessages.mock.calls[0]?.[1].messages[0]?.message).toMatchObject({
            tool_calls: [{
                id: "call-1",
                name: "read_file",
            }],
        });
    });

    it("成功结束时会落盘 assistant thinking", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.appendThinkingText("思考中");
        session.appendAssistantText("完成回答");

        await service.finalizeAssistantSuccess("thread-1", session);

        expect(appendMessages.mock.calls[0]?.[1].messages[0]?.message.additional_kwargs).toMatchObject({
                thinking: "思考中",
                reasoning_content: "思考中",
        });
    });

    it("正文为空时不会持久化可见 assistant 消息", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async () => []);
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.appendThinkingText("只有思考");

        const messages = await service.finalizeAssistantSuccess("thread-1", session);

        expect(messages).toEqual([]);
        expect(appendMessages).not.toHaveBeenCalled();
    });

    it("ingest 可以在写入历史前过滤 ReAct 产物", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.appendAssistantText("会被过滤");
        const phases: string[] = [];

        const messages = await service.finalizeAssistantSuccess("thread-1", session, null, null, ({phase}) => {
            phases.push(phase);
            return [];
        });

        expect(messages).toEqual([]);
        expect(phases).toEqual(["assistant_success"]);
        expect(appendMessages).not.toHaveBeenCalled();
    });

    it("只有工具调用时仍会持久化空正文 assistant 父节点", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-1",
        });

        const messages = await service.finalizeAssistantIteration("thread-1", session);

        expect(messages).toHaveLength(1);
        expect(messages[0]).toBeInstanceOf(AIMessage);
        expect(messages[0]?.text).toBe("");
        expect(appendMessages.mock.calls[0]?.[1].messages[0]).toMatchObject({
            id: session.snapshot.messageId,
        });
        expect(appendMessages.mock.calls[0]?.[1].messages[0]?.message.text).toBe("");
    });

    it("停止时会为未完成工具调用补失败结果", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.ensureToolDraft({
            callIndex: 0,
            toolName: "execute_shell",
            toolCallId: "call-1",
        });

        const messages = await service.finalizeAssistantStopped("thread-1", session);

        expect(messages).toHaveLength(2);
        expect(messages[0]).toBeInstanceOf(AIMessage);
        expect(messages[1]).toBeInstanceOf(ToolMessage);
        expect((messages[1] as ToolMessage).tool_call_id).toBe("call-1");
        expect((messages[1] as ToolMessage).status).toBe("error");
        expect(appendMessages.mock.calls[0]?.[1].messages.map((message) => message.message._getType())).toEqual([
            "ai",
            "tool",
        ]);
    });

    it("assistant 已落盘后只为仍未完成工具补结果", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        const firstTool = session.ensureToolDraft({
            callIndex: 0,
            toolName: "read_file",
            toolCallId: "call-1",
        });
        session.finishTool(firstTool.toolNodeId, "call-1", "读取成功", "success");
        session.ensureToolDraft({
            callIndex: 1,
            toolName: "execute_shell",
            toolCallId: "call-2",
        });

        const messages = await service.persistInterruptedToolMessages("thread-1", session);

        expect(messages).toHaveLength(1);
        expect((messages[0] as ToolMessage).tool_call_id).toBe("call-2");
        expect((messages[0] as ToolMessage).status).toBe("error");
        expect(appendMessages.mock.calls[0]?.[1].messages[0]?.id).toBeUndefined();
    });

    it("工具结果落盘不会把 provider tool_call_id 当作消息主键", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);

        await service.persistToolMessage("thread-1", new ToolMessage({
            id: "call-1",
            content: "第一次",
            tool_call_id: "call-1",
        }), "success");
        await service.persistToolMessage("thread-1", new ToolMessage({
            id: "call-1",
            content: "第二次",
            tool_call_id: "call-1",
        }), "success");

        const persistedInputs = appendMessages.mock.calls.flatMap((call) => call[1].messages);
        expect(persistedInputs).toHaveLength(2);
        expect(persistedInputs.map((message) => message.id)).toEqual([undefined, undefined]);
        expect(persistedInputs.map((message) => (message.message as ToolMessage).tool_call_id)).toEqual([
            "call-1",
            "call-1",
        ]);
    });

    it("失败时会保留已有 assistant 文本并追加错误消息", async () => {
        const appendMessages = vi.fn<AgentMessageStore["appendMessages"]>(async (_threadId, input: AgentMessageAppendInput) => {
            return input.messages.map((message, index) => createPersistedInput(message, index));
        });
        const service = new ThreadMessageService({
            appendMessages,
        } as unknown as AgentMessageStore);
        const session = new ActiveRunSession("thread-1", "leader.default");
        session.appendAssistantText("半截回答");

        const messages = await service.finalizeAssistantFailure("thread-1", session, "模型超时");

        expect(messages).toHaveLength(2);
        expect(messages.map((message) => message.text)).toEqual(["半截回答", "请求失败：模型超时"]);
        expect(appendMessages.mock.calls[0]?.[1].messages).toMatchObject([
            {
                status: "stopped",
            },
            {},
        ]);
        expect(appendMessages.mock.calls[0]?.[1].messages.map((message) => message.message.text)).toEqual([
            "半截回答",
            "请求失败：模型超时",
        ]);
    });

    it("读取线程历史时会直接委托给 messageStore", async () => {
        const loadActivePathMessages = vi.fn<AgentMessageStore["loadActivePathMessages"]>(async () => [
            createAgentMessage({
                id: "assistant-1",
                role: "assistant",
                origin: "assistant_output",
                content: "hello",
            }),
        ]);
        const service = new ThreadMessageService({
            appendMessages: vi.fn(async () => []),
            loadActivePathMessages,
        } as unknown as AgentMessageStore);

        const messages = await service.loadThreadHistory("thread-1");

        expect(loadActivePathMessages).toHaveBeenCalledWith("thread-1");
        expect(messages).toHaveLength(1);
    });
});

function createPersistedInput(message: AgentMessageCreateInput, index: number) {
    const id = message.id ?? `message-${String(index + 1)}`;
    const status = message.status ?? "done";
    const createdAt = message.createdAt ?? "2026-04-05T00:00:00.000Z";
    return createAgentMessage({
        id,
        status,
        createdAt,
        storedMessage: toStoredMessage(message, {
            id,
            status,
            createdAt,
        }),
    });
}
