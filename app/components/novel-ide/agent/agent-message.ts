import {z} from "zod";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import type {AgentMessage as PiAgentMessage, AgentToolCall as PiAgentToolCall, AssistantMessage as PiAssistantMessage, Message as PiMessage, ToolResultMessage} from "nbook/server/agent/messages/types";
import type {AgentSessionSnapshotDto, AgentPendingApprovalDto} from "nbook/shared/dto/agent-session.dto";
import type {SessionEntry} from "nbook/server/agent/session/types";
import {toStableArgsJson} from "nbook/app/components/novel-ide/agent/tool-args-stream";

type PiAssistantContent = PiAssistantMessage["content"][number];

/**
 * 消息类型。
 */
export type MessageType = "user" | "ai" | "system";

/**
 * 系统消息在前端的展示类型。
 */
export type SystemMessageDisplayKind = "prompt" | "reminder" | "system" | "error";

/**
 * 消息状态。
 */
export type MessageStatus = "streaming" | "done" | "stopped";

/**
 * Tool Call 状态。
 */
export type ToolCallStatus = "streaming" | "invalid" | "running" | "success" | "error";

const INTERRUPTED_TOOL_CALL_ERROR = "工具调用未完成：服务重启或运行中断后，已经无法继续等待这个结果。";

/**
 * 单个 Tool Call 实体。
 */
export type AgentToolCall = {
    id: string;
    index: number;
    name: string;
    argsText: string;
    argsJson?: string;
    status: ToolCallStatus;
    error?: string;
    result?: string;
    rawResult?: unknown;
    /** invoke_agent 调度使用的 session ID。 */
    linkedSessionId?: number;
    /** 所属 assistant 消息 ID。 */
    assistantMessageId?: string;
};

/**
 * 单条消息实体。
 */
export type AgentMessage = {
    id: string;
    type: MessageType;
    /** 仅 system 消息使用：用于区分首轮系统提示和运行时提醒。 */
    systemDisplayKind?: SystemMessageDisplayKind;
    /** 系统消息可选标题，不存在时使用默认 System/System Reminder。 */
    systemLabel?: string;
    content: string;
    html?: string;
    status?: MessageStatus;
    toolCalls?: AgentToolCall[];
    timestamp?: string;
    model?: string;
    tokens?: number;
    thinking?: string;
    /** assistant 生成失败时的 provider/runtime 错误文本。 */
    error?: string;
    /** 运行期错误所属 invocation，用于 HTTP 结果兜底去重。 */
    invocationId?: string;
    /** live assistant 的原始 Pi content blocks，用于按 contentIndex 合并流式事件。 */
    assistantContent?: PiAssistantContent[];
};

export const AgentUserInputQuestionOptionSchema = z.object({
    label: z.string(),
    description: z.string().optional(),
    recommended: z.boolean().optional(),
    defaultSelected: z.boolean().optional(),
});

export const AgentUserInputQuestionSchema = z.object({
    header: z.string().optional(),
    question: z.string(),
    options: z.array(AgentUserInputQuestionOptionSchema).default([]),
    multiSelect: z.boolean().default(false),
    defaultOptionIndex: z.number().int().min(-1).optional(),
    defaultOptionIndexes: z.array(z.number().int().min(-1)).optional(),
});

export const RequestUserInputToolArgsSchema = z.object({
    questions: z.array(AgentUserInputQuestionSchema).default([]),
});

export const RequestUserInputToolAnswerSchema = z.object({
    questionIndex: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    selectedOptionIndex: z.number().int().min(-1).optional(),
    selectedOptionIndexes: z.array(z.number().int().min(-1)).optional(),
    note: z.string().trim().optional(),
    ignored: z.boolean().optional(),
});

const RequestUserInputToolRawResultSchema = z.object({
    answers: z.array(RequestUserInputToolAnswerSchema),
});

export type AgentPendingUserInputQuestion = z.infer<typeof AgentUserInputQuestionSchema> & {
    toolNodeId: string;
    questionIndex: number;
    toolCallId?: string | null;
    toolName: string;
    kind: "question" | "tool_approval";
    approvalAction?: "enter_plan_mode" | "exit_plan_mode" | "skill";
    approvalToolArgsText?: string;
    planFilePath?: string;
    planContent?: string;
};

export type AgentPendingUserInputSession = {
    assistantMessageId: string;
    status: "pending";
    questions: AgentPendingUserInputQuestion[];
};

export type RequestUserInputAnswerView = {
    questionIndex: number;
    question: string;
    options: z.infer<typeof AgentUserInputQuestionOptionSchema>[];
    selectedLabel: string;
    text?: string;
    note?: string;
    ignored: boolean;
    openAnswer: boolean;
};

/**
 * 消息级 continuation 切换状态。
 */
