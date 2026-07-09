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
import {getModel, getModels, streamSimple} from "@earendil-works/pi-ai";
import type {KnownProvider, Model} from "@earendil-works/pi-ai";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
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
type PiModelInput = Model<any>["input"][number];
type ConfigModelInput = "text" | "image";

type OpenAIModelsResponse = {
    data?: Array<{
        id?: unknown;
    }>;
};

type ProviderFetchInit = RequestInit & {
    dispatcher?: ProxyAgent;
};

type ModelHealthCheckOptions = {
    signal?: AbortSignal;
};

export type AgentProfileSettingDefinition = {
    profileKey: string;
    name: string;
};

const DEFAULT_MODEL_DISCOVERY_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL_SMOKE_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 256_000;
const DEFAULT_MAX_TOKENS = 256_000;
export const MODEL_SMOKE_CHECK_PROMPTS = [
    "随便想一个问题，然后用一句话自己回答。",
    "用一句话解释一个常见自然现象。",
    "给出一个两步以内的小计划。",
    "用一句话总结今天适合做的一件小事。",
    "提出一个简单判断题，并直接给出答案。",
] as const;
const XIAOMI_TOKEN_PLAN_COMPAT: NonNullable<Model<"openai-completions">["compat"]> = {
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
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
                enabled: provider.enabled,
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
                settings: {},
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
        enabled: provider.enabled,
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
        if (!provider.enabled) {
            continue;
        }
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
    if (!provider || !provider.enabled || !model || !model.enabled) {
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
 * 对 Provider 进行 Pi smoke 连通性测试。
 */
export async function checkProviderConnection(
    providerDraft: ModelProviderDraftDto,
    modelDrafts?: Array<Omit<ConfiguredModelDto, "enabled">>,
): Promise<CheckProviderResponseDto> {
    const modelDraft = modelDrafts === undefined
        ? firstPiRegistryModelAsDraft(providerDraft.id)
        : modelDrafts[0] ?? null;
    if (!modelDraft) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 没有可检查的模型；请先启用或添加一个模型。`,
        };
    }

    return runPiModelSmokeCheck(providerDraft, modelDraft, "provider");
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
 * 对单个模型执行 Pi smoke 健康检查。
 */
export async function checkModelHealth(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
    options: ModelHealthCheckOptions = {},
): Promise<CheckModelResponseDto> {
    return runPiModelSmokeCheck(providerDraft, modelDraft, "model", options);
}

/**
 * 从固定 smoke prompt 列表中随机抽取一个检查问题。
 */
export function pickModelSmokeCheckPrompt(random = Math.random): string {
    const index = Math.floor(random() * MODEL_SMOKE_CHECK_PROMPTS.length);
    return MODEL_SMOKE_CHECK_PROMPTS[Math.min(Math.max(index, 0), MODEL_SMOKE_CHECK_PROMPTS.length - 1)] ?? MODEL_SMOKE_CHECK_PROMPTS[0];
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
 * 设置页不会回传已保存的 secret；检查类接口在后端补齐旧 key。
 */
export function withSavedProviderApiKey(providerDraft: ModelProviderDraftDto, savedApiKey: string | undefined): ModelProviderDraftDto {
    if (providerDraft.options.apiKey.trim() || !savedApiKey) {
        return providerDraft;
    }
    return {
        ...providerDraft,
        options: {
            ...providerDraft.options,
            apiKey: savedApiKey,
        },
    };
}

async function runPiModelSmokeCheck(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
    scope: "provider" | "model",
    options: ModelHealthCheckOptions = {},
): Promise<CheckModelResponseDto> {
    if (providerDraft.options.proxy.trim()) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 已配置代理，但 Pi 检查暂不支持通过 Provider 代理发起请求；请先使用 Agent smoke 或移除代理后再检查。`,
        };
    }

    const apiKey = providerDraft.options.apiKey.trim();
    if (!apiKey) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 缺少 API Key，无法执行 Pi 检查。`,
        };
    }

    if (options.signal?.aborted) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name}/${modelDraft.id} 检查已取消。`,
        };
    }

    const model = resolvePiModelForDraft(providerDraft, modelDraft);
    const startedAt = Date.now();
    try {
        const stream = streamSimple(model, {
            systemPrompt: "You are a concise connectivity smoke test assistant.",
            messages: [createUserMessage({text: pickModelSmokeCheckPrompt()})],
            tools: [],
        }, {
            apiKey,
            timeoutMs: providerDraft.options.timeoutMs ?? DEFAULT_MODEL_SMOKE_TIMEOUT_MS,
            maxTokens: Math.min(96, model.maxTokens),
            reasoning: undefined,
            ...piSmokeRequestOptions(providerDraft.options.requestOptions),
            cacheRetention: "none",
            signal: options.signal,
        });
        const response = await stream.result();
        const latencyMs = Date.now() - startedAt;
        if (options.signal?.aborted || response.stopReason === "aborted") {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查已取消。`,
            };
        }
        if (response.stopReason === "error") {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查失败：${sanitizeProviderError(response.errorMessage || "provider 未返回错误详情")}`,
            };
        }
        return {
            success: true,
            latencyMs,
            message: scope === "provider"
                ? `${providerDraft.name} Pi 检查通过：${model.id}，用时 ${String(latencyMs)}ms。`
                : `${providerDraft.name}/${model.id} Pi 检查通过，用时 ${String(latencyMs)}ms。`,
        };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (options.signal?.aborted || isAbortError(error)) {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查已取消。`,
            };
        }
        return {
            success: false,
            latencyMs,
            message: `${providerDraft.name}/${model.id} 检查失败：${sanitizeProviderError(error instanceof Error ? error.message : String(error))}`,
        };
    }
}

/**
 * 判断 Provider SDK 抛出的错误是否来自 AbortSignal。
 */
function isAbortError(error: unknown): boolean {
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    const name = typeof error === "object" && error !== null && "name" in error
        ? (error as {name?: unknown}).name
        : null;
    return name === "AbortError";
}

function resolvePiModelForDraft(providerDraft: ModelProviderDraftDto, modelDraft: Omit<ConfiguredModelDto, "enabled">): Model<any> {
    const piProviderId = modelDraft.provider ?? providerDraft.id;
    const piModel = resolvePiRegistryModel(piProviderId, modelDraft.id);
    const api = modelDraft.api ?? providerDraft.api ?? piModel?.api ?? "openai-completions";
    const compat = {
        ...(piProviderId === "xiaomi-token-plan-cn" ? XIAOMI_TOKEN_PLAN_COMPAT : {}),
        ...(piModel?.compat ?? {}),
        ...(modelDraft.compat ?? {}),
    } as Model<any>["compat"];
    return {
        ...(piModel ?? {
            id: modelDraft.id,
            name: modelDraft.name,
            api,
            provider: piProviderId,
            baseUrl: providerDraft.options.baseURL || modelDraft.baseUrl || "",
            reasoning: modelDraft.reasoning ?? false,
            input: normalizePiModelInput(modelDraft.input),
            cost: modelDraft.cost ?? {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
            },
            contextWindow: modelDraft.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW,
            maxTokens: modelDraft.maxTokens ?? DEFAULT_MAX_TOKENS,
            compat,
        }),
        id: modelDraft.id,
        name: modelDraft.name || piModel?.name || modelDraft.id,
        api,
        provider: piProviderId,
        baseUrl: providerDraft.options.baseURL || modelDraft.baseUrl || piModel?.baseUrl || "",
        reasoning: modelDraft.reasoning ?? piModel?.reasoning ?? false,
        input: normalizePiModelInput(modelDraft.input ?? piModel?.input ?? ["text"]),
        cost: {
            input: modelDraft.cost?.input ?? piModel?.cost.input ?? 0,
            output: modelDraft.cost?.output ?? piModel?.cost.output ?? 0,
            cacheRead: modelDraft.cost?.cacheRead ?? piModel?.cost.cacheRead ?? 0,
            cacheWrite: modelDraft.cost?.cacheWrite ?? piModel?.cost.cacheWrite ?? 0,
        },
        contextWindow: modelDraft.contextWindowTokens ?? piModel?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: modelDraft.maxTokens ?? piModel?.maxTokens ?? DEFAULT_MAX_TOKENS,
        headers: piModel?.headers ?? {},
        compat,
    };
}

function firstPiRegistryModelAsDraft(providerId: string): Omit<ConfiguredModelDto, "enabled"> | null {
    const model = resolvePiProviderModels(providerId)[0];
    if (!model) {
        return null;
    }
    return {
        name: model.name,
        id: model.id,
        group: deriveModelGroup(model.id),
        provider: model.provider,
        api: model.api,
        baseUrl: model.baseUrl,
        reasoning: model.reasoning,
        input: [...model.input],
        maxTokens: model.maxTokens,
        cost: model.cost,
        compat: normalizePiModelCompat(model.compat),
        contextWindowTokens: model.contextWindow,
    };
}

function piSmokeRequestOptions(requestOptions: Record<string, JsonValue> | undefined): Record<string, unknown> {
    if (!requestOptions) {
        return {};
    }
    const allowedKeys = new Set(["headers", "maxRetries", "maxRetryDelayMs", "metadata", "transport", "cacheRetention"]);
    return Object.fromEntries(
        Object.entries(requestOptions).filter(([key]) => allowedKeys.has(key)),
    );
}

function sanitizeProviderError(message: string): string {
    const normalized = message
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
        .replace(/sk-[A-Za-z0-9._-]{8,}/gi, "sk-[redacted]")
        .trim();
    return normalized.length > 320 ? `${normalized.slice(0, 320)}...` : normalized;
}

function normalizePiModelCompat(compat: Model<any>["compat"]): Record<string, JsonValue> | null {
    if (!compat || typeof compat !== "object" || Array.isArray(compat)) {
        return null;
    }
    return Object.fromEntries(
        Object.entries(compat).filter((entry): entry is [string, JsonValue] => isJsonValue(entry[1])),
    );
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value === "object") {
        return Object.values(value).every(isJsonValue);
    }
    return false;
}

function normalizePiModelInput(input: ConfigModelInput[] | PiModelInput[] | null | undefined): PiModelInput[] {
    const values = [...new Set((input ?? ["text"]).filter((item): item is PiModelInput => item === "text" || item === "image"))];
    return values.length > 0 ? values : ["text"];
}

function resolvePiProviderModels(providerId: string): Model<any>[] {
    try {
        return getModels(providerId as KnownProvider) as Model<any>[];
    } catch {
        return [];
    }
}

function resolvePiRegistryModel(providerId: string, modelId: string): Model<any> | undefined {
    try {
        return getModel(providerId as KnownProvider, modelId as never) as Model<any> | undefined;
    } catch {
        return undefined;
    }
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
