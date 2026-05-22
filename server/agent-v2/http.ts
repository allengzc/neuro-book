import {AgentSystem} from "nbook/server/agent/agent-system";
import type {ThreadDetailProjection, ThreadSnapshotProjection} from "nbook/server/agent/services/thread-projection.service";
import type {
    AgentConversationNode,
    AgentConversationTreeSnapshot,
    AgentStreamEvent,
    PendingUserInputSession,
    LiveRunSnapshot,
    LiveToolState,
    AgentTokenUsage,
    ThreadSummary,
} from "nbook/server/agent/types";
import type {
    AgentConversationNodeDto,
    AgentConversationTreeSnapshotDto,
    AgentConversationToolCallDto,
    AgentPendingUserInputQuestionDto,
    AgentPendingUserInputSessionDto,
    AgentStreamEventDto,
    AgentSubagentSummaryDto,
    AgentThreadDetailDto,
    AgentThreadSnapshotEventDto,
    AgentThreadSummaryDto,
} from "nbook/shared/dto/agent-chat.dto";
import {RequestUserInputToolArgsSchema} from "nbook/shared/dto/agent-chat.dto";
import {loadAppConfigSync} from "nbook/server/utils/app-config";
import {resolveAgentModelSelection} from "nbook/server/utils/model";

type GlobalAgentHttp = {
    agentSystem?: AgentSystem;
};

const globalForAgentHttp = globalThis as typeof globalThis & GlobalAgentHttp;

/**
 * 获取全局 AgentSystem 单例。
 */
export function useAgentSystem(): AgentSystem {
    if (!globalForAgentHttp.agentSystem) {
        globalForAgentHttp.agentSystem = AgentSystem.createDefault();
    }
    return globalForAgentHttp.agentSystem;
}

/**
 * 将线程摘要转换为 DTO。
 */
export function toAgentThreadSummaryDto(thread: ThreadSummary): AgentThreadSummaryDto {
    const appConfig = loadAppConfigSync();
    const modelSelection = resolveAgentModelSelection(appConfig, thread.profileKey, thread.modelOverride, thread.modelOverrideKey);
    const contextWindowTokens = modelSelection.effectiveModel?.contextWindowTokens ?? null;
    const lastRunInputTokens = thread.usageSummary?.lastRun?.inputTokens ?? null;
    const lastRunContextRatio = contextWindowTokens && typeof lastRunInputTokens === "number"
        ? lastRunInputTokens / contextWindowTokens
        : null;

    return {
        id: thread.id,
        kind: thread.kind,
        profileKey: thread.profileKey,
        title: thread.title,
        summary: thread.summary,
        lastMessagePreview: thread.summary,
        status: thread.status,
        modelOverrideKey: thread.modelOverrideKey,
        modelOverride: modelSelection.modelOverride,
        effectiveModelKey: modelSelection.effectiveModelKey,
        effectiveModelLabel: modelSelection.effectiveModelLabel,
        effectiveModel: modelSelection.effectiveModel,
        tokenStats: {
            lastRun: normalizeTokenUsage(thread.usageSummary?.lastRun ?? null),
            cumulative: normalizeTokenUsage(thread.usageSummary?.cumulative ?? null),
            contextWindowTokens,
            lastRunContextRatio,
            lastRunContextPercent: lastRunContextRatio === null
                ? null
                : Number((lastRunContextRatio * 100).toFixed(1)),
        },
        planMode: {
            active: thread.planMode?.active ?? false,
        },
        lastMessageAt: thread.lastMessageAt.toISOString(),
    };
}

/**
 * 归一化 token 使用量，统一返回 null 或完整结构。
 */
function normalizeTokenUsage(usage: AgentTokenUsage | null): AgentThreadSummaryDto["tokenStats"]["lastRun"] {
    if (!usage) {
        return null;
    }

    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheMissTokens: usage.cacheMissTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
    };
}

/**
 * 将 subagent 摘要转换为 DTO。
 */
export function toAgentSubagentSummaryDto(thread: ThreadSummary): AgentSubagentSummaryDto {
    return {
        ...toAgentThreadSummaryDto(thread),
        profileKey: thread.profileKey,
    };
}

/**
 * 构造线程详情 DTO。
 */
export function toAgentThreadDetailDto(input: ThreadDetailProjection): AgentThreadDetailDto {
    return {
        thread: toAgentThreadSummaryDto(input.thread),
        subagents: input.subagents.map(toAgentSubagentSummaryDto),
        leaders: input.leaders.map(toAgentThreadSummaryDto),
        conversationTree: toAgentConversationTreeSnapshotDto(input.conversationTree),
        pendingUserInputSession: toPendingUserInputSessionDto(input.thread.pendingUserInputSession ?? null),
    };
}

/**
 * 将线程历史树与当前 draft 投影为首帧快照。
 */
