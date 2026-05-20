import type {BaseMessage, StoredMessage} from "@langchain/core/messages";
import {z} from "zod";
import type {AgentThread as PrismaAgentThread} from "nbook/server/generated/prisma/client";
import type {RetrievalProfileInput, RetrievalProfileOutput} from "nbook/server/agent/profiles/builtin/retrieval.contract";
export {
    RetrievalInputSchema,
    RetrievalOutputSchema,
    type RetrievalProfileInput,
    type RetrievalProfileOutput,
} from "nbook/server/agent/profiles/builtin/retrieval.contract";

/**
 * 服务端使用的深只读类型。
 * 变量快照不会暴露可写引用，避免 profile 误修改 store。
 */
type DeepReadonly<T> =
    T extends (...args: never[]) => unknown
        ? T
        : T extends readonly (infer TItem)[]
            ? readonly DeepReadonly<TItem>[]
            : T extends object
                ? {readonly [K in keyof T]: DeepReadonly<T[K]>}
                : T;

/**
 * 线程主键。
 */
export type ThreadId = string;

/**
 * profile 唯一键。
 */
export type BuiltinProfileKey = keyof BuiltinProfileInputMap;
export type ProfileKey = BuiltinProfileKey | (string & {});

/**
 * leader profile 唯一键。
 */
export type LeaderProfileKey = "leader.default" | "leader.assets";

/**
 * subagent profile 唯一键。
 */
export type BuiltinSubAgentProfileKey = "subagent.writer" | "subagent.retrieval";
export type SubAgentProfileKey = BuiltinSubAgentProfileKey | (string & {});

/**
 * tool 唯一键。
 */
export type ToolKey = string;

/**
 * JSON 原子值。
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON 值。
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

/**
 * JSON 对象。
 */
export type JsonObject = {
    [key: string]: JsonValue;
};

/**
 * AgentMessage 角色。
 * 这里使用面向产品历史的角色命名，不直接暴露 LangChain 内部类型。
 */
export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

/**
 * AgentMessage 持久化状态。
 * done 表示已正常完成；stopped 表示被中断或截断后保留。
 */
export type AgentMessageStatus = "done" | "stopped";

/**
 * AgentMessage 持久化记录。
 */
export type AgentMessage = {
    id: string;
    threadId: ThreadId;
    parentId: string | null;
    childIds: string[];
    archivedAt: string | null;
    status: AgentMessageStatus;
    createdAt: string;
    storedMessage: StoredMessage;
};

/**
 * 创建 AgentMessage 时使用的输入。
 * id/createdAt 允许上层透传；未传时由 store 默认实现生成。
 */
export type AgentMessageCreateInput = {
    id?: string;
    status?: AgentMessageStatus;
    message: BaseMessage;
    createdAt?: string;
};

/**
 * AgentMessageStore 的完整快照。
 * 该结构会作为 JSON 存入 checkpoint 的 channel_values.snapshot。
 */
export type AgentMessageStoreSnapshot = {
    version: 3;
    revision: number;
    activeCursorId: string | null;
    rootNodeId: string | null;
    nodesById: Record<string, AgentMessage>;
};

/**
 * 单个受监控变量的持久化基准。
 */
export const WatchedVariableBaselineSchema = z.object({
    fingerprint: z.string(),
    /**
     * false 表示当前路径不存在或值为 undefined。
     * 旧数据没有该字段时，通过 fingerprint 兼容判断。
     */
    hasValue: z.boolean().optional(),
    value: z.json(),
});

/**
 * thread 级模型覆盖。
 */
export const AgentThreadModelOverrideSchema = z.object({
    modelKey: z.string().trim().min(1),
    temperature: z.number().nullable().optional(),
    topK: z.number().int().positive().nullable().optional(),
    reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
    stream: z.boolean().optional(),
});

/**
 * Agent task 状态。
 */
export const AgentTaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

/**
 * Agent 线程内任务步骤。
 */
export const AgentTaskStepSchema = z.object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    status: AgentTaskStatusSchema,
    /**
     * 为空表示没有本次状态变更备注。
     */
    note: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1),
});

