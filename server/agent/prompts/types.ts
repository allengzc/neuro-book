import type {BaseMessage} from "@langchain/core/messages";
import type {JsonValue, RuntimeMessageRole} from "nbook/server/agent/types";

/**
 * prompt 模板中的原始文本值。
 */
export type PromptPrimitive = string | number;

/**
 * prompt 模板子节点。
 */
export type PromptChild =
    | PromptPrimitive
    | PromptNode
    | PromptChild[]
    | null
    | undefined
    | false;

/**
 * Message 节点来源。
 * `input` 表示该消息属于本次真实输入，需要在 prepare 阶段写回历史。
 */
export type PromptMessageSource = "context" | "input";

/**
 * Message 节点。
 */
export type PromptMessageNode = {
    kind: "message";
    role: RuntimeMessageRole;
    source: PromptMessageSource;
    children: PromptChild[];
    toolCalls?: PromptToolCallNode[];
};

/**
 * Assistant tool call 预览节点。
 * 运行时真实 tool call 仍由模型与工具执行链路产生；模板侧仅用于表达静态示例或调试预览。
 */
export type PromptToolCallNode = {
    kind: "tool_call";
    id: string;
    name: string;
    argsText: string;
};

/**
 * profile prompt 根节点。
 * 只允许由 SimpleProfile 消费，普通 prompt renderer 不处理该节点。
 */
export type PromptProfileRootNode = {
    kind: "profile_prompt";
    children: PromptChild[];
};

/**
 * profile prompt 三段式消息集合节点。
 */
export type PromptProfileSetNode = {
    kind: "profile_set";
    set: "history" | "dynamic" | "appending";
    children: PromptChild[];
};

/**
 * profile 最新上下文提醒节点。
 */
export type PromptProfileReminderNode = {
    kind: "profile_reminder";
    id: string;
    when: boolean;
    watchPath?: string;
    watchValue?: JsonValue;
    repeatEveryTurns?: number;
    children: PromptChild[];
};

/**
 * profile watched variable 节点。
 */
export type PromptProfileWatchNode = {
    kind: "profile_watch";
    path: string;
    render(change: {
        previousValue: JsonValue | undefined;
        currentValue: JsonValue | undefined;
        history: BaseMessage[];
        scope: object;
        runtime: object;
    }): PromptChild;
};

/**
 * 历史消息节点。
 */
export type PromptHistoryNode = {
    kind: "history";
    messages: BaseMessage[];
};

/**
 * 片段节点。
 */
export type PromptFragmentNode = {
    kind: "fragment";
    children: PromptChild[];
};

/**
 * Prompt 节点联合。
 */
export type PromptNode =
    | PromptMessageNode
    | PromptToolCallNode
    | PromptHistoryNode
    | PromptFragmentNode
    | PromptProfileRootNode
    | PromptProfileSetNode
    | PromptProfileReminderNode
    | PromptProfileWatchNode;

/**
 * Prompt 模板根节点。
 */
export type PromptTemplate = PromptChild;

/**
 * JSX 组件签名。
 */
export type PromptComponent<TProps> = (props: TProps) => PromptChild;

/**
 * 渲染后的 prompt 结果。
 */
export type RenderedPromptTemplate = {
    messages: BaseMessage[];
    inputMessages: BaseMessage[];
};

declare global {
    namespace JSX {
        interface IntrinsicElements {}
    }
}
