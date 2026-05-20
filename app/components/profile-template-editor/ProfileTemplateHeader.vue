<script setup lang="ts">
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {SelectOption} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";

const props = defineProps<{
    selectedTemplate: string;
    templateOptions: SelectOption[];
    selectedTemplateFileName: string;
    theme: IdeTheme;
    themeOptions: ReadonlyArray<{value: IdeTheme; label: string}>;
    editorStatusText: string;
    canUndo: boolean;
    canRedo: boolean;
    previewing: boolean;
    validating: boolean;
    saving: boolean;
    parsingSource: boolean;
    sourceText: string;
    issueCount: number;
    restoreEnabled?: boolean;
    restoring?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:selectedTemplate", value: string): void;
    (e: "set-theme", value: IdeTheme): void;
    (e: "undo"): void;
    (e: "redo"): void;
    (e: "preview"): void;
    (e: "validate"): void;
    (e: "restore"): void;
    (e: "save"): void;
}>();
</script>

<template>
    <!-- TSX Profile 顶部工具栏 -->
    <header class="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4">
        <div class="flex min-w-0 items-center gap-3">
            <div class="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--accent-main)] text-xs font-semibold text-white shadow-sm">TS</div>
            <div class="min-w-0">
                <div class="flex items-center gap-2 text-[13px] font-semibold">
                    <span class="truncate">TSX Profile 可视化编辑器</span>
                    <span class="i-lucide-chevron-right h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                    <span class="truncate text-[12px] font-medium text-[var(--text-secondary)]">当前位置：{{ props.selectedTemplateFileName }}</span>
                </div>
            </div>
        </div>

        <FormSelect :model-value="props.selectedTemplate" :options="props.templateOptions" placeholder="选择模板" dropdown-direction="down" class="min-w-[220px]" @update:model-value="emit('update:selectedTemplate', $event)" />

        <div class="hidden items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-0.5 lg:flex">
            <button
                v-for="option in props.themeOptions"
                :key="option.value"
                class="h-6 rounded px-2 text-[11px] font-medium transition-colors"
                :class="props.theme === option.value ? 'bg-[var(--bg-panel)] text-[var(--accent-text)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                @click="emit('set-theme', option.value)"
            >
                {{ option.label }}
            </button>
        </div>

        <div class="ml-auto flex items-center gap-2">
            <span class="hidden items-center gap-1 text-xs text-emerald-600 md:flex">
                <span class="i-lucide-circle-check h-3.5 w-3.5"></span>
                <span>{{ props.editorStatusText }}</span>
            </span>
            <div class="mx-2 hidden h-4 w-px bg-[var(--border-color)] lg:block"></div>
            <button class="icon-btn" title="撤销 Ctrl+Z" :disabled="!props.canUndo" @click="emit('undo')">
                <span class="i-lucide-undo-2 h-4 w-4"></span>
            </button>
            <button class="icon-btn" title="重做 Ctrl+Shift+Z" :disabled="!props.canRedo" @click="emit('redo')">
                <span class="i-lucide-redo-2 h-4 w-4"></span>
            </button>
            <button class="toolbar-btn" :disabled="props.previewing || !props.sourceText" @click="emit('preview')">
                <span class="i-lucide-play h-3.5 w-3.5"></span>
                <span>预览</span>
            </button>
            <button class="toolbar-btn" :disabled="props.validating || !props.sourceText" @click="emit('validate')">
                <span class="i-lucide-badge-check h-3.5 w-3.5"></span>
                <span>验证</span>
            </button>
            <button v-if="props.restoreEnabled" class="toolbar-btn" :disabled="props.restoring || props.saving || !props.sourceText" @click="emit('restore')">
                <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                <span>恢复系统版本</span>
            </button>
            <button class="toolbar-btn primary" :disabled="props.saving || props.parsingSource || !props.sourceText || props.issueCount > 0" @click="emit('save')">
                <span class="i-lucide-save h-3.5 w-3.5"></span>
                <span>保存</span>
                <span class="i-lucide-chevron-down h-3.5 w-3.5 opacity-80"></span>
            </button>
        </div>
    </header>
</template>

<style scoped>
.toolbar-btn,
.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 12px;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.toolbar-btn {
    height: 32px;
    padding: 0 12px;
}

.toolbar-btn.primary {
    border-color: var(--accent-main);
    background: var(--accent-main);
    color: white;
}

.icon-btn {
    height: 32px;
    width: 32px;
}

.toolbar-btn:hover:not(:disabled),
.icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-main);
}

.toolbar-btn:disabled,
.icon-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
</style>
