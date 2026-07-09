import {z} from "zod";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import type {AgentMessage, JsonValue, Model, Usage} from "nbook/server/agent/messages/types";
import type {SessionEntry, SessionTreeNode} from "nbook/server/agent/session/types";
import type {VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

export const AgentSessionIdSchema = z.number().int().positive();

/**
 * Agent 工作模式（Task 90）。
 * - normal：无特殊约束，可读可写。
 * - discuss：只读讨论导向，写文件工具挂起审批。
 * - plan：只读计划导向，写文件工具挂起审批（计划目录内 .md 豁免）。
 */
export const AgentModeSchema = z.enum(["normal", "discuss", "plan"]);

export type AgentMode = z.infer<typeof AgentModeSchema>;

/**
 * 判断模式是否为只读模式（discuss / plan 共有约束：写文件工具需审批）。
 */
export function isReadonlyMode(mode: AgentMode): boolean {
    return mode === "discuss" || mode === "plan";
}

export const AgentUserMessageInputDtoSchema = z.object({
    text: z.string(),
    images: z.array(z.object({
        type: z.literal("image"),
        mimeType: z.string().trim().min(1),
        data: z.string().trim().min(1),
    })).optional(),
});

export const AgentResolutionDtoSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("tool_approval"),
        toolCallId: z.string().trim().min(1),
        approved: z.boolean(),
        resultText: z.string().optional(),
        data: JsonValueSchema.optional(),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string().optional(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }),
    z.object({
        kind: z.literal("user_input"),
        toolCallId: z.string().trim().min(1),
        /** Task 63: Low-Code Form 提交数据（存在时优先于 answers）。 */
        data: JsonValueSchema.optional(),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string().optional(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }).refine((value) => value.data !== undefined || value.answers !== undefined, {
        message: "user_input resolution 必须提供 data 或 answers",
    }),
]);

export type AgentResolutionDto = z.infer<typeof AgentResolutionDtoSchema>;

export const AgentCreateSessionRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空"),
    initial: JsonValueSchema.optional(),
    workspaceRoot: z.string().trim().min(1).optional(),
    workspaceKey: z.string().trim().min(1).optional(),
    projectPath: z.string().trim().min(1).optional(),
    parentSessionId: AgentSessionIdSchema.optional(),
});

export const AgentInvokeRequestDtoSchema = z.object({
    mode: z.enum(["prompt", "continue", "steer", "followup"]),
    message: AgentUserMessageInputDtoSchema.optional(),
    input: JsonValueSchema.optional(),
    title: z.string().trim().min(1).optional(),
    resolution: AgentResolutionDtoSchema.optional(),
    resolutions: z.array(AgentResolutionDtoSchema).optional(),
    clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
    caller: z.never().optional(),
    block: z.boolean().optional(),
}).superRefine((value, ctx) => {
    if ((value.mode === "prompt" || value.mode === "steer" || value.mode === "followup") && !value.message && value.input === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: `${value.mode} 模式必须提供 message 或 input`,
        });
    }
    if (value.mode === "continue" && (value.message || value.input !== undefined)) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: "continue 模式不能提供 message 或 input",
        });
    }
    if (value.resolution && value.resolutions) {
        ctx.addIssue({
            code: "custom",
            path: ["resolution"],
            message: "不能同时提供 resolution 和 resolutions",
        });
    }
});

