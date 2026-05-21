import {AIMessage, type BaseMessage, type ToolCall, type ToolMessage} from "@langchain/core/messages";
import {
    createAssistantMessageInput,
    readAgentMessageAdditionalKwargs,
    readAgentMessageAssistantId,
    readAgentMessageContent,
    readAgentMessageRole,
    readAgentMessageToolArgs,
    readAgentMessageToolCallId,
    readAgentMessageToolName,
    readAgentMessageToolStatus,
    toAgentMessageCreateInput,
    toLangChainMessage,
    toLangChainMessages,
} from "nbook/server/agent/messages/codec";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {ActiveRunSession} from "nbook/server/agent/runtime/live-run-registry";
import {createToolMessage, createToolResultMessage, INTERRUPTED_TOOL_RESULT_TEXT} from "nbook/server/agent/tools/shared/tool-message";
import type {
    AgentConversationMessage,
    AgentConversationNode,
    AgentConversationTreeSnapshot,
    AgentTokenUsage,
    AgentMessageCreateInput,
    AgentMessageStatus,
    LiveToolState,
    ThreadId,
} from "nbook/server/agent/types";
import {sumAgentTokenUsage} from "nbook/server/agent/types";

export type ThreadMessageIngestPhase =
    | "assistant_iteration"
    | "assistant_success"
    | "assistant_stopped"
    | "assistant_failure"
    | "tool_result"
    | "interrupted_tools";

export type ThreadMessageIngest = (input: {
    phase: ThreadMessageIngestPhase;
    messages: AgentMessageCreateInput[];
}) => AgentMessageCreateInput[] | Promise<AgentMessageCreateInput[]>;

/**
 * 统一负责 assistant/tool 的消息落盘与历史树投影。
 */
export class ThreadMessageService {
    constructor(
        private readonly messageStore: AgentMessageStore,
    ) {}

    /**
     * 读取线程当前活动路径历史。
     */
    async loadThreadHistory(threadId: ThreadId) {
        return this.messageStore.loadActivePathMessages(threadId);
    }

    /**
     * 读取完整历史树快照。
     */
    async loadConversationTree(threadId: ThreadId): Promise<AgentConversationTreeSnapshot> {
        const snapshot = await this.messageStore.loadSnapshot(threadId);
        return {
            revision: snapshot.revision,
            activeCursorId: snapshot.activeCursorId,
            rootNodeId: snapshot.rootNodeId,
            nodes: Object.values(snapshot.nodesById).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map((node): AgentConversationNode => ({
                id: node.id,
                parentId: node.parentId,
                childIds: [...node.childIds],
                role: readAgentMessageRole(node),
                status: node.status,
                content: readAgentMessageContent(node),
                createdAt: node.createdAt,
                archivedAt: node.archivedAt,
                assistantMessageId: readAgentMessageAssistantId(node),
                toolCallId: readAgentMessageToolCallId(node),
                toolName: readAgentMessageToolName(node),
                toolArgs: readAgentMessageToolArgs(node),
                toolStatus: readAgentMessageToolStatus(node),
                rawAdditionalKwargs: readAgentMessageAdditionalKwargs(node),
            })),
        };
    }

    /**
     * 回扫完整消息树，聚合整个 thread 历史 assistant usage。
     */
    async collectThreadCumulativeUsage(threadId: ThreadId): Promise<AgentTokenUsage | null> {
        const snapshot = await this.messageStore.loadSnapshot(threadId);
        let cumulativeUsage: AgentTokenUsage | null = null;

        for (const node of Object.values(snapshot.nodesById)) {
            const message = toLangChainMessage(node);
            if (!AIMessage.isInstance(message)) {
                continue;
            }
            cumulativeUsage = sumAgentTokenUsage(cumulativeUsage, this.readUsage(message));
        }

        return cumulativeUsage;
    }

    /**
     * 落盘一条工具消息。
     */
    async persistToolMessage(
        threadId: ThreadId,
        message: ToolMessage,
        _status: "success" | "error",
        ingest?: ThreadMessageIngest,
    ): Promise<void> {
        const messages = await this.ingestMessages("tool_result", [
            toAgentMessageCreateInput(message),
        ], ingest);
        if (messages.length === 0) {
            return;
        }
        await this.messageStore.appendMessages(threadId, {
            messages,
        });
    }

    /**
     * 落盘一次中间 assistant 迭代。
     */
    async finalizeAssistantIteration(
        threadId: ThreadId,
        session: ActiveRunSession,
        usage?: AgentTokenUsage | null,
        modelName?: string | null,
        ingest?: ThreadMessageIngest,
    ): Promise<BaseMessage[]> {
        return this.persistAssistantSnapshot(threadId, session, "assistant_iteration", undefined, usage, modelName, ingest);
    }

