import {z} from "zod";
import {AgentThreadKindSchema, AgentThreadRunStatusSchema} from "nbook/shared/dto/prisma-enums";

export const MAX_AGENT_THREAD_TITLE_LENGTH = 120;
export const AGENT_CLIENT_VARIABLES_HEADER = "x-agent-client-variables";

export const AgentMessageRoleSchema = z.enum(["user", "assistant", "tool", "system"]);
export const AgentMessageStatusSchema = z.enum(["streaming", "done", "stopped"]);
export const AgentToolStatusSchema = z.enum(["running", "success", "error"]);
export const AgentStreamToolStatusSchema = z.enum(["streaming", "running", "success", "error"]);
export const AgentToolNodeStatusSchema = z.enum(["drafting", "running", "success", "error"]);
const ReasoningEffortSchema = z.enum(["low", "medium", "high"]).nullable().default(null);
/**
 * 对话消息上的工具调用快照。
 */
export const AgentConversationToolCallDtoSchema = z.object({
    id: z.string(),
    assistantMessageId: z.string(),
    toolNodeId: z.string(),
    callIndex: z.number().int().nonnegative(),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    argsText: z.string(),
    status: AgentToolNodeStatusSchema,
    outputText: z.string(),
    rawResult: z.json().optional(),
    subagentThreadId: z.string().optional(),
});

/**
 * 对话消息快照。
 * 仅用于 draft assistant 与 assistant_done 事件。
 */
export const AgentConversationMessageDtoSchema = z.object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
    status: AgentMessageStatusSchema,
    createdAt: z.string(),
    model: z.string().optional(),
    tokens: z.number().int().nonnegative().optional(),
    thinking: z.string().optional(),
    toolCalls: z.array(AgentConversationToolCallDtoSchema).optional(),
});

const AgentTokenUsageDtoSchema = z.object({
    inputTokens: z.number().int().nonnegative().nullable().default(null),
    outputTokens: z.number().int().nonnegative().nullable().default(null),
    totalTokens: z.number().int().nonnegative().nullable().default(null),
    cacheReadTokens: z.number().int().nonnegative().nullable().default(null),
    cacheMissTokens: z.number().int().nonnegative().nullable().default(null),
    cacheCreationTokens: z.number().int().nonnegative().nullable().default(null),
});

const AgentThreadTokenStatsDtoSchema = z.object({
    lastRun: AgentTokenUsageDtoSchema.nullable().default(null),
    cumulative: AgentTokenUsageDtoSchema.nullable().default(null),
    contextWindowTokens: z.number().int().positive().nullable().default(null),
    lastRunContextRatio: z.number().nonnegative().nullable().default(null),
    lastRunContextPercent: z.number().nonnegative().nullable().default(null),
});

const AgentPlanModeStateDtoSchema = z.object({
    active: z.boolean().default(false),
});

export const AgentLeaderProfileKeyDtoSchema = z.string().trim().min(1, "profileKey 不能为空");
export const AgentProfileKeyDtoSchema = z.string().trim().min(1, "profileKey 不能为空");

/**
 * 历史树节点快照。
 */
export const AgentConversationNodeDtoSchema = z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    childIds: z.array(z.string()),
    role: AgentMessageRoleSchema,
    status: z.enum(["done", "stopped"]),
    content: z.string(),
    createdAt: z.string(),
    archivedAt: z.string().nullable(),
    assistantMessageId: z.string().nullable(),
    toolCallId: z.string().nullable(),
    toolName: z.string().nullable(),
    toolArgs: z.string().nullable(),
    toolStatus: AgentToolStatusSchema.nullable(),
    rawAdditionalKwargs: z.record(z.string(), z.json()),
});

/**
 * 历史树完整快照。
 */
export const AgentConversationTreeSnapshotDtoSchema = z.object({
    revision: z.number().int().nonnegative(),
    activeCursorId: z.string().nullable(),
    rootNodeId: z.string().nullable(),
    nodes: z.array(AgentConversationNodeDtoSchema),
});

export const AgentUserInputQuestionOptionDtoSchema = z.object({
    label: z.string().trim().min(1, "option.label 不能为空").describe("User-facing option label, preferably 1-5 words."),
    description: z.string().trim().optional().describe("Optional short sentence explaining the impact or tradeoff of this option."),
    recommended: z.boolean().optional().describe("Whether this option is recommended. Prefer placing recommended options first."),
});

