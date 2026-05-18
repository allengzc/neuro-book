<script setup lang="ts">
import { ref, computed } from "vue";
import { onClickOutside } from "@vueuse/core";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import RefTargetSelector from "./RefTargetSelector.vue";
import type { SelectOption } from "nbook/app/components/common/form/FormSelect.vue";
import type { WorkbenchManualRef } from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";
import { useFloatingPanelLayout } from "nbook/app/composables/useFloatingPanelLayout";

const props = defineProps<{
    refItem: WorkbenchManualRef;
    refRelationOptions: SelectOption[];
    refTargetOptions: SelectOption[];
    anchorElement: HTMLElement | null;
}>();

const emit = defineEmits<{
    (e: "update", patch: Partial<WorkbenchManualRef>): void;
    (e: "close"): void;
}>();

const panelRef = ref<HTMLDivElement | null>(null);

onClickOutside(panelRef, (e) => {
    if (props.anchorElement && props.anchorElement.contains(e.target as Node)) {
        return;
    }
    emit("close");
});

const { panelStyle, resolvedDirection } = useFloatingPanelLayout({
    open: computed(() => true),
    anchorRef: computed(() => props.anchorElement),
    panelRef,
    direction: ref("auto"),
    maxHeight: 400,
});
</script>

<template>
    <div
        ref="panelRef"
        class="absolute left-0 z-50 flex w-[280px] flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 shadow-2xl"
        :class="resolvedDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'"
        :style="panelStyle"
    >
        <div class="flex items-center justify-between">
            <div class="text-[12px] font-semibold text-[var(--text-main)]">编辑结构化引用</div>
            <button type="button" class="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('close')">
                <span class="i-lucide-x h-3 w-3"></span>
            </button>
        </div>
        
        <div class="space-y-1.5">
            <div class="text-[10px] font-medium text-[var(--text-muted)]">关联类型 (Relation)</div>
            <Combobox :model-value="props.refItem.relation || null" :options="props.refRelationOptions" placeholder="如 setup_for" @update:model-value="emit('update', {relation: $event ?? ''})" />
        </div>
        
        <div class="space-y-1.5">
            <div class="text-[10px] font-medium text-[var(--text-muted)]">目标节点 (Target)</div>
            <RefTargetSelector :model-value="props.refItem.target || null" :options="props.refTargetOptions" placeholder="选择引用的目标节点..." @update:model-value="emit('update', {target: $event ?? ''})" />
        </div>
        
        <div class="space-y-1.5">
            <div class="text-[10px] font-medium text-[var(--text-muted)]">备注 (Note)</div>
            <FormInput :model-value="props.refItem.note ?? ''" placeholder="添加补充说明 (可选)" @update:model-value="emit('update', {note: $event || null})" />
        </div>
    </div>
</template>