export type AgentMessageSwitcherState = {
    nodeIds: string[];
    currentIndex: number;
    total: number;
};

/**
 * 对话流中的渲染节点。一条 AgentMessage 可展开为多个 ChatNode。
 */
export type ChatNode =
    | { kind: "text"; message: AgentMessage }
    | { kind: "tool"; message: AgentMessage; toolCall: AgentToolCall };

/**
 * 将消息列表展开为渲染节点列表。
 */
export const toChatNodes = (messages: AgentMessage[]): ChatNode[] => {
    const nodes: ChatNode[] = [];
    for (const message of messages) {
        if (message.type !== "ai") {
            nodes.push({kind: "text", message});
            continue;
        }
        if (message.content || message.thinking || !message.toolCalls?.length) {
            nodes.push({kind: "text", message});
        }
        const toolCalls = message.toolCalls ?? [];
        const lastTaskToolIndex = toolCalls.findLastIndex((toolCall) => toolCall.name === "task_create" || toolCall.name === "task_set_status");
        for (const [toolIndex, toolCall] of toolCalls.entries()) {
            if ((toolCall.name === "task_create" || toolCall.name === "task_set_status") && toolIndex !== lastTaskToolIndex) {
                continue;
            }
            nodes.push({kind: "tool", message, toolCall});
        }
    }
    return nodes;
};

/**
 * 格式化相对时间。
 */
export const formatTimestamp = (value?: string | number): string => {
    if (value === undefined || value === null || value === "") return "";
    const date = typeof value === "number" ? new Date(value) : new Date(value);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
        return "刚刚";
    } else if (diffInSeconds < 3600) {
        return `${String(Math.floor(diffInSeconds / 60))} 分钟前`;
    } else if (diffInSeconds < 86400) {
        return `${String(Math.floor(diffInSeconds / 3600))} 小时前`;
    }
    return date.toLocaleDateString();
};

/**
 * 获取 ToolCall 的状态边框颜色类名。
 */
export const toolStatusClass = (toolCall: AgentToolCall): string => {
    switch (toolCall.status) {
        case "success": return "bg-green-500/10 text-green-500";
        case "error":
        case "invalid":
            return "bg-rose-500/10 text-rose-500";
        case "running":
        case "streaming":
            return "bg-blue-500/10 text-[var(--accent-text)]";
        default:
            return "bg-[var(--bg-input)] text-[var(--text-muted)]";
    }
};

/**
 * 获取 ToolCall 的状态图标。
 */
export const toolStatusIcon = (toolCall: AgentToolCall): string => {
    switch (toolCall.status) {
        case "success": return "i-lucide-check";
        case "error":
        case "invalid":
            return "i-lucide-x";
        case "running":
        case "streaming":
            return "i-lucide-loader-circle";
        default:
            return "i-lucide-circle-dashed";
    }
};

/**
 * 返回消息状态文本。
 */
export const messageStatusLabel = (message: AgentMessage): string => {
    if (message.error) {
        return "生成失败";
    }
    if (message.toolCalls?.some((toolCall) => toolCall.status === "running")) {
        return "执行工具中";
    }
    if (message.toolCalls?.some((toolCall) => toolCall.status === "streaming")) {
        return "生成工具调用";
    }
    if (message.status === "streaming") {
        return "生成中";
    }
    return "";
};

/**
 * 选择更稳定的 tool call 状态，避免后到的低优先级状态覆盖终态。
 */
export const mergeToolCallStatus = (
    nextStatus: ToolCallStatus,
    previousStatus?: ToolCallStatus,
): ToolCallStatus => {
    if (!previousStatus) return nextStatus;
    if ((nextStatus === "streaming" || nextStatus === "running") && ["success", "error", "invalid"].includes(previousStatus)) {
        return previousStatus;
    }
    if (nextStatus === "streaming" && previousStatus === "running") {
        return previousStatus;
    }
    return nextStatus;
};

/**
 * 合并 assistant 上的 tool call，保持已有运行结果。
 */
export const mergeToolCalls = (nextToolCalls?: AgentToolCall[], previousToolCalls?: AgentToolCall[]): AgentToolCall[] | undefined => {
    if (!nextToolCalls?.length && !previousToolCalls?.length) {
        return undefined;
    }

    const previousMap = new Map((previousToolCalls ?? []).map((toolCall) => [toolCall.id, toolCall]));
    const merged = (nextToolCalls ?? []).map((toolCall) => {
        const previous = previousMap.get(toolCall.id);
        if (!previous) {
            return toolCall;
        }
        return {
            ...previous,
            ...toolCall,
            status: mergeToolCallStatus(toolCall.status, previous.status),
            error: toolCall.error ?? previous.error,
            result: toolCall.result ?? previous.result,
            rawResult: toolCall.rawResult ?? previous.rawResult,
            linkedSessionId: toolCall.linkedSessionId ?? previous.linkedSessionId,
        };
    });

    for (const previous of previousToolCalls ?? []) {
        const replacedByResolvedToolCall = previous.id.startsWith("content-")
            && merged.some((toolCall) => toolCall.index === previous.index);
        if (!merged.some((toolCall) => toolCall.id === previous.id) && !replacedByResolvedToolCall) {
            merged.push(previous);
        }
    }

    return merged.sort((left, right) => left.index - right.index);
};

