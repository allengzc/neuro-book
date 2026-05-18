<script setup lang="ts">
import {computed} from "vue";
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";
import type { AgentTriggerMenuSection } from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkbenchManualRef} from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";
import {
    PLOT_KIND_LABELS,
    PLOT_SCENE_STATUS_LABELS,
    PLOT_THREAD_STATUS_LABELS,
    type PlotThreadPanelChapter,
    type PlotThreadPanelPlot,
    type PlotThreadPanelRef,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {
    StoryPlotKindDto,
    StorySceneStatusDto,
    StoryThreadStatusDto,
} from "nbook/shared/dto/plot.dto";

type WorkbenchInlineRefKind = "content" | "thread" | "scene" | "plot";
type WorkbenchInlineRefSource = "thread" | "scene" | "plot";

type WorkbenchInlineRef = {
    id: string;
    kind: WorkbenchInlineRefKind;
    title: string;
    target: string;
    source: WorkbenchInlineRefSource;
    field: "summary" | "purpose" | "writingTip" | "effect";
};
const props = defineProps<{
    mode: "thread" | "scene" | "plot";
    thread: PlotThreadPanelThread | null;
    scene: PlotThreadPanelScene | null;
    plot: PlotThreadPanelPlot | null;
    chapters: PlotThreadPanelChapter[];
    effectiveRefs: WorkbenchInlineRef[];
    manualRefs: WorkbenchManualRef[];
    refTargetOptions: SelectOption[];
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "updateThread", threadId: string, patch: Partial<PlotThreadPanelThread>): void;
    (e: "updateScene", sceneId: string, patch: Partial<PlotThreadPanelScene>): void;
    (e: "updatePlot", plotId: string, patch: Partial<PlotThreadPanelPlot>): void;
    (e: "updateRefs", refs: WorkbenchManualRef[]): void;
}>();

import { useEventListener } from "@vueuse/core";

const editingTargetId = ref<string | null>(null);
const targetAnchorRect = ref<DOMRect | null>(null);
const targetActiveIndex = ref(0);
const targetPopoverRef = ref<HTMLElement | null>(null);

const editingRelationId = ref<string | null>(null);
const editingNoteId = ref<string | null>(null);

useEventListener(window, "pointerdown", (e) => {
    const el = e.target as HTMLElement;
    if (targetPopoverRef.value && targetPopoverRef.value.contains(el)) return;
    if (el.closest('.ref-card') || el.closest('.ref-popover') || el.closest('.n-combobox-dropdown')) return;
    
    editingTargetId.value = null;
    editingRelationId.value = null;
});

function openTargetSelector(id: string, event: MouseEvent) {
    if (editingTargetId.value === id) {
        editingTargetId.value = null;
        return;
    }
    editingRelationId.value = null;
    editingNoteId.value = null;
    editingTargetId.value = id;
    const el = event.currentTarget as HTMLElement;
    targetAnchorRect.value = el.getBoundingClientRect();
    targetActiveIndex.value = 0;
}

function onTargetSelect(targetId: string) {
    if (editingTargetId.value) {
        updateManualRef(editingTargetId.value, {target: targetId});
        editingTargetId.value = null;
    }
}

function getTargetIcon(target: string | null) {
    if (!target) return 'i-lucide-bookmark';
    const opt = props.refTargetOptions.find(o => o.value === target);
    return opt?.iconClass || 'i-lucide-bookmark';
}

function getTargetLabel(target: string | null) {
    if (!target) return '未选择目标';
    const opt = props.refTargetOptions.find(o => o.value === target);
    return opt?.label || target;
}