    /**
     * 正常结束 assistant 输出。
     */
    async finalizeAssistantSuccess(
        threadId: ThreadId,
        session: ActiveRunSession,
        usage?: AgentTokenUsage | null,
        modelName?: string | null,
        ingest?: ThreadMessageIngest,
    ): Promise<BaseMessage[]> {
        return this.persistAssistantSnapshot(threadId, session, "assistant_success", undefined, usage, modelName, ingest);
    }

    /**
     * 停止时保留半截 assistant。
     */
    async finalizeAssistantStopped(
        threadId: ThreadId,
        session: ActiveRunSession,
        usage?: AgentTokenUsage | null,
        modelName?: string | null,
        ingest?: ThreadMessageIngest,
    ): Promise<BaseMessage[]> {
        return this.persistAssistantSnapshot(threadId, session, "assistant_stopped", "stopped", usage, modelName, ingest);
    }

    /**
     * 在 assistant tool_calls 已落盘后，为仍未完成的工具补失败结果。
     */
    async persistInterruptedToolMessages(threadId: ThreadId, session: ActiveRunSession, ingest?: ThreadMessageIngest): Promise<BaseMessage[]> {
        const messages = await this.ingestMessages("interrupted_tools", this.toInterruptedToolMessageInputs(session), ingest);
        if (messages.length === 0) {
            return [];
        }
        const created = await this.messageStore.appendMessages(threadId, {
            messages,
        });
        return toLangChainMessages(created);
    }

    /**
     * 失败时保留已有 assistant 文本，并追加错误消息。
     */
    async finalizeAssistantFailure(
        threadId: ThreadId,
        session: ActiveRunSession,
        errorMessage: string,
        usage?: AgentTokenUsage | null,
        modelName?: string | null,
        ingest?: ThreadMessageIngest,
    ): Promise<BaseMessage[]> {
        const messages: BaseMessage[] = [];
        const toPersist: AgentMessageCreateInput[] = [];
        toPersist.push(...this.toPersistedAssistantSnapshotInputs(session, "stopped", usage, modelName));
        toPersist.push(createAssistantMessageInput({
            content: `请求失败：${errorMessage}`,
        }));
        const ingestedMessages = await this.ingestMessages("assistant_failure", toPersist, ingest);
        if (ingestedMessages.length === 0) {
            return [];
        }
        const created = await this.messageStore.appendMessages(threadId, {
            messages: ingestedMessages,
        });
        messages.push(...toLangChainMessages(created));
        return messages;
    }

