import type {AgentMessage, AgentTool, AgentToolCall, AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage} from "nbook/server/agent/messages/types";

export type ModelRequestTokenEstimate = {
    tokens: number;
    messageTokens: number;
    systemPromptTokens: number;
    toolTokens: number;
    overheadTokens: number;
};

const IMAGE_TOKEN_ESTIMATE = 4800;
const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_OVERHEAD_TOKENS = 12;
const SYSTEM_PROMPT_OVERHEAD_TOKENS = 4;

/**
 * 按“真正发给 provider 的请求”估算 token。
 *
 * 这里刻意不复用 pi-agent-core 的 char / 4 粗估：中文长文本会被严重低估，
 * 而 Agent 请求还包含 system prompt 与 tool schema，这些都必须进入发送前预算。
 */
export function estimateModelRequestTokens(input: {
    systemPrompt?: string | null;
    messages: readonly AgentMessage[];
    tools?: readonly Pick<AgentTool, "name" | "description" | "parameters">[];
}): ModelRequestTokenEstimate {
    const providerMessages = input.messages.filter(isProviderVisibleMessage);
    const systemPromptTokens = input.systemPrompt ? estimateTextTokens(input.systemPrompt) : 0;
    const messageTokens = providerMessages.reduce((total, message) => total + estimateMessageTokens(message), 0);
    const toolTokens = (input.tools ?? []).reduce((total, tool) => total + estimateToolTokens(tool), 0);
    const overheadTokens = providerMessages.length * MESSAGE_OVERHEAD_TOKENS
        + (input.tools?.length ?? 0) * TOOL_OVERHEAD_TOKENS
        + (systemPromptTokens > 0 ? SYSTEM_PROMPT_OVERHEAD_TOKENS : 0);
    return {
        tokens: systemPromptTokens + messageTokens + toolTokens + overheadTokens,
        messageTokens,
        systemPromptTokens,
        toolTokens,
        overheadTokens,
    };
}

/**
 * 更保守的文本 token 估算：CJK 字符按 1 token，非 CJK 文本按 4 字符约 1 token。
 */
export function estimateTextTokens(text: string): number {
    let cjkTokens = 0;
    let nonCjkChars = 0;
    let wideSymbolTokens = 0;
    for (const char of text) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (isCjkLikeCodePoint(codePoint)) {
            cjkTokens += 1;
            continue;
        }
        if (codePoint > 0xffff) {
            wideSymbolTokens += 2;
            continue;
        }
        nonCjkChars += 1;
    }
    return cjkTokens + wideSymbolTokens + Math.ceil(nonCjkChars / 4);
}

/**
 * 估算单条 provider 可见消息。custom/bash 等本地运行态消息不会直接发给 provider。
 */
export function estimateMessageTokens(message: Message): number {
    switch (message.role) {
        case "user":
            return estimateUserContentTokens(message.content);
        case "assistant":
            return estimateAssistantTokens(message);
        case "toolResult":
            return estimateToolResultTokens(message);
    }
}

function estimateUserContentTokens(content: string | Array<TextContent | ImageContent>): number {
    if (typeof content === "string") {
        return estimateTextTokens(content);
    }
    return content.reduce((total, block) => {
        if (block.type === "text") {
            return total + estimateTextTokens(block.text);
        }
        return total + IMAGE_TOKEN_ESTIMATE;
    }, 0);
}

function estimateAssistantTokens(message: AssistantMessage): number {
    return message.content.reduce((total, block) => {
        if (block.type === "text") {
            return total + estimateTextTokens(block.text);
        }
        if (block.type === "thinking") {
            return total + estimateTextTokens(block.thinking);
        }
        return total + estimateToolCallTokens(block);
    }, 0);
}

function estimateToolCallTokens(block: AgentToolCall): number {
    return estimateTextTokens(block.name) + estimateTextTokens(safeJsonStringify(block.arguments ?? {}));
}

function estimateToolResultTokens(message: ToolResultMessage): number {
    if (typeof message.content === "string") {
        return estimateTextTokens(message.content);
    }
    return message.content.reduce((total, block) => {
        if (block.type === "text") {
            return total + estimateTextTokens(block.text);
        }
        return total + IMAGE_TOKEN_ESTIMATE;
    }, 0);
}

function estimateToolTokens(tool: Pick<AgentTool, "name" | "description" | "parameters">): number {
    return estimateTextTokens(tool.name)
        + estimateTextTokens(tool.description)
        + estimateTextTokens(safeJsonStringify(tool.parameters));
}

function isProviderVisibleMessage(message: AgentMessage): message is Message {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function isCjkLikeCodePoint(codePoint: number): boolean {
    return (codePoint >= 0x3400 && codePoint <= 0x9fff)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0x20000 && codePoint <= 0x2ebef)
        || (codePoint >= 0x3040 && codePoint <= 0x30ff)
        || (codePoint >= 0xac00 && codePoint <= 0xd7af);
}

/**
 * provider tool schema 来自第三方类型，运行期可能包含非 JSON 结构；估算失败时降级为字符串。
 */
function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "";
    } catch {
        return String(value);
    }
}
