<script setup lang="ts">
import {computed, ref} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import PlotWorkbenchInspector from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue";
import PlotWorkbenchSceneList from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchSceneList.vue";
import PlotWorkbenchSidebar from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchSidebar.vue";
import type {
    PlotThreadPanelChapter,
    PlotThreadPanelPlot,
    PlotThreadPanelRef,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {PlotPreviewStory, PlotPreviewPhase} from "nbook/app/components/novel-ide/plot/plot-preview.types";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {WorkbenchManualRef} from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";

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
    modelValue: boolean;
    story: PlotPreviewStory;
    phases: PlotPreviewPhase[];
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    plots: PlotThreadPanelPlot[];
    chapters: PlotThreadPanelChapter[];
    selectedThreadId: string | null;
    selectedSceneId: string | null;
    selectedPlotId: string | null;
    pinnedThreadIds: string[];
    loading?: boolean;
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "selectThread", threadId: string): void;
    (e: "selectScene", sceneId: string): void;
    (e: "selectPlot", plotId: string): void;
    (e: "createThread"): void;
    (e: "toggleThreadPin", threadId: string): void;
    (e: "toggleThreadMain", threadId: string): void;
    (e: "deleteThread", threadId: string): void;
    (e: "createScene", threadId: string): void;
    (e: "autoSortScenes", sceneIds: string[]): void;
    (e: "reorderScenes", sceneIds: string[]): void;
    (e: "reorderPlots", payload: {sceneId: string; plotIds: string[]}): void;
    (e: "createPlot", sceneId: string): void;
    (e: "deletePlot", plotId: string): void;
    (e: "updateThread", threadId: string, patch: Partial<PlotThreadPanelThread>): void;
    (e: "updateScene", sceneId: string, patch: Partial<PlotThreadPanelScene>): void;
    (e: "updatePlot", plotId: string, patch: Partial<PlotThreadPanelPlot>): void;
}>();

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)]\(([^)]+)\)/g;

const activeTab = ref<"overview" | "chapter" | "thread" | "draft" | "timeline" | "tree">("thread");
const inspectorMode = ref<"thread" | "scene" | "plot" | null>(null);
const search = ref("");
const threadMode = ref<"all" | "main" | "support" | "active" | "draft" | "paused" | "unmounted" | "pinned" | "recent">("all");

const tabs: Array<{value: "overview" | "chapter" | "thread" | "draft" | "timeline" | "tree"; label: string; icon: string}> = [
    {value: "overview", label: "总览", icon: "i-lucide-layout-dashboard"},
    {value: "chapter", label: "章节设计", icon: "i-lucide-book-open"},
    {value: "thread", label: "线程规划", icon: "i-lucide-git-branch-plus"},
    {value: "draft", label: "草稿池", icon: "i-lucide-clipboard-list"},
    {value: "timeline", label: "Timeline", icon: "i-lucide-move-horizontal"},
    {value: "tree", label: "Tree", icon: "i-lucide-network"},
];

const selectedThread = computed(() => {
    return props.threads.find((thread) => thread.id === props.selectedThreadId) ?? null;
});
const selectedScene = computed(() => {
    return props.scenes.find((scene) => scene.id === props.selectedSceneId) ?? null;
});
const selectedPlot = computed(() => {
    return props.plots.find((plot) => plot.id === props.selectedPlotId) ?? null;
});
const selectedPhase = computed(() => {
    return props.phases.find((phase) => phase.id === selectedThread.value?.phaseId) ?? props.phases[0] ?? null;
});
const effectiveRefs = computed<WorkbenchInlineRef[]>(() => {
    if (inspectorMode.value !== "scene" || !selectedScene.value) {
        return [];
    }
    return extractWorkbenchInlineRefs("scene", selectedScene.value.id, [
        ["summary", selectedScene.value.summary],
        ["purpose", selectedScene.value.purpose ?? ""],
        ["writingTip", selectedScene.value.writingTip ?? ""],
    ]);
});
const refTargetOptions = computed(() => buildRefTargetOptions());
const manualRefs = computed<WorkbenchManualRef[]>(() => {
    if (inspectorMode.value !== "scene") {
        return [];
    }
    return toManualRefs(selectedScene.value?.refs ?? []);
});

/**
 * 同步选中 Thread，同时让右侧检查器回到 Thread/Scene 的可见对象。
 */
function selectThread(threadId: string): void {
    emit("selectThread", threadId);
}

/**
 * 同步选中 Scene。
 */
function selectScene(sceneId: string): void {
    emit("selectScene", sceneId);
}

/**
 * 同步选中 Plot。
 */
function selectPlot(plotId: string): void {
    emit("selectPlot", plotId);
}

/**
 * 打开 Thread 检查器。
 */
function editThread(threadId: string): void {
    emit("selectThread", threadId);
    inspectorMode.value = "thread";
}