export const AgentUserInputQuestionDtoSchema = z.object({
    header: z.string().trim().min(1, "header 不能为空").optional().describe("Short header shown above this question, preferably 1-5 words."),
    question: z.string().trim().min(1, "question 不能为空").describe("Prompt shown to the user."),
    options: z.array(AgentUserInputQuestionOptionDtoSchema)
        .default([])
        .describe("Options for this question. Empty options means this is an open-ended question."),
    multiSelect: z.boolean().default(false).describe("Whether the user may select multiple options. Ignored when options is empty."),
});

export const AgentPendingUserInputQuestionDtoSchema = z.object({
    toolNodeId: z.string().trim().min(1, "toolNodeId 不能为空"),
    questionIndex: z.number().int().nonnegative("questionIndex 不能小于 0"),
    toolCallId: z.string().trim().min(1).nullable().optional(),
    toolName: z.string().trim().min(1, "toolName 不能为空"),
    kind: z.enum(["question", "tool_approval"]).default("question"),
    approvalAction: z.enum(["enter_plan_mode", "exit_plan_mode", "skill"]).optional(),
    approvalToolArgsText: z.string().optional(),
    planFilePath: z.string().trim().min(1, "planFilePath 不能为空").optional(),
    planContent: z.string().optional(),
    header: z.string().trim().min(1, "header 不能为空").optional(),
    question: z.string().trim().min(1, "question 不能为空"),
    options: z.array(AgentUserInputQuestionOptionDtoSchema).default([]),
    multiSelect: z.boolean().default(false),
});

export const AgentPendingUserInputSessionDtoSchema = z.object({
    assistantMessageId: z.string().trim().min(1, "assistantMessageId 不能为空"),
    status: z.literal("pending"),
    questions: z.array(AgentPendingUserInputQuestionDtoSchema).min(1, "questions 至少需要一个问题"),
});

export const RequestUserInputToolArgsSchema = z.object({
    questions: z.array(AgentUserInputQuestionDtoSchema)
        .min(1, "questions 至少需要一个问题")
        .describe("Questions to ask in one user-input request. For each question, empty options means an open-ended question."),
});

export const RequestUserInputToolAnswerSchema = z.object({
    /**
     * ignored 为 true 时为空，表示用户明确跳过该问题。
     * note 非空且 selectedOptionIndex/selectedOptionIndexes 为空时，表示用户直接回答开放问题。
     */
    questionIndex: z.number().int().nonnegative("questionIndex 不能小于 0").optional().describe("Question index inside the request_user_input call."),
    selectedOptionIndex: z.number().int().min(-1, "selectedOptionIndex 不能小于 -1").optional().describe("Selected option index. -1 means an alternative answer or additional suggestion."),
    selectedOptionIndexes: z.array(z.number().int().min(-1, "selectedOptionIndexes 不能小于 -1")).optional().describe("Selected option indexes for multi-select questions. -1 means an alternative answer or additional suggestion."),
    note: z.string().trim().optional().describe("Optional free-form note provided by the user."),
    ignored: z.boolean().optional().describe("True when the user explicitly skipped this question."),
}).superRefine((value, ctx) => {
    if (!value.ignored && value.selectedOptionIndex === undefined && !value.selectedOptionIndexes?.length && !value.note) {
        ctx.addIssue({
            code: "custom",
            message: "selectedOptionIndex、selectedOptionIndexes 或 note 不能为空",
            path: ["selectedOptionIndex"],
        });
    }
});

/**
 * 线程摘要。
 */