    /**
     * 生成线程摘要。
     */
    buildSummary(messages: BaseMessage[]): string {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (!message || !AIMessage.isInstance(message)) {
                continue;
            }
            const text = message.text.trim();
            if (text) {
                return text.slice(0, 200);
            }
        }
        return "";
    }

    /**
     * 将已落盘的 assistant 消息转换为前端对话消息。
     */
    toConversationAssistantMessage(message: AIMessage): AgentConversationMessage {
        const additionalKwargs = message.additional_kwargs ?? {};
        return {
            id: typeof additionalKwargs.messageId === "string"
                ? additionalKwargs.messageId
                : crypto.randomUUID(),
            role: "assistant",
            content: message.text,
            status: typeof additionalKwargs.messageStatus === "string"
                ? additionalKwargs.messageStatus as AgentConversationMessage["status"]
                : "done",
            createdAt: typeof additionalKwargs.messageCreatedAt === "string"
                ? additionalKwargs.messageCreatedAt
                : new Date().toISOString(),
            model: typeof additionalKwargs.model === "string"
                ? additionalKwargs.model
                : undefined,
            tokens: typeof additionalKwargs.tokens === "number"
                ? additionalKwargs.tokens
                : undefined,
            thinking: typeof additionalKwargs.thinking === "string"
                ? additionalKwargs.thinking
                : undefined,
        };
    }

    /**
     * 持久化当前 assistant 快照。
     * 这里只保留真正可见的正文，thinking 仅作为附加信息跟随正文写入。
     */
    private async persistAssistantSnapshot(
        threadId: ThreadId,
        session: ActiveRunSession,
        phase: ThreadMessageIngestPhase,
        status?: AgentMessageStatus,
        usage?: AgentTokenUsage | null,
        modelName?: string | null,
        ingest?: ThreadMessageIngest,
    ): Promise<BaseMessage[]> {
        const messages = await this.ingestMessages(phase, [
            ...this.toPersistedAssistantSnapshotInputs(session, status, usage, modelName),
            ...(status === "stopped"
                ? this.toToolResultInputs(session, "all")
                : []),
        ], ingest);
        if (messages.length === 0) {
            return [];
        }
        const created = await this.messageStore.appendMessages(threadId, {
            messages,
        });
        return toLangChainMessages(created);
    }

    /**
     * 在写入历史前交给 profile ingest 钩子处理。
     */
    private async ingestMessages(
        phase: ThreadMessageIngestPhase,
        messages: AgentMessageCreateInput[],
        ingest?: ThreadMessageIngest,
    ): Promise<AgentMessageCreateInput[]> {
        if (!ingest || messages.length === 0) {
            return messages;
        }
        return ingest({
            phase,
            messages,
        });
    }

    /**
     * 生成 assistant 快照对应的持久化输入。
     */
    private toPersistedAssistantSnapshotInputs(
        session: ActiveRunSession,
        status?: AgentMessageStatus,
        usage?: AgentTokenUsage | null,
        modelName?: string | null,
    ): AgentMessageCreateInput[] {
        const content = session.snapshot.text.trim();
        const thinking = session.snapshot.thinkingText.trim() || undefined;
        const hasToolCalls = session.snapshot.tools.length > 0;
        if (!content && !hasToolCalls) {
            return [];
        }
        return [
            createAssistantMessageInput({
                content,
                status,
                id: session.snapshot.messageId,
                thinking,
                model: modelName ?? undefined,
                tokens: usage?.totalTokens ?? undefined,
                usageMetadata: usage
                    ? {
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                        totalTokens: usage.totalTokens,
                        cacheReadTokens: usage.cacheReadTokens,
                        cacheMissTokens: usage.cacheMissTokens,
                        cacheCreationTokens: usage.cacheCreationTokens,
                    }
                    : undefined,
                toolCalls: this.toToolCalls(session.snapshot.tools),
            }),
        ];
    }

    /**
     * 将 live tool 草稿转换为 LangChain tool_calls。
     */
    private toToolCalls(tools: LiveToolState[]): ToolCall[] {
        return tools.map((tool) => ({
            id: tool.toolCallId ?? tool.toolNodeId,
            name: tool.toolName,
            args: this.parseToolArgs(tool.argsText),
            type: "tool_call",
        }));
    }

    /**
     * 为当前 session 中仍未完成的工具调用创建失败结果。
     */
    private toInterruptedToolMessageInputs(session: ActiveRunSession): AgentMessageCreateInput[] {
        return this.toToolResultInputs(session, "interrupted");
    }

    /**
     * 将 live tool 状态转换为可持久化 ToolMessage。
     */
    private toToolResultInputs(session: ActiveRunSession, mode: "all" | "interrupted"): AgentMessageCreateInput[] {
        return session.snapshot.tools
            .filter((tool) => mode === "all" || (tool.status !== "success" && tool.status !== "error"))
            .map((tool) => {
                const status = tool.status === "success" || tool.status === "error"
                    ? tool.status
                    : "error";
                const content = tool.outputText.trim()
                    ? tool.outputText
                    : INTERRUPTED_TOOL_RESULT_TEXT;
                const toolCallId = tool.toolCallId ?? tool.toolNodeId;
                return toAgentMessageCreateInput(createToolMessage({
                    toolCallId,
                    toolNodeId: tool.toolNodeId,
                    assistantMessageId: tool.assistantMessageId,
                    toolName: tool.toolName,
                    result: createToolResultMessage(content, tool.argsText, status),
                }));
            });
    }

    /**
     * 解析工具参数；模型刚开始流式调用时可能仍是不完整 JSON。
     */
    private parseToolArgs(argsText: string): Record<string, unknown> {
        if (!argsText.trim()) {
            return {};
        }
        try {
            const parsed = JSON.parse(argsText) as unknown;
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
        } catch {
            return {};
        }
    }

    /**
     * 从 LangChain AIMessage 中读取 usage。
     */
    private readUsage(message: AIMessage): AgentTokenUsage | null {
        const usage = message.usage_metadata;
        const usageMetadata = message.additional_kwargs.usageMetadata;
        if (!usage && (!usageMetadata || typeof usageMetadata !== "object" || Array.isArray(usageMetadata))) {
            return null;
        }
        const additionalUsage = usageMetadata && typeof usageMetadata === "object" && !Array.isArray(usageMetadata)
            ? usageMetadata as Record<string, unknown>
            : {};
        return {
            inputTokens: usage?.input_tokens ?? this.readNumber(additionalUsage.inputTokens),
            outputTokens: usage?.output_tokens ?? this.readNumber(additionalUsage.outputTokens),
            totalTokens: usage?.total_tokens ?? this.readNumber(additionalUsage.totalTokens),
            cacheReadTokens: usage?.input_token_details?.cache_read ?? this.readNumber(additionalUsage.cacheReadTokens),
            cacheMissTokens: this.readNumber(additionalUsage.cacheMissTokens),
            cacheCreationTokens: usage?.input_token_details?.cache_creation ?? this.readNumber(additionalUsage.cacheCreationTokens),
        };
    }

    /**
     * 从附加 usage 字段读取数字。
     */
    private readNumber(value: unknown): number {
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }
}
