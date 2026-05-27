<script setup lang="ts">
import type {
    AgentProfileModelConfigDto,
    AgentProfileModelSettingsDto,
    ThinkingLevelDto,
} from "nbook/shared/dto/app-settings.dto";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import type {ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";

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

type AgentProfileDraft = {
    profileKey: string;
    name: string;
    model: AgentProfileModelDraft;
};

type AgentProfileModelDraft = {
    modelKey: string | null;
    temperature: string;
    topK: string;
    reasoningEffort: ThinkingLevelDto | null;
    stream: boolean | null;
};

const reasoningEffortBaseOptions: SelectOption[] = [
    {value: "off", label: "关闭"},
    {value: "minimal", label: "极低"},
    {value: "low", label: "低"},
    {value: "medium", label: "中"},
    {value: "high", label: "高"},
    {value: "xhigh", label: "极高"},
];

const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const successText = ref("");
const enabledModels = ref<AgentProfileModelSettingsDto["enabledModels"]>([]);
const profileModelDefaults = ref<AgentProfileModelDraft>({
    modelKey: null,
    temperature: "",
    topK: "",
    reasoningEffort: "off",
    stream: true,
});
const profiles = ref<AgentProfileDraft[]>([]);
const snapshotText = ref("");
const configApi = useConfigApi();
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const isProjectScope = computed(() => props.scope === "project");

/**
 * 将数字配置转成表单文本。
 */
function stringifyNullableNumber(value: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * 将表单文本解析为可空数字。
 */
function parseNullableNumber(value: string | number | null | undefined, integerOnly = false): number | null {
    const normalized = typeof value === "number" ? String(value) : value?.trim() ?? "";
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return integerOnly ? Math.trunc(parsed) : parsed;
}

function thinkingLevelLabel(level: ThinkingLevelDto): string {
    switch (level) {
        case "off": return "关闭";
        case "minimal": return "极低";
        case "low": return "低";
        case "medium": return "中";
        case "high": return "高";
        case "xhigh": return "极高";
    }
}

function streamLabel(value: boolean): string {
    return value ? "开启" : "关闭";
}

function streamSelectValue(value: boolean | null): string {
    if (value === null) {
        return "inherit";
    }
    return value ? "true" : "false";
}

function parseStreamSelectValue(value: string): boolean | null {
    if (value === "inherit") {
        return null;
    }
    return value === "true";
}

function reasoningEffortDefaultLabel(profile: AgentProfileDraft): string {
    return `默认（${thinkingLevelLabel(resolveProfileInheritedModel(profile).reasoningEffort ?? "off")}）`;
}

function streamDefaultLabel(profile: AgentProfileDraft): string {
    return `默认（${streamLabel(resolveProfileInheritedModel(profile).stream ?? true)}）`;
}

function reasoningEffortOptionsForProfile(profile: AgentProfileDraft): SelectOption[] {
    return [{value: "inherit", label: reasoningEffortDefaultLabel(profile)}, ...reasoningEffortBaseOptions];
}

function streamOptionsForProfile(profile: AgentProfileDraft): SelectOption[] {
    return [
        {value: "inherit", label: streamDefaultLabel(profile)},
        {value: "true", label: "开启"},
        {value: "false", label: "关闭"},
    ];
}

function setDefaultReasoningEffort(value: string): void {
    profileModelDefaults.value.reasoningEffort = value === "inherit" ? null : value as ThinkingLevelDto;
}

function setProfileReasoningEffort(profile: AgentProfileDraft, value: string): void {
    profile.model.reasoningEffort = value === "inherit" ? null : value as ThinkingLevelDto;
}

function setDefaultStream(value: string): void {
    profileModelDefaults.value.stream = parseStreamSelectValue(value);
}

function setProfileStream(profile: AgentProfileDraft, value: string): void {
    profile.model.stream = parseStreamSelectValue(value);
}

/**
 * 克隆模型草稿。
 */
function cloneModelDraft(model: Partial<AgentProfileModelConfigDto> | undefined): AgentProfileModelDraft {
    return {
        modelKey: model?.modelKey ?? null,
        temperature: stringifyNullableNumber(model?.temperature ?? null),
        topK: stringifyNullableNumber(model?.topK ?? null),
        reasoningEffort: model?.reasoningEffort ?? null,
        stream: typeof model?.stream === "boolean" ? model.stream : null,
    };
}

/**
 * 构造 Global Config 写回体，只替换 agent.profiles。
 */
function buildGlobalConfigPayload(): GlobalConfigDto {
    const base = editorSnapshot.value?.global ?? {};
    const defaultProfileKey: NonNullable<NonNullable<GlobalConfigDto["agent"]>["defaultProfileKey"]> = {
        novel: base.agent?.defaultProfileKey?.novel ?? null,
        userAssets: base.agent?.defaultProfileKey?.userAssets ?? null,
    };
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: {
                novel: defaultProfileKey.novel ?? null,
                userAssets: defaultProfileKey.userAssets ?? null,
            },
            profileModelDefaults: buildCompleteModelConfig(profileModelDefaults.value),
            profiles: Object.fromEntries(profiles.value.flatMap((profile) => {
                const modelPatch = buildModelPatch(profile.model);
                return Object.keys(modelPatch).length > 0
                    ? [[profile.profileKey, {model: modelPatch}] as const]
                    : [];
            })),
        },
    };
}

