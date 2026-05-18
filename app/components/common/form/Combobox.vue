<script setup lang="ts">
import { ref, computed } from "vue";
import { onClickOutside } from "@vueuse/core";

import type { SelectOption } from "./FormSelect.vue";

const props = defineProps<{
    modelValue: string | null;
    options: (string | SelectOption)[];
    placeholder?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

onClickOutside(rootRef, () => {
    open.value = false;
});

const onFocus = () => {
    open.value = true;
};

const handleInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    emit("update:modelValue", val || null);
    open.value = true;
};

const selectOption = (opt: string | SelectOption) => {
    const val = typeof opt === 'string' ? opt : opt.value;
    emit("update:modelValue", val);
    open.value = false;
};

const normalizedOptions = computed(() => {
    return props.options.map(opt => {
        if (typeof opt === 'string') {
            return { value: opt, label: opt };
        }
        return opt;
    });
});

const filteredOptions = computed(() => {
    if (!props.modelValue) return normalizedOptions.value;
    const lower = props.modelValue.toLowerCase();
    // Allow matching on value or label
    return normalizedOptions.value.filter(o => 
        o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower)
    );
});

const displayValue = computed(() => {
    if (!props.modelValue) return '';
    const opt = normalizedOptions.value.find(o => o.value === props.modelValue);
    return opt ? opt.label : props.modelValue;
});
</script>

<template>
    <div ref="rootRef" class="relative">
        <div 
            class="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] transition-colors focus-within:!border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]/30 min-h-[28px] hover:border-[var(--border-color-hover)]"
        >
            <input 
                :value="displayValue" 
                @input="handleInput"
                @focus="onFocus"
                @click="onFocus"
                type="text"
                :placeholder="placeholder"
                class="w-full bg-transparent px-2 py-1 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] rounded-l-lg"
            >
            <button 
                type="button" 
                class="flex items-center justify-center p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] outline-none pr-1.5 shrink-0"
                @click.stop="open = !open"
            >
                <span class="i-lucide-chevron-down h-3.5 w-3.5 transition-transform duration-200" :class="open ? '-rotate-180' : ''"></span>
            </button>
        </div>

        <transition name="dropdown">
            <div 
                v-if="open && filteredOptions.length > 0" 
                class="absolute left-0 right-0 top-full mt-1 z-[60] p-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-xl max-h-48 overflow-y-auto custom-scrollbar"
            >
                <div 
                    v-for="opt in filteredOptions" 
                    :key="opt.value"
                    class="flex items-center gap-2 px-2.5 py-1.5 mb-1 last:mb-0 rounded-md text-[11px] cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                    :class="opt.value === modelValue ? 'text-[var(--text-main)] font-medium bg-[var(--bg-input)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'"
                    @click.stop="selectOption(opt)"
                >
                    <span class="truncate flex-1">{{ opt.label }}</span>
                    <span v-if="opt.value === modelValue" class="i-lucide-check h-3 w-3 text-[var(--accent-main)] shrink-0"></span>
                </div>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.dropdown-enter-from,
.dropdown-leave-to {
    opacity: 0;
    transform: translateY(-4px) scaleY(0.96);
}
</style>
