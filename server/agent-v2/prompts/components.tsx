import type {BaseMessage} from "@langchain/core/messages";
import type {RuntimeMessageRole} from "nbook/server/agent/types";
import type {
    PromptChild,
    PromptFragmentNode,
    PromptHistoryNode,
    PromptMessageNode,
    PromptMessageSource,
    PromptNode,
    PromptToolCallNode,
} from "nbook/server/agent/prompts/types";

/**
 * 规范化 children。
 */
function normalizeChildren(children: PromptChild | PromptChild[] | undefined): PromptChild[] {
    if (children === undefined) {
        return [];
    }
    return Array.isArray(children) ? children : [children];
}

/**
 * Message 组件属性。
 */
export type MessageProps = {
    role: RuntimeMessageRole;
    /**
     * 何时写入历史。
     * `context` 仅参与本次 prompt。
     * `input` 会在 prepare 阶段写入历史。
     */
    source?: PromptMessageSource;
    children?: PromptChild | PromptChild[];
};

/**
 * 生成一条消息节点。
 */
export function Message(props: MessageProps): PromptMessageNode {
    return {
        kind: "message",
        role: props.role,
        source: props.source ?? "context",
        children: normalizeChildren(props.children),
    };
}

/**
 * AIMessage 组件属性。
 */
export type AIMessageProps = {
    children?: PromptChild | PromptChild[];
};

/**
 * 生成一条 assistant 消息节点，可包含 ToolCall 子节点。
 */
export function AIMessage(props: AIMessageProps): PromptMessageNode {
    const children = normalizeChildren(props.children);
    return {
        kind: "message",
        role: "assistant",
        source: "context",
        children: children.filter((child) => !(typeof child === "object" && child !== null && !Array.isArray(child) && child.kind === "tool_call")),
        toolCalls: children.filter((child): child is PromptToolCallNode => typeof child === "object" && child !== null && !Array.isArray(child) && child.kind === "tool_call"),
    };
}

/**
 * ToolCall 组件属性。
 */
export type ToolCallProps = {
    id?: string;
    name: string;
    args?: string;
    children?: PromptChild | PromptChild[];
};

/**
 * 生成 assistant tool call 预览节点。
 */
export function ToolCall(props: ToolCallProps): PromptToolCallNode {
    return {
        kind: "tool_call",
        id: props.id ?? `call-${crypto.randomUUID()}`,
        name: props.name,
        argsText: props.args ?? normalizeChildren(props.children).map((child) => typeof child === "string" || typeof child === "number" ? String(child) : "").join(""),
    };
}

/**
 * History 组件属性。
 */
export type HistoryProps = {
    messages: BaseMessage[];
};

/**
 * 注入逻辑历史。
 */
export function History(props: HistoryProps): PromptHistoryNode {
    return {
        kind: "history",
        messages: props.messages,
    };
}

/**
 * Fragment 组件属性。
 */
export type FragmentProps = {
    children?: PromptChild | PromptChild[];
};

/**
 * 生成片段节点。
 */
export function Fragment(props: FragmentProps): PromptFragmentNode {
    return {
        kind: "fragment",
        children: normalizeChildren(props.children),
    };
}

/**
 * If 组件属性。
 */
export type IfProps = {
    condition: boolean;
    children?: PromptChild | PromptChild[];
};

/**
 * 条件注入 prompt 片段。
 */
export function If(props: IfProps): PromptFragmentNode {
    return {
        kind: "fragment",
        children: props.condition ? normalizeChildren(props.children) : [],
    };
}
