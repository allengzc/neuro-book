import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";
import {ModelProviderAdapterSchema} from "nbook/shared/dto/app-settings.dto";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    EffectiveConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
    StoredGlobalConfig,
    StoredAgentProfileConfig,
    StoredProjectConfig,
    StoredProviderConfig,
} from "nbook/server/config/types";
import type {JsonValue} from "nbook/server/agent/messages/types";

const DEFAULT_THEME: EffectiveConfig["ui"]["theme"] = "sepia";

/**
 * 创建完整的默认 effective config。
 */
export function createDefaultEffectiveConfig(): EffectiveConfig {
    return {
        auth: {
            enabled: true,
        },
        models: {
            defaultModelKey: null,
            providers: {},
        },
        agent: {
            defaultProfileKey: {
                novel: null,
                userAssets: null,
            },
            profiles: {},
        },
        ui: {
            theme: DEFAULT_THEME,
        },
        editor: {
            markdown: {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES},
            monaco: {...DEFAULT_MONACO_EDITOR_PREFERENCES},
        },
    };
}

/**
 * 把 Global Config 文件对象规范化，避免缺失字段泄漏到运行时。
 */
export function normalizeGlobalConfig(input: Partial<StoredGlobalConfig> | null | undefined): StoredGlobalConfig {
    const raw = input && typeof input === "object" ? input : {};
    return {
        ...raw,
        auth: {
            enabled: raw.auth?.enabled ?? true,
        },
        models: {
            default: normalizeNullableModelKey(raw.models?.default),
            providers: normalizeStoredProviders(raw.models?.providers),
        },
        agent: {
            defaultProfileKey: {
                novel: normalizeNullableModelKey(raw.agent?.defaultProfileKey?.novel),
                userAssets: normalizeNullableModelKey(raw.agent?.defaultProfileKey?.userAssets),
            },
            profiles: normalizeCompleteAgentProfiles(raw.agent?.profiles),
        },
        ui: {
            theme: normalizeTheme(raw.ui?.theme),
        },
        editor: {
            markdown: normalizeMarkdownPreferences(raw.editor?.markdown),
            monaco: normalizeMonacoPreferences(raw.editor?.monaco),
        },
    };
}

/**
 * 把 Project Config 文件对象规范化。这里只保留允许覆盖的字段。
 */
export function normalizeProjectConfig(input: Partial<StoredProjectConfig> | null | undefined): StoredProjectConfig {
    const raw = input && typeof input === "object" ? input : {};
    return {
        ...raw,
        ...(raw.models ? {
            models: {
                default: normalizeNullableModelKey(raw.models.default),
            },
        } : {}),
        ...(raw.agent ? {
            agent: {
                defaultProfileKey: normalizeNullableModelKey(raw.agent.defaultProfileKey),
                profiles: raw.agent.profiles ? normalizeAgentProfiles(raw.agent.profiles) : undefined,
            },
        } : {}),
        ...(raw.editor ? {
            editor: {
                markdown: raw.editor.markdown ? normalizeMarkdownPreferences(raw.editor.markdown) : undefined,
                monaco: raw.editor.monaco ? normalizeMonacoPreferences(raw.editor.monaco) : undefined,
            },
        } : {}),
    };
}

/**
 * 将 Global + Project 合并为业务运行使用的 effective config。
 */