/**
 * 用稳定 key 对消息数组做原地 reconcile。
 */
export const reconcileMessages = (previousMessages: AgentMessage[], nextMessages: AgentMessage[]): AgentMessage[] => {
    const previousMap = new Map(previousMessages.map((message) => [message.id, message]));
    return nextMessages.map((message) => {
        const previous = previousMap.get(message.id);
        if (!previous) {
            return message;
        }
        return {
            ...previous,
            ...message,
            toolCalls: mergeToolCalls(message.toolCalls, previous.toolCalls),
        };
    });
};

/**
 * 从 Pi snapshot 消息派生前端卡片消息。
 */
export const deriveMessagesFromSessionSnapshot = (snapshot: AgentSessionSnapshotDto): AgentMessage[] => {
    const messages: AgentMessage[] = [];
    const assistantByToolCallId = new Map<string, AgentMessage>();
    const hasActiveInvocation = Boolean(snapshot.activeInvocation);
    const pendingToolCallId = snapshot.pendingApproval?.toolCallId ?? null;
    const assistantErrorInvocations = findAssistantErrorInvocations(snapshot.entries);
    let currentInvocationId: string | null = null;

    if (snapshot.systemPrompt?.trim()) {
        messages.push({
            id: `system-prompt:${snapshot.summary.sessionId}:${snapshot.summary.profileKey}`,
            type: "system",
            systemDisplayKind: "prompt",
            systemLabel: "System Prompt",
            content: snapshot.systemPrompt,
            status: "done",
        });
    }

    for (const entry of snapshot.entries) {
        if (entry.type === "custom_message") {
            messages.push(toCustomSessionMessage(entry));
            continue;
        }
        if (entry.type === "compaction") {
            messages.push({
                id: entry.id,
                type: "system",
                systemDisplayKind: "system",
                systemLabel: "Compaction",
                content: entry.summary,
                status: "done",
                timestamp: formatTimestamp(entry.timestamp),
            });
            continue;
        }
        if (entry.type === "branch_summary") {
            messages.push({
                id: entry.id,
                type: "system",
                systemDisplayKind: "system",
                systemLabel: "Branch Summary",
                content: entry.summary,
                status: "done",
                timestamp: formatTimestamp(entry.timestamp),
            });
            continue;
        }
        if (entry.type === "invocation_lifecycle") {
            currentInvocationId = entry.invocationId;
            if (entry.status === "error" && !assistantErrorInvocations.has(entry.invocationId)) {
                const errorMessage = toInvocationErrorMessage(entry);
                if (errorMessage && !hasVisibleInvocationError(messages, entry.invocationId)) {
                    messages.push(errorMessage);
                }
            }
            continue;
        }
        if (entry.type !== "message") {
            continue;
        }
        const message = entry.message as PiMessage;
        if (message.role === "toolResult") {
            const assistant = assistantByToolCallId.get(message.toolCallId) ?? messages.findLast((item) => item.type === "ai");
            if (!assistant) {
                continue;
            }
            upsertToolResult(assistant, message);
            continue;
        }
        const localMessage = {
            ...toLocalMessage(entry.id, message),
            invocationId: currentInvocationId ?? undefined,
        };
        messages.push(localMessage);
        if (message.role === "assistant") {
            for (const toolCall of message.content.filter((block): block is PiAgentToolCall => block.type === "toolCall")) {
                assistantByToolCallId.set(toolCall.id, localMessage);
            }
        }
    }

    markInterruptedToolCalls(messages, {
        hasActiveInvocation,
        pendingToolCallId,
    });

    return messages;
};

/**
 * 将 session_entry 增量事件投影到前端消息，避免等待下一次完整 snapshot。
 */
