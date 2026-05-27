<script setup lang="ts">
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {ModelInputKind} from "nbook/shared/dto/app-settings.dto";

type ModelDraft = {
    name: string;
    id: string;
    group: string;
    enabled: boolean;
    provider: string;
    api: string;
    baseUrl: string;
    reasoning: "inherit" | "true" | "false";
    input: string;
    maxTokens: string;
    cost: string;
    compat: string;
    contextWindowTokens: string;
};

type ProviderDraft = {
    id: string;
    name: string;
    api: string;
};

const props = defineProps<{
    modelValue: boolean;
    editingModel: ModelDraft | null;
    activeProvider: ProviderDraft | null;
    modelApiOptions: SelectOption[];
    modelInputOptions: Array<{value: ModelInputKind; label: string; iconClass: string}>;
    deriveGroup: (modelId: string) => string;
    resolveDisplayedContextWindow: (providerId: string, model: ModelDraft) => string;
    modelApiInheritLabel: (model: ModelDraft) => string;
    modelInputDisplayLabel: (model: ModelDraft) => string;
    modelInputEnabled: (model: ModelDraft, inputKind: ModelInputKind) => boolean;
    modelReasoningDisplayLabel: (model: ModelDraft) => string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "model-id-change"): void;
    (e: "toggle-model-input", model: ModelDraft, inputKind: ModelInputKind): void;
    (e: "reset-model-input", model: ModelDraft): void;
}>();

const reasoningOptions: SelectOption[] = [
    {value: "inherit", label: "继承"},
    {value: "true", label: "支持"},
    {value: "false", label: "不支持"},
];

/**
 * 关闭模型编辑弹窗。
 */
function updateOpen(value: boolean): void {
    emit("update:modelValue", value);
}
</script>

