<script setup lang="ts">
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {ConfigDefaultProfileSettingsDto, ConfigEditorSnapshotDto, GlobalConfigDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";

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

const workspaceLabel = computed(() => novelIdeStore.workspaceKind === "user-assets" ? "用户资产工作区" : "当前小说工作区");
const effectiveProfileKey = computed(() => settings.value?.effectiveProfileKey ?? "");
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
            label: `跟随默认 (${settings.value?.systemDefaultProfileKey ?? "-"})`,
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
    selectedProfileKey.value = novelIdeStore.workspaceKind === "user-assets"
        ? snapshot.defaultProfileSettings.globalDefaultProfileKey ?? ""
        : snapshot.defaultProfileSettings.projectDefaultProfileKey ?? "";
    snapshotProfileKey.value = selectedProfileKey.value;
}

/**
 * 构造 Global Config 写回体。
 */
function buildGlobalConfigPayload(): GlobalConfigDto {
    const base = editorSnapshot.value?.global ?? {};
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            defaultProfileKey: {
                ...base.agent?.defaultProfileKey,
                [novelIdeStore.workspaceKind === "user-assets" ? "userAssets" : "novel"]: selectedProfileKey.value || null,
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
    if (novelIdeStore.workspaceKind !== "user-assets" && !novelIdeStore.currentNovelId) {
        return;
    }
    loading.value = true;
    errorText.value = "";
    try {
        applySettings(await configApi.editorSnapshot());
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
        const snapshot = novelIdeStore.workspaceKind === "user-assets"
            ? await configApi.saveGlobal(buildGlobalConfigPayload())
            : await configApi.saveProject(buildProjectConfigPayload());
        applySettings(snapshot);
        emit("saved", snapshot.defaultProfileSettings.effectiveProfileKey);
        notification.success("默认 Profile 已保存，新建 session 会使用新的默认值。");
    } catch (error) {
        errorText.value = error instanceof Error ? error.message : "保存默认 Profile 设置失败";
    } finally {
        saving.value = false;
    }
}

watch(() => [novelIdeStore.workspaceKind, novelIdeStore.currentNovelId] as const, () => {
    void loadSettings();
});

onMounted(() => {
    void loadSettings();
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

        <div v-if="errorText" class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm">
            <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 shrink-0 text-rose-500"></span>
            <div class="text-sm text-rose-700">{{ errorText }}</div>
        </div>

        <div v-if="loading" class="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">正在读取默认 Profile 设置...</span>
        </div>

        <div v-else class="grid gap-3">
            <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">默认 Agent Profile</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">用户资产入口写入 Workspace Root <code class="rounded bg-[var(--bg-input)] px-1">.nbook/config.json</code>；小说入口写入 Project Workspace <code class="rounded bg-[var(--bg-input)] px-1">.nbook/config.json</code>。</p>
                </div>

                <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div class="space-y-1.5">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">默认 Agent Profile</label>
                        <FormSelect v-model="selectedProfileKey" :options="profileOptions" placeholder="选择默认 Profile" />
                    </div>
                    <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/30 px-4 py-3">
                        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">当前生效</div>
                        <div class="mt-2 font-mono text-sm text-[var(--text-main)]">{{ effectiveProfileKey || "-" }}</div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
