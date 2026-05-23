import * as yaml from "yaml";
import {expandEnvTemplate} from "nbook/server/utils/env-template";
import {
    loadEffectiveConfig,
    loadGlobalEffectiveConfigSync,
    saveAgentProfileSettings,
    saveModelSettings,
} from "nbook/server/config/config-service";
import {
    normalizeAgentProfiles,
    normalizeGlobalConfig,
    resolveEffectiveConfig,
} from "nbook/server/config/normalizer";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    EffectiveConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
    StoredGlobalConfig,
    StoredProviderConfig,
} from "nbook/server/config/types";

export type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
};

export type AgentToolAccessConfig = {
    allow: string[];
    deny: string[];
};

export type AppConfig = EffectiveConfig & {
    agent: EffectiveConfig["agent"] & {
        tools: AgentToolAccessConfig;
    };
};

/**
 * 解析旧 config.yaml 文本。保留给旧测试和迁移脚本使用；运行时真值源已迁到 Global Config JSON。
 */
export function parseAppConfigText(rawText: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
    const expandedText = expandEnvTemplate(rawText, env);
    const parsedYaml = expandedText.trim() ? yaml.parse(expandedText) as unknown : {};
    return withLegacyTools(resolveEffectiveConfig(normalizeGlobalConfig(normalizeLegacyConfig(parsedYaml)), null));
}

/**
 * 异步读取最新 effective config。默认读取 Workspace Root `.nbook/config.json`。
 */
export async function loadAppConfig(): Promise<AppConfig> {
    return withLegacyTools(await loadEffectiveConfig({workspaceKind: "user-assets"}));
}

/**
 * 同步读取 Global Config。用于 auth middleware 这类同步路径。
 */
export function loadAppConfigSync(): AppConfig {
    return withLegacyTools(loadGlobalEffectiveConfigSync());
}

/**
 * 旧缓存接口已无状态化，保留空实现避免测试辅助漂移。
 */
export function resetAppConfigCache(): void {}

/**
 * 保存模型设置到 Global Config。
 */
export async function saveModelSettingsConfig(config: ModelSettingsConfig): Promise<AppConfig> {
    await saveModelSettings(config, {workspaceKind: "user-assets"});
    return loadAppConfig();
}

/**
 * 保存 Agent Profile 模型设置到 Global Config。
 */
export async function saveAgentProfileSettingsConfig(config: Record<string, AgentProfileConfig>): Promise<AppConfig> {
    await saveAgentProfileSettings(normalizeAgentProfiles(config), {workspaceKind: "user-assets"});
    return loadAppConfig();
}

/**
 * 全局工具 allow/deny 已删除。调用方应改用 profile allowedToolKeys。
 */
export async function saveAgentToolAccessConfig(): Promise<AppConfig> {
    throw new Error("agent.tools.allow/deny 已删除，请使用 profile allowedToolKeys。");
}

/**
 * 全局工具 allow/deny 已删除；保留原函数签名时直接返回原始工具集合。
 */
export function resolveEnabledToolNames(allToolNames: string[]): string[] {
    return [...allToolNames];
}

function withLegacyTools(config: EffectiveConfig): AppConfig {
    return {
        ...config,
        agent: {
            ...config.agent,
            tools: {
                allow: [],
                deny: [],
            },
        },
    };
}

/**
 * 兼容旧 config.yaml 的 provider/model map 形态，新 Global Config 文件仍只写数组形态。
 */
function normalizeLegacyConfig(input: unknown): Partial<StoredGlobalConfig> {
    if (!isRecord(input)) {
        return {};
    }

    const output = {...input} as Partial<StoredGlobalConfig>;
    const models = isRecord(input.models) ? input.models : null;
    if (models) {
        output.models = {
            ...(models as Partial<NonNullable<StoredGlobalConfig["models"]>>),
            providers: normalizeLegacyProviders(models.providers),
        };
    }

    return output;
}

function normalizeLegacyProviders(input: unknown): StoredProviderConfig[] | undefined {
    if (Array.isArray(input)) {
        return input as StoredProviderConfig[];
    }
    if (!isRecord(input)) {
        return undefined;
    }

    return Object.entries(input).map(([providerId, rawProvider]) => {
        const provider = isRecord(rawProvider) ? rawProvider : {};
        return {
            id: providerId,
            name: typeof provider.name === "string" ? provider.name : providerId,
            adapter: provider.adapter ?? "openai-compatible",
            options: isRecord(provider.options) ? provider.options : {},
            models: normalizeLegacyModels(provider.models),
        } as StoredProviderConfig;
    });
}

function normalizeLegacyModels(input: unknown): ConfiguredModelConfig[] {
    if (Array.isArray(input)) {
        return input as ConfiguredModelConfig[];
    }
    if (!isRecord(input)) {
        return [];
    }

    return Object.entries(input).map(([modelId, rawModel]) => {
        const model = isRecord(rawModel) ? rawModel : {};
        return {
            id: typeof model.id === "string" ? model.id : modelId,
            name: typeof model.name === "string" ? model.name : modelId,
            group: typeof model.group === "string" ? model.group : null,
            enabled: typeof model.enabled === "boolean" ? model.enabled : true,
            contextWindowTokens: typeof model.contextWindowTokens === "number" ? model.contextWindowTokens : null,
        };
    });
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}