export const AgentThreadSummaryDtoSchema = z.object({
    id: z.string(),
    kind: AgentThreadKindSchema,
    profileKey: z.string(),
    title: z.string(),
    summary: z.string(),
    status: AgentThreadRunStatusSchema,
    modelOverrideKey: z.string().trim().nullable().default(null),
    modelOverride: z.object({
        modelKey: z.string().trim().min(1, "modelKey 不能为空"),
        modelLabel: z.string().trim().nullable().default(null),
        temperature: z.number().nonnegative("temperature 不能小于 0").nullable().default(null),
        topK: z.number().int("topK 必须是整数").positive("topK 必须大于 0").nullable().default(null),
        reasoningEffort: ReasoningEffortSchema,
        stream: z.boolean().default(true),
        contextWindowTokens: z.number().int().positive().nullable().default(null),
    }).nullable().default(null),
    effectiveModelKey: z.string().trim().nullable().default(null),
    effectiveModelLabel: z.string().trim().nullable().default(null),
    effectiveModel: z.object({
        modelKey: z.string().trim().min(1, "modelKey 不能为空"),
        modelLabel: z.string().trim().nullable().default(null),
        temperature: z.number().nonnegative("temperature 不能小于 0").nullable().default(null),
        topK: z.number().int("topK 必须是整数").positive("topK 必须大于 0").nullable().default(null),
        reasoningEffort: ReasoningEffortSchema,
        stream: z.boolean().default(true),
        contextWindowTokens: z.number().int().positive().nullable().default(null),
    }).nullable().default(null),
    tokenStats: AgentThreadTokenStatsDtoSchema.default({
        lastRun: null,
        cumulative: null,
        contextWindowTokens: null,
        lastRunContextRatio: null,
        lastRunContextPercent: null,
    }),
    planMode: AgentPlanModeStateDtoSchema.default({
        active: false,
    }),
    lastMessageAt: z.string(),
    lastMessagePreview: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});

/**
 * subagent 摘要。
 */
export const AgentSubagentSummaryDtoSchema = AgentThreadSummaryDtoSchema.extend({
    profileKey: z.string(),
});

/**
 * 线程首帧快照。
 */
export const AgentThreadSnapshotEventDtoSchema = z.object({
    type: z.literal("thread_snapshot"),
    thread: AgentThreadSummaryDtoSchema,
    subagents: z.array(AgentSubagentSummaryDtoSchema),
    leaders: z.array(AgentThreadSummaryDtoSchema),
    conversationTree: AgentConversationTreeSnapshotDtoSchema,
    draft: AgentConversationMessageDtoSchema.nullable(),
    pendingUserInputSession: AgentPendingUserInputSessionDtoSchema.nullable().default(null),
});

/**
 * 历史树更新快照。
 */
export const AgentHistorySnapshotEventDtoSchema = z.object({
    type: z.literal("history_snapshot"),
    threadId: z.string(),
    conversationTree: AgentConversationTreeSnapshotDtoSchema,
});

/**
 * 线程详情。
 */
export const AgentThreadDetailDtoSchema = z.object({
    thread: AgentThreadSummaryDtoSchema,
    subagents: z.array(AgentSubagentSummaryDtoSchema),
    leaders: z.array(AgentThreadSummaryDtoSchema),
    conversationTree: AgentConversationTreeSnapshotDtoSchema,
    pendingUserInputSession: AgentPendingUserInputSessionDtoSchema.nullable().default(null),
});

/**
 * skills catalog 条目。
 * 前端只需要名称和简介；location 仍只在服务端运行时使用。
 */
export const AgentSkillCatalogItemDtoSchema = z.object({
    name: z.string().trim().min(1, "skill.name 不能为空"),
    description: z.string().trim().min(1, "skill.description 不能为空"),
});

/**
 * 线程列表查询参数。
 */
export const ListAgentThreadsQueryDtoSchema = z.object({
    kind: AgentThreadKindSchema.optional(),
    profileKey: AgentProfileKeyDtoSchema.optional(),
});

/**
 * 客户端变量快照。
 */
export const ClientVariablesDtoSchema = z.object({
    ide: z.record(z.string(), z.json()).optional(),
    studio: z.record(z.string(), z.json()).optional(),
});

/**
 * 运行选项。
 */
export const AgentRunOptionsDtoSchema = z.object({});

export const UpdateAgentPlanModeRequestDtoSchema = z.object({
    active: z.boolean(),
});

/**
 * 新建 leader 线程请求。
 */
