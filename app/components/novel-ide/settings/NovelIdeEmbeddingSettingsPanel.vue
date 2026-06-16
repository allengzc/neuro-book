<script setup lang="ts">
import FormCheckbox from "nbook/app/components/common/form/FormCheckbox.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, EmbeddingProjectConfigDto, EmbeddingServiceConfigDto, GlobalConfigDto, ProjectConfigDto, SecretConfigValueDto} from "nbook/shared/dto/config.dto";

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

type EmbeddingGlobalDraft = {
    enabled: boolean;
    provider: "openai-compatible";
    model: string;
    dimensions: string;
    apiKey: string;
    apiKeyConfigured: boolean;
    apiKeyMaskedValue: string | null;
    apiKeyCleared: boolean;
    baseURL: string;
    timeoutMs: string;
    requestOptions: string;
};

type EmbeddingProjectDraft = {
    model: string;
    dimensions: string;
};

type EmbeddingRequestOptions = EmbeddingServiceConfigDto["requestOptions"];

const DEFAULT_GLOBAL_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS = 30000;
const configApi = useConfigApi();
const notification = useNotification();
const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const globalDraft = ref<EmbeddingGlobalDraft>(createGlobalDraft());
const projectDraft = ref<EmbeddingProjectDraft>(createProjectDraft());
const snapshotText = ref("");

const isProjectScope = computed(() => props.scope === "project");
const providerOptions: SelectOption[] = [
    {value: "openai-compatible", label: "OpenAI Compatible", description: "POST /embeddings"},
];
const dirty = computed(() => JSON.stringify(isProjectScope.value ? buildProjectEmbeddingPayload() : buildGlobalEmbeddingPayload()) !== snapshotText.value);

/**
 * 创建 Global embedding 草稿。
 */
function createGlobalDraft(): EmbeddingGlobalDraft {
    return {
        enabled: false,
        provider: "openai-compatible",
        model: "",
        dimensions: "",
        apiKey: "",
        apiKeyConfigured: false,
        apiKeyMaskedValue: null,
        apiKeyCleared: false,
        baseURL: "",
        timeoutMs: "",
        requestOptions: "",
    };
}

/**
 * 创建 Project embedding 覆盖草稿。
 */
function createProjectDraft(): EmbeddingProjectDraft {
    return {
        model: "",
        dimensions: "",
    };
}

/**
 * 应用后端配置快照。
 */
function applySettings(snapshot: ConfigEditorSnapshotDto): void {
    editorSnapshot.value = snapshot;
    const global = snapshot.embeddingSettings.global;
    const project = snapshot.embeddingSettings.project;
    globalDraft.value = {
        enabled: global.enabled,
        provider: global.provider,
        model: global.model ?? "",
        dimensions: stringifyNullableNumber(global.dimensions),
        apiKey: "",
        apiKeyConfigured: global.apiKey.configured,
        apiKeyMaskedValue: global.apiKey.maskedValue,
        apiKeyCleared: false,
        baseURL: global.baseURL,
        timeoutMs: stringifyNullableNumber(global.timeoutMs),
        requestOptions: Object.keys(global.requestOptions).length > 0
            ? JSON.stringify(global.requestOptions, null, 2)
            : "",
    };
    projectDraft.value = {
        model: project?.model ?? "",
        dimensions: stringifyNullableNumber(project?.dimensions),
    };
    snapshotText.value = JSON.stringify(isProjectScope.value ? buildProjectEmbeddingPayload() : buildGlobalEmbeddingPayload());
}

/**
 * 构造 secret 写回负载；空输入表示保留旧值。
 */
function buildSecretPayload(): SecretConfigValueDto {
    return {
        configured: globalDraft.value.apiKeyConfigured,
        maskedValue: globalDraft.value.apiKeyMaskedValue,
        ...(globalDraft.value.apiKeyCleared ? {value: ""} : {}),
        ...(!globalDraft.value.apiKeyCleared && globalDraft.value.apiKey.trim() ? {value: globalDraft.value.apiKey.trim()} : {}),
    };
}

