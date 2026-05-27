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
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
} from "nbook/server/config/types";
import {ProxyAgent} from "undici";

type ResolvedDefaultModel = {
    providerId: string;
    provider: ConfiguredProviderConfig;
    model: ConfiguredModelConfig;
};

type ResolvedContextWindow = {
    tokens: number | null;
    source: "manual" | "unknown";
};

type OpenAIModelsResponse = {
    data?: Array<{
        id?: unknown;
    }>;
};

type ProviderFetchInit = RequestInit & {
    dispatcher?: ProxyAgent;
};

export type AgentProfileSettingDefinition = {
    profileKey: string;
    name: string;
};

const DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS = 30_000;

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
 * 解析模型上下文窗口。当前只信任 Global Config 中的手动配置。
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
                api: provider.api,
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
                        provider: model.provider,
                        api: model.api,
                        baseUrl: model.baseUrl,
                        reasoning: model.reasoning,
                        input: model.input,
                        maxTokens: model.maxTokens,
                        cost: model.cost,
                        compat: model.compat,
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
): {profileModelDefaults: AgentProfileModelConfig; profiles: Record<string, AgentProfileConfig>} {
    return {
        profileModelDefaults: normalizeAgentProfileModelConfig(request.profileModelDefaults),
        profiles: Object.fromEntries(
            request.agentProfiles.map((profile) => [profile.profileKey, {
                model: normalizeAgentProfileModelConfig(profile.model),
            }]),
        ),
    };
}

/**
 * 把运行时配置转成 API DTO。
 */
export function buildModelSettingsDto(appConfig: {models: ModelSettingsConfig}): ModelSettingsDto {
    const config = appConfig.models;
    const providers = Object.entries(config.providers).map(([providerId, provider]) => ({
        id: providerId,
        name: provider.name,
        api: provider.api,
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
            provider: model.provider,
            api: model.api,
            baseUrl: model.baseUrl,
            reasoning: model.reasoning,
            input: model.input,
            maxTokens: model.maxTokens,
            cost: model.cost,
            compat: model.compat,
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
    appConfig: {agent: {profileModelDefaults: AgentProfileModelConfig; profiles: Record<string, AgentProfileConfig>}; models: ModelSettingsConfig},
    profileDefinitions: AgentProfileSettingDefinition[],
): AgentProfileModelSettingsDto {
    return {
        enabledModels: listEnabledModels(appConfig.models),
        profileModelDefaults: normalizeAgentProfileModelConfig(appConfig.agent.profileModelDefaults),
        agentProfiles: profileDefinitions.map((definition): ConfiguredAgentProfileDto => ({
            profileKey: definition.profileKey,
            name: definition.name,
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
export function resolveAgentProfileModelConfig(appConfig: {agent: {profileModelDefaults?: AgentProfileModelConfig; profiles: Record<string, AgentProfileConfig>}}, profileKey: string): AgentProfileModelConfig {
    return normalizeAgentProfileModelConfig({
        ...(appConfig.agent.profileModelDefaults ?? {}),
        ...(appConfig.agent.profiles[profileKey]?.model ?? {}),
    });
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
 * 从 OpenAI-compatible `/models` 端点抓取 Provider 模型列表。
 */
export async function discoverProviderModels(providerDraft: ModelProviderDraftDto): Promise<DiscoverProviderModelsResponseDto> {
    const baseURL = providerDraft.options.baseURL.trim();
    if (!baseURL) {
        throw new Error(`${providerDraft.name} 缺少 API Base，无法查询 /models。`);
    }

    const startedAt = Date.now();
    const response = await fetchProviderModels(providerDraft, baseURL);
    const models = parseOpenAIModelsResponse(response);

    return {
        models,
        message: `已从 ${providerDraft.name} 远程发现 ${models.length} 个模型，用时 ${String(Date.now() - startedAt)}ms。`,
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
    const reasoningEffort = ThinkingLevelSchema.nullable().safeParse(config?.reasoningEffort ?? null);
    return {
        modelKey: config?.modelKey?.trim() ? config.modelKey.trim() : null,
        temperature: typeof config?.temperature === "number" && Number.isFinite(config.temperature) ? config.temperature : null,
        topK: typeof config?.topK === "number" && Number.isFinite(config.topK) ? Math.trunc(config.topK) : null,
        reasoningEffort: reasoningEffort.success ? reasoningEffort.data : null,
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

/**
 * 请求 Provider 的 OpenAI-compatible `/models` 端点。
 */
async function fetchProviderModels(providerDraft: ModelProviderDraftDto, baseURL: string): Promise<OpenAIModelsResponse> {
    const controller = new AbortController();
    const timeoutMs = providerDraft.options.timeoutMs ?? DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS;
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {
        accept: "application/json",
    };
    const apiKey = providerDraft.options.apiKey.trim();
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }

    try {
        const requestInit: ProviderFetchInit = {
            method: "GET",
            headers,
            signal: controller.signal,
            ...(providerDraft.options.proxy.trim()
                ? {dispatcher: new ProxyAgent(providerDraft.options.proxy.trim())}
                : {}),
        };
        const response = await fetch(buildModelsEndpoint(baseURL), requestInit as RequestInit);

        if (!response.ok) {
            throw new Error(`${providerDraft.name} /models 请求失败：HTTP ${String(response.status)} ${response.statusText}`);
        }

        const payload = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new Error(`${providerDraft.name} /models 返回的 JSON 不是对象。`);
        }

        return payload as OpenAIModelsResponse;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(`${providerDraft.name} /models 请求超时（${String(timeoutMs)}ms）。`);
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

/**
 * 将 API Base 规范化为 `/models` 端点。
 */
function buildModelsEndpoint(baseURL: string): string {
    return `${baseURL.replace(/\/+$/, "")}/models`;
}

/**
 * 解析 OpenAI-compatible 模型列表响应。
 */
function parseOpenAIModelsResponse(response: OpenAIModelsResponse): DiscoveredProviderModelDto[] {
    if (!Array.isArray(response.data)) {
        throw new Error("/models 返回缺少 data 数组。");
    }

    const modelsById = new Map<string, DiscoveredProviderModelDto>();
    for (const item of response.data) {
        const modelId = typeof item.id === "string" ? item.id.trim() : "";
        if (!modelId || modelsById.has(modelId)) {
            continue;
        }
        modelsById.set(modelId, {
            id: modelId,
            name: modelId,
            group: deriveModelGroup(modelId),
        });
    }

    return [...modelsById.values()].sort((left, right) => left.id.localeCompare(right.id));
}
