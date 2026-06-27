<script setup lang="ts">
import type {Ref} from "vue";
import type {
    AgentProfileModelConfigDto,
    ThinkingLevelDto,
} from "nbook/shared/dto/app-settings.dto";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import {
    cloneLowCodeObject,
    hasLowCodePath,
    lowCodeJsonEqual,
    readLowCodePath,
} from "nbook/app/components/common/low-code-form/low-code-form-utils";
import {useDialog} from "nbook/app/composables/useDialog";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {ConfigAgentProfileSettingsDto, ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";
import type {LowCodeFormDto, LowCodeFormIssueDto, LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";

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
    canResetHome: boolean;
    model: AgentProfileModelDraft;
    settings: AgentProfileSettingsDraft | null;
};

type AgentProfileModelDraft = {
    modelKey: string | null;
    temperature: string;
    topK: string;
    reasoningEffort: ThinkingLevelDto | null;
    stream: boolean | null;
};

type AgentProfileSettingsDraft = {
    form: LowCodeFormDto;
    values: LowCodeJsonObject;
    inheritedValue: LowCodeJsonObject;
    issues: LowCodeFormIssueDto[];
    overridePaths: string[];
    resourceMutations: LowCodeResourceMutationDto[];
};

type AgentProfileConfigDraft = {
    model: Partial<AgentProfileModelConfigDto>;
    settings?: LowCodeJsonObject;
    resourceMutations?: LowCodeResourceMutationDto[];
};

const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const successText = ref("");
const resettingHomeProfileKey = ref("");
const enabledModels = ref<ConfigAgentProfileSettingsDto["enabledModels"]>([]);
const profileModelDefaults = ref<AgentProfileModelDraft>({
    modelKey: null,
    temperature: "",
    topK: "",
    reasoningEffort: "off",
    stream: true,
});
const profiles = ref([]) as Ref<AgentProfileDraft[]>;
const expandedProfileSettings = ref<Set<string>>(new Set());
const snapshotText = ref("");
const configApi = useConfigApi();
const dialog = useDialog();
const novelIdeStore = useNovelIdeStore();
const {t} = useI18n();
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const selectedDefaultProfileKey = ref("");
const isProjectScope = computed(() => props.scope === "project");
const globalDefaultProfileSlot = computed<"novel" | "userAssets">(() => novelIdeStore.workspaceKind === "user-assets" ? "userAssets" : "novel");
const systemDefaultProfileKey = computed(() => {
    if (isProjectScope.value) {
        return editorSnapshot.value?.defaultProfileSettings.systemDefaultProfileKey ?? "leader.default";
    }
    return globalDefaultProfileSlot.value === "userAssets" ? "leader.assets" : "leader.default";
});
const inheritedDefaultProfileKey = computed(() => {
    if (!isProjectScope.value) {
        return systemDefaultProfileKey.value;
    }
    return editorSnapshot.value?.defaultProfileSettings.globalDefaultProfileKey ?? systemDefaultProfileKey.value;
});
const effectiveDefaultProfileKey = computed(() => selectedDefaultProfileKey.value || inheritedDefaultProfileKey.value);
const reasoningEffortBaseOptions = computed<SelectOption[]>(() => [
    {value: "off", label: t("settings.panels.profileModels.off")},
    {value: "minimal", label: t("settings.panels.profileModels.minimal")},
    {value: "low", label: t("settings.panels.profileModels.low")},
    {value: "medium", label: t("settings.panels.profileModels.medium")},
    {value: "high", label: t("settings.panels.profileModels.high")},
    {value: "xhigh", label: t("settings.panels.profileModels.xhigh")},
]);
const defaultProfileOptions = computed<SelectOption[]>(() => {
    const options = editorSnapshot.value?.defaultProfileSettings.profiles.map((profile) => ({
        value: profile.profileKey,
        label: profile.profileKey,
        description: profile.name,
        indicatorClass: profile.loadStatus === "loaded" ? "bg-emerald-500" : "bg-rose-500",
    })) ?? [];
    return [
        {
            value: "",
            label: t("settings.panels.defaultProfile.followDefault", {profile: inheritedDefaultProfileKey.value}),
            description: t("settings.panels.defaultProfile.followDefaultDescription"),
            indicatorClass: "bg-slate-400",
        },
        ...options,
    ];
});

/**
 * 判断指定 profile 的自定义 settings 表单是否展开。
 */
function isProfileSettingsExpanded(profileKey: string): boolean {
    return expandedProfileSettings.value.has(profileKey);
}

/**
 * 切换指定 profile 的自定义 settings 表单展开状态。
 */
function toggleProfileSettings(profileKey: string): void {
    const next = new Set(expandedProfileSettings.value);
    if (next.has(profileKey)) {
        next.delete(profileKey);
    } else {
        next.add(profileKey);
    }
    expandedProfileSettings.value = next;
}

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
        case "off": return t("settings.panels.profileModels.off");
        case "minimal": return t("settings.panels.profileModels.minimal");
        case "low": return t("settings.panels.profileModels.low");
        case "medium": return t("settings.panels.profileModels.medium");
        case "high": return t("settings.panels.profileModels.high");
        case "xhigh": return t("settings.panels.profileModels.xhigh");
    }
}