export const applySessionEntryToMessages = (
    previousMessages: AgentMessage[],
    entry: SessionEntry,
): AgentMessage[] => {
    if (entry.type === "invocation_lifecycle" && entry.status === "error" && hasAssistantErrorForInvocation(previousMessages, entry.invocationId)) {
        return previousMessages;
    }
    if (entry.type === "message" && entry.message.role === "toolResult") {
        const toolResult = entry.message;
        const assistant = previousMessages.findLast((message) => {
            return message.type === "ai" && message.toolCalls?.some((toolCall) => toolCall.id === toolResult.toolCallId);
        });
        if (!assistant) {
            return previousMessages;
        }
        const nextMessages = previousMessages.map((message) => message.id === assistant.id ? {...message} : message);
        const nextAssistant = nextMessages.find((message) => message.id === assistant.id);
        if (nextAssistant) {
            upsertToolResult(nextAssistant, toolResult);
        }
        return reconcileMessages(previousMessages, nextMessages);
    }
    const nextMessage = deriveMessageFromSessionEntry(entry);
    if (!nextMessage) {
        return previousMessages;
    }
    const withoutOptimisticDuplicate = nextMessage.type === "user"
        ? previousMessages.filter((message) => !(message.id.startsWith("optimistic-user-") && message.content === nextMessage.content))
        : previousMessages;
    if (nextMessage.type === "system") {
        const optimisticIndex = withoutOptimisticDuplicate.findIndex((message) => message.id.startsWith("optimistic-user-"));
        if (optimisticIndex >= 0 && !withoutOptimisticDuplicate.some((message) => message.id === nextMessage.id)) {
            const nextMessages = [...withoutOptimisticDuplicate];
            nextMessages.splice(optimisticIndex, 0, nextMessage);
            return reconcileMessages(previousMessages, nextMessages);
        }
    }
    const nextMessages = previousMessages.some((message) => message.id === nextMessage.id)
        ? withoutOptimisticDuplicate.map((message) => message.id === nextMessage.id ? nextMessage : message)
        : [...withoutOptimisticDuplicate, nextMessage];
    return reconcileMessages(previousMessages, nextMessages);
};

/**
 * 将单个 session entry 转成前端消息。
 */
const deriveMessageFromSessionEntry = (entry: SessionEntry): AgentMessage | null => {
    if (entry.type === "custom_message") {
        return toCustomSessionMessage(entry);
    }
    if (entry.type === "compaction") {
        return {
            id: entry.id,
            type: "system",
            systemDisplayKind: "system",
            systemLabel: "Compaction",
            content: entry.summary,
            status: "done",
            timestamp: formatTimestamp(entry.timestamp),
        };
    }
    if (entry.type === "branch_summary") {
        return {
            id: entry.id,
            type: "system",
            systemDisplayKind: "system",
            systemLabel: "Branch Summary",
            content: entry.summary,
            status: "done",
            timestamp: formatTimestamp(entry.timestamp),
        };
    }
    if (entry.type === "message" && entry.origin === "prompt" && entry.message.role === "user") {
        return toLocalMessage(entry.id, entry.message);
    }
    if (entry.type === "invocation_lifecycle" && entry.status === "error") {
        return toInvocationErrorMessage(entry);
    }
    return null;
};

const findAssistantErrorInvocations = (entries: SessionEntry[]): Set<string> => {
    const result = new Set<string>();
    let currentInvocationId: string | null = null;
    for (const entry of entries) {
        if (entry.type === "invocation_lifecycle") {
            currentInvocationId = entry.invocationId;
            continue;
        }
        if (entry.type !== "message" || entry.message.role !== "assistant" || !currentInvocationId) {
            continue;
        }
        const localMessage = toLocalMessage(entry.id, entry.message);
        if (localMessage.error) {
            result.add(currentInvocationId);
        }
    }
    return result;
};

export const hasVisibleInvocationError = (messages: AgentMessage[], invocationId: string): boolean => {
    return messages.some((message) => {
        return message.invocationId === invocationId
            && (message.systemDisplayKind === "error" || (message.type === "ai" && Boolean(message.error)));
    });
};

const hasAssistantErrorForInvocation = (messages: AgentMessage[], invocationId: string): boolean => {
    return messages.some((message) => {
        return message.type === "ai"
            && message.invocationId === invocationId
            && Boolean(message.error);
    });
};

const toInvocationErrorMessage = (entry: Extract<SessionEntry, {type: "invocation_lifecycle"}>): AgentMessage | null => {
    const content = entry.errorInfo?.message?.trim() || entry.error?.trim();
    if (!content) {
        return null;
    }
    return {
        id: entry.id,
        type: "system",
        systemDisplayKind: "error",
        systemLabel: "Run Error",
        content,
        status: "stopped",
        timestamp: formatTimestamp(entry.timestamp),
        error: content,
        invocationId: entry.invocationId,
    };
};

const toCustomSessionMessage = (entry: AgentSessionSnapshotDto["entries"][number] & {type: "custom_message"}): AgentMessage => {
    const message = entry.message as unknown as Record<string, unknown>;
    const content = customMessageText(message);
    const customType = typeof message.customType === "string"
        ? message.customType
        : typeof message.role === "string"
            ? message.role
            : "custom";
    const isReminder = customType === "system-reminder"
        || customType === "reminder"
        || content.includes("<system-reminder>");

    return {
        id: entry.id,
        type: "system",
        systemDisplayKind: isReminder ? "reminder" : "system",
        systemLabel: isReminder ? "System Reminder" : `Custom: ${customType}`,
        content,
        status: "done",
        timestamp: formatTimestamp(entry.timestamp),
    };
};

