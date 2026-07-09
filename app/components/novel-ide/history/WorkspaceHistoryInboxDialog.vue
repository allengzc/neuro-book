<script setup lang="ts">
/**
 * Workspace 文件历史收件箱（Task 95 最小 UI）：
 * 左列待审查文件分组（归因/操作摘要），右侧 Monaco diff（基准 = 上次接受位点，按 hash 按需拉全文），
 * 每组提供「接受」与「还原」（还原走 danger 确认）。时间线 / 删除找回面板留给下一任务。
 */
import Dialog from "nbook/app/components/common/Dialog.vue";
import SharedDiffEditor from "nbook/app/components/common/diff/SharedDiffEditor.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {IdeTheme} from "nbook/app/utils/theme/theme-tokens";
import type {WorkspaceHistoryInboxDto, WorkspaceHistoryInboxGroupDto, WorkspaceHistorySnapshotDto} from "nbook/shared/dto/workspace-history.dto";

const props = defineProps<{
    modelValue: boolean;
    /** 当前 Project Path（workspace/<slug>）；为空（user-assets 模式）时不可用 */
    projectPath: string | null;
    theme?: IdeTheme;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const notification = useNotification();
const {confirm} = useDialog();
const {t} = useI18n();

const groups = ref<WorkspaceHistoryInboxGroupDto[]>([]);
const selectedPath = ref<string | null>(null);
const loading = ref(false);
/** 面板局部加载错误（可恢复，随刷新清除） */
const error = ref<string | null>(null);
const diffLoading = ref(false);
/** 选中组两侧全文；null = 未选中或快照不可用 */
const diffSides = ref<{original: string; modified: string} | null>(null);
const diffUnavailable = ref(false);
/** 正在执行 accept/revert 的组路径（行级操作锁） */
const busyPath = ref<string | null>(null);

const selectedGroup = computed(() => groups.value.find((group) => group.path === selectedPath.value) ?? null);

/** 拉收件箱分组列表并保持/重置选中项。 */
async function load(): Promise<void> {
    if (!props.projectPath) {
        groups.value = [];
        return;
    }
    loading.value = true;
    error.value = null;
    try {
        const dto = await $fetch<WorkspaceHistoryInboxDto>("/api/workspace-history/inbox", {query: {projectPath: props.projectPath}});
        groups.value = dto.groups;
        const keep = dto.groups.find((group) => group.path === selectedPath.value) ?? dto.groups[0] ?? null;
        await select(keep);
    } catch (cause) {
        groups.value = [];
        await select(null);
        error.value = resolveApiErrorMessage(cause, t("ide.historyInbox.loadFailed"));
    } finally {
        loading.value = false;
    }
}

/** 选中一组并按 hash 拉两侧全文。hash 为 null 的一侧 =「文件不存在」，按空文本 diff。 */
async function select(group: WorkspaceHistoryInboxGroupDto | null): Promise<void> {
    selectedPath.value = group?.path ?? null;
    diffSides.value = null;
    diffUnavailable.value = false;
    if (!group || !props.projectPath) {
        return;
    }
    diffLoading.value = true;
    try {
        const [original, modified] = await Promise.all([
            fetchSnapshotText(group.baseHash),
            fetchSnapshotText(group.endHash),
        ]);
        if (original === null || modified === null) {
            diffUnavailable.value = true;
            return;
        }
        diffSides.value = {original, modified};
    } catch (cause) {
        diffUnavailable.value = true;
        error.value = resolveApiErrorMessage(cause, t("ide.historyInbox.loadFailed"));
    } finally {
        diffLoading.value = false;
    }
}

/** 按内容 hash 取快照全文；hash null =「文件不存在」返回空文本；text null = body 不可用。 */
async function fetchSnapshotText(hash: string | null): Promise<string | null> {
    if (hash === null) {
        return "";
    }
    const dto = await $fetch<WorkspaceHistorySnapshotDto>("/api/workspace-history/snapshot", {query: {projectPath: props.projectPath, hash}});
    return dto.text;
}

/** 接受：把该文件的审查位点推进到最新（不改文件内容）。 */
async function acceptGroup(group: WorkspaceHistoryInboxGroupDto): Promise<void> {
    if (!props.projectPath || busyPath.value) {
        return;
    }
    busyPath.value = group.path;
    try {
        await $fetch("/api/workspace-history/accept", {method: "POST", body: {projectPath: props.projectPath, path: group.path}});
        notification.success(t("ide.historyInbox.acceptSuccess", {path: group.path}));
        await load();
    } catch (cause) {
        notification.error(resolveApiErrorMessage(cause, t("ide.historyInbox.actionFailed")));
    } finally {
        busyPath.value = null;
    }
}

/** 还原：把文件内容退回上次接受的基线（danger 确认；操作本身入账，可再次审查）。 */
async function revertGroup(group: WorkspaceHistoryInboxGroupDto): Promise<void> {
    if (!props.projectPath || busyPath.value) {
        return;
    }
    const confirmed = await confirm(t("ide.historyInbox.revertConfirm", {path: group.path}), t("ide.historyInbox.revert"));
    if (!confirmed) {
        return;
    }
    busyPath.value = group.path;
    try {
        await $fetch("/api/workspace-history/revert", {method: "POST", body: {projectPath: props.projectPath, path: group.path}});
        notification.success(t("ide.historyInbox.revertSuccess", {path: group.path}));
        await load();
    } catch (cause) {
        notification.error(resolveApiErrorMessage(cause, t("ide.historyInbox.actionFailed")));
    } finally {
        busyPath.value = null;
    }
}

/** 组内归因摘要，如「Agent #12、用户」。 */
function actorSummary(group: WorkspaceHistoryInboxGroupDto): string {
    const labels = new Set<string>();
    for (const entry of group.entries) {
        switch (entry.actorKind) {
            case "user":
                labels.add(t("ide.historyInbox.actorUser"));
                break;
            case "agent":
                labels.add(`Agent #${entry.actorDetail ?? "?"}`);
                break;
            case "system":
                labels.add(t("ide.historyInbox.actorSystem", {source: entry.actorDetail ?? ""}));
                break;
            case "external":
                labels.add(t("ide.historyInbox.actorExternal"));
                break;
        }
    }
    return [...labels].join("、");
}

watch(() => props.modelValue, (open) => {
    if (open) {
        void load();
    }
});
</script>

<template>
    <!-- 文件变更收件箱弹窗 -->
    <Dialog :model-value="props.modelValue" :title="t('ide.historyInbox.title')" size="xl" :show-footer="false" body-class="!p-0 !overflow-hidden" @update:model-value="emit('update:modelValue', $event)">
        <template #header-extra>
            <button type="button" class="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('ide.historyInbox.refresh')" @click="void load()">
                <span class="i-lucide-refresh-cw h-4 w-4"></span>
            </button>
        </template>

        <!-- 左列待审组列表 / 右侧 diff 预览 -->
        <div class="flex h-[70vh] min-h-0 flex-1">
            <aside class="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border-color)]">
                <p v-if="error" class="m-3 rounded border border-[var(--status-danger)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ error }}</p>
                <p v-else-if="loading && groups.length === 0" class="m-3 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.loading") }}</p>
                <p v-else-if="groups.length === 0" class="m-3 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.empty") }}</p>
                <button v-for="group in groups" :key="group.path" type="button" class="flex flex-col gap-1 border-b border-[var(--border-color)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]" :class="group.path === selectedPath ? 'bg-[var(--bg-hover)]' : ''" @click="void select(group)">
                    <span class="flex items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-main)]" :title="group.path">{{ group.path }}</span>
                        <span v-if="group.endHash === null" class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--status-danger)] border border-[var(--status-danger)]">{{ t("ide.historyInbox.deleted") }}</span>
                    </span>
                    <span class="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span class="text-[var(--status-info)]">{{ actorSummary(group) }}</span>
                        <span>{{ t("ide.historyInbox.entryCount", {count: group.entries.length}) }}</span>
                    </span>
                    <span class="flex items-center gap-2">
                        <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--status-success)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="busyPath !== null" @click.stop="void acceptGroup(group)">{{ t("ide.historyInbox.accept") }}</button>
                        <button type="button" class="rounded border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--status-danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="busyPath !== null" @click.stop="void revertGroup(group)">{{ t("ide.historyInbox.revert") }}</button>
                    </span>
                </button>
            </aside>
            <section class="flex min-w-0 flex-1 flex-col">
                <p v-if="!selectedGroup" class="m-4 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.noSelection") }}</p>
                <p v-else-if="diffLoading" class="m-4 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.loading") }}</p>
                <p v-else-if="diffUnavailable" class="m-4 text-sm text-[var(--text-muted)]">{{ t("ide.historyInbox.diffUnavailable") }}</p>
                <SharedDiffEditor v-else-if="diffSides" class="min-h-0 flex-1" :model-key="`history-inbox:${selectedGroup.path}`" :original-content="diffSides.original" :modified-content="diffSides.modified" :original-label="t('ide.historyInbox.baseLabel')" :modified-label="t('ide.historyInbox.currentLabel')" :theme="props.theme" />
            </section>
        </div>
    </Dialog>
</template>
