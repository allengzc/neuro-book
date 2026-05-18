<script setup lang="ts">
import type {Data} from "@dnd-kit/abstract";
import {defaultPreset} from "@dnd-kit/dom";
import {move} from "@dnd-kit/helpers";
import {DragDropProvider, KeyboardSensor, PointerSensor} from "@dnd-kit/vue";
import type {DragDropProviderEmits} from "@dnd-kit/vue";
import {isSortable} from "@dnd-kit/vue/sortable";
import {computed, nextTick, ref, watch} from "vue";
import {
    PLOT_SCENE_STATUS_LABELS,
    type PlotThreadPanelChapter,
    type PlotThreadPanelPlot,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import PlotWorkbenchSortablePlotRow from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchSortablePlotRow.vue";
import PlotWorkbenchSortableSceneCard from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchSortableSceneCard.vue";

type DragStartPayload = DragDropProviderEmits["dragStart"][0];
type DragOverPayload = DragDropProviderEmits["dragOver"][0];
type DragEndPayload = DragDropProviderEmits["dragEnd"][0];
type SceneDragData = {
    kind: "scene";
    sceneId: string;
    threadId: string;
};
type PlotDragData = {
    kind: "plot";
    plotId: string;
    sceneId: string;
};

const props = defineProps<{
    thread: PlotThreadPanelThread | null;
    scenes: PlotThreadPanelScene[];
    plots: PlotThreadPanelPlot[];
    chapters: PlotThreadPanelChapter[];
    selectedSceneId: string | null;
}>();

const emit = defineEmits<{
    (e: "selectScene", sceneId: string): void;
    (e: "selectPlot", plotId: string): void;
    (e: "editScene", sceneId: string): void;
    (e: "editPlot", plotId: string): void;
    (e: "deletePlot", plotId: string): void;
    (e: "createScene", threadId: string): void;
    (e: "autoSortScenes", sceneIds: string[]): void;
    (e: "reorderScenes", sceneIds: string[]): void;
    (e: "reorderPlots", payload: {sceneId: string; plotIds: string[]}): void;
}>();

const dndSensors = [
    PointerSensor.configure({
        activatorElements(source) {
            return [source.handle];
        },
    }),
    KeyboardSensor,
];
const chapterMap = computed(() => new Map(props.chapters.map((chapter) => [chapter.id, chapter])));
const dragScenes = ref<PlotThreadPanelScene[] | null>(null);
const dragPlots = ref<{sceneId: string; plots: PlotThreadPanelPlot[]} | null>(null);
const sceneStackRef = ref<HTMLElement | null>(null);
const visibleScenes = computed(() => {
    if (!props.thread) {
        return [];
    }

    return props.scenes
        .filter((scene) => scene.threadId === props.thread?.id)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder);
});
const sceneCount = computed(() => visibleScenes.value.length);
const plotCount = computed(() => visibleScenes.value.reduce((count, scene) => count + scenePlots(scene.id).length, 0));
const focusScene = computed(() => visibleScenes.value.find((scene) => scene.status === "active") ?? visibleScenes.value[0] ?? null);
const expandedSceneIds = ref<string[]>([]);
const sceneCheckMessage = ref<string | null>(null);
const renderedScenes = computed(() => dragScenes.value ?? visibleScenes.value);

/**
 * 返回当前 Scene 下的 Plot 列表。
 */
function scenePlots(sceneId: string): PlotThreadPanelPlot[] {
    return props.plots
        .filter((plot) => plot.sceneId === sceneId)
        .sort((left, right) => left.sortOrder - right.sortOrder);
}

/**
 * 返回拖拽中的 Plot 乐观排序列表。
 */
function renderedScenePlots(sceneId: string): PlotThreadPanelPlot[] {
    if (dragPlots.value?.sceneId === sceneId) {
        return dragPlots.value.plots;
    }
    return scenePlots(sceneId);
}

/**
 * 判断是否为 Scene 拖拽数据。
 */
function isSceneDragData(data: Data | undefined): data is SceneDragData {
    return data?.kind === "scene"
        && typeof data.sceneId === "string"
        && typeof data.threadId === "string";
}

/**
 * 判断是否为 Plot 拖拽数据。
 */
function isPlotDragData(data: Data | undefined): data is PlotDragData {
    return data?.kind === "plot"
        && typeof data.plotId === "string"
        && typeof data.sceneId === "string";
}

/**
 * 判断当前 Scene 是否展开 Plot 组。
 */
function isExpanded(sceneId: string): boolean {
    return expandedSceneIds.value.includes(sceneId);
}

/**
 * 展开或收起 Scene 下的 Plot 组。
 */
