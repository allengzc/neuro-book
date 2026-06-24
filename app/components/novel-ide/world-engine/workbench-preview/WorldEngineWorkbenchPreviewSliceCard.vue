<script setup lang="ts">
import {computed} from "vue";
import {
    buildWorldWorkbenchSubjectFileProposals,
    worldWorkbenchIssueLevel,
    worldWorkbenchIssueStatusLabel,
} from "nbook/app/utils/world-engine-workbench-real";
import type {
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectGroup,
    WorldWorkbenchPreviewSubjectSystemSummary,
    WorldWorkbenchPreviewJsonValue,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const props = defineProps<{
    slice: WorldWorkbenchPreviewSlice;
    subjects: WorldWorkbenchPreviewSubject[];
    focusedSubjectId: string;
    selected: boolean;
    selectedSubjectIds: string[];
    sliceReviewSummary?: WorldWorkbenchPreviewSliceReviewSummary;
    reviewItems: WorldWorkbenchPreviewReviewQueueItem[];
    subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[];
    metadataDraftCount: number;
    metadataDraftSummary?: WorldWorkbenchPreviewMetadataDraftSummary;
    valueDraftCount: number;
}>();

const emit = defineEmits<{
    (e: "select", sliceId: string): void;
    (e: "focusSubject", subjectId: string): void;
    (e: "focusReviewIssue", item: WorldWorkbenchPreviewReviewQueueItem): void;
    (e: "filterSubject", subjectId: string): void;
    (e: "openSubjectFileProposals", sliceId: string, subjectId: string): void;
}>();

const maxVisibleMutationsPerSubject = 6;
const subjectMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject])));
const subjectNameMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject.name || subject.id])));
const subjectFileProposals = computed(() => buildWorldWorkbenchSubjectFileProposals({
    contextSubjectId: props.focusedSubjectId,
    slice: props.slice,
    subjectNames: subjectNameMap.value,
    subjectSystemSummaries: props.subjectSystemSummaries ?? [],
}));
const subjectFileProposalCount = computed(() => subjectFileProposals.value.length);
const reviewSummary = computed(() => props.sliceReviewSummary ?? {
    confirmed: 0,
    done: 0,
    ignored: 0,
    open: props.slice.issues?.length ?? 0,
    sliceId: props.slice.id,
    total: props.slice.issues?.length ?? 0,
});
const hasIssues = computed(() => reviewSummary.value.total > 0);
const hasOpenIssues = computed(() => reviewSummary.value.open > 0);
const hasMetadataDraft = computed(() => props.metadataDraftCount > 0);
const hasValueDraft = computed(() => props.valueDraftCount > 0);
const displayTime = computed(() => props.metadataDraftSummary?.draftTime || props.slice.time);
const displayKind = computed(() => props.metadataDraftSummary?.draftKind || props.slice.kind);
const displayTitle = computed(() => props.metadataDraftSummary?.draftTitle || props.slice.title || props.slice.id);
const displaySummary = computed(() => props.metadataDraftSummary?.draftSummary ?? props.slice.summary);
const visibleReviewItems = computed(() => props.reviewItems.slice(0, 3));
const hiddenReviewItemCount = computed(() => Math.max(0, props.reviewItems.length - visibleReviewItems.value.length));
const metadataDraftDiffLabel = computed(() => {
    const summary = props.metadataDraftSummary;
    if (!summary) {
        return "";
    }
    const changedFields: string[] = [];
    if (summary.draftTime !== props.slice.time) {
        changedFields.push("time");
    }
    if (summary.draftKind !== props.slice.kind) {
        changedFields.push("kind");
    }
    if (summary.draftTitle !== (props.slice.title || props.slice.id)) {
        changedFields.push("title");
    }
    if (summary.draftSummary !== props.slice.summary) {
        changedFields.push("summary");
    }
    return changedFields.length ? changedFields.join(" / ") : "metadata";
});
const reviewBadgeLabel = computed(() => {
    if (!hasIssues.value) {
        return "clean";
    }
    if (hasOpenIssues.value) {
        return `open ${reviewSummary.value.open}/${reviewSummary.value.total}`;
    }
    return `done ${reviewSummary.value.done}/${reviewSummary.value.total}`;
});
const mutationGroups = computed<WorldWorkbenchPreviewSubjectGroup[]>(() => {
    const groups = new Map<string, WorldWorkbenchPreviewSubjectGroup>();
    for (const mutation of props.slice.mutations) {
        const group = groups.get(mutation.subjectId) ?? {
            subjectId: mutation.subjectId,
            subject: subjectMap.value.get(mutation.subjectId) ?? null,
            mutations: [],
        };
        group.mutations.push(mutation);
        groups.set(mutation.subjectId, group);
    }
    return [...groups.values()];
});

