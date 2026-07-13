<script setup lang="ts">
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import NovelIdeModelEditDialog from "nbook/app/components/novel-ide/settings/NovelIdeModelEditDialog.vue";
import {clearModelCostDraft, createEmptyModelCostDraft, createModelCostDraft, parseModelCostDraft, type ModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    CheckModelResponseDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    DiscoveredProviderModelDto,
    EnabledModelOptionDto,
    ModelInputKind,
    ModelProviderDraftDto,
    PiBuiltinCatalogDto,
    PiBuiltinModelDto,
    PiBuiltinProviderDto,
    UpdateModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import type {ConfigEditorSnapshotDto, ConfigModelSettingsDto, ConfigWorkspaceQueryDto, GlobalConfigDto, ProjectConfigDto, SecretConfigValueDto} from "nbook/shared/dto/config.dto";

type ProviderRequestOptions = UpdateModelSettingsRequestDto["providers"][number]["options"]["requestOptions"];
type ConfigSettingsScope = "global" | "project";
const RUNTIME_DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000;
const RUNTIME_DEFAULT_MAX_TOKENS = 256_000;

const props = withDefaults(defineProps<{
    scope?: ConfigSettingsScope;
    targetQuery?: ConfigWorkspaceQueryDto;
    targetLabel?: string;
}>(), {
    scope: "global",
    targetQuery: undefined,
    targetLabel: "",
});

type ModelDraft = {
    name: string;
    id: string;
    group: string;
    enabled: boolean;
    provider: string;
    api: string;
    baseUrl: string;
    reasoning: "inherit" | "true" | "false";
    input: string;
    maxTokens: string;
    cost: ModelCostDraft;
    compat: string;
    contextWindowTokens: string;
};

type EffectiveModelMetadata = {
    api: string;
    apiSource: "model" | "provider" | "registry" | "fallback";
    reasoning: boolean;
    input: ModelInputKind[];
    maxTokens: number | null;
    contextWindowTokens: number | null;
    cost: NonNullable<ConfiguredModelDto["cost"]>;
};

type ManualModelDraft = {
    name: string;
    id: string;
    api: string;
    group: string;
    contextWindowTokens: string;
};

type ProviderDraft = {
    localKey: string;
    id: string;
    name: string;
    enabled: boolean;
    api: string;
    options: {
        apiKey: string;
        apiKeyConfigured: boolean;
        apiKeyMaskedValue: string | null;
        apiKeyCleared: boolean;
        baseURL: string;
        proxy: string;
        timeoutMs: string;
        requestOptions: string;
    };
    models: ModelDraft[];
};

type ModelSettingsDraft = {
    defaultModelKey: string | null;
    providers: ProviderDraft[];
};

type ModelCheckResult = CheckModelResponseDto & {
    cancelled?: boolean;
};

type ModelCheckControllerState = {
    controller: AbortController;
};

type ModelCheckBatchState = {
    providerKey: string;
    modelKeys: string[];
};

type ProviderPreset = {
    value: string;
    label: string;
    providerId: string;
    providerName: string;
    baseURL: string;
    description: string;
};

const {t} = useI18n();

const fallbackProviderPresetOptions = computed<ProviderPreset[]>(() => [
    {
        value: "xiaomi-token-plan-cn",
        label: "Xiaomi Token Plan CN",
        providerId: "xiaomi-token-plan-cn",
        providerName: "Xiaomi Token Plan CN",
        baseURL: "",
        description: t("settings.panels.models.builtinXiaomiDescription"),
    },
    {
        value: "deepseek",
        label: "DeepSeek",
        providerId: "deepseek",
        providerName: "DeepSeek",
        baseURL: "",
        description: t("settings.panels.models.builtinDeepseekDescription"),
    },
    {
        value: "openai",
        label: "OpenAI",
        providerId: "openai",
        providerName: "OpenAI",
        baseURL: "",
        description: t("settings.panels.models.builtinOpenaiDescription"),
    },
    {
        value: "openrouter",
        label: "OpenRouter",
        providerId: "openrouter",
        providerName: "OpenRouter",
        baseURL: "",
        description: t("settings.panels.models.builtinOpenrouterDescription"),
    },
    {
        value: "google",
        label: "Google",
        providerId: "google",
        providerName: "Google",
        baseURL: "",
        description: t("settings.panels.models.builtinGoogleDescription"),
    },
    {
        value: "custom",
        label: t("settings.panels.models.custom"),
        providerId: "custom-provider",
        providerName: "Custom Provider",
        baseURL: "",
        description: t("settings.panels.models.customDescription"),
    },
]);

const novelIdeStore = useNovelIdeStore();
const configApi = useConfigApi();
const notification = useNotification();

const loading = ref(false);
const saving = ref(false);
const activeProviderKey = ref("");
const selectedPreset = ref<string>(fallbackProviderPresetOptions.value[0]?.value ?? "custom");
const draft = ref<ModelSettingsDraft>({
    defaultModelKey: null,
    providers: [],
});
const snapshotText = ref("");
const discoveredModels = ref<Record<string, DiscoveredProviderModelDto[]>>({});
const piCatalog = ref<PiBuiltinCatalogDto | null>(null);
const resolvedContextWindowMap = ref<Record<string, number | null>>({});
const providerDiscoveringId = ref("");
const modelCheckControllers = ref<Record<string, ModelCheckControllerState>>({});
const modelCheckResults = ref<Record<string, ModelCheckResult>>({});
const activeModelCheckBatches = ref<Record<string, ModelCheckBatchState>>({});
const manualModelDrafts = ref<Record<string, ManualModelDraft>>({});
const libraryDialogOpen = ref(false);
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const projectReferencesDirty = ref(false);
let providerLocalKeySeed = 0;
let modelCheckStateVersion = 0;

const expandedGroups = ref<Record<string, boolean>>({});
const editingModel = ref<ModelDraft | null>(null);
const modelEditDialogOpen = ref(false);
const deleteProviderDialogOpen = ref(false);
const isProjectScope = computed(() => props.scope === "project");
const modelApiOptions: SelectOption[] = [
    {value: "openai-completions", label: "OpenAI Completions", description: "OpenAI-compatible Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses", description: "OpenAI Responses API"},
    {value: "anthropic-messages", label: "Anthropic Messages", description: "Anthropic Claude Messages"},
    {value: "google-generative-ai", label: "Google Generative AI", description: "Gemini / Google GenAI"},
    {value: "bedrock-converse-stream", label: "Bedrock Converse", description: "AWS Bedrock Converse Stream"},
];
const modelInputOptions = computed<Array<{value: ModelInputKind; label: string; iconClass: string}>>(() => [
    {value: "text", label: t("settings.panels.models.textInput"), iconClass: "i-lucide-type"},
    {value: "image", label: t("settings.panels.models.imageInput"), iconClass: "i-lucide-image"},
]);

const providerPresetOptions = computed<ProviderPreset[]>(() => {
    const builtinPresets = (piCatalog.value?.providers ?? []).map((provider) => ({
        value: provider.id,
        label: provider.name === provider.id ? provider.id : `${provider.name} (${provider.id})`,
        providerId: provider.id,
        providerName: provider.name,
        baseURL: provider.baseUrl,
        description: t("settings.panels.models.builtinProviderDescription", {count: provider.models.length}),
    }));
    const customPreset = fallbackProviderPresetOptions.value.find((preset) => preset.value === "custom");
    return [
        ...(builtinPresets.length > 0 ? builtinPresets : fallbackProviderPresetOptions.value.filter((preset) => preset.value !== "custom")),
        ...(customPreset ? [customPreset] : []),
    ];
});

function toggleGroup(group: string): void {
    expandedGroups.value[group] = !expandedGroups.value[group];
}

function openModelEdit(model: ModelDraft): void {
    editingModel.value = model;
    modelEditDialogOpen.value = true;
}

/**
 * 创建只用于前端渲染和选中状态的稳定 Provider key。
 */
function createProviderLocalKey(providerId: string): string {
    providerLocalKeySeed += 1;
    return `provider-${providerLocalKeySeed}-${providerId.trim() || "draft"}`;
}

/**
 * 收集当前 Provider 的本地 key。按队列复用，避免临时重复配置 ID 时生成重复 Vue key。
 */
function collectProviderLocalKeys(): Map<string, string[]> {
    const localKeyMap = new Map<string, string[]>();
    for (const provider of draft.value.providers) {
        const localKeys = localKeyMap.get(provider.id) ?? [];
        localKeys.push(provider.localKey);
        localKeyMap.set(provider.id, localKeys);
    }
    return localKeyMap;
}

/**
 * 克隆模型草稿。
 */
function cloneModel(model: ConfiguredModelDto): ModelDraft {
    return {
        name: model.name,
        id: model.id,
        group: model.group ?? "",
        enabled: model.enabled,
        provider: model.provider ?? "",
        api: model.api ?? "",
        baseUrl: model.baseUrl ?? "",
        reasoning: model.reasoning === null ? "inherit" : model.reasoning ? "true" : "false",
        input: model.input?.join(",") ?? "",
        maxTokens: typeof model.maxTokens === "number" ? String(model.maxTokens) : "",
        cost: createModelCostDraft(model.cost),
        compat: model.compat ? JSON.stringify(model.compat, null, 2) : "",
        contextWindowTokens: typeof model.contextWindowTokens === "number" ? String(model.contextWindowTokens) : "",
    };
}

/**
 * 将上下文窗口输入框解析为可空整数。
 */
function parseContextWindowTokens(value: string): number | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        return null;
    }

    const parsedValue = Number(normalizedValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return null;
    }

    return Math.trunc(parsedValue);
}

/**
 * 将 Pi Model maxTokens 输入框解析为可空整数。
 */
function parseMaxTokens(value: string): number | null {
    return parseContextWindowTokens(value);
}

/**
 * 解析模型输入能力；空值表示继承 Pi registry。
 */
function parseModelInput(value: string): ModelInputKind[] | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    const inputs = [...new Set(normalized.split(",")
        .map((item) => item.trim())
        .filter((item): item is ModelInputKind => item === "text" || item === "image"))];
    return inputs.length > 0 ? inputs : null;
}

/**
 * 切换模型输入能力；空数组表示继承上游 registry/provider。
 */
