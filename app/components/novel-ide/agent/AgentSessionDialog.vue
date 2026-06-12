<script setup lang="ts">
import {computed, ref} from "vue";
import {onClickOutside} from "@vueuse/core";
import Dialog from "nbook/app/components/common/Dialog.vue";
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import type {AgentSessionListQueryDto, AgentSessionRelationFilter, AgentSessionStatusFilter, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";

type SessionProfileFilter = "leader" | "all";
type CreateProfileOption = {
    profileKey: string;
    label: string;
    iconClass: string;
};

const props = defineProps<{
    modelValue: boolean;
    sessions: AgentSessionSummaryDto[];
    activeSessionId: number | null;
    loading: boolean;
    running: boolean;
    actionId: number | null;
    createProfileOptions: CreateProfileOption[];
    canChooseCreateProfile: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", sessionId: number): void;
    (e: "create", profileKey?: string): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "refresh", query: AgentSessionListQueryDto): void;
}>();

const sessionSearch = ref("");
const profileFilter = ref<SessionProfileFilter>("leader");
const statusFilter = ref<AgentSessionStatusFilter>("active");
const relationFilter = ref<AgentSessionRelationFilter>("all");
const filterPanelOpen = ref(false);
const filterPanelRef = ref<HTMLElement | null>(null);
const filterButtonRef = ref<HTMLButtonElement | null>(null);

const profileItems: Array<{value: SessionProfileFilter; label: string}> = [
    {value: "leader", label: "Leader"},
    {value: "all", label: "全部"},
];
const statusItems: Array<{value: AgentSessionStatusFilter; label: string}> = [
    {value: "active", label: "未归档"},
    {value: "all", label: "全部"},
    {value: "running", label: "运行中"},
    {value: "waiting", label: "等待输入"},
    {value: "idle", label: "闲置"},
    {value: "interrupted", label: "中断"},
    {value: "archived", label: "归档"},
];
const relationItems: Array<{value: AgentSessionRelationFilter; label: string}> = [
    {value: "all", label: "全部"},
    {value: "top", label: "顶层"},
    {value: "child", label: "子 Agent"},
];
const createDropdownItems = computed<DropdownItem[]>(() => props.createProfileOptions.map((option) => ({
    label: option.label,
    value: option.profileKey,
    iconClass: option.iconClass,
})));

const query = computed<AgentSessionListQueryDto>(() => ({
    profileGroup: profileFilter.value,
    status: statusFilter.value,
    relation: relationFilter.value,
    includeArchived: statusFilter.value === "archived",
    limit: 50,
}));
const filteredSessions = computed(() => {
    const keyword = sessionSearch.value.trim().toLowerCase();
    if (!keyword) return props.sessions;
    return props.sessions.filter((session) => {
        return (session.title?.toLowerCase().includes(keyword)
            || session.summary?.toLowerCase().includes(keyword)
            || session.lastMessagePreview?.toLowerCase().includes(keyword)
            || session.profileKey.toLowerCase().includes(keyword)
            || String(session.sessionId).includes(keyword));
    });
});
const sessionTitle = (session: AgentSessionSummaryDto) => session.title || `Session #${String(session.sessionId)}`;
const sessionPreview = (session: AgentSessionSummaryDto) => session.summary || session.lastMessagePreview || "No recent messages";
const canArchiveSession = (session: AgentSessionSummaryDto): boolean => session.status !== "running" && session.status !== "waiting";

/**
 * 关闭弹窗。
 */
function close(): void {
    emit("update:modelValue", false);
}

/**
 * 通知父组件用当前筛选条件刷新 session 列表。
 */
function refresh(): void {
    emit("refresh", query.value);
}

/**
 * 重置筛选条件到默认 leader 近期会话。
 */
function resetFilters(): void {
    profileFilter.value = "leader";
    statusFilter.value = "active";
    relationFilter.value = "all";
    refresh();
}