function toggleScene(sceneId: string): void {
    if (isExpanded(sceneId)) {
        expandedSceneIds.value = expandedSceneIds.value.filter((id) => id !== sceneId);
        return;
    }

    expandedSceneIds.value = [...expandedSceneIds.value, sceneId];
}

/**
 * 记录 Scene 卡片当前 DOM 位置，供按钮排序后做 FLIP 动画。
 */
function snapshotSceneRects(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>();
    const stack = sceneStackRef.value;
    if (!stack) {
        return rects;
    }

    stack.querySelectorAll<HTMLElement>("[data-workbench-scene-id]").forEach((element) => {
        const sceneId = element.dataset.workbenchSceneId;
        if (sceneId) {
            rects.set(sceneId, element.getBoundingClientRect());
        }
    });

    return rects;
}

/**
 * 在数据提交后用 DOM 位移补间，避免上移/下移按钮造成卡片直接跳位。
 */
async function animateSceneReorder(previousRects: Map<string, DOMRect>): Promise<void> {
    if (!previousRects.size) {
        return;
    }

    await nextTick();
    const stack = sceneStackRef.value;
    if (!stack) {
        return;
    }

    const animatedItems: HTMLElement[] = [];
    stack.querySelectorAll<HTMLElement>("[data-workbench-scene-id]").forEach((element) => {
        const sceneId = element.dataset.workbenchSceneId;
        const previousRect = sceneId ? previousRects.get(sceneId) : undefined;
        if (!previousRect) {
            return;
        }

        const nextRect = element.getBoundingClientRect();
        const deltaY = previousRect.top - nextRect.top;
        if (Math.abs(deltaY) < 1) {
            return;
        }

        element.style.transition = "none";
        element.style.transform = `translate3d(0, ${deltaY}px, 0)`;
        animatedItems.push(element);
    });

    if (!animatedItems.length) {
        return;
    }

    void stack.offsetHeight;
    window.requestAnimationFrame(() => {
        animatedItems.forEach((element) => {
            const cleanup = (): void => {
                element.style.transition = "";
                element.style.transform = "";
                element.removeEventListener("transitionend", cleanup);
            };

            element.addEventListener("transitionend", cleanup, {once: true});
            element.style.transition = "transform 260ms cubic-bezier(0.2, 0, 0, 1)";
            element.style.transform = "translate3d(0, 0, 0)";
        });
    });
}

/**
 * 通过按钮上移或下移 Scene。
 */
function moveScene(payload: {sceneId: string; direction: "up" | "down"}): void {
    const currentIndex = visibleScenes.value.findIndex((scene) => scene.id === payload.sceneId);
    if (currentIndex < 0) {
        return;
    }

    const targetIndex = payload.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visibleScenes.value.length) {
        return;
    }

    const nextScenes = [...visibleScenes.value];
    const [scene] = nextScenes.splice(currentIndex, 1);
    if (!scene) {
        return;
    }
    nextScenes.splice(targetIndex, 0, scene);
    const previousRects = snapshotSceneRects();
    emit("reorderScenes", nextScenes.map((item) => item.id));
    void animateSceneReorder(previousRects);
}

/**
 * 通过按钮上移或下移 Plot。
 */
function movePlot(payload: {sceneId: string; plotId: string; direction: "up" | "down"}): void {
    const currentPlots = renderedScenePlots(payload.sceneId);
    const currentIndex = currentPlots.findIndex((plot) => plot.id === payload.plotId);
    if (currentIndex < 0) {
        return;
    }

    const targetIndex = payload.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentPlots.length) {
        return;
    }

    const nextPlots = [...currentPlots];
    const [plot] = nextPlots.splice(currentIndex, 1);
    if (!plot) {
        return;
    }
    nextPlots.splice(targetIndex, 0, plot);

    emit("reorderPlots", {
        sceneId: payload.sceneId,
        plotIds: nextPlots.map((item) => item.id),
    });
}

/**
 * 创建当前 Thread 下的 Scene mock。
 */
function createScene(): void {
    if (!props.thread) {
        return;
    }
    emit("createScene", props.thread.id);
    sceneCheckMessage.value = "已新增一个 Scene 草稿。";
}

/**
 * 按章节顺序和当前 Thread 序号整理 Scene。
 */
function autoSortScenes(): void {
    const nextScenes = [...visibleScenes.value].sort((left, right) => {
        const leftChapter = left.chapterSortOrder ?? Number.MAX_SAFE_INTEGER;
        const rightChapter = right.chapterSortOrder ?? Number.MAX_SAFE_INTEGER;
        if (leftChapter !== rightChapter) {
            return leftChapter - rightChapter;
        }
        return left.threadSortOrder - right.threadSortOrder;
    });

    emit("autoSortScenes", nextScenes.map((scene) => scene.id));
    sceneCheckMessage.value = "已按章节顺序整理 Scene。";
}