/**
 * 构造 Global embedding 配置段。
 */
function buildGlobalEmbeddingPayload(): EmbeddingServiceConfigDto {
    const model = normalizeNullableText(globalDraft.value.model);
    const dimensions = parseNullablePositiveInteger(globalDraft.value.dimensions);
    const timeoutMs = parseNullablePositiveInteger(globalDraft.value.timeoutMs);
    return {
        enabled: globalDraft.value.enabled,
        provider: globalDraft.value.provider,
        model: model ?? (globalDraft.value.enabled ? DEFAULT_GLOBAL_EMBEDDING_MODEL : null),
        dimensions: dimensions ?? (globalDraft.value.enabled ? DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS : null),
        apiKey: buildSecretPayload(),
        baseURL: globalDraft.value.baseURL.trim(),
        timeoutMs: timeoutMs ?? DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS,
        requestOptions: parseRequestOptions(globalDraft.value.requestOptions),
    };
}

/**
 * 构造 Project embedding 覆盖段。
 */
function buildProjectEmbeddingPayload(): EmbeddingProjectConfigDto {
    return {
        model: normalizeNullableText(projectDraft.value.model),
        dimensions: parseNullablePositiveInteger(projectDraft.value.dimensions),
    };
}

/**
 * 构造 Global Config 写回体，只替换 embedding 段。
 */
function buildGlobalConfigPayload(): GlobalConfigDto {
    const base = editorSnapshot.value?.global ?? {};
    return {
        ...base,
        embedding: buildGlobalEmbeddingPayload(),
    };
}

/**
 * 构造 Project Config 写回体，只替换 embedding 覆盖段。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project ?? {};
    return {
        ...base,
        embedding: buildProjectEmbeddingPayload(),
    };
}

/**
 * 读取 Embedding 配置。
 */
async function loadSettings(): Promise<void> {
    loading.value = true;
    errorText.value = "";
    try {
        applySettings(await configApi.editorSnapshot(props.targetQuery));
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, "读取 Embedding 配置失败");
    } finally {
        loading.value = false;
    }
}

/**
 * 保存 Embedding 配置。
 */
async function saveSettings(): Promise<void> {
    if (!dirty.value || saving.value) {
        return;
    }
    saving.value = true;
    errorText.value = "";
    try {
        const snapshot = isProjectScope.value
            ? await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery)
            : await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery);
        applySettings(snapshot);
        notification.success(isProjectScope.value ? "Project Embedding 覆盖已保存。" : "Embedding 服务配置已写入 Global Config。");
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, "保存 Embedding 配置失败");
    } finally {
        saving.value = false;
    }
}

/**
 * 清空 Global Embedding API Key。
 */
function clearApiKey(): void {
    globalDraft.value.apiKey = "";
    globalDraft.value.apiKeyConfigured = false;
    globalDraft.value.apiKeyMaskedValue = null;
    globalDraft.value.apiKeyCleared = true;
}

function stringifyNullableNumber(value: unknown): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * 空字符串写成 null，表示继承上层配置或保持未配置。
 */
function normalizeNullableText(value: string): string | null {
    const normalized = value.trim();
    return normalized ? normalized : null;
}

/**
 * 解析正整数输入；非法值按未配置处理。
 */
function parseNullablePositiveInteger(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

/**
 * 解析 OpenAI-compatible embedding 请求扩展参数。
 */
function parseRequestOptions(value: string): EmbeddingRequestOptions {
    const normalized = value.trim();
    if (!normalized) {
        return {};
    }
    try {
        const parsed = JSON.parse(normalized);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as EmbeddingRequestOptions
            : {};
    } catch {
        return {};
    }
}

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectPath] as const, () => {
    void loadSettings();
});

onMounted(() => {
    void loadSettings();
});

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
});
</script>

