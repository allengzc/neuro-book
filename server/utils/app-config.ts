import {readFile, writeFile} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import consola from "consola";
import * as yaml from "yaml";
import {z} from "zod";
import {ModelProviderAdapterSchema} from "nbook/shared/dto/app-settings.dto";
import {expandEnvTemplate} from "nbook/server/utils/env-template";

const ToolNameListSchema = z.array(z.string().trim().min(1)).default([]);
const ConfigTextSchema = z.string().trim().nullable().optional().transform((value) => value?.trim() ?? "");
const NullableModelKeySchema = z.string().trim().min(1).nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const NullableNumberSchema = z.number().nullable().optional().transform((value) => {
    return typeof value === "number" ? value : null;
});
const ReasoningEffortSchema = z.enum(["low", "medium", "high"]).nullable().optional().transform((value) => value ?? null);
const ContextWindowTokensSchema = z.number().int().positive().nullable().optional().transform((value) => {
    return typeof value === "number" ? value : null;
});
const ModelGroupSchema = z.string().trim().nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const RawAgentProfileModelSchema = z.object({
    modelKey: NullableModelKeySchema,
    temperature: NullableNumberSchema,
    topK: NullableNumberSchema,
    reasoningEffort: ReasoningEffortSchema,
    stream: z.boolean().optional(),
});
const RawAgentProfileSchema = z.object({
    model: RawAgentProfileModelSchema.optional(),
});
const RawConfiguredModelSchema = z.object({
    name: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    group: ModelGroupSchema,
    enabled: z.boolean().optional(),
    contextWindowTokens: ContextWindowTokensSchema,
});
const RawConfiguredProviderSchema = z.object({
    name: z.string().trim().min(1).optional(),
    adapter: ModelProviderAdapterSchema.optional(),
    options: z.object({
        apiKey: ConfigTextSchema.optional(),
        baseURL: ConfigTextSchema.optional(),
        proxy: ConfigTextSchema.optional(),
    }).optional(),
    models: z.record(z.string(), RawConfiguredModelSchema).optional(),
});
const RawAppConfigSchema = z.object({
    auth: z.object({
        enabled: z.boolean().optional(),
    }).optional(),
    agent: z.object({
        tools: z.object({
            allow: ToolNameListSchema.optional(),
            deny: ToolNameListSchema.optional(),
            whitelist: ToolNameListSchema.optional(),
            blacklist: ToolNameListSchema.optional(),
        }).optional(),
        profiles: z.record(z.string(), RawAgentProfileSchema).optional(),
    }).optional(),
    models: z.object({
        default: z.string().trim().min(1).nullable().optional(),
        providers: z.record(z.string(), RawConfiguredProviderSchema).optional(),
    }).optional(),
});

export type AgentToolAccessConfig = {
    allow: string[];
    deny: string[];
};

export type AgentProfileModelConfig = {
    modelKey: string | null;
    temperature: number | null;
    topK: number | null;
    reasoningEffort: "low" | "medium" | "high" | null;
    stream: boolean;
};

export type AgentProfileConfig = {
    model: AgentProfileModelConfig;
};

export type ModelProviderAdapter = z.infer<typeof ModelProviderAdapterSchema>;

export type ConfiguredModelConfig = {
    name: string;
    id: string;
    group: string | null;
    enabled: boolean;
    contextWindowTokens: number | null;
};

export type ModelProviderOptionsConfig = {
    apiKey: string;
    baseURL: string;
    proxy: string;
};

export type ConfiguredProviderConfig = {
    name: string;
    adapter: ModelProviderAdapter;
    options: ModelProviderOptionsConfig;
    models: Record<string, ConfiguredModelConfig>;
};

export type ModelSettingsConfig = {
    defaultModelKey: string | null;
    providers: Record<string, ConfiguredProviderConfig>;
};

export type AppConfig = {
    auth: {
        enabled: boolean;
    };
    agent: {
        tools: AgentToolAccessConfig;
        profiles: Record<string, AgentProfileConfig>;
    };
    models: ModelSettingsConfig;
};

type GlobalAppConfigCache = {
    appConfigPromise?: Promise<AppConfig>;
    appConfigSnapshot?: AppConfig;
};

