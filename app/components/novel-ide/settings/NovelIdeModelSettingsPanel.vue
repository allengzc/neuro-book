<script setup lang="ts">
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import type {
    CheckModelResponseDto,
    CheckProviderResponseDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    DiscoveredProviderModelDto,
    EnabledModelOptionDto,
    ModelProviderAdapter,
    ModelProviderAdapterType,
    ModelProviderDraftDto,
    UpdateModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import type {ConfigEditorSnapshotDto, ConfigModelSettingsDto, ConfigWorkspaceQueryDto, GlobalConfigDto, ProjectConfigDto, SecretConfigValueDto} from "nbook/shared/dto/config.dto";

type ProviderRequestOptions = UpdateModelSettingsRequestDto["providers"][number]["options"]["requestOptions"];
type ConfigSettingsScope = "global" | "project";

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
    contextWindowTokens: string;
};

type ProviderDraft = {
    id: string;
    name: string;
    adapter: ModelProviderAdapter;
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

type ProviderPreset = {
    value: string;
    label: string;
    providerId: string;
    providerName: string;
    adapter: ModelProviderAdapterType;
    baseURL: string;
    description: string;
};

type StatusState = {
    success: boolean;
    message: string;
};

const providerPresetOptions: ProviderPreset[] = [
    {
        value: "gemini",
        label: "Gemini",
        providerId: "gemini",
        providerName: "Gemini",
        adapter: "gemini-compatible",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        description: "Google Gemini OpenAI-compatible 网关",
    },
    {
        value: "qwen",
        label: "Qwen",
        providerId: "qwen",
        providerName: "Qwen",
        adapter: "openai-compatible",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        description: "阿里云百炼兼容接口",
    },
    {
        value: "doubao",
        label: "Doubao",
        providerId: "doubao",
        providerName: "Doubao",
        adapter: "openai-compatible",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        description: "火山引擎方舟兼容接口",
    },
    {
        value: "deepseek",
        label: "DeepSeek",
        providerId: "deepseek",
        providerName: "DeepSeek",
        adapter: "deepseek-official",
        baseURL: "",
        description: "DeepSeek 官方 Provider",
    },
    {
        value: "siliconflow",
        label: "SiliconFlow",
        providerId: "siliconflow",
        providerName: "SiliconFlow",
        adapter: "openai-compatible",
        baseURL: "https://api.siliconflow.cn/v1",
        description: "SiliconFlow OpenAI-compatible 网关",
    },
    {
        value: "openai",
        label: "OpenAI",
        providerId: "openai",
        providerName: "OpenAI",
        adapter: "openai-official",
        baseURL: "",
        description: "官方 OpenAI 接口",
    },
    {
        value: "custom",
        label: "自定义",
        providerId: "custom-provider",
        providerName: "Custom Provider",
        adapter: "openai-compatible",
        baseURL: "",
        description: "自定义 OpenAI-compatible Provider",
    },
];

const adapterOptions: SelectOption[] = [
    {value: "openai-official", label: "OpenAI Official"},
    {value: "openai-compatible", label: "OpenAI Compatible"},
    {value: "gemini-compatible", label: "Gemini Compatible"},
    {value: "deepseek-official", label: "DeepSeek Official"},
];

/**
 * 判断 adapter 默认是否回放 provider reasoning_content。
 */
function defaultReasoningContentReplay(adapterType: ModelProviderAdapterType): boolean {
    return adapterType === "openai-compatible" || adapterType === "deepseek-official";
}

/**
 * 创建 Provider adapter 配置。
 */
function createAdapterConfig(adapterType: ModelProviderAdapterType): ModelProviderAdapter {
    return {
        type: adapterType,
        reasoningContentReplay: defaultReasoningContentReplay(adapterType),
    };
}

const novelIdeStore = useNovelIdeStore();
const configApi = useConfigApi();

const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const successText = ref("");
const activeProviderId = ref("");
const selectedPreset = ref<string>(providerPresetOptions[0]?.value ?? "gemini");
const draft = ref<ModelSettingsDraft>({
    defaultModelKey: null,
    providers: [],
});
const snapshotText = ref("");
const discoveredModels = ref<Record<string, DiscoveredProviderModelDto[]>>({});
const providerStatusMap = ref<Record<string, StatusState>>({});
const modelStatusMap = ref<Record<string, StatusState>>({});
const resolvedContextWindowMap = ref<Record<string, number | null>>({});
const providerTestingId = ref("");
const providerDiscoveringId = ref("");
const modelTestingKey = ref("");
const manualModelDrafts = ref<Record<string, {name: string; id: string; group: string; contextWindowTokens: string}>>({});
const libraryDialogOpen = ref(false);
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);

