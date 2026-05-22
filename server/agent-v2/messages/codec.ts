import {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    mapChatMessagesToStoredMessages,
    mapStoredMessageToChatMessage,
    type BaseMessage,
    type StoredMessage,
} from "@langchain/core/messages";
import {INTERRUPTED_TOOL_RESULT_TEXT, TOOL_RESULT_RAW_KEY} from "nbook/server/agent/tools/shared/tool-message";
import type {
    AgentMessage,
    AgentMessageCreateInput,
    AgentMessageRole,
    AgentMessageStatus,
    JsonObject,
} from "nbook/server/agent/types";

/**
 * 将持久化 AgentMessage 转为 LangChain 消息。
 */
export function toLangChainMessage(message: AgentMessage): BaseMessage {
    return attachProductMetadata(
        mapStoredMessageToChatMessage(message.storedMessage),
        {
            id: message.id,
            status: message.status,
            createdAt: message.createdAt,
        },
    );
}

/**
 * 批量转换为 LangChain 消息。
 */
export function toLangChainMessages(messages: AgentMessage[]): BaseMessage[] {
    return messages.map(toLangChainMessage);
}

/**
 * 将持久化消息投影为可重新发送给模型的合法历史序列。
 */
export function toModelHistoryMessages(messages: AgentMessage[]): BaseMessage[] {
    return normalizeModelMessages(toLangChainMessages(messages));
}

/**
 * 将任意 LangChain 消息序列投影为可重新发送给模型的合法序列。
 */
export function normalizeModelMessages(messages: BaseMessage[]): BaseMessage[] {
    return uniquifyToolCallIds(normalizeToolResultSequence(messages.map(sanitizeMessageForModel)));
}

/**
 * 将 LangChain 消息转为 AgentMessage 创建输入。
 */
export function toAgentMessageCreateInput(
    message: BaseMessage,
    overrides: Partial<Omit<AgentMessageCreateInput, "message">> = {},
): AgentMessageCreateInput {
    return {
        message,
        ...overrides,
    };
}

/**
 * 批量转换 LangChain 消息。
 */
export function toAgentMessageCreateInputs(messages: BaseMessage[]): AgentMessageCreateInput[] {
    return messages.map((message) => toAgentMessageCreateInput(message));
}

/**
 * 构造一条 assistant 文本消息。
 */
export function createAssistantMessageInput(input: {
    content: string;
    status?: AgentMessageStatus;
    id?: string;
    thinking?: string;
    model?: string;
    tokens?: number;
    usageMetadata?: JsonObject;
    toolCalls?: AIMessage["tool_calls"];
}): AgentMessageCreateInput {
    const additionalKwargs: JsonObject = {
        ...(input.thinking ? {thinking: input.thinking} : {}),
        ...(input.thinking ? {reasoning_content: input.thinking} : {}),
        ...(input.model ? {model: input.model} : {}),
        ...(typeof input.tokens === "number" ? {tokens: input.tokens} : {}),
        ...(input.usageMetadata ? {usageMetadata: input.usageMetadata} : {}),
    };

    return {
        id: input.id,
        status: input.status ?? "done",
        message: new AIMessage({
            id: input.id,
            content: input.content,
            additional_kwargs: additionalKwargs,
            tool_calls: input.toolCalls ?? [],
            usage_metadata: input.usageMetadata
                ? {
                    input_tokens: readNumber(input.usageMetadata.inputTokens),
                    output_tokens: readNumber(input.usageMetadata.outputTokens),
                    total_tokens: readNumber(input.usageMetadata.totalTokens),
                    input_token_details: {
                        cache_read: readNumber(input.usageMetadata.cacheReadTokens),
                        cache_creation: readNumber(input.usageMetadata.cacheCreationTokens),
                    },
                }
                : undefined,
        }),
    };
}

/**
 * 生成可持久化的 LangChain StoredMessage。
 */
export function toStoredMessage(input: AgentMessageCreateInput, resolved: {
    id: string;
    status: AgentMessageStatus;
    createdAt: string;
}): StoredMessage {
    return mapChatMessagesToStoredMessages([
        attachProductMetadata(input.message, resolved),
    ])[0]!;
}

/**
 * 从持久化节点读取角色。
 */
export function readAgentMessageRole(message: AgentMessage): AgentMessageRole {
    return resolveRole(toLangChainMessage(message));
}

/**
 * 从持久化节点读取文本内容。
 */
export function readAgentMessageContent(message: AgentMessage): string {
    return toLangChainMessage(message).text;
}

/**
 * 从持久化节点读取可展示/调试的 additional_kwargs。
 */
