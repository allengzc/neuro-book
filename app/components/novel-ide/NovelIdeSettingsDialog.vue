<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import NovelIdeAgentProfileModelSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue";
import NovelIdeCostSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeCostSettingsPanel.vue";
import NovelIdeEmbeddingSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeEmbeddingSettingsPanel.vue";
import NovelIdeModelSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue";
import NovelIdeWebSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeWebSettingsPanel.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useNotification} from "nbook/app/composables/useNotification";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {MarkdownStudioViewMode} from "nbook/app/composables/useMarkdownStudioController";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES, type MarkdownEditorPreferences, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";

type SettingsSection = "frontend" | "editor" | "models" | "embedding" | "cost" | "web-tools" | "agent-profile-models";
type SettingsScope = "global" | "project" | "browser";
type AppVersionKind = "release" | "tag" | "commit" | "package";

interface AppVersionDto {
    versionLabel: string;
    versionKind: AppVersionKind;
    githubUrl: string;
}

type SettingsSavePanelExpose = {
    readonly dirty: boolean;
    readonly loading: boolean;
    readonly saving: boolean;
    saveSettings: () => Promise<void>;
    restoreSettings: () => Promise<void>;
};

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const novelIdeStore = useNovelIdeStore();
const notification = useNotification();
const {locale, setLocale, t} = useI18n();
const {
    selectedReasoning,
    theme,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
} = storeToRefs(novelIdeStore);

const activeSection = ref<SettingsSection>("models");
const activeScope = ref<SettingsScope>("global");
const targetNovelId = ref("");
const appVersion = ref<AppVersionDto | null>(null);
const appVersionPending = ref(false);
const modelSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const embeddingSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const costSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const webSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);
const agentProfileModelSettingsPanelRef = ref<SettingsSavePanelExpose | null>(null);

const frontendSectionItems = computed<Array<{value: SettingsSection; label: string; description: string; iconClass: string}>>(() => [
    {
        value: "frontend",
        label: t("settings.section.frontend.label"),
        description: t("settings.section.frontend.description"),
        iconClass: "i-lucide-monitor-cog",
    },
    {
        value: "editor",
        label: t("settings.section.editor.label"),
        description: t("settings.section.editor.description"),
        iconClass: "i-lucide-type",
    },
    {
        value: "models",
        label: t("settings.section.models.label"),
        description: t("settings.section.models.description"),
        iconClass: "i-lucide-cpu",
    },
    {
        value: "embedding",
        label: "Embedding",
        description: t("settings.section.embedding.description"),
        iconClass: "i-lucide-binary",
    },
    {
        value: "cost",
        label: t("settings.section.cost.label"),
        description: t("settings.section.cost.description"),
        iconClass: "i-lucide-circle-dollar-sign",
    },
    {
        value: "web-tools",
        label: t("settings.section.webTools.label"),
        description: t("settings.section.webTools.description"),
        iconClass: "i-lucide-search-code",
    },
    {
        value: "agent-profile-models",
        label: t("settings.section.agentProfileModels.label"),
        description: t("settings.section.agentProfileModels.description"),
        iconClass: "i-lucide-bot-message-square",
    },
]);

const scopeOptions = computed<Array<{value: SettingsScope; label: string; description: string; iconClass: string}>>(() => [
    {
        value: "global",
        label: t("settings.scope.global.label"),
        description: t("settings.scope.global.description"),
        iconClass: "i-lucide-globe-2",
    },
    {
        value: "project",
        label: t("settings.scope.project.label"),
        description: t("settings.scope.project.description"),
        iconClass: "i-lucide-folder-cog",
    },
    {
        value: "browser",
        label: t("settings.scope.browser.label"),
        description: t("settings.scope.browser.description"),
        iconClass: "i-lucide-monitor",
    },
]);

const globalConfigSections: SettingsSection[] = ["models", "embedding", "cost", "web-tools", "agent-profile-models"];
const projectConfigSections: SettingsSection[] = ["agent-profile-models"];
const browserSections: SettingsSection[] = ["frontend", "editor"];

