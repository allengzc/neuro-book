import type {AgentMessage, AgentUserMessageInput, AssistantMessage, Message, TextContent, ToolResultMessage, Usage} from "nbook/server/agent/messages/types";
import type {AgentToolResult} from "@earendil-works/pi-agent-core";

export const EMPTY_USAGE: Usage = {
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
};

/**
 * 累加多次 assistant provider usage。
 */
export function sumUsage(usages: Array<Usage | undefined>): Usage | undefined {
    const presentUsages = usages.filter((usage): usage is Usage => Boolean(usage));
    if (presentUsages.length === 0) {
        return undefined;
    }

    const hasReasoning = presentUsages.some((usage) => usage.reasoning !== undefined);
    const hasCacheWrite1h = presentUsages.some((usage) => usage.cacheWrite1h !== undefined);
    const total = presentUsages.reduce<Usage>((sum, usage) => ({
        input: sum.input + usage.input,
        output: sum.output + usage.output,
        cacheRead: sum.cacheRead + usage.cacheRead,
        cacheWrite: sum.cacheWrite + usage.cacheWrite,
        totalTokens: sum.totalTokens + usage.totalTokens,
        cost: {
            input: sum.cost.input + usage.cost.input,
            output: sum.cost.output + usage.cost.output,
            cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
            cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
            total: sum.cost.total + usage.cost.total,
        },
    }), EMPTY_USAGE);
    return {
        ...total,
        ...(hasReasoning ? {reasoning: presentUsages.reduce((sum, usage) => sum + (usage.reasoning ?? 0), 0)} : {}),
        ...(hasCacheWrite1h ? {cacheWrite1h: presentUsages.reduce((sum, usage) => sum + (usage.cacheWrite1h ?? 0), 0)} : {}),
    };
}

/**
 * 汇总 session 消息里的所有 assistant provider usage。
 */
export function sumAssistantUsage(messages: AgentMessage[]): Usage | undefined {
    return sumUsage(messages.map((message) => message.role === "assistant" ? message.usage : undefined));
}

/**
 * 当前时间戳。集中封装，测试中可以用显式 timestamp 覆盖。
 */
export function now(): number {
    return Date.now();
}

/**
 * 构造 Pi user message。
 */
export function createUserMessage(input: AgentUserMessageInput, timestamp = now()): Message {
    const textBlock: TextContent = {
        type: "text",
        text: input.text,
    };

    return {
        role: "user",
        content: input.images?.length ? [textBlock, ...input.images] : [textBlock],
        timestamp,
    };
}

/**
 * 构造纯文本 tool result。
 */
export function createTextToolResult(input: {
    toolCallId: string;
    toolName: string;
    text: string;
    isError?: boolean;
    details?: unknown;
    timestamp?: number;
}): ToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: [{type: "text", text: input.text}],
        details: input.details,
        isError: input.isError ?? false,
        timestamp: input.timestamp ?? now(),
    };
}

/**
 * 从工具原始结果构造 toolResult，保留图片等非文本 content。
 */
export function createToolResultFromResult(input: {
    toolCallId: string;
    toolName: string;
    result: AgentToolResult<unknown>;
    isError?: boolean;
    timestamp?: number;
}): ToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: input.result.content,
        details: input.result.details,
        isError: input.isError ?? false,
        timestamp: input.timestamp ?? now(),
    };
}

/**
 * 构造测试或兜底用 assistant message。
 */
export function createAssistantTextMessage(input: {
    text: string;
    model?: string;
    api?: string;
    provider?: string;
    stopReason?: AssistantMessage["stopReason"];
    usage?: Usage;
    timestamp?: number;
}): AssistantMessage {
    return {
        role: "assistant",
        content: [{type: "text", text: input.text}],
        api: input.api ?? "neuro-book",
        provider: input.provider ?? "neuro-book",
        model: input.model ?? "neuro-agent",
        usage: input.usage ?? EMPTY_USAGE,
        stopReason: input.stopReason ?? "stop",
        timestamp: input.timestamp ?? now(),
    };
}

/**
 * 从 message 中提取人类可读文本。
 */
export function messageText(message: Message, options?: { stripThinking?: boolean } | number): string {
    // 当作为 Array.prototype.map(messageText) 的回调时，第二个参数 options 传入的是 index (number)。
    // 此时不应进行 stripThinking，故仅在 options 为 object 时读取 stripThinking。
    const stripThinking = (options && typeof options === "object") ? options.stripThinking : false;

    if (message.role === "user") {
        if (typeof message.content === "string") {
            return message.content;
        }
        return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    }

    if (message.role === "assistant") {
        return message.content.map((block) => {
            if (block.type === "text") {
                return block.text;
            }
            if (block.type === "thinking") {
                return stripThinking ? "" : block.thinking;
            }
            return `[tool:${block.name}]`;
        }).filter(Boolean).join("\n");
    }

    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

/**
 * 判断 assistant message 是否包含指定 tool call。
 */
export function hasToolCall(message: Message, toolName?: string): boolean {
    return message.role === "assistant" && message.content.some((block) => {
        return block.type === "toolCall" && (!toolName || block.name === toolName);
    });
}
