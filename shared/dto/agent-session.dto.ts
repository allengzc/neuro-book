import {z} from "zod";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AgentMessage, JsonValue, Model, Usage} from "nbook/server/agent/messages/types";
import type {SessionEntry, SessionTreeNode} from "nbook/server/agent/session/types";
import type {VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

export const AgentSessionIdSchema = z.number().int().positive();

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
            text: z.string(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            selectedOptionIndexes: z.array(z.number().int().min(-1)).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })).optional(),
    }),
    z.object({
        kind: z.literal("user_input"),
        toolCallId: z.string().trim().min(1),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string(),
            selectedOptionIndex: z.number().int().min(-1).optional(),
            selectedOptionIndexes: z.array(z.number().int().min(-1)).optional(),
            note: z.string().optional(),
            ignored: z.boolean().optional(),
        })),
    }),
]);

export const AgentCreateSessionRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空"),
    input: JsonValueSchema.optional(),
    workspaceRoot: z.string().trim().min(1).optional(),
    workspaceKey: z.string().trim().min(1).optional(),
    projectPath: z.string().trim().min(1).optional(),
    parentSessionId: AgentSessionIdSchema.optional(),
});

export const AgentInvokeRequestDtoSchema = z.object({
    mode: z.enum(["prompt", "continue", "steer", "followup"]),
    message: AgentUserMessageInputDtoSchema.optional(),
    resolution: AgentResolutionDtoSchema.optional(),
    clientState: z.lazy(() => ClientVariablesDtoSchema).optional(),
    block: z.boolean().optional(),
}).superRefine((value, ctx) => {
    if ((value.mode === "prompt" || value.mode === "steer" || value.mode === "followup") && !value.message) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: `${value.mode} 模式必须提供 message`,
        });
    }
    if (value.mode === "continue" && value.message) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: "continue 模式不能提供 message",
        });
    }
});

export const AgentSessionListQueryDtoSchema = z.object({
    workspaceKey: z.string().trim().min(1).optional(),
    includeArchived: z.coerce.boolean().optional(),
    profileGroup: z.enum(["all", "leader"]).optional(),
    status: z.enum(["all", "active", "running", "waiting", "idle", "interrupted", "archived"]).optional(),
    relation: z.enum(["all", "top", "child"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AgentSessionEventsQueryDtoSchema = z.object({
    after: z.coerce.number().int().nonnegative().optional(),
});

export const AgentCommandRequestDtoSchema = z.discriminatedUnion("command", [
    z.object({command: z.literal("new")}),
    z.object({command: z.literal("archive"), reason: z.string().optional()}),
    z.object({command: z.literal("compact"), instructions: z.string().optional()}),
    z.object({command: z.literal("plan"), active: z.boolean()}),
    z.object({command: z.literal("model"), modelKey: z.string().trim().min(1).nullable()}),
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

export type AgentSessionSummaryDto = {
    sessionId: number;
    profileKey: string;
    workspaceKey: string;
    workspaceRoot: string;
    parentSessionId?: number;
    title?: string;
    summary?: string;
    status: AgentSessionStatus;
    updatedAt: number;
    archived: boolean;
    lastMessagePreview?: string;
    usage?: Usage;
};

export type AgentSessionProfileGroup = "all" | "leader";
export type AgentSessionStatusFilter = "all" | "active" | "running" | "waiting" | "idle" | "interrupted" | "archived";
export type AgentSessionRelationFilter = "all" | "top" | "child";

export type AgentLinkedSessionDto = AgentSessionSummaryDto & {
    detached: boolean;
};

export type AgentPendingApprovalDto = {
    assistantMessageId?: string;
    toolCallId: string;
    toolName: string;
    args?: JsonValue;
    planFilePath?: string;
    planContent?: string;
};

export type AgentQueuedMessageDto = {
    id: string;
    kind: "steer" | "followup";
    message: AgentUserMessageInputDto;
    createdAt: number;
};

export type AgentFollowUpQueueItemDto = AgentQueuedMessageDto;

export type AgentActiveInvocationDto = {
    invocationId: string;
    sessionId: number;
    status: "running" | "waiting" | "aborting";
    mode: "prompt" | "continue" | "compact";
    startedAt: number;
};

export type AgentSessionControlEvent =
    | {
        type: "connected";
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
        snapshot?: AgentSessionSnapshotDto;
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
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "pi";
        event: AgentEvent;
    }
    | {
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "session";
        event: AgentSessionControlEvent;
    };

export type AgentSessionSnapshotDto = {
    summary: AgentSessionSummaryDto;
    activeLeafId: string | null;
    /** 当前 profile 的 provider 级 system prompt，用于前端只读展示；不作为普通历史消息。 */
    systemPrompt?: string;
    messages: AgentMessage[];
    tree: SessionTreeNode[];
    entries: SessionEntry[];
    linkedAgents: AgentLinkedSessionDto[];
    linkedByAgents: AgentLinkedSessionDto[];
    pendingApproval: AgentPendingApprovalDto | null;
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueItemDto[];
    activeInvocation: AgentActiveInvocationDto | null;
    model: Model<any> | null;
    planModeActive: boolean;
    lastSeq: number;
    usage?: Usage;
};
