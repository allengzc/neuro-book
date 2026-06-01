<script setup lang="ts">
import type { DropdownItem } from "nbook/app/components/common/dropdown.types";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {AuthUserDto} from "nbook/shared/dto/auth.dto";

const props = defineProps<{
    rightPanelOpen: boolean;
    agentModeActive: boolean;
    novelTitle: string;
    novelItems: DropdownItem[];
    currentUser: AuthUserDto | null;
    workspaceMode?: "novel" | "user-assets";
}>();
const currentUser = toRef(props, "currentUser");
const isUserAssetsMode = computed(() => props.workspaceMode === "user-assets");

const emit = defineEmits<{
    (e: "toggle-layout-mode"): void;
    (e: "toggle-agent"): void;
    (e: "open-bookshelf"): void;
    (e: "open-plot-workbench"): void;
    (e: "open-user-assets"): void;
    (e: "open-profile-workbench"): void;
    (e: "switch-novel", value: string): void;
    (e: "open-admin"): void;
    (e: "logout"): void;
}>();

const userMenuItems = computed<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];
    if (currentUser.value?.role === "admin") {
        items.push({
            label: "进入后台",
            value: "admin",
            iconClass: "i-lucide-shield",
        });
    }
    items.push({
        label: "退出登录",
        value: "logout",
        iconClass: "i-lucide-log-out",
    });
    return items;
});

/**
 * 当前用户头像文字。
 */
const userInitial = computed(() => {
    const name = currentUser.value?.displayName || currentUser.value?.username || "U";
    return name.trim().slice(0, 1).toLocaleUpperCase();
});

/**
 * 处理用户菜单动作。
 */
const handleUserMenuSelect = (value: string): void => {
    if (value === "admin") {
        emit("open-admin");
        return;
    }
    if (value === "logout") {
        emit("logout");
    }
};
</script>

<template>
    <!-- 顶部导航栏 -->
    <header class="ide-panel flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 text-[var(--text-main)]">
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2.5 font-medium">
                <div class="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm">
                    <span class="i-lucide-feather h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                </div>
                <span class="text-[13px] font-bold tracking-[0.3em] uppercase">Neuro Book</span>
            </div>
            <div class="h-4 w-px bg-[var(--border-color)]"></div>
            <button
                class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-[0.16em] uppercase transition-colors"
                :class="agentModeActive ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                :title="agentModeActive ? '切换到 IDE 模式' : '切换到 Agent 模式'"
                @click="emit('toggle-layout-mode')"
            >
                <span :class="agentModeActive ? 'i-lucide-bot' : 'i-lucide-panels-top-left'" class="h-3.5 w-3.5"></span>
                <span>{{ agentModeActive ? 'Agent' : 'IDE' }}</span>
            </button>
            <div class="h-4 w-px bg-[var(--border-color)]"></div>
            <div v-if="!isUserAssetsMode" class="flex items-center gap-3 text-sm">
                <Dropdown :items="novelItems" menu-class="left-0 top-full mt-2 w-56" @select="(v) => emit('switch-novel', v)">
                    <button class="group flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]">
                        <span class="font-serif text-[13px] italic text-[var(--text-secondary)] group-hover:text-[var(--text-main)] transition-colors">{{ novelTitle || '未选择小说' }}</span>
                        <span class="i-lucide-chevron-down h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors"></span>
                    </button>
                </Dropdown>
            </div>
            <div v-else class="flex items-center gap-2 text-sm">
                <span class="font-serif text-[13px] italic text-[var(--text-secondary)]">用户资产</span>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] md:flex" title="书架管理" @click="emit('open-bookshelf')">
                <span class="i-lucide-library h-4 w-4"></span>
                <span>书架</span>
            </button>
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" title="剧本工作台" @click="emit('open-plot-workbench')">
                <span class="i-lucide-panels-top-left h-4 w-4 text-[var(--accent-text)]"></span>
                <span>剧本工作台</span>
            </button>
            <button v-if="!isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" title="用户资产" @click="emit('open-user-assets')">
                <span class="i-lucide-folder-cog h-4 w-4 text-[var(--accent-text)]"></span>
                <span>用户资产</span>
            </button>
            <button v-if="isUserAssetsMode" class="hidden items-center gap-2 rounded-full border border-transparent px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)] md:flex" title="TSX Profile 工作台" @click="emit('open-profile-workbench')">
                <span class="i-lucide-file-code-2 h-4 w-4 text-[var(--accent-text)]"></span>
                <span>Profile</span>
            </button>
            <button
                class="flex items-center gap-2 rounded-full border px-4 py-1.5 text-[12px] tracking-[0.2em] uppercase transition-colors"
                :class="[
                    rightPanelOpen ? 'border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-main)]' : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
                    agentModeActive ? 'cursor-not-allowed opacity-45' : '',
                ]"
                :title="agentModeActive ? 'Agent 模式中已在中间显示' : rightPanelOpen ? '关闭 Agent 面板' : '打开 Agent 面板'"
                :disabled="agentModeActive"
                @click="emit('toggle-agent')"
            >
                <span class="i-lucide-bot h-4 w-4"></span>
                <span>Agent</span>
            </button>

            <div class="mx-2 h-4 w-px bg-[var(--border-color)]"></div>

            <div class="w-8 shrink-0">
                <Dropdown :items="userMenuItems" menu-class="right-0 top-full mt-2 w-40" @select="handleUserMenuSelect">
                    <button class="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="账户菜单">
                        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[11px] font-semibold text-[var(--accent-text)]">{{ userInitial }}</span>
                    </button>
                </Dropdown>
            </div>
        </div>
    </header>
</template>
