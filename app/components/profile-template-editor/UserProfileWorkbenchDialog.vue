<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import ProfileTemplateVisualEditor from "nbook/app/components/profile-template-editor/ProfileTemplateVisualEditor.vue";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="workbench"
        overlay-type="blur"
        :show-footer="false"
        :close-on-overlay="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <!-- 用户资产 Profile 工作台标题栏 -->
            <div class="flex min-w-0 flex-1 items-center gap-3">
                <span class="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--accent-main)] text-xs font-semibold text-white">TS</span>
                <span class="text-[16px] font-semibold text-[var(--text-main)]">TSX Profile 工作台</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] md:inline">用户资产</span>
                <span class="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                    可视化编辑
                </span>
                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:modelValue', false)">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <ProfileTemplateVisualEditor
            mode="user-profile"
            preferred-template="builtin/leader-default.profile.tsx"
            thread-profile-key="leader.default"
            class="h-full"
        />
    </Dialog>
</template>