export function toAgentThreadSnapshotEventDto(input: ThreadSnapshotProjection): AgentThreadSnapshotEventDto {
    return {
        type: "thread_snapshot",
        thread: toAgentThreadSummaryDto(input.thread),
        subagents: input.subagents.map(toAgentSubagentSummaryDto),
        leaders: input.leaders.map(toAgentThreadSummaryDto),
        conversationTree: toAgentConversationTreeSnapshotDto(input.conversationTree),
        draft: input.activeRun ? toDraftConversationMessage(input.activeRun) : null,
        pendingUserInputSession: toPendingUserInputSessionDto(input.thread.pendingUserInputSession ?? null),
    };
}

/**
 * 将历史树快照转换为 DTO。
 */
export function toAgentConversationTreeSnapshotDto(tree: AgentConversationTreeSnapshot): AgentConversationTreeSnapshotDto {
    return {
        revision: tree.revision,
        activeCursorId: tree.activeCursorId,
        rootNodeId: tree.rootNodeId,
        nodes: tree.nodes.map(toAgentConversationNodeDto),
    };
}

/**
 * 将树节点转换为 DTO。
 */
function toAgentConversationNodeDto(node: AgentConversationNode): AgentConversationNodeDto {
    return {
        id: node.id,
        parentId: node.parentId,
        childIds: [...node.childIds],
        role: node.role,
        status: node.status,
        content: node.content,
        createdAt: node.createdAt,
        archivedAt: node.archivedAt,
        assistantMessageId: node.assistantMessageId,
        toolCallId: node.toolCallId,
        toolName: node.toolName,
        toolArgs: node.toolArgs,
        toolStatus: node.toolStatus,
        rawAdditionalKwargs: node.rawAdditionalKwargs,
    };
}

/**
 * 将运行时事件转换为 SSE DTO。
 */
export function toAgentStreamEventDto(
    event: AgentStreamEvent,
): AgentStreamEventDto {
    if (event.type === "thread_snapshot") {
        return {
            type: "thread_snapshot",
            thread: toAgentThreadSummaryDto(event.thread),
            subagents: event.subagents.map(toAgentSubagentSummaryDto),
            leaders: event.leaders.map(toAgentThreadSummaryDto),
            conversationTree: toAgentConversationTreeSnapshotDto(event.conversationTree),
            draft: event.draft,
            pendingUserInputSession: toPendingUserInputSessionDto(event.pendingUserInputSession),
        };
    }
    if (event.type === "history_snapshot") {
        return {
            type: "history_snapshot",
            threadId: event.threadId,
            conversationTree: toAgentConversationTreeSnapshotDto(event.conversationTree),
        };
    }
    if (event.type === "user_input_requested") {
        return {
            type: "user_input_requested",
            threadId: event.threadId,
            session: toPendingUserInputSessionDto(event.session)!,
        };
    }
    return event;
}

function toPendingUserInputSessionDto(session: PendingUserInputSession | null): AgentPendingUserInputSessionDto | null {
    if (!session) {
        return null;
    }
    return {
        assistantMessageId: session.assistantMessageId,
        status: session.status,
        questions: session.questions.map((question) => ({
            ...toPendingQuestionDto(question.toolArgsText, question.questionIndex),
            toolNodeId: question.toolNodeId,
            questionIndex: question.questionIndex,
            toolCallId: question.toolCallId ?? null,
            toolName: question.toolName,
            kind: question.kind ?? "question",
            approvalAction: question.approvalAction,
            approvalToolArgsText: question.approvalToolArgsText,
            planFilePath: question.planFilePath,
            planContent: question.planContent,
        })),
    };
}

function toPendingQuestionDto(
    toolArgsText: string,
    questionIndex: number,
): Omit<AgentPendingUserInputQuestionDto, "toolNodeId" | "toolCallId" | "toolName"> {
    const parsed = RequestUserInputToolArgsSchema.parse(JSON.parse(toolArgsText));
    const question = parsed.questions[questionIndex] ?? parsed.questions[0]!;
    return {
        kind: "question",
        questionIndex,
        header: question.header,
        question: question.question,
        options: question.options,
        multiSelect: question.multiSelect,
    };
}

/**
 * 将 live run draft 投影为前端草稿消息。
 */
function toDraftConversationMessage(activeRun: LiveRunSnapshot) {
    if (!activeRun.text && !activeRun.thinkingText && activeRun.tools.length === 0) {
        return null;
    }
    return {
        id: activeRun.messageId,
        role: "assistant" as const,
        content: activeRun.text,
        status: "streaming" as const,
        createdAt: new Date().toISOString(),
        thinking: activeRun.thinkingText || undefined,
        toolCalls: activeRun.tools.map(toLiveToolCall),
    };
}

/**
 * 将 live 工具节点投影为前端工具调用。
 */
function toLiveToolCall(tool: LiveToolState): AgentConversationToolCallDto {
    return {
        id: tool.toolNodeId,
        assistantMessageId: tool.assistantMessageId,
        toolNodeId: tool.toolNodeId,
        callIndex: tool.callIndex,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        argsText: tool.argsText,
        status: tool.status,
        outputText: tool.outputText,
        subagentThreadId: tool.subagentThreadId,
    };
}