export function resolveEffectiveConfig(globalConfig: StoredGlobalConfig, projectConfig: StoredProjectConfig | null): EffectiveConfig {
    const effective = createDefaultEffectiveConfig();

    effective.auth.enabled = globalConfig.auth?.enabled ?? effective.auth.enabled;
    effective.models = normalizeModelSettings(globalConfig.models);
    effective.agent.defaultProfileKey = {
        novel: normalizeNullableModelKey(globalConfig.agent?.defaultProfileKey?.novel),
        userAssets: normalizeNullableModelKey(globalConfig.agent?.defaultProfileKey?.userAssets),
    };
    effective.agent.profiles = normalizeCompleteAgentProfiles(globalConfig.agent?.profiles);
    effective.ui.theme = normalizeTheme(globalConfig.ui?.theme);
    effective.editor.markdown = normalizeMarkdownPreferences(globalConfig.editor?.markdown);
    effective.editor.monaco = normalizeMonacoPreferences(globalConfig.editor?.monaco);

    if (!projectConfig) {
        return effective;
    }

    if (projectConfig.models && Object.hasOwn(projectConfig.models, "default") && projectConfig.models.default !== null) {
        effective.models.defaultModelKey = normalizeNullableModelKey(projectConfig.models.default);
    }
    if (projectConfig.agent && Object.hasOwn(projectConfig.agent, "defaultProfileKey") && projectConfig.agent.defaultProfileKey !== null) {
        effective.agent.defaultProfileKey.novel = normalizeNullableModelKey(projectConfig.agent.defaultProfileKey);
    }
    if (projectConfig.agent?.profiles) {
        const projectProfiles = normalizeAgentProfiles(projectConfig.agent.profiles);
        effective.agent.profiles = Object.fromEntries(
            [...new Set([...Object.keys(effective.agent.profiles), ...Object.keys(projectProfiles)])]
                .map((profileKey) => [profileKey, {
                    model: normalizeAgentProfileModelConfig({
                        ...(effective.agent.profiles[profileKey]?.model ?? {}),
                        ...(projectProfiles[profileKey]?.model ?? {}),
                    }),
                } satisfies AgentProfileConfig]),
        );
    }
    if (projectConfig.editor?.markdown) {
        effective.editor.markdown = {
            ...effective.editor.markdown,
            ...normalizeMarkdownPreferences(projectConfig.editor.markdown),
        };
    }
    if (projectConfig.editor?.monaco) {
        effective.editor.monaco = {
            ...effective.editor.monaco,
            ...normalizeMonacoPreferences(projectConfig.editor.monaco),
        };
    }

    return effective;
}

/**
 * 规范化 Provider 列表为运行时 Record。
 */
export function normalizeModelSettings(input: StoredGlobalConfig["models"] | undefined): ModelSettingsConfig {
    return {
        defaultModelKey: normalizeNullableModelKey(input?.default),
        providers: Object.fromEntries(
            normalizeStoredProviders(input?.providers).map((provider) => [provider.id, {
                name: normalizeText(provider.name) || provider.id,
                adapter: ModelProviderAdapterSchema.parse(provider.adapter),
                options: normalizeProviderOptions(provider.options),
                models: Object.fromEntries(provider.models.map((model) => [model.id, normalizeModel(model)])),
            } satisfies ConfiguredProviderConfig]),
        ),
    };
}

/**
 * 把运行时 ModelSettings 写回 Global Config 的数组结构。
 */
