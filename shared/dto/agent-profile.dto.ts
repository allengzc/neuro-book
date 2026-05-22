import {z} from "zod";
import {
    ProfileTemplateIssueDtoSchema,
    ProfileTemplateNodeDtoSchema,
    ProfileTemplateVariableGroupDtoSchema,
    type ProfileTemplateIssueDto,
    type ProfileTemplateNodeDto,
    type ProfileTemplateVariableGroupDto,
} from "nbook/shared/dto/profile-template.dto";

export const AgentProfileSourceSchema = z.enum(["system", "user", "contract"]);
export const AgentProfileKindSchema = z.enum(["leader", "subagent", "agent"]);
export const AgentProfileLoadStatusSchema = z.enum(["loaded", "error", "missing"]);
export const AgentProfileOverrideStateSchema = z.enum(["system", "user_override", "user_only", "contract_only"]);
export const AgentProfileSchemaEditModeSchema = z.enum(["locked", "source", "unavailable"]);
export const AgentProfileSchemaBuilderTypeSchema = z.enum(["object", "string", "number", "boolean", "enum", "array"]);
export type AgentProfileSchemaJsonValue = z.infer<ReturnType<typeof z.json>>;

export type AgentProfileSchemaFieldDto = {
    name: string;
    type: z.infer<typeof AgentProfileSchemaBuilderTypeSchema>;
    required: boolean;
    description?: string;
    defaultValue?: AgentProfileSchemaJsonValue;
    enumValues?: string[];
    item?: AgentProfileSchemaFieldDto;
    fields?: AgentProfileSchemaFieldDto[];
};

export const AgentProfileSchemaFieldDtoSchema: z.ZodType<AgentProfileSchemaFieldDto> = z.lazy(() => z.object({
    name: z.string().trim().min(1),
    type: AgentProfileSchemaBuilderTypeSchema,
    required: z.boolean(),
    description: z.string().trim().min(1).optional(),
    defaultValue: z.json().optional(),
    enumValues: z.array(z.string().trim().min(1)).optional(),
    item: AgentProfileSchemaFieldDtoSchema.optional(),
    fields: z.array(AgentProfileSchemaFieldDtoSchema).optional(),
}));

/**
 * profile 加载、解析与预览统一问题结构。
 */
export const AgentProfileIssueDtoSchema = ProfileTemplateIssueDtoSchema.extend({
    code: z.string().trim().min(1).optional(),
    profileKey: z.string().trim().min(1).optional(),
    fileName: z.string().trim().min(1).optional(),
    /**
     * 仅开发环境返回，用于定位动态 TSX 编译/运行错误。
     */
    stack: z.string().optional(),
});

/**
 * profile 模块 manifest 摘要。
 */
export const AgentProfileManifestDtoSchema = z.object({
    key: z.string().trim().min(1),
    kind: AgentProfileKindSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable(),
});

/**
 * profile catalog 列表项。
 */
export const AgentProfileCatalogItemDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    kind: AgentProfileKindSchema.nullable(),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable(),
    fileName: z.string().trim().min(1).nullable(),
    source: AgentProfileSourceSchema,
    overrideState: AgentProfileOverrideStateSchema,
    loadStatus: AgentProfileLoadStatusSchema,
    schemaLocked: z.boolean(),
    canEdit: z.boolean(),
    canRestore: z.boolean(),
    issues: z.array(AgentProfileIssueDtoSchema),
});

/**
 * profile schema 在源码中的可编辑状态。
 */
export const AgentProfileSchemaDetailDtoSchema = z.object({
    jsonSchema: z.record(z.string(), z.json()).nullable(),
    editMode: AgentProfileSchemaEditModeSchema,
    reason: z.string().trim().min(1),
    sourceRange: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
    }).nullable(),
});

/**
 * profile 详情请求。
 */
