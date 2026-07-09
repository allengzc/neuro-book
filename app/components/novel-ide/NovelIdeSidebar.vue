<script setup lang="ts">
import type { NovelIdeTab } from "nbook/app/components/novel-ide/mock-data";

type SidebarItem = {
    value: NovelIdeTab | "sessions";
    label: string;
    iconClass: string;
    bottom?: boolean;
};

const props = defineProps<{
    activeTab: NovelIdeTab | "sessions" | null;
    agentMode?: boolean;
    userAssetsMode?: boolean;
}>();

const emit = defineEmits<{
    (e: "toggle-tab", value: NovelIdeTab | "sessions"): void;
    (e: "collapse"): void;
    (e: "open-settings"): void;
}>();

const items: SidebarItem[] = [
    { value: "files", label: "Files", iconClass: "i-lucide-files" },
    { value: "characters", label: "Characters", iconClass: "i-lucide-users-round" },
    { value: "plot", label: "Plot", iconClass: "i-lucide-git-branch" },
];
const sessionItems: SidebarItem[] = [
    { value: "sessions", label: "Sessions", iconClass: "i-lucide-messages-square" },
    { value: "plot", label: "Plot", iconClass: "i-lucide-git-branch" },
];
const visibleItems = computed(() => {
    if (props.agentMode) {
        return props.userAssetsMode ? sessionItems.filter((item) => item.value === "sessions") : sessionItems;
    }
    return props.userAssetsMode ? items.filter((item) => item.value === "files") : items;
});
</script>

<template>
    <!-- 左侧图标栏 -->
    <aside class="flex w-14 shrink-0 flex-col items-center border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] py-4">
        <template v-for="item in visibleItems" :key="item.value">
            <div v-if="item.bottom" class="mt-auto"></div>
            <button
                class="group mb-3 flex h-9 w-9 items-center justify-center rounded-full border transition-all"
                :class="props.activeTab === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                :title="item.label"
                @click="emit('toggle-tab', item.value)"
            >
                <span :class="item.iconClass" class="h-[18px] w-[18px]"></span>
            </button>
        </template>

        <div class="mt-auto"></div>
        <button
            class="group mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-[var(--text-muted)] transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            title="Settings"
            @click="emit('open-settings')"
        >
            <span class="i-lucide-settings h-[18px] w-[18px]"></span>
        </button>
    </aside>
</template>