/**
 * 构造 Project Config 写回体，只替换 agent.profiles 覆盖。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project ?? {};
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            profileModelDefaults: buildModelPatch(profileModelDefaults.value),
            profiles: Object.fromEntries(profiles.value.flatMap((profile) => {
                const modelPatch = buildProjectModelPatch(profile.model);
                return Object.keys(modelPatch).length > 0
                    ? [[profile.profileKey, {model: modelPatch}] as const]
                    : [];
            })),
        },
    };
}

/**
 * Project 覆盖只写用户显式填写的字段，空字段回落 Global。
 */
function buildProjectModelPatch(model: AgentProfileModelDraft): Partial<AgentProfileModelConfigDto> {
    return buildModelPatch(model);
}

function buildModelPatch(model: AgentProfileModelDraft): Partial<AgentProfileModelConfigDto> {
    const temperature = parseNullableNumber(model.temperature);
    const topK = parseNullableNumber(model.topK, true);
    return {
        ...(model.modelKey ? {modelKey: model.modelKey} : {}),
        ...(temperature !== null ? {temperature} : {}),
        ...(topK !== null ? {topK} : {}),
        ...(model.reasoningEffort !== null ? {reasoningEffort: model.reasoningEffort} : {}),
        ...(model.stream !== null ? {stream: model.stream} : {}),
    };
}

function buildCompleteModelConfig(model: AgentProfileModelDraft): AgentProfileModelConfigDto {
    return {
        modelKey: model.modelKey,
        temperature: parseNullableNumber(model.temperature),
        topK: parseNullableNumber(model.topK, true),
        reasoningEffort: model.reasoningEffort ?? "off",
        stream: model.stream ?? true,
    };
}

/**
 * 将接口响应应用到本地。
 */
function applySettings(settings: AgentProfileModelSettingsDto): void {
    enabledModels.value = settings.enabledModels;
    profileModelDefaults.value = cloneModelDraft(settings.profileModelDefaults);
    if (profileModelDefaults.value.reasoningEffort === null) {
        profileModelDefaults.value.reasoningEffort = "off";
    }
    if (profileModelDefaults.value.stream === null) {
        profileModelDefaults.value.stream = true;
    }
    profiles.value = settings.agentProfiles.map((profile) => ({
        profileKey: profile.profileKey,
        name: profile.name,
        model: cloneModelDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.model),
    }));
    snapshotText.value = JSON.stringify(buildGlobalSavePayload());
}

/**
 * 将 Project Config 中的 profile 覆盖应用到本地草稿。
 */
function applyProjectSettings(snapshot: ConfigEditorSnapshotDto): void {
    enabledModels.value = snapshot.agentProfileSettings.enabledModels;
    profileModelDefaults.value = cloneModelDraft(snapshot.project?.agent?.profileModelDefaults);
    profiles.value = snapshot.agentProfileSettings.agentProfiles.map((profile) => {
        const override = snapshot.project?.agent?.profiles?.[profile.profileKey]?.model;
        return {
            profileKey: profile.profileKey,
            name: profile.name,
            model: cloneModelDraft(override),
        };
    });
    snapshotText.value = JSON.stringify(buildProjectDirtyPayload());
}

/**
 * 读取 Project 覆盖保存形态，用于脏检查。
 */
function buildProjectSavePayload(): Record<string, {model: Partial<AgentProfileModelConfigDto>}> {
    return Object.fromEntries(profiles.value.flatMap((profile) => {
        const modelPatch = buildProjectModelPatch(profile.model);
        return Object.keys(modelPatch).length > 0
            ? [[profile.profileKey, {model: modelPatch}] as const]
            : [];
    }));
}

function buildGlobalSavePayload(): Record<string, unknown> {
    return {
        profileModelDefaults: buildCompleteModelConfig(profileModelDefaults.value),
        profiles: Object.fromEntries(profiles.value.flatMap((profile) => {
            const modelPatch = buildModelPatch(profile.model);
            return Object.keys(modelPatch).length > 0
                ? [[profile.profileKey, {model: modelPatch}] as const]
                : [];
        })),
    };
}