const threadStatusOptions: SelectOption[] = Object.entries(PLOT_THREAD_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const sceneStatusOptions: SelectOption[] = Object.entries(PLOT_SCENE_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const plotKindOptions: SelectOption[] = Object.entries(PLOT_KIND_LABELS).map(([value, label]) => ({
    value,
    label,
}));
const RELATION_LABELS: Record<string, string> = {
    mentions: "提及 (mentions)",
    foreshadows: "伏笔 (foreshadows)",
    depends_on: "前置依赖 (depends_on)",
    pays_off: "回收 (pays_off)",
    conflicts_with: "冲突 (conflicts_with)",
    setup_for: "铺垫 (setup_for)",
    derived_from: "派生自 (derived_from)",
};

const refRelationOptions: SelectOption[] = Object.entries(RELATION_LABELS).map(([value, label]) => ({
    value,
    label,
}));

function getRelationLabel(relation: string | null) {
    if (!relation) return "未设置关联";
    return RELATION_LABELS[relation] || relation;
}
const chapterOptions = computed<SelectOption[]>(() => [
    {value: "", label: "未挂章"},
    ...props.chapters.map((chapter) => ({
        value: chapter.id,
        label: `${chapter.numberLabel} · ${chapter.title}`,
    })),
]);

const refTargetMenuSections = computed<AgentTriggerMenuSection[]>(() => {
    return [
        {
            id: "targets",
            title: "引用目标",
            items: props.refTargetOptions.map(opt => ({
                id: String(opt.value),
                label: opt.label,
                description: String(opt.value),
                iconClass: opt.iconClass || "i-lucide-bookmark"
            }))
        }
    ];
});
const currentTitle = computed(() => {
    if (props.mode === "thread") {
        return props.thread?.title ?? "Thread";
    }
    if (props.mode === "scene") {
        return props.scene?.title ?? "Scene";
    }
    return props.plot ? (PLOT_KIND_LABELS[props.plot.kind] ?? "Plot") : "Plot";
});
const refsByKind = computed(() => {
    const groups: Record<WorkbenchInlineRefKind, WorkbenchInlineRef[]> = {
        content: [],
        thread: [],
        scene: [],
        plot: [],
    };
    for (const refItem of props.effectiveRefs) {
        groups[refItem.kind].push(refItem);
    }
    return groups;
});
const visibleRefGroups = computed(() => [
    {kind: "content" as const, label: "内容节点", items: refsByKind.value.content},
    {kind: "thread" as const, label: "Thread", items: refsByKind.value.thread},
    {kind: "scene" as const, label: "Scene", items: refsByKind.value.scene},
    {kind: "plot" as const, label: "Plot", items: refsByKind.value.plot},
].filter((group) => group.items.length > 0));

/**
 * 更新当前 Thread mock。
 */
function updateThread(patch: Partial<PlotThreadPanelThread>): void {
    if (!props.thread) {
        return;
    }
    emit("updateThread", props.thread.id, patch);
}

/**
 * 更新当前 Scene mock。
 */
function updateScene(patch: Partial<PlotThreadPanelScene>): void {
    if (!props.scene) {
        return;
    }
    emit("updateScene", props.scene.id, patch);
}

/**
 * 更新当前 Plot mock。
 */
function updatePlot(patch: Partial<PlotThreadPanelPlot>): void {
    if (!props.plot) {
        return;
    }
    emit("updatePlot", props.plot.id, patch);
}

/**
 * 新增一条手动 refs。
 */
function addManualRef(): void {
    const newId = `ref-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    emit("updateRefs", [
        ...props.manualRefs,
        {
            id: newId,
            relation: "",
            target: "",
            note: null,
        },
    ]);
    editingTargetId.value = newId;
    // We can't set anchorRect easily here without DOM, but the user can click it to open.
}

/**
 * 更新手动 refs 中的一项。
 */
function updateManualRef(refId: string, patch: Partial<WorkbenchManualRef>): void {
    emit("updateRefs", props.manualRefs.map((refItem) => refItem.id === refId
        ? {
            ...refItem,
            ...patch,
        }
        : refItem));
}

/**
 * 删除一条手动 refs。
 */
function removeManualRef(refId: string): void {
    emit("updateRefs", props.manualRefs.filter((refItem) => refItem.id !== refId));
}
</script>

<template>
    <!-- 工作台右侧编辑检查器 -->
    <aside class="flex min-h-0 w-[380px] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-panel)]/88">
        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
            <div class="mb-4 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">当前编辑：{{ props.mode }}</div>
                    <div class="mt-0.5 truncate text-[13px] font-semibold text-[var(--text-main)]">{{ currentTitle }}</div>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="复制">
                        <span class="i-lucide-copy h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="刷新引用">
                        <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-rose-600" title="删除">
                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="关闭检查器" @click="emit('close')">
                        <span class="i-lucide-panel-right-close h-3.5 w-3.5"></span>
                    </button>
                </div>
            </div>

            <section v-if="props.mode === 'thread' && props.thread" class="space-y-3">
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="标题">
                        <FormInput :model-value="props.thread.title" placeholder="Thread 标题" @update:model-value="updateThread({title: $event})" />
                    </FormField>
                    <FormField label="状态">
                        <FormSelect :model-value="props.thread.status" :options="threadStatusOptions" @update:model-value="updateThread({status: $event as StoryThreadStatusDto})" />
                    </FormField>
                </div>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.thread.summary"
                        :rows="5"
                        :min-height="94"
                        :max-height="160"
                        placeholder="Thread 摘要，可使用 [标题](lorebook/...) 或 [节点](plot://...)"
                        @update:model-value="updateThread({summary: $event})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.thread.writingTip ?? ''"
                        :rows="4"
                        :min-height="76"
                        :max-height="132"
                        placeholder="写作提示，可写入 inline ref"
                        @update:model-value="updateThread({writingTip: $event || null})"
                    />
                </FormField>
            </section>

            <section v-else-if="props.mode === 'scene' && props.scene" class="space-y-3">
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="标题">
                        <FormInput :model-value="props.scene.title" placeholder="Scene 标题" @update:model-value="updateScene({title: $event})" />
                    </FormField>
                    <FormField label="状态">
                        <FormSelect :model-value="props.scene.status" :options="sceneStatusOptions" @update:model-value="updateScene({status: $event as StorySceneStatusDto})" />
                    </FormField>
                </div>
                <div class="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
                    <FormField label="所属章节">
                        <FormSelect :model-value="props.scene.chapterPath ?? ''" :options="chapterOptions" @update:model-value="updateScene({chapterPath: $event || null})" />
                    </FormField>
                    <FormField label="序号">
                        <FormInput :model-value="String(props.scene.threadSortOrder + 1)" placeholder="序号" @update:model-value="updateScene({threadSortOrder: Math.max(0, Number($event || 1) - 1)})" />
                    </FormField>
                </div>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.scene.summary"
                        :rows="6"
                        :min-height="112"
                        :max-height="188"
                        placeholder="Scene 摘要，可使用内容节点或 plot inline ref"
                        @update:model-value="updateScene({summary: $event})"
                    />
                    <div class="mt-1 text-right text-[10px] text-[var(--text-muted)]">{{ props.scene.summary.length }}/5000</div>
                </FormField>
                <FormField label="目的">
                    <StructuredTextEditor
                        :model-value="props.scene.purpose ?? ''"
                        :rows="4"
                        :min-height="76"
                        :max-height="132"
                        placeholder="Scene 目的"
                        @update:model-value="updateScene({purpose: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.scene.writingTip ?? ''"
                        :rows="4"
                        :min-height="76"
                        :max-height="132"
                        placeholder="写作提示"
                        @update:model-value="updateScene({writingTip: $event || null})"
                    />
                </FormField>
            </section>

            <section v-else-if="props.mode === 'plot' && props.plot" class="space-y-3">
                <FormField label="Plot 类型">
                    <FormSelect :model-value="props.plot.kind" :options="plotKindOptions" @update:model-value="updatePlot({kind: $event as StoryPlotKindDto})" />
                </FormField>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.plot.summary"
                        :rows="6"
                        :min-height="112"
                        :max-height="188"
                        placeholder="Plot 摘要，可使用 [标题](lorebook/...) 或 [节点](plot://...)"
                        @update:model-value="updatePlot({summary: $event})"
                    />
                </FormField>
                <FormField label="效果">
                    <StructuredTextEditor
                        :model-value="props.plot.effect ?? ''"
                        :rows="4"
                        :min-height="76"
                        :max-height="132"
                        placeholder="Plot 效果"
                        @update:model-value="updatePlot({effect: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.plot.writingTip ?? ''"
                        :rows="4"
                        :min-height="76"
                        :max-height="132"
                        placeholder="写作提示"
                        @update:model-value="updatePlot({writingTip: $event || null})"
                    />
                </FormField>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                    当前类型：{{ PLOT_KIND_LABELS[props.plot.kind] }}
                </div>
            </section>

            <section v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/30 px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                请选择一个对象开始编辑。
            </section>

            <div class="mt-4 space-y-4">
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>Refs (手动)</span>
                        <button type="button" class="inline-flex items-center gap-0.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-main)]" @click="addManualRef">
                            <span class="i-lucide-plus h-3 w-3"></span>
                            添加
                        </button>
                    </div>
                    <div v-if="props.manualRefs.length" class="space-y-2">
                        <div v-for="refItem in props.manualRefs" :key="refItem.id" class="relative" :class="editingTargetId === refItem.id ? 'z-50' : 'z-10'">
                            <!-- DISPLAY CARD -->
                            <div 
                                class="ref-card group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 transition-all hover:border-[var(--border-color-hover)] hover:shadow-sm" 
                                :class="editingTargetId === refItem.id ? 'ring-1 ring-[var(--accent-main)]/50 !border-[var(--accent-main)]/50 shadow-sm' : ''"
                                @click.stop="openTargetSelector(refItem.id, $event)"
                            >
                                <div class="flex items-start gap-2">
                                    <span class="mt-0.5 shrink-0 text-[14px] text-[var(--accent-main)] opacity-90" :class="getTargetIcon(refItem.target)"></span>
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-1.5">
                                            <div v-if="editingRelationId === refItem.id" class="relative w-24 shrink-0" @click.stop>
                                                <Combobox
                                                    :model-value="refItem.relation || null"
                                                    :options="refRelationOptions"
                                                    @update:model-value="updateManualRef(refItem.id, {relation: $event ?? ''}); editingRelationId = null"
                                                />
                                            </div>
                                            <span 
                                                v-else 
                                                class="shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] transition-colors"
                                                @click.stop="editingRelationId = refItem.id; editingTargetId = null; editingNoteId = null"
                                            >
                                                {{ getRelationLabel(refItem.relation) }}
                                            </span>
                                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ getTargetLabel(refItem.target) }}</span>
                                        </div>
                                        <div class="mt-0.5 truncate font-mono text-[9px] text-[var(--text-muted)] opacity-60">{{ refItem.target || '尚未选择目标路径' }}</div>
                                        
                                        <!-- NOTE -->
                                        <div v-if="editingNoteId === refItem.id" class="mt-1.5" @click.stop>
                                            <input
                                                type="text"
                                                class="w-full bg-transparent outline-none text-[11px] text-[var(--text-main)] border-b border-[var(--border-color-hover)] px-0.5 py-0.5"
                                                :value="refItem.note || ''"
                                                placeholder="添加备注..."
                                                @keydown.enter="updateManualRef(refItem.id, {note: ($event.target as HTMLInputElement).value || null}); editingNoteId = null"
                                                @blur="updateManualRef(refItem.id, {note: ($event.target as HTMLInputElement).value || null}); editingNoteId = null"
                                                autofocus
                                            />
                                        </div>
                                        <div v-else-if="refItem.note" class="mt-1.5 cursor-text text-[11px] leading-relaxed text-[var(--text-secondary)] hover:text-[var(--text-main)] transition-colors" @click.stop="editingNoteId = refItem.id; editingTargetId = null; editingRelationId = null">
                                            {{ refItem.note }}
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" :class="editingTargetId === refItem.id ? 'opacity-100' : ''">
                                    <button v-if="!refItem.note && editingNoteId !== refItem.id" type="button" class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="添加备注" @click.stop="editingNoteId = refItem.id; editingTargetId = null; editingRelationId = null">
                                        <span class="i-lucide-file-plus-2 h-3.5 w-3.5"></span>
                                    </button>
                                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-600" title="删除" @click.stop="removeManualRef(refItem.id)">
                                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-transparent px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                        暂无手动引用
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>有效引用 (内联派生)</span>
                    </div>
                    <div v-if="visibleRefGroups.length" class="space-y-2.5">
                        <div v-for="group in visibleRefGroups" :key="group.kind" class="space-y-1">
                            <div class="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] opacity-70">
                                {{ group.label }}
                            </div>
                            <div class="space-y-1.5">
                                <div v-for="refItem in group.items" :key="refItem.id" class="flex flex-col gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 transition-all hover:border-[var(--border-color-hover)] hover:shadow-sm">
                                    <div class="flex items-start gap-2">
                                        <span class="mt-0.5 shrink-0 text-[14px] text-amber-500/80" :class="getTargetIcon(refItem.target)"></span>
                                        <div class="min-w-0 flex-1">
                                            <div class="flex items-center gap-1.5">
                                                <span class="rounded-[4px] bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600/90">inline</span>
                                                <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ getTargetLabel(refItem.target) }}</span>
                                            </div>
                                            <div class="mt-0.5 truncate font-mono text-[9px] text-[var(--text-muted)] opacity-60">{{ refItem.target }}</div>
                                            <div class="mt-1 flex items-center gap-1.5">
                                                <span class="i-lucide-corner-down-right h-3 w-3 shrink-0 text-[var(--text-muted)] opacity-50"></span>
                                                <span class="truncate text-[11px] text-[var(--text-secondary)]">出自: {{ refItem.title }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-transparent px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                        暂无内联派生引用
                    </div>
                </div>
            </div>
            
            <!-- TARGET SELECTOR POPOVER -->
            <div ref="targetPopoverRef" class="ref-popover">
                <ReferenceSelectorPopover
                    v-if="editingTargetId"
                    title="修改引用目标"
                    prefix="TARGET"
                    :sections="refTargetMenuSections"
                    :active-index="targetActiveIndex"
                    :anchor-rect="targetAnchorRect"
                    density="compact"
                    @hover="targetActiveIndex = $event"
                    @select="onTargetSelect"
                />
            </div>
        </div>

        <div class="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
            <button type="button" class="workbench-ai-button">
                <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                AI 批注
            </button>
        </div>
    </aside>
</template>

<style scoped>
.workbench-ai-button {
    display: flex;
    height: 2.25rem;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--accent-main) 52%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    font-size: 12px;
    font-weight: 600;
    color: color-mix(in srgb, var(--accent-main) 88%, #5f3300);
}

.workbench-ai-button:hover {
    background: color-mix(in srgb, var(--accent-main) 24%, var(--bg-panel));
}
</style>