function toggleModelInput(model: ModelDraft, inputKind: ModelInputKind): void {
    const values = parseModelInput(model.input) ?? [];
    model.input = values.includes(inputKind)
        ? values.filter((item) => item !== inputKind).join(",")
        : [...values, inputKind].join(",");
}

function modelInputEnabled(model: ModelDraft, inputKind: ModelInputKind): boolean {
    return (parseModelInput(model.input) ?? resolveEffectiveModelMetadata(model).input).includes(inputKind);
}

/**
 * 清空模型价格覆盖，恢复继承 Pi registry。
 */
function resetModelCost(model: ModelDraft): void {
    clearModelCostDraft(model.cost);
}

/**
 * 启用原子价格覆盖，并复制当前有效的 Pi registry 基础价格与 tiers。
 */
function enableModelCostOverride(model: ModelDraft): void {
    model.cost = createModelCostDraft(resolveEffectiveModelMetadata(model).cost);
}

/**
 * 解析模型推理能力；继承表示由 Pi registry 决定。
 */
function parseModelReasoning(value: ModelDraft["reasoning"]): boolean | null {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    return null;
}

/**
 * 解析 Pi compat JSON；空值表示继承 Pi registry 或使用 provider 自动探测。
 */
function parseModelCompat(value: string): ConfiguredModelDto["compat"] {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        return null;
    }
    try {
        const parsedValue = JSON.parse(normalizedValue);
        return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
            ? parsedValue as ConfiguredModelDto["compat"]
            : null;
    } catch {
        return null;
    }
}

/**
 * 将 Provider 请求超时输入框解析为可空整数。
 */
function parseProviderTimeoutMs(value: string): number | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        return null;
    }

    const parsedValue = Number(normalizedValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return null;
    }

    return Math.trunc(parsedValue);
}

/**
 * 将 Provider 请求扩展参数解析为 JSON 对象。
 */
function parseProviderRequestOptions(value: string): ProviderRequestOptions {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
        return {};
    }

    try {
        const parsedValue = JSON.parse(normalizedValue);
        return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
            ? parsedValue as ProviderRequestOptions
            : {};
    } catch {
        return {};
    }
}

/**
 * 克隆 Provider 草稿。
 */
function cloneProvider(provider: ConfigModelSettingsDto["providers"][number], localKeyMap: Map<string, string[]> = new Map()): ProviderDraft {
    const localKeyQueue = localKeyMap.get(provider.id);
    return {
        localKey: localKeyQueue?.shift() ?? createProviderLocalKey(provider.id),
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        api: provider.api ?? "",
        options: {
            apiKey: "",
            apiKeyConfigured: provider.options.apiKey.configured,
            apiKeyMaskedValue: provider.options.apiKey.maskedValue,
            apiKeyCleared: false,
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: typeof provider.options.timeoutMs === "number" ? String(provider.options.timeoutMs) : "",
            requestOptions: Object.keys(provider.options.requestOptions).length > 0
                ? JSON.stringify(provider.options.requestOptions, null, 2)
                : "",
        },
        models: provider.models.map(cloneModel),
    };
}

/**
 * 将接口响应应用到本地草稿。
 */
function applySettings(snapshot: ConfigEditorSnapshotDto, options: {preserveUiState?: boolean; preferredProviderKey?: string} = {}): void {
    const localKeyMap = collectProviderLocalKeys();
    const preferredProviderKey = options.preferredProviderKey ?? activeProviderKey.value;
    draft.value = {
        defaultModelKey: snapshot.modelSettings.defaultModelKey,
        providers: snapshot.modelSettings.providers.map((provider) => cloneProvider(provider, localKeyMap)),
    };
    snapshotText.value = JSON.stringify(buildSavePayload());
    activeProviderKey.value = draft.value.providers.some((provider) => provider.localKey === preferredProviderKey)
        ? preferredProviderKey
        : draft.value.providers[0]?.localKey ?? "";
    if (!options.preserveUiState) {
        discoveredModels.value = {};
        manualModelDrafts.value = {};
    }
    resetModelCheckState();
    resolvedContextWindowMap.value = Object.fromEntries(
        snapshot.modelSettings.enabledModels.map((model) => [model.key, model.contextWindowTokens]),
    );
    projectReferencesDirty.value = false;
    novelIdeStore.setSelectedModelLabel(snapshot.modelSettings.defaultModelLabel);
}

/**
 * 读取 Project Config 中显式保存的默认模型覆盖。
 */
function readProjectDefaultModelKey(snapshot: ConfigEditorSnapshotDto): string | null {
    return snapshot.project?.models && Object.hasOwn(snapshot.project.models, "default")
        ? snapshot.project.models.default ?? null
        : null;
}

/**
 * 将 Project Config 默认模型覆盖应用到表单草稿。
 */
function applyProjectSettings(snapshot: ConfigEditorSnapshotDto): void {
    const localKeyMap = collectProviderLocalKeys();
    editorSnapshot.value = snapshot;
    draft.value = {
        defaultModelKey: readProjectDefaultModelKey(snapshot),
        providers: snapshot.modelSettings.providers.map((provider) => cloneProvider(provider, localKeyMap)),
    };
    snapshotText.value = JSON.stringify({
        defaultModelKey: draft.value.defaultModelKey,
    });
    activeProviderKey.value = draft.value.providers.some((provider) => provider.localKey === activeProviderKey.value)
        ? activeProviderKey.value
        : draft.value.providers[0]?.localKey ?? "";
    discoveredModels.value = {};
    resolvedContextWindowMap.value = Object.fromEntries(
        snapshot.modelSettings.enabledModels.map((model) => [model.key, model.contextWindowTokens]),
    );
    manualModelDrafts.value = {};
    resetModelCheckState();
    projectReferencesDirty.value = false;
    novelIdeStore.setSelectedModelLabel(snapshot.modelSettings.defaultModelLabel);
}

/**
 * 读取当前显示给用户的上下文窗口。
 * 已保存模型优先显示后端解析结果；本地草稿回退到手动输入值。
 */
function resolveDisplayedContextWindow(providerId: string, model: ModelDraft): string {
    const savedValue = resolvedContextWindowMap.value[`${providerId}/${model.id}`];
    if (typeof savedValue === "number" && Number.isFinite(savedValue)) {
        return String(savedValue);
    }

    return model.contextWindowTokens.trim();
}

/**
 * 构造保存请求体。
 */
function buildSecretPayload(provider: ProviderDraft): SecretConfigValueDto {
    return {
        configured: provider.options.apiKeyConfigured,
        maskedValue: provider.options.apiKeyMaskedValue,
        ...(provider.options.apiKeyCleared ? {value: ""} : {}),
        ...(!provider.options.apiKeyCleared && provider.options.apiKey.trim() ? {value: provider.options.apiKey.trim()} : {}),
    };
}

/**
 * 标记清空当前 Provider API key。保存后后端会写入空字符串。
 */
function clearActiveProviderApiKey(): void {
    if (!activeProvider.value) {
        return;
    }
    activeProvider.value.options.apiKey = "";
    activeProvider.value.options.apiKeyConfigured = false;
    activeProvider.value.options.apiKeyMaskedValue = null;
    activeProvider.value.options.apiKeyCleared = true;
}

/**
 * 构造模型设置保存请求体。
 */
function buildSavePayload(): UpdateModelSettingsRequestDto {
    return {
        defaultModelKey: draft.value.defaultModelKey,
        providers: draft.value.providers.map((provider) => ({
            id: provider.id.trim(),
            name: provider.name.trim(),
            enabled: provider.enabled,
            api: provider.api.trim() || null,
            options: {
                apiKey: provider.options.apiKey.trim(),
                baseURL: provider.options.baseURL.trim(),
                proxy: provider.options.proxy.trim(),
                timeoutMs: parseProviderTimeoutMs(provider.options.timeoutMs),
                requestOptions: parseProviderRequestOptions(provider.options.requestOptions),
            },
            models: provider.models.map((model) => ({
                name: model.name.trim(),
                id: model.id.trim(),
                group: model.group.trim() || null,
                enabled: model.enabled,
                provider: model.provider.trim() || null,
                api: model.api.trim() || null,
                baseUrl: model.baseUrl.trim() || null,
                reasoning: parseModelReasoning(model.reasoning),
                input: parseModelInput(model.input),
                maxTokens: parseMaxTokens(model.maxTokens),
                cost: parseModelCostDraft(model.cost),
                compat: parseModelCompat(model.compat),
                contextWindowTokens: parseContextWindowTokens(model.contextWindowTokens),
            })),
        })),
    };
}

/**
 * 构造 Global Config 写回体，secret 字段遵守“空输入保留旧值”语义。
 */
function buildGlobalConfigPayload(): GlobalConfigDto {
    const base = editorSnapshot.value?.global ?? {};
    const modelKeys = availableModelKeys();
    return {
        ...base,
        agent: cleanConfigAgentProfiles(base.agent, modelKeys),
        models: {
            default: cleanModelKey(draft.value.defaultModelKey, modelKeys),
            providers: draft.value.providers.map((provider) => ({
                id: provider.id.trim(),
                name: provider.name.trim(),
                enabled: provider.enabled,
                api: provider.api.trim() || null,
                options: {
                    apiKey: buildSecretPayload(provider),
                    baseURL: provider.options.baseURL.trim(),
                    proxy: provider.options.proxy.trim(),
                    timeoutMs: parseProviderTimeoutMs(provider.options.timeoutMs),
                    requestOptions: parseProviderRequestOptions(provider.options.requestOptions),
                },
                models: provider.models.map((model) => ({
                    name: model.name.trim(),
                    id: model.id.trim(),
                    group: model.group.trim() || null,
                    enabled: model.enabled,
                    provider: model.provider.trim() || null,
                    api: model.api.trim() || null,
                    baseUrl: model.baseUrl.trim() || null,
                    reasoning: parseModelReasoning(model.reasoning),
                    input: parseModelInput(model.input),
                    maxTokens: parseMaxTokens(model.maxTokens),
                    cost: parseModelCostDraft(model.cost),
                    compat: parseModelCompat(model.compat),
                    contextWindowTokens: parseContextWindowTokens(model.contextWindowTokens),
                })),
            })),
        },
    };
}