export const CreateAgentThreadRequestDtoSchema = z.object({
    profileKey: AgentLeaderProfileKeyDtoSchema.optional(),
    title: z.string().trim().max(MAX_AGENT_THREAD_TITLE_LENGTH, `title 过长，最大 ${MAX_AGENT_THREAD_TITLE_LENGTH} 字符`).optional(),
    modelOverrideKey: z.string().trim().min(1, "modelOverrideKey 不能为空").nullable().optional(),
    modelOverride: z.object({
        modelKey: z.string().trim().min(1, "modelKey 不能为空"),
        temperature: z.number().nonnegative("temperature 不能小于 0").nullable().default(null),
        topK: z.number().int("topK 必须是整数").positive("topK 必须大于 0").nullable().default(null),
        reasoningEffort: ReasoningEffortSchema,
        stream: z.boolean().default(true),
    }).nullable().optional(),
});

/**
 * 新建 subagent 请求。
 */
export const CreateSubAgentThreadRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空"),
    title: z.string().trim().max(MAX_AGENT_THREAD_TITLE_LENGTH, `title 过长，最大 ${MAX_AGENT_THREAD_TITLE_LENGTH} 字符`).optional(),
});

/**
 * 关联已有 subagent 请求。
 */
export const AttachSubAgentThreadRequestDtoSchema = z.object({
    subagentThreadId: z.union([
        z.string().trim().min(1, "subagentThreadId 不能为空"),
        z.number(),
    ]),
});

/**
 * 派发线程运行请求。
 */
export const DispatchAgentRunRequestDtoSchema = z.object({
    mode: z.enum(["prompt", "continue"]).default("prompt"),
    input: z.record(z.string(), z.json()).optional(),
    options: AgentRunOptionsDtoSchema.optional(),
}).superRefine((value, ctx) => {
    if (value.mode === "prompt" && !value.input?.prompt) {
        ctx.addIssue({
            code: "custom",
            message: "prompt 模式必须提供 input.prompt",
            path: ["input", "prompt"],
        });
    }
    if (value.mode === "continue" && value.input && Object.keys(value.input).length > 0) {
        ctx.addIssue({
            code: "custom",
            message: "continue 模式不接受 input",
            path: ["input"],
        });
    }
});

/**
 * 创建用户消息请求。
 */
export const CreateAgentMessageRequestDtoSchema = z.object({
    content: z.string().trim().min(1, "content 不能为空"),
});

export const SubmitUserInputAnswersRequestDtoSchema = z.object({
    assistantMessageId: z.string().trim().min(1, "assistantMessageId 不能为空"),
    answers: z.array(z.object({
        toolNodeId: z.string().trim().min(1, "toolNodeId 不能为空").describe("Tool node id of the pending request_user_input call."),
        questionIndex: z.number().int().nonnegative("questionIndex 不能小于 0").optional().describe("Question index inside the request_user_input call."),
        /**
         * ignored 为 true 时为空，开放问题可用 note 直接回答。
         */
        selectedOptionIndex: z.number().int().min(-1, "selectedOptionIndex 不能小于 -1").optional().describe("Selected option index. -1 means an alternative answer or additional suggestion."),
        selectedOptionIndexes: z.array(z.number().int().min(-1, "selectedOptionIndexes 不能小于 -1")).optional().describe("Selected option indexes for multi-select questions. -1 means an alternative answer or additional suggestion."),
        note: z.string().trim().optional().describe("Optional free-form note or open-ended answer submitted with this answer."),
        ignored: z.boolean().optional().describe("True when this answer should complete the tool call with the default ignored result."),
    })).min(1, "answers 至少需要一项").describe("Answers for pending request_user_input questions."),
    resume: z.boolean().optional().describe("Whether to automatically continue the run after all submitted answers are accepted. Defaults to true."),
}).superRefine((value, ctx) => {
    for (const [index, answer] of value.answers.entries()) {
        if (!answer.ignored && answer.selectedOptionIndex === undefined && !answer.selectedOptionIndexes?.length && !answer.note) {
            ctx.addIssue({
                code: "custom",
                message: "selectedOptionIndex、selectedOptionIndexes 或 note 不能为空",
                path: ["answers", index, "selectedOptionIndex"],
            });
        }
    }
});

/**
 * 改写单条消息请求。
 */
export const UpdateAgentMessageRequestDtoSchema = z.object({
    content: z.string().trim().min(1, "content 不能为空"),
});

/**
 * 更新线程模型请求。
 */