/**
 * Agent 线程内任务列表。
 */
export const AgentTaskListSchema = z.object({
    /**
     * 为空表示不展示列表标题。
     */
    title: z.string().trim().min(1).optional(),
    steps: z.array(AgentTaskStepSchema).min(1),
    updatedAt: z.string().trim().min(1),
});

/**
 * thread 级软 Plan Mode 状态。
 */
export const AgentPlanModeStateSchema = z.object({
    active: z.boolean().default(false),
    enteredAt: z.string().trim().min(1).optional(),
    turnsSinceReminder: z.number().int().nonnegative().default(0),
    reminderCount: z.number().int().nonnegative().default(0),
    needsExitReminder: z.boolean().default(false),
    hasExited: z.boolean().default(false),
});

/**
 * 本轮运行对应的用户可见 Turn。
 */
export const AgentRunTurnSchema = z.object({
    kind: z.enum(["new_user_turn", "resume_turn"]),
    turnIndex: z.number().int().nonnegative(),
    /**
     * 为空表示本轮没有已持久化的当前用户输入锚点。
     */
    anchorMessageId: z.string().trim().min(1).optional(),
});

/**
 * thread 级 prompt reminder 注入状态。
 */
export const AgentReminderStateSchema = z.object({
    /**
     * 为空表示该 reminder 不绑定变量指纹。
     */
    fingerprint: z.string().optional(),
    /**
     * 最近一次注入时的 user turn 序号。
     */
    injectedAtTurn: z.number().int().nonnegative(),
});

/**
 * thread 持久化元数据。
 */
export const AgentThreadMetadataSchema = z.object({
    watchedVariables: z.record(z.string(), WatchedVariableBaselineSchema).optional(),
    reminders: z.record(z.string(), AgentReminderStateSchema).optional(),
    /**
     * 为空表示跟随 profile 默认模型。
     */
    modelOverrideKey: z.string().trim().min(1).nullable().optional(),
    /**
     * 当前 thread 的完整模型覆盖配置。
     */
    modelOverride: AgentThreadModelOverrideSchema.nullable().optional(),
    /**
     * thread 级 token 统计。
     */
    usageSummary: z.object({
        lastRun: z.object({
            inputTokens: z.number().int().nonnegative().nullable().optional(),
            outputTokens: z.number().int().nonnegative().nullable().optional(),
            totalTokens: z.number().int().nonnegative().nullable().optional(),
            cacheReadTokens: z.number().int().nonnegative().nullable().optional(),
            cacheMissTokens: z.number().int().nonnegative().nullable().optional(),
            cacheCreationTokens: z.number().int().nonnegative().nullable().optional(),
        }).nullable().optional(),
        cumulative: z.object({
            inputTokens: z.number().int().nonnegative().nullable().optional(),
            outputTokens: z.number().int().nonnegative().nullable().optional(),
            totalTokens: z.number().int().nonnegative().nullable().optional(),
            cacheReadTokens: z.number().int().nonnegative().nullable().optional(),
            cacheMissTokens: z.number().int().nonnegative().nullable().optional(),
            cacheCreationTokens: z.number().int().nonnegative().nullable().optional(),
        }).nullable().optional(),
    }).optional(),
    /**
     * 等待前端回答的问题会话。
     * 为空表示当前线程没有挂起中的 request_user_input。
     */
    pendingUserInputSession: z.object({
        assistantMessageId: z.string().trim().min(1),
        status: z.literal("pending"),
        questions: z.array(z.object({
            toolNodeId: z.string().trim().min(1),
            questionIndex: z.number().int().nonnegative(),
            toolCallId: z.string().trim().min(1).nullable().optional(),
            toolName: z.string().trim().min(1),
            toolArgsText: z.string(),
            approvalToolArgsText: z.string().optional(),
            createdAt: z.string().trim().min(1),
            kind: z.enum(["question", "tool_approval"]).optional(),
            approvalAction: z.enum(["enter_plan_mode", "exit_plan_mode", "skill"]).optional(),
            planFilePath: z.string().trim().min(1).optional(),
            planContent: z.string().optional(),
        })).min(1),
    }).nullable().optional(),
    /**
     * 当前线程的 Agent 自管理任务列表。
     */
    tasks: AgentTaskListSchema.optional(),
    /**
     * 当前线程的软 Plan Mode 状态。
     */
    planMode: AgentPlanModeStateSchema.optional(),
});