function buildProjectDirtyPayload(): Record<string, unknown> {
    return {
        profileModelDefaults: buildModelPatch(profileModelDefaults.value),
        profiles: buildProjectSavePayload(),
    };
}

/**
 * 读取 Agent Profile 模型设定。
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
            applySettings(snapshot.agentProfileSettings);
        }
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "读取 Agent Profile 模型设定失败";
    } finally {
        loading.value = false;
    }
}

/**
 * 保存 Agent Profile 模型设定。
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
            successText.value = "Agent Profile 模型覆盖已写入 Project Config。";
        } else {
            applySettings(snapshot.agentProfileSettings);
            successText.value = "Agent Profile 模型设定已写入 Global Config。";
        }
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "保存 Agent Profile 模型设定失败";
    } finally {
        saving.value = false;
    }
}

/**
 * 重置单个 profile 到默认配置。
 */
function resetProfile(profile: AgentProfileDraft): void {
    profile.model = {
        modelKey: null,
        temperature: "",
        topK: "",
        reasoningEffort: null,
        stream: null,
    };
}

function resetProfileModelDefaults(): void {
    profileModelDefaults.value = isProjectScope.value
        ? cloneModelDraft(undefined)
        : {
            modelKey: null,
            temperature: "",
            topK: "",
            reasoningEffort: "off",
            stream: true,
        };
}

function globalProfileModelDefaults(): AgentProfileModelConfigDto {
    const raw = editorSnapshot.value?.global.agent?.profileModelDefaults ?? {};
    return {
        modelKey: raw.modelKey ?? null,
        temperature: raw.temperature ?? null,
        topK: raw.topK ?? null,
        reasoningEffort: raw.reasoningEffort ?? "off",
        stream: raw.stream ?? true,
    };
}

function mergeModelConfig(base: AgentProfileModelConfigDto, patch: AgentProfileModelDraft): AgentProfileModelConfigDto {
    return {
        modelKey: patch.modelKey ?? base.modelKey,
        temperature: parseNullableNumber(patch.temperature) ?? base.temperature,
        topK: parseNullableNumber(patch.topK, true) ?? base.topK,
        reasoningEffort: patch.reasoningEffort ?? base.reasoningEffort ?? "off",
        stream: patch.stream ?? base.stream ?? true,
    };
}

function resolvedProfileModelDefaults(): AgentProfileModelConfigDto {
    if (isProjectScope.value) {
        return mergeModelConfig(globalProfileModelDefaults(), profileModelDefaults.value);
    }
    return buildCompleteModelConfig(profileModelDefaults.value);
}

function resolveProfileInheritedModel(profile: AgentProfileDraft): AgentProfileModelConfigDto {
    if (isProjectScope.value) {
        return mergeModelConfig(resolvedProfileModelDefaults(), cloneModelDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.model));
    }
    return resolvedProfileModelDefaults();
}

function modelDefaultLabel(profile: AgentProfileDraft): string {
    const defaultKey = resolveProfileInheritedModel(profile).modelKey;
    return defaultKey ? `默认（${defaultKey}）` : "默认（跟随全局默认模型）";
}

function defaultModelSelectLabel(): string {
    if (!isProjectScope.value) {
        return "跟随全局默认模型";
    }
    const inherited = globalProfileModelDefaults().modelKey;
    return inherited ? `继承 Global（${inherited}）` : "继承 Global（跟随全局默认模型）";
}

function defaultReasoningOptions(): SelectOption[] {
    if (!isProjectScope.value) {
        return reasoningEffortBaseOptions;
    }
    return [{value: "inherit", label: `继承 Global（${thinkingLevelLabel(globalProfileModelDefaults().reasoningEffort ?? "off")}）`}, ...reasoningEffortBaseOptions];
}

function defaultStreamOptions(): SelectOption[] {
    if (!isProjectScope.value) {
        return [
            {value: "true", label: "开启"},
            {value: "false", label: "关闭"},
        ];
    }
    return [
        {value: "inherit", label: `继承 Global（${streamLabel(globalProfileModelDefaults().stream ?? true)}）`},
        {value: "true", label: "开启"},
        {value: "false", label: "关闭"},
    ];
}

const dirty = computed(() => JSON.stringify(isProjectScope.value ? buildProjectDirtyPayload() : buildGlobalSavePayload()) !== snapshotText.value);

const sortedProfiles = computed(() => [...profiles.value].sort((left, right) => left.profileKey.localeCompare(right.profileKey)));

onMounted(() => {
    void loadSettings();
});

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectPath] as const, () => {
    void loadSettings();
});
</script>