const themeOptions: SelectOption[] = [
    {value: "sepia", label: "Sepia Paper"},
    {value: "light", label: "Light Editorial"},
    {value: "dark", label: "Default Dark"},
    {value: "catppuccin", label: "Catppuccin"},
    {value: "dracula", label: "Dracula"},
    {value: "monokai", label: "Monokai"},
    {value: "one-dark-pro", label: "One Dark Pro"},
    {value: "tokyo-night", label: "Tokyo Night"},
];

const viewModeOptions = computed<SelectOption[]>(() => [
    {value: "rich", label: t("settings.frontend.viewModeRich")},
    {value: "source", label: t("settings.frontend.viewModeSource")},
]);

const localeOptions = computed<SelectOption[]>(() => [
    {
        value: "zh-CN",
        label: t("settings.frontend.simplifiedChinese"),
        description: t("settings.frontend.simplifiedChineseDescription"),
        iconClass: "i-lucide-languages",
    },
    {
        value: "en-US",
        label: t("settings.frontend.english"),
        description: t("settings.frontend.englishDescription"),
        iconClass: "i-lucide-languages",
    },
]);

const editorFontOptions = computed<SelectOption[]>(() => [
    {
        value: "\"Source Han Serif SC\", \"Noto Serif SC\", \"Songti SC\", serif",
        label: t("settings.editor.fontChineseSerif"),
    },
    {
        value: "\"Microsoft YaHei\", \"Noto Sans SC\", sans-serif",
        label: t("settings.editor.fontChineseSans"),
    },
    {
        value: "\"LXGW WenKai\", \"KaiTi\", \"STKaiti\", serif",
        label: t("settings.editor.fontChineseKai"),
    },
    {
        value: "ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        label: t("settings.editor.fontSystemSans"),
    },
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        label: t("settings.editor.fontMonospace"),
    },
]);

const monacoFontOptions = computed<SelectOption[]>(() => [
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        label: t("settings.editor.fontSystemMonospace"),
    },
    {
        value: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        label: "JetBrains Mono",
    },
    {
        value: "Cascadia Code, Consolas, ui-monospace, monospace",
        label: "Cascadia Code",
    },
    {
        value: "Fira Code, ui-monospace, Menlo, Monaco, Consolas, monospace",
        label: "Fira Code",
    },
]);

const projectOptions = computed<SelectOption[]>(() => novelIdeStore.novels.map((novel) => ({
    value: novel.id,
    label: novel.title || novel.workspaceSlug || novel.id,
    description: novel.workspaceSlug ? `workspace/${novel.workspaceSlug}` : novel.id,
})));

const targetNovel = computed(() => novelIdeStore.novels.find((novel) => novel.id === targetNovelId.value) ?? null);
const targetQuery = computed(() => activeScope.value === "project" && targetNovelId.value
    ? {workspaceKind: "novel" as const, projectPath: targetNovelId.value}
    : {workspaceKind: "user-assets" as const});
const settingsPanelKey = computed(() => `${activeScope.value}:${targetQuery.value.workspaceKind}:${targetQuery.value.projectPath ?? "global"}`);
const targetLabel = computed(() => activeScope.value === "project"
    ? targetNovel.value?.title || targetNovel.value?.workspaceSlug || targetNovelId.value || "Project Workspace"
    : "Workspace Root");
const visibleSectionItems = computed(() => {
    const allowed = activeScope.value === "browser"
        ? browserSections
        : activeScope.value === "project"
            ? projectConfigSections
            : globalConfigSections;
    return frontendSectionItems.value.filter((item) => allowed.includes(item.value));
});

const versionLabel = computed(() => {
    if (appVersionPending.value && !appVersion.value) {
        return t("settings.version.loading");
    }
    if (!appVersion.value) {
        return t("settings.version.unavailable");
    }
    if (appVersion.value.versionKind === "commit") {
        return t("settings.version.commit", {version: appVersion.value.versionLabel});
    }
    if (appVersion.value.versionKind === "release") {
        return t("settings.version.release", {version: appVersion.value.versionLabel});
    }
    return t("settings.version.generic", {version: appVersion.value.versionLabel});
});