<template>
    <!-- Embedding 服务配置 -->
    <div class="space-y-4 pt-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? "Project Embedding 覆盖" : "Embedding 服务" }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? `只覆盖 ${props.targetLabel || "当前 Project"} 的 embedding 模型名与维度。` : "配置 NeuroBook 自己调用的 OpenAI-compatible embedding 服务；不使用 Pi 模型目录。" }}</p>
            </div>
        </div>

        <div v-if="errorText" class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm">
            <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 shrink-0 text-rose-500"></span>
            <div class="text-sm text-rose-700">{{ errorText }}</div>
        </div>

        <div v-if="loading" class="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">正在读取 Embedding 配置...</span>
        </div>

        <div v-else-if="isProjectScope" class="grid gap-4">
            <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 shadow-sm">
                <div class="mb-4 flex items-center gap-2">
                    <span class="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-folder-cog h-3.5 w-3.5"></span>
                    </span>
                    <h4 class="text-xs font-bold tracking-wider text-[var(--text-main)]">Project 覆盖</h4>
                </div>

                <div class="grid gap-3 md:grid-cols-2">
                    <label class="space-y-1.5">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">模型名</span>
                        <FormInput v-model="projectDraft.model" placeholder="留空继承 Global" />
                    </label>
                    <label class="space-y-1.5">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">维度</span>
                        <FormInput v-model="projectDraft.dimensions" type="number" min="1" step="1" placeholder="留空继承 Global" />
                    </label>
                </div>

                <div class="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                    Project Config 不保存 provider、baseURL、API Key 或 requestOptions；这些服务级字段统一来自 Global Config。
                </div>
            </section>
        </div>

        <div v-else class="grid gap-4">
            <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 shadow-sm">
                <div class="mb-4 flex items-start justify-between gap-4">
                    <div class="flex items-center gap-2">
                        <span class="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-binary h-3.5 w-3.5"></span>
                        </span>
                        <h4 class="text-xs font-bold tracking-wider text-[var(--text-main)]">服务配置</h4>
                    </div>
                    <FormCheckbox v-model="globalDraft.enabled" :label="globalDraft.enabled ? '已启用' : '未启用'" />
                </div>

                <div class="grid gap-3 md:grid-cols-2">
                    <label class="space-y-1.5">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">Provider</span>
                        <FormSelect v-model="globalDraft.provider" :options="providerOptions" />
                    </label>
                    <label class="space-y-1.5">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">模型名</span>
                        <FormInput v-model="globalDraft.model" :placeholder="DEFAULT_GLOBAL_EMBEDDING_MODEL" />
                    </label>
                    <label class="space-y-1.5">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">维度</span>
                        <FormInput v-model="globalDraft.dimensions" type="number" min="1" step="1" :placeholder="String(DEFAULT_GLOBAL_EMBEDDING_DIMENSIONS)" />
                    </label>
                    <label class="space-y-1.5">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">Timeout ms</span>
                        <FormInput v-model="globalDraft.timeoutMs" type="number" min="1000" step="1000" :placeholder="String(DEFAULT_GLOBAL_EMBEDDING_TIMEOUT_MS)" />
                    </label>
                    <label class="space-y-1.5 md:col-span-2">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">Base URL</span>
                        <FormInput v-model="globalDraft.baseURL" placeholder="https://api.openai.com/v1" />
                    </label>
                    <label class="space-y-1.5 md:col-span-2">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">API Key</span>
                        <div class="flex gap-2">
                            <FormInput v-model="globalDraft.apiKey" type="password" :placeholder="globalDraft.apiKeyConfigured ? globalDraft.apiKeyMaskedValue ?? '已配置，留空保留' : 'sk-...'" />
                            <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 text-[11px] font-medium text-rose-600 hover:bg-rose-500/20" @click="clearApiKey">
                                <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                清空
                            </button>
                        </div>
                    </label>
                    <label class="space-y-1.5 md:col-span-2">
                        <span class="text-xs font-medium text-[var(--text-secondary)]">Request Options JSON</span>
                        <textarea v-model="globalDraft.requestOptions" rows="5" placeholder="{&quot;encoding_format&quot;:&quot;float&quot;}" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 font-mono text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"></textarea>
                    </label>
                </div>
            </section>
        </div>
    </div>
</template>
