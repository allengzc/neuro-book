import {z} from "zod";

const ProviderIdSchema = z.string().trim().min(1, "providerId 不能为空").regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "providerId 格式不合法");
const ModelIdSchema = z.string().trim().min(1, "modelId 不能为空");
const NullableTextSchema = z.string().trim().nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const ProviderOptionTextSchema = z.string().trim().default("");
const ProviderTimeoutMsSchema = z.number().int("timeoutMs 必须是整数").positive("timeoutMs 必须大于 0").nullable().default(null);
const ProviderRequestOptionsSchema = z.record(z.string(), z.json()).default({});
const DefaultModelKeySchema = z.string().trim().min(1, "默认模型不能为空").nullable().default(null);
const AgentProfileKeySchema = z.string().trim().min(1, "profileKey 不能为空");
const TemperatureSchema = z.number().nonnegative("temperature 不能小于 0").nullable().default(null);
const TopKSchema = z.number().int("topK 必须是整数").positive("topK 必须大于 0").nullable().default(null);
const ContextWindowTokensSchema = z.number().int("contextWindowTokens 必须是整数").positive("contextWindowTokens 必须大于 0").nullable().default(null);
export const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);
const ReasoningEffortSchema = ThinkingLevelSchema.nullable().default(null);
const ModelInputKindSchema = z.enum(["text", "image"]);
const PiModelApiSchema = z.string().trim().min(1, "api 不能为空").nullable().default(null);
const PiModelBaseUrlSchema = NullableTextSchema;
const PiModelInputSchema = z.array(ModelInputKindSchema).min(1, "input 至少需要声明一种输入类型").nullable().default(null);
const PiModelReasoningSchema = z.boolean().nullable().default(null);
const PiModelMaxTokensSchema = z.number().int("maxTokens 必须是整数").positive("maxTokens 必须大于 0").nullable().default(null);
const PiModelCostObjectSchema = z.object({
    input: z.number().default(0),
    output: z.number().default(0),
    cacheRead: z.number().default(0),
    cacheWrite: z.number().default(0),
});
const PiModelCostSchema = PiModelCostObjectSchema.nullable().default(null);
const PiModelCompatSchema = z.record(z.string(), z.json()).nullable().default(null);

/**
 * Provider 连接配置。
 */
export const ModelProviderOptionsDtoSchema = z.object({
    apiKey: ProviderOptionTextSchema,
    baseURL: ProviderOptionTextSchema,
    proxy: ProviderOptionTextSchema,
    timeoutMs: ProviderTimeoutMsSchema,
    requestOptions: ProviderRequestOptionsSchema,
});

/**
 * 单个已配置模型。
 */
export const ConfiguredModelDtoSchema = z.object({
    name: z.string().trim().min(1, "模型名称不能为空"),
    id: ModelIdSchema,
    group: NullableTextSchema,
    enabled: z.boolean().default(true),
    /**
     * 为空表示继承 Pi 内置 registry；自定义模型可显式声明 Pi Model 字段。
     */
    provider: NullableTextSchema,
    api: PiModelApiSchema,
    baseUrl: PiModelBaseUrlSchema,
    reasoning: PiModelReasoningSchema,
    input: PiModelInputSchema,
    maxTokens: PiModelMaxTokensSchema,
    cost: PiModelCostSchema,
    compat: PiModelCompatSchema,
    contextWindowTokens: ContextWindowTokensSchema,
});

/**
 * 单个已配置 Provider。
 */
export const ConfiguredProviderDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1, "Provider 名称不能为空"),
    enabled: z.boolean().default(true),
    /**
     * Provider 下模型的默认 Pi API adapter。模型级 api 为空时继承此值。
     */
    api: PiModelApiSchema,
    options: ModelProviderOptionsDtoSchema,
    models: z.array(ConfiguredModelDtoSchema).default([]),
});

/**
 * 启用模型选项。
 */
export const EnabledModelOptionDtoSchema = z.object({
    key: z.string().trim().min(1, "模型 key 不能为空"),
    label: z.string().trim().min(1, "模型标签不能为空"),
    providerId: ProviderIdSchema,
    modelId: ModelIdSchema,
    contextWindowTokens: ContextWindowTokensSchema,
});

/**
 * Agent Profile 模型配置。
 */
