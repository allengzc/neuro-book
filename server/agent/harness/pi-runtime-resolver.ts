import {
    createModels,
    createProvider,
    envApiKeyAuth,
    hasApi,
    lazyApi,
} from "@earendil-works/pi-ai";
import type {Api, Models, Model, ProviderStreams} from "@earendil-works/pi-ai";
import {builtinModels} from "@earendil-works/pi-ai/providers/all";
import type {EffectiveConfig} from "nbook/server/config/types";

export const SUPPORTED_CUSTOM_PI_APIS = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
    "bedrock-converse-stream",
] as const;

export type SupportedCustomPiApi = typeof SUPPORTED_CUSTOM_PI_APIS[number];

const BUILTIN_MODELS = builtinModels();
const CUSTOM_API_STREAMS = {
    "openai-completions": lazyApi(() => import("@earendil-works/pi-ai/api/openai-completions")),
    "openai-responses": lazyApi(() => import("@earendil-works/pi-ai/api/openai-responses")),
    "anthropic-messages": lazyApi(() => import("@earendil-works/pi-ai/api/anthropic-messages")),
    "google-generative-ai": lazyApi(() => import("@earendil-works/pi-ai/api/google-generative-ai")),
    "bedrock-converse-stream": lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream")),
} satisfies Record<SupportedCustomPiApi, ProviderStreams>;

/**
 * 判断配置值是否属于 NeuroBook 明确支持的自定义 Pi API adapter。
 */
export function isSupportedCustomPiApi(api: string): api is SupportedCustomPiApi {
    return SUPPORTED_CUSTOM_PI_APIS.some((supported) => supported === api);
}

/**
 * 为当前冻结配置和已解析模型选择 Pi runtime。
 *
 * 内置 Provider 共用进程级 Models；显式 API override、未知 Provider 或内置 Provider
 * 无法执行的 API 使用独立 Models，避免同类本地连接共享可变 Provider 状态。
 */
export function resolvePiModelsFromConfig(
    config: Pick<EffectiveConfig, "models">,
    model: Model<Api>,
): Models {
    if (!isCustomPiRuntimeFromConfig(config, model)) {
        return BUILTIN_MODELS;
    }
    if (!isSupportedCustomPiApi(model.api)) {
        throw new Error(`不支持的 Pi API：${model.api}`);
    }

    if (hasApi(model, "openai-completions")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["openai-completions"]);
    }
    if (hasApi(model, "openai-responses")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["openai-responses"]);
    }
    if (hasApi(model, "anthropic-messages")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["anthropic-messages"]);
    }
    if (hasApi(model, "google-generative-ai")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["google-generative-ai"]);
    }
    if (hasApi(model, "bedrock-converse-stream")) {
        return createCustomModels(model, CUSTOM_API_STREAMS["bedrock-converse-stream"]);
    }
    throw new Error(`不支持的 Pi API：${model.api}`);
}

/**
 * 判断当前 resolved model 是否必须使用 invocation 私有 runtime。
 */
export function isCustomPiRuntimeFromConfig(
    config: Pick<EffectiveConfig, "models">,
    model: Model<Api>,
): boolean {
    const providerConfigId = resolveProviderConfigId(model);
    const providerConfig = config.models.providers[providerConfigId];
    const modelConfig = providerConfig?.models[model.id];
    const hasExplicitApiOverride = Boolean(modelConfig?.api || providerConfig?.api);
    const builtinProvider = BUILTIN_MODELS.getProvider(model.provider);
    const builtinSupportsApi = builtinProvider?.getModels().some((item) => item.api === model.api) === true;
    return providerConfigId !== model.provider || hasExplicitApiOverride || !builtinProvider || !builtinSupportsApi;
}

/**
 * 创建只服务当前 invocation 的自定义 Provider runtime。
 */
function createCustomModels<TApi extends SupportedCustomPiApi>(model: Model<TApi>, streams: ProviderStreams): Models {
    const models = createModels();
    models.setProvider(createProvider({
        id: model.provider,
        name: model.provider,
        baseUrl: model.baseUrl,
        headers: model.headers,
        auth: {apiKey: envApiKeyAuth(`${model.provider} API key`, [])},
        models: [model],
        api: streams,
    }));
    return models;
}

/**
 * 读取 resolved model 上的本地 Provider 配置身份。
 */
function resolveProviderConfigId(model: Model<Api>): string {
    return "providerConfigId" in model && typeof model.providerConfigId === "string"
        ? model.providerConfigId
        : model.provider;
}