/**
 * Agent 线程类型。
 */
export type AgentThreadKind = "leader" | "subagent";

/**
 * Agent 线程运行状态。
 */
export type AgentThreadStatus = "idle" | "running" | "waiting_user" | "completed" | "stopped" | "failed";

/**
 * 运行时消息角色。
 */
export type RuntimeMessageRole = "system" | "human" | "assistant";

/**
 * 运行时传入的客户端变量快照。
 */
export const ClientVariablesSchema = z.object({
    ide: z.record(z.string(), z.json()).optional(),
    studio: z.record(z.string(), z.json()).optional(),
});

/**
 * 线程运行时选项。
 */
export const RunOptionsSchema = z.object({
    /**
     * 本轮运行对应的用户可见 Turn。
     * 仅供服务端运行时内部使用，前端 Dispatch DTO 不暴露该字段。
     */
    turn: AgentRunTurnSchema.optional(),
    /**
     * 本轮需要注入的 Plan Mode reminder。
     * 仅供服务端运行时内部使用，前端 Dispatch DTO 不暴露该字段。
     */
    planModeReminder: z.enum(["full", "sparse", "exit", "reentry_full"]).optional(),
    /**
     * Plan Mode reminder 真正送达模型后才写回的线程 metadata。
     * 仅供服务端 run coordinator 内部消费。
     */
    planModeCommitMetadata: AgentThreadMetadataSchema.optional(),
});

/**
 * writer 可消费的内容节点引用。
 */
export const WriterLorebookEntrySchema = z.object({
    path: z.string().trim().min(1).describe("Workspace content node path. Directory nodes may omit the trailing index.md."),
    priority: z.number().optional().describe("Optional lower-is-higher priority for prompt ordering."),
    reason: z.string().trim().min(1).optional().describe("Optional compact reason why this node is relevant."),
});

/**
 * leader 输入结构。
 */
export const LeaderPromptInputSchema = z.object({
    mode: z.literal("prompt"),
    prompt: z.string().trim().min(1, "leader.prompt 不能为空"),
});

/**
 * 兼容旧版只传 prompt 的 leader 输入。
 */
export const LegacyLeaderPromptInputSchema = z.object({
    prompt: z.string().trim().min(1, "leader.prompt 不能为空"),
});

/**
 * leader 继续运行输入结构。
 */
export const LeaderContinueInputSchema = z.object({
    mode: z.literal("continue"),
});

/**
 * leader 输入结构。
 */
export const LeaderInputSchema = z.discriminatedUnion("mode", [
    LeaderPromptInputSchema,
    LeaderContinueInputSchema,
]).or(LegacyLeaderPromptInputSchema);

/**
 * writer 输入结构。
 */
export const WriterInputSchema = z.object({
    prompt: z.string().trim().min(1, "writer.prompt 不能为空").describe("The writing prompt describing what should be written."),
    plotPoints: z.array(z.string().trim().min(1)).min(1, "writer.plotPoints 至少需要一个剧情点").describe("Array of story scene IDs to expand into writing context. At least one required."),
    lorebookEntries: z.array(WriterLorebookEntrySchema).min(1, "writer.lorebookEntries 至少需要一个条目").describe("Lorebook entries providing context for the writing. At least one required."),
    constraints: z.array(z.string().trim().min(1)).optional().describe("Optional writing constraints to follow."),
});

