import type {
    AgentProfileModelConfigDto,
    AgentProfileModelSettingsDto,
    CheckModelResponseDto,
    CheckProviderResponseDto,
    ConfiguredAgentProfileDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    DiscoveredProviderModelDto,
    EnabledModelOptionDto,
    ModelProviderDraftDto,
    ModelSettingsDto,
    UpdateAgentProfileModelSettingsRequestDto,
    UpdateModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    AppConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
} from "nbook/server/utils/app-config";

type ResolvedDefaultModel = {
    providerId: string;
    provider: ConfiguredProviderConfig;
    model: ConfiguredModelConfig;
};

type ResolvedContextWindow = {
    tokens: number | null;
    source: "manual" | "unknown";
};

export type AgentProfileSettingDefinition = {
    profileKey: string;
    name: string;
    kind: "leader" | "subagent";
};

/**
 * 生成 `providerId/modelId` 形式的模型 key。
 */
export function buildModelKey(providerId: string, modelId: string): string {
    return `${providerId}/${modelId}`;
}

/**
 * 从模型 ID 推导默认分组。
 */
export function deriveModelGroup(modelId: string): string {
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId) {
        return "default";
    }

    const separatorIndex = trimmedModelId.indexOf("-");
    return separatorIndex <= 0 ? trimmedModelId : trimmedModelId.slice(0, separatorIndex);
}

/**
 * 构造模型展示名。
 */
export function buildModelLabel(providerName: string, modelName: string): string {
    return `${providerName} / ${modelName}`;
}

/**
 * 解析模型上下文窗口。当前只信任 config.yaml 的手动配置。
 */
export function resolveModelContextWindow(model: Pick<ConfiguredModelConfig, "contextWindowTokens">): ResolvedContextWindow {
    if (typeof model.contextWindowTokens === "number" && Number.isFinite(model.contextWindowTokens)) {
        return {
            tokens: Math.trunc(model.contextWindowTokens),
            source: "manual",
        };
    }

    return {
        tokens: null,
        source: "unknown",
    };
}

/**
 * 把 DTO 请求体转成运行时配置结构。
 */
export function convertModelSettingsRequestToConfig(request: UpdateModelSettingsRequestDto): ModelSettingsConfig {
    return {
        defaultModelKey: request.defaultModelKey,
        providers: Object.fromEntries(
            request.providers.map((provider) => [provider.id, {
                name: provider.name,
                adapter: provider.adapter,
                options: {
                    apiKey: provider.options.apiKey.trim(),
                    baseURL: provider.options.baseURL.trim(),
                    proxy: provider.options.proxy.trim(),
                    timeoutMs: provider.options.timeoutMs,
                    requestOptions: provider.options.requestOptions,
                },
                models: Object.fromEntries(
                    provider.models.map((model) => [model.id, {
                        name: model.name.trim(),
                        id: model.id.trim(),
                        group: model.group?.trim() ? model.group.trim() : null,
                        enabled: model.enabled,
                        contextWindowTokens: model.contextWindowTokens,
                    }]),
                ),
            }]),
        ),
    };
}

/**
 * 把 Agent Profile DTO 请求体转成运行时配置结构。
 */
export function convertAgentProfileModelSettingsRequestToConfig(
    request: UpdateAgentProfileModelSettingsRequestDto,
): Record<string, AgentProfileConfig> {
    return Object.fromEntries(
        request.agentProfiles.map((profile) => [profile.profileKey, {
            model: normalizeAgentProfileModelConfig(profile.model),
        }]),
    );
}

/**
 * 把运行时配置转成 API DTO。
 */