const DEFAULT_MODEL_ADAPTER: ModelProviderAdapter = "openai-compatible";
const globalForAppConfig = globalThis as typeof globalThis & GlobalAppConfigCache;

/**
 * 将工具名数组标准化为去重后的有序列表。
 */
function normalizeToolNames(names: string[]): string[] {
    return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

/**
 * 规范化 group。空值统一收敛为 null。
 */
function normalizeModelGroup(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
}

/**
 * 规范化文本字段。
 */
function normalizeConfigText(value: string | null | undefined): string {
    return value?.trim() ?? "";
}

/**
 * 规范化可空数字。
 */
function normalizeNullableNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : null;
}

/**
 * 规范化单个 profile 模型配置。
 */
function normalizeAgentProfileModelConfig(input: z.infer<typeof RawAgentProfileSchema> | undefined): AgentProfileConfig {
    return {
        model: {
            modelKey: input?.model?.modelKey ?? null,
            temperature: normalizeNullableNumber(input?.model?.temperature),
            topK: normalizeNullableNumber(input?.model?.topK),
            reasoningEffort: input?.model?.reasoningEffort ?? null,
            stream: input?.model?.stream ?? true,
        },
    };
}

/**
 * 将 provider models 规范化为 Record。
 */
function normalizeProviderModels(input: Record<string, z.infer<typeof RawConfiguredModelSchema>> | undefined): Record<string, ConfiguredModelConfig> {
    if (!input) {
        return {};
    }

    const entries: Array<[string, ConfiguredModelConfig]> = [];

    for (const [modelKey, model] of Object.entries(input)) {
        const resolvedId = normalizeConfigText(model.id ?? modelKey);
        if (!resolvedId) {
            continue;
        }

        entries.push([resolvedId, {
            name: normalizeConfigText(model.name ?? resolvedId) || resolvedId,
            id: resolvedId,
            group: normalizeModelGroup(model.group),
            enabled: model.enabled ?? true,
            contextWindowTokens: normalizeNullableNumber(model.contextWindowTokens),
        }]);
    }

    return Object.fromEntries(entries.sort(([leftId], [rightId]) => leftId.localeCompare(rightId)));
}

/**
 * 解析原始配置对象为类型化配置。
 */
function parseAppConfigValue(input: unknown): AppConfig {
    const parsedConfig = RawAppConfigSchema.parse(input ?? {});
    const toolsConfig = parsedConfig.agent?.tools;
    const rawAgentProfiles = parsedConfig.agent?.profiles ?? {};
    const rawProviders = parsedConfig.models?.providers ?? {};
    const providers: Record<string, ConfiguredProviderConfig> = {};
    const agentProfiles = Object.fromEntries(
        Object.entries(rawAgentProfiles)
            .map(([profileKey, profile]) => {
                const normalizedProfileKey = normalizeConfigText(profileKey);
                if (!normalizedProfileKey) {
                    return null;
                }

                return [normalizedProfileKey, normalizeAgentProfileModelConfig(profile)] as const;
            })
            .filter((entry): entry is readonly [string, AgentProfileConfig] => entry !== null)
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    );

    for (const [providerId, provider] of Object.entries(rawProviders)) {
        const normalizedProviderId = normalizeConfigText(providerId);
        if (!normalizedProviderId) {
            continue;
        }

        providers[normalizedProviderId] = {
            name: normalizeConfigText(provider.name ?? normalizedProviderId) || normalizedProviderId,
            adapter: provider.adapter ?? DEFAULT_MODEL_ADAPTER,
            options: {
                apiKey: normalizeConfigText(provider.options?.apiKey),
                baseURL: normalizeConfigText(provider.options?.baseURL),
                proxy: normalizeConfigText(provider.options?.proxy),
            },
            models: normalizeProviderModels(provider.models),
        };
    }

    return {
        auth: {
            enabled: parsedConfig.auth?.enabled ?? true,
        },
        agent: {
            tools: {
                allow: normalizeToolNames([
                    ...(toolsConfig?.allow ?? []),
                    ...(toolsConfig?.whitelist ?? []),
                ]),
                deny: normalizeToolNames([
                    ...(toolsConfig?.deny ?? []),
                    ...(toolsConfig?.blacklist ?? []),
                ]),
            },
            profiles: agentProfiles,
        },
        models: {
            defaultModelKey: normalizeConfigText(parsedConfig.models?.default ?? undefined) || null,
            providers,
        },
    };
}