export type WriterLorebookEntry = z.infer<typeof WriterLorebookEntrySchema>;
export type LeaderInput = z.infer<typeof LeaderInputSchema>;
export type WriterProfileInput = z.infer<typeof WriterInputSchema>;
export type ClientVariables = z.infer<typeof ClientVariablesSchema>;
export type RunOptions = z.infer<typeof RunOptionsSchema>;
export type AgentRunTurn = z.infer<typeof AgentRunTurnSchema>;
export type WatchedVariableBaseline = z.infer<typeof WatchedVariableBaselineSchema>;
export type AgentReminderState = z.infer<typeof AgentReminderStateSchema>;
export type AgentThreadModelOverride = z.infer<typeof AgentThreadModelOverrideSchema>;
export type AgentThreadMetadata = z.infer<typeof AgentThreadMetadataSchema>;
export type AgentPlanModeState = z.infer<typeof AgentPlanModeStateSchema>;
export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;
export type AgentTaskStep = z.infer<typeof AgentTaskStepSchema>;
export type AgentTaskList = z.infer<typeof AgentTaskListSchema>;

/**
 * 归一化后的 token 使用量。
 */
export type AgentTokenUsage = {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cacheReadTokens: number | null;
    cacheMissTokens: number | null;
    cacheCreationTokens: number | null;
};

/**
 * thread 级 token 统计。
 */
export type AgentThreadUsageSummary = {
    lastRun: AgentTokenUsage | null;
    cumulative: AgentTokenUsage | null;
};

/**
 * 挂起中的用户问答会话。
 */
export type PendingUserInputSession = NonNullable<AgentThreadMetadata["pendingUserInputSession"]>;

/**
 * 归一化单次 token 使用量。
 */
export function normalizeAgentTokenUsage(usage: Partial<AgentTokenUsage> | null | undefined): AgentTokenUsage | null {
    if (!usage) {
        return null;
    }

    return {
        inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : null,
        outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : null,
        totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : null,
        cacheReadTokens: typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : null,
        cacheMissTokens: typeof usage.cacheMissTokens === "number" ? usage.cacheMissTokens : null,
        cacheCreationTokens: typeof usage.cacheCreationTokens === "number" ? usage.cacheCreationTokens : null,
    };
}

/**
 * 累加两份 token 使用量。
 */
export function sumAgentTokenUsage(
    left: Partial<AgentTokenUsage> | null | undefined,
    right: Partial<AgentTokenUsage> | null | undefined,
): AgentTokenUsage | null {
    const normalizedLeft = normalizeAgentTokenUsage(left);
    const normalizedRight = normalizeAgentTokenUsage(right);

    if (!normalizedLeft && !normalizedRight) {
        return null;
    }

    return {
        inputTokens: (normalizedLeft?.inputTokens ?? 0) + (normalizedRight?.inputTokens ?? 0),
        outputTokens: (normalizedLeft?.outputTokens ?? 0) + (normalizedRight?.outputTokens ?? 0),
        totalTokens: (normalizedLeft?.totalTokens ?? 0) + (normalizedRight?.totalTokens ?? 0),
        cacheReadTokens: (normalizedLeft?.cacheReadTokens ?? 0) + (normalizedRight?.cacheReadTokens ?? 0),
        cacheMissTokens: (normalizedLeft?.cacheMissTokens ?? 0) + (normalizedRight?.cacheMissTokens ?? 0),
        cacheCreationTokens: (normalizedLeft?.cacheCreationTokens ?? 0) + (normalizedRight?.cacheCreationTokens ?? 0),
    };
}

/**
 * 归一化 thread 级 token 汇总。
 */
export function normalizeAgentThreadUsageSummary(
    summary: {
        lastRun?: Partial<AgentTokenUsage> | null;
        cumulative?: Partial<AgentTokenUsage> | null;
    } | null | undefined,
): AgentThreadUsageSummary | null {
    if (!summary) {
        return null;
    }

    return {
        lastRun: normalizeAgentTokenUsage(summary.lastRun),
        cumulative: normalizeAgentTokenUsage(summary.cumulative),
    };
}

/**
 * 从 assistant rawAdditionalKwargs 中读取 usageMetadata。
 */