export function readAgentMessageAdditionalKwargs(message: AgentMessage): JsonObject {
    return normalizeJsonObject(toLangChainMessage(message).additional_kwargs);
}

/**
 * 从持久化节点读取 tool 关联的 assistant message id。
 */
export function readAgentMessageAssistantId(message: AgentMessage): string | null {
    const additionalKwargs = readAgentMessageAdditionalKwargs(message);
    return typeof additionalKwargs.assistantMessageId === "string"
        ? additionalKwargs.assistantMessageId
        : null;
}

/**
 * 从持久化节点读取 tool_call_id。
 */
export function readAgentMessageToolCallId(message: AgentMessage): string | null {
    const langChainMessage = toLangChainMessage(message);
    return ToolMessage.isInstance(langChainMessage)
        ? langChainMessage.tool_call_id || null
        : null;
}

/**
 * 从持久化节点读取 tool 名称。
 */
export function readAgentMessageToolName(message: AgentMessage): string | null {
    const langChainMessage = toLangChainMessage(message);
    return ToolMessage.isInstance(langChainMessage)
        ? langChainMessage.name ?? null
        : null;
}

/**
 * 从持久化节点读取 tool args 文本。
 */
export function readAgentMessageToolArgs(message: AgentMessage): string | null {
    const langChainMessage = toLangChainMessage(message);
    if (!ToolMessage.isInstance(langChainMessage)) {
        return null;
    }
    const toolArgs = langChainMessage.metadata?.toolArgs;
    return typeof toolArgs === "string" ? toolArgs : null;
}

/**
 * 从持久化节点读取 tool 状态。
 */
export function readAgentMessageToolStatus(message: AgentMessage): "success" | "error" | null {
    const langChainMessage = toLangChainMessage(message);
    return ToolMessage.isInstance(langChainMessage)
        ? langChainMessage.status ?? null
        : null;
}

/**
 * 原地改写 StoredMessage 的正文。
 */
export function replaceStoredMessageContent(storedMessage: StoredMessage, content: string): StoredMessage {
    return {
        ...storedMessage,
        data: {
            ...storedMessage.data,
            content,
        },
    };
}

/**
 * 给 LangChain 消息附加产品历史 metadata。
 */
function attachProductMetadata(message: BaseMessage, metadata: {
    id: string;
    status: AgentMessageStatus;
    createdAt: string;
}): BaseMessage {
    const additional_kwargs = {
        ...message.additional_kwargs,
        messageCreatedAt: metadata.createdAt,
        messageStatus: metadata.status,
        messageId: metadata.id,
    };

    if (AIMessage.isInstance(message)) {
        return new AIMessage({
            id: metadata.id,
            name: message.name,
            content: message.content,
            additional_kwargs,
            response_metadata: message.response_metadata,
            tool_calls: message.tool_calls,
            invalid_tool_calls: message.invalid_tool_calls,
            usage_metadata: message.usage_metadata,
        });
    }
    if (ToolMessage.isInstance(message)) {
        return new ToolMessage({
            id: metadata.id,
            name: message.name,
            content: message.content,
            status: message.status,
            tool_call_id: message.tool_call_id,
            metadata: message.metadata,
            additional_kwargs,
        });
    }
    if (HumanMessage.isInstance(message)) {
        return new HumanMessage({
            id: metadata.id,
            name: message.name,
            content: message.content,
            additional_kwargs,
            response_metadata: message.response_metadata,
        });
    }
    return new SystemMessage({
        id: metadata.id,
        name: message.name,
        content: message.content,
        additional_kwargs,
        response_metadata: message.response_metadata,
    });
}

/**
 * 移除不能重新发给模型的后端内部字段。
 */
function sanitizeMessageForModel(message: BaseMessage): BaseMessage {
    if (AIMessage.isInstance(message)) {
        return new AIMessage({
            id: message.id,
            name: message.name,
            content: sanitizeAssistantContentForModel(message.content),
            additional_kwargs: message.additional_kwargs,
            response_metadata: message.response_metadata,
            tool_calls: message.tool_calls,
            invalid_tool_calls: message.invalid_tool_calls,
            usage_metadata: message.usage_metadata,
        });
    }

    if (!ToolMessage.isInstance(message)) {
        return message;
    }

    const {[TOOL_RESULT_RAW_KEY]: _toolResultRaw, ...safeAdditionalKwargs} = message.additional_kwargs;
    return new ToolMessage({
        id: message.id,
        name: message.name,
        content: message.content,
        status: message.status,
        tool_call_id: message.tool_call_id,
        metadata: message.metadata,
        additional_kwargs: safeAdditionalKwargs,
    });
}

