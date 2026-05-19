<script setup lang="ts">
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
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
}>(), {
    placeholder: "输入消息... (输入 @ 引用, $ 技能, / 命令)",
    menuRefreshKey: "",
    onSkillTriggerStart: () => {},
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "submit"): void;
    (e: "toggle-plan-mode"): void;
}>();

const editorRef = ref<InstanceType<typeof StructuredTextEditor> | null>(null);

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
 * 获取当前 markdown。
 */
const getMarkdown = (): string => editorRef.value?.getMarkdown() ?? props.modelValue;

defineExpose({
    focus,
    insertText,
    getMarkdown,
});
</script>

<template>
    <StructuredTextEditor
        ref="editorRef"
        :model-value="props.modelValue"
        :placeholder="props.placeholder"
        :min-height="44"
        :max-height="150"
        mode="rich"
        :show-toolbar="false"
        popover-direction="auto"
        :submit-on-enter="true"
        :enable-quick-triggers="true"
        :match-popover-width="true"
        :menu-refresh-key="props.menuRefreshKey"
        :resolve-menu="props.resolveMenu"
        :on-skill-trigger-start="props.onSkillTriggerStart"
        @update:model-value="emit('update:modelValue', $event)"
        @submit="emit('submit')"
        @shift-tab="emit('toggle-plan-mode')"
    />
</template>