export function serializeModelSettings(config: ModelSettingsConfig): StoredGlobalConfig["models"] {
    return {
        default: config.defaultModelKey,
        providers: Object.entries(config.providers)
            .map(([providerId, provider]) => ({
                id: providerId,
                name: provider.name,
                adapter: provider.adapter,
                options: provider.options,
                models: Object.values(provider.models)
                    .map((model) => ({...model}))
                    .sort((left, right) => left.id.localeCompare(right.id)),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
    };
}

/**
 * 规范化 profile 模型配置。
 */
export function normalizeAgentProfileModelConfig(input: Partial<AgentProfileModelConfig> | undefined): AgentProfileModelConfig {
    return {
        modelKey: normalizeNullableModelKey(input?.modelKey),
        temperature: normalizeNullableNumber(input?.temperature),
        topK: normalizeNullableInteger(input?.topK),
        reasoningEffort: input?.reasoningEffort === "low" || input?.reasoningEffort === "medium" || input?.reasoningEffort === "high" ? input.reasoningEffort : null,
        stream: input?.stream ?? true,
    };
}

/**
 * 规范化 profile 配置 map。
 */
export function normalizeAgentProfiles(input: Record<string, Partial<StoredAgentProfileConfig>> | undefined): Record<string, StoredAgentProfileConfig> {
    if (!input) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(input)
            .map(([profileKey, profile]) => {
                const key = normalizeText(profileKey);
                if (!key) {
                    return null;
                }
                return [key, {
                    model: normalizeAgentProfileModelPatch(profile.model),
                }] as const;
            })
            .filter((entry): entry is readonly [string, StoredAgentProfileConfig] => entry !== null)
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    );
}

function normalizeCompleteAgentProfiles(input: Record<string, Partial<StoredAgentProfileConfig>> | undefined): Record<string, AgentProfileConfig> {
    return Object.fromEntries(
        Object.entries(normalizeAgentProfiles(input)).map(([profileKey, profile]) => [profileKey, {
            model: normalizeAgentProfileModelConfig(profile.model),
        } satisfies AgentProfileConfig]),
    );
}

function normalizeAgentProfileModelPatch(input: Partial<AgentProfileModelConfig> | undefined): Partial<AgentProfileModelConfig> {
    if (!input) {
        return {};
    }
    return {
        ...(Object.hasOwn(input, "modelKey") ? {modelKey: normalizeNullableModelKey(input.modelKey)} : {}),
        ...(Object.hasOwn(input, "temperature") ? {temperature: normalizeNullableNumber(input.temperature)} : {}),
        ...(Object.hasOwn(input, "topK") ? {topK: normalizeNullableInteger(input.topK)} : {}),
        ...(Object.hasOwn(input, "reasoningEffort") ? {reasoningEffort: input.reasoningEffort === "low" || input.reasoningEffort === "medium" || input.reasoningEffort === "high" ? input.reasoningEffort : null} : {}),
        ...(Object.hasOwn(input, "stream") ? {stream: input.stream ?? true} : {}),
    };
}

function normalizeStoredProviders(input: StoredProviderConfig[] | undefined): StoredProviderConfig[] {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .map((provider) => ({
            id: normalizeText(provider.id),
            name: normalizeText(provider.name),
            adapter: ModelProviderAdapterSchema.parse(provider.adapter ?? "openai-compatible"),
            options: normalizeProviderOptions(provider.options),
            models: Array.isArray(provider.models) ? provider.models.map(normalizeModel) : [],
        }))
        .filter((provider) => provider.id)
        .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeModel(input: Partial<ConfiguredModelConfig>): ConfiguredModelConfig {
    const id = normalizeText(input.id);
    return {
        name: normalizeText(input.name) || id,
        id,
        group: normalizeNullableText(input.group),
        enabled: input.enabled ?? true,
        contextWindowTokens: normalizeNullableInteger(input.contextWindowTokens),
    };
}

function normalizeProviderOptions(input: Partial<ModelProviderOptionsConfig> | undefined): ModelProviderOptionsConfig {
    return {
        apiKey: normalizeText(input?.apiKey),
        baseURL: normalizeText(input?.baseURL),
        proxy: normalizeText(input?.proxy),
        timeoutMs: normalizeNullableInteger(input?.timeoutMs),
        requestOptions: normalizeJsonRecord(input?.requestOptions),
    };
}

function normalizeMarkdownPreferences(input: Partial<MarkdownEditorPreferences> | undefined): MarkdownEditorPreferences {
    return {
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        ...(input ?? {}),
    };
}

function normalizeMonacoPreferences(input: Partial<MonacoEditorPreferences> | undefined): MonacoEditorPreferences {
    return {
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
        ...(input ?? {}),
    };
}

function normalizeTheme(input: unknown): EffectiveConfig["ui"]["theme"] {
    return input === "light" || input === "dark" || input === "sepia" ? input : DEFAULT_THEME;
}

function normalizeText(input: unknown): string {
    return typeof input === "string" ? input.trim() : "";
}

function normalizeNullableText(input: unknown): string | null {
    const text = normalizeText(input);
    return text || null;
}

function normalizeNullableModelKey(input: unknown): string | null {
    return normalizeNullableText(input);
}

function normalizeNullableNumber(input: unknown): number | null {
    return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function normalizeNullableInteger(input: unknown): number | null {
    const value = normalizeNullableNumber(input);
    return value === null ? null : Math.trunc(value);
}

function normalizeJsonRecord(input: unknown): Record<string, JsonValue> {
    return input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, JsonValue>
        : {};
}