<template>
    <!-- Agent Profile 模型设置 -->
    <div class="space-y-4 pt-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? "Project Agent Profile 模型覆盖" : "Agent Profile 模型" }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? `只覆盖 ${props.targetLabel || "当前 Project"} 的 Profile 模型参数；留空表示回落 Global。` : "先设置所有 Profile 共同继承的默认参数，再按 Profile 做局部覆盖。session 级覆盖只影响当前 session 的后续新 run。" }}</p>
            </div>

            <button
                class="group relative inline-flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-lg px-4 text-xs font-medium transition-all duration-300 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                :class="dirty ? 'bg-[var(--accent-main)] text-white shadow-md hover:shadow-lg' : 'border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]'"
                :disabled="!dirty || saving"
                @click="void saveSettings()"
            >
                <span v-if="dirty" class="absolute inset-0 translate-y-full bg-white/20 transition-transform duration-300 ease-out group-hover:translate-y-0"></span>
                <span class="relative flex items-center gap-1.5">
                    <span v-if="saving" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                    <span v-else class="i-lucide-save h-3.5 w-3.5"></span>
                    {{ saving ? "保存中..." : "保存设定" }}
                </span>
            </button>
        </div>

        <TransitionGroup
            tag="div"
            enter-active-class="transition-all duration-300 ease-out"
            enter-from-class="opacity-0 -translate-y-2 scale-[0.98]"
            enter-to-class="opacity-100 translate-y-0 scale-100"
            leave-active-class="absolute w-full transition-all duration-200 ease-in"
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

        <div v-if="loading" class="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">正在读取 Agent Profile 模型设定...</span>
        </div>

        <div v-else class="space-y-5">
            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] pb-4">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)]">默认参数</h4>
                        <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? "当前 Project 的 Profile 默认参数；留空继承 Global。" : "所有 Agent Profile 留空时都会继承这里的参数。" }}</p>
                    </div>
                    <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetProfileModelDefaults">
                        <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                        回到默认
                    </button>
                </div>

                <div class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.5fr)]">
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">默认模型</label>
                        <NovelIdeModelSelect
                            :model-value="profileModelDefaults.modelKey"
                            :models="enabledModels"
                            allow-default
                            :default-label="defaultModelSelectLabel()"
                            placeholder="选择默认模型"
                            @update:model-value="profileModelDefaults.modelKey = $event"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">温度</label>
                        <FormInput v-model="profileModelDefaults.temperature" type="number" step="0.1" min="0" :placeholder="isProjectScope ? '继承 Global' : '留空'" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
                        <FormInput v-model="profileModelDefaults.topK" type="number" step="1" min="1" :placeholder="isProjectScope ? '继承 Global' : '留空'" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">推理强度</label>
                        <FormSelect :model-value="profileModelDefaults.reasoningEffort ?? 'inherit'" :options="defaultReasoningOptions()" @update:model-value="setDefaultReasoningEffort" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">流式</label>
                        <FormSelect :model-value="streamSelectValue(profileModelDefaults.stream)" :options="defaultStreamOptions()" @update:model-value="setDefaultStream" />
                    </div>
                </div>
            </section>

            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">Agent Profiles</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? "这些值写入所选 Project Workspace 的 .nbook/config.json。" : "只配置与默认参数不同的 Profile 覆盖。" }}</p>
                </div>

                <div class="grid gap-3">
                    <div v-for="profile in sortedProfiles" :key="profile.profileKey" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/25 p-4">
                        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div class="text-sm font-medium text-[var(--text-main)]">{{ profile.name }}</div>
                                <div class="mt-1 text-[11px] text-[var(--text-muted)]">{{ profile.profileKey }}</div>
                            </div>
                            <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetProfile(profile)">
                                <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                                回到默认
                            </button>
                        </div>

                        <div class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto]">
                            <!-- Profile 默认模型 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">默认模型</label>
                                <NovelIdeModelSelect
                                    :model-value="profile.model.modelKey"
                                    :models="enabledModels"
                                    allow-default
                                    :default-label="modelDefaultLabel(profile)"
                                    placeholder="选择默认模型"
                                    @update:model-value="profile.model.modelKey = $event"
                                />
                            </div>

                            <!-- 温度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">温度</label>
                                <FormInput v-model="profile.model.temperature" type="number" step="0.1" min="0" placeholder="默认" />
                            </div>

                            <!-- TopK -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
                                <FormInput v-model="profile.model.topK" type="number" step="1" min="1" placeholder="默认" />
                            </div>

                            <!-- 推理强度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">推理强度</label>
                                <FormSelect :model-value="profile.model.reasoningEffort ?? 'inherit'" :options="reasoningEffortOptionsForProfile(profile)" @update:model-value="setProfileReasoningEffort(profile, $event)" />
                            </div>

                            <!-- 流式 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">流式</label>
                                <FormSelect :model-value="streamSelectValue(profile.model.stream)" :options="streamOptionsForProfile(profile)" @update:model-value="setProfileStream(profile, $event)" />
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