const expandedGroups = ref<Record<string, boolean>>({});
const editingModel = ref<ModelDraft | null>(null);
const modelEditDialogOpen = ref(false);
const isProjectScope = computed(() => props.scope === "project");

function toggleGroup(group: string): void {
    expandedGroups.value[group] = !expandedGroups.value[group];
}

function openModelEdit(model: ModelDraft): void {
    editingModel.value = model;
    modelEditDialogOpen.value = true;
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
function cloneProvider(provider: ConfigModelSettingsDto["providers"][number]): ProviderDraft {
    return {
        id: provider.id,
        name: provider.name,
        adapter: provider.adapter,
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
 * 更新当前 Provider adapter 类型。
 */
function updateActiveProviderAdapter(value: string): void {
    if (!activeProvider.value) {
        return;
    }
    activeProvider.value.adapter = createAdapterConfig(value as ModelProviderAdapterType);
}

/**
 * 将接口响应应用到本地草稿。
 */
function applySettings(settings: ConfigModelSettingsDto): void {
    draft.value = {
        defaultModelKey: settings.defaultModelKey,
        providers: settings.providers.map(cloneProvider),
    };
    snapshotText.value = JSON.stringify(buildSavePayload());
    activeProviderId.value = draft.value.providers[0]?.id ?? "";
    discoveredModels.value = {};
    providerStatusMap.value = {};
    modelStatusMap.value = {};
    resolvedContextWindowMap.value = Object.fromEntries(
        settings.enabledModels.map((model) => [model.key, model.contextWindowTokens]),
    );
    manualModelDrafts.value = {};
    novelIdeStore.setSelectedModelLabel(settings.defaultModelLabel);
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
    editorSnapshot.value = snapshot;
    draft.value = {
        defaultModelKey: readProjectDefaultModelKey(snapshot),
        providers: snapshot.modelSettings.providers.map(cloneProvider),
    };
    snapshotText.value = JSON.stringify({defaultModelKey: draft.value.defaultModelKey});
    activeProviderId.value = draft.value.providers[0]?.id ?? "";
    discoveredModels.value = {};
    providerStatusMap.value = {};
    modelStatusMap.value = {};
    resolvedContextWindowMap.value = Object.fromEntries(
        snapshot.modelSettings.enabledModels.map((model) => [model.key, model.contextWindowTokens]),
    );
    manualModelDrafts.value = {};
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
            adapter: provider.adapter,
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
    return {
        ...base,
        models: {
            default: draft.value.defaultModelKey,
            providers: draft.value.providers.map((provider) => ({
                id: provider.id.trim(),
                name: provider.name.trim(),
                adapter: provider.adapter,
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
                    contextWindowTokens: parseContextWindowTokens(model.contextWindowTokens),
                })),
            })),
        },
    };
}

/**
 * 构造 Project Config 写回体，只更新 models.default 覆盖值。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project ?? {};
    return {
        ...base,
        models: {
            ...(base.models ?? {}),
            default: draft.value.defaultModelKey,
        },
    };
}

/**
 * 读取模型设定。
 */
async function loadSettings(): Promise<void> {
    loading.value = true;
    errorText.value = "";
    successText.value = "";

    try {
        const snapshot = await configApi.editorSnapshot(props.targetQuery);
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
        } else {
            applySettings(snapshot.modelSettings);
        }
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "读取模型设定失败";
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
        .filter((model) => model.enabled && model.id.trim())
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
    return draft.value.providers.find((provider) => provider.id === activeProviderId.value) ?? null;
});

/**
 * 当前草稿是否有未保存修改。
 */
