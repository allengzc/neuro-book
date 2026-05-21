<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import NovelIdeAgentProfileDefaultSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeAgentProfileDefaultSettingsPanel.vue";
import NovelIdeAgentProfileModelSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue";
import NovelIdeModelSettingsPanel from "nbook/app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {MarkdownStudioViewMode} from "nbook/app/composables/useMarkdownStudioController";
import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES, DEFAULT_MONACO_EDITOR_PREFERENCES, type MarkdownEditorPreferences, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";
import type {AgentToolSettingsDto, UpdateAgentToolSettingsRequestDto} from "nbook/shared/dto/app-settings.dto";

type SettingsSection = "frontend" | "editor" | "agent-tools" | "models" | "agent-profile-defaults" | "agent-profile-models";
type ToolState = "default" | "allow" | "deny";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const novelIdeStore = useNovelIdeStore();
const {
    promptExpanded,
    selectedReasoning,
    theme,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
} = storeToRefs(novelIdeStore);

const activeSection = ref<SettingsSection>("frontend");
const loadingBackend = ref(false);
const savingBackend = ref(false);
const backendError = ref("");
const backendSuccessText = ref("");
const backendTools = ref<string[]>([]);
const backendDraft = ref<Record<string, ToolState>>({});
const backendSnapshot = ref<UpdateAgentToolSettingsRequestDto>({
    allow: [],
    deny: [],
});

const frontendSectionItems: Array<{value: SettingsSection; label: string; description: string; iconClass: string}> = [
    {
        value: "frontend",
        label: "前端设定",
        description: "本地 UI 偏好，即改即生效。",
        iconClass: "i-lucide-monitor-cog",
    },
    {
        value: "editor",
        label: "编辑器",
        description: "Markdown 富文本显示偏好。",
        iconClass: "i-lucide-type",
    },
    {
        value: "agent-tools",
        label: "Agent 工具",
        description: "配置 allow / deny，影响后续新 run。",
        iconClass: "i-lucide-server-cog",
    },
    {
        value: "models",
        label: "模型设置",
        description: "管理 Provider、Model 与默认模型。",
        iconClass: "i-lucide-cpu",
    },
    {
        value: "agent-profile-defaults",
        label: "默认 Profile",
        description: "配置当前 workspace 新线程默认使用的 Profile。",
        iconClass: "i-lucide-route",
    },
    {
        value: "agent-profile-models",
        label: "Agent Profile 模型",
        description: "配置各个 Agent Profile 的默认模型参数。",
        iconClass: "i-lucide-bot-message-square",
    },
];

const themeOptions: SelectOption[] = [
    {value: "sepia", label: "Sepia Paper"},
    {value: "light", label: "Light Editorial"},
    {value: "dark", label: "Dark Cinematic"},
];

const viewModeOptions: SelectOption[] = [
    {value: "rich", label: "富文本"},
    {value: "source", label: "源码"},
];

const promptExpandedOptions: SelectOption[] = [
    {value: "expanded", label: "默认展开"},
    {value: "collapsed", label: "默认收起"},
];

const editorFontOptions: SelectOption[] = [
    {
        value: "\"Source Han Serif SC\", \"Noto Serif SC\", \"Songti SC\", serif",
        label: "中文衬线",
    },
    {
        value: "\"Microsoft YaHei\", \"Noto Sans SC\", sans-serif",
        label: "中文黑体",
    },
    {
        value: "\"LXGW WenKai\", \"KaiTi\", \"STKaiti\", serif",
        label: "中文楷体",
    },
    {
        value: "ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
        label: "系统无衬线",
    },
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        label: "等宽字体",
    },
];