export const AgentProfileDetailRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1).optional(),
    fileName: z.string().trim().min(1).optional(),
}).refine((value) => Boolean(value.profileKey || value.fileName), {
    message: "profileKey 和 fileName 至少提供一个",
});

/**
 * 更新用户 profile schema 声明请求。
 */
export const UpdateAgentProfileSchemaRequestDtoSchema = z.object({
    fileName: z.string().trim().min(1),
    schemaName: z.enum(["InputSchema", "OutputSchema"]),
    fields: z.array(AgentProfileSchemaFieldDtoSchema),
});

/**
 * profile 详情。
 */
export const AgentProfileDetailDtoSchema = z.object({
    catalogItem: AgentProfileCatalogItemDtoSchema,
    manifest: AgentProfileManifestDtoSchema.nullable(),
    fileName: z.string().trim().min(1).nullable(),
    source: z.string(),
    root: ProfileTemplateNodeDtoSchema.nullable(),
    issues: z.array(AgentProfileIssueDtoSchema),
    variables: z.array(ProfileTemplateVariableGroupDtoSchema),
    allowedToolKeys: z.array(z.string()),
    inputSchema: AgentProfileSchemaDetailDtoSchema,
    outputSchema: AgentProfileSchemaDetailDtoSchema,
});

/**
 * 真实 profile.prepare 预览请求。
 */
export const AgentProfilePreparePreviewRequestDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    /**
     * 完整 input JSON。未提供时服务端会根据 inputOverrides 做一次最小构造。
     */
    input: z.json().optional(),
    sessionId: z.string().trim().min(1).optional(),
    inputOverrides: z.record(z.string(), z.string()).optional(),
    historyMessages: z.array(z.object({
        role: z.enum(["system", "human", "assistant"]),
        text: z.string(),
    })).optional(),
});

/**
 * 真实 profile.prepare 预览结果。
 */
export const AgentProfilePreparePreviewDtoSchema = z.object({
    profileKey: z.string().trim().min(1),
    ok: z.boolean(),
    issues: z.array(AgentProfileIssueDtoSchema),
    messages: z.array(z.object({
        role: z.string().trim().min(1),
        text: z.string(),
        source: z.string().trim().min(1).nullable(),
        toolCalls: z.array(z.object({
            id: z.string().trim().min(1),
            name: z.string().trim().min(1),
            argsText: z.string(),
        })).optional(),
    })),
    persistedMessageCount: z.number().int().nonnegative(),
    variables: z.array(ProfileTemplateVariableGroupDtoSchema),
});

export type AgentProfileIssueDto = ProfileTemplateIssueDto & z.infer<typeof AgentProfileIssueDtoSchema>;
export type AgentProfileCatalogItemDto = z.infer<typeof AgentProfileCatalogItemDtoSchema>;
export type AgentProfileManifestDto = z.infer<typeof AgentProfileManifestDtoSchema>;
export type AgentProfileSchemaDetailDto = z.infer<typeof AgentProfileSchemaDetailDtoSchema>;
export type AgentProfileDetailRequestDto = z.infer<typeof AgentProfileDetailRequestDtoSchema>;
export type AgentProfileSchemaBuilderType = z.infer<typeof AgentProfileSchemaBuilderTypeSchema>;
export type UpdateAgentProfileSchemaRequestDto = z.infer<typeof UpdateAgentProfileSchemaRequestDtoSchema>;
export type AgentProfileDetailDto = Omit<z.infer<typeof AgentProfileDetailDtoSchema>, "root" | "issues" | "variables"> & {
    root: ProfileTemplateNodeDto | null;
    issues: AgentProfileIssueDto[];
    variables: ProfileTemplateVariableGroupDto[];
};
export type AgentProfilePreparePreviewRequestDto = z.infer<typeof AgentProfilePreparePreviewRequestDtoSchema>;
export type AgentProfilePreparePreviewDto = z.infer<typeof AgentProfilePreparePreviewDtoSchema>;
