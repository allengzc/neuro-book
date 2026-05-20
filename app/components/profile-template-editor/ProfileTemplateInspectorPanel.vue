<script setup lang="ts">
import FormCheckbox from "nbook/app/components/common/form/FormCheckbox.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import ProfileTemplateVariableGroups from "nbook/app/components/profile-template-editor/ProfileTemplateVariableGroups.vue";
import type {
    InspectorTab,
    PreviewVariableGroup,
    SelectOption,
    SelectedPropEntry,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {
    ProfileTemplateIssueDto,
    ProfileTemplateNodeDto,
    ProfileTemplatePropValue,
} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    activeTab: InspectorTab;
    tabs: Array<{value: InspectorTab; label: string}>;
    selectedNode: ProfileTemplateNodeDto | null;
    selectedPropEntries: SelectedPropEntry[];
    selectedTextLength: number;
    issues: ProfileTemplateIssueDto[];
    variableSearch: string;
    variableGroups: PreviewVariableGroup[];
    filteredVariableGroups: PreviewVariableGroup[];
    filteredRuntimeVariableGroups: PreviewVariableGroup[];
    roleOptions: SelectOption[];
    toolStatusOptions: SelectOption[];
    sourceOptions: SelectOption[];
    theme: IdeTheme;
    isExpressionValue: (value: ProfileTemplatePropValue | undefined) => boolean;
    propInputValue: (value: ProfileTemplatePropValue) => string;
    propLabel: (key: string) => string;
    nodeTitle: (node: ProfileTemplateNodeDto) => string;
    issueDetail: (issue: ProfileTemplateIssueDto) => string;
    formatVariableValue: (value: unknown) => string;
    isVariableGroupCollapsed: (group: string) => boolean;
}>();

const emit = defineEmits<{
    (e: "update:activeTab", value: InspectorTab): void;
    (e: "update:variableSearch", value: string): void;
    (e: "update-active-target", value: "text" | string): void;
    (e: "update-prop", key: string, value: ProfileTemplatePropValue): void;
    (e: "update-expression-prop", key: string, value: string): void;
    (e: "update-text", value: string): void;
    (e: "commit-message-text"): void;
    (e: "insert-variable", value: string): void;
    (e: "toggle-variable-group", group: string): void;
}>();
</script>

