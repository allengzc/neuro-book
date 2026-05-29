import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";
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
    StoredWebSettingsConfig,
    WebSearchProviderKey,
    WebSettingsConfig,
} from "nbook/server/config/types";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";

const DEFAULT_THEME: EffectiveConfig["ui"]["theme"] = "sepia";
const DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS: AgentProfileModelConfig = {
    modelKey: null,
    temperature: null,
    topK: null,
    reasoningEffort: "off",
    stream: true,
};
const DEFAULT_WEB_SETTINGS: WebSettingsConfig = {
    search: {
        order: ["tavily", "brave"],
        providers: {
            tavily: {
                enabled: false,
                apiKey: "",
                timeoutMs: 15_000,
            },
            brave: {
                enabled: false,
                apiKey: "",
                country: "US",
                searchLang: "en",
                timeoutMs: 15_000,
            },
        },
    },
    fetch: {
        local: {
            enabled: true,
            timeoutMs: 15_000,
            maxRedirects: 5,
            maxBytes: 2_000_000,
            maxCharacters: 20_000,
            minCharactersForLocal: 300,
        },
        tavilyFallback: {
            enabled: false,
            timeoutMs: 20_000,
        },
    },
};

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
            profileModelDefaults: {...DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS},
            profiles: {},
        },
        ui: {
            theme: DEFAULT_THEME,
        },
        editor: {
            markdown: {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES},
            monaco: {...DEFAULT_MONACO_EDITOR_PREFERENCES},
        },
        web: normalizeWebSettings(undefined),
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
            profileModelDefaults: normalizeAgentProfileModelPatch(raw.agent?.profileModelDefaults),
            profiles: normalizeAgentProfiles(raw.agent?.profiles),
        },
        ui: {
            theme: normalizeTheme(raw.ui?.theme),
        },
        editor: {
            markdown: normalizeMarkdownPreferences(raw.editor?.markdown),
            monaco: normalizeMonacoPreferences(raw.editor?.monaco),
        },
        web: normalizeStoredWebSettings(raw.web),
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
                profileModelDefaults: raw.agent.profileModelDefaults ? normalizeAgentProfileModelPatch(raw.agent.profileModelDefaults) : undefined,
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
    const globalProfilePatches = normalizeAgentProfiles(globalConfig.agent?.profiles);

    effective.auth.enabled = globalConfig.auth?.enabled ?? effective.auth.enabled;
    effective.models = normalizeModelSettings(globalConfig.models);
    effective.agent.defaultProfileKey = {
        novel: normalizeNullableModelKey(globalConfig.agent?.defaultProfileKey?.novel),
        userAssets: normalizeNullableModelKey(globalConfig.agent?.defaultProfileKey?.userAssets),
    };
    effective.agent.profileModelDefaults = normalizeAgentProfileModelDefaults(globalConfig.agent?.profileModelDefaults);
    effective.agent.profiles = normalizeCompleteAgentProfiles(globalProfilePatches, effective.agent.profileModelDefaults);
    effective.ui.theme = normalizeTheme(globalConfig.ui?.theme);
    effective.editor.markdown = normalizeMarkdownPreferences(globalConfig.editor?.markdown);
    effective.editor.monaco = normalizeMonacoPreferences(globalConfig.editor?.monaco);
    effective.web = normalizeWebSettings(globalConfig.web);

    if (!projectConfig) {
        return effective;
    }

    if (projectConfig.models && Object.hasOwn(projectConfig.models, "default") && projectConfig.models.default !== null) {
        effective.models.defaultModelKey = normalizeNullableModelKey(projectConfig.models.default);
    }
    if (projectConfig.agent && Object.hasOwn(projectConfig.agent, "defaultProfileKey") && projectConfig.agent.defaultProfileKey !== null) {
        effective.agent.defaultProfileKey.novel = normalizeNullableModelKey(projectConfig.agent.defaultProfileKey);
    }
    if (projectConfig.agent?.profileModelDefaults) {
        effective.agent.profileModelDefaults = mergeAgentProfileModelConfig(
            effective.agent.profileModelDefaults,
            projectConfig.agent.profileModelDefaults,
        );
    }
    if (projectConfig.agent?.profileModelDefaults || projectConfig.agent?.profiles) {
        const projectProfiles = normalizeAgentProfiles(projectConfig.agent.profiles);
        effective.agent.profiles = Object.fromEntries(
            [...new Set([...Object.keys(globalProfilePatches), ...Object.keys(projectProfiles)])]
                .map((profileKey) => [profileKey, {
                    model: mergeAgentProfileModelConfig(
                        mergeAgentProfileModelConfig(
                            effective.agent.profileModelDefaults,
                            globalProfilePatches[profileKey]?.model,
                        ),
                        projectProfiles[profileKey]?.model,
                    ),
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
                api: normalizeNullableText(provider.api),
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
                api: provider.api,
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
    const patch = normalizeAgentProfileModelPatch(input);
    return {
        modelKey: Object.hasOwn(patch, "modelKey") ? patch.modelKey ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.modelKey : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.modelKey,
        temperature: Object.hasOwn(patch, "temperature") ? patch.temperature ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.temperature : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.temperature,
        topK: Object.hasOwn(patch, "topK") ? patch.topK ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.topK : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.topK,
        reasoningEffort: Object.hasOwn(patch, "reasoningEffort") ? patch.reasoningEffort ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.reasoningEffort : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.reasoningEffort,
        stream: Object.hasOwn(patch, "stream") ? patch.stream ?? DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.stream : DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS.stream,
    };
}

/**
 * 规范化所有 Agent Profile 共同继承的默认模型参数。
 */
export function normalizeAgentProfileModelDefaults(input: Partial<AgentProfileModelConfig> | undefined): AgentProfileModelConfig {
    return normalizeAgentProfileModelConfig({
        ...DEFAULT_AGENT_PROFILE_MODEL_DEFAULTS,
        ...(input ?? {}),
    });
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

function normalizeCompleteAgentProfiles(
    input: Record<string, StoredAgentProfileConfig> | undefined,
    defaults: AgentProfileModelConfig,
): Record<string, AgentProfileConfig> {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([profileKey, profile]) => [profileKey, {
            model: mergeAgentProfileModelConfig(defaults, profile.model),
        } satisfies AgentProfileConfig]),
    );
}

function mergeAgentProfileModelConfig(
    base: AgentProfileModelConfig,
    patchInput: Partial<AgentProfileModelConfig> | undefined,
): AgentProfileModelConfig {
    const patch = normalizeAgentProfileModelPatch(patchInput);
    return {
        modelKey: Object.hasOwn(patch, "modelKey") ? patch.modelKey ?? base.modelKey : base.modelKey,
        temperature: Object.hasOwn(patch, "temperature") ? patch.temperature ?? base.temperature : base.temperature,
        topK: Object.hasOwn(patch, "topK") ? patch.topK ?? base.topK : base.topK,
        reasoningEffort: Object.hasOwn(patch, "reasoningEffort") ? patch.reasoningEffort ?? base.reasoningEffort : base.reasoningEffort,
        stream: Object.hasOwn(patch, "stream") && typeof patch.stream === "boolean" ? patch.stream : base.stream,
    };
}

function normalizeAgentProfileModelPatch(input: Partial<AgentProfileModelConfig> | undefined): Partial<AgentProfileModelConfig> {
    if (!input) {
        return {};
    }
    return {
        ...(Object.hasOwn(input, "modelKey") ? {modelKey: normalizeNullableModelKey(input.modelKey)} : {}),
        ...(Object.hasOwn(input, "temperature") ? {temperature: normalizeNullableNumber(input.temperature)} : {}),
        ...(Object.hasOwn(input, "topK") ? {topK: normalizeNullableInteger(input.topK)} : {}),
        ...(Object.hasOwn(input, "reasoningEffort") ? {reasoningEffort: normalizeThinkingLevel(input.reasoningEffort)} : {}),
        ...(Object.hasOwn(input, "stream") && typeof input.stream === "boolean" ? {stream: input.stream} : {}),
    };
}

function normalizeThinkingLevel(value: unknown): AgentProfileModelConfig["reasoningEffort"] {
    const parsed = ThinkingLevelSchema.nullable().safeParse(value ?? null);
    return parsed.success ? parsed.data : null;
}

function normalizeStoredProviders(input: StoredProviderConfig[] | undefined): StoredProviderConfig[] {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .map((provider) => ({
            id: normalizeText(provider.id),
            name: normalizeText(provider.name),
            api: normalizeNullableText(provider.api),
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
        provider: normalizeNullableText(input.provider),
        api: normalizeNullableText(input.api),
        baseUrl: normalizeNullableText(input.baseUrl),
        reasoning: typeof input.reasoning === "boolean" ? input.reasoning : null,
        input: normalizeModelInput(input.input),
        maxTokens: normalizeNullablePositiveInteger(input.maxTokens),
        cost: normalizeModelCost(input.cost),
        compat: normalizeNullableJsonRecord(input.compat),
        contextWindowTokens: normalizeNullablePositiveInteger(input.contextWindowTokens),
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

function normalizeNullablePositiveInteger(input: unknown): number | null {
    const value = normalizeNullableInteger(input);
    return value !== null && value > 0 ? value : null;
}

function normalizeJsonRecord(input: unknown): Record<string, JsonValue> {
    return input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, JsonValue>
        : {};
}

function normalizeNullableJsonRecord(input: unknown): Record<string, JsonValue> | null {
    const record = normalizeJsonRecord(input);
    return Object.keys(record).length > 0 ? record : null;
}

function normalizeModelInput(input: unknown): ("text" | "image")[] | null {
    if (!Array.isArray(input)) {
        return null;
    }
    const values = [...new Set(input.filter((item): item is "text" | "image" => item === "text" || item === "image"))];
    return values.length > 0 ? values : null;
}

/**
 * 规范化 Global Web 配置，运行时只消费这个 complete shape。
 */
export function normalizeWebSettings(input: StoredWebSettingsConfig | undefined): WebSettingsConfig {
    const raw = input ?? {};
    const defaults = DEFAULT_WEB_SETTINGS;
    return {
        search: {
            order: normalizeProviderOrder(raw.search?.order),
            providers: {
                tavily: {
                    enabled: raw.search?.providers?.tavily?.enabled ?? defaults.search.providers.tavily.enabled,
                    apiKey: normalizeText(raw.search?.providers?.tavily?.apiKey),
                    timeoutMs: normalizeNullablePositiveInteger(raw.search?.providers?.tavily?.timeoutMs) ?? defaults.search.providers.tavily.timeoutMs,
                },
                brave: {
                    enabled: raw.search?.providers?.brave?.enabled ?? defaults.search.providers.brave.enabled,
                    apiKey: normalizeText(raw.search?.providers?.brave?.apiKey),
                    country: normalizeCountry(raw.search?.providers?.brave?.country),
                    searchLang: normalizeSearchLang(raw.search?.providers?.brave?.searchLang),
                    timeoutMs: normalizeNullablePositiveInteger(raw.search?.providers?.brave?.timeoutMs) ?? defaults.search.providers.brave.timeoutMs,
                },
            },
        },
        fetch: {
            local: {
                enabled: raw.fetch?.local?.enabled ?? defaults.fetch.local.enabled,
                timeoutMs: normalizePositiveInteger(raw.fetch?.local?.timeoutMs, defaults.fetch.local.timeoutMs),
                maxRedirects: normalizeNonNegativeInteger(raw.fetch?.local?.maxRedirects, defaults.fetch.local.maxRedirects),
                maxBytes: normalizePositiveInteger(raw.fetch?.local?.maxBytes, defaults.fetch.local.maxBytes),
                maxCharacters: normalizePositiveInteger(raw.fetch?.local?.maxCharacters, defaults.fetch.local.maxCharacters),
                minCharactersForLocal: normalizeNonNegativeInteger(raw.fetch?.local?.minCharactersForLocal, defaults.fetch.local.minCharactersForLocal),
            },
            tavilyFallback: {
                enabled: raw.fetch?.tavilyFallback?.enabled ?? defaults.fetch.tavilyFallback.enabled,
                timeoutMs: normalizeNullablePositiveInteger(raw.fetch?.tavilyFallback?.timeoutMs) ?? defaults.fetch.tavilyFallback.timeoutMs,
            },
        },
    };
}

function normalizeStoredWebSettings(input: StoredWebSettingsConfig | undefined): StoredWebSettingsConfig {
    return normalizeWebSettings(input);
}

function normalizeProviderOrder(input: unknown): WebSearchProviderKey[] {
    const allowed: WebSearchProviderKey[] = ["tavily", "brave"];
    if (!Array.isArray(input)) {
        return [...DEFAULT_WEB_SETTINGS.search.order];
    }
    const order = input.filter((value): value is WebSearchProviderKey => allowed.includes(value as WebSearchProviderKey));
    return [...new Set(order)].length > 0 ? [...new Set(order)] : [...DEFAULT_WEB_SETTINGS.search.order];
}

function normalizeCountry(input: unknown): string {
    const country = normalizeText(input).toUpperCase();
    return /^[A-Z]{2}$/u.test(country) ? country : DEFAULT_WEB_SETTINGS.search.providers.brave.country;
}

function normalizeSearchLang(input: unknown): string {
    const lang = normalizeText(input).toLowerCase();
    return /^[a-z]{2}(?:-[a-z]{2})?$/u.test(lang) ? lang : DEFAULT_WEB_SETTINGS.search.providers.brave.searchLang;
}

function normalizePositiveInteger(input: unknown, fallback: number): number {
    const value = normalizeNullablePositiveInteger(input);
    return value ?? fallback;
}

function normalizeNonNegativeInteger(input: unknown, fallback: number): number {
    const value = normalizeNullableInteger(input);
    return value !== null && value >= 0 ? value : fallback;
}

function normalizeModelCost(input: unknown): ConfiguredModelConfig["cost"] {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
    }
    const cost = input as Record<string, unknown>;
    const normalized = {
        input: normalizeFiniteNumber(cost.input),
        output: normalizeFiniteNumber(cost.output),
        cacheRead: normalizeFiniteNumber(cost.cacheRead),
        cacheWrite: normalizeFiniteNumber(cost.cacheWrite),
    };
    return normalized;
}

function normalizeFiniteNumber(input: unknown): number {
    return typeof input === "number" && Number.isFinite(input) ? input : 0;
}