const activeSavePanel = computed<SettingsSavePanelExpose | null>(() => {
    switch (activeSection.value) {
        case "models":
            return modelSettingsPanelRef.value;
        case "embedding":
            return embeddingSettingsPanelRef.value;
        case "cost":
            return costSettingsPanelRef.value;
        case "web-tools":
            return webSettingsPanelRef.value;
        case "agent-profile-models":
            return agentProfileModelSettingsPanelRef.value;
        case "frontend":
        case "editor":
            return null;
    }
});
const activeSaveDirty = computed(() => activeSavePanel.value?.dirty ?? false);
const activeSaveLoading = computed(() => activeSavePanel.value?.loading ?? false);
const activeSaveSaving = computed(() => activeSavePanel.value?.saving ?? false);
const showHeaderSaveButton = computed(() => activeSavePanel.value !== null);
const activeSaveDisabled = computed(() => activeSaveLoading.value || activeSaveSaving.value || !activeSaveDirty.value);
const activeRestoreDisabled = computed(() => activeSaveLoading.value || activeSaveSaving.value || !activeSaveDirty.value);

/**
 * 读取当前配置目标允许显示的设置分区。
 */
function sectionsForScope(scope: SettingsScope): SettingsSection[] {
    if (scope === "browser") {
        return browserSections;
    }
    if (scope === "project") {
        return projectConfigSections;
    }
    return globalConfigSections;
}

/**
 * 保证右侧内容分区与左侧配置目标一致。
 */
function alignActiveSectionToScope(): void {
    const allowed = sectionsForScope(activeScope.value);
    if (!allowed.includes(activeSection.value)) {
        activeSection.value = allowed[0] ?? "frontend";
    }
}

/**
 * 保存当前激活的配置面板。
 */
async function saveActivePanel(): Promise<void> {
    const panel = activeSavePanel.value;
    if (!panel || panel.loading || panel.saving || !panel.dirty) {
        return;
    }
    await panel.saveSettings();
}

/**
 * 从已保存配置重新读取当前面板，丢弃本地草稿。
 */
async function restoreActivePanel(): Promise<void> {
    const panel = activeSavePanel.value;
    if (!panel || panel.loading || panel.saving || !panel.dirty) {
        return;
    }
    await panel.restoreSettings();
}

/**
 * 设置页允许直接离开 dirty 草稿；只在加载或保存中阻止切换。
 */
function canLeaveCurrentPanel(): boolean {
    if (activeSaveLoading.value || activeSaveSaving.value) {
        notification.info(activeSaveSaving.value ? t("settings.feedback.saving") : t("settings.feedback.loading"));
        return false;
    }
    return true;
}

/**
 * 选择设置页配置目标，不改变当前 IDE 打开的小说。
 */