/**
 * tool_calls 是工具调用历史的 canonical 结构；content 内的工具调用块只会让 provider 重放时重复。
 */
function sanitizeAssistantContentForModel(content: AIMessage["content"]): AIMessage["content"] {
    if (!Array.isArray(content)) {
        return content;
    }
    const safeBlocks = content.filter((block) => !isToolCallContentBlock(block));
    return safeBlocks.length > 0 ? safeBlocks : "";
}

/**
 * 判断 content block 是否代表工具调用。
 */
function isToolCallContentBlock(block: unknown): boolean {
    if (!block || typeof block !== "object" || Array.isArray(block) || !("type" in block)) {
        return false;
    }
    const type = (block as {type?: unknown}).type;
    return type === "tool_call" || type === "tool_use" || type === "server_tool_use";
}

/**
 * 修复发送给模型前的 tool_call / tool_result 序列。
 * OpenAI 兼容协议要求带 tool_calls 的 assistant 后面必须紧跟每个 tool_call_id 的 ToolMessage。
 */
function normalizeToolResultSequence(messages: BaseMessage[]): BaseMessage[] {
    const normalizedMessages: BaseMessage[] = [];
    let index = 0;

    while (index < messages.length) {
        const message = messages[index]!;
        if (AIMessage.isInstance(message) && message.tool_calls?.length) {
            const toolCalls = message.tool_calls;
            const pendingToolCallIds = toolCalls.map((toolCall) => toolCall.id).filter((id): id is string => Boolean(id));
            normalizedMessages.push(message);
            index += 1;

            while (index < messages.length && ToolMessage.isInstance(messages[index]!)) {
                const toolMessage = messages[index]! as ToolMessage;
                const pendingIndex = pendingToolCallIds.indexOf(toolMessage.tool_call_id);
                if (pendingIndex >= 0) {
                    normalizedMessages.push(toolMessage);
                    pendingToolCallIds.splice(pendingIndex, 1);
                }
                index += 1;
            }

            for (const toolCall of toolCalls) {
                if (toolCall.id && pendingToolCallIds.includes(toolCall.id)) {
                    normalizedMessages.push(createInterruptedToolMessage(message, toolCall));
                    pendingToolCallIds.splice(pendingToolCallIds.indexOf(toolCall.id), 1);
                }
            }
            continue;
        }

        if (!ToolMessage.isInstance(message)) {
            normalizedMessages.push(message);
        }
        index += 1;
    }

    return normalizedMessages;
}

/**
 * 在单次模型请求内为重复 provider tool_call_id 生成唯一 id。
 * 部分 provider 每轮都从 call-1 / index 型 id 开始；Bedrock 会拒绝同一请求内重复 toolUse id。
 * 这里仅改写发给模型的临时历史，不改数据库原始历史。
 */
function uniquifyToolCallIds(messages: BaseMessage[]): BaseMessage[] {
    const seenToolCallIds = new Set<string>();
    const currentToolCallIds = new Map<string, string[]>();
    const normalizedMessages: BaseMessage[] = [];
    const currentToolCallIdMap = new Map<string, string[]>();
    let assistantTurn = 0;

    for (const message of messages) {
        if (AIMessage.isInstance(message)) {
            assistantTurn += 1;
            currentToolCallIds.clear();
            currentToolCallIdMap.clear();
            const toolCalls = message.tool_calls?.map((toolCall, toolCallIndex) => {
                if (!toolCall.id) {
                    return toolCall;
                }
                const currentIds = currentToolCallIds.get(toolCall.id) ?? [];
                if (!seenToolCallIds.has(toolCall.id)) {
                    seenToolCallIds.add(toolCall.id);
                    currentIds.push(toolCall.id);
                    currentToolCallIds.set(toolCall.id, currentIds);
                    appendToolCallIdMapping(currentToolCallIdMap, toolCall.id, toolCall.id);
                    return toolCall;
                }
                const nextId = createUniqueToolCallId(toolCall.id, assistantTurn, toolCallIndex, seenToolCallIds);
                seenToolCallIds.add(nextId);
                currentIds.push(nextId);
                currentToolCallIds.set(toolCall.id, currentIds);
                appendToolCallIdMapping(currentToolCallIdMap, toolCall.id, nextId);
                return {
                    ...toolCall,
                    id: nextId,
                };
            }) ?? [];
            const additionalKwargs = rewriteAdditionalKwargsToolCalls(message.additional_kwargs, currentToolCallIdMap);
            normalizedMessages.push(new AIMessage({
                id: message.id,
                name: message.name,
                content: message.content,
                additional_kwargs: additionalKwargs,
                response_metadata: message.response_metadata,
                tool_calls: toolCalls,
                invalid_tool_calls: message.invalid_tool_calls,
                usage_metadata: message.usage_metadata,
            }));
            continue;
        }

        const currentIds = ToolMessage.isInstance(message)
            ? currentToolCallIds.get(message.tool_call_id)
            : undefined;
        if (ToolMessage.isInstance(message) && currentIds && currentIds.length > 0) {
            normalizedMessages.push(new ToolMessage({
                id: message.id,
                name: message.name,
                content: message.content,
                status: message.status,
                tool_call_id: currentIds.shift()!,
                metadata: message.metadata,
                additional_kwargs: message.additional_kwargs,
            }));
            continue;
        }

        normalizedMessages.push(message);
    }

    return normalizedMessages;
}

