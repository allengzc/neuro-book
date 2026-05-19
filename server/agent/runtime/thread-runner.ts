import type {BaseMessage, ToolCall} from "@langchain/core/messages";
import {AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, isBaseMessage, isBaseMessageChunk} from "@langchain/core/messages";
import type {DynamicStructuredTool} from "@langchain/core/tools";
import type {z} from "zod";
import {createToolMessage, createToolResultMessage, normalizeToolMessageContent} from "nbook/server/agent/tools/shared/tool-message";
import type {AgentToolContext, AgentToolResult} from "nbook/server/agent/tools/agent-tool";
import type {BoundAgentTool} from "nbook/server/agent/tools/tool-registry";
import type {ModelProvider} from "nbook/server/agent/runtime/model-provider";
import type {AgentThreadRecord, JsonValue, ProfileKey, ToolKey} from "nbook/server/agent/types";

const MAX_REACT_ITERATIONS = 100;

/**
 * 自研 ReAct runner 的事件。
 * 它替代 LangChain streamEvents，但保留 coordinator 需要的模型/工具边界信息。
 */
export type AgentRunnerEvent =
    | {
        type: "model_delta";
        chunkText: string;
        thinkingText: string;
        toolCallChunks: AgentRunnerToolCallChunk[];
    }
    | {
        type: "model_end";
        message: AIMessage;
    }
    | {
        type: "tool_start";
        runId: string;
        name: string;
        input: JsonValue;
        inputText: string;
        toolCallId?: string;
        callIndex: number;
    }
    | {
        type: "tool_end";
        runId: string;
        name: string;
        output: ToolMessage;
        toolCallId?: string;
        callIndex: number;
    }
    | {
        type: "tool_error";
        runId: string;
        name: string;
        error: ToolMessage;
        toolCallId?: string;
        callIndex: number;
    }
    | {
        type: "tool_batch_end";
    };

export type AgentRunnerToolCallChunk = {
    callIndex: number;
    toolCallId?: string;
    toolName?: string;
    argsChunk?: string;
};

type ToolCallDraft = {
    callIndex: number;
    toolCallId?: string;
    toolName?: string;
    argsText: string;
};

type ToolExecutionResult = {
    callIndex: number;
    runId: string;
    toolCall: ToolCall;
    toolMessage: ToolMessage;
};

type StreamableChatModel = {
    stream(input: BaseMessage[], options?: {signal?: AbortSignal}): Promise<AsyncIterable<BaseMessage | AIMessageChunk>>;
};

/**
 * Agent 线程运行器。
 * 只依赖 LangChain 的 Message、model 与 tool binding，不使用 LangChain Agent / checkpoint。
 */
export class AgentThreadRunner {
    constructor(
        private readonly modelProvider: ModelProvider,
    ) {}

    /**
     * 启动一次自研 ReAct 流式执行。
     */
    async streamPreparedEvents(
        thread: AgentThreadRecord,
        profileKey: ProfileKey,
        messages: BaseMessage[],
        tools: BoundAgentTool[],
        signal?: AbortSignal,
    ): Promise<AsyncIterable<AgentRunnerEvent>> {
        const model = this.modelProvider.getChatModel({
            thread,
            profileKey,
        });
        const runnable = typeof model.bindTools === "function"
            ? model.bindTools(toLangChainTools(tools))
            : model;
        const toolMap = new Map<ToolKey, BoundAgentTool>();
        for (const tool of tools) {
            toolMap.set(tool.definition.key, tool);
        }

        return this.createReactEventStream({
            messages: [...messages],
            runnable,
            toolMap,
            signal,
        });
    }

