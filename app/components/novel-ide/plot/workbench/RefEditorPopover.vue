<script setup lang="ts">
import { ref, computed, toRef } from "vue";
import { onClickOutside } from "@vueuse/core";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import type { SelectOption } from "nbook/app/components/common/form/FormSelect.vue";
import type { WorkbenchManualRef } from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";
import { useFloatingPanelLayout } from "nbook/app/composables/useFloatingPanelLayout";
import type { AgentTriggerMenuSection } from "nbook/app/components/novel-ide/agent/trigger-menu";

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
const searchQuery = ref("");

onClickOutside(panelRef, (e) => {
    if (props.anchorElement && props.anchorElement.contains(e.target as Node)) {
        return;
    }
    // Also ignore Combobox dropdown clicks
    if ((e.target as HTMLElement).closest('.n-combobox-dropdown')) {
        return;
    }
    emit("close");
});

const { panelStyle, resolvedDirection } = useFloatingPanelLayout({
    open: computed(() => true),
    anchorRef: computed(() => props.anchorElement),
    panelRef,
    direction: ref("auto"),
    maxHeight: 480, // Increased max height to accommodate list
    matchAnchorWidth: false, // We want it fixed width or dynamic width, not matching the anchor exactly
});

const targetSections = computed<AgentTriggerMenuSection[]>(() => {
    const threadItems = [];
    const sceneItems = [];
    const plotItems = [];
    const lorebookItems = [];
    
    const query = searchQuery.value.trim().toLowerCase();
    
    for (const opt of props.refTargetOptions) {
        const value = String(opt.value);
        const matchesQuery = !query || opt.label.toLowerCase().includes(query) || (opt.description && opt.description.toLowerCase().includes(query));
        
        if (!matchesQuery) continue;
        
        const item = {
            id: value,
            label: opt.label,
            description: String(opt.description || value),
            iconClass: opt.iconClass || "i-lucide-bookmark"
        };
        
        if (value.startsWith("thread://")) threadItems.push(item);
        else if (value.startsWith("scene://")) sceneItems.push(item);
        else if (value.startsWith("plot://")) plotItems.push(item);
        else if (value.startsWith("lorebook/")) lorebookItems.push(item);
        else lorebookItems.push(item);
    }
    
    return [
        { id: "thread", title: "Thread", items: threadItems },
        { id: "scene", title: "Scene", items: sceneItems },
        { id: "plot", title: "Plot", items: plotItems },
        { id: "lorebook", title: "Lorebook", items: lorebookItems }
    ].filter(s => s.items.length > 0);
});

// Since the popover combines target/relation/note, when clicking a target item we update immediately.
function updateTarget(targetId: string) {
    emit("update", { target: targetId });
}

</script>

<template>
    <div
        ref="panelRef"
        class="absolute left-0 z-50 flex w-[320px] flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-2xl"
        :class="resolvedDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'"
        :style="{ maxHeight: panelStyle.maxHeight }"
    >
        <!-- Editor Header (Relation & Note) -->
        <div class="flex flex-col gap-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2.5">
            <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold text-[var(--accent-text)]">REF</span>
                <span class="text-xs text-[var(--text-secondary)]">编辑引用</span>
            </div>
            
            <div class="flex flex-col gap-2 pt-1">
                <div class="flex items-center gap-2">
                    <span class="w-10 shrink-0 text-[11px] text-[var(--text-muted)]">关联</span>
                    <div class="flex-1">
                        <Combobox
                            :model-value="props.refItem.relation || null"
                            :options="props.refRelationOptions"
                            placeholder="选择关联..."
                            @update:model-value="emit('update', {relation: $event ?? ''})"
                        />
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="w-10 shrink-0 text-[11px] text-[var(--text-muted)]">备注</span>
                    <div class="flex-1">
                        <input
                            type="text"
                            class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-[12px] text-[var(--text-main)] outline-none transition-colors hover:border-[var(--border-color-hover)] focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/30"
                            :value="props.refItem.note || ''"
                            placeholder="添加备注 (可选)"
                            @change="emit('update', {note: ($event.target as HTMLInputElement).value || null})"
                        />
                    </div>
                </div>
            </div>
        </div>

        <!-- Target Search -->
        <div class="border-b border-[var(--border-color)] p-2">
            <div class="relative flex items-center">
                <span class="i-lucide-search absolute left-2 h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                <input
                    v-model="searchQuery"
                    type="text"
                    class="w-full rounded-md bg-[var(--bg-input)] py-1.5 pl-7 pr-2 text-[11px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--accent-main)]/30"
                    placeholder="搜索目标 (Thread/Scene/Plot/Lorebook)..."
                />
            </div>
        </div>

        <!-- Target List (ReferenceSelectorPopover Style) -->
        <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            <template v-for="section in targetSections" :key="section.id">
                <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {{ section.title }}
                </div>
                <button
                    v-for="item in section.items"
                    :key="item.id"
                    type="button"
                    class="mb-0.5 flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors last:mb-0"
                    :class="item.id === props.refItem.target ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    @mousedown.prevent="updateTarget(item.id)"
                >
                    <span class="mt-0.5 h-4 w-4 shrink-0" :class="item.id === props.refItem.target ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]'">
                        <span :class="item.iconClass" class="block h-full w-full"></span>
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium">{{ item.label }}</span>
                        </span>
                        <span class="mt-0.5 block text-[11px] leading-5 text-[var(--text-muted)]">
                            {{ item.description }}
                        </span>
                    </span>
                </button>
            </template>
            <div v-if="targetSections.length === 0" class="py-4 text-center text-[11px] text-[var(--text-muted)]">
                没有找到匹配的目标
            </div>
        </div>
    </div>
</template>
