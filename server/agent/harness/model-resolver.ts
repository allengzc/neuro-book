import type {Model} from "@earendil-works/pi-ai";
import type {AgentProfileModelConfig} from "nbook/server/config/types";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import type {EffectiveConfig} from "nbook/server/config/types";

type ModelOverrideInput = Partial<AgentProfileModelConfig> & {
    model?: string | null;
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/**
 * 将当前 effective config 的模型引用解析成 Pi Model。
 */
export function resolvePiModelFromConfig(
    config: Pick<EffectiveConfig, "agent" | "models">,
    profileKey: string,
    override?: ModelOverrideInput | null,
): Model<any> {
    const profileModelKey = config.agent.profiles[profileKey]?.model.modelKey ?? null;
    const modelKey = override?.modelKey ?? override?.model ?? profileModelKey ?? config.models.defaultModelKey;
    if (!modelKey) {
        throw new Error("配置未设置 models.default");
    }

    const [providerId, ...modelIdParts] = modelKey.split("/");
    const modelId = modelIdParts.join("/");
    if (!providerId || !modelId) {
        throw new Error(`模型 key 格式错误：${modelKey}`);
    }
    const provider = config.models.providers[providerId];
    const model = provider?.models[modelId];
    if (!provider || !model || !model.enabled) {
        throw new Error(`模型未启用或不存在：${modelKey}`);
    }

    return {
        id: model.id,
        name: model.name,
        api: resolvePiApi(provider.adapter.type),
        provider: providerId,
        baseUrl: provider.options.baseURL,
        reasoning: true,
        input: ["text", "image"],
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: model.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_TOKENS,
        headers: {},
        compat: provider.adapter.type === "openai-compatible" || provider.adapter.type === "deepseek-official"
            ? {
                requiresReasoningContentOnAssistantMessages: provider.adapter.reasoningContentReplay,
                thinkingFormat: provider.adapter.type === "deepseek-official" ? "deepseek" : "openai",
            }
            : undefined,
    };
}

/**
 * 将 Global Config 的模型引用解析成 Pi Model。主要给测试和旧同步入口使用。
 */
export function resolvePiModel(profileKey: string, override?: ModelOverrideInput | null): Model<any> {
    return resolvePiModelFromConfig(loadGlobalEffectiveConfigSync(), profileKey, override);
}

/**
 * 从 effective config 返回当前模型 provider 的 API key。
 */
export function resolvePiApiKeyFromConfig(
    config: Pick<EffectiveConfig, "models">,
    providerId: string,
): string | undefined {
    return config.models.providers[providerId]?.options.apiKey || undefined;
}

/**
 * 返回 Global Config 中当前模型 provider 的 API key。
 */
export function resolvePiApiKey(providerId: string): string | undefined {
    return resolvePiApiKeyFromConfig(loadGlobalEffectiveConfigSync(), providerId);
}

function resolvePiApi(adapterType: string): Model<any>["api"] {
    if (adapterType === "deepseek-official" || adapterType === "openai-compatible" || adapterType === "openai-official") {
        return "openai-completions";
    }
    if (adapterType === "gemini-compatible") {
        return "openai-completions";
    }
    return "openai-completions";
}