export function readAgentUsageMetadata(rawAdditionalKwargs: JsonObject): AgentTokenUsage | null {
    const usageMetadata = rawAdditionalKwargs.usageMetadata;
    if (!usageMetadata || typeof usageMetadata !== "object" || Array.isArray(usageMetadata)) {
        return null;
    }

    return normalizeAgentTokenUsage({
        inputTokens: typeof usageMetadata.inputTokens === "number" ? usageMetadata.inputTokens : null,
        outputTokens: typeof usageMetadata.outputTokens === "number" ? usageMetadata.outputTokens : null,
        totalTokens: typeof usageMetadata.totalTokens === "number" ? usageMetadata.totalTokens : null,
        cacheReadTokens: typeof usageMetadata.cacheReadTokens === "number" ? usageMetadata.cacheReadTokens : null,
        cacheMissTokens: typeof usageMetadata.cacheMissTokens === "number" ? usageMetadata.cacheMissTokens : null,
        cacheCreationTokens: typeof usageMetadata.cacheCreationTokens === "number" ? usageMetadata.cacheCreationTokens : null,
    });
}

/**
 * skills catalog 中的单个条目。
 * location 始终为服务端可直接读取的绝对路径。
 * displayLocation 是给模型和前端看的稳定相对路径。
 */
export type SkillCatalogItem = {
    name: string;
    description: string;
    whenToUse?: string;
    headerText: string;
    location: string;
    displayLocation?: string;
    source?: "user" | "builtin";
};

/**
 * profile 输入映射。
 */
export type BuiltinProfileInputMap = {
    "leader.default": LeaderInput;
    "leader.assets": LeaderInput;
    "subagent.writer": WriterProfileInput;
    "subagent.retrieval": RetrievalProfileInput;
};

/**
 * profile 输入映射。
 * 动态 profile 运行时通过 Zod 校验；静态映射只保留 builtin contract。
 */
export type ProfileInputMap = BuiltinProfileInputMap;

/**
 * 根据 profileKey 解析输入类型。
 */
export type ProfileInput<TKey extends ProfileKey> = TKey extends BuiltinProfileKey ? ProfileInputMap[TKey] : JsonValue;

/**
 * profile 输出映射。
 */
export type BuiltinProfileOutputMap = {
    "leader.default": JsonValue | undefined;
    "leader.assets": JsonValue | undefined;
    "subagent.writer": JsonValue | undefined;
    "subagent.retrieval": RetrievalProfileOutput;
};

/**
 * profile 输出映射。
 * 动态 profile 的精确类型由后续 prepare 生成的类型增强提供。
 */
export type ProfileOutputMap = BuiltinProfileOutputMap;

/**
 * 根据 profileKey 解析输出类型。
 */
export type ProfileOutput<TKey extends ProfileKey> = TKey extends BuiltinProfileKey ? ProfileOutputMap[TKey] : JsonValue | undefined;

/**
 * 任意 subagent 输入联合。
 */
export type AnySubAgentInput = ProfileInputMap[BuiltinSubAgentProfileKey] | JsonValue;

/**
 * subagent 最终完成结果。
 * walkthrough 始终是最终总结，不回传中间消息。
 * data 为空表示本次 subagent 只提供文字说明，没有额外结构化产物。
 */
export type SubAgentCompletionResult<TKey extends SubAgentProfileKey = SubAgentProfileKey> = {
    subagentThreadId: ThreadId;
    status: "completed";
    walkthrough: string;
    data?: ProfileOutput<TKey>;
};

/**
 * IDE 命名空间变量。
 * extra 保存暂未建模的只读扩展字段。
 */
export type IdeVariables = {
    panel: string | null;
    activePanel: string | null;
    theme: string | null;
    extra: JsonObject;
};

/**
 * Studio 命名空间变量。
 * extra 保存暂未建模的只读扩展字段。
 */
export type StudioVariables = {
    novelId: string | null;
    selectedChapterId: string | null;
    previousSelectedChapterId: string | null;
    currentChapterTitle: string | null;
    previousChapterTitle: string | null;
    currentChapterLabel: string | null;
    previousChapterLabel: string | null;
    workspace: string | null;
    workspaceKind: "novel" | "user-assets" | null;
    didSwitchChapter: boolean;
    selectionVersion: number | null;
    extra: JsonObject;
};

