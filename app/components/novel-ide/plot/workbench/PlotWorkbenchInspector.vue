<script setup lang="ts">
import {computed} from "vue";
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import RefEditorPopover from "./RefEditorPopover.vue";
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
type WorkbenchInlineRefSource = "scene";

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

const activeRefId = ref<string | null>(null);
const refCardRefs = ref<Record<string, HTMLElement>>({});

function setRefCardRef(el: any, id: string) {
    if (el) {
        refCardRefs.value[id] = el.$el || el;
    } else {
        delete refCardRefs.value[id];
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

function getTargetDescription(target: string | null) {
    if (!target) return null;
    const opt = props.refTargetOptions.find(o => o.value === target);
    return opt?.description || null;
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
const showRefs = computed(() => props.mode === "scene" && Boolean(props.scene));

/**
 * 更新当前 Thread。
 */
function updateThread(patch: Partial<PlotThreadPanelThread>): void {
    if (!props.thread) {
        return;
    }
    emit("updateThread", props.thread.id, patch);
}

/**
 * 更新当前 Scene。
 */
function updateScene(patch: Partial<PlotThreadPanelScene>): void {
    if (!props.scene) {
        return;
    }
    emit("updateScene", props.scene.id, patch);
}

/**
 * 更新当前 Plot。
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
    activeRefId.value = newId;
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
                        :rows="12"
                        :min-height="228"
                        :max-height="380"
                        placeholder="Thread 摘要，可使用 [标题](lorebook/...) 或 [节点](plot://...)"
                        @update:model-value="updateThread({summary: $event})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.thread.writingTip ?? ''"
                        :rows="6"
                        :min-height="114"
                        :max-height="380"
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
                <div class="grid grid-cols-1 gap-2">
                    <FormField label="所属章节">
                        <FormSelect :model-value="props.scene.chapterPath ?? ''" :options="chapterOptions" @update:model-value="updateScene({chapterPath: $event || null})" />
                    </FormField>
                </div>
                <FormField label="摘要">
                    <StructuredTextEditor
                        :model-value="props.scene.summary"
                        :rows="12"
                        :min-height="228"
                        :max-height="380"
                        placeholder="Scene 摘要，可使用内容节点或 plot inline ref"
                        @update:model-value="updateScene({summary: $event})"
                    />
                    <div class="mt-1 text-right text-[10px] text-[var(--text-muted)]">{{ props.scene.summary.length }}/5000</div>
                </FormField>
                <FormField label="目的">
                    <StructuredTextEditor
                        :model-value="props.scene.purpose ?? ''"
                        :rows="8"
                        :min-height="152"
                        :max-height="380"
                        placeholder="Scene 目的"
                        @update:model-value="updateScene({purpose: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.scene.writingTip ?? ''"
                        :rows="6"
                        :min-height="114"
                        :max-height="380"
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
                        :rows="12"
                        :min-height="228"
                        :max-height="380"
                        placeholder="Plot 摘要，可使用 [标题](lorebook/...) 或 [节点](plot://...)"
                        @update:model-value="updatePlot({summary: $event})"
                    />
                </FormField>
                <FormField label="效果">
                    <StructuredTextEditor
                        :model-value="props.plot.effect ?? ''"
                        :rows="8"
                        :min-height="152"
                        :max-height="380"
                        placeholder="Plot 效果"
                        @update:model-value="updatePlot({effect: $event || null})"
                    />
                </FormField>
                <FormField label="写作提示">
                    <StructuredTextEditor
                        :model-value="props.plot.writingTip ?? ''"
                        :rows="6"
                        :min-height="114"
                        :max-height="380"
                        placeholder="写作提示"
                        @update:model-value="updatePlot({writingTip: $event || null})"
                    />
                </FormField>
            </section>

            <section v-else class="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-input)]/30 px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                请选择一个对象开始编辑。
            </section>

            <div v-if="showRefs" class="mt-4 space-y-4">
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span>Refs (手动)</span>
                        <button type="button" class="inline-flex items-center gap-0.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-main)]" @click="addManualRef">
                            <span class="i-lucide-plus h-3 w-3"></span>
                            添加
                        </button>
                    </div>
                    <div v-if="props.manualRefs.length" class="space-y-2">
                        <div v-for="refItem in props.manualRefs" :key="refItem.id" class="relative" :class="activeRefId === refItem.id ? 'z-50' : 'z-10'">
                            <!-- DISPLAY CARD -->
                            <div 
                                :ref="(el) => setRefCardRef(el, refItem.id)"
                                class="group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 transition-all hover:border-[var(--border-color-hover)] hover:shadow-sm" 
                                :class="activeRefId === refItem.id ? 'ring-1 ring-[var(--accent-main)]/50 !border-[var(--accent-main)]/50 shadow-sm' : ''"
                                @click.stop="activeRefId = activeRefId === refItem.id ? null : refItem.id"
                            >
                                <div class="flex items-start gap-2">
                                    <span class="mt-0.5 shrink-0 text-[14px] text-[var(--accent-main)] opacity-90" :class="getTargetIcon(refItem.target)"></span>
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-1.5" :title="refItem.target || '尚未选择目标路径'">
                                            <span class="shrink-0 whitespace-nowrap rounded-[4px] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ getRelationLabel(refItem.relation) }}</span>
                                            <span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ getTargetLabel(refItem.target) }}</span>
                                        </div>
                                        <div v-if="getTargetDescription(refItem.target)" class="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">
                                            {{ getTargetDescription(refItem.target) }}
                                        </div>
                                        <div v-if="refItem.note" class="mt-1.5 rounded-md bg-[var(--bg-sidebar)] px-2 py-1 text-[11px] leading-relaxed text-[var(--text-main)]">
                                            {{ refItem.note }}
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="absolute right-1.5 top-1.5 flex opacity-0 transition-opacity group-hover:opacity-100">
                                    <button type="button" class="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="删除" @click.stop="removeManualRef(refItem.id)">
                                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                                    </button>
                                </div>
                            </div>
                            
                            <!-- EDIT POPOVER -->
                            <RefEditorPopover
                                v-if="activeRefId === refItem.id"
                                :ref-item="refItem"
                                :ref-relation-options="refRelationOptions"
                                :ref-target-options="props.refTargetOptions"
                                :anchor-element="refCardRefs[refItem.id] ?? null"
                                @update="updateManualRef(refItem.id, $event)"
                                @close="activeRefId = null"
                            />
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
        </div>

    </aside>
</template>