/**
 * 返回 session 状态的中文标签。
 */
function statusLabel(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return "运行中";
        case "waiting": return "等待";
        case "interrupted": return "中断";
        case "archived": return "归档";
        default: return "闲置";
    }
}

/**
 * 返回 session 状态色块样式。
 */
function statusClass(status: AgentSessionSummaryDto["status"]): string {
    switch (status) {
        case "running": return "bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400";
        case "waiting": return "bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400";
        case "interrupted": return "bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-500/20 dark:text-red-400";
        case "archived": return "bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-color)]";
        default: return "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400";
    }
}

/**
 * 返回 profile 的中文名。
 */
function profileDisplayName(profileKey: string): string {
    switch (profileKey) {
        case "leader.assets": return "用户资产助手";
        case "rp.leader": return "跑团主持";
        case "simulator.leader": return "世界模拟";
        case "leader.default": return "主创";
        case "writer": return "正文写作";
        case "rp.writer": return "跑团写作";
        case "director": return "剧情导演";
        case "summarizer": return "会话摘要";
        case "memory.curator": return "记忆整理";
        case "researcher": return "联网研究";
        case "retrieval": return "内容检索";
        case "simulator.actor": return "角色模拟";
        default: return profileKey;
    }
}

watch(query, refresh, {deep: true});
watch(() => props.modelValue, (open) => {
    if (open) {
        refresh();
    }
});
onClickOutside(filterPanelRef, () => {
    filterPanelOpen.value = false;
}, {ignore: [filterButtonRef]});
</script>