/**
 * 返回 config.yaml 绝对路径。
 */
function getAppConfigPath(): string {
    return resolve(process.cwd(), "config.yaml");
}

/**
 * 更新全局配置缓存。
 */
function setAppConfigCache(appConfig: AppConfig): AppConfig {
    globalForAppConfig.appConfigSnapshot = appConfig;
    globalForAppConfig.appConfigPromise = Promise.resolve(appConfig);
    return appConfig;
}

/**
 * 解析 config.yaml 文本，并先展开环境变量占位符。
 */
export function parseAppConfigText(rawText: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
    const expandedText = expandEnvTemplate(rawText, env);
    const parsedYaml = expandedText.trim() ? yaml.parse(expandedText) : {};
    return parseAppConfigValue(parsedYaml);
}

/**
 * 读取 config.yaml 原文。
 */
async function readAppConfigText(): Promise<string> {
    const configPath = getAppConfigPath();

    try {
        return await readFile(configPath, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        consola.warn({configPath, error: message}, "读取 config.yaml 失败，回退到默认配置");
        return "";
    }
}

/**
 * 同步读取 config.yaml 原文。
 */
function readAppConfigTextSync(): string {
    const configPath = getAppConfigPath();

    try {
        return readFileSync(configPath, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        consola.warn({configPath, error: message}, "同步读取 config.yaml 失败，回退到默认配置");
        return "";
    }
}

/**
 * 读取并解析根目录 config.yaml。
 */
export async function loadAppConfig(): Promise<AppConfig> {
    if (globalForAppConfig.appConfigSnapshot) {
        return globalForAppConfig.appConfigSnapshot;
    }

    if (!globalForAppConfig.appConfigPromise) {
        globalForAppConfig.appConfigPromise = (async () => {
            const rawText = await readAppConfigText();
            return setAppConfigCache(parseAppConfigText(rawText));
        })();
    }

    return globalForAppConfig.appConfigPromise;
}

/**
 * 同步读取并解析根目录 config.yaml。
 */
export function loadAppConfigSync(): AppConfig {
    if (globalForAppConfig.appConfigSnapshot) {
        return globalForAppConfig.appConfigSnapshot;
    }

    const rawText = readAppConfigTextSync();
    return setAppConfigCache(parseAppConfigText(rawText));
}

/**
 * 清空缓存，供测试或特殊场景显式重载配置。
 */
export function resetAppConfigCache(): void {
    globalForAppConfig.appConfigSnapshot = undefined;
    globalForAppConfig.appConfigPromise = undefined;
}

/**
 * 把模型设定转成适合写入 YAML 的普通对象。
 */
function serializeModelSettings(config: ModelSettingsConfig): {
    default?: string;
    providers: Record<string, {
        name: string;
        adapter: ModelProviderAdapter;
        options: ModelProviderOptionsConfig;
        models: Record<string, ConfiguredModelConfig>;
    }>;
} {
    const providers = Object.fromEntries(
        Object.entries(config.providers).map(([providerId, provider]) => {
            const models = Object.fromEntries(
                Object.values(provider.models).map((model) => [model.id, {
                    name: model.name,
                    id: model.id,
                    group: normalizeModelGroup(model.group),
                    enabled: model.enabled,
                    contextWindowTokens: normalizeNullableNumber(model.contextWindowTokens),
                }]),
            );

            return [providerId, {
                name: provider.name,
                adapter: provider.adapter,
                options: {
                    apiKey: normalizeConfigText(provider.options.apiKey),
                    baseURL: normalizeConfigText(provider.options.baseURL),
                    proxy: normalizeConfigText(provider.options.proxy),
                },
                models,
            }];
        }),
    );

    return {
        ...(config.defaultModelKey ? {default: config.defaultModelKey} : {}),
        providers,
    };
}

/**
 * 把 profile 模型配置转成适合写入 YAML 的普通对象。
 */
function serializeAgentProfiles(config: Record<string, AgentProfileConfig>): Record<string, {
    model: AgentProfileModelConfig;
}> {
    return Object.fromEntries(
        Object.entries(config).map(([profileKey, profile]) => [profileKey, {
            model: {
                modelKey: profile.model.modelKey,
                temperature: normalizeNullableNumber(profile.model.temperature),
                topK: normalizeNullableNumber(profile.model.topK),
                reasoningEffort: profile.model.reasoningEffort,
                stream: profile.model.stream,
            },
        }]),
    );
}

/**
 * 更新 agent tools allow / deny 配置，并写回 config.yaml。
 */
export async function saveAgentToolAccessConfig(config: AgentToolAccessConfig): Promise<AppConfig> {
    const configPath = getAppConfigPath();
    const rawText = await readAppConfigText();
    const document = yaml.parseDocument(rawText.trim() ? rawText : "{}", {
        keepSourceTokens: true,
    });
    const nextConfig = {
        allow: normalizeToolNames(config.allow),
        deny: normalizeToolNames(config.deny),
    };

    document.setIn(["agent", "tools", "allow"], nextConfig.allow);
    document.setIn(["agent", "tools", "deny"], nextConfig.deny);
    document.deleteIn(["agent", "tools", "whitelist"]);
    document.deleteIn(["agent", "tools", "blacklist"]);

    const nextText = String(document);
    await writeFile(configPath, nextText.endsWith("\n") ? nextText : `${nextText}\n`, "utf8");

    return setAppConfigCache(parseAppConfigValue(document.toJS()));
}

/**
 * 更新 models 配置，并写回 config.yaml。
 */
export async function saveModelSettingsConfig(config: ModelSettingsConfig): Promise<AppConfig> {
    const configPath = getAppConfigPath();
    const rawText = await readAppConfigText();
    const document = yaml.parseDocument(rawText.trim() ? rawText : "{}", {
        keepSourceTokens: true,
    });
    const nextModels = serializeModelSettings({
        defaultModelKey: config.defaultModelKey,
        providers: Object.fromEntries(
            Object.entries(config.providers).map(([providerId, provider]) => [providerId, {
                ...provider,
                options: {
                    apiKey: normalizeConfigText(provider.options.apiKey),
                    baseURL: normalizeConfigText(provider.options.baseURL),
                    proxy: normalizeConfigText(provider.options.proxy),
                },
                models: Object.fromEntries(
                    Object.values(provider.models).map((model) => [model.id, {
                        name: normalizeConfigText(model.name) || model.id,
                        id: model.id,
                        group: normalizeModelGroup(model.group),
                        enabled: model.enabled,
                        contextWindowTokens: normalizeNullableNumber(model.contextWindowTokens),
                    }]),
                ),
            }]),
        ),
    });

    document.setIn(["models", "providers"], nextModels.providers);
    if (nextModels.default) {
        document.setIn(["models", "default"], nextModels.default);
    } else {
        document.deleteIn(["models", "default"]);
    }

    const nextText = String(document);
    await writeFile(configPath, nextText.endsWith("\n") ? nextText : `${nextText}\n`, "utf8");

    return setAppConfigCache(parseAppConfigValue(document.toJS()));
}

/**
 * 更新 agent profile 模型配置，并写回 config.yaml。
 */
export async function saveAgentProfileSettingsConfig(config: Record<string, AgentProfileConfig>): Promise<AppConfig> {
    const configPath = getAppConfigPath();
    const rawText = await readAppConfigText();
    const document = yaml.parseDocument(rawText.trim() ? rawText : "{}", {
        keepSourceTokens: true,
    });
    const nextAgentProfiles = serializeAgentProfiles(config);

    document.setIn(["agent", "profiles"], nextAgentProfiles);

    const nextText = String(document);
    await writeFile(configPath, nextText.endsWith("\n") ? nextText : `${nextText}\n`, "utf8");

    return setAppConfigCache(parseAppConfigValue(document.toJS()));
}

/**
 * 基于 allow/deny 名单过滤工具名。
 */
export function resolveEnabledToolNames(allToolNames: string[], config: AgentToolAccessConfig): string[] {
    const allowSet = new Set(config.allow);
    const denySet = new Set(config.deny);
    const hasAllowList = allowSet.size > 0;

    return allToolNames.filter((toolName) => {
        if (denySet.has(toolName)) {
            return false;
        }
        if (!hasAllowList) {
            return true;
        }
        return allowSet.has(toolName);
    });
}