    /**
     * 生成 ReAct 事件流。
     */
    private async *createReactEventStream(input: {
        messages: BaseMessage[];
        runnable: StreamableChatModel;
        toolMap: Map<ToolKey, BoundAgentTool>;
        signal?: AbortSignal;
    }): AsyncGenerator<AgentRunnerEvent> {
        const messages = input.messages;
        for (let iteration = 0; iteration < MAX_REACT_ITERATIONS; iteration += 1) {
            throwIfAborted(input.signal);
            const modelResult = yield* this.streamModelIteration(input.runnable, messages, input.signal);
            messages.push(modelResult.message);
            if (modelResult.toolCalls.length === 0) {
                return;
            }

            const toolExecutions: Array<Promise<ToolExecutionResult>> = [];
            for (let callIndex = 0; callIndex < modelResult.toolCalls.length; callIndex += 1) {
                const toolCall = modelResult.toolCalls[callIndex]!;
                const runId = crypto.randomUUID();
                const toolCallId = requireToolCallId(toolCall);
                const inputText = stringifyToolInput(toolCall.args ?? {});
                yield {
                    type: "tool_start",
                    runId,
                    name: toolCall.name,
                    input: normalizeJsonValue(toolCall.args ?? {}),
                    inputText,
                    toolCallId,
                    callIndex,
                };

                toolExecutions.push(this.executeToolCall({
                    toolMap: input.toolMap,
                    toolCall,
                    toolCallId,
                }).then((toolMessage) => ({
                    callIndex,
                    runId,
                    toolCall,
                    toolMessage,
                })));
            }

            const toolResults = (await Promise.all(toolExecutions))
                .sort((left, right) => left.callIndex - right.callIndex);
            for (const result of toolResults) {
                yield {
                    type: result.toolMessage.status === "error" ? "tool_error" : "tool_end",
                    runId: result.runId,
                    name: result.toolCall.name,
                    output: result.toolMessage,
                    error: result.toolMessage,
                    toolCallId: requireToolCallId(result.toolCall),
                    callIndex: result.callIndex,
                } as AgentRunnerEvent;
            }
            messages.push(...toolResults.map((result) => result.toolMessage));
            yield {
                type: "tool_batch_end",
            };
        }

        throw new Error(`ReAct 循环超过最大迭代次数 ${MAX_REACT_ITERATIONS}`);
    }

    /**
     * 执行一轮模型调用并聚合最终 AIMessage。
     */
    private async *streamModelIteration(
        runnable: StreamableChatModel,
        messages: BaseMessage[],
        signal?: AbortSignal,
    ): AsyncGenerator<AgentRunnerEvent, {message: AIMessage; toolCalls: ToolCall[]}> {
        const stream = await runnable.stream(messages, {signal});
        let aggregated: AIMessageChunk | null = null;
        let fallbackMessage: AIMessage | null = null;
        const toolDrafts = new Map<number, ToolCallDraft>();

        for await (const chunk of stream) {
            throwIfAborted(signal);
            if (AIMessageChunk.isInstance(chunk)) {
                aggregated = aggregated ? aggregated.concat(chunk) : chunk;
                const extracted = extractAssistantDeltaFromChunk(chunk);
                mergeToolDrafts(toolDrafts, extracted.toolCallChunks);
                yield {
                    type: "model_delta",
                    ...extracted,
                };
                continue;
            }
            if (AIMessage.isInstance(chunk)) {
                fallbackMessage = chunk;
                const extracted = extractAssistantDeltaFromMessage(chunk);
                mergeToolDrafts(toolDrafts, extracted.toolCallChunks);
                yield {
                    type: "model_delta",
                    ...extracted,
                };
            }
        }

        const message = this.toAIMessage(aggregated, fallbackMessage, toolDrafts);
        yield {
            type: "model_end",
            message,
        };
        return {
            message,
            toolCalls: message.tool_calls ?? [],
        };
    }

    /**
     * 执行一个工具调用。
     */
    private async executeToolCall(input: {
        toolMap: Map<ToolKey, BoundAgentTool>;
        toolCall: ToolCall;
        toolCallId: string;
    }): Promise<ToolMessage> {
        const tool = input.toolMap.get(input.toolCall.name);
        if (!tool) {
            return this.createErrorToolMessage({
                toolCallId: input.toolCallId,
                toolName: input.toolCall.name,
                toolArgs: stringifyToolInput(input.toolCall.args ?? {}),
                content: `未注册的 toolKey: ${input.toolCall.name}`,
            });
        }

        const parsedInput = tool.definition.schema.safeParse(input.toolCall.args);
        if (!parsedInput.success) {
            return this.createErrorToolMessage({
                toolCallId: input.toolCallId,
                toolName: tool.definition.key,
                toolArgs: stringifyToolInput(input.toolCall.args ?? {}),
                content: renderToolArgumentError(tool.definition.key, parsedInput.error),
            });
        }

        let result: AgentToolResult;
        try {
            result = await tool.definition.execute(parsedInput.data, this.createExecutionContext(tool, input.toolCallId));
        } catch (error) {
            result = createToolResultMessage(error, stringifyToolInput(parsedInput.data), "error");
        }

        const normalizedContent = normalizeToolMessageContent(result.content, result.status ?? "success");
        return createToolMessage({
            toolCallId: input.toolCallId,
            toolName: tool.definition.key,
            result: {
                ...result,
                content: normalizedContent,
                toolArgs: result.toolArgs ?? stringifyToolInput(parsedInput.data),
            },
        });
    }