/** 把 mutation value 压成短文本，保留足够上下文给卡片扫读。 */
function formatValue(value: WorldWorkbenchPreviewJsonValue | undefined): string {
    if (value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return formatStringValue(value);
    }
    if (Array.isArray(value)) {
        return value.length ? `list · ${value.length} items · ${formatValue(value[0])}` : "list · 0 items";
    }
    if (value && typeof value === "object") {
        const keys = Object.keys(value);
        return keys.length ? `object · ${keys.length} keys · ${keys.slice(0, 3).join(", ")}` : "object · 0 keys";
    }
    return JSON.stringify(value);
}

/** 长文本在主画布只显示可扫读摘要，完整内容留给 Inspector / Review Panel。 */
function formatStringValue(value: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "\"\"";
    }
    const prefix = normalized.slice(0, 96);
    return normalized.length > 96 ? `${prefix}... · ${normalized.length} chars` : normalized;
}

/** 主画布每个 subject 只展示前几条 mutation，完整编辑留给底部审查工作台。 */
function visibleMutations(group: WorldWorkbenchPreviewSubjectGroup): WorldWorkbenchPreviewSubjectGroup["mutations"] {
    return group.mutations.slice(0, maxVisibleMutationsPerSubject);
}

/** 当前 subject group 被折叠的 mutation 数。 */
function hiddenMutationCount(group: WorldWorkbenchPreviewSubjectGroup): number {
    return Math.max(0, group.mutations.length - maxVisibleMutationsPerSubject);
}

/** 选中当前切片。 */
function selectSlice(): void {
    emit("select", props.slice.id);
}

/** 从切片卡片直接进入某个 subject 的检查视角。 */
function focusSubject(subjectId: string): void {
    emit("select", props.slice.id);
    emit("focusSubject", subjectId);
}

/** 从主画布 issue 行定位到底部 Review Focus。 */
function focusReviewIssue(item: WorldWorkbenchPreviewReviewQueueItem): void {
    emit("select", props.slice.id);
    emit("focusReviewIssue", item);
}

/** 从主画布直接切到某个 subject 的 timeline 视角。 */
function filterSubject(subjectId: string): void {
    emit("select", props.slice.id);
    emit("filterSubject", subjectId);
}

/** 从 proposal 徽标直接进入右侧 Inspector 的主体文件建议区域。 */
function openSubjectFileProposals(): void {
    emit("openSubjectFileProposals", props.slice.id, subjectFileProposals.value[0]?.subjectId ?? "");
}

/** 将 World Engine issue code 映射成 A/E，便于主画布快速扫读。 */
function issueLevel(code: WorldWorkbenchPreviewReviewQueueItem["code"]): "A" | "E" {
    return worldWorkbenchIssueLevel(code);
}

/** issue 级别的紧凑视觉样式。 */
function issueLevelClass(code: WorldWorkbenchPreviewReviewQueueItem["code"]): string {
    return issueLevel(code) === "E" ? "border-[var(--we-danger)] bg-[var(--we-danger-soft)] text-[var(--we-danger)]" : "border-amber-300 bg-[var(--we-warning-soft)] text-[var(--we-warning)]";
}

/** issue triage 状态短文案。 */
function issueStatusLabel(status: WorldWorkbenchPreviewReviewQueueItem["status"]): string {
    return worldWorkbenchIssueStatusLabel(status);
}

/** issue triage 状态视觉样式。 */
function issueStatusClass(status: WorldWorkbenchPreviewReviewQueueItem["status"]): string {
    if (status === "confirmed") {
        return "border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]";
    }
    if (status === "ignored") {
        return "border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]";
    }
    return "border-amber-300 bg-[var(--we-warning-soft)] text-[var(--we-warning)]";
}
</script>