function streamLabel(value: boolean): string {
    return value ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled");
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
    return t("settings.panels.profileModels.defaultValue", {value: thinkingLevelLabel(resolveProfileInheritedModel(profile).reasoningEffort ?? "off")});
}

function streamDefaultLabel(profile: AgentProfileDraft): string {
    return t("settings.panels.profileModels.defaultValue", {value: streamLabel(resolveProfileInheritedModel(profile).stream ?? true)});
}

function reasoningEffortOptionsForProfile(profile: AgentProfileDraft): SelectOption[] {
    return [{value: "inherit", label: reasoningEffortDefaultLabel(profile)}, ...reasoningEffortBaseOptions.value];
}

function streamOptionsForProfile(profile: AgentProfileDraft): SelectOption[] {
    return [
        {value: "inherit", label: streamDefaultLabel(profile)},
        {value: "true", label: t("settings.panels.profileModels.enabled")},
        {value: "false", label: t("settings.panels.profileModels.disabled")},
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
 * 克隆 profile settings 草稿。Global 编辑完整值；Project 只编辑显式覆盖 patch。
 */
function cloneSettingsDraft(
    settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["settings"],
    scope: ConfigSettingsScope,
): AgentProfileSettingsDraft | null {
    if (!settings) {
        return null;
    }
    const patch = scope === "project" ? settings.projectPatch : settings.globalPatch;
    return {
        form: settings.form,
        values: scope === "project" ? cloneLowCodeObject(patch) : cloneLowCodeObject(settings.value),
        inheritedValue: cloneLowCodeObject(settings.inheritedValue),
        issues: settings.issues,
        overridePaths: scope === "project"
            ? settings.form.fields.filter((field) => hasLowCodePath(patch, field.path)).map((field) => field.path)
            : [],
        resourceMutations: [],
    };
}

/**
 * 构造 settings 保存值。Global 只保存与 profile defaults 不同的字段，Project 只保存显式覆盖字段。
 */
function buildSettingsPatch(settings: AgentProfileSettingsDraft | null): LowCodeJsonObject {
    if (!settings) {
        return {};
    }
    if (isProjectScope.value) {
        return Object.fromEntries(settings.form.fields.filter((field) => settings.overridePaths.includes(field.path)).map((field) => {
            const value = readLowCodePath(settings.values, field.path);
            if (value !== undefined) {
                return [field.path, value] as const;
            }
            const defaultValue = hasLowCodePath(settings.form.defaults, field.path)
                ? readLowCodePath(settings.form.defaults, field.path)
                : field.defaultValue ?? null;
            return [field.path, defaultValue] as const;
        })) as LowCodeJsonObject;
    }
    return Object.fromEntries(settings.form.fields.flatMap((field) => {
        const value = readLowCodePath(settings.values, field.path);
        const defaultValue = hasLowCodePath(settings.form.defaults, field.path)
            ? readLowCodePath(settings.form.defaults, field.path)
            : field.defaultValue;
        if (value === undefined || lowCodeJsonEqual(value, defaultValue)) {
            return [];
        }
        return [[field.path, value] as const];
    })) as LowCodeJsonObject;
}

/**
 * 判断 JSON object 是否为空。
 */
function isEmptyObject(value: LowCodeJsonObject | Partial<AgentProfileModelConfigDto>): boolean {
    return Object.keys(value).length === 0;
}

/**
 * 构造单个 profile 的保存配置，同时保留 model 与 settings。
 */
function buildProfileConfig(profile: AgentProfileDraft): AgentProfileConfigDraft | null {
    const modelPatch = isProjectScope.value ? buildProjectModelPatch(profile.model) : buildModelPatch(profile.model);
    const settingsPatch = buildSettingsPatch(profile.settings);
    const resourceMutations = profile.settings?.resourceMutations ?? [];
    if (isEmptyObject(modelPatch) && (!profile.settings || isEmptyObject(settingsPatch)) && resourceMutations.length === 0) {
        return null;
    }
    return {
        model: modelPatch,
        ...(profile.settings && !isEmptyObject(settingsPatch) ? {settings: settingsPatch} : {}),
        ...(resourceMutations.length > 0 ? {resourceMutations} : {}),
    };
}

/**
 * 构造 profile 配置 map，避免在 Vue SFC 中触发过深类型推导。
 */
function buildProfileConfigMap(): Record<string, AgentProfileConfigDraft> {
    const result: Record<string, AgentProfileConfigDraft> = {};
    for (const profile of profiles.value) {
        const config = buildProfileConfig(profile);
        if (config) {
            result[profile.profileKey] = config;
        }
    }
    return result;
}

/**
 * 构造 Global profile 配置，未知 profile 保留，当前可见 profile 按草稿整体替换。
 */
function buildGlobalProfileConfigMap(): Record<string, AgentProfileConfigDraft> {
    const baseProfiles = editorSnapshot.value?.global.agent?.profiles ?? {};
    const visibleProfileKeys = new Set(profiles.value.map((profile) => profile.profileKey));
    const result: Record<string, AgentProfileConfigDraft> = Object.fromEntries(
        Object.entries(baseProfiles)
            .filter(([profileKey]) => !visibleProfileKeys.has(profileKey))
            .map(([profileKey, config]) => [profileKey, {
                model: config.model ?? {},
                ...(config.settings !== undefined ? {settings: cloneLowCodeObject(config.settings)} : {}),
            } satisfies AgentProfileConfigDraft]),
    );
    for (const profile of profiles.value) {
        const config = buildProfileConfig(profile);
        if (config) {
            result[profile.profileKey] = config;
        }
    }
    return result;
}

/**
 * 构造 Global 默认 Profile 写回形态，保留另一个 workspace slot。
 */
function buildGlobalDefaultProfileKey(): NonNullable<NonNullable<GlobalConfigDto["agent"]>["defaultProfileKey"]> {
    const base = editorSnapshot.value?.global ?? {};
    const defaultProfileKey: NonNullable<NonNullable<GlobalConfigDto["agent"]>["defaultProfileKey"]> = {
        novel: base.agent?.defaultProfileKey?.novel ?? null,
        userAssets: base.agent?.defaultProfileKey?.userAssets ?? null,
    };
    return {
        novel: defaultProfileKey.novel ?? null,
        userAssets: defaultProfileKey.userAssets ?? null,
        [globalDefaultProfileSlot.value]: selectedDefaultProfileKey.value || null,
    };
}

/**
 * 构造 Global Config 写回体，统一替换 agent 默认 Profile、模型默认值和 profile 覆盖。
 */
function buildGlobalConfigPayload(): GlobalConfigDto {
    const base = editorSnapshot.value?.global ?? {};
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: buildGlobalDefaultProfileKey(),
            profileModelDefaults: buildCompleteModelConfig(profileModelDefaults.value),
            profiles: buildGlobalProfileConfigMap(),
        },
    };
}