/**
 * 记录单轮 assistant 内原始 provider id 到临时唯一 id 的映射。
 */
function appendToolCallIdMapping(target: Map<string, string[]>, originalId: string, nextId: string): void {
    const ids = target.get(originalId) ?? [];
    ids.push(nextId);
    target.set(originalId, ids);
}

/**
 * 同步改写 additional_kwargs.tool_calls，避免 provider 转换层继续读到旧 id。
 */
function rewriteAdditionalKwargsToolCalls(additionalKwargs: Record<string, unknown>, toolCallIdMap: Map<string, string[]>): Record<string, unknown> {
    const rawToolCalls = additionalKwargs.tool_calls;
    if (!Array.isArray(rawToolCalls) || toolCallIdMap.size === 0) {
        return additionalKwargs;
    }

    const localIds = new Map([...toolCallIdMap.entries()].map(([key, ids]) => [key, [...ids]]));
    return {
        ...additionalKwargs,
        tool_calls: rawToolCalls.map((toolCall) => rewriteAdditionalKwargsToolCall(toolCall, localIds)),
    };
}

/**
 * 改写单个 OpenAI-compatible raw tool_call id。
 */
function rewriteAdditionalKwargsToolCall(toolCall: unknown, toolCallIdMap: Map<string, string[]>): unknown {
    if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall) || !("id" in toolCall)) {
        return toolCall;
    }
    const originalId = (toolCall as {id?: unknown}).id;
    if (typeof originalId !== "string") {
        return toolCall;
    }
    const ids = toolCallIdMap.get(originalId);
    if (!ids?.length) {
        return toolCall;
    }
    return {
        ...toolCall,
        id: ids.shift()!,
    };
}

/**
 * 生成 Bedrock 可接受的请求内 tool call id。
 */
function createUniqueToolCallId(
    originalId: string,
    assistantTurn: number,
    toolCallIndex: number,
    seenToolCallIds: Set<string>,
): string {
    const baseId = `${originalId}__turn_${String(assistantTurn)}`;
    if (!seenToolCallIds.has(baseId)) {
        return baseId;
    }
    let suffix = toolCallIndex + 1;
    while (seenToolCallIds.has(`${baseId}_${String(suffix)}`)) {
        suffix += 1;
    }
    return `${baseId}_${String(suffix)}`;
}

/**
 * 为已开始但没有落盘结果的工具调用补一条失败结果，避免后续请求携带非法历史。
 */
function createInterruptedToolMessage(assistantMessage: AIMessage, toolCall: NonNullable<AIMessage["tool_calls"]>[number]): ToolMessage {
    const assistantMessageId = typeof assistantMessage.additional_kwargs.messageId === "string"
        ? assistantMessage.additional_kwargs.messageId
        : assistantMessage.id;
    return new ToolMessage({
        id: toolCall.id,
        name: toolCall.name,
        content: INTERRUPTED_TOOL_RESULT_TEXT,
        status: "error",
        tool_call_id: toolCall.id ?? "interrupted-tool-call",
        metadata: {
            toolArgs: JSON.stringify(toolCall.args ?? {}),
        },
        additional_kwargs: {
            ...(assistantMessageId ? {assistantMessageId} : {}),
            interrupted: true,
        },
    });
}

/**
 * 根据 LangChain message 判定持久化角色。
 */
function resolveRole(message: BaseMessage): AgentMessageRole {
    const messageType = message._getType();
    if (messageType === "human") {
        return "user";
    }
    if (messageType === "ai") {
        return "assistant";
    }
    if (messageType === "tool") {
        return "tool";
    }
    return "system";
}

/**
 * 将附加参数收敛为 JSON 对象。
 */
function normalizeJsonObject(value: unknown): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(value)) as JsonObject;
    } catch {
        return {};
    }
}

/**
 * 从 JSON 对象里读取数字字段。
 */
function readNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
