import type {AgentMessage, AgentTool, AgentToolCall, ThinkingLevel} from "@earendil-works/pi-agent-core";
import type {AssistantMessage, ImageContent, Message, Model, TextContent, ToolResultMessage, Usage} from "@earendil-works/pi-ai";

export type {
    AgentMessage,
    AgentTool,
    AgentToolCall,
    AssistantMessage,
    ImageContent,
    Message,
    Model,
    TextContent,
    ThinkingLevel,
    ToolResultMessage,
    Usage,
};

/**
 * v3 运行时可持久化的 JSON 值。
 */
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {[key: string]: JsonValue};

/**
 * Agent 用户输入。文本必填，图片后续由前端按 Pi image block 传入。
 */
export type AgentUserMessageInput = {
    text: string;
    images?: ImageContent[];
};