/**
 * 构造 Project Config 写回体，统一替换 agent 默认 Profile、模型默认值和 profile 覆盖。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project ?? {};
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: selectedDefaultProfileKey.value || null,
            profileModelDefaults: buildModelPatch(profileModelDefaults.value),
            profiles: buildProfileConfigMap(),
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
function applySettings(settings: ConfigAgentProfileSettingsDto): void {
    selectedDefaultProfileKey.value = editorSnapshot.value?.global.agent?.defaultProfileKey?.[globalDefaultProfileSlot.value] ?? "";
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
        canResetHome: profile.canResetHome,
        model: cloneModelDraft(editorSnapshot.value?.global.agent?.profiles?.[profile.profileKey]?.model),
        settings: cloneSettingsDraft(profile.settings, "global"),
    }));
    snapshotText.value = JSON.stringify(buildGlobalSavePayload());
}

/**
 * 将 Project Config 中的 profile 覆盖应用到本地草稿。
 */
function applyProjectSettings(snapshot: ConfigEditorSnapshotDto): void {
    selectedDefaultProfileKey.value = snapshot.defaultProfileSettings.projectDefaultProfileKey ?? "";
    enabledModels.value = snapshot.agentProfileSettings.enabledModels;
    profileModelDefaults.value = cloneModelDraft(snapshot.project?.agent?.profileModelDefaults);
    profiles.value = snapshot.agentProfileSettings.agentProfiles.map((profile) => {
        const override = snapshot.project?.agent?.profiles?.[profile.profileKey]?.model;
        return {
            profileKey: profile.profileKey,
            name: profile.name,
            canResetHome: profile.canResetHome,
            model: cloneModelDraft(override),
            settings: cloneSettingsDraft(profile.settings, "project"),
        };
    });
    snapshotText.value = JSON.stringify(buildProjectDirtyPayload());
}