export const AgentProfileModelConfigDtoSchema = z.object({
    modelKey: DefaultModelKeySchema,
    temperature: TemperatureSchema,
    topK: TopKSchema,
    reasoningEffort: ReasoningEffortSchema,
    stream: z.boolean().default(true),
});

/**
 * 单个 Agent Profile 设定。
 */
export const ConfiguredAgentProfileDtoSchema = z.object({
    profileKey: AgentProfileKeySchema,
    name: z.string().trim().min(1, "Profile 名称不能为空"),
    model: AgentProfileModelConfigDtoSchema,
});

/**
 * 模型设定响应。
 */
export const ModelSettingsDtoSchema = z.object({
    defaultModelKey: DefaultModelKeySchema,
    /**
     * 为空表示当前没有可用默认模型。
     */
    defaultModelLabel: z.string().trim().nullable().default(null),
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    providers: z.array(ConfiguredProviderDtoSchema).default([]),
});

/**
 * 更新模型设定请求。
 */
export const UpdateModelSettingsRequestDtoSchema = z.object({
    defaultModelKey: DefaultModelKeySchema,
    providers: z.array(ConfiguredProviderDtoSchema).default([]),
}).superRefine((value, ctx) => {
    const providerIdSet = new Set<string>();
    const enabledModelKeys = new Set<string>();

    for (const provider of value.providers) {
        if (providerIdSet.has(provider.id)) {
            ctx.addIssue({
                code: "custom",
                path: ["providers"],
                message: `provider ${provider.id} 重复`,
            });
            return;
        }
        providerIdSet.add(provider.id);

        const modelIdSet = new Set<string>();
        for (const model of provider.models) {
            if (modelIdSet.has(model.id)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["providers"],
                    message: `provider ${provider.id} 下存在重复模型 ${model.id}`,
                });
                return;
            }
            modelIdSet.add(model.id);

            if (provider.enabled && model.enabled) {
                enabledModelKeys.add(`${provider.id}/${model.id}`);
            }
        }
    }

    if (enabledModelKeys.size === 0) {
        if (value.defaultModelKey !== null) {
            ctx.addIssue({
                code: "custom",
                path: ["defaultModelKey"],
                message: "当前没有启用模型时，默认模型必须为空",
            });
        }
        return;
    }

    if (value.defaultModelKey === null) {
        ctx.addIssue({
            code: "custom",
            path: ["defaultModelKey"],
            message: "存在启用模型时，必须指定默认模型",
        });
        return;
    }

    if (!enabledModelKeys.has(value.defaultModelKey)) {
        ctx.addIssue({
            code: "custom",
            path: ["defaultModelKey"],
            message: "默认模型必须指向一个已启用模型",
        });
    }
});

/**
 * Agent Profile 模型设定响应。
 */
export const AgentProfileModelSettingsDtoSchema = z.object({
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    profileModelDefaults: AgentProfileModelConfigDtoSchema,
    agentProfiles: z.array(ConfiguredAgentProfileDtoSchema).default([]),
});

/**
 * 更新 Agent Profile 模型设定请求。
 */
export const UpdateAgentProfileModelSettingsRequestDtoSchema = z.object({
    profileModelDefaults: AgentProfileModelConfigDtoSchema,
    agentProfiles: z.array(ConfiguredAgentProfileDtoSchema).default([]),
}).superRefine((value, ctx) => {
    const profileKeySet = new Set<string>();

    for (const profile of value.agentProfiles) {
        if (profileKeySet.has(profile.profileKey)) {
            ctx.addIssue({
                code: "custom",
                path: ["agentProfiles"],
                message: `profile ${profile.profileKey} 重复`,
            });
            return;
        }
        profileKeySet.add(profile.profileKey);
    }
});

/**
 * Provider 草稿，请求连通性测试与远程模型发现时使用。
 */
export const ModelProviderDraftDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1, "Provider 名称不能为空"),
    api: PiModelApiSchema,
    options: ModelProviderOptionsDtoSchema,
});

/**
 * 远程发现到的 Provider 模型。
 */
export const DiscoveredProviderModelDtoSchema = z.object({
    id: ModelIdSchema,
    name: z.string().trim().min(1, "模型名称不能为空"),
    group: NullableTextSchema,
});

/**
 * Provider 连通性测试请求。
 */
export const CheckProviderRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    models: z.array(ConfiguredModelDtoSchema.omit({
        enabled: true,
    })).default([]),
    useSavedApiKey: z.boolean().default(true),
    useSavedModels: z.boolean().default(true),
});

