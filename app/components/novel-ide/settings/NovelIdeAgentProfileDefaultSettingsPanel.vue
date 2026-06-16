<script setup lang="ts">
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {ConfigDefaultProfileSettingsDto, ConfigEditorSnapshotDto, ConfigWorkspaceQueryDto, GlobalConfigDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";

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

const emit = defineEmits<{
    (e: "saved", profileKey: string): void;
}>();

const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const configApi = useConfigApi();
const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const settings = ref<ConfigDefaultProfileSettingsDto | null>(null);
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
const selectedProfileKey = ref("");
const snapshotProfileKey = ref("");

const isProjectScope = computed(() => props.scope === "project");
const globalDefaultProfileSlot = computed<"novel" | "userAssets">(() => novelIdeStore.workspaceKind === "user-assets" ? "userAssets" : "novel");
const systemDefaultProfileKey = computed(() => {
    if (isProjectScope.value) {
        return settings.value?.systemDefaultProfileKey ?? "leader.default";
    }
    return globalDefaultProfileSlot.value === "userAssets" ? "leader.assets" : "leader.default";
});
const workspaceLabel = computed(() => {
    if (isProjectScope.value) {
        return props.targetLabel || "当前 Project";
    }
    return globalDefaultProfileSlot.value === "userAssets" ? "Workspace Root 用户资产默认" : "Workspace Root 小说默认";
});
const effectiveProfileKey = computed(() => isProjectScope.value
    ? settings.value?.effectiveProfileKey ?? ""
    : selectedProfileKey.value || systemDefaultProfileKey.value);
const dirty = computed(() => selectedProfileKey.value !== snapshotProfileKey.value);
const profileOptions = computed<SelectOption[]>(() => {
    const options = settings.value?.profiles.map((profile) => ({
        value: profile.profileKey,
        label: profile.profileKey,
        description: profile.name,
        indicatorClass: profile.loadStatus === "loaded" ? "bg-emerald-500" : "bg-rose-500",
    })) ?? [];
    return [
        {
            value: "",
            label: `跟随默认 (${systemDefaultProfileKey.value})`,
            description: "清除当前配置文件中的覆盖设置。",
            indicatorClass: "bg-slate-400",
        },
        ...options,
    ];
});

/**
 * 应用接口响应。
 */
function applySettings(snapshot: ConfigEditorSnapshotDto): void {
    editorSnapshot.value = snapshot;
    settings.value = snapshot.defaultProfileSettings;
    selectedProfileKey.value = !isProjectScope.value
        ? snapshot.global.agent?.defaultProfileKey?.[globalDefaultProfileSlot.value] ?? ""
        : snapshot.defaultProfileSettings.projectDefaultProfileKey ?? "";
    snapshotProfileKey.value = selectedProfileKey.value;
}

/**
 * 构造 Global Config 写回体。
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
            profileModelDefaults: base.agent?.profileModelDefaults ?? {},
            profiles: base.agent?.profiles ?? {},
            defaultProfileKey: {
                novel: defaultProfileKey.novel ?? null,
                userAssets: defaultProfileKey.userAssets ?? null,
                [globalDefaultProfileSlot.value]: selectedProfileKey.value || null,
            },
        },
    };
}

/**
 * 构造 Project Config 写回体。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project ?? {};
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: selectedProfileKey.value || null,
        },
    };
}

/**
 * 读取当前 workspace 默认 profile 设置。
 */
async function loadSettings(): Promise<void> {
    if (!props.targetQuery && novelIdeStore.workspaceKind !== "user-assets" && !novelIdeStore.currentNovelId) {
        return;
    }
    loading.value = true;
    errorText.value = "";
    try {
        applySettings(await configApi.editorSnapshot(props.targetQuery));
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "读取默认 Profile 设置失败";
    } finally {
        loading.value = false;
    }
}

/**
 * 保存当前 workspace 默认 profile 设置。
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
        emit("saved", snapshot.defaultProfileSettings.effectiveProfileKey);
        notification.success("默认 Profile 已保存，新建 session 会使用新的默认值。");
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "保存默认 Profile 设置失败";
    } finally {
        saving.value = false;
    }
}

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectPath, novelIdeStore.workspaceKind, novelIdeStore.currentNovelId] as const, () => {
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
    <!-- workspace 默认 Profile 设置 -->
    <div class="space-y-4 pt-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">默认 Agent Profile</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ workspaceLabel }}的新建 Agent session 会使用这里的默认 Profile；已有 session 不受影响。</p>
            </div>
        </div>

        <div v-if="errorText" class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm">
            <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 shrink-0 text-rose-500"></span>
            <div class="text-sm text-rose-700">{{ errorText }}</div>
        </div>

        <div v-if="loading" class="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">正在读取默认 Profile 设置...</span>
        </div>

        <div v-else class="grid gap-3">
            <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 space-y-5 shadow-sm transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                <div class="space-y-1.5">
                    <div class="flex items-center gap-2">
                        <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-route h-3.5 w-3.5"></span>
                        </span>
                        <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">默认 Agent Profile</h4>
                    </div>
                    <p class="text-xs text-[var(--text-secondary)] leading-relaxed">{{ isProjectScope ? "写入所选 Project Workspace 的 .nbook/config.json；清除覆盖后回落到 Global Config。" : "写入 Workspace Root .nbook/config.json，作为全局默认值。" }}</p>
                </div>

                <div class="grid gap-4 md:grid-cols-2 items-end">
                    <div class="space-y-1.5">
                        <label class="text-xs font-semibold text-[var(--text-secondary)]">默认 Agent Profile</label>
                        <FormSelect v-model="selectedProfileKey" :options="profileOptions" placeholder="选择默认 Profile" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="text-xs font-semibold text-[var(--text-secondary)]">当前生效</label>
                        <div class="flex h-7 w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] bg-opacity-30 px-2.5 text-[12px] select-all">
                            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                            <span class="font-mono text-[11px] font-semibold text-[var(--text-main)] truncate">{{ effectiveProfileKey || "-" }}</span>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