/**
 * 检查当前 Thread 下 Scene 的基础依赖信息。
 */
function checkSceneDependencies(): void {
    const unmountedScenes = visibleScenes.value.filter((scene) => !scene.chapterPath).length;
    const emptyPurposeScenes = visibleScenes.value.filter((scene) => !(scene.purpose ?? "").trim()).length;
    const emptyPlotScenes = visibleScenes.value.filter((scene) => scenePlots(scene.id).length === 0).length;
    const issues = [
        unmountedScenes ? `${unmountedScenes} 个 Scene 未挂章` : "",
        emptyPurposeScenes ? `${emptyPurposeScenes} 个 Scene 缺少目的` : "",
        emptyPlotScenes ? `${emptyPlotScenes} 个 Scene 没有 Plot` : "",
    ].filter(Boolean);

    sceneCheckMessage.value = issues.length ? `检查完成：${issues.join("，")}。` : "检查完成：当前 Thread 依赖信息完整。";
}

/**
 * 卡片只展示 inline ref 的标题，Markdown 源码仍由 Inspector 保留。
 */
function displayInlineText(text: string | null): string {
    return (text ?? "").replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
}

/**
 * Scene 拖拽开始时记录当前 Thread 内列表快照。
 */
function handleSceneDragStart(event: DragStartPayload): void {
    const source = event.operation.source;
    if (!source || !isSortable(source) || !isSceneDragData(source.data)) {
        dragScenes.value = null;
        return;
    }

    dragScenes.value = [...visibleScenes.value];
}

/**
 * Scene 拖拽经过时实时更新本地排序。
 */
function handleSceneDragOver(event: DragOverPayload): void {
    const source = event.operation.source;
    const target = event.operation.target;

    if (!source || !isSortable(source) || !isSceneDragData(source.data)) {
        return;
    }
    if (!target || !isSortable(target) || !isSceneDragData(target.data) || source.data.threadId !== target.data.threadId) {
        event.preventDefault();
        return;
    }
    if (!dragScenes.value) {
        dragScenes.value = [...visibleScenes.value];
    }

    dragScenes.value = move(dragScenes.value, event) as PlotThreadPanelScene[];
}

/**
 * Scene 拖拽结束后提交新顺序。
 */
function handleSceneDragEnd(event: DragEndPayload): void {
    const source = event.operation.source;
    const nextScenes = dragScenes.value;
    dragScenes.value = null;

    if (!source || !isSortable(source) || !isSceneDragData(source.data) || !nextScenes || event.canceled) {
        return;
    }

    const previousIds = visibleScenes.value.map((scene) => scene.id);
    const nextIds = nextScenes.map((scene) => scene.id);
    if (previousIds.length === nextIds.length && previousIds.every((sceneId, index) => sceneId === nextIds[index])) {
        return;
    }

    emit("reorderScenes", nextIds);
}

/**
 * Plot 拖拽开始时记录当前 Scene 下列表快照。
 */
function handlePlotDragStart(event: DragStartPayload): void {
    const source = event.operation.source;
    if (!source || !isSortable(source) || !isPlotDragData(source.data)) {
        dragPlots.value = null;
        return;
    }

    dragPlots.value = {
        sceneId: source.data.sceneId,
        plots: scenePlots(source.data.sceneId),
    };
}

/**
 * Plot 拖拽经过时实时更新本地排序。
 */
function handlePlotDragOver(event: DragOverPayload): void {
    const source = event.operation.source;
    const target = event.operation.target;

    if (!source || !isSortable(source) || !isPlotDragData(source.data)) {
        return;
    }
    if (!target || !isSortable(target) || !isPlotDragData(target.data) || source.data.sceneId !== target.data.sceneId) {
        event.preventDefault();
        return;
    }
    if (!dragPlots.value) {
        dragPlots.value = {
            sceneId: source.data.sceneId,
            plots: scenePlots(source.data.sceneId),
        };
    }

    dragPlots.value = {
        sceneId: source.data.sceneId,
        plots: move(dragPlots.value.plots, event) as PlotThreadPanelPlot[],
    };
}

/**
 * Plot 拖拽结束后提交当前 Scene 内的新顺序。
 */