export const UpdateAgentThreadModelRequestDtoSchema = z.object({
    mode: z.enum(["default", "override"]).optional(),
    modelKey: z.string().trim().min(1, "modelKey 不能为空").nullable().optional(),
    config: z.object({
        modelKey: z.string().trim().min(1, "modelKey 不能为空"),
        temperature: z.number().nonnegative("temperature 不能小于 0").nullable().default(null),
        topK: z.number().int("topK 必须是整数").positive("topK 必须大于 0").nullable().default(null),
        reasoningEffort: ReasoningEffortSchema,
        stream: z.boolean().default(true),
    }).optional(),
}).superRefine((value, ctx) => {
    if (!value.mode) {
        return;
    }

    if (value.mode === "default" && value.config) {
        ctx.addIssue({
            code: "custom",
            path: ["config"],
            message: "default 模式不接受 config",
        });
    }

    if (value.mode === "override" && !value.config) {
        ctx.addIssue({
            code: "custom",
            path: ["config"],
            message: "override 模式必须提供 config",
        });
    }
});

/**
 * 消息树变更响应。
 */
export const AgentConversationMutationResponseDtoSchema = z.object({
    ok: z.literal(true),
    conversationTree: AgentConversationTreeSnapshotDtoSchema,
});

export const AgentRunStateEventDtoSchema = z.object({
    type: z.literal("run_state"),
    threadId: z.string(),
    status: AgentThreadRunStatusSchema.exclude(["idle"]),
    error: z.string().optional(),
});

export const AgentUserInputRequestedEventDtoSchema = z.object({
    type: z.literal("user_input_requested"),
    threadId: z.string(),
    session: AgentPendingUserInputSessionDtoSchema,
});

export const AgentAssistantDeltaEventDtoSchema = z.object({
    type: z.literal("assistant_delta"),
    threadId: z.string(),
    messageId: z.string(),
    chunkText: z.string(),
});

export const AgentThinkingDeltaEventDtoSchema = z.object({
    type: z.literal("thinking_delta"),
    threadId: z.string(),
    messageId: z.string(),
    chunkText: z.string(),
});

export const AgentToolCallStartedEventDtoSchema = z.object({
    type: z.literal("tool_call_started"),
    threadId: z.string(),
    assistantMessageId: z.string(),
    toolNodeId: z.string(),
    callIndex: z.number().int().nonnegative(),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    subagentThreadId: z.string().optional(),
});

export const AgentToolArgsDeltaEventDtoSchema = z.object({
    type: z.literal("tool_args_delta"),
    threadId: z.string(),
    assistantMessageId: z.string(),
    toolNodeId: z.string(),
    argsChunk: z.string(),
});

export const AgentToolExecStartedEventDtoSchema = z.object({
    type: z.literal("tool_exec_started"),
    threadId: z.string(),
    assistantMessageId: z.string(),
    toolNodeId: z.string(),
    toolCallId: z.string().optional(),
    subagentThreadId: z.string().optional(),
});

export const AgentToolOutputDeltaEventDtoSchema = z.object({
    type: z.literal("tool_output_delta"),
    threadId: z.string(),
    assistantMessageId: z.string(),
    toolNodeId: z.string(),
    outputChunk: z.string(),
});

export const AgentToolFinishedEventDtoSchema = z.object({
    type: z.literal("tool_finished"),
    threadId: z.string(),
    assistantMessageId: z.string(),
    status: AgentToolStatusSchema,
    toolCall: AgentConversationToolCallDtoSchema,
    subagentThreadId: z.string().optional(),
});

export const AgentAssistantDoneEventDtoSchema = z.object({
    type: z.literal("assistant_done"),
    threadId: z.string(),
    messageId: z.string(),
    message: AgentConversationMessageDtoSchema,
});

export const AgentStreamEventDtoSchema = z.discriminatedUnion("type", [
    AgentThreadSnapshotEventDtoSchema,
    AgentHistorySnapshotEventDtoSchema,
    AgentRunStateEventDtoSchema,
    AgentUserInputRequestedEventDtoSchema,
    AgentAssistantDeltaEventDtoSchema,
    AgentThinkingDeltaEventDtoSchema,
    AgentToolCallStartedEventDtoSchema,
    AgentToolArgsDeltaEventDtoSchema,
    AgentToolExecStartedEventDtoSchema,
    AgentToolOutputDeltaEventDtoSchema,
    AgentToolFinishedEventDtoSchema,
    AgentAssistantDoneEventDtoSchema,
]);