<template>
    <!-- 模型编辑 Dialog -->
    <Dialog
        :model-value="props.modelValue"
        title="模型设置"
        width="min(740px, calc(100vw - 32px))"
        max-height="calc(100vh - 32px)"
        overlay-type="blur"
        :show-footer="false"
        body-class="!min-h-0 !gap-0 !overflow-hidden !p-0"
        @update:model-value="updateOpen"
    >
        <div v-if="props.editingModel" class="flex max-h-[calc(100vh_-_96px)] min-h-0 flex-col bg-[var(--bg-panel)]">
            <div class="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <div class="grid gap-5 md:grid-cols-2">
                    <!-- 基本信息 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-badge-info h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">基本信息</h4>
                        </div>
                        <div class="grid gap-3.5">
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">模型名称</label>
                                <FormInput v-model="props.editingModel.name" placeholder="模型名称" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">模型 ID</label>
                                <FormInput v-model="props.editingModel.id" placeholder="模型 ID" class="bg-[var(--bg-input)] shadow-sm" @update:model-value="emit('model-id-change')" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">分组</label>
                                <FormInput v-model="props.editingModel.group" :placeholder="`默认推导: ${props.deriveGroup(props.editingModel.id)}`" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                        </div>
                    </section>

                    <!-- 接口配置 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-plug h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">接口配置</h4>
                        </div>
                        <div class="grid gap-3.5">
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">Pi Registry Provider</label>
                                <FormInput v-model="props.editingModel.provider" placeholder="留空使用配置 ID" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                            <div class="space-y-2">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">接口格式</label>
                                <div class="flex flex-col gap-2 rounded-lg border border-[var(--border-color)] border-opacity-50 bg-[var(--bg-input)] bg-opacity-20 p-2">
                                    <FormSelect v-model="props.editingModel.api" :options="[{value: '', label: props.modelApiInheritLabel(props.editingModel)}, ...props.modelApiOptions]" />
                                    <div class="flex items-center gap-2">
                                        <span class="text-[10px] text-[var(--text-muted)] shrink-0 font-medium pl-1">自定义格式</span>
                                        <FormInput v-model="props.editingModel.api" placeholder="留空继承" class="bg-[var(--bg-input)] shadow-sm flex-1" />
                                    </div>
                                </div>
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">模型 Base URL</label>
                                <FormInput v-model="props.editingModel.baseUrl" placeholder="留空继承 Registry 或 Provider API Base" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                        </div>
                    </section>

                    <!-- 运行限制 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-gauge h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">运行限制</h4>
                        </div>
                        <div class="grid gap-3.5">
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">上下文窗口</label>
                                <FormInput v-model="props.editingModel.contextWindowTokens" :placeholder="props.activeProvider ? `留空不配置${props.resolveDisplayedContextWindow(props.activeProvider.id, props.editingModel) ? `，当前 ${props.resolveDisplayedContextWindow(props.activeProvider.id, props.editingModel)}` : ''}` : '留空不配置'" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">Max Tokens</label>
                                <FormInput v-model="props.editingModel.maxTokens" placeholder="留空继承" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                        </div>
                    </section>

                    <!-- 能力 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">模型能力</h4>
                        </div>
                        <div class="grid gap-4">
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">输入能力</label>
                                    <span class="truncate text-[10px] text-[var(--text-muted)] font-medium">当前: {{ props.modelInputDisplayLabel(props.editingModel) }}</span>
                                </div>
                                <div class="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border-color)] border-opacity-40 bg-[var(--bg-input)] bg-opacity-25 p-1">
                                    <button
                                        v-for="option in props.modelInputOptions"
                                        :key="option.value"
                                        type="button"
                                        class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-all duration-200"
                                        :class="props.modelInputEnabled(props.editingModel, option.value) ? 'border border-[var(--accent-main)] border-opacity-30 bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm font-semibold' : 'border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                        :title="`${option.label}输入`"
                                        @click="emit('toggle-model-input', props.editingModel, option.value)"
                                    >
                                        <span class="h-3.5 w-3.5" :class="option.iconClass"></span>
                                        {{ option.label }}
                                    </button>
                                    <button
                                        type="button"
                                        class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent text-[11px] font-medium text-[var(--text-muted)] transition-all duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                        title="清空后继承 Registry 或 Provider 默认"
                                        @click="emit('reset-model-input', props.editingModel)"
                                    >
                                        <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                        继承
                                    </button>
                                </div>
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">Reasoning 能力</label>
                                    <span class="truncate text-[10px] text-[var(--text-muted)] font-medium">当前: {{ props.modelReasoningDisplayLabel(props.editingModel) }}</span>
                                </div>
                                <FormSelect v-model="props.editingModel.reasoning" :options="reasoningOptions" />
                                <div class="flex items-start gap-1.5 rounded-lg border border-[var(--border-color)] border-opacity-30 bg-[var(--bg-input)] bg-opacity-15 p-2 text-[10px] leading-normal text-[var(--text-muted)]">
                                    <span class="i-lucide-info h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] mt-0.5"></span>
                                    <span>描述模型是否支持推理思考。思考强度可在 Agent Profile 中进行调节。</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <!-- 高级 JSON 配置 -->
                <div class="mt-5 rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                    <div class="flex items-center gap-2 pb-1">
                        <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-braces h-3.5 w-3.5"></span>
                        </span>
                        <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">高级配置 (JSON)</h4>
                    </div>
                    <div class="grid gap-5 md:grid-cols-2">
                        <div class="space-y-2">
                            <div class="flex items-center justify-between">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">Compat JSON</label>
                                <span class="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-hover)] border border-[var(--border-color)] px-1.5 py-0.5 rounded">COMPAT</span>
                            </div>
                            <textarea
                                v-model="props.editingModel.compat"
                                placeholder="{&quot;thinkingFormat&quot;:&quot;deepseek&quot;}"
                                spellcheck="false"
                                class="w-full h-24 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 font-mono text-[11px] text-[var(--text-main)] outline-none transition-all placeholder:text-[var(--text-muted)] placeholder:text-opacity-50 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20 custom-scrollbar"
                            ></textarea>
                        </div>
                        <div class="space-y-2">
                            <div class="flex items-center justify-between">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">Cost JSON</label>
                                <span class="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-hover)] border border-[var(--border-color)] px-1.5 py-0.5 rounded">COST</span>
                            </div>
                            <textarea
                                v-model="props.editingModel.cost"
                                placeholder="{&quot;input&quot;:0,&quot;output&quot;:0,&quot;cacheRead&quot;:0,&quot;cacheWrite&quot;:0}"
                                spellcheck="false"
                                class="w-full h-24 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 font-mono text-[11px] text-[var(--text-main)] outline-none transition-all placeholder:text-[var(--text-muted)] placeholder:text-opacity-50 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)] focus:ring-opacity-20 custom-scrollbar"
                            ></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Dialog>
</template>
