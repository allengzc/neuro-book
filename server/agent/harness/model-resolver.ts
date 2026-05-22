import type {Model} from "@earendil-works/pi-ai";
import {loadAppConfigSync} from "nbook/server/utils/app-config";
import type {AgentProfileModelConfig} from "nbook/server/utils/app-config";

type ModelOverrideInput = Partial<AgentProfileModelConfig> & {
    model?: string | null;
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/**
 * 将 config.yaml 的模型引用解析成 Pi Model。
 */
export function resolvePiModel(profileKey: string, override?: ModelOverrideInput | null): Model<any> {
    const appConfig = loadAppConfigSync();
    const profileModelKey = appConfig.agent.profiles[profileKey]?.model.modelKey ?? null;
    const modelKey = override?.modelKey ?? override?.model ?? profileModelKey ?? appConfig.models.defaultModelKey;
    if (!modelKey) {
        throw new Error("config.yaml 未配置 models.default");
    }

    const [providerId, ...modelIdParts] = modelKey.split("/");
    const modelId = modelIdParts.join("/");
    if (!providerId || !modelId) {
        throw new Error(`模型 key 格式错误：${modelKey}`);
    }
    const provider = appConfig.models.providers[providerId];
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
 * 返回当前模型 provider 的 API key。
 */
export function resolvePiApiKey(providerId: string): string | undefined {
    const appConfig = loadAppConfigSync();
    return appConfig.models.providers[providerId]?.options.apiKey || undefined;
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