/**
 * 从 Pi message_start/update/end 派生本地消息。
 */
export const toLocalMessage = (id: string, message: PiMessage | PiAgentMessage, streaming = false): AgentMessage => {
    if (message.role === "assistant") {
        const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        const thinking = message.content.filter((block) => block.type === "thinking").map((block) => block.thinking).join("");
        const errorText = message.stopReason === "error" || message.stopReason === "aborted"
            ? message.errorMessage?.trim() || (message.stopReason === "aborted" ? "生成已中断。" : "生成失败，provider 未返回错误详情。")
            : "";
        const toolCalls = message.content
            .filter((block): block is PiAgentToolCall => block.type === "toolCall")
            .map((toolCall, index) => toLocalToolCall(toolCall, index, id));
        return {
            id,
            type: "ai",
            content: text || errorText,
            status: streaming ? "streaming" : errorText ? "stopped" : "done",
            timestamp: formatTimestamp(message.timestamp),
            model: message.model,
            tokens: message.usage?.totalTokens,
            thinking: thinking || undefined,
            error: errorText || undefined,
            toolCalls,
            assistantContent: [...message.content],
        };
    }

    if (message.role === "user") {
        return {
            id,
            type: "user",
            content: messageContentText(message),
            status: "done",
            timestamp: formatTimestamp(message.timestamp),
        };
    }

    if (message.role === "toolResult") {
        return {
            id,
            type: "system",
            systemDisplayKind: "system",
            content: messageContentText(message),
            status: "done",
            timestamp: formatTimestamp(message.timestamp),
        };
    }

    return {
        id,
        type: "system",
        systemDisplayKind: "system",
        content: "",
        status: "done",
        timestamp: "刚刚",
    };
};

/**
 * 把 pending approval 转成旧 composer 可复用的 PendingUserInputSession。
 */
export const toPendingUserInputSession = (
    pending: AgentPendingApprovalDto | null,
    messages: AgentMessage[],
): AgentPendingUserInputSession | null => {
    if (!pending) {
        return null;
    }
    const assistantMessage = messages.find((message) => message.toolCalls?.some((toolCall) => toolCall.id === pending.toolCallId));
    const args = pending.args && typeof pending.args === "object" && !Array.isArray(pending.args)
        ? pending.args as Record<string, unknown>
        : {};
    if (pending.toolName === "request_user_input") {
        const parsed = RequestUserInputToolArgsSchema.safeParse(args);
        const questions = parsed.success ? parsed.data.questions : [];
        return {
            assistantMessageId: assistantMessage?.id ?? pending.assistantMessageId ?? pending.toolCallId,
            status: "pending",
            questions: questions.map((question, index) => ({
                ...question,
                toolNodeId: pending.toolCallId,
                questionIndex: index,
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                kind: "question",
            })),
        };
    }

    return {
        assistantMessageId: assistantMessage?.id ?? pending.assistantMessageId ?? pending.toolCallId,
        status: "pending",
        questions: [{
            toolNodeId: pending.toolCallId,
            questionIndex: 0,
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            kind: "tool_approval",
            approvalAction: pending.toolName === "enter_plan_mode" || pending.toolName === "exit_plan_mode" || pending.toolName === "skill"
                ? pending.toolName
                : undefined,
            approvalToolArgsText: JSON.stringify(args, null, 2),
            header: pending.toolName === "skill" ? "Skill" : "审批",
            question: approvalQuestion(pending.toolName, args),
            options: [
                {label: "批准", description: "允许 Agent 继续执行该动作。", recommended: true, defaultSelected: true},
                {label: "拒绝", description: "阻止该动作，并把结果返回给 Agent。"},
            ],
            multiSelect: false,
            defaultOptionIndex: 0,
        }],
    };
};

/**
 * 从 request_user_input 的 args/rawResult 推导历史气泡展示数据。
 */
