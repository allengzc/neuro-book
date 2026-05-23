<script setup lang="ts">
import type {
    AgentProfileModelSettingsDto,
    ConfiguredAgentProfileDto,
    UpdateAgentProfileModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import type {ConfigEditorSnapshotDto, GlobalConfigDto} from "nbook/shared/dto/config.dto";

type AgentProfileDraft = {
    profileKey: string;
    name: string;
    kind: "leader" | "subagent";
    model: {
        modelKey: string | null;
        temperature: string;
        topK: string;
        reasoningEffort: "low" | "medium" | "high" | null;
        stream: boolean;
    };
};

const reasoningEffortOptions = [
    {value: null, label: "默认"},
    {value: "low", label: "低"},
    {value: "medium", label: "中"},
    {value: "high", label: "高"},
] as const;

const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const successText = ref("");
const enabledModels = ref<AgentProfileModelSettingsDto["enabledModels"]>([]);
const profiles = ref<AgentProfileDraft[]>([]);
const snapshotText = ref("");
const configApi = useConfigApi();
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);

/**
 * 将数字配置转成表单文本。
 */
function stringifyNullableNumber(value: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * 将表单文本解析为可空数字。
 */
function parseNullableNumber(value: string, integerOnly = false): number | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return integerOnly ? Math.trunc(parsed) : parsed;
}

/**
 * 克隆 profile 草稿，避免直接修改接口对象。
 */
function cloneProfile(profile: ConfiguredAgentProfileDto): AgentProfileDraft {
    return {
        profileKey: profile.profileKey,
        name: profile.name,
        kind: profile.kind,
        model: {
            modelKey: profile.model.modelKey,
            temperature: stringifyNullableNumber(profile.model.temperature),
            topK: stringifyNullableNumber(profile.model.topK),
            reasoningEffort: profile.model.reasoningEffort,
            stream: profile.model.stream,
        },
    };
}

/**
 * 构造保存请求体。
 */
function buildSavePayload(): UpdateAgentProfileModelSettingsRequestDto {
    return {
        agentProfiles: profiles.value.map((profile) => ({
            profileKey: profile.profileKey,
            name: profile.name,
            kind: profile.kind,
            model: {
                modelKey: profile.model.modelKey,
                temperature: parseNullableNumber(profile.model.temperature),
                topK: parseNullableNumber(profile.model.topK, true),
                reasoningEffort: profile.model.reasoningEffort,
                stream: profile.model.stream,
            },
        })),
    };
}

/**
 * 构造 Global Config 写回体，只替换 agent.profiles。
 */
function buildGlobalConfigPayload(): GlobalConfigDto {
    const base = editorSnapshot.value?.global ?? {};
    return {
        ...base,
        agent: {
            ...(base.agent ?? {}),
            profiles: Object.fromEntries(buildSavePayload().agentProfiles.map((profile) => [profile.profileKey, {
                model: profile.model,
            }])),
        },
    };
}

/**
 * 将接口响应应用到本地。
 */
function applySettings(settings: AgentProfileModelSettingsDto): void {
    enabledModels.value = settings.enabledModels;
    profiles.value = settings.agentProfiles.map(cloneProfile);
    snapshotText.value = JSON.stringify(buildSavePayload());
}

/**
 * 读取 Agent Profile 模型设定。
 */
async function loadSettings(): Promise<void> {
    loading.value = true;
    errorText.value = "";
    successText.value = "";

    try {
        const snapshot = await configApi.editorSnapshot();
        editorSnapshot.value = snapshot;
        applySettings(snapshot.agentProfileSettings);
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
        const snapshot = await configApi.saveGlobal(buildGlobalConfigPayload());
        editorSnapshot.value = snapshot;
        applySettings(snapshot.agentProfileSettings);
        successText.value = "Agent Profile 模型设定已写入 Global Config。";
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
        stream: true,
    };
}

const dirty = computed(() => JSON.stringify(buildSavePayload()) !== snapshotText.value);

const groupedProfiles = computed(() => {
    return [
        {
            key: "leader",
            title: "Leader Profiles",
            description: "主线调度节点的默认模型参数。",
            items: profiles.value.filter((profile) => profile.kind === "leader"),
        },
        {
            key: "subagent",
            title: "Subagent Profiles",
            description: "子 Agent 的默认模型参数。",
            items: profiles.value.filter((profile) => profile.kind === "subagent"),
        },
    ].filter((group) => group.items.length > 0);
});

onMounted(() => {
    void loadSettings();
});
</script>

<template>
    <!-- Agent Profile 模型设置 -->
    <div class="space-y-4 pt-1">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">Agent Profile 模型</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">按 Profile 配置默认模型、温度、TopK 与流式选项。线程级覆盖只影响当前线程的后续新 run。</p>
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
            <section v-for="group in groupedProfiles" :key="group.key" class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
                <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ group.title }}</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ group.description }}</p>
                </div>

                <div class="grid gap-3">
                    <div v-for="profile in group.items" :key="profile.profileKey" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/25 p-4">
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
                                    default-label="跟随全局默认模型"
                                    placeholder="选择默认模型"
                                    @update:model-value="profile.model.modelKey = $event"
                                />
                            </div>

                            <!-- 温度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">温度</label>
                                <input v-model="profile.model.temperature" type="number" step="0.1" min="0" placeholder="留空" class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20">
                            </div>

                            <!-- TopK -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">TopK</label>
                                <input v-model="profile.model.topK" type="number" step="1" min="1" placeholder="留空" class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20">
                            </div>

                            <!-- 推理强度 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">推理强度</label>
                                <select v-model="profile.model.reasoningEffort" class="h-7 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20">
                                    <option v-for="option in reasoningEffortOptions" :key="option.label" :value="option.value">{{ option.label }}</option>
                                </select>
                            </div>

                            <!-- 流式 -->
                            <div class="space-y-1.5">
                                <label class="text-xs font-medium text-[var(--text-secondary)]">流式</label>
                                <button
                                    class="inline-flex h-7 w-full items-center justify-center rounded-md border px-3 text-[12px] font-medium transition-colors"
                                    :class="profile.model.stream ? 'border-emerald-600/20 bg-emerald-500/10 text-emerald-600' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)]'"
                                    @click="profile.model.stream = !profile.model.stream"
                                >
                                    {{ profile.model.stream ? "开启" : "关闭" }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>