    /**
     * 创建工具执行上下文。
     */
    private createExecutionContext(tool: BoundAgentTool, toolCallId: string): AgentToolContext {
        return {
            ...tool.context,
            writeToolOutput: (chunkText: string) => {
                if (!chunkText) {
                    return;
                }
                tool.context.agentGateway.publishToolOutputDelta(tool.context.threadId, toolCallId, chunkText);
            },
        };
    }

    /**
     * 生成错误工具消息。
     */
    private createErrorToolMessage(input: {
        toolCallId: string;
        toolName: string;
        toolArgs: string;
        content: string;
    }): ToolMessage {
        return createToolMessage({
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            result: createToolResultMessage(input.content, input.toolArgs, "error"),
        });
    }

    /**
     * 将聚合 chunk 转成 AIMessage。
     */
    private toAIMessage(
        aggregated: AIMessageChunk | null,
        fallbackMessage: AIMessage | null,
        toolDrafts: Map<number, ToolCallDraft>,
    ): AIMessage {
        if (aggregated) {
            const toolCalls = resolveToolCalls(aggregated.tool_calls ?? [], toolDrafts);
            return new AIMessage({
                id: aggregated.id,
                content: aggregated.content,
                additional_kwargs: aggregated.additional_kwargs,
                response_metadata: aggregated.response_metadata,
                tool_calls: toolCalls,
                invalid_tool_calls: aggregated.invalid_tool_calls,
                usage_metadata: aggregated.usage_metadata,
            });
        }
        if (fallbackMessage) {
            return new AIMessage({
                id: fallbackMessage.id,
                name: fallbackMessage.name,
                content: fallbackMessage.content,
                additional_kwargs: fallbackMessage.additional_kwargs,
                response_metadata: fallbackMessage.response_metadata,
                tool_calls: normalizeToolCalls(fallbackMessage.tool_calls ?? []),
                invalid_tool_calls: fallbackMessage.invalid_tool_calls,
                usage_metadata: fallbackMessage.usage_metadata,
            });
        }
        return new AIMessage("");
    }
}

/**
 * 合并 LangChain 聚合结果与原始 tool_call_chunks 草稿。
 * 原始参数能解析时优先使用原始参数；否则回退聚合结果，避免空/半截 chunk 覆盖完整参数。
 */
function resolveToolCalls(aggregatedToolCalls: ToolCall[], toolDrafts: Map<number, ToolCallDraft>): ToolCall[] {
    if (toolDrafts.size === 0) {
        return normalizeToolCalls(aggregatedToolCalls);
    }

    const maxCallCount = Math.max(aggregatedToolCalls.length, ...toolDrafts.keys().map((index) => index + 1));
    const toolCalls: ToolCall[] = [];
    for (let callIndex = 0; callIndex < maxCallCount; callIndex += 1) {
        const draft = toolDrafts.get(callIndex);
        const aggregated = aggregatedToolCalls[callIndex];
        const draftArgs = parseCompleteToolArgs(draft?.argsText ?? "");
        const name = draft?.toolName ?? aggregated?.name;
        if (!name) {
            continue;
        }
        toolCalls.push({
            id: draft?.toolCallId ?? aggregated?.id,
            name,
            args: draftArgs ?? aggregated?.args ?? {},
            type: "tool_call",
        });
    }
    return normalizeToolCalls(toolCalls);
}