/**
 * 读取 Project 覆盖保存形态，用于脏检查。
 */
function buildProjectSavePayload(): Record<string, {model: Partial<AgentProfileModelConfigDto>; settings?: LowCodeJsonObject}> {
    return buildProfileConfigMap();
}

function buildGlobalSavePayload(): Record<string, unknown> {
    return {
        defaultProfileKey: buildGlobalDefaultProfileKey(),
        profileModelDefaults: buildCompleteModelConfig(profileModelDefaults.value),
        profiles: buildGlobalProfileConfigMap(),
    };
}

function buildProjectDirtyPayload(): Record<string, unknown> {
    return {
        defaultProfileKey: selectedDefaultProfileKey.value || null,
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
        const snapshot = await configApi.editorSnapshot(props.targetQuery, {
            includeAgentProfileSettings: true,
            agentProfileSettingsScope: isProjectScope.value ? "project" : "global",
        });
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
        } else {
            applySettings(snapshot.agentProfileSettings);
        }
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.loadFailed"));
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
            ? await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery, {includeAgentProfileSettings: true, agentProfileSettingsScope: "project"})
            : await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery, {includeAgentProfileSettings: true, agentProfileSettingsScope: "global"});
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
            successText.value = t("settings.panels.profileModels.projectSaveSuccess");
        } else {
            applySettings(snapshot.agentProfileSettings);
            successText.value = t("settings.panels.profileModels.globalSaveSuccess");
        }
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.saveFailed"));
    } finally {
        saving.value = false;
    }
}

/**
 * 重置 Project profile home。该操作会清空并按 profile 当前版本重建资源文件。
 */