<template>
    <!-- 右侧属性检查器：属性、变量、运行时变量 -->
    <section class="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div class="mb-3 flex shrink-0 border-b border-[var(--border-color)]">
            <button
                v-for="tab in props.tabs"
                :key="tab.value"
                class="relative h-8 px-4 text-xs font-medium transition-colors"
                :class="props.activeTab === tab.value ? 'text-[var(--accent-text)] after:absolute after:bottom-[-1px] after:left-0 after:h-0.5 after:w-full after:bg-[var(--accent-main)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'"
                @click="emit('update:activeTab', tab.value)"
            >
                {{ tab.label }}
            </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto pr-1 custom-scrollbar">
            <div v-if="props.activeTab === 'props'">
                <div v-if="props.selectedNode" class="space-y-3">
                    <div class="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                        <span class="i-lucide-message-square h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                        <span>当前选中：</span>
                        <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 font-semibold text-[var(--text-main)]">{{ props.nodeTitle(props.selectedNode) }}</span>
                        <span class="truncate text-[var(--text-muted)]">/ id: {{ props.selectedNode.id }}</span>
                    </div>
                    <FormField label="ID">
                        <FormInput :model-value="props.selectedNode.id" readonly />
                    </FormField>

                    <div v-if="props.selectedPropEntries.length > 0" class="space-y-3">
                        <div v-for="[key, value] in props.selectedPropEntries" :key="key" class="space-y-1">
                            <div class="flex items-center justify-between gap-2">
                                <div class="field-label">{{ props.propLabel(key) }}</div>
                                <span v-if="props.isExpressionValue(value)" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">表达式</span>
                            </div>
                            <FormSelect v-if="key === 'role'" :model-value="String(value ?? 'system')" :options="props.roleOptions" @focus="emit('update-active-target', key)" @update:model-value="emit('update-prop', key, $event)" />
                            <FormSelect v-else-if="key === 'status'" :model-value="String(value ?? 'drafting')" :options="props.toolStatusOptions" @focus="emit('update-active-target', key)" @update:model-value="emit('update-prop', key, $event)" />
                            <FormSelect v-else-if="key === 'source'" :model-value="String(value ?? 'context')" :options="props.sourceOptions" @focus="emit('update-active-target', key)" @update:model-value="emit('update-prop', key, $event)" />
                            <FormTextarea
                                v-else-if="props.isExpressionValue(value)"
                                :model-value="props.propInputValue(value)"
                                :rows="4"
                                class="textarea font-mono"
                                @focus="emit('update-active-target', key)"
                                @update:model-value="emit('update-expression-prop', key, $event)"
                            />
                            <FormCheckbox v-else-if="typeof value === 'boolean'" :model-value="value" @focus="emit('update-active-target', key)" @update:model-value="emit('update-prop', key, $event)" />
                            <FormInput v-else-if="typeof value === 'number'" :model-value="String(value)" type="number" @focus="emit('update-active-target', key)" @update:model-value="emit('update-prop', key, Number($event || 0))" />
                            <FormInput v-else :model-value="props.propInputValue(value)" @focus="emit('update-active-target', key)" @update:model-value="emit('update-prop', key, $event)" />
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 px-3 py-2 text-xs text-[var(--text-muted)]">此节点暂无属性。</div>

                    <template v-if="props.selectedNode.type === 'Message' || props.selectedNode.type === 'AIMessage' || props.selectedNode.type === 'ToolCall'">
                        <div class="field-label">{{ props.selectedNode.textKind === "source" ? "内容（TSX 表达式内容）" : "内容（支持变量引用）" }}</div>
                        <StructuredTextEditor
                            :model-value="props.selectedNode.text ?? ''"
                            :rows="props.selectedNode.type === 'ToolCall' ? 5 : 8"
                            :min-height="props.selectedNode.type === 'ToolCall' ? 120 : 172"
                            :max-height="420"
                            :default-mode="props.selectedNode.textKind === 'source' ? 'source' : 'rich'"
                            :show-format-toolbar="props.selectedNode.textKind !== 'source' && props.selectedNode.textKind !== 'template'"
                            :theme="props.theme"
                            placeholder="输入 Message 正文，可使用 Markdown 与变量引用"
                            @focus="emit('update-active-target', 'text')"
                            @blur="emit('commit-message-text')"
                            @update:model-value="emit('update-text', $event)"
                        />
                        <div class="text-right text-[11px] text-[var(--text-muted)]">字数：{{ props.selectedTextLength }} / 20000</div>
                        <div class="space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 p-3">
                            <div class="text-[11px] font-semibold text-[var(--text-secondary)]">变量插入提示</div>
                            <div class="flex flex-wrap gap-2">
                                <button
                                    v-for="item in (props.variableGroups[0]?.items ?? []).slice(0, 3)"
                                    :key="item.value"
                                    class="variable-chip"
                                    @click="emit('insert-variable', item.token)"
                                >
                                    {{ item.token }}
                                </button>
                            </div>
                        </div>
                    </template>
                </div>
                <div v-else class="empty-state">请选择一个节点。</div>

                <div class="mt-4 border-t border-[var(--border-color)] pt-3">
                    <div class="mb-2 text-xs font-semibold text-[var(--text-secondary)]">验证结果</div>
                    <div v-if="props.issues.length === 0" class="text-xs text-emerald-600">暂无问题</div>
                    <div v-for="issue in props.issues" :key="`${issue.message}-${issue.nodeId ?? ''}`" class="mb-1 rounded-md border px-2 py-1 text-xs" :class="issue.severity === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-600' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'">
                        <div class="font-medium">{{ issue.message }}</div>
                        <div v-if="props.issueDetail(issue)" class="mt-1 text-[10px] leading-4 opacity-80">{{ props.issueDetail(issue) }}</div>
                    </div>
                </div>
            </div>

            <div v-else-if="props.activeTab === 'variables'" class="space-y-3">
                <div class="text-[11px] leading-5 text-[var(--text-muted)]">点击变量会追加到当前聚焦字段；未聚焦时追加到选中节点文本。</div>
                <FormInput :model-value="props.variableSearch" placeholder="搜索变量、路径或当前值" @update:model-value="emit('update:variableSearch', $event)" />
                <ProfileTemplateVariableGroups
                    :groups="props.filteredVariableGroups"
                    :is-collapsed="props.isVariableGroupCollapsed"
                    :format-value="props.formatVariableValue"
                    @toggle-group="emit('toggle-variable-group', $event)"
                    @insert-variable="emit('insert-variable', $event)"
                />
            </div>

            <div v-else class="space-y-3">
                <FormInput :model-value="props.variableSearch" placeholder="搜索运行时变量" @update:model-value="emit('update:variableSearch', $event)" />
                <ProfileTemplateVariableGroups
                    :groups="props.filteredRuntimeVariableGroups"
                    compact
                    :is-collapsed="props.isVariableGroupCollapsed"
                    :format-value="props.formatVariableValue"
                    @toggle-group="emit('toggle-variable-group', $event)"
                    @insert-variable="emit('insert-variable', $event)"
                />
            </div>
        </div>
    </section>
</template>

<style scoped>
.panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    padding: 12px;
    box-shadow: 0 16px 44px rgba(15, 23, 42, 0.05);
}

.field-label {
    display: block;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
}

.field,
.textarea {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    color: var(--text-main);
    font-size: 12px;
    outline: none;
}

.textarea {
    min-height: 150px;
    resize: vertical;
    padding: 9px 10px;
    line-height: 1.6;
}

.textarea:focus {
    border-color: var(--accent-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 16%, transparent);
}

.variable-chip {
    display: inline-flex;
    max-width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 30%, var(--border-color));
    border-radius: 5px;
    background: var(--accent-bg);
    padding: 3px 7px;
    color: var(--accent-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
}

.empty-state {
    display: flex;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-input) 55%, transparent);
    color: var(--text-muted);
    font-size: 13px;
}
</style>