const monacoFontOptions: SelectOption[] = [
    {
        value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
        label: "系统等宽",
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
];

const toolStateOptions: SelectOption[] = [
    {value: "default", label: "默认", indicatorClass: "bg-slate-400"},
    {value: "allow", label: "允许", indicatorClass: "bg-emerald-500"},
    {value: "deny", label: "禁止", indicatorClass: "bg-rose-500"},
];

const promptExpandedValue = computed({
    get: (): string => promptExpanded.value ? "expanded" : "collapsed",
    set: (value: string): void => {
        promptExpanded.value = value === "expanded";
    },
});

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

const backendSummary = computed(() => {
    let allowCount = 0;
    let denyCount = 0;

    for (const toolName of backendTools.value) {
        const state = backendDraft.value[toolName] ?? "default";
        if (state === "allow") {
            allowCount += 1;
            continue;
        }
        if (state === "deny") {
            denyCount += 1;
        }
    }

    return {
        allowCount,
        denyCount,
        defaultCount: Math.max(backendTools.value.length - allowCount - denyCount, 0),
    };
});

const backendDirty = computed(() => {
    const nextPayload = buildBackendPayload();
    return nextPayload.allow.join("\n") !== backendSnapshot.value.allow.join("\n")
        || nextPayload.deny.join("\n") !== backendSnapshot.value.deny.join("\n");
});

/**
 * 关闭设定弹窗。
 */
function closeDialog(): void {
    emit("update:modelValue", false);
}

/**
 * 根据接口响应重建后端草稿。
 */
function applyBackendSettings(settings: AgentToolSettingsDto): void {
    const allowSet = new Set(settings.allow);
    const denySet = new Set(settings.deny);
    const nextDraft: Record<string, ToolState> = {};

    for (const toolName of settings.allTools) {
        if (denySet.has(toolName)) {
            nextDraft[toolName] = "deny";
            continue;
        }
        if (allowSet.has(toolName)) {
            nextDraft[toolName] = "allow";
            continue;
        }
        nextDraft[toolName] = "default";
    }

    backendTools.value = [...settings.allTools];
    backendDraft.value = nextDraft;
    backendSnapshot.value = {
        allow: [...settings.allow],
        deny: [...settings.deny],
    };
}

/**
 * 将当前后端草稿收敛为接口请求体。
 */
function buildBackendPayload(): UpdateAgentToolSettingsRequestDto {
    const allow: string[] = [];
    const deny: string[] = [];

    for (const toolName of backendTools.value) {
        const state = backendDraft.value[toolName] ?? "default";
        if (state === "allow") {
            allow.push(toolName);
            continue;
        }
        if (state === "deny") {
            deny.push(toolName);
        }
    }

    return {
        allow,
        deny,
    };
}

/**
 * 读取后端设定。
 */
async function loadBackendSettings(): Promise<void> {
    loadingBackend.value = true;
    backendError.value = "";
    backendSuccessText.value = "";

    try {
        const settings = await $fetch<AgentToolSettingsDto>("/api/settings/agent-tools");
        applyBackendSettings(settings);
    } catch (error) {
        backendError.value = error instanceof Error ? error.message : "读取后端设定失败";
    } finally {
        loadingBackend.value = false;
    }
}

/**
 * 保存后端设定到 config.yaml。
 */
async function saveBackendSettings(): Promise<void> {
    if (!backendDirty.value || savingBackend.value) {
        return;
    }

    savingBackend.value = true;
    backendError.value = "";
    backendSuccessText.value = "";

    try {
        const settings = await $fetch<AgentToolSettingsDto>("/api/settings/agent-tools", {
            method: "PUT",
            body: buildBackendPayload(),
        });
        applyBackendSettings(settings);
        backendSuccessText.value = "已写入 config.yaml，后续新发起的 Agent run 会使用新工具集。";
    } catch (error) {
        backendError.value = error instanceof Error ? error.message : "保存后端设定失败";
    } finally {
        savingBackend.value = false;
    }
}

/**
 * 处理主题选择。
 */
function updateTheme(value: string): void {
    if (value === "sepia" || value === "light" || value === "dark") {
        theme.value = value as IdeTheme;
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

watch(() => props.modelValue, (visible) => {
    if (!visible) {
        return;
    }

    void loadBackendSettings();
});
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        title="工作区设定"
        width="1060px"
        height="740px"
        overlay-type="blur"
        :busy="savingBackend"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 固定高度，左右分栏 -->
        <div class="flex h-full gap-6">
            <!-- 左侧导航栏 - 清爽无边框 -->
            <aside class="flex w-[160px] shrink-0 flex-col pb-2">
                <div class="mb-3 mt-1 px-3">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Preferences</div>
                </div>

                <div class="flex flex-col gap-1.5">
                    <button
                        v-for="item in frontendSectionItems"
                        :key="item.value"
                        class="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all duration-200"
                        :class="activeSection === item.value ? 'bg-[var(--bg-input)] text-[var(--text-main)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[var(--border-color)]' : 'border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/40 hover:text-[var(--text-main)]'"
                        @click="activeSection = item.value"
                    >
                        <!-- 图标 -->
                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-300" :class="activeSection === item.value ? 'bg-[var(--accent-main)] text-white shadow-sm' : 'bg-transparent text-[var(--text-muted)] group-hover:text-[var(--text-main)]'">
                            <span :class="item.iconClass" class="h-4 w-4"></span>
                        </div>
                        
                        <div class="min-w-0 flex-1">
                            <span class="block text-[13px] font-medium">{{ item.label }}</span>
                        </div>
                    </button>
                </div>

                <!-- 底部提示信息移至侧边栏 -->
                <div class="mt-auto pt-4">
                    <div class="rounded-xl border border-[var(--border-color)]/60 bg-[var(--bg-panel)]/50 px-3.5 py-3 shadow-sm">
                        <span class="i-lucide-info mb-1.5 block h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                        <div class="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                            {{ activeSection === "frontend" ? "前端设定即时生效并自动保存。" : activeSection === "editor" ? "编辑器显示偏好只影响本地 UI。" : activeSection === "agent-tools" ? (backendDirty ? "Agent 工具有未保存修改。" : "Agent 工具配置已持久化。") : activeSection === "models" ? "模型设置修改后须手动保存。" : activeSection === "agent-profile-defaults" ? "默认 Profile 只影响新建线程。" : "Profile 模型参数修改后须手动保存。" }}
                        </div>
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
                                        <span class="i-lucide-palette h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">IDE 主题</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">控制整个 Novel IDE 的配色与背景氛围。</div>
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
                                        <div class="text-sm font-medium text-[var(--text-main)]">推理强度</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">用于底部 Prompt Bar 的默认推理档位显示值。</div>
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
                                        <div class="text-sm font-medium text-[var(--text-main)]">默认视图</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">切换编辑器默认打开预览还是源码视图。</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect :model-value="viewMode" :options="viewModeOptions" @update:model-value="updateViewMode" />
                                    </div>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-panel-bottom h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">Prompt Bar</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">控制页面初始进入时底部输入栏的展开状态。</div>
                                    </div>
                                    <div class="w-40 shrink-0">
                                        <FormSelect v-model="promptExpandedValue" :options="promptExpandedOptions" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 编辑器设定 -->
                        <div v-else-if="activeSection === 'editor'" key="editor" class="space-y-4 pt-1">
                            <div class="flex flex-wrap items-center justify-between gap-4">
                                <div class="max-w-xl">
                                    <h3 class="text-base font-semibold text-[var(--text-main)]">Markdown 编辑器</h3>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">这些配置只改变 TipTap 富文本区显示，不会写入 Markdown 文件。</p>
                                </div>
                                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetEditorPreferences">
                                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                    <span>重置</span>
                                </button>
                            </div>

                            <div class="grid gap-3">
                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-type h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">正文字体</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">设置富文本编辑区的字体族。</div>
                                    </div>
                                    <div class="w-72 shrink-0">
                                        <input
                                            list="markdown-editor-font-options"
                                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"
                                            :value="markdownEditorPreferences.fontFamily"
                                            placeholder="输入 CSS font-family"
                                            @input="updateEditorPreferences({fontFamily: ($event.target as HTMLInputElement).value})"
                                        >
                                        <datalist id="markdown-editor-font-options">
                                            <option v-for="option in editorFontOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </datalist>
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">字号</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">单位 px，建议 15-18。</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" :value="markdownEditorPreferences.fontSize" min="12" max="28" step="1" @input="updateEditorNumber('fontSize', ($event.target as HTMLInputElement).value, 12, 28)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">行高</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">无单位倍率，建议 1.6-2.0。</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" :value="markdownEditorPreferences.lineHeight" min="1.2" max="2.6" step="0.05" @input="updateEditorNumber('lineHeight', ($event.target as HTMLInputElement).value, 1.2, 2.6)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">正文宽度</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">单位 px，控制居中正文栏宽度。</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" :value="markdownEditorPreferences.contentWidth" min="520" max="1280" step="20" @input="updateEditorNumber('contentWidth', ($event.target as HTMLInputElement).value, 520, 1280)">
                                    </label>

                                    <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <div class="flex items-center justify-between gap-4">
                                            <div class="min-w-0">
                                                <div class="text-sm font-medium text-[var(--text-main)]">段落缩进</div>
                                                <div class="mt-0.5 text-xs text-[var(--text-secondary)]">仅普通正文段落首行缩进。</div>
                                            </div>
                                            <button type="button" class="relative h-6 w-11 rounded-full border transition-colors" :class="markdownEditorPreferences.paragraphIndentEnabled ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-color)] bg-[var(--bg-input)]'" @click="updateEditorPreferences({paragraphIndentEnabled: !markdownEditorPreferences.paragraphIndentEnabled})">
                                                <span class="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform" :class="markdownEditorPreferences.paragraphIndentEnabled ? 'translate-x-5' : 'translate-x-0.5'"></span>
                                            </button>
                                        </div>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20 disabled:opacity-50" :value="markdownEditorPreferences.paragraphIndentEm" min="0" max="4" step="0.25" :disabled="!markdownEditorPreferences.paragraphIndentEnabled" @input="updateEditorNumber('paragraphIndentEm', ($event.target as HTMLInputElement).value, 0, 4)">
                                    </div>
                                </div>
                            </div>

                            <div class="grid gap-3 border-t border-[var(--border-color)] pt-4">
                                <div class="flex flex-wrap items-center justify-between gap-4">
                                    <div class="max-w-xl">
                                        <h3 class="text-base font-semibold text-[var(--text-main)]">源码 Monaco</h3>
                                        <p class="mt-1 text-xs text-[var(--text-secondary)]">这些配置作为源码模式默认值；Ctrl/Cmd + 滚轮只临时调整当前 Tab。</p>
                                    </div>
                                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="resetMonacoPreferences">
                                        <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                        <span>重置源码</span>
                                    </button>
                                </div>

                                <div class="group flex items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--accent-bg)] group-hover:text-[var(--accent-main)]">
                                        <span class="i-lucide-code-2 h-5 w-5"></span>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium text-[var(--text-main)]">源码字体</div>
                                        <div class="mt-0.5 text-xs text-[var(--text-secondary)]">设置 Monaco 编辑器的字体族。</div>
                                    </div>
                                    <div class="w-72 shrink-0">
                                        <input
                                            list="monaco-editor-font-options"
                                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"
                                            :value="monacoEditorPreferences.fontFamily"
                                            placeholder="输入 CSS font-family"
                                            @input="updateMonacoPreferences({fontFamily: ($event.target as HTMLInputElement).value})"
                                        >
                                        <datalist id="monaco-editor-font-options">
                                            <option v-for="option in monacoFontOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                        </datalist>
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-3">
                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">源码字号</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">默认字号，单位 px。</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" :value="monacoEditorPreferences.fontSize" min="10" max="32" step="1" @input="updateMonacoNumber('fontSize', ($event.target as HTMLInputElement).value, 10, 32)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">源码行高</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">单位 px。</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" :value="monacoEditorPreferences.lineHeight" min="16" max="56" step="1" @input="updateMonacoNumber('lineHeight', ($event.target as HTMLInputElement).value, 16, 56)">
                                    </label>

                                    <label class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm">
                                        <span class="text-sm font-medium text-[var(--text-main)]">Tab Size</span>
                                        <span class="mt-0.5 block text-xs text-[var(--text-secondary)]">缩进空格数。</span>
                                        <input type="number" class="mt-3 h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20" :value="monacoEditorPreferences.tabSize" min="2" max="8" step="1" @input="updateMonacoNumber('tabSize', ($event.target as HTMLInputElement).value, 2, 8)">
                                    </label>
                                </div>

                                <div class="grid gap-3 md:grid-cols-2">
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({wordWrap: !monacoEditorPreferences.wordWrap})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">自动换行</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">长行在视口内折行。</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.wordWrap ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({minimapEnabled: !monacoEditorPreferences.minimapEnabled})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">缩略图</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">显示 Monaco 右侧 minimap。</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.minimapEnabled ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({lineNumbers: !monacoEditorPreferences.lineNumbers})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">行号</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">显示源码行号。</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.lineNumbers ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                    <button type="button" class="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-left shadow-sm transition-all hover:bg-[var(--bg-hover)]" @click="updateMonacoPreferences({renderWhitespace: !monacoEditorPreferences.renderWhitespace})">
                                        <span><span class="block text-sm font-medium text-[var(--text-main)]">空白字符</span><span class="mt-0.5 block text-xs text-[var(--text-secondary)]">显示边界空格与制表符。</span></span>
                                        <span class="h-2.5 w-2.5 rounded-full" :class="monacoEditorPreferences.renderWhitespace ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Agent 工具设定 -->
                        <div v-else-if="activeSection === 'agent-tools'" key="agent-tools" class="space-y-4 pt-1">
                            <div class="flex flex-wrap items-center justify-between gap-4">
                                <div class="max-w-xl">
                                    <h3 class="text-base font-semibold text-[var(--text-main)]">Agent 工具配置</h3>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">此配置仅影响后续新发起的 Agent Run。</p>
                                </div>

                                <button
                                    class="group relative inline-flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-lg px-4 text-xs font-medium transition-all duration-300 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                                    :class="backendDirty ? 'bg-[var(--accent-main)] text-white shadow-md hover:shadow-lg' : 'border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]'"
                                    :disabled="!backendDirty || savingBackend"
                                    @click="void saveBackendSettings()"
                                >
                                    <span v-if="backendDirty" class="absolute inset-0 translate-y-full bg-white/20 transition-transform duration-300 ease-out group-hover:translate-y-0"></span>
                                    <span class="relative flex items-center gap-1.5">
                                        <span v-if="savingBackend" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                        <span v-else class="i-lucide-save h-3.5 w-3.5"></span>
                                        {{ savingBackend ? "保存中..." : "保存设定" }}
                                    </span>
                                </button>
                            </div>

                            <!-- 状态仪表盘 -->
                            <div class="grid gap-3 md:grid-cols-3">
                                <div class="group relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="absolute -right-3 -top-3 opacity-5 transition-opacity group-hover:opacity-10"><span class="i-lucide-circle-dashed h-20 w-20"></span></div>
                                    <div class="relative">
                                        <div class="flex items-center gap-2">
                                            <div class="h-2 w-2 rounded-full bg-slate-400"></div>
                                            <div class="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">默认</div>
                                        </div>
                                        <div class="mt-1 text-xl font-bold text-[var(--text-main)]">{{ backendSummary.defaultCount }}</div>
                                    </div>
                                </div>
                                <div class="group relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="absolute -right-3 -top-3 text-emerald-500 opacity-5 transition-opacity group-hover:opacity-10"><span class="i-lucide-check-circle h-20 w-20"></span></div>
                                    <div class="relative">
                                        <div class="flex items-center gap-2">
                                            <div class="h-2 w-2 rounded-full bg-emerald-500"></div>
                                            <div class="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Allow</div>
                                        </div>
                                        <div class="mt-1 text-xl font-bold text-emerald-600">{{ backendSummary.allowCount }}</div>
                                    </div>
                                </div>
                                <div class="group relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 shadow-sm transition-all duration-300 hover:shadow-md">
                                    <div class="absolute -right-3 -top-3 text-rose-500 opacity-5 transition-opacity group-hover:opacity-10"><span class="i-lucide-x-circle h-20 w-20"></span></div>
                                    <div class="relative">
                                        <div class="flex items-center gap-2">
                                            <div class="h-2 w-2 rounded-full bg-rose-500"></div>
                                            <div class="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Deny</div>
                                        </div>
                                        <div class="mt-1 text-xl font-bold text-rose-600">{{ backendSummary.denyCount }}</div>
                                    </div>
                                </div>
                            </div>

                            <!-- 状态提示条 -->
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
                                <div v-if="backendError" key="error" class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm backdrop-blur-md">
                                    <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 shrink-0 text-rose-500"></span>
                                    <div class="text-sm text-rose-700">{{ backendError }}</div>
                                </div>
                                <div v-if="backendSuccessText" key="success" class="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 shadow-sm backdrop-blur-md">
                                    <span class="i-lucide-check-circle-2 mt-0.5 h-4 w-4 shrink-0 text-emerald-500"></span>
                                    <div class="text-sm text-emerald-700">{{ backendSuccessText }}</div>
                                </div>
                            </TransitionGroup>

                            <div v-if="loadingBackend" class="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                                <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
                                <span class="text-sm text-[var(--text-secondary)]">正在读取后端设定...</span>
                            </div>

                            <div v-else class="flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm overflow-hidden">
                                <div class="grid grid-cols-[minmax(0,1fr)_160px] gap-4 border-b border-[var(--border-color)] bg-[var(--bg-input)]/50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                    <span>Tool Name</span>
                                    <span>状态 (State)</span>
                                </div>

                                <div class="flex-1 custom-scrollbar overflow-y-auto">
                                    <div
                                        v-for="toolName in backendTools"
                                        :key="toolName"
                                        class="group grid grid-cols-[minmax(0,1fr)_160px] items-center gap-4 border-b border-[var(--border-color)] px-5 py-3 transition-colors hover:bg-[var(--bg-hover)]/40 last:border-b-0"
                                    >
                                        <div class="min-w-0">
                                            <div class="truncate font-mono text-[13px] font-medium text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-text)]">{{ toolName }}</div>
                                        </div>
                                        <FormSelect
                                            :model-value="backendDraft[toolName] ?? 'default'"
                                            :options="toolStateOptions"
                                            @update:model-value="backendDraft[toolName] = $event as ToolState"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 模型设定 -->
                        <div v-else-if="activeSection === 'models'" key="models">
                            <!-- 注意：ModelSettingsPanel 内部不使用 h-full，让外层自动撑开或根据内容滚动 -->
                            <NovelIdeModelSettingsPanel />
                        </div>

                        <!-- 默认 Profile 设定 -->
                        <div v-else-if="activeSection === 'agent-profile-defaults'" key="agent-profile-defaults">
                            <NovelIdeAgentProfileDefaultSettingsPanel />
                        </div>

                        <!-- Agent Profile 模型设定 -->
                        <div v-else-if="activeSection === 'agent-profile-models'" key="agent-profile-models">
                            <NovelIdeAgentProfileModelSettingsPanel />
                        </div>
                    </Transition>
                </div>
            </section>
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