export type AgentMessageRoleDto = z.infer<typeof AgentMessageRoleSchema>;
export type AgentMessageStatusDto = z.infer<typeof AgentMessageStatusSchema>;
export type AgentToolStatusDto = z.infer<typeof AgentToolStatusSchema>;
export type AgentStreamToolStatusDto = z.infer<typeof AgentStreamToolStatusSchema>;
export type AgentToolNodeStatusDto = z.infer<typeof AgentToolNodeStatusSchema>;
export type AgentConversationToolCallDto = z.infer<typeof AgentConversationToolCallDtoSchema>;
export type AgentConversationMessageDto = z.infer<typeof AgentConversationMessageDtoSchema>;
export type AgentConversationNodeDto = z.infer<typeof AgentConversationNodeDtoSchema>;
export type AgentConversationTreeSnapshotDto = z.infer<typeof AgentConversationTreeSnapshotDtoSchema>;
export type AgentUserInputQuestionOptionDto = z.infer<typeof AgentUserInputQuestionOptionDtoSchema>;
export type AgentUserInputQuestionDto = z.infer<typeof AgentUserInputQuestionDtoSchema>;
export type AgentPendingUserInputQuestionDto = z.infer<typeof AgentPendingUserInputQuestionDtoSchema>;
export type AgentPendingUserInputSessionDto = z.infer<typeof AgentPendingUserInputSessionDtoSchema>;
export type RequestUserInputToolArgsDto = z.infer<typeof RequestUserInputToolArgsSchema>;
export type RequestUserInputToolAnswerDto = z.infer<typeof RequestUserInputToolAnswerSchema>;
export type AgentTokenUsageDto = z.infer<typeof AgentTokenUsageDtoSchema>;
export type AgentThreadTokenStatsDto = z.infer<typeof AgentThreadTokenStatsDtoSchema>;
export type AgentThreadSummaryDto = z.infer<typeof AgentThreadSummaryDtoSchema>;
export type AgentSubagentSummaryDto = z.infer<typeof AgentSubagentSummaryDtoSchema>;
export type AgentThreadDetailDto = z.infer<typeof AgentThreadDetailDtoSchema>;
export type AgentSkillCatalogItemDto = z.infer<typeof AgentSkillCatalogItemDtoSchema>;
export type AgentThreadModelConfigDto = NonNullable<z.infer<typeof AgentThreadSummaryDtoSchema>["effectiveModel"]>;
export type ListAgentThreadsQueryDto = z.infer<typeof ListAgentThreadsQueryDtoSchema>;
export type ClientVariablesDto = z.infer<typeof ClientVariablesDtoSchema>;
export type AgentRunOptionsDto = z.infer<typeof AgentRunOptionsDtoSchema>;
export type UpdateAgentPlanModeRequestDto = z.infer<typeof UpdateAgentPlanModeRequestDtoSchema>;
export type CreateAgentThreadRequestDto = z.infer<typeof CreateAgentThreadRequestDtoSchema>;
export type CreateSubAgentThreadRequestDto = z.infer<typeof CreateSubAgentThreadRequestDtoSchema>;
export type AttachSubAgentThreadRequestDto = z.infer<typeof AttachSubAgentThreadRequestDtoSchema>;
export type DispatchAgentRunRequestDto = z.infer<typeof DispatchAgentRunRequestDtoSchema>;
export type CreateAgentMessageRequestDto = z.infer<typeof CreateAgentMessageRequestDtoSchema>;
export type SubmitUserInputAnswersRequestDto = z.infer<typeof SubmitUserInputAnswersRequestDtoSchema>;
export type UpdateAgentMessageRequestDto = z.infer<typeof UpdateAgentMessageRequestDtoSchema>;
export type UpdateAgentThreadModelRequestDto = z.infer<typeof UpdateAgentThreadModelRequestDtoSchema>;
export type AgentConversationMutationResponseDto = z.infer<typeof AgentConversationMutationResponseDtoSchema>;
export type AgentThreadSnapshotEventDto = z.infer<typeof AgentThreadSnapshotEventDtoSchema>;
export type AgentStreamEventDto = z.infer<typeof AgentStreamEventDtoSchema>;