/**
 * 打开 Scene 检查器。
 */
function editScene(sceneId: string): void {
    emit("selectScene", sceneId);
    inspectorMode.value = "scene";
}

/**
 * 打开 Plot 检查器。
 */
function editPlot(plotId: string): void {
    emit("selectPlot", plotId);
    inspectorMode.value = "plot";
}

/**
 * 更新当前对象的手动 refs。
 */
function updateManualRefs(refs: WorkbenchManualRef[]): void {
    if (inspectorMode.value === "scene" && selectedScene.value) {
        emit("updateScene", selectedScene.value.id, {refs: toPanelRefs(refs)});
    }
}

/**
 * 生成 refs target 候选列表。
 */
function buildRefTargetOptions(): SelectOption[] {
    const options: SelectOption[] = [];
    for (const thread of props.threads) {
        options.push({ value: `thread://${thread.id}`, label: thread.title || "未命名 Thread", iconClass: "i-lucide-git-branch", description: thread.summary });
    }
    for (const scene of props.scenes) {
        options.push({ value: `scene://${scene.id}`, label: scene.title || "未命名 Scene", iconClass: "i-lucide-clapperboard", description: scene.summary });
    }
    for (const plot of props.plots) {
        options.push({ value: `plot://${plot.id}`, label: plot.summary || "未命名 Plot", iconClass: "i-lucide-message-square-dashed" });
    }
    options.push({ value: "lorebook/location/initial-stage/", label: "初始舞台", iconClass: "i-lucide-map-pin", description: "lorebook/location/initial-stage/" });
    options.push({ value: "lorebook/character/slave-girl/", label: "奴隶少女", iconClass: "i-lucide-user", description: "lorebook/character/slave-girl/" });
    options.push({ value: "lorebook/item/debt-contract/", label: "债务契约", iconClass: "i-lucide-box", description: "lorebook/item/debt-contract/" });
    return options;
}

/**
 * 从剧情字段里的 Markdown link 派生工作台引用。
 */
function extractWorkbenchInlineRefs(
    source: WorkbenchInlineRefSource,
    sourceId: string,
    fields: Array<[WorkbenchInlineRef["field"], string]>,
): WorkbenchInlineRef[] {
    const refs = new Map<string, WorkbenchInlineRef>();
    for (const [field, text] of fields) {
        for (const matched of text.matchAll(MARKDOWN_LINK_PATTERN)) {
            const title = matched[1]?.trim() ?? "";
            const target = normalizeInlineTarget(matched[2] ?? "");
            const kind = resolveInlineRefKind(target);
            if (!title || !target || !kind) {
                continue;
            }

            const key = `${source}:${sourceId}:${field}:${kind}:${target}:${title}`;
            refs.set(key, {
                id: key,
                kind,
                title,
                target,
                source,
                field,
            });
        }
    }
    return [...refs.values()];
}

/**
 * 判断 inline ref 目标类型。外部 URL 不进入 effective refs。
 */
function resolveInlineRefKind(target: string): WorkbenchInlineRefKind | null {
    if (/^https?:\/\//i.test(target)) {
        return null;
    }
    if (target.startsWith("thread://")) {
        return "thread";
    }
    if (target.startsWith("scene://")) {
        return "scene";
    }
    if (target.startsWith("plot://")) {
        return "plot";
    }
    if (target && !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
        return "content";
    }
    return null;
}

/**
 * 保留 workspace path 形态，去掉 query/hash 方便展示和去重。
 */
