import {AIMessage, HumanMessage, SystemMessage} from "@langchain/core/messages";
import type {BaseMessage} from "@langchain/core/messages";
import type {PromptChild, PromptMessageNode, PromptNode, PromptTemplate, RenderedPromptTemplate} from "nbook/server/agent/prompts/types";

/**
 * 将 JSX prompt 树渲染为 LangChain 消息。
 */
export function renderPromptTemplate(template: PromptTemplate): RenderedPromptTemplate {
    const messages: BaseMessage[] = [];
    const inputMessages: BaseMessage[] = [];

    renderTopLevel(template, messages, inputMessages);

    return {
        messages,
        inputMessages,
    };
}

/**
 * 渲染顶层节点。
 */
function renderTopLevel(
    node: PromptChild,
    messages: BaseMessage[],
    inputMessages: BaseMessage[],
): void {
    if (node === null || node === undefined || node === false) {
        return;
    }
    if (Array.isArray(node)) {
        for (const item of node) {
            renderTopLevel(item, messages, inputMessages);
        }
        return;
    }
    if (typeof node === "string" || typeof node === "number") {
        if (String(node).trim() === "") {
            return;
        }
        throw new Error("Prompt 顶层不能直接出现文本，请将文本放入 <Message> 中");
    }
    if (node.kind === "fragment") {
        for (const child of node.children) {
            renderTopLevel(child, messages, inputMessages);
        }
        return;
    }
    if (node.kind === "history") {
        messages.push(...node.messages);
        return;
    }
    if (node.kind !== "message") {
        throw new Error(`${node.kind} 节点只能由 SimpleProfile 上下文渲染器处理`);
    }
    const message = toBaseMessage(node);
    messages.push(message);
    if (node.source === "input") {
        inputMessages.push(message);
    }
}

/**
 * 渲染单条消息。
 */
function toBaseMessage(node: PromptMessageNode): BaseMessage {
    const content = renderInline(node.children).trim();
    const additionalKwargs = node.source === "input" ? {
        messageCreatedAt: new Date().toISOString(),
        messageStatus: "done",
        messageId: `msg-${crypto.randomUUID()}`,
        userInput: true,
    } : undefined;

    if (node.role === "system") {
        return additionalKwargs
            ? new SystemMessage({content, additional_kwargs: additionalKwargs})
            : new SystemMessage(content);
    }
    if (node.role === "assistant") {
        return additionalKwargs
            ? new AIMessage({content, additional_kwargs: additionalKwargs})
            : new AIMessage(content);
    }
    return additionalKwargs
        ? new HumanMessage({content, additional_kwargs: additionalKwargs})
        : new HumanMessage(content);
}

/**
 * 渲染消息内联内容。
 */
function renderInline(node: PromptChild): string {
    if (node === null || node === undefined || node === false) {
        return "";
    }
    if (Array.isArray(node)) {
        return node.map((item) => renderInline(item)).join("");
    }
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }

    return renderPromptNode(node);
}

/**
 * 渲染结构化节点。
 */
function renderPromptNode(node: PromptNode): string {
    if (node.kind === "fragment") {
        return node.children.map((child) => renderInline(child)).join("");
    }
    if (node.kind === "tool_call") {
        return "";
    }
    if (node.kind === "message" || node.kind === "history") {
        throw new Error(`${node.kind} 节点不能嵌套在消息内容内部`);
    }
    throw new Error(`${node.kind} 节点不能嵌套在消息内容内部`);
}