<template>
    <!-- World Engine 切片卡片：元信息 + 按 subject 分组的 mutations -->
    <article
        data-testid="world-slice-card"
        class="w-full cursor-pointer rounded-md border bg-[var(--we-bg-panel)] text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
        :class="props.selected ? 'border-[var(--we-accent)] bg-[var(--we-bg-active)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--we-accent)_18%,transparent)]' : 'border-[var(--we-border)] hover:border-[var(--we-border-strong)] hover:bg-[var(--we-bg-hover)]'"
        @click="selectSlice"
    >
        <div class="grid gap-3 p-3 xl:grid-cols-[154px_minmax(0,1fr)]">
            <div class="border-b border-[var(--we-border)] pb-3 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-3">
                <div class="font-mono text-[12px] font-semibold leading-5 text-[var(--we-text-main)]">{{ displayTime }}</div>
                <div class="mt-2 inline-flex max-w-full rounded-md border border-[var(--we-border)] bg-[var(--we-code-bg)] px-2 py-1 font-mono text-[11px] text-[var(--we-code-text)]">
                    <span class="truncate">{{ displayKind }}</span>
                </div>
                <div class="mt-2 truncate font-mono text-[10px] text-[var(--we-text-muted)]">{{ props.slice.id }}</div>
                <div v-if="hasMetadataDraft" class="mt-2 rounded-md border border-amber-300 bg-[var(--we-warning-soft)] px-2 py-1 text-[10px] leading-4 text-[var(--we-warning)]" :title="`已应用：${props.slice.time} · ${props.slice.kind} · ${props.slice.title || props.slice.id}`">
                    draft preview
                    <span v-if="metadataDraftDiffLabel" class="font-mono">· {{ metadataDraftDiffLabel }}</span>
                </div>
            </div>

            <div class="min-w-0">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1 text-[11px] text-[var(--we-text-secondary)]">{{ props.slice.mutations.length }} mutations</span>
                            <span class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1 text-[11px] text-[var(--we-text-secondary)]">{{ mutationGroups.length }} subjects</span>
                            <span v-if="hasMetadataDraft" class="rounded-md border border-amber-300 bg-[var(--we-warning-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--we-warning)]" :title="`未应用 metadata 草稿：${metadataDraftDiffLabel}`">meta draft</span>
                            <span v-if="hasValueDraft" class="rounded-md border border-amber-300 bg-[var(--we-warning-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--we-warning)]" :title="`${props.valueDraftCount} 个未应用 value 草稿`">value draft {{ props.valueDraftCount }}</span>
                            <button v-if="subjectFileProposalCount" data-testid="slice-card-subject-file-proposal-count" type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]" title="按当前主体语境，当前切片有主体文件建议；打开右侧 Inspector 查看" @click.stop="openSubjectFileProposals">
                                <span class="i-lucide-files h-3 w-3"></span>
                                files {{ subjectFileProposalCount }}
                            </button>
                            <span v-if="hasIssues" class="rounded-md border px-2 py-1 text-[11px] font-semibold" :class="hasOpenIssues ? 'border-amber-300 bg-[var(--we-warning-soft)] text-[var(--we-warning)]' : 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]'">{{ reviewBadgeLabel }}</span>
                        </div>
                        <div class="mt-2 truncate text-[14px] font-semibold text-[var(--we-text-main)]" :title="hasMetadataDraft ? `草稿：${displayTitle}；已应用：${props.slice.title || props.slice.id}` : displayTitle">{{ displayTitle }}</div>
                        <div v-if="hasMetadataDraft" class="mt-1 truncate text-[10px] text-[var(--we-text-muted)]">已应用：{{ props.slice.title || props.slice.id }}</div>
                        <div class="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--we-text-secondary)]">{{ displaySummary }}</div>
                        <div v-if="props.reviewItems.length" class="mt-3 space-y-1.5">
                            <button
                                v-for="item in visibleReviewItems"
                                :key="`slice-card-issue:${item.key}`"
                                type="button"
                                data-testid="slice-card-issue-row"
                                class="grid w-full grid-cols-[28px_minmax(76px,0.7fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5 text-left text-[11px] transition-colors hover:border-amber-300 hover:bg-[var(--we-warning-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
                                :title="item.message"
                                @click.stop="focusReviewIssue(item)"
                            >
                                <span class="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold" :class="issueLevelClass(item.code)">{{ issueLevel(item.code) }}</span>
                                <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ item.code }}</span>
                                <span class="min-w-0 truncate text-[var(--we-text-secondary)]">
                                    {{ subjectMap.get(item.subjectId)?.name ?? item.subjectId }}
                                    <span class="font-mono text-[var(--we-text-muted)]">· {{ item.attr }}</span>
                                </span>
                                <span class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold" :class="issueStatusClass(item.status)">{{ issueStatusLabel(item.status) }}</span>
                            </button>
                            <div v-if="hiddenReviewItemCount" class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1 text-[11px] text-[var(--we-text-muted)]">
                                +{{ hiddenReviewItemCount }} issues
                            </div>
                        </div>
                    </div>
                    <div class="hidden shrink-0 items-center gap-1.5 md:flex">
                        <span class="rounded-md border px-2 py-1 text-[11px]" :class="hasOpenIssues ? 'border-amber-300 bg-[var(--we-warning-soft)] text-[var(--we-warning)]' : hasIssues ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-subtle)] text-[var(--we-text-muted)]'">{{ reviewBadgeLabel }}</span>
                        <button
                            data-testid="world-slice-select-button"
                            type="button"
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md border text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-accent-strong)]"
                            :class="props.selected ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-panel)]'"
                            :title="`选择切片 ${props.slice.title || props.slice.id}`"
                            :aria-label="`选择切片 ${props.slice.title || props.slice.id}`"
                            @click.stop="selectSlice"
                        >
                            <span :class="props.selected ? 'i-lucide-check' : 'i-lucide-mouse-pointer-click'" class="h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>

                <div class="mt-3 grid gap-2 2xl:grid-cols-2">
                    <div
                        v-for="group in mutationGroups"
                        :key="`${props.slice.id}:${group.subjectId}`"
                        role="button"
                        tabindex="0"
                        class="cursor-pointer overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
                        :class="props.focusedSubjectId === group.subjectId ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] shadow-[inset_3px_0_0_var(--we-accent)]' : 'border-[var(--we-border)] bg-[var(--we-bg-data)]'"
                        :aria-label="`聚焦 ${group.subject?.name || group.subjectId}`"
                        @click.stop="focusSubject(group.subjectId)"
                        @keydown.enter.stop.prevent="focusSubject(group.subjectId)"
                        @keydown.space.stop.prevent="focusSubject(group.subjectId)"
                    >
                        <div class="flex items-center justify-between gap-2 border-b border-[var(--we-border)] px-2.5 py-1.5">
                            <div class="min-w-0">
                                <span class="text-[12px] font-semibold text-[var(--we-text-main)]">{{ group.subject?.name || group.subjectId }}</span>
                                <span class="ml-2 font-mono text-[10px] text-[var(--we-text-muted)]">{{ group.subjectId }} · {{ group.subject?.type ?? "unknown" }}</span>
                            </div>
                            <div class="flex shrink-0 items-center gap-1">
                                <span class="rounded-full bg-[var(--we-bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-muted)]">{{ group.mutations.length }}</span>
                                <button
                                    type="button"
                                    class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-[var(--we-text-muted)] transition-colors hover:border-[var(--we-accent-border)] hover:bg-[var(--we-bg-panel)] hover:text-[var(--we-accent-strong)]"
                                    :class="props.focusedSubjectId === group.subjectId ? 'border-[var(--we-accent-border)] bg-[var(--we-bg-panel)] text-[var(--we-accent-strong)]' : ''"
                                    :title="`聚焦 ${group.subject?.name || group.subjectId}`"
                                    :aria-label="`聚焦 ${group.subject?.name || group.subjectId}`"
                                    @click.stop="focusSubject(group.subjectId)"
                                >
                                    <span class="i-lucide-crosshair h-3.5 w-3.5"></span>
                                </button>
                                <button
                                    type="button"
                                    class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-[var(--we-text-muted)] transition-colors hover:border-[var(--we-accent-border)] hover:bg-[var(--we-bg-panel)] hover:text-[var(--we-accent-strong)]"
                                    :class="props.selectedSubjectIds.includes(group.subjectId) ? 'border-[var(--we-accent-border)] bg-[var(--we-bg-panel)] text-[var(--we-accent-strong)]' : ''"
                                    :title="`只看 ${group.subject?.name || group.subjectId}`"
                                    :aria-label="`只看 ${group.subject?.name || group.subjectId}`"
                                    @click.stop="filterSubject(group.subjectId)"
                                >
                                    <span class="i-lucide-filter h-3.5 w-3.5"></span>
                                </button>
                            </div>
                        </div>
                        <div class="divide-y divide-[var(--we-border)]">
                            <div
                                v-for="mutation in visibleMutations(group)"
                                :key="`${mutation.subjectId}:${mutation.attr}:${mutation.op}:${formatValue(mutation.value)}`"
                                class="grid grid-cols-[minmax(90px,0.7fr)_112px_minmax(0,1.3fr)] gap-2 px-2.5 py-1.5 text-[11px]"
                            >
                                <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ mutation.attr }}</span>
                                <span class="min-w-0 truncate font-mono text-[var(--we-accent-strong)]">{{ mutation.op }}</span>
                                <span class="min-w-0 truncate font-mono text-[var(--we-text-secondary)]" :title="formatValue(mutation.value)">{{ formatValue(mutation.value) }}</span>
                            </div>
                            <div v-if="hiddenMutationCount(group)" class="px-2.5 py-1.5 text-[11px] font-medium text-[var(--we-text-muted)]">
                                +{{ hiddenMutationCount(group) }} mutations
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </article>
</template>
