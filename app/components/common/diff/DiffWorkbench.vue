<script setup lang="ts">
import SharedDiffEditor from "nbook/app/components/common/diff/SharedDiffEditor.vue";
import SharedMergeEditor from "nbook/app/components/common/diff/SharedMergeEditor.vue";
import type {DiffWorkbenchDocument, DiffWorkbenchMode} from "nbook/app/components/common/diff/diff-workbench.types";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";

const props = withDefaults(defineProps<{
    document: DiffWorkbenchDocument;
    theme?: IdeTheme;
    mode?: DiffWorkbenchMode;
    mergeReadonly?: boolean;
    renderSideBySide?: boolean;
    showWhitespace?: boolean;
}>(), {
    theme: "sepia",
    mergeReadonly: false,
    renderSideBySide: true,
    showWhitespace: false,
});

const emit = defineEmits<{
    (e: "update:mode", value: DiffWorkbenchMode): void;
    (e: "update:resultContent", value: string): void;
    (e: "save-request"): void;
}>();

const localMode = ref<DiffWorkbenchMode>(props.mode ?? "diff");
const activeMode = computed({
    get: () => props.mode ?? localMode.value,
    set: (value: DiffWorkbenchMode) => {
        localMode.value = value;
        emit("update:mode", value);
    },
});

const resultContent = computed({
    get: () => props.document.resultContent ?? props.document.currentContent,
    set: (value: string) => emit("update:resultContent", value),
});

const language = computed(() => props.document.language ?? "markdown");
const currentLabel = computed(() => props.document.currentLabel ?? "Current");
const incomingLabel = computed(() => props.document.incomingLabel ?? "Incoming");
const baseLabel = computed(() => props.document.baseLabel ?? "Base");
const resultLabel = computed(() => props.document.resultLabel ?? "Result");
const hasBase = computed(() => typeof props.document.baseContent === "string");

const tabs = computed<Array<{id: DiffWorkbenchMode; label: string; enabled: boolean}>>(() => [
    {id: "diff", label: "Diff", enabled: true},
    {id: "merge", label: "Merge", enabled: true},
    {id: "current-base", label: `${currentLabel.value} vs ${baseLabel.value}`, enabled: hasBase.value},
    {id: "incoming-base", label: `${incomingLabel.value} vs ${baseLabel.value}`, enabled: hasBase.value},
]);

const visibleTabs = computed(() => tabs.value.filter((tab) => tab.enabled));

watch(() => props.mode, (mode) => {
    if (mode) {
        localMode.value = mode;
    }
});

watch(() => props.document.id, () => {
    activeMode.value = "diff";
});
</script>

<template>
    <div class="diff-workbench">
        <header class="diff-workbench__header">
            <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ document.title }}</div>
                <div v-if="document.path" class="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">{{ document.path }}</div>
            </div>
            <div class="diff-workbench__tabs">
                <button
                    v-for="tab in visibleTabs"
                    :key="tab.id"
                    type="button"
                    class="diff-workbench__tab"
                    :class="activeMode === tab.id ? 'is-active' : ''"
                    @click="activeMode = tab.id"
                >
                    {{ tab.label }}
                </button>
            </div>
        </header>

        <section class="diff-workbench__body">
            <SharedDiffEditor
                v-if="activeMode === 'diff'"
                :model-key="`${document.id}:diff`"
                :original-content="document.currentContent"
                :modified-content="document.incomingContent"
                :original-label="currentLabel"
                :modified-label="incomingLabel"
                :language="language"
                :theme="theme"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
            />
            <SharedMergeEditor
                v-else-if="activeMode === 'merge'"
                v-model="resultContent"
                :model-key="`${document.id}:merge`"
                :base-content="document.baseContent"
                :current-content="document.currentContent"
                :current-label="currentLabel"
                :incoming-content="document.incomingContent"
                :incoming-label="incomingLabel"
                :language="language"
                :theme="theme"
                :readonly="mergeReadonly"
                :show-whitespace="showWhitespace"
                :result-label="resultLabel"
                @save-request="emit('save-request')"
            />
            <SharedDiffEditor
                v-else-if="activeMode === 'current-base' && document.baseContent !== undefined"
                :model-key="`${document.id}:current-base`"
                :original-content="document.baseContent"
                :modified-content="document.currentContent"
                :original-label="baseLabel"
                :modified-label="currentLabel"
                :language="language"
                :theme="theme"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
            />
            <SharedDiffEditor
                v-else-if="activeMode === 'incoming-base' && document.baseContent !== undefined"
                :model-key="`${document.id}:incoming-base`"
                :original-content="document.baseContent"
                :modified-content="document.incomingContent"
                :original-label="baseLabel"
                :modified-label="incomingLabel"
                :language="language"
                :theme="theme"
                :render-side-by-side="renderSideBySide"
                :show-whitespace="showWhitespace"
            />
        </section>
    </div>
</template>

<style scoped>
.diff-workbench {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 10px;
}

.diff-workbench__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.diff-workbench__tabs {
    display: inline-flex;
    max-width: 100%;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
}

.diff-workbench__tab {
    height: 30px;
    border: 0;
    border-right: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    padding: 0 12px;
    white-space: nowrap;
}

.diff-workbench__tab:last-child {
    border-right: 0;
}

.diff-workbench__tab.is-active {
    background: var(--accent-bg);
    color: var(--accent-main);
}

.diff-workbench__body {
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--source-bg);
    padding: 8px;
}
</style>