/**
 * 构造 Project Config 写回体，清理已不存在 Provider 的模型引用。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project ?? {};
    const modelKeys = availableModelKeys();
    const cleanedAgent = cleanProjectAgentProfiles(base.agent, modelKeys);
    const modelPatch = {
        ...(base.models ?? {}),
        ...(isProjectScope.value || (base.models && Object.hasOwn(base.models, "default"))
            ? {default: cleanModelKey(isProjectScope.value ? draft.value.defaultModelKey : base.models?.default, modelKeys)}
            : {}),
    };
    return {
        ...base,
        ...(cleanedAgent ? {agent: cleanedAgent} : {}),
        ...(Object.keys(modelPatch).length > 0 ? {models: modelPatch} : {}),
    };
}

/**
 * 当前草稿中仍启用的完整模型 key 集合。
 */
function availableModelKeys(): Set<string> {
    return new Set(draft.value.providers.flatMap((provider) => provider.models
        .filter((model) => provider.enabled && model.enabled && provider.id.trim() && model.id.trim())
        .map((model) => `${provider.id.trim()}/${model.id.trim()}`)));
}

/**
 * 如果模型 key 指向已删除或未启用模型，则清空该引用。
 */
function cleanModelKey(modelKey: string | null | undefined, modelKeys: Set<string>): string | null {
    const normalizedModelKey = modelKey?.trim() ?? "";
    if (!normalizedModelKey) {
        return null;
    }
    return modelKeys.has(normalizedModelKey) ? normalizedModelKey : null;
}

/**
 * 复制并清理完整 Config agent 中失效的模型引用。
 */
function cleanConfigAgentProfiles<T extends {profileModelDefaults?: {modelKey?: string | null}; profiles?: Record<string, {model?: {modelKey?: string | null}}>}>(
    agent: T | undefined,
    modelKeys: Set<string>,
): T | undefined {
    if (!agent) {
        return agent;
    }
    return {
        ...agent,
        profileModelDefaults: agent.profileModelDefaults
            ? {
                ...agent.profileModelDefaults,
                modelKey: cleanModelKey(agent.profileModelDefaults.modelKey, modelKeys),
            }
            : agent.profileModelDefaults,
        profiles: agent.profiles
            ? Object.fromEntries(Object.entries(agent.profiles).map(([profileKey, profile]) => [profileKey, {
                ...profile,
                model: profile.model
                    ? {
                        ...profile.model,
                        modelKey: cleanModelKey(profile.model.modelKey, modelKeys),
                    }
                    : profile.model,
            }]))
            : agent.profiles,
    };
}

/**
 * 复制并清理 Project partial agent。modelKey 缺失表示继承 Global，不能写成 null。
 */
function cleanProjectAgentProfiles<T extends {profileModelDefaults?: {modelKey?: string | null}; profiles?: Record<string, {model?: {modelKey?: string | null}}>}>(
    agent: T | undefined,
    modelKeys: Set<string>,
): T | undefined {
    if (!agent) {
        return agent;
    }
    const profileModelDefaults = agent.profileModelDefaults && Object.hasOwn(agent.profileModelDefaults, "modelKey")
        ? (() => {
            const cleanedModelKey = cleanModelKey(agent.profileModelDefaults?.modelKey, modelKeys);
            const {modelKey: _modelKey, ...defaultsWithoutKey} = agent.profileModelDefaults ?? {};
            return cleanedModelKey
                ? {
                    ...agent.profileModelDefaults,
                    modelKey: cleanedModelKey,
                }
                : defaultsWithoutKey;
        })()
        : agent.profileModelDefaults;
    return {
        ...agent,
        profileModelDefaults,
        profiles: agent.profiles
            ? Object.fromEntries(Object.entries(agent.profiles).map(([profileKey, profile]) => {
                if (!profile.model || !Object.hasOwn(profile.model, "modelKey")) {
                    return [profileKey, profile];
                }
                const cleanedModelKey = cleanModelKey(profile.model.modelKey, modelKeys);
                const {modelKey: _modelKey, ...modelWithoutKey} = profile.model;
                return [profileKey, {
                    ...profile,
                    model: cleanedModelKey
                        ? {
                            ...profile.model,
                            modelKey: cleanedModelKey,
                        }
                        : modelWithoutKey,
                }];
            }))
            : agent.profiles,
    };
}

/**
 * 迁移 Config agent 中指定 Provider 前缀的模型引用。
 */
function renameConfigAgentProfileModels<T extends {profileModelDefaults?: {modelKey?: string | null}; profiles?: Record<string, {model?: {modelKey?: string | null}}>}>(
    agent: T | undefined,
    previousProviderId: string,
    nextProviderId: string,
): {agent: T | undefined; changed: boolean} {
    if (!agent) {
        return {agent, changed: false};
    }
    let changed = false;
    const defaultModelKey = agent.profileModelDefaults?.modelKey ?? "";
    const renamedProfileModelDefaults = defaultModelKey.startsWith(`${previousProviderId}/`)
        ? (() => {
            changed = true;
            return {
                ...agent.profileModelDefaults,
                modelKey: defaultModelKey.replace(`${previousProviderId}/`, `${nextProviderId}/`),
            };
        })()
        : agent.profileModelDefaults;
    return {
        agent: {
            ...agent,
            profileModelDefaults: renamedProfileModelDefaults,
            profiles: agent.profiles
                ? Object.fromEntries(Object.entries(agent.profiles).map(([profileKey, profile]) => {
                    const modelKey = profile.model?.modelKey ?? "";
                    const shouldRename = modelKey.startsWith(`${previousProviderId}/`);
                    if (shouldRename) {
                        changed = true;
                    }
                    return [profileKey, {
                        ...profile,
                        model: shouldRename
                            ? {
                                ...profile.model,
                                modelKey: modelKey.replace(`${previousProviderId}/`, `${nextProviderId}/`),
                            }
                            : profile.model,
                    }];
                }))
                : agent.profiles,
        },
        changed,
    };
}

/**
 * 读取模型设定。
 */
async function loadSettings(): Promise<void> {
    loading.value = true;

    try {
        if (!isProjectScope.value) {
            void loadPiCatalog();
        }
        const snapshot = await configApi.editorSnapshot(props.targetQuery);
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
        } else {
            applySettings(snapshot);
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadFailed")));
    } finally {
        loading.value = false;
    }
}

/**
 * 生成唯一 providerId。
 */
function buildUniqueProviderId(baseId: string): string {
    const normalizedBaseId = baseId.trim() || "provider";
    const providerIdSet = new Set(draft.value.providers.map((provider) => provider.id));
    if (!providerIdSet.has(normalizedBaseId)) {
        return normalizedBaseId;
    }

    let suffix = 2;
    while (providerIdSet.has(`${normalizedBaseId}-${String(suffix)}`)) {
        suffix += 1;
    }

    return `${normalizedBaseId}-${String(suffix)}`;
}

/**
 * 确保默认模型仍然指向一个已启用模型。
 */
function ensureDefaultModelKey(): void {
    const enabledModelKeys = draft.value.providers.flatMap((provider) => provider.models
        .filter((model) => provider.enabled && model.enabled && model.id.trim())
        .map((model) => `${provider.id}/${model.id.trim()}`));

    if (enabledModelKeys.length === 0) {
        draft.value.defaultModelKey = null;
        return;
    }

    if (!draft.value.defaultModelKey || !enabledModelKeys.includes(draft.value.defaultModelKey)) {
        draft.value.defaultModelKey = enabledModelKeys[0] ?? null;
    }
}

/**
 * 获取当前激活的 Provider。
 */
const activeProvider = computed<ProviderDraft | null>(() => {
    return draft.value.providers.find((provider) => provider.localKey === activeProviderKey.value) ?? null;
});

/**
 * Provider 下模型自身标记为 enabled 的数量。
 */
function providerEnabledModelCount(provider: ProviderDraft): number {
    return provider.models.filter((model) => model.enabled).length;
}

const activeProviderEnabledModelCount = computed(() => {
    return activeProvider.value?.enabled ? providerEnabledModelCount(activeProvider.value) : 0;
});

const activeProviderModelCheckKeys = computed(() => {
    const provider = activeProvider.value;
    if (!provider?.enabled) {
        return [] as string[];
    }
    return provider.models
        .filter((model) => model.enabled)
        .map((model) => modelCheckKey(provider, model));
});

const activeProviderCheckingModelKeys = computed(() => {
    return activeProviderModelCheckKeys.value.filter((key) => Boolean(modelCheckControllers.value[key]));
});

const activeProviderCheckingModelCount = computed(() => activeProviderCheckingModelKeys.value.length);
const checkingAllModels = computed(() => {
    const provider = activeProvider.value;
    if (!provider) {
        return false;
    }
    const batch = activeModelCheckBatches.value[provider.localKey];
    return batch?.modelKeys.some((modelKey) => Boolean(modelCheckControllers.value[modelKey])) ?? false;
});

/**
 * 切换 Provider 启用状态；禁用后运行时把它视为不存在。
 */
function toggleActiveProviderEnabled(): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }
    if (provider.enabled) {
        cancelProviderChecks(provider, {clearBatch: true});
    }
    provider.enabled = !provider.enabled;
    ensureDefaultModelKey();
}

/**
 * 当前草稿是否有未保存修改。
 */
const dirty = computed(() => {
    if (isProjectScope.value) {
        return JSON.stringify({
            defaultModelKey: draft.value.defaultModelKey,
        }) !== snapshotText.value;
    }
    return projectReferencesDirty.value || JSON.stringify(buildSavePayload()) !== snapshotText.value;
});

/**
 * 默认模型候选列表。
 */
const defaultModelOptions = computed<EnabledModelOptionDto[]>(() => {
    return draft.value.providers.flatMap((provider) => provider.models
        .filter((model) => provider.enabled && model.enabled && model.id.trim())
        .map((model) => ({
            key: `${provider.id}/${model.id.trim()}`,
            label: `${provider.name} / ${model.name || model.id}`,
            providerId: provider.id,
            modelId: model.id.trim(),
            contextWindowTokens: parseContextWindowTokens(model.contextWindowTokens),
        })))
        .sort((left, right) => left.label.localeCompare(right.label));
});

/**
 * 当前 Provider 下启用模型的分组列表。
 */