/**
 * Agent 命名空间中的线程信息。
 */
export type AgentThreadVariables = {
    id: ThreadId;
    title: string;
    summary: string;
    status: AgentThreadStatus;
};

/**
 * Agent 命名空间中的 subagent 摘要。
 */
export type AgentSubagentVariables = {
    id: ThreadId;
    title: string;
    profileKey: string;
    status: AgentThreadStatus;
};

/**
 * Agent 命名空间中的任务摘要。
 */
export type AgentTaskVariables = AgentTaskList;

/**
 * Agent 命名空间变量。
 */
export type AgentVariables<TKey extends ProfileKey = ProfileKey> = {
    thread: AgentThreadVariables;
    profileKey: TKey;
    kind: AgentThreadKind;
    tools: readonly ToolKey[];
    subagents: readonly AgentSubagentVariables[];
    tasks: AgentTaskVariables | null;
};

/**
 * Profile 可消费的强类型变量快照。
 */
export type AgentVariableScope<TKey extends ProfileKey = ProfileKey> = DeepReadonly<{
    ide: IdeVariables;
    studio: StudioVariables;
    agent: AgentVariables<TKey>;
    input: ProfileInput<TKey>;
}>;

/**
 * 线程摘要。
 */
export type ThreadSummary = {
    id: ThreadId;
    kind: AgentThreadKind;
    profileKey: string;
    title: string;
    summary: string;
    status: AgentThreadStatus;
    modelOverride: AgentThreadModelOverride | null;
    modelOverrideKey: string | null;
    usageSummary: AgentThreadUsageSummary | null;
    pendingUserInputSession: PendingUserInputSession | null;
    planMode: AgentPlanModeState | null;
    lastMessageAt: Date;
};

/**
 * subagent 摘要。
 */
export type SubAgentThreadSummary = ThreadSummary & {
    profileKey: string;
};

/**
 * 创建 leader 线程参数。
 */
export type CreateLeaderThreadInput = {
    profileKey?: string;
    title?: string;
    modelOverride?: AgentThreadModelOverride | null;
    modelOverrideKey?: string | null;
};

/**
 * 线程列表查询参数。
 */
export type ListThreadsInput = {
    kind?: AgentThreadKind;
    profileKey?: string;
};

/**
 * 创建 subagent 线程参数。
 */
export type CreateSubAgentThreadInput<K extends string = string> = {
    leaderThreadId: ThreadId;
    profileKey: K;
    title?: string;
};

/**
 * 流式快照中的工具状态。
 */
export type LiveToolState = {
    toolNodeId: string;
    assistantMessageId: string;
    callIndex: number;
    toolCallId?: string;
    toolName: string;
    status: "drafting" | "running" | "success" | "error";
    argsText: string;
    outputText: string;
    subagentThreadId?: string;
};

/**
 * 当前活跃 run 的快照。
 */
export type LiveRunSnapshot = {
    threadId: ThreadId;
    status: AgentThreadStatus;
    messageId: string;
    text: string;
    thinkingText: string;
    tools: LiveToolState[];
};

/**
 * 面向前端投影后的工具调用。
 */
export type AgentConversationToolCall = {
    id: string;
    assistantMessageId: string;
    toolNodeId: string;
    callIndex: number;
    toolCallId?: string;
    toolName: string;
    argsText: string;
    status: "drafting" | "running" | "success" | "error";
    outputText: string;
    rawResult?: JsonValue;
    subagentThreadId?: string;
};

/**
 * 面向前端投影后的消息。
 * tool 结果会折叠进 assistant.toolCalls，因此这里只暴露 user/system/assistant。
 */
export type AgentConversationMessage = {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    status: "streaming" | AgentMessageStatus;
    createdAt: string;
    model?: string;
    thinking?: string;
    tokens?: number;
    toolCalls?: AgentConversationToolCall[];
};

