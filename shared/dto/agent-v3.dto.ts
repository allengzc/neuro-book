import {z} from "zod";
import type {JsonValue} from "nbook/server/agent/messages/types";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

export const AgentV3SessionIdSchema = z.number().int().positive();

export const AgentV3CreateSessionRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空"),
    input: JsonValueSchema.optional(),
    workspaceRoot: z.string().trim().min(1).optional(),
    workspaceKey: z.string().trim().min(1).optional(),
    parentSessionId: AgentV3SessionIdSchema.optional(),
});

export const AgentV3UserMessageInputDtoSchema = z.object({
    text: z.string(),
    images: z.array(z.object({
        type: z.literal("image"),
        mimeType: z.string().trim().min(1),
        data: z.string().trim().min(1),
    })).optional(),
});

export const AgentV3ResolutionDtoSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("tool_approval"),
        toolCallId: z.string().trim().min(1),
        approved: z.boolean(),
        resultText: z.string().optional(),
        data: JsonValueSchema.optional(),
    }),
    z.object({
        kind: z.literal("user_input"),
        toolCallId: z.string().trim().min(1),
        answers: z.array(z.object({
            questionIndex: z.number().int().nonnegative(),
            text: z.string(),
        })),
    }),
]);

export const AgentV3InvokeRequestDtoSchema = z.object({
    mode: z.enum(["prompt", "continue"]),
    message: AgentV3UserMessageInputDtoSchema.optional(),
    resolution: AgentV3ResolutionDtoSchema.optional(),
    block: z.boolean().optional(),
}).superRefine((value, ctx) => {
    if (value.mode === "prompt" && !value.message) {
        ctx.addIssue({
            code: "custom",
            path: ["message"],
            message: "prompt 模式必须提供 message",
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

export const AgentV3OwnerQueryDtoSchema = z.object({
    ownerSessionId: z.coerce.number().int().positive().optional(),
});

export const AgentV3DetachRequestDtoSchema = z.object({
    ownerSessionId: AgentV3SessionIdSchema.optional(),
});

export type AgentV3CreateSessionRequestDto = z.infer<typeof AgentV3CreateSessionRequestDtoSchema>;
export type AgentV3InvokeRequestDto = z.infer<typeof AgentV3InvokeRequestDtoSchema>;
export type AgentV3OwnerQueryDto = z.infer<typeof AgentV3OwnerQueryDtoSchema>;
export type AgentV3DetachRequestDto = z.infer<typeof AgentV3DetachRequestDtoSchema>;