async function resetProfileHome(profile: AgentProfileDraft): Promise<void> {
    if (!isProjectScope.value || resettingHomeProfileKey.value || saving.value) {
        return;
    }
    const confirmed = await dialog.confirm(
        t("settings.panels.profileModels.resetHomeConfirm", {profile: profile.profileKey}),
        t("settings.panels.profileModels.resetHomeTitle"),
    );
    if (!confirmed) {
        return;
    }
    resettingHomeProfileKey.value = profile.profileKey;
    errorText.value = "";
    successText.value = "";
    try {
        const snapshot = await configApi.resetProfileHome(profile.profileKey, props.targetQuery);
        editorSnapshot.value = snapshot;
        applyProjectSettings(snapshot);
        successText.value = t("settings.panels.profileModels.resetHomeSuccess", {profile: profile.profileKey});
    } catch (error) {
        errorText.value = resolveApiErrorMessage(error, t("settings.panels.profileModels.resetHomeFailed"));
    } finally {
        resettingHomeProfileKey.value = "";
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
    if (profile.settings) {
        profile.settings.values = isProjectScope.value
            ? {}
            : cloneLowCodeObject(profile.settings.form.defaults);
        profile.settings.overridePaths = [];
        profile.settings.resourceMutations = [];
    }
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
    return defaultKey ? t("settings.panels.profileModels.defaultValue", {value: defaultKey}) : t("settings.panels.profileModels.defaultGlobalModel");
}

function defaultModelSelectLabel(): string {
    if (!isProjectScope.value) {
        return t("settings.panels.profileModels.followGlobalDefaultModel");
    }
    const inherited = globalProfileModelDefaults().modelKey;
    return inherited ? t("settings.panels.profileModels.inheritGlobal", {value: inherited}) : t("settings.panels.profileModels.inheritGlobalDefaultModel");
}

function defaultReasoningOptions(): SelectOption[] {
    if (!isProjectScope.value) {
        return reasoningEffortBaseOptions.value;
    }
    return [{value: "inherit", label: t("settings.panels.profileModels.inheritGlobal", {value: thinkingLevelLabel(globalProfileModelDefaults().reasoningEffort ?? "off")})}, ...reasoningEffortBaseOptions.value];
}

function defaultStreamOptions(): SelectOption[] {
    if (!isProjectScope.value) {
        return [
            {value: "true", label: t("settings.panels.profileModels.enabled")},
            {value: "false", label: t("settings.panels.profileModels.disabled")},
        ];
    }
    return [
        {value: "inherit", label: t("settings.panels.profileModels.inheritGlobal", {value: streamLabel(globalProfileModelDefaults().stream ?? true)})},
        {value: "true", label: t("settings.panels.profileModels.enabled")},
        {value: "false", label: t("settings.panels.profileModels.disabled")},
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

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
});
</script>

<template>
    <!-- Agent Profile 模型设置 -->
    <div class="space-y-4 pt-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.profileModels.projectTitle") : t("settings.panels.profileModels.globalTitle") }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDescription", {target: props.targetLabel || t("settings.panels.profileModels.currentProject")}) : t("settings.panels.profileModels.globalDescription") }}</p>
            </div>
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
            <span class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.loading") }}</span>
        </div>

        <div v-else class="space-y-5">
            <!-- 默认 Agent Profile 设置 -->
            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.defaultProfile.title") }}</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.defaultProfile.projectDescription") : t("settings.panels.defaultProfile.globalDescription") }}</p>
                </div>

                <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.title") }}</label>
                        <FormSelect v-model="selectedDefaultProfileKey" :options="defaultProfileOptions" :placeholder="t('settings.panels.defaultProfile.selectPlaceholder')" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.currentEffective") }}</label>
                        <div class="flex h-7 w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 px-2.5 text-[12px] select-all">
                            <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
                            <span class="truncate font-mono text-[11px] font-semibold text-[var(--text-main)]">{{ effectiveDefaultProfileKey || "-" }}</span>
                        </div>
                    </div>
                </div>
            </section>

            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] pb-4">
                    <div>
                        <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.defaultParameters") }}</h4>
                        <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDefaultDescription") : t("settings.panels.profileModels.globalDefaultDescription") }}</p>
                    </div>
                    <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetProfileModelDefaults">
                        <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                        {{ t("settings.panels.profileModels.resetDefault") }}
                    </button>
                </div>

                <div class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.5fr)]">
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.defaultModel") }}</label>
                        <NovelIdeModelSelect
                            :model-value="profileModelDefaults.modelKey"
                            :models="enabledModels"
                            allow-default
                            :default-label="defaultModelSelectLabel()"
                            :placeholder="t('settings.panels.profileModels.selectDefaultModel')"
                            @update:model-value="profileModelDefaults.modelKey = $event"
                        />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.temperature") }}</label>
                        <FormInput v-model="profileModelDefaults.temperature" type="number" step="0.1" min="0" :placeholder="isProjectScope ? t('settings.panels.profileModels.inheritGlobalPlaceholder') : t('settings.panels.profileModels.emptyPlaceholder')" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
                        <FormInput v-model="profileModelDefaults.topK" type="number" step="1" min="1" :placeholder="isProjectScope ? t('settings.panels.profileModels.inheritGlobalPlaceholder') : t('settings.panels.profileModels.emptyPlaceholder')" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.reasoningEffort") }}</label>
                        <FormSelect :model-value="profileModelDefaults.reasoningEffort ?? 'inherit'" :options="defaultReasoningOptions()" @update:model-value="setDefaultReasoningEffort" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.stream") }}</label>
                        <FormSelect :model-value="streamSelectValue(profileModelDefaults.stream)" :options="defaultStreamOptions()" @update:model-value="setDefaultStream" />
                    </div>
                </div>
            </section>

            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">Agent Profiles</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectProfilesDescription") : t("settings.panels.profileModels.globalProfilesDescription") }}</p>
                </div>

                <div class="grid gap-3">
                    <div v-for="profile in sortedProfiles" :key="profile.profileKey" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/25 p-4">
                        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div class="text-sm font-medium text-[var(--text-main)]">{{ profile.name }}</div>
                                <div class="mt-1 text-[11px] text-[var(--text-muted)]">{{ profile.profileKey }}</div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <button v-if="isProjectScope && profile.canResetHome" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-50" :disabled="Boolean(resettingHomeProfileKey) || saving" @click="void resetProfileHome(profile)">
                                    <span :class="resettingHomeProfileKey === profile.profileKey ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-rotate-ccw'" class="h-3 w-3"></span>
                                    {{ t("settings.panels.profileModels.resetHome") }}
                                </button>
                                <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetProfile(profile)">
                                    <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                                    {{ t("settings.panels.profileModels.resetDefault") }}
                                </button>
                            </div>
                        </div>

                        <div class="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto]">
                            <!-- Profile 默认模型 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.defaultModel") }}</label>
                                <NovelIdeModelSelect
                                    :model-value="profile.model.modelKey"
                                    :models="enabledModels"
                                    allow-default
                                    :default-label="modelDefaultLabel(profile)"
                                    :placeholder="t('settings.panels.profileModels.selectDefaultModel')"
                                    @update:model-value="profile.model.modelKey = $event"
                                />
                            </div>

                            <!-- 温度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.temperature") }}</label>
                                <FormInput v-model="profile.model.temperature" type="number" step="0.1" min="0" :placeholder="t('settings.panels.profileModels.defaultPlaceholder')" />
                            </div>

                            <!-- TopK -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
                                <FormInput v-model="profile.model.topK" type="number" step="1" min="1" :placeholder="t('settings.panels.profileModels.defaultPlaceholder')" />
                            </div>

                            <!-- 推理强度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.reasoningEffort") }}</label>
                                <FormSelect :model-value="profile.model.reasoningEffort ?? 'inherit'" :options="reasoningEffortOptionsForProfile(profile)" @update:model-value="setProfileReasoningEffort(profile, $event)" />
                            </div>

                            <!-- 流式 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.stream") }}</label>
                                <FormSelect :model-value="streamSelectValue(profile.model.stream)" :options="streamOptionsForProfile(profile)" @update:model-value="setProfileStream(profile, $event)" />
                            </div>
                        </div>

                        <!-- Profile 自定义低代码设置 -->
                        <div v-if="profile.settings" class="mt-4 border-t border-[var(--border-color)] pt-4">
                            <button
                                type="button"
                                class="mb-3 flex w-full items-center gap-2 text-left"
                                :aria-expanded="isProfileSettingsExpanded(profile.profileKey)"
                                @click="toggleProfileSettings(profile.profileKey)"
                            >
                                <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                                <span class="min-w-0 flex-1 text-xs font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.profilePresets") }}</span>
                                <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="isProfileSettingsExpanded(profile.profileKey) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"></span>
                            </button>
                            <div v-if="isProfileSettingsExpanded(profile.profileKey)">
                                <LowCodeForm
                                    v-model="profile.settings.values"
                                    v-model:override-paths="profile.settings.overridePaths"
                                    v-model:resource-mutations="profile.settings.resourceMutations"
                                    :form="profile.settings.form"
                                    :issues="profile.settings.issues"
                                    :scope="isProjectScope ? 'project' : 'global'"
                                    :inheritance-mode="isProjectScope ? 'manual' : 'always-override'"
                                    :inherited-value="profile.settings.inheritedValue"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