/**
 * 面向前端投影后的历史树节点。
 */
export type AgentConversationNode = {
    id: string;
    parentId: string | null;
    childIds: string[];
    role: AgentMessageRole;
    status: AgentMessageStatus;
    content: string;
    createdAt: string;
    archivedAt: string | null;
    assistantMessageId: string | null;
    toolCallId: string | null;
    toolName: string | null;
    toolArgs: string | null;
    toolStatus: "success" | "error" | null;
    rawAdditionalKwargs: JsonObject;
};

/**
 * 面向前端投影后的历史树快照。
 */
export type AgentConversationTreeSnapshot = {
    revision: number;
    activeCursorId: string | null;
    rootNodeId: string | null;
    nodes: AgentConversationNode[];
};

/**
 * request_user_input 的单个选项。
 */
export type AgentUserInputQuestionOption = {
    label: string;
    description?: string;
    recommended?: boolean;
};

/**
 * request_user_input 的单个问题。
 */
export type AgentUserInputQuestion = {
    header?: string;
    question: string;
    /** 为空时表示开放问题，用户可直接输入文本回答。 */
    options: AgentUserInputQuestionOption[];
    /** true 表示当前问题允许多选；开放问题忽略该字段。 */
    multiSelect: boolean;
};

/**
 * 前端可直接渲染的挂起问题。
 */
export type AgentPendingUserInputQuestion = AgentUserInputQuestion & {
    toolNodeId: string;
    questionIndex: number;
    toolCallId?: string | null;
    toolName: string;
};

/**
 * Agent 流式事件。
 */
export type AgentStreamEvent =
    | {
        type: "thread_snapshot";
        thread: ThreadSummary;
        subagents: SubAgentThreadSummary[];
        leaders: ThreadSummary[];
        conversationTree: AgentConversationTreeSnapshot;
        draft: AgentConversationMessage | null;
        pendingUserInputSession: PendingUserInputSession | null;
    }
    | {
        type: "history_snapshot";
        threadId: ThreadId;
        conversationTree: AgentConversationTreeSnapshot;
    }
    | {
        type: "run_state";
        threadId: ThreadId;
        status: Exclude<AgentThreadStatus, "idle">;
        error?: string;
    }
    | {
        type: "user_input_requested";
        threadId: ThreadId;
        session: PendingUserInputSession;
    }
    | {
        type: "thinking_delta";
        threadId: ThreadId;
        messageId: string;
        chunkText: string;
    }
    | {
        type: "assistant_delta";
        threadId: ThreadId;
        messageId: string;
        chunkText: string;
    }
    | {
        type: "tool_call_started";
        threadId: ThreadId;
        assistantMessageId: string;
        toolNodeId: string;
        callIndex: number;
        toolCallId?: string;
        toolName: string;
        subagentThreadId?: string;
    }
    | {
        type: "tool_args_delta";
        threadId: ThreadId;
        assistantMessageId: string;
        toolNodeId: string;
        argsChunk: string;
    }
    | {
        type: "tool_exec_started";
        threadId: ThreadId;
        assistantMessageId: string;
        toolNodeId: string;
        toolCallId?: string;
        subagentThreadId?: string;
    }
    | {
        type: "tool_output_delta";
        threadId: ThreadId;
        assistantMessageId: string;
        toolNodeId: string;
        outputChunk: string;
    }
    | {
        type: "tool_finished";
        threadId: ThreadId;
        assistantMessageId: string;
        status: "success" | "error";
        toolCall: AgentConversationToolCall;
        subagentThreadId?: string;
    }
    | {
        type: "assistant_done";
        threadId: ThreadId;
        messageId: string;
        message: AgentConversationMessage;
    }
    ;

/**
 * 仓储内部使用的线程记录。
 */
export type AgentThreadRecord = Pick<
    PrismaAgentThread,
    "id" | "kind" | "runStatus" | "profileKey" | "title" | "activeCursorMessageId" | "lastMessagePreview" | "lastMessageAt"
> & {
    metadata: AgentThreadMetadata;
};

