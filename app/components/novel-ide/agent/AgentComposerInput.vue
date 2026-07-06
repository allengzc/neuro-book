<script setup lang="ts">
import ReferencePlainTextEditor from "nbook/app/components/common/form/ReferencePlainTextEditor.vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";

const props = withDefaults(defineProps<{
    modelValue: string;
    placeholder?: string;
    menuRefreshKey?: string | number;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    borderless?: boolean;
    expanded?: boolean;
    readonly?: boolean;
}>(), {
    placeholder: "",
    menuRefreshKey: "",
    onSkillTriggerStart: () => {},
    borderless: false,
    expanded: false,
    readonly: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "cycle-mode"): void;
}>();

const editorRef = ref<InstanceType<typeof ReferencePlainTextEditor> | null>(null);
const {t} = useI18n();
const editorMinHeight = computed(() => props.expanded ? 220 : 44);
const editorMaxHeight = computed(() => props.expanded ? 420 : 150);

/**
 * 聚焦编辑器。
 */
const focus = (): void => {
    editorRef.value?.focus();
};

/**
 * 插入普通文本。
 */
const insertText = (text: string): void => {
    editorRef.value?.insertText(text);
};

/**
 * 获取当前纯文本。
 */
const getText = (): string => editorRef.value?.getText() ?? props.modelValue;

defineExpose({
    focus,
    insertText,
    getText,
});
</script>

<template>
    <ReferencePlainTextEditor
        :key="props.placeholder"
        ref="editorRef"
        :model-value="props.modelValue"
        :placeholder="props.placeholder || t('agent.composer.messagePlaceholder')"
        :min-height="editorMinHeight"
        :max-height="editorMaxHeight"
        :submit-on-enter="!props.expanded"
        :enable-quick-triggers="true"
        :readonly="props.readonly"
        :match-popover-width="true"
        :menu-refresh-key="props.menuRefreshKey"
        :resolve-menu="props.resolveMenu"
        :on-skill-trigger-start="props.onSkillTriggerStart"
        :borderless="props.borderless"
        @update:model-value="emit('update:modelValue', $event)"
        @submit="emit('submit', $event)"
        @shift-tab="emit('cycle-mode')"
    />
</template>