function handlePlotDragEnd(event: DragEndPayload): void {
    const source = event.operation.source;
    const nextPlots = dragPlots.value;
    dragPlots.value = null;

    if (!source || !isSortable(source) || !isPlotDragData(source.data) || !nextPlots || event.canceled) {
        return;
    }

    const previousIds = scenePlots(source.data.sceneId).map((plot) => plot.id);
    const nextIds = nextPlots.plots.map((plot) => plot.id);
    if (previousIds.length === nextIds.length && previousIds.every((plotId, index) => plotId === nextIds[index])) {
        return;
    }

    emit("reorderPlots", {
        sceneId: source.data.sceneId,
        plotIds: nextIds,
    });
}

watch(() => props.thread?.id, () => {
    const firstScene = visibleScenes.value[0] ?? null;
    expandedSceneIds.value = firstScene ? [firstScene.id] : [];
    dragScenes.value = null;
    dragPlots.value = null;
}, {immediate: true});
</script>

<template>
    <!-- 工作台中部 Scene 编排区 -->
    <main class="min-w-0 flex-1 overflow-y-auto bg-transparent px-3 py-3 custom-scrollbar">
        <section v-if="props.thread" class="mb-3 flex flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm xl:flex-row">
            <!-- Thread 摘要区 -->
            <div class="flex min-w-0 flex-1 flex-col p-3.5">
                <div class="flex flex-wrap items-center gap-2.5">
                    <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <span class="i-lucide-drama h-4 w-4"></span>
                    </span>
                    <h2 class="min-w-0 truncate text-[15px] font-semibold text-[var(--text-main)]">{{ props.thread.title }}</h2>
                    <span class="rounded-[4px] bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
                        {{ props.thread.isMainThread ? "主线" : "支线" }}
                    </span>
                    <span class="text-[11.5px] font-medium text-[var(--text-muted)]">第一阶段：开局逃亡</span>
                </div>
                
                <div class="mt-3 flex flex-col gap-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    <div class="flex items-start gap-2">
                        <span class="i-lucide-align-left mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-70"></span>
                        <p class="min-w-0 flex-1">{{ displayInlineText(props.thread.summary) }}</p>
                    </div>
                    <div class="flex items-start gap-2">
                        <span class="i-lucide-lightbulb mt-[3px] h-3.5 w-3.5 shrink-0 text-amber-500/70"></span>
                        <p class="min-w-0 flex-1 text-[var(--text-muted)]">{{ displayInlineText(props.thread.writingTip ?? "保持清晰的因果链，避免场景只承担说明功能。") }}</p>
                    </div>
                </div>
            </div>

            <!-- 分割线 -->
            <div class="h-[1px] w-full bg-[var(--border-color)] xl:h-auto xl:w-[1px]"></div>

            <!-- 当前推进信息栏 -->
            <div class="flex w-full shrink-0 flex-col bg-[var(--bg-main)]/20 p-3.5 xl:w-[320px]">
                <div class="mb-3 flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                        <div class="flex h-5 w-5 items-center justify-center rounded bg-[var(--bg-panel)] shadow-sm ring-1 ring-inset ring-[var(--border-color)]">
                            <span class="i-lucide-target h-3 w-3 text-blue-500"></span>
                        </div>
                        <span class="text-[11px] font-semibold tracking-wider text-[var(--text-muted)]">当前推进</span>
                    </div>
                    <span class="rounded bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border-color)]/50">{{ sceneCount }} Scenes · {{ plotCount }} Plots</span>
                </div>

                <div class="flex flex-col gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-2.5 shadow-sm">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 flex-1 text-[13px] font-medium leading-snug text-[var(--text-main)]">
                            {{ focusScene ? focusScene.title : "未选中 Scene" }}
                        </div>
                        <span v-if="focusScene" class="shrink-0 rounded-[4px] bg-[var(--bg-main)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-color)]">
                            {{ PLOT_SCENE_STATUS_LABELS[focusScene.status] }}
                        </span>
                    </div>
                    
                    <div class="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                        <span class="flex items-center gap-1 rounded bg-[var(--bg-main)] px-1.5 py-0.5 text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border-color)]/50">
                            <span class="i-lucide-book-open h-3 w-3 opacity-70"></span>
                            {{ focusScene?.chapterPath ? (chapterMap.get(focusScene.chapterPath)?.numberLabel ?? "未识别章节") : "未挂章" }}
                        </span>
                        <span class="flex items-center gap-1 rounded bg-[var(--bg-main)] px-1.5 py-0.5 text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border-color)]/50">
                            <span class="i-lucide-hash h-3 w-3 opacity-70"></span>
                            {{ focusScene ? `#${focusScene.threadSortOrder + 1}` : "未排序" }}
                        </span>
                    </div>
                    
                    <div v-if="focusScene?.purpose" class="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        {{ displayInlineText(focusScene.purpose) }}
                    </div>
                </div>
            </div>
        </section>

        <div class="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
            <span v-if="sceneCheckMessage" class="mr-auto inline-flex min-h-7 items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 text-[11px] leading-5 text-[var(--text-secondary)]">
                {{ sceneCheckMessage }}
            </span>
            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11.5px] font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)]" @click="createScene">
                <span class="i-lucide-plus h-3.5 w-3.5 opacity-70"></span>
                Scene
            </button>
            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 text-[11.5px] font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)]" @click="autoSortScenes">
                <span class="i-lucide-route h-3.5 w-3.5 text-blue-500/70"></span>
                自动排序
            </button>
            <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 text-[11.5px] font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)]" @click="checkSceneDependencies">
                <span class="i-lucide-list-checks h-3.5 w-3.5 text-emerald-500/70"></span>
                依赖检查
            </button>
        </div>

        <section class="mt-3">
            <DragDropProvider
                v-if="renderedScenes.length"
                :plugins="defaultPreset.plugins"
                :sensors="dndSensors"
                @drag-start="handleSceneDragStart"
                @drag-over="handleSceneDragOver"
                @drag-end="handleSceneDragEnd"
            >
                <div ref="sceneStackRef" class="space-y-2">
                    <PlotWorkbenchSortableSceneCard
                        v-for="(scene, index) in renderedScenes"
                        :key="scene.id"
                        :scene="scene"
                        :index="index"
                        :thread-id="props.thread?.id ?? 'thread-empty'"
                        :chapter="scene.chapterPath ? (chapterMap.get(scene.chapterPath) ?? null) : null"
                        :plot-count="renderedScenePlots(scene.id).length"
                        :expanded="isExpanded(scene.id)"
                        :can-move-up="index > 0"
                        :can-move-down="index < renderedScenes.length - 1"
                        @edit-scene="emit('editScene', $event)"
                        @move-scene="moveScene"
                        @toggle-scene="toggleScene"
                    >
                        <!-- 展开的 Plot 列表 -->
                        <div v-if="isExpanded(scene.id)" class="border-t border-[var(--border-color)]/60 bg-transparent px-4 pb-4 pt-3">
                            <div class="ml-[38px] rounded-lg bg-[var(--bg-main)]/70 px-3 py-3 shadow-inner ring-1 ring-inset ring-[var(--border-color)]/50">
                                <div class="mb-3 flex items-center justify-between">
                                    <div class="flex items-center gap-2">
                                        <span class="i-lucide-git-commit h-4 w-4 text-[var(--text-muted)]"></span>
                                        <div class="text-[12px] font-semibold text-[var(--text-main)]">Plots ({{ renderedScenePlots(scene.id).length }})</div>
                                    </div>
                                    <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)]/80 bg-[var(--bg-panel)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--border-color-hover)] hover:text-[var(--text-main)]">
                                        <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                        添加 Plot
                                    </button>
                                </div>
                                <DragDropProvider
                                    v-if="renderedScenePlots(scene.id).length"
                                    :plugins="defaultPreset.plugins"
                                    :sensors="dndSensors"
                                    @drag-start="handlePlotDragStart"
                                    @drag-over="handlePlotDragOver"
                                    @drag-end="handlePlotDragEnd"
                                >
                                    <div class="space-y-2">
                                        <PlotWorkbenchSortablePlotRow
                                            v-for="(plot, plotIndex) in renderedScenePlots(scene.id)"
                                            :key="plot.id"
                                            :plot="plot"
                                            :index="plotIndex"
                                            :scene-id="scene.id"
                                            :can-move-up="plotIndex > 0"
                                            :can-move-down="plotIndex < renderedScenePlots(scene.id).length - 1"
                                            @edit-plot="emit('editPlot', $event)"
                                            @delete-plot="emit('deletePlot', $event)"
                                            @move-plot="movePlot"
                                        />
                                    </div>
                                </DragDropProvider>
                            </div>
                        </div>
                    </PlotWorkbenchSortableSceneCard>
                </div>
            </DragDropProvider>

        </section>
    </main>
</template>

<style scoped>
.workbench-accent-icon {
    display: flex;
    height: 2.25rem;
    width: 2.25rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--accent-main) 58%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    color: color-mix(in srgb, var(--accent-main) 88%, #5f3300);
}

.workbench-main-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 42%, transparent);
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    padding: 0.125rem 0.5rem;
    font-size: 11px;
    font-weight: 600;
    color: color-mix(in srgb, var(--accent-main) 88%, #5f3300);
}

</style>
