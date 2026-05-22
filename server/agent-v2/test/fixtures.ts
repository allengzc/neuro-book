import {AIMessage, HumanMessage, SystemMessage, ToolMessage, mapChatMessagesToStoredMessages, type BaseMessage} from "@langchain/core/messages";
import type {
    AgentConversationNode,
    AgentMessage,
    AgentMessageRole,
    AgentThreadRecord,
    AgentThreadStatus,
    JsonObject,
    ProfileKey,
    ThreadSummary,
} from "nbook/server/agent/types";
import {
    readAgentMessageAdditionalKwargs,
    readAgentMessageAssistantId,
    readAgentMessageContent,
    readAgentMessageRole,
    readAgentMessageToolArgs,
    readAgentMessageToolCallId,
    readAgentMessageToolName,
    readAgentMessageToolStatus,
} from "nbook/server/agent/messages/codec";

/**
 * 创建测试用线程记录。
 */
export function createThreadRecord(input: Partial<AgentThreadRecord> = {}): AgentThreadRecord {
    return {
        id: 1,
        kind: "leader",
        runStatus: "idle",
        profileKey: "leader.default",
        title: "测试线程",
        activeCursorMessageId: null,
        lastMessagePreview: "最近消息",
        lastMessageAt: new Date("2026-04-05T00:00:00.000Z"),
        metadata: {},
        ...input,
    };
}

/**
 * 创建测试用线程摘要。
 */
export function createThreadSummary(input: Partial<ThreadSummary> = {}): ThreadSummary {
    const profileKey = (input.profileKey ?? "leader.default") as ProfileKey;
    const status = (input.status ?? "idle") as AgentThreadStatus;
    return {
        id: "thread-1",
        kind: "leader",
        profileKey,
        title: "测试线程",
        summary: "最近消息",
        status,
        modelOverride: null,
        modelOverrideKey: null,
        usageSummary: null,
        pendingUserInputSession: null,
        planMode: null,
        lastMessageAt: new Date("2026-04-05T00:00:00.000Z"),
        ...input,
    };
}

/**
 * 创建测试用持久化消息。
 */
type CreateAgentMessageInput = Partial<AgentMessage> & {
    role?: AgentMessageRole;
    content?: string;
    /** 旧测试数据兼容字段；AgentMessage 已不再持久化 origin。 */
    origin?: string;
    assistantMessageId?: string | null;
    toolCallId?: string | null;
    toolName?: string | null;
    toolArgs?: string | null;
    toolStatus?: "success" | "error" | null;
    rawAdditionalKwargs?: JsonObject;
};

/**
 * 创建测试用持久化消息。
 */
export function createAgentMessage(input: CreateAgentMessageInput = {}): AgentMessage {
    const id = input.id ?? "message-1";
    const status = input.status ?? "done";
    const createdAt = input.createdAt ?? "2026-04-05T00:00:00.000Z";
    const rawAdditionalKwargs = {
        ...(input.rawAdditionalKwargs ?? {}),
        messageId: id,
        messageStatus: status,
        messageCreatedAt: createdAt,
        ...(input.assistantMessageId ? {assistantMessageId: input.assistantMessageId} : {}),
    };

    return {
        id,
        threadId: input.threadId ?? "thread-1",
        parentId: input.parentId ?? null,
        childIds: input.childIds ?? [],
        archivedAt: input.archivedAt ?? null,
        status,
        createdAt,
        storedMessage: input.storedMessage ?? mapChatMessagesToStoredMessages([
            createFixtureBaseMessage({
                role: input.role ?? "assistant",
                content: input.content ?? "测试内容",
                toolCallId: input.toolCallId ?? null,
                toolName: input.toolName ?? null,
                toolArgs: input.toolArgs ?? null,
                toolStatus: input.toolStatus ?? null,
                additionalKwargs: rawAdditionalKwargs,
            }),
        ])[0]!,
        ...input,
    };
}

/**
 * 创建测试用前端历史树节点。
 */
export function createConversationNode(input: CreateAgentMessageInput = {}): AgentConversationNode {
    const message = createAgentMessage(input);
    return {
        id: message.id,
        parentId: message.parentId,
        childIds: [...message.childIds],
        role: readAgentMessageRole(message),
        status: message.status,
        content: readAgentMessageContent(message),
        createdAt: message.createdAt,
        archivedAt: message.archivedAt,
        assistantMessageId: readAgentMessageAssistantId(message),
        toolCallId: readAgentMessageToolCallId(message),
        toolName: readAgentMessageToolName(message),
        toolArgs: readAgentMessageToolArgs(message),
        toolStatus: readAgentMessageToolStatus(message),
        rawAdditionalKwargs: readAgentMessageAdditionalKwargs(message),
    };
}

/**
 * 根据旧测试输入创建 LangChain 消息。
 */
function createFixtureBaseMessage(input: {
    role: AgentMessageRole;
    content: string;
    toolCallId: string | null;
    toolName: string | null;
    toolArgs: string | null;
    toolStatus: "success" | "error" | null;
    additionalKwargs: JsonObject;
}): BaseMessage {
    if (input.role === "system") {
        return new SystemMessage({content: input.content, additional_kwargs: input.additionalKwargs});
    }
    if (input.role === "user") {
        return new HumanMessage({content: input.content, additional_kwargs: input.additionalKwargs});
    }
    if (input.role === "tool") {
        return new ToolMessage({
            content: input.content,
            tool_call_id: input.toolCallId ?? "tool-call-1",
            name: input.toolName ?? undefined,
            status: input.toolStatus ?? "success",
            metadata: input.toolArgs ? {toolArgs: input.toolArgs} : undefined,
            additional_kwargs: input.additionalKwargs,
        });
    }
    return new AIMessage({content: input.content, additional_kwargs: input.additionalKwargs});
}

/**
 * 创建测试用附加参数对象。
 */
export function createAdditionalKwargs(input: JsonObject = {}): JsonObject {
    return {
        ...input,
    };
}