const enabledModelGroups = computed(() => {
    const provider = activeProvider.value;
    if (!provider?.enabled) {
        return [] as Array<{group: string; models: ModelDraft[]}>;
    }

    const groupMap = new Map<string, ModelDraft[]>();
    for (const model of provider.models) {
        if (!model.enabled) {
            continue;
        }

        const groupName = model.group.trim() || deriveGroup(model.id);
        const groupModels = groupMap.get(groupName) ?? [];
        groupModels.push(model);
        groupMap.set(groupName, groupModels);
    }

    return [...groupMap.entries()]
        .map(([group, models]) => ({
            group,
            models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
        }))
        .sort((left, right) => left.group.localeCompare(right.group));
});

/**
 * 当前 Provider 下已禁用模型列表。
 */
const disabledModels = computed(() => {
    const provider = activeProvider.value;
    if (!provider) {
        return [] as ModelDraft[];
    }

    return provider.models
        .filter((model) => !model.enabled)
        .sort((left, right) => left.id.localeCompare(right.id));
});

/**
 * 根据模型 ID 推导默认 group。
 */
function deriveGroup(modelId: string): string {
    const normalizedId = modelId.trim();
    if (!normalizedId) {
        return "default";
    }

    const separatorIndex = normalizedId.indexOf("-");
    if (separatorIndex <= 0) {
        return normalizedId;
    }

    return normalizedId.slice(0, separatorIndex);
}

/**
 * 获取当前 Provider 的手动新增模型草稿。
 */
function getManualModelDraft(providerId: string): ManualModelDraft {
    if (!manualModelDrafts.value[providerId]) {
        manualModelDrafts.value[providerId] = {
            name: "",
            id: "",
            api: "",
            group: "",
            contextWindowTokens: "",
        };
    }

    return manualModelDrafts.value[providerId];
}

/**
 * 显示模型实际配置的 Pi API 继承关系。
 */
function displayModelApi(model: ModelDraft, provider: ProviderDraft | null = activeProvider.value): string {
    return resolveEffectiveModelMetadata(model, provider).api;
}

function displayModelApiSource(model: ModelDraft, provider: ProviderDraft | null = activeProvider.value): string {
    const source = resolveEffectiveModelMetadata(model, provider).apiSource;
    if (source === "model") {
        return t("settings.panels.models.modelApiSourceModel");
    }
    if (source === "provider") {
        return t("settings.panels.models.modelApiSourceProvider");
    }
    if (source === "registry") {
        return t("settings.panels.models.modelApiSourceRegistry");
    }
    return t("settings.panels.models.modelApiSourceFallback");
}

/**
 * 查找模型对应的 Pi registry 元数据，优先按模型级 provider，再回退配置 ID。
 */
function findPiModelForDraft(model: ModelDraft, provider: ProviderDraft | null = activeProvider.value): PiBuiltinModelDto | null {
    const providerId = model.provider.trim() || provider?.id.trim() || "";
    return piCatalog.value?.providers
        .find((item) => item.id === providerId)
        ?.models.find((item) => item.id === model.id)
        ?? null;
}

/** 当前编辑模型从 Pi registry 继承的价格；无匹配项时不伪造零价格。 */
const editingModelInheritedCost = computed(() => editingModel.value
    ? findPiModelForDraft(editingModel.value)?.cost ?? null
    : null);

/**
 * 计算模型最终生效的 Pi 元数据，用于把“继承”显示成具体值。
 */
function resolveEffectiveModelMetadata(model: ModelDraft, provider: ProviderDraft | null = activeProvider.value): EffectiveModelMetadata {
    const piModel = findPiModelForDraft(model, provider);
    const parsedInput = parseModelInput(model.input);
    const parsedMaxTokens = parseMaxTokens(model.maxTokens);
    const parsedContextWindow = parseContextWindowTokens(model.contextWindowTokens);
    return {
        api: model.api.trim() || provider?.api.trim() || piModel?.api || "openai-completions",
        apiSource: model.api.trim() ? "model" : provider?.api.trim() ? "provider" : piModel?.api ? "registry" : "fallback",
        reasoning: parseModelReasoning(model.reasoning) ?? piModel?.reasoning ?? false,
        input: parsedInput ?? piModel?.input ?? ["text"],
        maxTokens: parsedMaxTokens ?? piModel?.maxTokens ?? null,
        contextWindowTokens: parsedContextWindow ?? piModel?.contextWindowTokens ?? null,
        cost: piModel?.cost ?? {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: []},
    };
}

function providerDefaultApiLabel(provider: ProviderDraft): string {
    const registryApi = findPiProvider(provider.id)?.models[0]?.api ?? "openai-completions";
    return t("settings.panels.models.providerDefaultApi", {api: registryApi});
}

function modelApiInheritLabel(model: ModelDraft): string {
    const providerApi = activeProvider.value?.api.trim();
    if (providerApi) {
        return t("settings.panels.models.inheritProviderApi", {api: providerApi});
    }
    return t("settings.panels.models.providerDefaultApi", {api: resolveEffectiveModelMetadata(model).api});
}

function modelInputDisplayLabel(model: ModelDraft): string {
    return resolveEffectiveModelMetadata(model).input
        .map((item) => modelInputOptions.value.find((option) => option.value === item)?.label ?? item)
        .join(" / ");
}

function modelReasoningDisplayLabel(model: ModelDraft): string {
    return resolveEffectiveModelMetadata(model).reasoning ? t("settings.panels.models.supported") : t("settings.panels.models.unsupported");
}

function formatTokenLimit(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return t("settings.panels.models.unknown");
    }
    return new Intl.NumberFormat(undefined, {maximumFractionDigits: 0}).format(value);
}

function modelContextWindowDefaultLabel(model: ModelDraft): string {
    const piModel = findPiModelForDraft(model);
    const value = piModel?.contextWindowTokens ?? RUNTIME_DEFAULT_CONTEXT_WINDOW_TOKENS;
    const source = piModel?.contextWindowTokens ? "Pi" : t("settings.panels.models.runtimeDefault");
    return `${formatTokenLimit(value)} tokens（${source}）`;
}

function modelMaxTokensDefaultLabel(model: ModelDraft): string {
    const piModel = findPiModelForDraft(model);
    const value = piModel?.maxTokens ?? RUNTIME_DEFAULT_MAX_TOKENS;
    const source = piModel?.maxTokens ? "Pi" : t("settings.panels.models.runtimeDefault");
    return `${formatTokenLimit(value)} tokens（${source}）`;
}

/**
 * 更新手动模型 ID 时，尽量从 Pi 内置目录同步 API 元数据。
 */
function updateManualModelId(providerId: string, modelId: string): void {
    const manualDraft = getManualModelDraft(providerId);
    manualDraft.id = modelId;
}

/**
 * 懒加载 Pi 内置模型目录。
 */
async function loadPiCatalog(): Promise<PiBuiltinCatalogDto> {
    if (!piCatalog.value) {
        piCatalog.value = await configApi.piModelCatalog();
        if (!providerPresetOptions.value.some((preset) => preset.value === selectedPreset.value)) {
            selectedPreset.value = providerPresetOptions.value[0]?.value ?? "custom";
        }
    }
    return piCatalog.value;
}

/**
 * 查找 Pi 内置 Provider。
 */
function findPiProvider(providerId: string): PiBuiltinProviderDto | null {
    return piCatalog.value?.providers.find((provider) => provider.id === providerId) ?? null;
}

/**
 * 把 Pi 内置模型转成可写入配置的模型草稿。
 */
function clonePiModel(model: PiBuiltinModelDto): ModelDraft {
    const providerId = activeProvider.value?.id.trim() ?? "";
    const usesSameRegistryProvider = !providerId || providerId === model.provider;
    return {
        name: model.name,
        id: model.id,
        group: deriveGroup(model.id),
        enabled: false,
        provider: usesSameRegistryProvider ? "" : model.provider,
        api: "",
        baseUrl: "",
        reasoning: model.reasoning ? "true" : "false",
        input: model.input.join(","),
        maxTokens: String(model.maxTokens),
        cost: createEmptyModelCostDraft(),
        compat: model.compat ? JSON.stringify(model.compat, null, 2) : "",
        contextWindowTokens: String(model.contextWindowTokens),
    };
}

/**
 * 新增 Provider 预设。
 */
async function addProvider(): Promise<void> {
    try {
        await loadPiCatalog();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadPiCatalogFailed")));
        return;
    }
    const preset = providerPresetOptions.value.find((item) => item.value === selectedPreset.value) ?? providerPresetOptions.value[0];
    if (!preset) {
        return;
    }

    const builtinProvider = findPiProvider(preset.providerId);
    const providerId = buildUniqueProviderId(preset.providerId);
    const baseURL = preset.baseURL || builtinProvider?.baseUrl || "";
    const localKey = createProviderLocalKey(providerId);
    activeProviderKey.value = localKey;
    draft.value.providers.push({
        localKey,
        id: providerId,
        name: preset.providerName,
        enabled: true,
        api: "",
        options: {
            apiKey: "",
            baseURL,
            proxy: "",
            timeoutMs: "",
            requestOptions: "",
            apiKeyConfigured: false,
            apiKeyMaskedValue: null,
            apiKeyCleared: false,
        },
        models: builtinProvider?.models.map(clonePiModel) ?? [],
    });
    notification.success(t("settings.panels.models.providerAdded", {label: preset.label}));
}

/**
 * 保存模型设定并返回是否成功，供删除 Provider 这类复合操作复用。
 */
async function saveSettingsResult(successMessage?: string): Promise<boolean> {
    if (!dirty.value || saving.value) {
        return false;
    }

    saving.value = true;

    try {
        let snapshot = isProjectScope.value
            ? await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery)
            : await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery);
        if (!isProjectScope.value && (projectReferencesDirty.value || shouldCleanProjectConfig())) {
            snapshot = await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery);
        }
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
            notification.success(successMessage ?? t("settings.panels.models.projectSaveSuccess"));
        } else {
            applySettings(snapshot, {preserveUiState: true, preferredProviderKey: activeProviderKey.value});
            notification.success(successMessage ?? t("settings.panels.models.globalSaveSuccess"));
        }
        return true;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.saveFailed")));
        return false;
    } finally {
        saving.value = false;
    }
}

/**
 * 保存模型设定。
 */
async function saveSettings(): Promise<void> {
    await saveSettingsResult();
}

/**
 * 重新读取已保存的模型设定，放弃当前草稿。
 */
