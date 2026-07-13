<script setup lang="ts">
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import {hasModelCostOverride, parseModelCostDraft, type ModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import type {ConfiguredModelDto, ModelInputKind} from "nbook/shared/dto/app-settings.dto";

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
    cost: ModelCostDraft;
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
    /** 当前模型从 Pi registry 继承的原始价格；registry 无匹配模型时为空。 */
    inheritedCost: NonNullable<ConfiguredModelDto["cost"]> | null;
    modelApiOptions: SelectOption[];
    modelInputOptions: Array<{value: ModelInputKind; label: string; iconClass: string}>;
    deriveGroup: (modelId: string) => string;
    resolveDisplayedContextWindow: (providerId: string, model: ModelDraft) => string;
    modelApiInheritLabel: (model: ModelDraft) => string;
    modelContextWindowDefaultLabel: (model: ModelDraft) => string;
    modelMaxTokensDefaultLabel: (model: ModelDraft) => string;
    modelInputDisplayLabel: (model: ModelDraft) => string;
    modelInputEnabled: (model: ModelDraft, inputKind: ModelInputKind) => boolean;
    modelReasoningDisplayLabel: (model: ModelDraft) => string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "model-id-change"): void;
    (e: "toggle-model-input", model: ModelDraft, inputKind: ModelInputKind): void;
    (e: "reset-model-input", model: ModelDraft): void;
    (e: "reset-model-cost", model: ModelDraft): void;
    (e: "enable-model-cost", model: ModelDraft): void;
}>();

const {t} = useI18n();

const reasoningOptions = computed<SelectOption[]>(() => [
    {value: "inherit", label: t("settings.panels.modelEdit.inherit")},
    {value: "true", label: t("settings.panels.modelEdit.supported")},
    {value: "false", label: t("settings.panels.modelEdit.unsupported")},
]);

const costFields = computed<Array<{key: keyof Pick<ModelCostDraft, "input" | "output" | "cacheRead" | "cacheWrite">; label: string; placeholder: string}>>(() => [
    {key: "input", label: t("settings.panels.modelEdit.costInput"), placeholder: "0.14"},
    {key: "output", label: t("settings.panels.modelEdit.costOutput"), placeholder: "0.28"},
    {key: "cacheRead", label: t("settings.panels.modelEdit.costCacheRead"), placeholder: "0.0028"},
    {key: "cacheWrite", label: t("settings.panels.modelEdit.costCacheWrite"), placeholder: "0"},
]);

