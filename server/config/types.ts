import type {JsonValue} from "nbook/server/agent/messages/types";
import type {MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {ModelInputKind} from "nbook/shared/dto/app-settings.dto";

export type ConfigScope = "boot" | "global" | "global-workspace";
export type ConfigEffect = "hot" | "next-run" | "next-session" | "restart-required";
export type ConfigMerge = "replace" | "deep-merge";

export type ConfigItemMeta = {
    key: string;
    scope: ConfigScope;
    effect: ConfigEffect;
    merge: ConfigMerge;
    secret: boolean;
    description: string;
};

export type AgentProfileModelConfig = {
    modelKey: string | null;
    temperature: number | null;
    topK: number | null;
    reasoningEffort: ThinkingLevelDto | null;
    stream: boolean;
};

export type AgentProfileSettingsConfig = {
    [key: string]: JsonValue;
};

export type AgentProfileConfig = {
    model: AgentProfileModelConfig;
    settings: AgentProfileSettingsConfig;
};

export type StoredAgentProfileConfig = {
    model: Partial<AgentProfileModelConfig>;
    settings?: AgentProfileSettingsConfig;
};

export type StoredAgentProfileModelDefaultsConfig = Partial<AgentProfileModelConfig>;

export type ConfiguredModelConfig = {
    name: string;
    id: string;
    group: string | null;
    enabled: boolean;
    provider: string | null;
    api: string | null;
    baseUrl: string | null;
    reasoning: boolean | null;
    input: ModelInputKind[] | null;
    maxTokens: number | null;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    } | null;
    compat: Record<string, JsonValue> | null;
    contextWindowTokens: number | null;
};

export type ModelProviderOptionsConfig = {
    apiKey: string;
    baseURL: string;
    proxy: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
};

export type ConfiguredProviderConfig = {
    name: string;
    enabled: boolean;
    api: string | null;
    options: ModelProviderOptionsConfig;
    models: Record<string, ConfiguredModelConfig>;
};

export type ModelSettingsConfig = {
    defaultModelKey: string | null;
    providers: Record<string, ConfiguredProviderConfig>;
};

export type EmbeddingModelConfig = {
    model: string | null;
    dimensions: number | null;
};

export type EmbeddingServiceProvider = "openai-compatible";

export type EmbeddingServiceConfig = EmbeddingModelConfig & {
    enabled: boolean;
    provider: EmbeddingServiceProvider;
    apiKey: string;
    baseURL: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
};

export type WebSearchProviderKey = "tavily" | "brave";

export type WebProviderSecretConfig = {
    enabled: boolean;
    apiKey: string;
    timeoutMs: number | null;
};

export type BraveSearchProviderConfig = WebProviderSecretConfig & {
    country: string;
    searchLang: string;
};

export type TavilySearchProviderConfig = WebProviderSecretConfig;

export type WebSettingsConfig = {
    search: {
        order: WebSearchProviderKey[];
        providers: {
            tavily: TavilySearchProviderConfig;
            brave: BraveSearchProviderConfig;
        };
    };
    fetch: {
        local: {
            enabled: boolean;
            timeoutMs: number;
            maxRedirects: number;
            maxBytes: number;
            maxCharacters: number;
            minCharactersForLocal: number;
        };
        tavilyFallback: {
            enabled: boolean;
            timeoutMs: number | null;
        };
    };
};

export type StoredWebSettingsConfig = {
    search?: {
        order?: WebSearchProviderKey[];
        providers?: {
            tavily?: Partial<TavilySearchProviderConfig>;
            brave?: Partial<BraveSearchProviderConfig>;
        };
    };
    fetch?: {
        local?: Partial<WebSettingsConfig["fetch"]["local"]>;
        tavilyFallback?: Partial<WebSettingsConfig["fetch"]["tavilyFallback"]>;
    };
};

export type EffectiveConfig = {
    auth: {
        enabled: boolean;
    };
    models: ModelSettingsConfig;
    embedding: EmbeddingServiceConfig;
    agent: {
        defaultProfileKey: {
            novel: string | null;
            userAssets: string | null;
        };
        profileModelDefaults: AgentProfileModelConfig;
        profiles: Record<string, AgentProfileConfig>;
    };
    ui: {
        theme: "sepia" | "light" | "dark";
        costCurrency: "USD" | "CNY";
    };
    editor: {
        markdown: MarkdownEditorPreferences;
        monaco: MonacoEditorPreferences;
    };
    web: WebSettingsConfig;
};

export type StoredProviderConfig = Omit<ConfiguredProviderConfig, "models"> & {
    id: string;
    models: ConfiguredModelConfig[];
};

export type StoredGlobalConfig = {
    auth?: {
        enabled?: boolean;
    };
    models?: {
        default?: string | null;
        providers?: StoredProviderConfig[];
    };
    embedding?: Partial<EmbeddingServiceConfig>;
    agent?: {
        defaultProfileKey?: {
            novel?: string | null;
            userAssets?: string | null;
        };
        profileModelDefaults?: StoredAgentProfileModelDefaultsConfig;
        profiles?: Record<string, StoredAgentProfileConfig>;
    };
    ui?: Partial<EffectiveConfig["ui"]>;
    editor?: {
        markdown?: Partial<MarkdownEditorPreferences>;
        monaco?: Partial<MonacoEditorPreferences>;
    };
    web?: StoredWebSettingsConfig;
};

export type StoredProjectConfig = {
    models?: {
        default?: string | null;
    };
    embedding?: Partial<EmbeddingModelConfig>;
    agent?: {
        defaultProfileKey?: string | null;
        profileModelDefaults?: StoredAgentProfileModelDefaultsConfig;
        profiles?: Record<string, StoredAgentProfileConfig>;
    };
    editor?: {
        markdown?: Partial<MarkdownEditorPreferences>;
        monaco?: Partial<MonacoEditorPreferences>;
    };
};

export type ConfigTarget = {
    workspaceKind: "novel" | "user-assets";
    projectConfigPath: string | null;
};