async function restoreSettings(): Promise<void> {
    await loadSettings();
}

/**
 * 重命名当前激活 Provider 的 id，并同步相关引用。
 */
function renameActiveProviderId(nextProviderId: string): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }

    const previousProviderId = provider.id;
    const normalizedProviderId = nextProviderId.trim();
    cancelProviderChecks(provider, {clearBatch: true});
    provider.id = normalizedProviderId;

    if (previousProviderId === normalizedProviderId) {
        return;
    }

    if (draft.value.defaultModelKey?.startsWith(`${previousProviderId}/`)) {
        draft.value.defaultModelKey = draft.value.defaultModelKey.replace(`${previousProviderId}/`, `${normalizedProviderId}/`);
    }
    renameProviderModelReferences(previousProviderId, normalizedProviderId);

    if (discoveredModels.value[previousProviderId]) {
        discoveredModels.value = {
            ...discoveredModels.value,
            [normalizedProviderId]: discoveredModels.value[previousProviderId] ?? [],
        };
        delete discoveredModels.value[previousProviderId];
    }

    if (manualModelDrafts.value[previousProviderId]) {
        manualModelDrafts.value = {
            ...manualModelDrafts.value,
            [normalizedProviderId]: manualModelDrafts.value[previousProviderId],
        };
        delete manualModelDrafts.value[previousProviderId];
    }
}

/**
 * Provider ID 重命名时迁移 Global / Project Config 中的模型引用。
 */
function renameProviderModelReferences(previousProviderId: string, nextProviderId: string): void {
    if (editorSnapshot.value?.global.agent) {
        const renamedGlobalAgent = renameConfigAgentProfileModels(
            editorSnapshot.value.global.agent,
            previousProviderId,
            nextProviderId,
        );
        editorSnapshot.value.global.agent = renamedGlobalAgent.agent ?? editorSnapshot.value.global.agent;
    }
    const project = editorSnapshot.value?.project;
    if (!project) {
        return;
    }
    if (project.models?.default?.startsWith(`${previousProviderId}/`)) {
        project.models.default = project.models.default.replace(`${previousProviderId}/`, `${nextProviderId}/`);
        projectReferencesDirty.value = true;
    }
    if (project.agent) {
        const renamedAgent = renameConfigAgentProfileModels(project.agent, previousProviderId, nextProviderId);
        if (renamedAgent.changed) {
            project.agent = renamedAgent.agent ?? project.agent;
            projectReferencesDirty.value = true;
        }
    }
}

/**
 * Global 删除 Provider 后，如果当前 Project Config 还引用了失效模型，需要连同项目配置一起清理。
 */
function shouldCleanProjectConfig(): boolean {
    const project = editorSnapshot.value?.project;
    if (!project) {
        return false;
    }
    const modelKeys = availableModelKeys();
    if (project.models && Object.hasOwn(project.models, "default") && cleanModelKey(project.models.default, modelKeys) !== (project.models.default ?? null)) {
        return true;
    }
    if (project.agent?.profileModelDefaults && Object.hasOwn(project.agent.profileModelDefaults, "modelKey")) {
        const modelKey = project.agent.profileModelDefaults.modelKey;
        if (cleanModelKey(modelKey, modelKeys) !== (modelKey ?? null)) {
            return true;
        }
    }
    const profiles = project.agent?.profiles ?? {};
    return Object.values(profiles).some((profile) => {
        if (!profile.model || !Object.hasOwn(profile.model, "modelKey")) {
            return false;
        }
        const modelKey = profile.model?.modelKey;
        return cleanModelKey(modelKey, modelKeys) !== (modelKey ?? null);
    });
}

/**
 * 请求删除当前 Provider。
 */
function requestDeleteActiveProvider(): void {
    if (!activeProvider.value) {
        return;
    }
    deleteProviderDialogOpen.value = true;
}

/**
 * 删除当前 Provider，确认后立即保存当前模型面板草稿。
 */
async function confirmDeleteActiveProvider(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider) {
        deleteProviderDialogOpen.value = false;
        return;
    }

    const deletedProviderId = provider.id;
    const deletedProviderName = provider.name;
    draft.value.providers = draft.value.providers.filter((item) => item !== provider);
    if (draft.value.defaultModelKey?.startsWith(`${deletedProviderId}/`)) {
        draft.value.defaultModelKey = null;
    }
    delete discoveredModels.value[deletedProviderId];
    delete manualModelDrafts.value[deletedProviderId];
    activeProviderKey.value = draft.value.providers[0]?.localKey ?? "";
    ensureDefaultModelKey();
    deleteProviderDialogOpen.value = false;
    await saveSettingsResult(t("settings.panels.models.providerDeleted", {name: deletedProviderName}));
}

/**
 * 读取当前 Provider 草稿请求体。
 */
function buildProviderRequest(provider: ProviderDraft): {provider: ModelProviderDraftDto} {
    return {
        provider: {
            id: provider.id.trim(),
            name: provider.name.trim(),
            api: provider.api.trim() || null,
            options: {
                apiKey: provider.options.apiKey.trim(),
                baseURL: provider.options.baseURL.trim(),
                proxy: provider.options.proxy.trim(),
                timeoutMs: parseProviderTimeoutMs(provider.options.timeoutMs),
                requestOptions: parseProviderRequestOptions(provider.options.requestOptions),
            },
        },
    };
}

function shouldUseSavedProviderApiKey(provider: ProviderDraft): boolean {
    return !provider.options.apiKeyCleared && !provider.options.apiKey.trim();
}

function buildModelCheckDraft(model: ModelDraft): Omit<ConfiguredModelDto, "enabled"> {
    return {
        name: model.name.trim(),
        id: model.id.trim(),
        group: model.group.trim() || null,
        provider: model.provider.trim() || null,
        api: model.api.trim() || null,
        baseUrl: model.baseUrl.trim() || null,
        reasoning: parseModelReasoning(model.reasoning),
        input: parseModelInput(model.input),
        maxTokens: parseMaxTokens(model.maxTokens),
        cost: parseModelCostDraft(model.cost),
        compat: parseModelCompat(model.compat),
        contextWindowTokens: parseContextWindowTokens(model.contextWindowTokens),
    };
}

/**
 * 从 Provider 抓取模型列表。
 */
async function discoverModels(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider || providerDiscoveringId.value) {
        return;
    }

    providerDiscoveringId.value = provider.id;

    try {
        const catalog = await loadPiCatalog();
        const builtinProvider = catalog.providers.find((item) => item.id === provider.id);
        const result: DiscoverProviderModelsResponseDto = builtinProvider
            ? {
                models: builtinProvider.models.map((model) => ({
                    id: model.id,
                    name: model.name,
                    group: deriveGroup(model.id),
                })),
                message: t("settings.panels.models.builtinModelsLoaded", {count: builtinProvider.models.length}),
            }
            : await $fetch<DiscoverProviderModelsResponseDto>("/api/config/models/provider-discover", {
                method: "POST",
                body: buildProviderRequest(provider),
            });
        discoveredModels.value = {
            ...discoveredModels.value,
            [provider.id]: result.models,
        };
        notification.success(result.message);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.discoverFailed")));
    } finally {
        providerDiscoveringId.value = "";
    }
}

/**
 * 启用或新增模型。
 */
function enableModel(model: {
    name: string;
    id: string;
    group: string | null | undefined;
    api?: string | null | undefined;
    provider?: string | null | undefined;
    baseUrl?: string | null | undefined;
    reasoning?: boolean | null | undefined;
    input?: ModelInputKind[] | null | undefined;
    maxTokens?: string | number | null | undefined;
    cost?: ConfiguredModelDto["cost"] | undefined;
    compat?: Record<string, unknown> | null | undefined;
    contextWindowTokens?: string | number | null | undefined;
}): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }

    const modelId = model.id.trim();
    if (!modelId) {
        return;
    }

    const existingModel = provider.models.find((item) => item.id === modelId);
    if (existingModel) {
        existingModel.name = model.name.trim() || modelId;
        existingModel.group = model.group?.trim() ?? "";
        existingModel.enabled = true;
        existingModel.provider = model.provider?.trim() ?? existingModel.provider;
        existingModel.api = model.api?.trim() ?? existingModel.api;
        existingModel.baseUrl = model.baseUrl?.trim() ?? existingModel.baseUrl;
        existingModel.reasoning = typeof model.reasoning === "boolean" ? (model.reasoning ? "true" : "false") : existingModel.reasoning;
        existingModel.input = model.input?.join(",") ?? existingModel.input;
        existingModel.maxTokens = typeof model.maxTokens === "number" ? String(model.maxTokens) : model.maxTokens?.trim() ?? existingModel.maxTokens;
        existingModel.cost = model.cost ? createModelCostDraft(model.cost) : existingModel.cost;
        existingModel.compat = model.compat ? JSON.stringify(model.compat, null, 2) : existingModel.compat;
        existingModel.contextWindowTokens = typeof model.contextWindowTokens === "number"
            ? String(model.contextWindowTokens)
            : model.contextWindowTokens?.trim() ?? "";
    } else {
        provider.models.push({
            name: model.name.trim() || modelId,
            id: modelId,
            group: model.group?.trim() ?? "",
            enabled: true,
            provider: model.provider?.trim() ?? "",
            api: model.api?.trim() ?? "",
            baseUrl: model.baseUrl?.trim() ?? "",
            reasoning: typeof model.reasoning === "boolean" ? (model.reasoning ? "true" : "false") : "inherit",
            input: model.input?.join(",") ?? "",
            maxTokens: typeof model.maxTokens === "number" ? String(model.maxTokens) : model.maxTokens?.trim() ?? "",
            cost: model.cost ? createModelCostDraft(model.cost) : createEmptyModelCostDraft(),
            compat: model.compat ? JSON.stringify(model.compat, null, 2) : "",
            contextWindowTokens: typeof model.contextWindowTokens === "number"
                ? String(model.contextWindowTokens)
                : model.contextWindowTokens?.trim() ?? "",
        });
    }

    ensureDefaultModelKey();
}

/**
 * 将模型标记为禁用。
 */
function disableModel(model: ModelDraft): void {
    const provider = activeProvider.value;
    if (provider) {
        cancelModelCheck(provider, model);
    }
    model.enabled = false;
    ensureDefaultModelKey();
}