function selectScope(scope: SettingsScope): void {
    if (scope === activeScope.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    if (scope === "project" && novelIdeStore.workspaceKind === "user-assets") {
        activeScope.value = "global";
        activeSection.value = "models";
        return;
    }
    activeScope.value = scope;
    activeSection.value = scope === "browser" ? "frontend" : "models";
    alignActiveSectionToScope();
}

/**
 * 选择配置分区；dirty 草稿会随面板切换自然丢弃。
 */
function selectSection(section: SettingsSection): void {
    if (section === activeSection.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    activeSection.value = section;
}

/**
 * 选择 Project Config 目标，不切换当前 IDE 打开的小说。
 */
function selectTargetNovel(novelId: string): void {
    if (novelId === targetNovelId.value) {
        return;
    }
    if (!canLeaveCurrentPanel()) {
        return;
    }
    targetNovelId.value = novelId;
}

/**
 * 更新 Markdown 编辑器显示偏好。
 */
function updateEditorPreferences(patch: Partial<MarkdownEditorPreferences>): void {
    markdownEditorPreferences.value = {
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        ...markdownEditorPreferences.value,
        ...patch,
    };
}

/**
 * 读取数值输入并限制到指定范围。
 */
function updateEditorNumber(key: keyof Pick<MarkdownEditorPreferences, "fontSize" | "lineHeight" | "contentWidth" | "paragraphIndentEm">, value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    updateEditorPreferences({
        [key]: Math.min(Math.max(parsed, min), max),
    });
}

/**
 * 重置 Markdown 编辑器显示偏好。
 */
function resetEditorPreferences(): void {
    markdownEditorPreferences.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
}

/**
 * 更新 Monaco 源码编辑器显示偏好。
 */
function updateMonacoPreferences(patch: Partial<MonacoEditorPreferences>): void {
    monacoEditorPreferences.value = {
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
        ...monacoEditorPreferences.value,
        ...patch,
    };
}

/**
 * 读取 Monaco 数值输入并限制到指定范围。
 */
function updateMonacoNumber(key: keyof Pick<MonacoEditorPreferences, "fontSize" | "lineHeight" | "tabSize">, value: string, min: number, max: number): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    updateMonacoPreferences({
        [key]: Math.min(Math.max(parsed, min), max),
    });
}

/**
 * 重置 Monaco 源码编辑器显示偏好。
 */
function resetMonacoPreferences(): void {
    monacoEditorPreferences.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
}

/**
 * 关闭设定弹窗。
 */
function closeDialog(): void {
    if (!canLeaveCurrentPanel()) {
        return;
    }
    emit("update:modelValue", false);
}

/**
 * 处理主题选择。
 */
function updateTheme(value: string): void {
    theme.value = value as IdeTheme;
}

/**
 * 处理界面语言选择。
 */
function updateLocale(value: string): void {
    if (value === "zh-CN" || value === "en-US") {
        void setLocale(value);
    }
}

/**
 * 处理默认视图模式选择。
 */
function updateViewMode(value: string): void {
    if (value === "rich" || value === "source") {
        viewMode.value = value as MarkdownStudioViewMode;
    }
}

/**
 * 读取设置页底部展示的应用版本信息。
 */
async function loadAppVersion(): Promise<void> {
    if (appVersion.value || appVersionPending.value) {
        return;
    }
    appVersionPending.value = true;
    try {
        appVersion.value = await $fetch<AppVersionDto>("/api/app/version");
    } catch {
        appVersion.value = null;
    } finally {
        appVersionPending.value = false;
    }
}

watch(() => props.modelValue, (open) => {
    if (!open) {
        return;
    }
    void loadAppVersion();
    if (novelIdeStore.novels.length === 0) {
        void novelIdeStore.loadNovels();
    }
    targetNovelId.value = novelIdeStore.currentNovelId || novelIdeStore.novels[0]?.id || "";
    if (novelIdeStore.workspaceKind === "user-assets" && activeScope.value === "project") {
        activeScope.value = "global";
        activeSection.value = "models";
    }
}, {immediate: true});

watch(() => novelIdeStore.currentNovelId, (novelId) => {
    if (!targetNovelId.value) {
        targetNovelId.value = novelId;
    }
});

watch(() => novelIdeStore.novels, (novels) => {
    if (!targetNovelId.value) {
        targetNovelId.value = novelIdeStore.currentNovelId || novels[0]?.id || "";
    }
}, {deep: true});

watch(activeScope, alignActiveSectionToScope, {immediate: true});

</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        :title="t('settings.title')"
        width="1280px"
        height="86vh"
        overlay-type="blur"
        :busy="false"
        :show-footer="false"
        @request-close="closeDialog"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 固定高度，顶部配置目标栏 + 左右分栏 -->
        <div class="flex h-full flex-col gap-4">
            <!-- 配置目标栏 -->
            <section class="shrink-0 rounded-2xl border border-[var(--border-color)] border-opacity-70 bg-[var(--bg-input)] bg-opacity-20 px-4 py-3 shadow-sm">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 space-y-3">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <button
                                v-for="scope in scopeOptions"
                                :key="scope.value"
                                type="button"
                                class="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] border-opacity-60 px-3 text-xs font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-45"
                                :class="activeScope === scope.value ? 'border-[var(--accent-main)] border-opacity-30 bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : 'bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                :disabled="scope.value === 'project' && novelIdeStore.workspaceKind === 'user-assets'"
                                :title="scope.description"
                                @click="selectScope(scope.value)"
                            >
                                <span :class="scope.iconClass" class="h-3.5 w-3.5"></span>
                                <span>{{ scope.label }}</span>
                            </button>
                        </div>
                    </div>

                    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <div v-if="activeScope === 'project'" class="flex min-w-[300px] items-center gap-2 rounded-lg border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-panel)] bg-opacity-35 px-2 py-1">
                            <span class="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">Project</span>
                            <div class="min-w-0 flex-1">
                                <FormSelect :model-value="targetNovelId" :options="projectOptions" :placeholder="t('settings.scope.project.selectorPlaceholder')" @update:model-value="selectTargetNovel" />
                            </div>
                        </div>

                        <button
                            v-if="showHeaderSaveButton"
                            type="button"
                            class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] bg-opacity-45 px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                            :disabled="activeRestoreDisabled"
                            @click="void restoreActivePanel()"
                        >
                            <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                            <span>{{ t("common.restore") }}</span>
                        </button>

                        <button
                            v-if="showHeaderSaveButton"
                            type="button"
                            class="group relative inline-flex h-9 shrink-0 items-center justify-center overflow-hidden rounded-lg px-4 text-xs font-medium transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                            :class="activeSaveDirty && !activeSaveLoading ? 'bg-[var(--accent-main)] text-white shadow-md hover:shadow-lg' : 'border border-[var(--border-color)] bg-[var(--bg-panel)] bg-opacity-45 text-[var(--text-muted)]'"
                            :disabled="activeSaveDisabled"
                            @click="void saveActivePanel()"
                        >
                            <span v-if="activeSaveDirty && !activeSaveLoading" class="absolute inset-0 translate-y-full bg-white/20 transition-transform duration-300 ease-out group-hover:translate-y-0"></span>
                            <span class="relative flex items-center gap-1.5">
                                <span v-if="activeSaveLoading || activeSaveSaving" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                <span v-else class="i-lucide-save h-3.5 w-3.5"></span>
                                {{ activeSaveLoading ? t("common.loading") : activeSaveSaving ? t("common.saving") : t("common.saveSettings") }}
                            </span>
                        </button>
                    </div>
                </div>
            </section>

            <div class="flex min-h-0 flex-1 gap-6">
                <!-- 左侧导航栏 - 清爽无边框 -->
            <aside class="flex w-[220px] shrink-0 flex-col pb-2">
                <div class="mb-3 mt-1 px-3">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{{ activeScope === "browser" ? t("settings.scope.browserState") : t("settings.scope.configFile") }}</div>
                </div>

                <div class="flex flex-col gap-1.5">
                    <button
                        v-for="item in visibleSectionItems"
                        :key="item.value"
                        class="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all duration-200"
                        :class="activeSection === item.value ? 'bg-[var(--bg-input)] text-[var(--text-main)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--border-color)]' : 'border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:bg-opacity-40 hover:text-[var(--text-main)]'"
                        @click="selectSection(item.value)"
                    >
                        <!-- 图标 -->
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-300" :class="activeSection === item.value ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm font-semibold' : 'bg-transparent text-[var(--text-muted)] group-hover:text-[var(--text-main)]'">
                            <span :class="item.iconClass" class="h-4 w-4"></span>
                        </div>
                        
                        <div class="min-w-0 flex-1">
                            <span class="block text-[13px] font-medium">{{ item.label }}</span>
                            <span class="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{{ item.description }}</span>
                        </div>
                    </button>
                </div>

                <!-- 底部版本信息 -->
                <div class="mt-auto pt-4">
                    <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-15 px-3.5 py-3 shadow-sm">
                        <div class="min-w-0">
                            <div class="truncate text-[11px] font-medium leading-relaxed text-[var(--text-secondary)]">{{ versionLabel }}</div>
                            <div class="mt-0.5 text-[10px] leading-relaxed text-[var(--text-muted)]">Neuro Book</div>
                        </div>
                        <a
                            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] border-opacity-60 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            :href="appVersion?.githubUrl || 'https://github.com/notnotype/neuro-book'"
                            target="_blank"
                            rel="noreferrer"
                            :title="t('settings.version.openGithub')"
                        >
                            <span class="i-lucide-github h-4 w-4"></span>
                        </a>
                    </div>
                </div>
            </aside>

            <!-- 右侧内容区 -->
            <section class="min-w-0 flex-1 relative flex flex-col overflow-hidden">
                <!-- 内部独立滚动 -->
                <div class="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-6">
                    <Transition name="fade-slide" mode="out-in">
                        <!-- 前端设定 -->
                        <div v-if="activeSection === 'frontend'" key="frontend" class="space-y-4 pt-1">
                            <div class="grid gap-3">
                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-languages h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.languageTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.languageDescription") }}</div>
                                    </div>
                                    <div class="w-48 shrink-0">
                                        <FormSelect :model-value="locale" :options="localeOptions" @update:model-value="updateLocale" />
                                    </div>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-palette h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.themeTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.themeDescription") }}</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect :model-value="theme" :options="themeOptions" @update:model-value="updateTheme" />
                                    </div>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-brain-circuit h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.reasoningTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.reasoningDescription") }}</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect :model-value="selectedReasoning" :options="novelIdeStore.reasoningOptions.map((item) => ({ value: item, label: item }))" @update:model-value="selectedReasoning = $event" />
                                    </div>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-layout h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.frontend.viewModeTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.frontend.viewModeDescription") }}</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect :model-value="viewMode" :options="viewModeOptions" @update:model-value="updateViewMode" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 编辑器设定 -->
                        <div v-else-if="activeSection === 'editor'" key="editor" class="space-y-4 pt-1">
                            <div class="flex flex-wrap items-center justify-between gap-4">
                                <div class="max-w-xl">
                                    <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.editor.markdownTitle") }}</h3>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.markdownDescription") }}</p>
                                </div>
                                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetEditorPreferences">
                                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                    <span>{{ t("settings.editor.resetMarkdown") }}</span>
                                </button>
                            </div>

                            <div class="grid gap-3">
                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-type h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.bodyFontTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.bodyFontDescription") }}</div>
                                    </div>
                                    <div class="w-72 shrink-0">
                                        <input
                                            list="markdown-editor-font-options"
                                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20"
                                            :value="markdownEditorPreferences.fontFamily"
                                            :placeholder="t('settings.editor.fontFamilyPlaceholder')"
                                            @input="updateEditorPreferences({fontFamily: ($event.target as HTMLInputElement).value})"
                                        >
                                        <datalist id="markdown-editor-font-options">
                                            <option v-for="option in editorFontOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </datalist>
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.fontSizeTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.fontSizeDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="markdownEditorPreferences.fontSize" min="12" max="28" step="1" @input="updateEditorNumber('fontSize', ($event.target as HTMLInputElement).value, 12, 28)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.lineHeightTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.lineHeightDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="markdownEditorPreferences.lineHeight" min="1.2" max="2.6" step="0.05" @input="updateEditorNumber('lineHeight', ($event.target as HTMLInputElement).value, 1.2, 2.6)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.contentWidthTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.contentWidthDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="markdownEditorPreferences.contentWidth" min="520" max="1280" step="20" @input="updateEditorNumber('contentWidth', ($event.target as HTMLInputElement).value, 520, 1280)">
                                    </label>

                                    <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <div class="flex items-center justify-between gap-4">
                                            <div class="min-w-0">
                                                <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.paragraphIndentTitle") }}</div>
                                                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.paragraphIndentDescription") }}</div>
                                            </div>
                                            <button type="button" class="relative h-6 w-11 rounded-full border transition-colors" :class="markdownEditorPreferences.paragraphIndentEnabled ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]'" @click="updateEditorPreferences({paragraphIndentEnabled: !markdownEditorPreferences.paragraphIndentEnabled})">
                                                <span class="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform" :class="markdownEditorPreferences.paragraphIndentEnabled ? 'translate-x-5' : 'translate-x-0.5'"></span>
                                            </button>
                                        </div>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20 disabled:opacity-50" :value="markdownEditorPreferences.paragraphIndentEm" min="0" max="4" step="0.25" :disabled="!markdownEditorPreferences.paragraphIndentEnabled" @input="updateEditorNumber('paragraphIndentEm', ($event.target as HTMLInputElement).value, 0, 4)">
                                    </div>
                                </div>
                            </div>

                            <div class="grid gap-3 border-t border-[var(--border-color)] pt-4">
                                <div class="flex flex-wrap items-center justify-between gap-4">
                                    <div class="max-w-xl">
                                        <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.editor.monacoTitle") }}</h3>
                                        <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoDescription") }}</p>
                                    </div>
                                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetMonacoPreferences">
                                        <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                        <span>{{ t("settings.editor.resetMonaco") }}</span>
                                    </button>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-code-2 h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.monacoFontTitle") }}</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoFontDescription") }}</div>
                                    </div>
                                    <div class="w-72 shrink-0">
                                        <input
                                            list="monaco-editor-font-options"
                                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20"
                                            :value="monacoEditorPreferences.fontFamily"
                                            :placeholder="t('settings.editor.fontFamilyPlaceholder')"
                                            @input="updateMonacoPreferences({fontFamily: ($event.target as HTMLInputElement).value})"
                                        >
                                        <datalist id="monaco-editor-font-options">
                                            <option v-for="option in monacoFontOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </datalist>
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-3">
                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.monacoFontSizeTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoFontSizeDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="monacoEditorPreferences.fontSize" min="10" max="32" step="1" @input="updateMonacoNumber('fontSize', ($event.target as HTMLInputElement).value, 10, 32)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.monacoLineHeightTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.monacoLineHeightDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="monacoEditorPreferences.lineHeight" min="16" max="56" step="1" @input="updateMonacoNumber('lineHeight', ($event.target as HTMLInputElement).value, 16, 56)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.tabSizeTitle") }}</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.tabSizeDescription") }}</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20" :value="monacoEditorPreferences.tabSize" min="2" max="8" step="1" @input="updateMonacoNumber('tabSize', ($event.target as HTMLInputElement).value, 2, 8)">
                                    </label>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({wordWrap: !monacoEditorPreferences.wordWrap})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.wordWrapTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.wordWrapDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.wordWrap ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({minimapEnabled: !monacoEditorPreferences.minimapEnabled})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.minimapTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.minimapDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.minimapEnabled ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({lineNumbers: !monacoEditorPreferences.lineNumbers})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.lineNumbersTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.lineNumbersDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.lineNumbers ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({renderWhitespace: !monacoEditorPreferences.renderWhitespace})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">{{ t("settings.editor.whitespaceTitle") }}</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">{{ t("settings.editor.whitespaceDescription") }}</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.renderWhitespace ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 模型设定 -->
                        <div v-else-if="activeSection === 'models'" key="models">
                            <!-- 注意：ModelSettingsPanel 内部不使用 h-full，让外层自动撑开或根据内容滚动 -->
                            <NovelIdeModelSettingsPanel ref="modelSettingsPanelRef" :key="`models:${settingsPanelKey}`" :scope="activeScope === 'project' ? 'project' : 'global'" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- Embedding 服务设定 -->
                        <div v-else-if="activeSection === 'embedding'" key="embedding">
                            <NovelIdeEmbeddingSettingsPanel ref="embeddingSettingsPanelRef" :key="`embedding:${settingsPanelKey}`" :scope="activeScope === 'project' ? 'project' : 'global'" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- 费用显示设定 -->
                        <div v-else-if="activeSection === 'cost'" key="cost">
                            <NovelIdeCostSettingsPanel ref="costSettingsPanelRef" :key="`cost:${settingsPanelKey}`" :target-query="targetQuery" />
                        </div>

                        <!-- Web 工具设定 -->
                        <div v-else-if="activeSection === 'web-tools'" key="web-tools">
                            <NovelIdeWebSettingsPanel ref="webSettingsPanelRef" :key="`web-tools:${settingsPanelKey}`" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>

                        <!-- Agent Profile 模型设定 -->
                        <div v-else-if="activeSection === 'agent-profile-models'" key="agent-profile-models">
                            <NovelIdeAgentProfileModelSettingsPanel ref="agentProfileModelSettingsPanelRef" :key="`profile-models:${settingsPanelKey}`" :scope="activeScope === 'project' ? 'project' : 'global'" :target-query="targetQuery" :target-label="targetLabel" />
                        </div>
                    </Transition>
                </div>
            </section>
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
</style>