export function buildModelSettingsDto(appConfig: Pick<AppConfig, "models">): ModelSettingsDto {
    const config = appConfig.models;
    const providers = Object.entries(config.providers).map(([providerId, provider]) => ({
        id: providerId,
        name: provider.name,
        adapter: provider.adapter,
        options: {
            apiKey: provider.options.apiKey,
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: provider.options.timeoutMs,
            requestOptions: provider.options.requestOptions,
        },
        models: Object.values(provider.models).map((model) => ({
            name: model.name,
            id: model.id,
            group: model.group,
            enabled: model.enabled,
            contextWindowTokens: model.contextWindowTokens,
        })).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const defaultModel = resolveDefaultModel(config);

    return {
        defaultModelKey: config.defaultModelKey,
        defaultModelLabel: defaultModel ? buildModelLabel(defaultModel.provider.name, defaultModel.model.name) : null,
        enabledModels: listEnabledModels(config),
        providers,
    };
}

/**
 * 把 Agent Profile 配置转成 API DTO。
 */
export function buildAgentProfileModelSettingsDto(
    appConfig: Pick<AppConfig, "agent" | "models">,
    profileDefinitions: AgentProfileSettingDefinition[],
): AgentProfileModelSettingsDto {
    return {
        enabledModels: listEnabledModels(appConfig.models),
        agentProfiles: profileDefinitions.map((definition): ConfiguredAgentProfileDto => ({
            profileKey: definition.profileKey,
            name: definition.name,
            kind: definition.kind,
            model: resolveAgentProfileModelConfig(appConfig, definition.profileKey),
        })),
    };
}

/**
 * 列出所有启用模型，供前端默认模型选择器使用。
 */
export function listEnabledModels(config: ModelSettingsConfig): EnabledModelOptionDto[] {
    const enabledModels: EnabledModelOptionDto[] = [];

    for (const [providerId, provider] of Object.entries(config.providers)) {
        for (const model of Object.values(provider.models)) {
            if (!model.enabled) {
                continue;
            }

            enabledModels.push({
                key: buildModelKey(providerId, model.id),
                label: buildModelLabel(provider.name, model.name),
                providerId,
                modelId: model.id,
                contextWindowTokens: resolveModelContextWindow(model).tokens,
            });
        }
    }

    return enabledModels.sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * 解析指定模型 key。
 */
export function resolveConfiguredModel(config: ModelSettingsConfig, modelKey: string | null | undefined): ResolvedDefaultModel | null {
    const normalizedModelKey = modelKey?.trim() ?? "";
    if (!normalizedModelKey) {
        return null;
    }

    const separatorIndex = normalizedModelKey.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === normalizedModelKey.length - 1) {
        return null;
    }

    const providerId = normalizedModelKey.slice(0, separatorIndex);
    const modelId = normalizedModelKey.slice(separatorIndex + 1);
    const provider = config.providers[providerId];
    const model = provider?.models[modelId];
    if (!provider || !model || !model.enabled) {
        return null;
    }

    return {
        providerId,
        provider,
        model,
    };
}

/**
 * 解析默认模型指向的 provider / model。
 */
export function resolveDefaultModel(config: ModelSettingsConfig): ResolvedDefaultModel | null {
    return resolveConfiguredModel(config, config.defaultModelKey);
}

/**
 * 解析单个 profile 的模型配置。
 */
export function resolveAgentProfileModelConfig(appConfig: Pick<AppConfig, "agent">, profileKey: string): AgentProfileModelConfig {
    return normalizeAgentProfileModelConfig(appConfig.agent.profiles[profileKey]?.model);
}

/**
 * 对 Provider 进行连通性测试。真实请求迁移到 Pi provider 后再恢复。
 */
export async function checkProviderConnection(providerDraft: ModelProviderDraftDto): Promise<CheckProviderResponseDto> {
    return {
        success: false,
        latencyMs: null,
        message: `${providerDraft.name} 的旧 LangChain 连通性测试已移除；请使用 Agent smoke 或后续 Pi provider 检查入口。`,
    };
}

/**
 * 从远端抓取 Provider 模型列表。第一版只保留空结果，避免继续依赖 LangChain provider。
 */
export async function discoverProviderModels(providerDraft: ModelProviderDraftDto): Promise<DiscoverProviderModelsResponseDto> {
    return {
        models: [],
        message: `${providerDraft.name} 的远程模型发现已等待迁移到 Pi provider。`,
    };
}

/**
 * 对单个模型执行健康检查。真实请求迁移到 Pi provider 后再恢复。
 */
export async function checkModelHealth(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
): Promise<CheckModelResponseDto> {
    return {
        success: false,
        latencyMs: null,
        message: `${providerDraft.name}/${modelDraft.id} 的旧 LangChain 健康检查已移除；请使用 Agent smoke 或后续 Pi provider 检查入口。`,
    };
}

/**
 * 归一化 profile 模型配置。
 */
function normalizeAgentProfileModelConfig(config: Partial<AgentProfileModelConfigDto> | AgentProfileModelConfig | undefined): AgentProfileModelConfig {
    return {
        modelKey: config?.modelKey?.trim() ? config.modelKey.trim() : null,
        temperature: typeof config?.temperature === "number" && Number.isFinite(config.temperature) ? config.temperature : null,
        topK: typeof config?.topK === "number" && Number.isFinite(config.topK) ? Math.trunc(config.topK) : null,
        reasoningEffort: config?.reasoningEffort ?? null,
        stream: config?.stream ?? true,
    };
}

/**
 * 规范化 provider options，保留类型引用，避免旧导出消费者漂移。
 */
export function normalizeModelProviderOptions(options: ModelProviderOptionsConfig): ModelProviderOptionsConfig {
    return {
        apiKey: options.apiKey.trim(),
        baseURL: options.baseURL.trim(),
        proxy: options.proxy.trim(),
        timeoutMs: options.timeoutMs,
        requestOptions: options.requestOptions,
    };
}