const costValidationError = computed(() => {
    const model = props.editingModel;
    if (!model || !hasModelCostOverride(model.cost)) {
        return "";
    }
    try {
        parseModelCostDraft(model.cost);
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
});

/**
 * 新增一档长上下文价格，默认复制基础价格以减少漏填。
 */
function addCostTier(model: ModelDraft): void {
    model.cost.tiers.push({
        inputTokensAbove: "",
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
    });
}

/**
 * 判断当前模型是否覆盖 Pi registry 价格。
 */
function modelCostSourceLabel(model: ModelDraft): string {
    return hasModelCostOverride(model.cost) ? t("settings.panels.modelEdit.customOverride") : t("settings.panels.modelEdit.inheritPiRegistry");
}

/**
 * 当前价格输入单位。
 */
function modelCostUnitLabel(model: ModelDraft): string {
    return "USD / 1M tokens";
}

/**
 * 格式化只读继承价格。
 */
function formatInheritedPrice(value: number): string {
    return Number.isFinite(value) ? String(value) : "-";
}

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
        :title="t('settings.panels.modelEdit.title')"
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
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--shadow-color)_2%,transparent)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-badge-info h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">{{ t("settings.panels.modelEdit.basicInfo") }}</h4>
                        </div>
                        <div class="grid gap-3.5">
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.modelName") }}</label>
                                <FormInput v-model="props.editingModel.name" :placeholder="t('settings.panels.modelEdit.modelName')" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.modelId") }}</label>
                                <FormInput v-model="props.editingModel.id" :placeholder="t('settings.panels.modelEdit.modelId')" class="bg-[var(--bg-input)] shadow-sm" @update:model-value="emit('model-id-change')" />
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.group") }}</label>
                                <FormInput v-model="props.editingModel.group" :placeholder="t('settings.panels.modelEdit.defaultDerived', {group: props.deriveGroup(props.editingModel.id)})" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                        </div>
                    </section>

                    <!-- 接口配置 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--shadow-color)_2%,transparent)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-plug h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">{{ t("settings.panels.modelEdit.apiConfig") }}</h4>
                        </div>
                        <div class="grid gap-3.5">
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">Pi Registry Provider</label>
                                <FormInput v-model="props.editingModel.provider" :placeholder="t('settings.panels.modelEdit.providerPlaceholder')" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                            <div class="space-y-2">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.apiFormat") }}</label>
                                <div class="flex flex-col gap-2 rounded-lg border border-[var(--border-color)] border-opacity-50 bg-[var(--bg-input)] bg-opacity-20 p-2">
                                    <FormSelect v-model="props.editingModel.api" :options="[{value: '', label: props.modelApiInheritLabel(props.editingModel)}, ...props.modelApiOptions]" />
                                </div>
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.modelBaseUrl") }}</label>
                                <FormInput v-model="props.editingModel.baseUrl" :placeholder="t('settings.panels.modelEdit.baseUrlPlaceholder')" class="bg-[var(--bg-input)] shadow-sm" />
                            </div>
                        </div>
                    </section>

                    <!-- 运行限制 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--shadow-color)_2%,transparent)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-gauge h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">{{ t("settings.panels.modelEdit.limits") }}</h4>
                        </div>
                        <div class="grid gap-3.5">
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.contextWindow") }}</label>
                                    <span class="truncate text-[10px] text-[var(--text-muted)] font-medium">{{ t("settings.panels.modelEdit.emptyLabel", {value: props.modelContextWindowDefaultLabel(props.editingModel)}) }}</span>
                                </div>
                                <FormInput v-model="props.editingModel.contextWindowTokens" :placeholder="t('settings.panels.modelEdit.emptyUse', {value: props.modelContextWindowDefaultLabel(props.editingModel)})" class="bg-[var(--bg-input)] shadow-sm" />
                                <p class="text-[10px] leading-4 text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.contextWindowDescription") }}</p>
                            </div>
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">Max Tokens</label>
                                    <span class="truncate text-[10px] text-[var(--text-muted)] font-medium">{{ t("settings.panels.modelEdit.emptyLabel", {value: props.modelMaxTokensDefaultLabel(props.editingModel)}) }}</span>
                                </div>
                                <FormInput v-model="props.editingModel.maxTokens" :placeholder="t('settings.panels.modelEdit.emptyUse', {value: props.modelMaxTokensDefaultLabel(props.editingModel)})" class="bg-[var(--bg-input)] shadow-sm" />
                                <p class="text-[10px] leading-4 text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.maxTokensDescription") }}</p>
                            </div>
                        </div>
                    </section>

                    <!-- 能力 -->
                    <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--shadow-color)_2%,transparent)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                        <div class="flex items-center gap-2 pb-1">
                            <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
                            </span>
                            <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">{{ t("settings.panels.modelEdit.capabilities") }}</h4>
                        </div>
                        <div class="grid gap-4">
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.inputCapability") }}</label>
                                    <span class="truncate text-[10px] text-[var(--text-muted)] font-medium">{{ t("settings.panels.modelEdit.currentLabel", {value: props.modelInputDisplayLabel(props.editingModel)}) }}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border-color)] border-opacity-40 bg-[var(--bg-input)] bg-opacity-25 p-1">
                                    <button
                                        v-for="option in props.modelInputOptions"
                                        :key="option.value"
                                        type="button"
                                        class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-all duration-200"
                                        :class="props.modelInputEnabled(props.editingModel, option.value) ? 'border border-[var(--accent-main)] border-opacity-30 bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm font-semibold' : 'border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                                        :title="t('settings.panels.modelEdit.inputTitle', {label: option.label})"
                                        @click="emit('toggle-model-input', props.editingModel, option.value)"
                                    >
                                        <span class="h-3.5 w-3.5" :class="option.iconClass"></span>
                                        {{ option.label }}
                                    </button>
                                    <button
                                        type="button"
                                        class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent text-[11px] font-medium text-[var(--text-muted)] transition-all duration-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                        :title="t('settings.panels.modelEdit.inheritInputTitle')"
                                        @click="emit('reset-model-input', props.editingModel)"
                                    >
                                        <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.modelEdit.inherit") }}
                                    </button>
                                </div>
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.reasoningCapability") }}</label>
                                    <span class="truncate text-[10px] text-[var(--text-muted)] font-medium">{{ t("settings.panels.modelEdit.currentLabel", {value: props.modelReasoningDisplayLabel(props.editingModel)}) }}</span>
                                </div>
                                <FormSelect v-model="props.editingModel.reasoning" :options="reasoningOptions" />
                                <div class="flex items-start gap-1.5 rounded-lg border border-[var(--border-color)] border-opacity-30 bg-[var(--bg-input)] bg-opacity-15 p-2 text-[10px] leading-normal text-[var(--text-muted)]">
                                    <span class="i-lucide-info h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] mt-0.5"></span>
                                    <span>{{ t("settings.panels.modelEdit.reasoningDescription") }}</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <!-- 高级配置 -->
                <div class="mt-5 rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-4 space-y-4 transition-all duration-300 hover:shadow-[0_4px_20px_color-mix(in_srgb,var(--shadow-color)_2%,transparent)] hover:border-[var(--accent-main)] hover:border-opacity-30">
                    <div class="flex items-center gap-2 pb-1">
                        <span class="flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-braces h-3.5 w-3.5"></span>
                        </span>
                        <h4 class="text-xs font-bold text-[var(--text-main)] tracking-wider">{{ t("settings.panels.modelEdit.advanced") }}</h4>
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
                        <div class="space-y-3">
                            <div class="flex items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <label class="text-xs font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.modelCost") }}</label>
                                    <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">{{ modelCostUnitLabel(props.editingModel) }}</div>
                                </div>
                                <span class="shrink-0 text-[9px] font-bold uppercase tracking-wider bg-[var(--bg-hover)] border border-[var(--border-color)] px-1.5 py-0.5 rounded" :class="hasModelCostOverride(props.editingModel.cost) ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]'">{{ modelCostSourceLabel(props.editingModel) }}</span>
                            </div>
                            <div v-if="!hasModelCostOverride(props.editingModel.cost)" class="space-y-2 rounded-lg border border-[var(--border-color)] border-opacity-30 bg-[var(--bg-input)] bg-opacity-15 p-3">
                                <p class="text-[10px] leading-normal text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.inheritedCostDescription") }}</p>
                                <template v-if="props.inheritedCost">
                                    <!-- Pi registry 基础价格摘要 -->
                                    <div class="grid grid-cols-2 gap-2">
                                        <div v-for="field in costFields" :key="field.key" class="rounded-md border border-[var(--border-color)] border-opacity-30 px-2 py-1.5">
                                            <div class="text-[9px] text-[var(--text-muted)]">{{ field.label }}</div>
                                            <div class="mt-0.5 text-[10px] font-medium text-[var(--text-main)]">{{ formatInheritedPrice(props.inheritedCost[field.key]) }}</div>
                                        </div>
                                    </div>
                                    <!-- Pi registry 长上下文 tier 摘要 -->
                                    <div class="space-y-1.5">
                                        <div class="text-[10px] font-medium text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.inheritedCostTierCount", {count: props.inheritedCost.tiers.length}) }}</div>
                                        <div v-for="tier in props.inheritedCost.tiers" :key="tier.inputTokensAbove" class="rounded-md border border-[var(--border-color)] border-opacity-30 px-2 py-1.5 text-[9px] text-[var(--text-muted)]">
                                            <div class="font-medium text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.inheritedCostThreshold", {threshold: tier.inputTokensAbove}) }}</div>
                                            <div class="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                                                <span v-for="field in costFields" :key="field.key">{{ field.label }}: {{ formatInheritedPrice(tier[field.key]) }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </template>
                                <p v-else class="text-[10px] text-[var(--status-warning)]">{{ t("settings.panels.modelEdit.inheritedCostUnavailable") }}</p>
                                <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--accent-main)] px-2 text-[10px] font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg)]" @click="emit('enable-model-cost', props.editingModel)">
                                    <span class="i-lucide-pencil h-3 w-3"></span>
                                    {{ t("settings.panels.modelEdit.enableCostOverride") }}
                                </button>
                            </div>
                            <div v-else class="grid grid-cols-2 gap-2">
                                <div v-for="field in costFields" :key="field.key" class="space-y-1">
                                    <label class="text-[10px] font-medium text-[var(--text-muted)]">{{ field.label }}</label>
                                    <FormInput v-model="props.editingModel.cost[field.key]" type="number" min="0" step="0.000001" :placeholder="field.placeholder" class="bg-[var(--bg-input)] shadow-sm" />
                                </div>
                            </div>
                            <div v-if="hasModelCostOverride(props.editingModel.cost)" class="space-y-2">
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-[10px] font-semibold text-[var(--text-secondary)]">{{ t("settings.panels.modelEdit.costTiers") }}</span>
                                    <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="addCostTier(props.editingModel)">
                                        <span class="i-lucide-plus h-3 w-3"></span>
                                        {{ t("settings.panels.modelEdit.addCostTier") }}
                                    </button>
                                </div>
                                <div v-for="(tier, index) in props.editingModel.cost.tiers" :key="index" class="rounded-lg border border-[var(--border-color)] border-opacity-40 p-2 space-y-2">
                                    <div class="flex items-center justify-between gap-2">
                                        <label class="text-[10px] font-medium text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.costTierThreshold") }}</label>
                                        <button type="button" class="text-[var(--status-danger)]" :title="t('settings.panels.modelEdit.removeCostTier')" @click="props.editingModel.cost.tiers.splice(index, 1)">
                                            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        </button>
                                    </div>
                                    <FormInput v-model="tier.inputTokensAbove" type="number" min="0" step="1" placeholder="200000" class="bg-[var(--bg-input)] shadow-sm" />
                                    <div class="grid grid-cols-2 gap-2">
                                        <div v-for="field in costFields" :key="field.key" class="space-y-1">
                                            <label class="text-[10px] text-[var(--text-muted)]">{{ field.label }}</label>
                                            <FormInput v-model="tier[field.key]" type="number" min="0" step="0.000001" class="bg-[var(--bg-input)] shadow-sm" />
                                        </div>
                                    </div>
                                </div>
                                <p v-if="costValidationError" class="text-[10px] text-[var(--status-danger)]">{{ costValidationError }}</p>
                            </div>
                            <div v-if="hasModelCostOverride(props.editingModel.cost)" class="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] border-opacity-30 bg-[var(--bg-input)] bg-opacity-15 p-2">
                                <span class="min-w-0 text-[10px] leading-normal text-[var(--text-muted)]">{{ t("settings.panels.modelEdit.costDescription") }}</span>
                                <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.panels.modelEdit.clearCostTitle')" @click="emit('reset-model-cost', props.editingModel)">
                                    <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                                    {{ t("settings.panels.modelEdit.clear") }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Dialog>
</template>