/**
 * 手动新增一个模型。
 */
function addManualModel(): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }

    const manualDraft = getManualModelDraft(provider.id);
    if (!manualDraft.name.trim() || !manualDraft.id.trim()) {
        notification.error(t("settings.panels.models.manualRequired"));
        return;
    }

    enableModel({
        name: manualDraft.name,
        id: manualDraft.id,
        api: manualDraft.api || null,
        group: manualDraft.group,
        contextWindowTokens: manualDraft.contextWindowTokens,
    });

    manualModelDrafts.value = {
        ...manualModelDrafts.value,
        [provider.id]: {
            name: "",
            id: "",
            api: "",
            group: "",
            contextWindowTokens: "",
        },
    };
    notification.success(t("settings.panels.models.manualAdded"));
}

function modelCheckKey(provider: ProviderDraft, model: ModelDraft): string {
    return `${provider.id.trim()}/${model.id.trim()}`;
}

function modelCheckResult(provider: ProviderDraft, model: ModelDraft): ModelCheckResult | null {
    return modelCheckResults.value[modelCheckKey(provider, model)] ?? null;
}

function isModelChecking(provider: ProviderDraft, model: ModelDraft): boolean {
    return Boolean(modelCheckControllers.value[modelCheckKey(provider, model)]);
}

function isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    const name = typeof error === "object" && error !== null && "name" in error
        ? (error as {name?: unknown}).name
        : null;
    return name === "AbortError";
}

function setModelCheckController(modelKey: string, controller: AbortController): void {
    modelCheckControllers.value = {
        ...modelCheckControllers.value,
        [modelKey]: {controller},
    };
}

/**
 * 批次下所有模型都停止后，释放“检测全部”的 UI 锁。
 */
function clearModelCheckBatchesIfSettled(providerKey?: string): void {
    const nextBatches = {...activeModelCheckBatches.value};
    const entries = providerKey
        ? [[providerKey, nextBatches[providerKey]] as const]
        : Object.entries(nextBatches);
    let changed = false;

    for (const [batchProviderKey, batch] of entries) {
        if (!batch) {
            continue;
        }
        if (batch.modelKeys.some((modelKey) => Boolean(modelCheckControllers.value[modelKey]))) {
            continue;
        }
        delete nextBatches[batchProviderKey];
        changed = true;
    }

    if (changed) {
        activeModelCheckBatches.value = nextBatches;
    }
}

/**
 * Provider 被禁用或重命名时，丢弃旧 Provider 批次锁。
 */
function clearProviderModelCheckBatch(provider: ProviderDraft): void {
    if (activeModelCheckBatches.value[provider.localKey]) {
        const nextBatches = {...activeModelCheckBatches.value};
        delete nextBatches[provider.localKey];
        activeModelCheckBatches.value = nextBatches;
    }
}

function clearModelCheckController(modelKey: string, controller: AbortController): void {
    if (modelCheckControllers.value[modelKey]?.controller !== controller) {
        return;
    }
    const nextControllers = {...modelCheckControllers.value};
    delete nextControllers[modelKey];
    modelCheckControllers.value = nextControllers;
    clearModelCheckBatchesIfSettled();
}

function writeModelCheckResult(modelKey: string, result: ModelCheckResult): void {
    modelCheckResults.value = {
        ...modelCheckResults.value,
        [modelKey]: result,
    };
}

function resetModelCheckState(): void {
    modelCheckStateVersion += 1;
    for (const state of Object.values(modelCheckControllers.value)) {
        state.controller.abort();
    }
    modelCheckControllers.value = {};
    modelCheckResults.value = {};
    activeModelCheckBatches.value = {};
}

function cancelProviderChecks(provider: ProviderDraft, options: {clearBatch?: boolean} = {}): void {
    for (const model of provider.models) {
        modelCheckControllers.value[modelCheckKey(provider, model)]?.controller.abort();
    }
    if (options.clearBatch) {
        clearProviderModelCheckBatch(provider);
    }
}

function cancelModelCheck(provider: ProviderDraft, model: ModelDraft): void {
    modelCheckControllers.value[modelCheckKey(provider, model)]?.controller.abort();
}

function cancelActiveProviderChecks(): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }
    cancelProviderChecks(provider);
}

/**
 * 对单个模型执行健康检查，并把结果写入模型行临时状态。
 */
async function runModelCheck(provider: ProviderDraft, model: ModelDraft): Promise<ModelCheckResult> {
    const modelKey = modelCheckKey(provider, model);
    const controller = new AbortController();
    const stateVersion = modelCheckStateVersion;
    setModelCheckController(modelKey, controller);

    try {
        const result = await $fetch<CheckModelResponseDto>("/api/config/models/model-check", {
            method: "POST",
            signal: controller.signal,
            body: {
                provider: buildProviderRequest(provider).provider,
                model: buildModelCheckDraft(model),
                useSavedApiKey: shouldUseSavedProviderApiKey(provider),
            },
        });
        if (stateVersion === modelCheckStateVersion && !controller.signal.aborted) {
            writeModelCheckResult(modelKey, result);
        }
        return result;
    } catch (error) {
        const result: ModelCheckResult = controller.signal.aborted || isAbortError(error)
            ? {
                success: false,
                latencyMs: null,
                message: t("settings.panels.models.modelCheckCancelled"),
                cancelled: true,
            }
            : {
                success: false,
                latencyMs: null,
                message: resolveApiErrorMessage(error, t("settings.panels.models.modelCheckFailed")),
            };
        if (stateVersion === modelCheckStateVersion) {
            writeModelCheckResult(modelKey, result);
        }
        return result;
    } finally {
        clearModelCheckController(modelKey, controller);
    }
}

/**
 * 对单个模型执行健康检查。
 */
async function checkModel(model: ModelDraft): Promise<void> {
    const provider = activeProvider.value;
    if (!provider?.enabled || !model.enabled || isModelChecking(provider, model)) {
        return;
    }

    await runModelCheck(provider, model);
}

/**
 * 并发检测当前 Provider 下所有启用且尚未检测中的模型。
 */
async function checkAllActiveProviderModels(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider?.enabled || checkingAllModels.value) {
        return;
    }
    const enabledModels = provider.models.filter((model) => model.enabled);
    if (enabledModels.length === 0) {
        notification.info(t("settings.panels.models.noEnabledProviderModels"));
        return;
    }
    const batchModelKeys = enabledModels.map((model) => modelCheckKey(provider, model));
    activeModelCheckBatches.value = {
        ...activeModelCheckBatches.value,
        [provider.localKey]: {
            providerKey: provider.localKey,
            modelKeys: batchModelKeys,
        },
    };
    const models = enabledModels.filter((model) => !isModelChecking(provider, model));
    if (models.length === 0) {
        clearModelCheckBatchesIfSettled(provider.localKey);
        return;
    }

    try {
        await Promise.allSettled(models.map((model) => runModelCheck(provider, model)));
    } finally {
        clearModelCheckBatchesIfSettled(provider.localKey);
    }
}

/**
 * 获取当前 Provider 下远程抓取到的模型列表。
 */
const currentDiscoveredModels = computed(() => {
    return activeProvider.value ? (discoveredModels.value[activeProvider.value.id] ?? []) : [];
});

/**
 * 查找当前 Provider 对应的 Pi 内置模型。
 */
function findCurrentPiModel(modelId: string): PiBuiltinModelDto | null {
    const provider = activeProvider.value;
    if (!provider) {
        return null;
    }
    return findPiProvider(provider.id)?.models.find((model) => model.id === modelId) ?? null;
}

/**
 * 获取远程抓取模型的当前状态。
 */
function resolveDiscoveredModelState(modelId: string): "enabled" | "disabled" | "missing" {
    const provider = activeProvider.value;
    if (!provider) {
        return "missing";
    }

    const existingModel = provider.models.find((model) => model.id === modelId);
    if (!existingModel) {
        return "missing";
    }

    return existingModel.enabled ? "enabled" : "disabled";
}

const librarySearchQuery = ref("");

const unifiedLibraryGroups = computed(() => {
    const provider = activeProvider.value;
    if (!provider) return [];
    
    const allModelsMap = new Map<string, { name: string; id: string; group: string; state: 'enabled' | 'disabled' | 'remote'; builtinModel?: PiBuiltinModelDto | null }>();
    
    for (const rm of currentDiscoveredModels.value) {
        const builtinModel = findCurrentPiModel(rm.id);
        const group = rm.group || deriveGroup(rm.id);
        allModelsMap.set(rm.id, {
            name: rm.name,
            id: rm.id,
            group,
            state: resolveDiscoveredModelState(rm.id) === 'enabled' ? 'enabled' : 'remote',
            builtinModel,
        });
    }
    
    for (const m of disabledModels.value) {
        const group = m.group.trim() || deriveGroup(m.id);
        allModelsMap.set(m.id, { name: m.name, id: m.id, group, state: 'disabled' });
    }
    
    for (const m of provider.models.filter(m => m.enabled)) {
        const group = m.group.trim() || deriveGroup(m.id);
        allModelsMap.set(m.id, { name: m.name, id: m.id, group, state: 'enabled' });
    }

    const query = librarySearchQuery.value.toLowerCase().trim();
    
    const groupMap = new Map<string, Array<{ name: string; id: string; group: string; state: string; builtinModel?: PiBuiltinModelDto | null }>>();
    for (const model of allModelsMap.values()) {
        if (query && !model.name.toLowerCase().includes(query) && !model.id.toLowerCase().includes(query)) {
            continue;
        }
        const g = groupMap.get(model.group) ?? [];
        g.push(model);
        groupMap.set(model.group, g);
    }
    
    return [...groupMap.entries()]
        .map(([group, models]) => ({
            group,
            models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
        }))
        .sort((left, right) => left.group.localeCompare(right.group));
});

const libraryExpandedGroups = ref<Record<string, boolean>>({});
function toggleLibraryGroup(group: string) {
    libraryExpandedGroups.value[group] = !libraryExpandedGroups.value[group];
}