/**
 * 从流式 chunk 中提取文本、思维和工具调用增量。
 */
export function extractAssistantDeltaFromChunk(chunk: AIMessageChunk): {
    chunkText: string;
    thinkingText: string;
    toolCallChunks: AgentRunnerToolCallChunk[];
} {
    const thinkingText =
        typeof chunk.additional_kwargs?.thinking_content === "string" ? chunk.additional_kwargs.thinking_content :
        typeof chunk.additional_kwargs?.reasoning_content === "string" ? chunk.additional_kwargs.reasoning_content :
        "";

    return {
        chunkText: chunk.text,
        thinkingText,
        toolCallChunks: (chunk.tool_call_chunks ?? [])
            .filter((toolCallChunk: {index?: number}) => typeof toolCallChunk.index === "number")
            .map((toolCallChunk: {index?: number; id?: string; name?: string; args?: string}) => ({
                callIndex: toolCallChunk.index!,
                toolCallId: toolCallChunk.id,
                toolName: toolCallChunk.name,
                argsChunk: toolCallChunk.args,
            })),
    };
}

/**
 * 兼容旧调试测试的导出名。
 */
export function extractAssistantDelta(event: {data: {chunk?: unknown}}): {
    chunkText: string;
    thinkingText: string;
    toolCallChunks: AgentRunnerToolCallChunk[];
} {
    const chunk = event.data.chunk;
    if (AIMessageChunk.isInstance(chunk)) {
        return extractAssistantDeltaFromChunk(chunk);
    }
    if (AIMessage.isInstance(chunk)) {
        return extractAssistantDeltaFromMessage(chunk);
    }
    if (isBaseMessage(chunk) || isBaseMessageChunk(chunk)) {
        return {
            chunkText: chunk.text,
            thinkingText: "",
            toolCallChunks: [],
        };
    }
    if (typeof chunk === "string") {
        return {
            chunkText: chunk,
            thinkingText: "",
            toolCallChunks: [],
        };
    }
    if (chunk && typeof chunk === "object") {
        const maybeChunk = chunk as {
            text?: unknown;
            additional_kwargs?: Record<string, unknown>;
            tool_call_chunks?: Array<{index?: number; id?: string; name?: string; args?: string}>;
        };
        const thinkingText =
            typeof maybeChunk.additional_kwargs?.thinking_content === "string" ? maybeChunk.additional_kwargs.thinking_content :
            typeof maybeChunk.additional_kwargs?.reasoning_content === "string" ? maybeChunk.additional_kwargs.reasoning_content :
            "";
        return {
            chunkText: typeof maybeChunk.text === "string" ? maybeChunk.text : "",
            thinkingText,
            toolCallChunks: (maybeChunk.tool_call_chunks ?? [])
                .filter((toolCallChunk) => typeof toolCallChunk.index === "number")
                .map((toolCallChunk) => ({
                    callIndex: toolCallChunk.index!,
                    toolCallId: toolCallChunk.id,
                    toolName: toolCallChunk.name,
                    argsChunk: toolCallChunk.args,
                })),
        };
    }
    return {
        chunkText: "",
        thinkingText: "",
        toolCallChunks: [],
    };
}

/**
 * 从非 chunk AIMessage 中提取一次性 delta。
 */
function extractAssistantDeltaFromMessage(message: AIMessage): {
    chunkText: string;
    thinkingText: string;
    toolCallChunks: AgentRunnerToolCallChunk[];
} {
    const thinkingText =
        typeof message.additional_kwargs?.thinking_content === "string" ? message.additional_kwargs.thinking_content :
        typeof message.additional_kwargs?.reasoning_content === "string" ? message.additional_kwargs.reasoning_content :
        "";
    return {
        chunkText: message.text,
        thinkingText,
        toolCallChunks: (message.tool_calls ?? []).map((toolCall, index) => ({
            callIndex: index,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            argsChunk: stringifyToolInput(toolCall.args ?? {}),
        })),
    };
}

/**
 * 将任意结构化值格式化为稳定文本。
 */
export function stringifyEventValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (isBaseMessage(value) || isBaseMessageChunk(value)) {
        return value.text;
    }
    return stringifyToolInput(value);
}