<template>
    <Dialog :model-value="props.modelValue" title="会话列表" width="min(1040px, calc(100vw - 32px))" height="min(760px, calc(100vh - 32px))" max-height="calc(100vh - 32px)" body-class="overflow-visible" :show-cancel="false" @confirm="emit('create')" @update:model-value="emit('update:modelValue', $event)">
        <template #header>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-base font-semibold leading-snug tracking-wide text-[var(--text-main)]">会话列表</div>
                </div>
                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="close">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <div class="flex min-h-0 flex-1 flex-col space-y-4 pt-4">
            <!-- Session 搜索和操作 -->
            <div class="relative flex items-center gap-2">
                <div class="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3">
                    <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                    <input v-model="sessionSearch" type="text" placeholder="搜索标题、摘要、Profile 或 ID..." class="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]">
                    <button ref="filterButtonRef" type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="筛选" @click="filterPanelOpen = !filterPanelOpen">
                        <span class="i-lucide-list-filter h-4 w-4"></span>
                    </button>
                </div>
                <Dropdown v-if="props.canChooseCreateProfile" :items="createDropdownItems" root-class="relative inline-block" menu-class="right-0 top-full mt-1.5 w-44" @select="emit('create', $event)">
                    <button class="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-bg)] px-4 text-sm text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:opacity-40" :disabled="loading || !!actionId">
                        <span class="i-lucide-plus h-4 w-4"></span>
                        新建
                    </button>
                </Dropdown>
                <button v-else class="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-bg)] px-4 text-sm text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:opacity-40" :disabled="loading || !!actionId" @click="emit('create')">
                    <span class="i-lucide-plus h-4 w-4"></span>
                    新建
                </button>

                <transition name="fade">
                    <div v-if="filterPanelOpen" ref="filterPanelRef" class="absolute left-0 top-[calc(100%+8px)] z-40 w-[240px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 shadow-2xl">
                        <div class="flex items-center justify-between">
                            <div class="text-[12px] font-semibold text-[var(--text-main)]">筛选</div>
                            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" @click="filterPanelOpen = false">
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                            </button>
                        </div>

                        <div class="mt-2.5 space-y-2.5">
                            <section>
                                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Profile</div>
                                <div class="grid grid-cols-2 gap-1.5">
                                    <button v-for="item in profileItems" :key="item.value" type="button" class="rounded-md border px-2 py-1.5 text-[11px] transition-colors" :class="profileFilter === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="profileFilter = item.value">{{ item.label }}</button>
                                </div>
                            </section>

                            <section>
                                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">状态</div>
                                <div class="grid grid-cols-2 gap-1.5">
                                    <button v-for="item in statusItems" :key="item.value" type="button" class="rounded-md border px-2 py-1.5 text-[11px] transition-colors" :class="statusFilter === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="statusFilter = item.value">{{ item.label }}</button>
                                </div>
                            </section>

                            <section>
                                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">关系</div>
                                <div class="grid grid-cols-3 gap-1.5">
                                    <button v-for="item in relationItems" :key="item.value" type="button" class="rounded-md border px-2 py-1.5 text-[11px] transition-colors" :class="relationFilter === item.value ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="relationFilter = item.value">{{ item.label }}</button>
                                </div>
                            </section>

                            <div class="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                                <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 hover:bg-[var(--bg-hover)]" @click="resetFilters">重置筛选</button>
                                <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 hover:bg-[var(--bg-hover)]" @click="sessionSearch = ''">清空搜索</button>
                            </div>
                        </div>
                    </div>
                </transition>
            </div>

            <!-- 近期 Session 列表 -->
            <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-1.5 py-1 custom-scrollbar">
                <div
                    v-for="session in filteredSessions"
                    :key="session.sessionId"
                    class="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-all duration-200"
                    :class="session.sessionId === activeSessionId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] shadow-sm' : 'border-[var(--border-color)] bg-transparent hover:bg-[var(--bg-hover)]'"
                    @click="emit('select', session.sessionId)"
                >
                    <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-3">
                            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-200" :class="session.parentSessionId ? 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400' : 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:border-orange-500/30 dark:bg-orange-500/20 dark:text-orange-400'">
                                <span :class="session.parentSessionId ? 'i-lucide-bot' : 'i-lucide-crown'" class="h-4.5 w-4.5"></span>
                            </div>
                            <span class="truncate text-sm font-semibold text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-main)]">{{ sessionTitle(session) }}</span>
                            <span v-if="session.sessionId === activeSessionId" class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white bg-[var(--accent-main)] shadow-sm">Active</span>
                            <span class="rounded px-1.5 py-0.5 text-[10px] font-medium" :class="statusClass(session.status)">{{ statusLabel(session.status) }}</span>
                        </div>
                        <div class="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{{ sessionPreview(session) }}</div>
                        <div class="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                            <span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5 font-mono font-bold text-[var(--text-secondary)]">#{{ session.sessionId }}</span>
                            <span>{{ formatTimestamp(session.updatedAt) }}</span>
                            <span class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-[var(--text-secondary)]">{{ profileDisplayName(session.profileKey) }}</span>
                            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">{{ session.profileKey }}</span>
                            <span v-if="session.parentSessionId" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-[var(--text-secondary)]">协作父会话 #{{ session.parentSessionId }}</span>
                        </div>
                    </div>
                    <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-50 transition-all hover:bg-red-500/10 hover:text-red-500 hover:opacity-100 group-hover:opacity-100 disabled:opacity-40" :disabled="actionId === session.sessionId || loading || !canArchiveSession(session)" title="Archive" @click.stop="emit('archive', session)">
                        <span v-if="actionId === session.sessionId" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        <span v-else class="i-lucide-archive h-4 w-4"></span>
                    </button>
                </div>

                <div v-if="filteredSessions.length === 0" class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    没有匹配的会话
                    <div class="mt-3 flex justify-center gap-2">
                        <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="resetFilters">重置筛选</button>
                        <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="sessionSearch = ''">清空搜索</button>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex w-full items-center justify-between">
                <div class="text-[11px] text-[var(--text-muted)]">近期 {{ filteredSessions.length }} / 已加载 {{ props.sessions.length }}</div>
                <button class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-[13px] font-medium text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="close">关闭</button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
}
</style>
