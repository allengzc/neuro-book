import {getModel} from "@earendil-works/pi-ai";
import type {KnownProvider, Model} from "@earendil-works/pi-ai";
import type {AgentProfileModelConfig} from "nbook/server/config/types";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import type {EffectiveConfig} from "nbook/server/config/types";

type ModelOverrideInput = Partial<AgentProfileModelConfig> & {
    model?: string | null;
};

type PiModelInput = Model<any>["input"][number];
type ResolvedPiModel = Model<any> & {
    /**
     * 本地 Global Config provider 实例 ID。允许同一个 Pi provider 添加多份连接时，
     * model.provider 仍保持 Pi provider ID，API key 必须从这个本地实例读取。
     */
    providerConfigId: string;
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const XIAOMI_TOKEN_PLAN_COMPAT: NonNullable<Model<"openai-completions">["compat"]> = {
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
};

/**
 * 将当前 effective config 的模型引用解析成 Pi Model。
 */
export function resolvePiModelFromConfig(
    config: Pick<EffectiveConfig, "agent" | "models">,
    profileKey: string,
    override?: ModelOverrideInput | null,
): ResolvedPiModel {
    const profileModelKey = config.agent.profiles[profileKey]?.model.modelKey ?? config.agent.profileModelDefaults.modelKey ?? null;
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

    const piProviderId = model.provider ?? providerId;
    const piModel = resolvePiRegistryModel(piProviderId, model.id);
    const piApi = model.api ?? provider.api ?? piModel?.api ?? "openai-completions";
    const compat = mergeModelCompat(piProviderId, piModel, model.compat as Model<any>["compat"]);
    const customCost = model.cost ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    };
    return {
        ...(piModel ?? {
            id: model.id,
            name: model.name,
            api: piApi,
            provider: piProviderId,
            baseUrl: provider.options.baseURL || model.baseUrl || "",
            reasoning: model.reasoning ?? false,
            input: [...(model.input ?? ["text"])],
            cost: customCost,
            contextWindow: model.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW,
            maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
            compat,
        }),
        api: piApi,
        id: model.id,
        name: model.name || piModel?.name || model.id,
        provider: piProviderId,
        providerConfigId: providerId,
        baseUrl: provider.options.baseURL || model.baseUrl || piModel?.baseUrl || "",
        reasoning: model.reasoning ?? piModel?.reasoning ?? false,
        input: [...(model.input ?? piModel?.input ?? ["text"])],
        cost: {
            input: model.cost?.input ?? piModel?.cost.input ?? 0,
            output: model.cost?.output ?? piModel?.cost.output ?? 0,
            cacheRead: model.cost?.cacheRead ?? piModel?.cost.cacheRead ?? 0,
            cacheWrite: model.cost?.cacheWrite ?? piModel?.cost.cacheWrite ?? 0,
        },
        contextWindow: model.contextWindowTokens ?? piModel?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: model.maxTokens ?? piModel?.maxTokens ?? DEFAULT_MAX_TOKENS,
        headers: piModel?.headers ?? {},
        compat,
    };
}

/**
 * 将 Global Config 的模型引用解析成 Pi Model。主要给测试和旧同步入口使用。
 */
export function resolvePiModel(profileKey: string, override?: ModelOverrideInput | null): ResolvedPiModel {
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
 * 按模型上的本地 provider 实例读取 API key。重复添加同一个 Pi provider 时，
 * model.provider 是 Pi provider ID，providerConfigId 才是本地配置 ID。
 */
export function resolvePiApiKeyForModelFromConfig(
    config: Pick<EffectiveConfig, "models">,
    model: Model<any>,
): string | undefined {
    const providerConfigId = typeof (model as {providerConfigId?: unknown}).providerConfigId === "string"
        ? (model as unknown as {providerConfigId: string}).providerConfigId
        : model.provider;
    return resolvePiApiKeyFromConfig(config, providerConfigId) ?? resolvePiApiKeyFromConfig(config, model.provider);
}

/**
 * 返回 Global Config 中当前模型 provider 的 API key。
 */
export function resolvePiApiKey(providerId: string): string | undefined {
    return resolvePiApiKeyFromConfig(loadGlobalEffectiveConfigSync(), providerId);
}

/**
 * 解析模型输入能力。优先使用 Pi 内置 registry；自定义 provider/model 默认只声明 text。
 */
export function resolvePiModelInputs(providerId: string, modelId: string): PiModelInput[] {
    return [...(resolvePiRegistryModel(providerId, modelId)?.input ?? ["text"])];
}

function resolvePiRegistryModel(providerId: string, modelId: string): Model<any> | undefined {
    try {
        return getModel(providerId as KnownProvider, modelId as never) as Model<any> | undefined;
    } catch {
        return undefined;
    }
}

function mergeModelCompat(
    providerId: string,
    piModel: Model<any> | undefined,
    modelCompat: Model<any>["compat"],
): Model<any>["compat"] {
    const providerCompat = providerId === "xiaomi-token-plan-cn" ? XIAOMI_TOKEN_PLAN_COMPAT : {};
    const merged = {
        ...providerCompat,
        ...(piModel?.compat ?? {}),
        ...(modelCompat ?? {}),
    };
    return Object.keys(merged).length ? merged as Model<any>["compat"] : undefined;
}
