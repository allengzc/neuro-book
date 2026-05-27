import type {JsonValue} from "nbook/server/agent/messages/types";
import type {MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";

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

export type AgentProfileConfig = {
    model: AgentProfileModelConfig;
};

export type StoredAgentProfileConfig = {
    model: Partial<AgentProfileModelConfig>;
};

export type ConfiguredModelConfig = {
    name: string;
    id: string;
    group: string | null;
    enabled: boolean;
    provider: string | null;
    api: string | null;
    baseUrl: string | null;
    reasoning: boolean | null;
    input: ("text" | "image")[] | null;
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
    api: string | null;
    options: ModelProviderOptionsConfig;
    models: Record<string, ConfiguredModelConfig>;
};

export type ModelSettingsConfig = {
    defaultModelKey: string | null;
    providers: Record<string, ConfiguredProviderConfig>;
};

export type EffectiveConfig = {
    auth: {
        enabled: boolean;
    };
    models: ModelSettingsConfig;
    agent: {
        defaultProfileKey: {
            novel: string | null;
            userAssets: string | null;
        };
        profiles: Record<string, AgentProfileConfig>;
    };
    ui: {
        theme: "sepia" | "light" | "dark";
    };
    editor: {
        markdown: MarkdownEditorPreferences;
        monaco: MonacoEditorPreferences;
    };
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
    agent?: {
        defaultProfileKey?: {
            novel?: string | null;
            userAssets?: string | null;
        };
        profiles?: Record<string, StoredAgentProfileConfig>;
    };
    ui?: Partial<EffectiveConfig["ui"]>;
    editor?: {
        markdown?: Partial<MarkdownEditorPreferences>;
        monaco?: Partial<MonacoEditorPreferences>;
    };
};

export type StoredProjectConfig = {
    models?: {
        default?: string | null;
    };
    agent?: {
        defaultProfileKey?: string | null;
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