function normalizeInlineTarget(raw: string): string {
    return raw.trim().replace(/\\/g, "/").replace(/[?#].*$/, "");
}

/**
 * 把现有 plot refs 类型转换成通用 content-node refs 形状。
 */
function toManualRefs(refs: PlotThreadPanelRef[]): WorkbenchManualRef[] {
    return refs.map((refItem) => ({
        id: refItem.id,
        relation: refItem.relation,
        target: refItem.target,
        note: refItem.note ?? null,
    }));
}

/**
 * 当前正式 plot 面板类型仍要求 visibility，preview 写回时内部补默认值。
 */
function toPanelRefs(refs: WorkbenchManualRef[]): PlotThreadPanelRef[] {
    return refs.map((refItem) => ({
        ...refItem,
        visibility: "author",
    }));
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        width="min(1840px, calc(100vw - 24px))"
        height="min(1080px, calc(100vh - 24px))"
        max-height="calc(100vh - 24px)"
        overlay-type="blur"
        :show-footer="false"
        :close-on-overlay="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <!-- 剧本工作台顶部栏 -->
            <div class="flex min-w-0 flex-1 items-center gap-3">
                <span class="workbench-accent-icon">
                    <span class="i-lucide-pen-line h-4 w-4"></span>
                </span>
                <span class="text-[16px] font-semibold text-[var(--text-main)]">剧本工作台</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] md:inline">新小说</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] md:inline">›</span>
                <span class="hidden truncate text-[13px] text-[var(--text-secondary)] md:inline">{{ selectedPhase?.title ?? "未分阶段" }}</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] lg:inline">›</span>
                <span class="hidden max-w-[260px] truncate text-[13px] text-[var(--text-secondary)] lg:inline">主线：{{ selectedThread?.title ?? props.story.title }}</span>

                <span class="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    <span class="h-2 w-2 rounded-full" :class="props.error ? 'bg-rose-500' : props.loading ? 'bg-amber-500' : 'bg-emerald-500'"></span>
                    {{ props.error ? "加载失败" : props.loading ? "加载中" : "已保存" }}
                    <span v-if="!props.error">刚刚</span>
                </span>

                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:modelValue', false)">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <!-- 工作台主体 -->
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--bg-main)_96%,white)]">
            <nav class="flex h-11 shrink-0 items-center justify-center gap-10 border-b border-[var(--border-color)] bg-[var(--bg-panel)]/88 px-8 text-[12px] font-medium shadow-sm">
                <button
                    v-for="tab in tabs"
                    :key="tab.value"
                    type="button"
                    class="relative inline-flex h-full items-center justify-center gap-2 transition-colors"
                    :class="activeTab === tab.value ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'"
                    @click="activeTab = tab.value"
                >
                    <span class="h-4 w-4 transition-opacity" :class="[tab.icon, activeTab === tab.value ? 'opacity-100' : 'opacity-60']"></span>
                    <span class="truncate">{{ tab.label }}</span>
                    <div v-if="activeTab === tab.value" class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-[var(--accent-main)]"></div>
                </button>
            </nav>

            <div class="relative flex min-h-0 flex-1">
                <div v-if="props.error" class="absolute left-1/2 top-[70px] z-20 -translate-x-1/2 rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 shadow-sm">
                    {{ props.error }}
                </div>

                <PlotWorkbenchSidebar
                    v-model:search="search"
                    v-model:mode="threadMode"
                    :threads="props.threads"
                    :scenes="props.scenes"
                    :plots="props.plots"
                    :pinned-thread-ids="props.pinnedThreadIds"
                    :selected-thread-id="props.selectedThreadId"
                    @select-thread="selectThread"
                    @edit-thread="editThread"
                    @create-thread="emit('createThread')"
                    @toggle-thread-pin="emit('toggleThreadPin', $event)"
                    @toggle-thread-main="emit('toggleThreadMain', $event)"
                    @delete-thread="emit('deleteThread', $event)"
                />

                <PlotWorkbenchSceneList
                    :thread="selectedThread"
                    :scenes="props.scenes"
                    :plots="props.plots"
                    :chapters="props.chapters"
                    :selected-scene-id="props.selectedSceneId"
                    @select-scene="selectScene"
                    @select-plot="selectPlot"
                    @edit-scene="editScene"
                    @edit-plot="editPlot"
                    @delete-plot="emit('deletePlot', $event)"
                    @create-plot="emit('createPlot', $event)"
                    @create-scene="emit('createScene', $event)"
                    @auto-sort-scenes="emit('autoSortScenes', $event)"
                    @reorder-scenes="emit('reorderScenes', $event)"
                    @reorder-plots="emit('reorderPlots', $event)"
                />

                <Transition name="inspector">
                    <PlotWorkbenchInspector
                        v-if="inspectorMode"
                        :mode="inspectorMode"
                        :thread="selectedThread"
                        :scene="selectedScene"
                        :plot="selectedPlot"
                        :chapters="props.chapters"
                        :effective-refs="effectiveRefs"
                        :manual-refs="manualRefs"
                        :ref-target-options="refTargetOptions"
                        @close="inspectorMode = null"
                        @update-thread="(threadId, patch) => emit('updateThread', threadId, patch)"
                        @update-scene="(sceneId, patch) => emit('updateScene', sceneId, patch)"
                        @update-plot="(plotId, patch) => emit('updatePlot', plotId, patch)"
                        @update-refs="updateManualRefs"
                    />
                </Transition>
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.workbench-top-button {
    display: inline-flex;
    height: 2rem;
    align-items: center;
    gap: 0.375rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border-color);
    background: var(--bg-input);
    padding: 0 0.75rem;
    font-size: 12px;
    color: var(--text-main);
    transition: background-color 0.15s ease, color 0.15s ease;
}

.workbench-top-button:hover {
    background: var(--bg-hover);
}

.workbench-accent-icon {
    display: flex;
    height: 1.75rem;
    width: 1.75rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--accent-main) 58%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    color: color-mix(in srgb, var(--accent-main) 86%, #5f3300);
}

.inspector-enter-active,
.inspector-leave-active {
    transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.inspector-enter-from,
.inspector-leave-to {
    margin-right: -380px;
    transform: translateX(20px);
    opacity: 0;
}
</style>