export const AgentSessionListQueryDtoSchema = z.object({
    workspaceKey: z.string().trim().min(1).optional(),
    projectPath: z.string().trim().min(1).optional(),
    includeArchived: z.coerce.boolean().optional(),
    includeSystem: z.coerce.boolean().optional(),
    profileKey: z.string().trim().min(1).optional(),
    profileGroup: z.enum(["all", "leader"]).optional(),
    status: z.enum(["all", "active", "running", "waiting", "idle", "interrupted", "archived"]).optional(),
    relation: z.enum(["all", "top", "child"]).optional(),
    search: z.string().trim().optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentSessionEventsQueryDtoSchema = z.object({
    after: z.coerce.number().int().nonnegative().optional(),
    eventEpoch: z.string().trim().min(1).optional(),
});

export const AgentCommandRequestDtoSchema = z.discriminatedUnion("command", [
    z.object({command: z.literal("new")}),
    z.object({command: z.literal("archive"), reason: z.string().optional()}),
    z.object({command: z.literal("compact"), instructions: z.string().optional()}),
    z.object({command: z.literal("mode"), mode: AgentModeSchema}),
    z.object({command: z.literal("model"), modelKey: z.string().trim().min(1).nullable()}),
    z.object({command: z.literal("thinking"), thinkingLevel: ThinkingLevelSchema.nullable()}),
    z.object({command: z.literal("rename"), title: z.string().trim().min(1)}),
    z.object({command: z.literal("summarize")}),
    z.object({command: z.literal("retry"), entryId: z.string().trim().min(1).optional()}),
    z.object({command: z.literal("fork"), entryId: z.string().trim().min(1).optional()}),
    z.object({
        command: z.literal("tree"),
        targetEntryId: z.string().trim().min(1),
        position: z.enum(["at", "before"]).default("at"),
    }),
]);

export const AgentTreeRequestDtoSchema = z.union([
    z.object({
        position: z.literal("empty"),
    }),
    z.object({
        targetEntryId: z.string().trim().min(1),
        position: z.enum(["at", "before"]).default("at"),
        next: z.object({
            type: z.literal("invoke"),
            mode: z.enum(["prompt", "continue"]),
            message: AgentUserMessageInputDtoSchema.optional(),
            clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
        }).optional(),
    }),
]);

export const AgentAbortRequestDtoSchema = z.object({
    reason: z.string().optional(),
    clearQueue: z.boolean().optional(),
});

export const ClientVariablePatchAckDtoSchema = z.object({
    namespace: z.literal("client"),
    path: z.string().trim().min(1),
    operations: z.array(z.any()),
    appliedValue: JsonValueSchema.optional(),
    error: z.string().optional(),
    invocationId: z.string().optional(),
    toolCallId: z.string().optional(),
});

export type AgentCreateSessionRequestDto = z.infer<typeof AgentCreateSessionRequestDtoSchema>;
export type AgentUserMessageInputDto = z.infer<typeof AgentUserMessageInputDtoSchema>;
export type AgentInvokeRequestDto = z.infer<typeof AgentInvokeRequestDtoSchema>;
export type AgentSessionListQueryDto = z.infer<typeof AgentSessionListQueryDtoSchema>;
export type AgentSessionEventsQueryDto = z.infer<typeof AgentSessionEventsQueryDtoSchema>;
export type AgentCommandRequestDto = z.infer<typeof AgentCommandRequestDtoSchema>;
export type AgentTreeRequestDto = z.infer<typeof AgentTreeRequestDtoSchema>;
export type AgentAbortRequestDto = z.infer<typeof AgentAbortRequestDtoSchema>;
export type ClientVariablePatchAckDto = z.infer<typeof ClientVariablePatchAckDtoSchema> & VariablePatchAck;

export const AgentSkillCatalogItemDtoSchema = z.object({
    name: z.string().trim().min(1, "skill.name 不能为空"),
    description: z.string().trim().min(1, "skill.description 不能为空"),
});

export const ClientVariablesDtoSchema = z.object({
    ide: z.record(z.string(), JsonValueSchema).optional(),
    studio: z.record(z.string(), JsonValueSchema).optional(),
}).catchall(JsonValueSchema.optional());

export type AgentSkillCatalogItemDto = z.infer<typeof AgentSkillCatalogItemDtoSchema>;
export type ClientVariablesDto = z.infer<typeof ClientVariablesDtoSchema>;
export type ClientStateSnapshotDto = ClientVariablesDto;

export type AgentSessionStatus = "idle" | "running" | "waiting" | "archived" | "interrupted";
export type AgentSessionProfileAvailability = "loaded" | "missing" | "unloadable";

export type AgentEventCursorDto = {
    eventEpoch: string;
    /** 前端已经处理到的事件序号；订阅 SSE 时使用 after=该值。 */
    after: number;
};

export type AgentSessionContextUsageDto = {
    /** 当前 active context 的 token 估算值。 */
    usedTokens: number;
    /** 当前模型 context window；为空表示模型未声明窗口。 */
    limitTokens: number | null;
    /** usedTokens / limitTokens 的百分比；limitTokens 为空时为空。 */
    percent: number | null;
    estimated: true;
};

export type AgentSessionSummaryDto = {
    sessionId: number;
    profileKey: string;
    /**
     * 当前 session 引用的 profile 是否仍可用于后续运行。
     * 为空只会出现在仓储层原始摘要；HTTP runtime 投影会始终填充。
     */
    profileAvailability?: AgentSessionProfileAvailability;
    /** profile 不可继续运行时的用户可读原因；profile 可用时为空。 */
    profileIssueMessage?: string;
    workspaceKey: string;
    workspaceRoot: string;
    projectPath?: string;
    parentSessionId?: number;
    systemRole?: "summarizer";
    title?: string;
    summary?: string;
    status: AgentSessionStatus;
    updatedAt: number;
    archived: boolean;
    lastMessagePreview?: string;
    usage?: Usage;
};

export type AgentSessionListPageDto = {
    items: AgentSessionSummaryDto[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset?: number;
};

export type AgentSessionSummarizerStateDto = {
    running: boolean;
    dirty: boolean;
    /** 最近一次构建出的 Agent Dialogue Content token 估算。为空表示尚未运行过。 */
    lastDialogueContentTokens?: number;
    /** 最近一次成功摘要的完成时间。为空表示尚未成功写回过。 */
    lastRunAt?: number;
    /** 最近一次后台摘要错误。为空表示当前没有可展示错误。 */
    lastError?: string;
};

export type AgentSessionProfileGroup = "all" | "leader";
export type AgentSessionStatusFilter = "all" | "active" | "running" | "waiting" | "idle" | "interrupted" | "archived";
export type AgentSessionRelationFilter = "all" | "top" | "child";

export type AgentLinkedSessionDto = AgentSessionSummaryDto & {
    detached: boolean;
};

export type AgentSessionRelationsDto = {
    sessionId: number;
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
};

export type AgentPendingUserInputDto = {
    assistantMessageId?: string;
    toolCallId: string;
    toolName: string;
    args?: JsonValue;
    planFilePath?: string;
    planContent?: string;
    /** Low-Code Form 规格，从 tool.user-input-required 事件复制；存在时优先于 args.form。 */
    formSpec?: {
        form: LowCodeFormDto;
        layout?: "dialog" | "inline" | "fullscreen";
        prompt?: string;
    };
};

/** @deprecated 使用 AgentPendingUserInputDto */
export type AgentPendingApprovalDto = AgentPendingUserInputDto;

export type AgentQueuedMessageDto = {
    id: string;
    kind: "steer" | "followup";
    message?: AgentUserMessageInputDto;
    input?: JsonValue;
    createdAt: number;
};

export type AgentFollowUpQueueItemDto = AgentQueuedMessageDto;

export type AgentFollowUpQueueStateDto = {
    status: "ready" | "paused";
    pausedBy?: {
        invocationId: string;
        reason: "error" | "aborted" | "interrupted";
    };
    items: AgentFollowUpQueueItemDto[];
};

export type AgentActiveInvocationDto = {
    invocationId: string;
    sessionId: number;
    status: "running" | "waiting" | "aborting";
    mode: "prompt" | "continue" | "compact";
    startedAt: number;
};

export type AgentSessionLiveStateDto = {
    summary: AgentSessionSummaryDto;
    /** 后台标题/摘要维护状态。为空表示当前 session 未启用或尚无摘要状态。 */
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    /** 显式 active path 重定位版本;变化时前端应拉 snapshot 重建消息投影。 */
    activePathRevision: string | null;
    pendingUserInputs: AgentPendingUserInputDto[];
    pendingApprovals: AgentPendingApprovalDto[];
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    /** 当前 session 的显式 thinking 覆盖；null 表示跟随 Agent Profile。 */
    thinkingLevel: z.infer<typeof ThinkingLevelSchema> | null;
    /** 当前新 run 实际会传给 PI 的 thinking level。 */
    effectiveThinkingLevel: z.infer<typeof ThinkingLevelSchema>;
    agentMode: AgentMode;
    usage?: Usage;
    contextUsage?: AgentSessionContextUsageDto;
};

export type AgentRuntimeStreamEventDto =
    | {
        type: "agent_start";
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "agent_end";
        status: "completed" | "waiting" | "failed" | "aborted" | "interrupted";
        usage?: Usage;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "turn_start";
        turnIndex: number;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "turn_end";
        turnIndex: number;
        status: "completed" | "waiting" | "failed";
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "message_start" | "message_end";
        message: AgentMessage;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "message_update";
        message: AgentMessage;
        assistantMessageEvent: AssistantMessageEvent;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool_execution_start";
        toolCallId: string;
        toolName: string;
        /** 工具参数来自异构 tool schema，第一版原样透传给工具卡展示。 */
        args: unknown;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool_execution_update";
        toolCallId: string;
        toolName: string;
        /** 工具参数来自异构 tool schema，第一版原样透传给工具卡展示。 */
        args: unknown;
        /** 工具流式 partial result 来自异构工具，后续如变大再做 preview/ref。 */
        partialResult: unknown;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool_execution_end";
        toolCallId: string;
        toolName: string;
        /** 工具结果来自异构工具，第一版保持原样，后续如变大再做 preview/ref。 */
        result: unknown;
        isError: boolean;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "tool.user-input-required";
        toolCallId: string;
        toolName: string;
        args: unknown;
        formSpec?: {
            form: LowCodeFormDto;
            resultSchema?: unknown;
            prompt?: string;
            layout?: "dialog" | "inline" | "fullscreen";
        };
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar.start";
        sidecarType: string;
        stage: string;
        leafId: string;
    }
    | {
        type: "sidecar.complete";
        sidecarType: string;
        stage: string;
        leafId: string;
    }
    | {
        type: "sidecar.error";
        sidecarType: string;
        stage: string;
        error: string;
    }
    | {
        type: "sidecar_start";
        /** sidecar 类型名称，例如 "context-load" */
        sidecarType: string;
        /** sidecar 执行阶段，prepareRun 或 settleRun */
        stage: "prepareRun" | "settleRun";
        /** sidecar transcript 在 session 中的 leafId */
        leafId: string | null;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar_complete";
        sidecarType: string;
        stage: "prepareRun" | "settleRun";
        leafId: string | null;
        /** sidecar 返回的结果数据，供前端展示或调试 */
        sidecarResult: unknown;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar_error";
        sidecarType: string;
        stage: "prepareRun" | "settleRun";
        leafId: string | null;
        error: string;
        sidecarContext?: { type: string; leafId: string };
    }
    | {
        type: "sidecar_merge";
        /** 合并了哪些 sidecar 的数据 */
        sidecarTypes: string[];
        stage: "prepareRun" | "settleRun";
        /** 合并后实际写入 persistedMessages 的消息数量 */
        mergedMessageCount: number;
        sidecarContext?: { type: string; leafId: string };
    };

export type AgentSessionControlEvent =
    | {
        type: "connected";
        eventEpoch: string;
        latestSeq: number;
    }
    | {
        type: "snapshot_required";
        reason: string;
    }
    | {
        type: "steer_queued";
        item: AgentQueuedMessageDto;
    }
    | {
        type: "follow_up_queued";
        item: AgentQueuedMessageDto;
    }
    | {
        type: "session_entry";
        entry: SessionEntry;
    }
    | {
        type: "session_state_changed";
        state: AgentSessionLiveStateDto;
    }
    | {
        type: "invocation_aborted";
        reason?: string;
    }
    | {
        type: "client_variable_patch_requested";
        request: VariablePatchRequest;
    };

export type AgentSessionEventDto =
    | {
        eventEpoch: string;
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "runtime";
        event: AgentRuntimeStreamEventDto;
    }
    | {
        eventEpoch: string;
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "session";
        event: AgentSessionControlEvent;
    };

export type AgentSessionSnapshotDto = {
    eventEpoch: string;
    /** 前端应用 snapshot 后继续订阅 SSE 的恢复 cursor。 */
    eventCursor: AgentEventCursorDto;
    /** 当前服务端事件流尾部，仅用于调试/对照，不作为恢复 cursor。 */
    latestSeq: number;
    summary: AgentSessionSummaryDto;
    /** 后台展示标题/摘要维护状态；仅面向 UI，不影响 Agent 运行态。 */
    summarizer?: AgentSessionSummarizerStateDto;
    activeLeafId: string | null;
    /** 显式 active path 重定位版本；变化时前端应拉 snapshot 重建消息投影。 */
    activePathRevision: string | null;
    /** 当前 profile 的 provider 级 system prompt，用于前端只读展示；不作为普通历史消息。 */
    systemPrompt?: string;
    messages: AgentMessage[];
    tree: SessionTreeNode[];
    entries: SessionEntry[];
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    pendingUserInputs: AgentPendingUserInputDto[];
    pendingApprovals: AgentPendingApprovalDto[];
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    /** 当前 session 的显式 thinking 覆盖；null 表示跟随 Agent Profile。 */
    thinkingLevel: z.infer<typeof ThinkingLevelSchema> | null;
    /** 当前新 run 实际会传给 PI 的 thinking level。 */
    effectiveThinkingLevel: z.infer<typeof ThinkingLevelSchema>;
    agentMode: AgentMode;
    /** 兼容字段；值等于 eventCursor.after，不再表示 EventHub 尾部。 */
    lastSeq: number;
    usage?: Usage;
    contextUsage?: AgentSessionContextUsageDto;
};