export const deriveRequestUserInputAnswerViews = (
    args: z.infer<typeof RequestUserInputToolArgsSchema> | null,
    rawResult: unknown,
    options?: {
        fallbackQuestion?: AgentPendingUserInputQuestion | null;
        otherLabel?: string;
    },
): RequestUserInputAnswerView[] => {
    const parsedRawResult = RequestUserInputToolRawResultSchema.safeParse(rawResult);
    const answers = parsedRawResult.success
        ? parsedRawResult.data.answers
        : (() => {
            const parsedAnswer = RequestUserInputToolAnswerSchema.safeParse(rawResult);
            return parsedAnswer.success ? [parsedAnswer.data] : [];
        })();
    if (answers.length === 0) {
        return [];
    }

    return answers.map((answer, answerIndex) => {
        const questionIndex = answer.questionIndex ?? answerIndex;
        const question = options?.fallbackQuestion?.questionIndex === questionIndex
            ? options.fallbackQuestion
            : args?.questions[questionIndex] ?? options?.fallbackQuestion ?? args?.questions[0];
        const questionOptions = question?.options ?? [];
        const selectedIndexes = answer.selectedOptionIndexes?.length
            ? answer.selectedOptionIndexes
            : answer.selectedOptionIndex === undefined ? [] : [answer.selectedOptionIndex];
        const selectedLabel = selectedIndexes.map((optionIndex) => {
            return optionIndex === -1
                ? options?.otherLabel ?? "其他答案"
                : questionOptions[optionIndex]?.label ?? String(optionIndex);
        }).join("、");

        return {
            questionIndex,
            question: question?.question ?? "",
            options: questionOptions,
            selectedLabel,
            text: selectedIndexes.length === 0 && !answer.note ? answer.text : undefined,
            note: answer.note,
            ignored: Boolean(answer.ignored),
            openAnswer: !answer.ignored && selectedIndexes.length === 0,
        };
    });
};

/**
 * 从 Pi event 更新 live message。
 */
export const applyPiEventToMessages = (previousMessages: AgentMessage[], event: AgentEvent, invocationId?: string): AgentMessage[] => {
    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
        if (event.message.role === "toolResult") {
            const toolResult = event.message;
            const assistant = previousMessages.findLast((message) => message.type === "ai" && message.toolCalls?.some((toolCall) => toolCall.id === toolResult.toolCallId));
            if (!assistant) {
                return previousMessages;
            }
            const nextMessages = previousMessages.map((message) => message.id === assistant.id ? {...message} : message);
            const nextAssistant = nextMessages.find((message) => message.id === assistant.id);
            if (nextAssistant) {
                upsertToolResult(nextAssistant, toolResult);
            }
            return reconcileMessages(previousMessages, nextMessages);
        }
        if (event.message.role !== "assistant" && event.message.role !== "user") {
            return previousMessages;
        }
        const messageId = resolveLiveMessageId(event.message);
        const localMessage = {
            ...toLocalMessage(messageId, event.message, event.type !== "message_end"),
            invocationId,
        };
        const patchedMessage = event.type === "message_update" && "assistantMessageEvent" in event
            ? applyAssistantMessageEvent(previousMessages.find((message) => message.id === localMessage.id), localMessage, event.assistantMessageEvent)
            : localMessage;
        const nextMessages = previousMessages.some((message) => message.id === localMessage.id)
            ? previousMessages.map((message) => message.id === patchedMessage.id ? patchedMessage : message)
            : [...previousMessages, patchedMessage];
        return reconcileMessages(previousMessages, nextMessages);
    }

    if (event.type === "tool_execution_start") {
        const argsText = formatToolArgs(event.args);
        return updateToolCall(previousMessages, event.toolCallId, {
            name: event.toolName,
            argsText,
            argsJson: toStableArgsJson(argsText),
            status: "running",
        });
    }

    if (event.type === "tool_execution_update") {
        return updateToolCall(previousMessages, event.toolCallId, {
            result: resultText(event.partialResult),
            rawResult: event.partialResult,
            status: "running",
        });
    }

    if (event.type === "tool_execution_end") {
        return updateToolCall(previousMessages, event.toolCallId, {
            result: resultText(event.result),
            rawResult: event.result,
            status: event.isError ? "error" : "success",
            error: event.isError ? resultText(event.result) : undefined,
            linkedSessionId: extractLinkedSessionId(event.result),
        });
    }

    return previousMessages;
};

const applyAssistantMessageEvent = (
    previousMessage: AgentMessage | undefined,
    nextMessage: AgentMessage,
    event: AssistantMessageEvent,
): AgentMessage => {
    const previousContent = previousMessage ? contentFromMessage(previousMessage) : contentFromMessage(nextMessage);
    const content = applyAssistantContentEvent(previousContent, contentFromPartial(event), event);
    return {
        ...nextMessage,
        content: textFromContent(content) || nextMessage.content,
        thinking: thinkingFromContent(content) || nextMessage.thinking,
        toolCalls: mergeToolCalls(toolCallsFromContent(content, nextMessage.id), previousMessage?.toolCalls),
        assistantContent: content,
    };
};

const contentFromPartial = (event: AssistantMessageEvent): PiAssistantContent[] => {
    if ("partial" in event) {
        return event.partial.content as PiAssistantContent[];
    }
    if (event.type === "done") {
        return event.message.content as PiAssistantContent[];
    }
    if (event.type === "error") {
        return event.error.content as PiAssistantContent[];
    }
    return [];
};