/**
 * 根据消息角色复制消息文本。
 */
export function cloneMessageByRole(message: BaseMessage): BaseMessage {
    if (message._getType() === "system") {
        return new SystemMessage(message.text);
    }
    if (message._getType() === "ai") {
        return new AIMessage(message.text);
    }
    return new HumanMessage(message.text);
}

/**
 * 转换 LangChain tool binding 列表。
 */
function toLangChainTools(tools: BoundAgentTool[]): DynamicStructuredTool[] {
    return tools.map((tool) => tool.langChainTool);
}

/**
 * 合并工具调用草稿。
 */
function mergeToolDrafts(drafts: Map<number, ToolCallDraft>, chunks: AgentRunnerToolCallChunk[]): void {
    for (const chunk of chunks) {
        const draft = drafts.get(chunk.callIndex) ?? {
            callIndex: chunk.callIndex,
            argsText: "",
        };
        if (chunk.toolCallId) {
            draft.toolCallId = chunk.toolCallId;
        }
        if (chunk.toolName) {
            draft.toolName = chunk.toolName;
        }
        if (chunk.argsChunk) {
            draft.argsText = mergeArgsText(draft.argsText, chunk.argsChunk);
        }
        drafts.set(chunk.callIndex, draft);
    }
}

/**
 * 归并 provider 可能返回的累计参数文本或增量参数文本。
 */
function mergeArgsText(previous: string, rawChunk: string): string {
    if (!rawChunk) {
        return previous;
    }
    if (rawChunk.startsWith(previous)) {
        return rawChunk;
    }
    const maxOverlap = Math.min(previous.length, rawChunk.length);
    for (let index = maxOverlap; index > 0; index -= 1) {
        if (previous.endsWith(rawChunk.slice(0, index))) {
            return `${previous}${rawChunk.slice(index)}`;
        }
    }
    return `${previous}${rawChunk}`;
}

/**
 * 将工具草稿转换为 ToolCall。
 */
function toToolCall(draft: ToolCallDraft): ToolCall | null {
    if (!draft.toolName) {
        return null;
    }
    return {
        id: draft.toolCallId,
        name: draft.toolName,
        args: parseToolArgs(draft.argsText),
        type: "tool_call",
    };
}

/**
 * 只在参数文本是完整 JSON object 时返回解析结果。
 */
function parseCompleteToolArgs(argsText: string): Record<string, unknown> | null {
    if (!argsText.trim()) {
        return null;
    }
    try {
        const parsed = JSON.parse(argsText) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

/**
 * 为缺失 id 的 tool call 补齐稳定 id。
 */
function normalizeToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    return toolCalls.map((toolCall) => ({
        ...toolCall,
        id: toolCall.id?.trim() ? toolCall.id : `tool-call-${crypto.randomUUID()}`,
    }));
}

/**
 * 读取已归一化的 tool call id。
 */
function requireToolCallId(toolCall: ToolCall): string {
    if (toolCall.id?.trim()) {
        return toolCall.id;
    }
    const toolCallId = `tool-call-${crypto.randomUUID()}`;
    toolCall.id = toolCallId;
    return toolCallId;
}

/**
 * 解析工具参数。
 */
function parseToolArgs(argsText: string): Record<string, unknown> {
    return parseCompleteToolArgs(argsText) ?? {};
}

/**
 * 序列化工具参数。
 */
function stringifyToolInput(input: unknown): string {
    try {
        return JSON.stringify(input ?? {});
    } catch {
        return "{}";
    }
}

/**
 * 转成 JSON 值。
 */
function normalizeJsonValue(input: unknown): JsonValue {
    try {
        return JSON.parse(JSON.stringify(input ?? {})) as JsonValue;
    } catch {
        return {};
    }
}

/**
 * 渲染工具参数错误。
 */
function renderToolArgumentError(toolName: ToolKey, error: z.ZodError): string {
    const issues = error.issues.map((issue) => {
        const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `- ${fieldPath}: ${issue.message}`;
    });
    return [`Invalid ${toolName} arguments.`, ...issues].join("\n");
}

/**
 * 检查 abort。
 */
function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException("Agent run aborted", "AbortError");
    }
}