/**
 * Provider 连通性测试响应。
 */
export const CheckProviderResponseDtoSchema = z.object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().trim().min(1),
});

/**
 * Provider 远程模型发现请求。
 */
export const DiscoverProviderModelsRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
});

/**
 * Provider 远程模型发现响应。
 */
export const DiscoverProviderModelsResponseDtoSchema = z.object({
    models: z.array(DiscoveredProviderModelDtoSchema).default([]),
    message: z.string().trim().min(1),
});

/**
 * 单模型健康检查请求。
 */
export const CheckModelRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    model: ConfiguredModelDtoSchema.omit({
        enabled: true,
    }),
    useSavedApiKey: z.boolean().default(true),
});

/**
 * 单模型健康检查响应。
 */
export const CheckModelResponseDtoSchema = z.object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().trim().min(1),
});

/**
 * Pi 内置模型目录。前端用它把 provider/model 添加到 Global Config。
 */
export const PiBuiltinModelDtoSchema = z.object({
    id: ModelIdSchema,
    name: z.string().trim().min(1),
    api: z.string().trim().min(1),
    provider: ProviderIdSchema,
    baseUrl: z.string().trim(),
    reasoning: z.boolean(),
    thinkingLevelMap: z.record(z.string(), z.string().nullable()).nullable().default(null),
    input: z.array(ModelInputKindSchema).min(1),
    cost: PiModelCostObjectSchema,
    contextWindowTokens: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    compat: PiModelCompatSchema,
});

/**
 * Pi 内置 Provider 目录项。
 */
export const PiBuiltinProviderDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1),
    baseUrl: z.string().trim(),
    models: z.array(PiBuiltinModelDtoSchema).default([]),
});

/**
 * Pi 内置 Provider/Model 目录响应。
 */
export const PiBuiltinCatalogDtoSchema = z.object({
    providers: z.array(PiBuiltinProviderDtoSchema).default([]),
});

export type ModelInputKind = z.infer<typeof ModelInputKindSchema>;
export type ThinkingLevelDto = z.infer<typeof ThinkingLevelSchema>;
export type ModelProviderOptionsDto = z.infer<typeof ModelProviderOptionsDtoSchema>;
export type ConfiguredModelDto = z.infer<typeof ConfiguredModelDtoSchema>;
export type ConfiguredProviderDto = z.infer<typeof ConfiguredProviderDtoSchema>;
export type EnabledModelOptionDto = z.infer<typeof EnabledModelOptionDtoSchema>;
export type AgentProfileModelConfigDto = z.infer<typeof AgentProfileModelConfigDtoSchema>;
export type ConfiguredAgentProfileDto = z.infer<typeof ConfiguredAgentProfileDtoSchema>;
export type ModelSettingsDto = z.infer<typeof ModelSettingsDtoSchema>;
export type UpdateModelSettingsRequestDto = z.infer<typeof UpdateModelSettingsRequestDtoSchema>;
export type AgentProfileModelSettingsDto = z.infer<typeof AgentProfileModelSettingsDtoSchema>;
export type UpdateAgentProfileModelSettingsRequestDto = z.infer<typeof UpdateAgentProfileModelSettingsRequestDtoSchema>;
export type ModelProviderDraftDto = z.infer<typeof ModelProviderDraftDtoSchema>;
export type DiscoveredProviderModelDto = z.infer<typeof DiscoveredProviderModelDtoSchema>;
export type CheckProviderRequestDto = z.infer<typeof CheckProviderRequestDtoSchema>;
export type CheckProviderResponseDto = z.infer<typeof CheckProviderResponseDtoSchema>;
export type DiscoverProviderModelsRequestDto = z.infer<typeof DiscoverProviderModelsRequestDtoSchema>;
export type DiscoverProviderModelsResponseDto = z.infer<typeof DiscoverProviderModelsResponseDtoSchema>;
export type CheckModelRequestDto = z.infer<typeof CheckModelRequestDtoSchema>;
export type CheckModelResponseDto = z.infer<typeof CheckModelResponseDtoSchema>;
export type PiBuiltinModelDto = z.infer<typeof PiBuiltinModelDtoSchema>;
export type PiBuiltinProviderDto = z.infer<typeof PiBuiltinProviderDtoSchema>;
export type PiBuiltinCatalogDto = z.infer<typeof PiBuiltinCatalogDtoSchema>;