const contentFromMessage = (message: AgentMessage): PiAssistantContent[] => {
    if (message.assistantContent?.length) {
        return [...message.assistantContent];
    }
    const content: PiAssistantContent[] = [];
    if (message.thinking) {
        content.push({type: "thinking", thinking: message.thinking});
    }
    if (message.content && !message.error) {
        content.push({type: "text", text: message.content});
    }
    for (const toolCall of message.toolCalls ?? []) {
        content.push({
            type: "toolCall",
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.argsText,
        } as unknown as PiAssistantContent);
    }
    return content;
};

const applyAssistantContentEvent = (
    previousContent: PiAssistantContent[],
    partialContent: PiAssistantContent[],
    event: AssistantMessageEvent,
): PiAssistantContent[] => {
    const content = partialContent.length ? [...partialContent] : [...previousContent];
    if (!("contentIndex" in event)) {
        return content;
    }
    const previousBlock = previousContent[event.contentIndex];
    const partialBlock = partialContent[event.contentIndex];

    if (event.type === "text_start") {
        content[event.contentIndex] = partialBlock?.type === "text" ? partialBlock : {type: "text", text: ""};
    }
    if (event.type === "text_delta") {
        const text = partialBlock?.type === "text"
            ? partialBlock.text
            : `${previousBlock?.type === "text" ? previousBlock.text : ""}${event.delta}`;
        content[event.contentIndex] = {type: "text", text};
    }
    if (event.type === "text_end") {
        content[event.contentIndex] = {type: "text", text: event.content};
    }
    if (event.type === "thinking_start") {
        content[event.contentIndex] = partialBlock?.type === "thinking" ? partialBlock : {type: "thinking", thinking: ""};
    }
    if (event.type === "thinking_delta") {
        const thinking = partialBlock?.type === "thinking"
            ? partialBlock.thinking
            : `${previousBlock?.type === "thinking" ? previousBlock.thinking : ""}${event.delta}`;
        content[event.contentIndex] = {type: "thinking", thinking};
    }
    if (event.type === "thinking_end") {
        content[event.contentIndex] = {type: "thinking", thinking: event.content};
    }
    if (event.type === "toolcall_start") {
        content[event.contentIndex] = partialBlock?.type === "toolCall"
            ? partialBlock
            : ({type: "toolCall", id: `content-${String(event.contentIndex)}`, name: "", arguments: ""} as unknown as PiAssistantContent);
    }
    if (event.type === "toolcall_delta") {
        const toolCall = partialBlock?.type === "toolCall"
            ? partialBlock
            : previousBlock?.type === "toolCall"
                ? {
                    ...previousBlock,
                    arguments: `${formatToolArgs(previousBlock.arguments)}${event.delta}`,
                } as unknown as PiAssistantContent
                : ({type: "toolCall", id: `content-${String(event.contentIndex)}`, name: "", arguments: event.delta} as unknown as PiAssistantContent);
        content[event.contentIndex] = toolCall;
    }
    if (event.type === "toolcall_end") {
        content[event.contentIndex] = event.toolCall as unknown as PiAssistantContent;
    }
    return content;
};

const textFromContent = (content: PiAssistantContent[]): string => {
    return content.filter((block) => block.type === "text").map((block) => block.text).join("");
};

const thinkingFromContent = (content: PiAssistantContent[]): string => {
    return content.filter((block) => block.type === "thinking").map((block) => block.thinking).join("");
};

const toolCallsFromContent = (content: PiAssistantContent[], assistantMessageId: string): AgentToolCall[] | undefined => {
    const toolCalls = content
        .map((block, contentIndex) => ({block, contentIndex}))
        .filter((item): item is {block: PiAgentToolCall; contentIndex: number} => item.block.type === "toolCall")
        .map((item) => toLocalToolCall(item.block, item.contentIndex, assistantMessageId));
    return toolCalls.length ? toolCalls : undefined;
};

const messageContentText = (message: PiMessage): string => {
    if (typeof message.content === "string") {
        return message.content;
    }
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
};

const customMessageText = (message: Record<string, unknown>): string => {
    const content = message.content;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter((block): block is {type?: string; text?: string} => Boolean(block) && typeof block === "object")
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("\n");
    }
    const details = message.details;
    if (typeof details === "string") {
        return details;
    }
    try {
        return JSON.stringify(message, null, 2);
    } catch {
        return String(message.role ?? "custom message");
    }
};

const resolveLiveMessageId = (message: PiAgentMessage): string => {
    if (message.role === "toolResult") {
        return `tool-result:${message.toolCallId}:${String(message.timestamp)}`;
    }
    return `${message.role}:${String(message.timestamp)}`;
};