function toggleLibraryModel(model: { name: string; id: string; group: string; state: string; builtinModel?: PiBuiltinModelDto | null }) {
    if (model.state === 'enabled') {
        const existing = activeProvider.value?.models.find(m => m.id === model.id);
        if (existing) disableModel(existing);
    } else {
        enableModel(model.builtinModel
            ? {
                name: model.builtinModel.name,
                id: model.builtinModel.id,
                group: model.group,
                provider: activeProvider.value?.id === model.builtinModel.provider ? null : model.builtinModel.provider,
                api: null,
                baseUrl: null,
                reasoning: model.builtinModel.reasoning,
                input: model.builtinModel.input,
                maxTokens: model.builtinModel.maxTokens,
                compat: model.builtinModel.compat,
                contextWindowTokens: model.builtinModel.contextWindowTokens,
            }
            : model);
    }
}

watch(() => activeProvider.value?.id ?? "", (providerId) => {
    if (!providerId) {
        return;
    }

    getManualModelDraft(providerId);
});

onMounted(() => {
    void loadSettings();
});

onBeforeUnmount(() => {
    resetModelCheckState();
});

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectPath] as const, () => {
    void loadSettings();
});

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
    restoreSettings,
});
</script>

<template>
    <!-- 模型设置主容器 -->
    <div class="space-y-4 pt-1">
        <!-- 精简版顶部栏 -->
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.models.projectTitle") : t("settings.panels.models.globalTitle") }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.models.projectDescription", {target: props.targetLabel || t("settings.panels.models.currentProject")}) : t("settings.panels.models.globalDescription") }}</p>
            </div>
        </div>

        <!-- 顶部默认模型与新增 Provider -->
        <div class="grid gap-4" :class="isProjectScope ? '' : 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'">
            <div class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-cpu h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.models.projectDefaultTitle") : t("settings.panels.models.globalDefaultTitle") }}</div>
                </div>
                <NovelIdeModelSelect
                    :model-value="draft.defaultModelKey"
                    :models="defaultModelOptions"
                    :allow-default="isProjectScope"
                    :default-label="t('settings.panels.models.followGlobalDefault')"
                    :placeholder="t('settings.panels.models.noEnabledModels')"
                    @update:model-value="draft.defaultModelKey = $event"
                />
            </div>

            <div v-if="!isProjectScope" class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-input)] text-[var(--text-secondary)]">
                        <span class="i-lucide-network h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.addProvider") }}</div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                        <FormSelect :model-value="selectedPreset" :options="providerPresetOptions.map((item) => ({ value: item.value, label: item.label }))" @update:model-value="selectedPreset = $event" />
                    </div>
                    <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] active:scale-95" @click="void addProvider()">
                        <span class="i-lucide-plus mr-1 h-3 w-3"></span>
                        {{ t("settings.panels.models.add") }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.loading") }}</span>
        </div>

        <!-- 模型设置双栏布局 -->
        <div v-else-if="!isProjectScope" class="grid min-h-[500px] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
            <!-- 左侧 Provider 列表 -->
            <aside class="flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 shadow-sm">
                <div class="px-3 pb-3 pt-2">
                    <div class="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Providers</div>
                    <div class="mt-1 text-xs text-[var(--text-secondary)] opacity-80">{{ t("settings.panels.models.providersHint") }}</div>
                </div>

                <div v-if="draft.providers.length === 0" class="m-2 rounded-xl border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-xs leading-6 text-[var(--text-secondary)]">
                    {{ t("settings.panels.models.noProviders") }}<br>{{ t("settings.panels.models.addProviderFromAbove") }}
                </div>

                <div class="flex flex-col gap-1 overflow-y-auto px-1 pb-1 custom-scrollbar">
                    <button
                        v-for="provider in draft.providers"
                        :key="provider.localKey"
                        class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-300"
                        :class="activeProviderKey === provider.localKey ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : provider.enabled ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]' : 'text-[var(--text-muted)] opacity-65 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'"
                        @click="activeProviderKey = provider.localKey"
                    >
                        <!-- 激活状态左侧指示条 -->
                        <div
                            class="absolute left-0 top-1/2 h-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-main)] transition-all duration-300"
                            :class="activeProviderKey === provider.localKey ? 'opacity-100' : 'opacity-0 scale-y-0'"
                        ></div>

                        <span class="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" :class="[provider.enabled ? 'i-lucide-server' : 'i-lucide-server-off', activeProviderKey === provider.localKey ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]']"></span>
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-[13px] font-medium" :class="activeProviderKey === provider.localKey ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ provider.name }}</div>
                            <div class="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] opacity-70">
                                <span class="truncate">{{ t("settings.panels.models.modelCount", {count: provider.enabled ? providerEnabledModelCount(provider) : 0}) }}</span>
                                <span v-if="!provider.enabled" class="shrink-0 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1 text-[10px] text-[var(--status-warning)]">{{ t("settings.panels.models.providerDisabled") }}</span>
                            </div>
                        </div>
                    </button>
                </div>
            </aside>

            <!-- 右侧 Provider 详情 -->
            <div class="relative min-w-0">
                <Transition
                    name="fade-slide"
                    mode="out-in"
                >
                    <section v-if="activeProvider" :key="activeProvider.localKey" class="space-y-5 pb-8">
                        <!-- Provider 连接表单 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm transition-all duration-300 hover:shadow-md">
                            <!-- Provider 操作区 -->
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div v-if="!activeProvider.enabled" class="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-warning)]">
                                    <span class="i-lucide-server-off h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.providerDisabledHint") }}
                                </div>

                                <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium shadow-sm transition-all duration-200 hover:shadow active:scale-95" :class="activeProvider.enabled ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)] hover:bg-[var(--status-warning-bg)]' : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)] hover:bg-[var(--status-success-bg)]'" @click="toggleActiveProviderEnabled">
                                        <span class="h-3.5 w-3.5" :class="activeProvider.enabled ? 'i-lucide-power-off' : 'i-lucide-power'"></span>
                                        {{ activeProvider.enabled ? t("settings.panels.models.disableProvider") : t("settings.panels.models.enableProvider") }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] hover:shadow active:scale-95 disabled:pointer-events-none disabled:opacity-60" :disabled="providerDiscoveringId === activeProvider.id" @click="void discoverModels()">
                                        <span v-if="providerDiscoveringId === activeProvider.id" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                        <span v-else class="i-lucide-cloud-lightning h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                        {{ providerDiscoveringId === activeProvider.id ? t("settings.panels.models.discovering") : t("settings.panels.models.discoverModels") }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-medium text-[var(--status-danger)] shadow-sm transition-all duration-200 hover:bg-[var(--status-danger-bg)] hover:shadow active:scale-95" @click="requestDeleteActiveProvider">
                                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.models.delete") }}
                                    </button>
                                </div>
                            </div>

                            <!-- Provider 表单 -->
                            <div class="mt-4 grid gap-4 md:grid-cols-2">
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.providerId") }}</label>
                                    <FormInput :model-value="activeProvider.id" :placeholder="t('settings.panels.models.providerIdPlaceholder')" @update:model-value="renameActiveProviderId" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.providerName") }}</label>
                                    <FormInput v-model="activeProvider.name" :placeholder="t('settings.panels.models.providerNamePlaceholder')" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.apiFormat") }}</label>
                                    <FormSelect v-model="activeProvider.api" :options="[{value: '', label: providerDefaultApiLabel(activeProvider)}, ...modelApiOptions]" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Base</label>
                                    <FormInput v-model="activeProvider.options.baseURL" :placeholder="t('settings.panels.models.apiBasePlaceholder')" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <div class="flex items-center justify-between gap-3">
                                        <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Key</label>
                                        <button v-if="activeProvider.options.apiKeyConfigured" type="button" class="text-[11px] text-[var(--status-danger)] transition-colors hover:opacity-80" @click="clearActiveProviderApiKey">{{ t("settings.panels.models.clearApiKey") }}</button>
                                    </div>
                                    <FormInput v-model="activeProvider.options.apiKey" :placeholder="activeProvider.options.apiKeyConfigured ? t('settings.panels.models.configuredApiKeyPlaceholder', {value: activeProvider.options.apiKeyMaskedValue ?? ''}) : 'sk-...'" type="password" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.proxy") }}</label>
                                    <FormInput v-model="activeProvider.options.proxy" placeholder="http://127.0.0.1:7890" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.requestTimeout") }}</label>
                                    <FormInput v-model="activeProvider.options.timeoutMs" :placeholder="t('settings.panels.models.defaultTimeout')" type="number" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.requestOptions") }}</label>
                                    <textarea v-model="activeProvider.options.requestOptions" rows="4" placeholder="{&quot;store&quot;:false}" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 font-mono text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"></textarea>
                                </div>
                            </div>
                        </div>

                        <!-- 已启用模型 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm transition-all duration-300 hover:shadow-md overflow-hidden">
                            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4 bg-[var(--bg-panel)]">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.enabledModels") }}</h3>
                                        <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{{ activeProviderEnabledModelCount }}</div>
                                    </div>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.models.enabledModelsDescription") }}</p>
                                </div>
                                <div class="flex flex-wrap items-center justify-end gap-2">
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:pointer-events-none disabled:opacity-50" :disabled="checkingAllModels || activeProviderEnabledModelCount === 0" @click="void checkAllActiveProviderModels()">
                                        <span class="h-3.5 w-3.5" :class="checkingAllModels ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-list-checks'"></span>
                                        {{ checkingAllModels ? t("settings.panels.models.checkingAllModels") : t("settings.panels.models.checkAllModels") }}
                                    </button>
                                    <button v-if="activeProviderCheckingModelCount > 0" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-medium text-[var(--status-danger)] shadow-sm transition-all duration-200 hover:bg-[var(--status-danger-bg)] active:scale-95" @click="cancelActiveProviderChecks">
                                        <span class="i-lucide-circle-x h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.models.cancelModelChecks") }}
                                    </button>
                                </div>
                            </div>

                            <div class="max-h-[360px] min-h-[150px] overflow-y-auto bg-[var(--bg-input)]/20 p-3 custom-scrollbar">
                                <div v-if="enabledModelGroups.length === 0" class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-color)] py-8 text-center bg-[var(--bg-panel)]">
                                    <span class="i-lucide-box h-5 w-5 text-[var(--text-muted)]"></span>
                                    <div class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.noEnabledProviderModels") }}</div>
                                </div>

                                <div v-else class="space-y-2">
                                    <div v-for="group in enabledModelGroups" :key="group.group" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] overflow-hidden shadow-sm">
                                        <button class="flex w-full items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--bg-hover)]/50 transition-colors" @click="toggleGroup(group.group)">
                                            <div class="flex items-center gap-2">
                                                <span class="h-4 w-4 shrink-0 transition-transform duration-200" :class="expandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down text-[var(--text-muted)]'"></span>
                                                <span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span>
                                                <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ group.models.length }}</div>
                                            </div>
                                        </button>

                                        <div v-show="expandedGroups[group.group] !== false" class="border-t border-[var(--border-color)] bg-[var(--bg-input)]/10 divide-y divide-[var(--border-color)]">
                                            <div v-for="(model, index) in group.models" :key="`${group.group}-${String(index)}`" class="group/model relative flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]/40">
                                                <div class="flex items-center gap-3 min-w-0">
                                                    <div class="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)] shrink-0">
                                                        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                                    </div>
                                                    <div class="min-w-0 flex flex-col">
                                                        <div class="flex items-center gap-2">
                                                            <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div>
                                                            <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ displayModelApi(model) }}
                                                            </span>
                                                            <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ displayModelApiSource(model) }}
                                                            </span>
                                                            <span v-if="resolveDisplayedContextWindow(activeProvider.id, model)" class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ resolveDisplayedContextWindow(activeProvider.id, model) }} ctx
                                                            </span>
                                                        </div>
                                                        <div class="truncate text-[11px] text-[var(--text-muted)] mt-0.5">{{ model.id }}</div>
                                                        <div v-if="modelCheckResult(activeProvider, model)" class="mt-1 flex max-w-[520px] items-center gap-1.5 text-[11px]" :class="modelCheckResult(activeProvider, model)?.cancelled ? 'text-[var(--text-muted)]' : modelCheckResult(activeProvider, model)?.success ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]'" :title="modelCheckResult(activeProvider, model)?.message">
                                                            <span class="h-3 w-3 shrink-0" :class="modelCheckResult(activeProvider, model)?.cancelled ? 'i-lucide-circle-slash' : modelCheckResult(activeProvider, model)?.success ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"></span>
                                                            <span class="truncate">{{ modelCheckResult(activeProvider, model)?.message }}</span>
                                                            <span v-if="modelCheckResult(activeProvider, model)?.latencyMs !== null" class="shrink-0 opacity-70">{{ modelCheckResult(activeProvider, model)?.latencyMs }}ms</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div class="flex shrink-0 items-center gap-1">
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] transition-colors disabled:opacity-50" :disabled="isModelChecking(activeProvider, model)" :title="t('settings.panels.models.checkModel')" @click="void checkModel(model)">
                                                        <span v-if="isModelChecking(activeProvider, model)" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                                        <span v-else class="i-lucide-play h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button v-if="isModelChecking(activeProvider, model)" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)] hover:opacity-80" :title="t('settings.panels.models.cancelModelCheck')" @click="cancelModelCheck(activeProvider, model)">
                                                        <span class="i-lucide-circle-x h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] transition-colors" :title="t('settings.panels.models.editSettings')" @click="openModelEdit(model)">
                                                        <span class="i-lucide-settings h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.disableModel')" @click="disableModel(model)">
                                                        <span class="i-lucide-minus h-3.5 w-3.5"></span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-panel)] border-t border-[var(--border-color)]">
                                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 text-xs font-medium text-[var(--status-success)] shadow-sm transition-all duration-200 hover:bg-[var(--status-success-bg)] active:scale-95" @click="libraryDialogOpen = true">
                                    <span class="i-lucide-list-filter h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.manageLibrary") }}
                                </button>
                                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="libraryDialogOpen = true">
                                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.add") }}
                                </button>
                            </div>
                        </div>
                    </section>

                    <section v-else class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-8 py-10 text-center shadow-sm">
                        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-input)] shadow-inner">
                            <span class="i-lucide-server-off h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                        </div>
                        <div>
                            <div class="text-base font-medium text-[var(--text-main)]">{{ t("settings.panels.models.noProviderSelected") }}</div>
                            <div class="mt-1 text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.selectProviderHint") }}</div>
                        </div>
                    </section>
                </Transition>
            </div>
        </div>
    </div>

        <Dialog
        v-model="libraryDialogOpen"
        :title="activeProvider ? t('settings.panels.models.modelLibraryTitle', {provider: activeProvider.name}) : t('settings.panels.models.modelLibrary')"
        width="800px"
        height="85%"
        overlay-type="blur"
        :show-footer="false"
    >
        <div v-if="activeProvider" class="flex h-full flex-col gap-4 px-1 py-2">
            <!-- Header bar with search and discover button -->
            <div class="flex items-center gap-3 shrink-0">
                <div class="relative flex-1">
                    <span class="i-lucide-search absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
                    <input v-model="librarySearchQuery" type="text" :placeholder="t('settings.panels.models.searchModels')" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]" />
                </div>
                <button class="flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="providerDiscoveringId === activeProvider.id" :title="t('settings.panels.models.refreshModels')" @click="void discoverModels()">
                    <span class="h-4 w-4" :class="providerDiscoveringId === activeProvider.id ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>
                    {{ t("settings.panels.models.refresh") }}
                </button>
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 min-h-0">
                <div v-if="unifiedLibraryGroups.length === 0" class="flex h-full flex-col items-center justify-center py-20 text-center">
                    <span class="i-lucide-search-x mb-2 h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                    <span class="text-sm text-[var(--text-muted)]">{{ t("settings.panels.models.noMatchingModels") }}</span>
                </div>
                
                <div v-else class="space-y-2">
                    <div v-for="group in unifiedLibraryGroups" :key="group.group" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm overflow-hidden">
                        <button class="flex w-full items-center justify-between px-4 py-2 hover:bg-[var(--bg-hover)]/40 transition-colors bg-[var(--bg-input)]/30" @click="toggleLibraryGroup(group.group)">
                            <div class="flex items-center gap-2">
                                <span class="h-3.5 w-3.5 shrink-0 transition-transform duration-200" :class="libraryExpandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down text-[var(--text-muted)]'"></span>
                                <span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span>
                                <div class="flex items-center justify-center rounded-full bg-[var(--bg-panel)] border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ group.models.length }}</div>
                            </div>
                        </button>

                        <div v-show="libraryExpandedGroups[group.group] !== false" class="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)] bg-[var(--bg-panel)]">
                            <div v-for="(model, index) in group.models" :key="`${group.group}-${model.id}`" class="flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-hover)]/40 transition-colors" :class="{'opacity-60': model.state !== 'enabled'}">
                                <div class="flex items-center gap-3 min-w-0 flex-1 pr-4">
                                    <div class="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)] shrink-0">
                                        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                    </div>
                                    <div class="min-w-0 flex flex-col">
                                        <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div>
                                        <div class="truncate text-[11px] text-[var(--text-muted)] mt-0.5">{{ model.id }}</div>
                                    </div>
                                </div>
                                <button class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] active:scale-95" @click="toggleLibraryModel(model)">
                                    <span class="h-4 w-4" :class="model.state === 'enabled' ? 'i-lucide-minus' : 'i-lucide-plus'"></span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 手动添加模型入口 -->
            <div class="shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-3">
                <div class="flex flex-wrap items-center gap-3">
                    <FormInput v-model="getManualModelDraft(activeProvider.id).name" :placeholder="t('settings.panels.models.manualName')" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <FormInput :model-value="getManualModelDraft(activeProvider.id).id" :placeholder="t('settings.panels.models.manualId')" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" @update:model-value="updateManualModelId(activeProvider.id, $event)" />
                    <div class="w-[190px]">
                        <FormSelect v-model="getManualModelDraft(activeProvider.id).api" :options="[{value: '', label: activeProvider.api ? t('settings.panels.models.inheritProviderApi', {api: activeProvider.api}) : providerDefaultApiLabel(activeProvider)}, ...modelApiOptions]" :placeholder="t('settings.panels.models.apiFormat')" />
                    </div>
                    <FormInput v-model="getManualModelDraft(activeProvider.id).api" :placeholder="t('settings.panels.models.customApiFormat')" class="w-[180px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <FormInput v-model="getManualModelDraft(activeProvider.id).contextWindowTokens" :placeholder="t('settings.panels.models.contextWindow')" class="w-[120px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <button class="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] shadow-sm transition-all hover:opacity-90 active:scale-95" @click="addManualModel">
                        {{ t("settings.panels.models.add") }}
                    </button>
                </div>
            </div>
        </div>
    </Dialog>

    <Dialog
        v-model="deleteProviderDialogOpen"
        :title="t('settings.panels.models.deleteProviderTitle')"
        width="420px"
        overlay-type="blur"
        show-cancel
        @confirm="confirmDeleteActiveProvider"
    >
        <div v-if="activeProvider" class="space-y-3">
            <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.deleteProviderMessage", {name: activeProvider.name}) }}</p>
            <p class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">{{ t("settings.panels.models.deleteProviderWarning") }}</p>
        </div>
    </Dialog>

    <NovelIdeModelEditDialog
        v-model="modelEditDialogOpen"
        :editing-model="editingModel"
        :active-provider="activeProvider"
        :inherited-cost="editingModelInheritedCost"
        :model-api-options="modelApiOptions"
        :model-input-options="modelInputOptions"
        :derive-group="deriveGroup"
        :resolve-displayed-context-window="resolveDisplayedContextWindow"
        :model-api-inherit-label="modelApiInheritLabel"
        :model-context-window-default-label="modelContextWindowDefaultLabel"
        :model-max-tokens-default-label="modelMaxTokensDefaultLabel"
        :model-input-display-label="modelInputDisplayLabel"
        :model-input-enabled="modelInputEnabled"
        :model-reasoning-display-label="modelReasoningDisplayLabel"
        @model-id-change="ensureDefaultModelKey"
        @toggle-model-input="toggleModelInput"
        @reset-model-input="($event) => { $event.input = ''; }"
        @reset-model-cost="resetModelCost"
        @enable-model-cost="enableModelCostOverride"
    />
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.2s cubic-bezier(0.34, 1.15, 0.64, 1);
}
.fade-slide-enter-from {
    opacity: 0;
    transform: translateX(10px) scale(0.98);
}
.fade-slide-leave-to {
    opacity: 0;
    transform: translateX(-10px) scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>