const dirty = computed(() => {
    if (isProjectScope.value) {
        return JSON.stringify({defaultModelKey: draft.value.defaultModelKey}) !== snapshotText.value;
    }
    return JSON.stringify(buildSavePayload()) !== snapshotText.value;
});

/**
 * 默认模型候选列表。
 */
const defaultModelOptions = computed<EnabledModelOptionDto[]>(() => {
    return draft.value.providers.flatMap((provider) => provider.models
        .filter((model) => model.enabled && model.id.trim())
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
    if (!provider) {
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
function getManualModelDraft(providerId: string): {name: string; id: string; group: string; contextWindowTokens: string} {
    if (!manualModelDrafts.value[providerId]) {
        manualModelDrafts.value[providerId] = {
            name: "",
            id: "",
            group: "",
            contextWindowTokens: "",
        };
    }

    return manualModelDrafts.value[providerId];
}

/**
 * 新增 Provider 预设。
 */
function addProvider(): void {
    const preset = providerPresetOptions.find((item) => item.value === selectedPreset.value) ?? providerPresetOptions[0];
    if (!preset) {
        return;
    }

    const providerId = buildUniqueProviderId(preset.providerId);
    draft.value.providers.push({
        id: providerId,
        name: preset.providerName,
        adapter: createAdapterConfig(preset.adapter),
        options: {
            apiKey: "",
            baseURL: preset.baseURL,
            proxy: "",
            timeoutMs: "",
            requestOptions: "",
            apiKeyConfigured: false,
            apiKeyMaskedValue: null,
            apiKeyCleared: false,
        },
        models: [],
    });
    activeProviderId.value = providerId;
    successText.value = `已新增 Provider：${preset.label}`;
    errorText.value = "";
}

/**
 * 保存模型设定。
 */
async function saveSettings(): Promise<void> {
    if (!dirty.value || saving.value) {
        return;
    }

    saving.value = true;
    errorText.value = "";
    successText.value = "";

    try {
        const snapshot = isProjectScope.value
            ? await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery)
            : await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery);
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
            successText.value = "Project 默认模型覆盖已保存，后续新发起的请求会使用新的合并配置。";
        } else {
            applySettings(snapshot.modelSettings);
            successText.value = "模型设定已写入 Global Config，后续新发起的请求会使用新的默认模型。";
        }
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "保存模型设定失败";
    } finally {
        saving.value = false;
    }
}

/**
 * 统一设置 Provider 状态提示。
 */
function setProviderStatus(providerId: string, success: boolean, message: string): void {
    providerStatusMap.value = {
        ...providerStatusMap.value,
        [providerId]: {
            success,
            message,
        },
    };
}

/**
 * 统一设置模型状态提示。
 */
function setModelStatus(modelKey: string, success: boolean, message: string): void {
    modelStatusMap.value = {
        ...modelStatusMap.value,
        [modelKey]: {
            success,
            message,
        },
    };
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
    provider.id = normalizedProviderId;
    activeProviderId.value = normalizedProviderId;

    if (previousProviderId === normalizedProviderId) {
        return;
    }

    if (draft.value.defaultModelKey?.startsWith(`${previousProviderId}/`)) {
        draft.value.defaultModelKey = draft.value.defaultModelKey.replace(`${previousProviderId}/`, `${normalizedProviderId}/`);
    }

    if (discoveredModels.value[previousProviderId]) {
        discoveredModels.value = {
            ...discoveredModels.value,
            [normalizedProviderId]: discoveredModels.value[previousProviderId] ?? [],
        };
        delete discoveredModels.value[previousProviderId];
    }

    if (providerStatusMap.value[previousProviderId]) {
        providerStatusMap.value = {
            ...providerStatusMap.value,
            [normalizedProviderId]: providerStatusMap.value[previousProviderId],
        };
        delete providerStatusMap.value[previousProviderId];
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
 * 读取当前 Provider 草稿请求体。
 */
function buildProviderRequest(provider: ProviderDraft): {provider: ModelProviderDraftDto} {
    return {
        provider: {
            id: provider.id.trim(),
            name: provider.name.trim(),
            adapter: provider.adapter,
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

/**
 * 测试 Provider API 连通性。
 */
async function checkProvider(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider || providerTestingId.value) {
        return;
    }

    providerTestingId.value = provider.id;
    setProviderStatus(provider.id, true, "");

    try {
        const result = await $fetch<CheckProviderResponseDto>("/api/config/models/provider-check", {
            method: "POST",
            body: buildProviderRequest(provider),
        });
        setProviderStatus(provider.id, result.success, result.message);
    } catch (error) {
        setProviderStatus(provider.id, false, error instanceof Error ? error.message : "Provider 测试失败");
    } finally {
        providerTestingId.value = "";
    }
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
    setProviderStatus(provider.id, true, "");

    try {
        const result = await $fetch<DiscoverProviderModelsResponseDto>("/api/config/models/provider-discover", {
            method: "POST",
            body: buildProviderRequest(provider),
        });
        discoveredModels.value = {
            ...discoveredModels.value,
            [provider.id]: result.models,
        };
        setProviderStatus(provider.id, true, result.message);
    } catch (error) {
        setProviderStatus(provider.id, false, error instanceof Error ? error.message : "模型发现失败");
    } finally {
        providerDiscoveringId.value = "";
    }
}

/**
 * 启用或新增模型。
 */
function enableModel(model: {name: string; id: string; group: string | null | undefined; contextWindowTokens?: string | number | null | undefined}): void {
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
        existingModel.contextWindowTokens = typeof model.contextWindowTokens === "number"
            ? String(model.contextWindowTokens)
            : model.contextWindowTokens?.trim() ?? "";
    } else {
        provider.models.push({
            name: model.name.trim() || modelId,
            id: modelId,
            group: model.group?.trim() ?? "",
            enabled: true,
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
        errorText.value = "手动添加模型时，模型名称和模型 ID 都不能为空";
        successText.value = "";
        return;
    }

    enableModel({
        name: manualDraft.name,
        id: manualDraft.id,
        group: manualDraft.group,
        contextWindowTokens: manualDraft.contextWindowTokens,
    });

    manualModelDrafts.value = {
        ...manualModelDrafts.value,
        [provider.id]: {
            name: "",
            id: "",
            group: "",
            contextWindowTokens: "",
        },
    };
    errorText.value = "";
    successText.value = "模型已加入当前 Provider 白名单";
}

/**
 * 对单个模型执行健康检查。
 */
async function checkModel(model: ModelDraft): Promise<void> {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }

    const modelKey = `${provider.id}/${model.id}`;
    if (modelTestingKey.value === modelKey) {
        return;
    }

    modelTestingKey.value = modelKey;
    setModelStatus(modelKey, true, "");

    try {
        const result = await $fetch<CheckModelResponseDto>("/api/config/models/model-check", {
            method: "POST",
            body: {
                provider: buildProviderRequest(provider).provider,
                model: {
                    name: model.name.trim(),
                    id: model.id.trim(),
                    group: model.group.trim() || null,
                },
            },
        });
        setModelStatus(modelKey, result.success, result.message);
    } catch (error) {
        setModelStatus(modelKey, false, error instanceof Error ? error.message : "模型健康检查失败");
    } finally {
        modelTestingKey.value = "";
    }
}

/**
 * 获取当前 Provider 下远程抓取到的模型列表。
 */
const currentDiscoveredModels = computed(() => {
    return activeProvider.value ? (discoveredModels.value[activeProvider.value.id] ?? []) : [];
});

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

/**
 * 当前 Provider 卡片的状态提示。
 */
const activeProviderStatus = computed(() => {
    const provider = activeProvider.value;
    if (!provider) {
        return null;
    }
    return providerStatusMap.value[provider.id] ?? null;
});

const librarySearchQuery = ref("");

const unifiedLibraryGroups = computed(() => {
    const provider = activeProvider.value;
    if (!provider) return [];
    
    // Aggregate remote models and disabled models into a Map by group
    const allModelsMap = new Map<string, { name: string; id: string; group: string; state: 'enabled' | 'disabled' | 'remote' }>();
    
    for (const rm of currentDiscoveredModels.value) {
        const group = rm.group || deriveGroup(rm.id);
        allModelsMap.set(rm.id, { name: rm.name, id: rm.id, group, state: resolveDiscoveredModelState(rm.id) === 'enabled' ? 'enabled' : 'remote' });
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
    
    const groupMap = new Map<string, Array<{ name: string; id: string; group: string; state: string }>>();
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

function toggleLibraryModel(model: { name: string; id: string; group: string; state: string }) {
    if (model.state === 'enabled') {
        const existing = activeProvider.value?.models.find(m => m.id === model.id);
        if (existing) disableModel(existing);
    } else {
        enableModel(model);
    }
}

watch(() => activeProviderId.value, (providerId) => {
    if (!providerId) {
        return;
    }

    getManualModelDraft(providerId);
});

onMounted(() => {
    void loadSettings();
});

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.novelId] as const, () => {
    void loadSettings();
});
</script>

<template>
    <!-- 模型设置主容器 -->
    <div class="space-y-4 pt-1">
        <!-- 精简版顶部栏 -->
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? "Project 默认模型" : "模型连接设置" }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? `只覆盖 ${props.targetLabel || "当前 Project"} 的默认模型；Provider 与 API Key 仍来自 Global Config。` : "配置 Provider、API 凭证与模型白名单，这会写入 Workspace Root .nbook/config.json。" }}</p>
            </div>
            
            <button
                class="group relative inline-flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-lg px-4 text-xs font-medium transition-all duration-300 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                :class="dirty ? 'bg-[var(--accent-main)] text-white shadow-md hover:shadow-lg' : 'border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]'"
                :disabled="!dirty || saving"
                @click="void saveSettings()"
            >
                <span v-if="dirty" class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
                <span class="relative flex items-center gap-1.5">
                    <span v-if="saving" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                    <span v-else class="i-lucide-save h-3.5 w-3.5"></span>
                    {{ saving ? "保存中..." : "保存设定" }}
                </span>
            </button>
        </div>

        <!-- 顶部默认模型与新增 Provider -->
        <div class="grid gap-4" :class="isProjectScope ? '' : 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'">
            <div class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-cpu h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ isProjectScope ? "Project 默认模型覆盖" : "全局默认模型" }}</div>
                </div>
                <div class="mb-3 text-xs leading-5 text-[var(--text-secondary)]">{{ isProjectScope ? "选择“跟随 Global 默认模型”会清除 Project Config 中的覆盖值。" : "Agent、续写和 AI 批注都会默认使用该模型。" }}</div>
                <NovelIdeModelSelect
                    :model-value="draft.defaultModelKey"
                    :models="defaultModelOptions"
                    :allow-default="isProjectScope"
                    default-label="跟随 Global 默认模型"
                    placeholder="尚未启用任何模型"
                    @update:model-value="draft.defaultModelKey = $event"
                />
            </div>

            <div v-if="!isProjectScope" class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-input)] text-[var(--text-secondary)]">
                        <span class="i-lucide-network h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">新增 Provider</div>
                </div>
                <div class="mb-3 text-xs leading-5 text-[var(--text-secondary)]">按预设快速创建服务提供商，后续可改为自定义配置。</div>
                <div class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                        <FormSelect :model-value="selectedPreset" :options="providerPresetOptions.map((item) => ({ value: item.value, label: item.label }))" @update:model-value="selectedPreset = $event" />
                    </div>
                    <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] active:scale-95" @click="addProvider">
                        <span class="i-lucide-plus mr-1 h-3 w-3"></span>
                        添加
                    </button>
                </div>
            </div>
        </div>

        <!-- 状态提示条 -->
        <TransitionGroup
            tag="div"
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-2 scale-[0.98]"
            enter-to-class="opacity-100 translate-y-0 scale-100"
            leave-active-class="transition-all duration-200 ease-in absolute w-full"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0 scale-[0.98]"
            class="relative flex flex-col gap-2"
        >
            <div v-if="errorText" key="error" class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm backdrop-blur-md">
                <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 shrink-0 text-rose-500"></span>
                <div class="text-sm text-rose-700">{{ errorText }}</div>
            </div>
            <div v-if="successText" key="success" class="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 shadow-sm backdrop-blur-md">
                <span class="i-lucide-check-circle-2 mt-0.5 h-4 w-4 shrink-0 text-emerald-500"></span>
                <div class="text-sm text-emerald-700">{{ successText }}</div>
            </div>
        </TransitionGroup>

        <!-- Loading State -->
        <div v-if="loading" class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">正在读取模型设定...</span>
        </div>

        <!-- 模型设置双栏布局 -->
        <div v-else-if="!isProjectScope" class="grid min-h-[500px] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
            <!-- 左侧 Provider 列表 -->
            <aside class="flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 shadow-sm">
                <div class="px-3 pb-3 pt-2">
                    <div class="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Providers</div>
                    <div class="mt-1 text-xs text-[var(--text-secondary)] opacity-80">点击配置对应服务商</div>
                </div>

                <div v-if="draft.providers.length === 0" class="m-2 rounded-xl border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-xs leading-6 text-[var(--text-secondary)]">
                    还没有 Provider<br>请从上方新增一个
                </div>

                <div class="flex flex-col gap-1 overflow-y-auto px-1 pb-1 custom-scrollbar">
                    <button
                        v-for="provider in draft.providers"
                        :key="provider.id"
                        class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-300"
                        :class="activeProviderId === provider.id ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        @click="activeProviderId = provider.id"
                    >
                        <!-- 激活状态左侧指示条 -->
                        <div
                            class="absolute left-0 top-1/2 h-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-main)] transition-all duration-300"
                            :class="activeProviderId === provider.id ? 'opacity-100' : 'opacity-0 scale-y-0'"
                        ></div>

                        <span class="i-lucide-server h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" :class="activeProviderId === provider.id ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]'"></span>
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-[13px] font-medium" :class="activeProviderId === provider.id ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ provider.name }}</div>
                            <div class="mt-0.5 truncate text-[11px] opacity-70">{{ provider.models.filter((model) => model.enabled).length }} 个模型</div>
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
                    <section v-if="activeProvider" :key="activeProvider.id" class="space-y-5 pb-8">
                        <!-- Provider 配置卡片 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm transition-all duration-300 hover:shadow-md">
                            <div class="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-color)] pb-4">
                                <div>
                                    <h3 class="text-base font-semibold text-[var(--text-main)]">Provider 配置</h3>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">配置此服务商的 API 访问凭据及适配器类型。</p>
                                </div>

                                <div class="flex flex-wrap items-center gap-2">
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] hover:shadow active:scale-95 disabled:pointer-events-none disabled:opacity-60" :disabled="providerTestingId === activeProvider.id" @click="void checkProvider()">
                                        <span v-if="providerTestingId === activeProvider.id" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                        <span v-else class="i-lucide-activity h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                        {{ providerTestingId === activeProvider.id ? "测试中..." : "连通性测试" }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] hover:shadow active:scale-95 disabled:pointer-events-none disabled:opacity-60" :disabled="providerDiscoveringId === activeProvider.id" @click="void discoverModels()">
                                        <span v-if="providerDiscoveringId === activeProvider.id" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                        <span v-else class="i-lucide-cloud-lightning h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                        {{ providerDiscoveringId === activeProvider.id ? "抓取中..." : "查询可用模型" }}
                                    </button>
                                </div>
                            </div>

                            <Transition
                                enter-active-class="transition-all duration-300 ease-out"
                                enter-from-class="opacity-0 -translate-y-2"
                                enter-to-class="opacity-100 translate-y-0"
                                leave-active-class="transition-all duration-200 ease-in"
                                leave-from-class="opacity-100"
                                leave-to-class="opacity-0"
                            >
                                <div v-if="activeProviderStatus?.message" class="mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-sm backdrop-blur-sm" :class="activeProviderStatus.success ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-rose-500/20 bg-rose-500/10 text-rose-700'">
                                    <span class="mt-0.5 shrink-0 h-3.5 w-3.5" :class="activeProviderStatus.success ? 'i-lucide-check-circle text-emerald-500' : 'i-lucide-x-circle text-rose-500'"></span>
                                    <span>{{ activeProviderStatus.message }}</span>
                                </div>
                            </Transition>

                            <!-- Provider 表单 -->
                            <div class="mt-5 grid gap-4 md:grid-cols-2">
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">Provider ID</label>
                                    <FormInput :model-value="activeProvider.id" placeholder="provider id" @update:model-value="renameActiveProviderId" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">Provider 名称</label>
                                    <FormInput v-model="activeProvider.name" placeholder="Provider 名称" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">Adapter</label>
                                    <FormSelect :model-value="activeProvider.adapter.type" :options="adapterOptions" @update:model-value="updateActiveProviderAdapter" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Base</label>
                                    <FormInput v-model="activeProvider.options.baseURL" placeholder="可留空，使用 adapter 默认地址" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <div class="flex items-center justify-between gap-3">
                                        <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Key</label>
                                        <button v-if="activeProvider.options.apiKeyConfigured" type="button" class="text-[11px] text-rose-500 transition-colors hover:text-rose-600" @click="clearActiveProviderApiKey">清空密钥</button>
                                    </div>
                                    <FormInput v-model="activeProvider.options.apiKey" :placeholder="activeProvider.options.apiKeyConfigured ? `已配置 ${activeProvider.options.apiKeyMaskedValue ?? ''}；留空则保留` : 'sk-...'" type="password" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">代理</label>
                                    <FormInput v-model="activeProvider.options.proxy" placeholder="http://127.0.0.1:7890" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">请求超时</label>
                                    <FormInput v-model="activeProvider.options.timeoutMs" placeholder="默认 180000" type="number" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">请求扩展参数</label>
                                    <textarea v-model="activeProvider.options.requestOptions" rows="4" placeholder="{&quot;store&quot;:false}" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 font-mono text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"></textarea>
                                </div>
                            </div>
                        </div>

                        <!-- 已启用模型 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm transition-all duration-300 hover:shadow-md overflow-hidden">
                            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4 bg-[var(--bg-panel)]">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="text-base font-semibold text-[var(--text-main)]">已启用模型</h3>
                                        <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{{ activeProvider.models.filter(m => m.enabled).length }}</div>
                                    </div>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">按 Group 分组展示。右侧管理可查询更多。</p>
                                </div>
                            </div>

                            <div class="p-3 bg-[var(--bg-input)]/20 min-h-[150px]">
                                <div v-if="enabledModelGroups.length === 0" class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-color)] py-8 text-center bg-[var(--bg-panel)]">
                                    <span class="i-lucide-box h-5 w-5 text-[var(--text-muted)]"></span>
                                    <div class="text-sm text-[var(--text-secondary)]">当前 Provider 未启用任何模型</div>
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
                                                    <div class="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-500 shrink-0">
                                                        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                                    </div>
                                                    <div class="min-w-0 flex flex-col">
                                                        <div class="flex items-center gap-2">
                                                            <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div>
                                                            <span v-if="resolveDisplayedContextWindow(activeProvider.id, model)" class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ resolveDisplayedContextWindow(activeProvider.id, model) }} ctx
                                                            </span>
                                                        </div>
                                                        <Transition name="fade" mode="out-in">
                                                            <div v-if="modelStatusMap[`${activeProvider.id}/${model.id}`]?.message" class="truncate text-[11px] font-medium mt-0.5" :class="modelStatusMap[`${activeProvider.id}/${model.id}`]?.success ? 'text-emerald-600' : 'text-rose-600'">
                                                                {{ modelStatusMap[`${activeProvider.id}/${model.id}`]?.message }}
                                                            </div>
                                                            <div v-else class="truncate text-[11px] text-[var(--text-muted)] mt-0.5">{{ model.id }}</div>
                                                        </Transition>
                                                    </div>
                                                </div>

                                                <div class="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover/model:opacity-100">
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] transition-colors disabled:opacity-50" :disabled="modelTestingKey === `${activeProvider.id}/${model.id}`" title="测试模型" @click="void checkModel(model)">
                                                        <span v-if="modelTestingKey === `${activeProvider.id}/${model.id}`" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                                        <span v-else class="i-lucide-play h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] transition-colors" title="编辑设置" @click="openModelEdit(model)">
                                                        <span class="i-lucide-settings h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-500 transition-colors" title="弃用/移除" @click="disableModel(model)">
                                                        <span class="i-lucide-minus h-3.5 w-3.5"></span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-panel)] border-t border-[var(--border-color)]">
                                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-600/20 bg-emerald-500/10 px-4 text-xs font-medium text-emerald-600 shadow-sm transition-all duration-200 hover:bg-emerald-500/20 active:scale-95" @click="libraryDialogOpen = true">
                                    <span class="i-lucide-list-filter h-3.5 w-3.5"></span>
                                    管理模型库
                                </button>
                                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="libraryDialogOpen = true">
                                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                    添加
                                </button>
                            </div>
                        </div>
                    </section>

                    <section v-else class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-8 py-10 text-center shadow-sm">
                        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-input)] shadow-inner">
                            <span class="i-lucide-server-off h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                        </div>
                        <div>
                            <div class="text-base font-medium text-[var(--text-main)]">未选择 Provider</div>
                            <div class="mt-1 text-sm text-[var(--text-secondary)]">请从左侧选择一个服务商，或在上方新增。</div>
                        </div>
                    </section>
                </Transition>
            </div>
        </div>
    </div>

        <Dialog
        v-model="libraryDialogOpen"
        :title="activeProvider ? `${activeProvider.name} 模型` : '模型管理库'"
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
                    <input v-model="librarySearchQuery" type="text" placeholder="搜索模型 ID 或名称" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]" />
                </div>
                <button class="flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="providerDiscoveringId === activeProvider.id" title="重新获取可用模型" @click="void discoverModels()">
                    <span class="h-4 w-4" :class="providerDiscoveringId === activeProvider.id ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>
                    刷新
                </button>
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 min-h-0">
                <div v-if="unifiedLibraryGroups.length === 0" class="flex h-full flex-col items-center justify-center py-20 text-center">
                    <span class="i-lucide-search-x mb-2 h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                    <span class="text-sm text-[var(--text-muted)]">未找到匹配的模型</span>
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
                                    <div class="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-500 shrink-0">
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
                    <FormInput v-model="getManualModelDraft(activeProvider.id).name" placeholder="手动添加名称" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <FormInput v-model="getManualModelDraft(activeProvider.id).id" placeholder="手动添加 ID" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <FormInput v-model="getManualModelDraft(activeProvider.id).contextWindowTokens" placeholder="上下文窗口" class="w-[120px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <button class="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-main)] text-white px-3 text-xs font-medium shadow-sm transition-all hover:opacity-90 active:scale-95" @click="addManualModel">
                        添加
                    </button>
                </div>
            </div>
        </div>
    </Dialog>

    <Dialog
        v-model="modelEditDialogOpen"
        title="模型设置"
        width="460px"
        overlay-type="blur"
        :show-footer="false"
    >
        <div v-if="editingModel" class="flex flex-col gap-4 p-1">
            <div class="space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">模型名称</label>
                <FormInput v-model="editingModel.name" placeholder="模型名称" class="bg-[var(--bg-input)] shadow-sm" />
            </div>
            <div class="space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">模型 ID</label>
                <FormInput v-model="editingModel.id" placeholder="模型 ID" class="bg-[var(--bg-input)] shadow-sm" @update:model-value="ensureDefaultModelKey()" />
            </div>
            <div class="space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">分组 (留空自动推导)</label>
                <FormInput v-model="editingModel.group" :placeholder="`默认推导: ${deriveGroup(editingModel.id)}`" class="bg-[var(--bg-input)] shadow-sm" />
            </div>
            <div class="space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">上下文窗口</label>
                <FormInput v-model="editingModel.contextWindowTokens" :placeholder="activeProvider ? `留空不配置${resolveDisplayedContextWindow(activeProvider.id, editingModel) ? `，当前 ${resolveDisplayedContextWindow(activeProvider.id, editingModel)}` : ''}` : '留空不配置'" class="bg-[var(--bg-input)] shadow-sm" />
            </div>
        </div>
    </Dialog>
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