const toLocalToolCall = (toolCall: PiAgentToolCall, index: number, assistantMessageId: string): AgentToolCall => {
    const argsText = formatToolArgs(toolCall.arguments);
    const linkedSessionId = extractLinkedSessionId(toolCall.arguments);
    return {
        id: toolCall.id,
        assistantMessageId,
        index,
        name: toolCall.name,
        argsText,
        argsJson: toStableArgsJson(argsText),
        status: "streaming",
        linkedSessionId,
    };
};

const formatToolArgs = (args: unknown): string => {
    if (typeof args === "string") {
        return args;
    }
    return JSON.stringify(args ?? {}, null, 2);
};

const markInterruptedToolCalls = (
    messages: AgentMessage[],
    input: {
        hasActiveInvocation: boolean;
        pendingToolCallId: string | null;
    },
): void => {
    if (input.hasActiveInvocation) {
        return;
    }
    for (const message of messages) {
        if (!message.toolCalls?.length) {
            continue;
        }
        message.toolCalls = message.toolCalls.map((toolCall) => {
            if (toolCall.id === input.pendingToolCallId || toolCall.status === "success" || toolCall.status === "error" || toolCall.status === "invalid") {
                return toolCall;
            }
            return {
                ...toolCall,
                status: "error",
                error: toolCall.error ?? INTERRUPTED_TOOL_CALL_ERROR,
                result: toolCall.result ?? INTERRUPTED_TOOL_CALL_ERROR,
            };
        });
    }
};

const upsertToolResult = (assistant: AgentMessage, toolResult: ToolResultMessage): void => {
    const toolCalls = [...(assistant.toolCalls ?? [])];
    const index = toolCalls.findIndex((toolCall) => toolCall.id === toolResult.toolCallId);
    const result = messageContentText(toolResult);
    const nextToolCall: AgentToolCall = {
        id: toolResult.toolCallId,
        assistantMessageId: assistant.id,
        index: index >= 0 ? toolCalls[index]!.index : toolCalls.length,
        name: toolResult.toolName,
        argsText: index >= 0 ? toolCalls[index]!.argsText : "",
        argsJson: index >= 0 ? toolCalls[index]!.argsJson : undefined,
        status: toolResult.isError ? "error" : "success",
        error: toolResult.isError ? result : undefined,
        result,
        rawResult: toolResult.details,
        linkedSessionId: extractLinkedSessionId(toolResult.details),
    };
    if (index >= 0) {
        toolCalls[index] = {
            ...toolCalls[index],
            ...nextToolCall,
        };
    } else {
        toolCalls.push(nextToolCall);
    }
    assistant.toolCalls = toolCalls.sort((left, right) => left.index - right.index);
};

const updateToolCall = (messages: AgentMessage[], toolCallId: string, patch: Partial<AgentToolCall>): AgentMessage[] => {
    return messages.map((message) => {
        if (!message.toolCalls?.some((toolCall) => toolCall.id === toolCallId)) {
            return message;
        }
        return {
            ...message,
            toolCalls: message.toolCalls.map((toolCall) => toolCall.id === toolCallId
                ? {
                    ...toolCall,
                    ...patch,
                    status: mergeToolCallStatus(patch.status ?? toolCall.status, toolCall.status),
                }
                : toolCall),
        };
    });
};

const resultText = (result: unknown): string => {
    if (!result) {
        return "";
    }
    if (typeof result === "string") {
        return result;
    }
    if (typeof result === "object" && "content" in result && Array.isArray((result as {content?: unknown}).content)) {
        return ((result as {content: Array<{type?: string; text?: string}>}).content)
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("\n");
    }
    try {
        return JSON.stringify(result, null, 2);
    } catch {
        return String(result);
    }
};

const extractLinkedSessionId = (value: unknown): number | undefined => {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.sessionId === "number") {
        return record.sessionId;
    }
    if (record.details && typeof record.details === "object" && typeof (record.details as Record<string, unknown>).sessionId === "number") {
        return (record.details as Record<string, unknown>).sessionId as number;
    }
    return undefined;
};

const approvalQuestion = (toolName: string, args: Record<string, unknown>): string => {
    if (toolName === "enter_plan_mode") {
        return typeof args.reason === "string" && args.reason ? `Agent 请求进入 Plan Mode：${args.reason}` : "Agent 请求进入 Plan Mode。";
    }
    if (toolName === "exit_plan_mode") {
        return typeof args.reason === "string" && args.reason ? `Agent 请求退出 Plan Mode：${args.reason}` : "Agent 请求退出 Plan Mode。";
    }
    if (toolName === "skill") {
        const skillKey = typeof args.skillKey === "string" ? args.skillKey : "未知 skill";
        return `Agent 请求激活 skill：${skillKey}`;
    }
    return `Agent 请求执行 ${toolName}。`;
};
