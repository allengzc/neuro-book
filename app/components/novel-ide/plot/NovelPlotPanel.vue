<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {storeToRefs} from "pinia";
import Dialog from "nbook/app/components/common/Dialog.vue";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import PlotThreadDetailPanel from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadDetailPanel.vue";
import PlotThreadEditorDialog from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue";
import PlotThreadScenePanel from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadScenePanel.vue";
import PlotWorkbenchDialog from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    createPanelRefFromEffectiveRef,
    type PlotThreadEditorSave,
    type PlotThreadPanelChapter,
    type PlotThreadPanelDetail,
    type PlotThreadPanelPlot,
    type PlotThreadPanelRef,
    type PlotThreadPanelScene,
    type PlotThreadPanelThread,
    type PlotThreadQuickSceneUpdate,
    type PlotThreadTone,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {
    CreateStoryPlotRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    PlotTreeDto,
    PlotWorkbenchDto,
    ReorderStoryPlotsRequestDto,
    ReorderStoryScenesRequestDto,
    StoryPlotDto,
    StoryPlotWriteResponseDto,
    StoryRefDto,
    StorySceneDetailDto,
    StorySceneWriteResponseDto,
    StoryThreadDetailDto,
    StoryThreadTreeNodeDto,
    StoryThreadWriteResponseDto,
    UpdateStoryPlotRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";

const toneCycle: PlotThreadTone[] = ["amber", "sky", "emerald", "rose"];

const novelIdeStore = useNovelIdeStore();
const {
    currentNovelId,
    currentNovel,
    loadingWorkspace,
    plotWorkbenchOpen,
    workspaceTree,
    selectedStoryThreadId,
    selectedStorySceneId,
    plotRefreshVersion,
} = storeToRefs(novelIdeStore);

const threads = ref<PlotThreadPanelThread[]>([]);
const scenes = ref<PlotThreadPanelScene[]>([]);
const selectedThreadId = selectedStoryThreadId;
const selectedSceneId = selectedStorySceneId;
const treeError = ref("");
const detailError = ref("");
const detailDiagnostics = ref("");
const loadingTree = ref(false);
const loadingDetail = ref(false);
const savingQuickScene = ref(false);
const savingEditor = ref(false);
const reorderingScenes = ref(false);
const reorderingPlots = ref(false);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const deleteTarget = ref<{type: "thread" | "scene" | "plot"; id: string} | null>(null);
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editorTarget = ref<"thread" | "scene">("scene");
const editingThreadId = ref<string | null>(null);
const editingSceneId = ref<string | null>(null);
const threadDetailMap = ref<Record<string, StoryThreadDetailDto>>({});
const sceneDetailMap = ref<Record<string, StorySceneDetailDto>>({});
const plotWorkbenchData = ref<PlotWorkbenchDto | null>(null);
const detailPanelRef = ref<InstanceType<typeof PlotThreadDetailPanel> | null>(null);
const selectedPlotId = ref<string | null>(null);
const pinnedWorkbenchThreadIds = ref<string[]>([]);
const loadingWorkbench = ref(false);
const workbenchError = ref("");

let treeRequestVersion = 0;
let workbenchRequestVersion = 0;

/**
 * 当前章节列表，直接从 manuscript content-node 派生。
 */
const chapters = computed<PlotThreadPanelChapter[]>(() => {
    return workspaceTree.value
        .filter((node) => node.isDirectory && node.contentNode && node.entryType === "chapter" && normalizeChapterPath(node.path).startsWith("manuscript/"))
        .map((node, index) => ({
            id: normalizeChapterPath(node.path),
            volumeTitle: resolveVolumeTitle(node.path),
            numberLabel: buildChapterLabel(node.path, index),
            title: node.title || node.path.split("/").filter(Boolean).at(-1) || "未命名章节",
            summary: node.summary,
        }));
});

/**
 * 当前选中的 Thread。
 */
const selectedThread = computed(() => {
    return selectedThreadId.value
        ? (threads.value.find((thread) => thread.id === selectedThreadId.value) ?? null)
        : null;
});

/**
 * 当前选中的 Scene。
 */
const selectedScene = computed(() => {
    return selectedSceneId.value
        ? (scenes.value.find((scene) => scene.id === selectedSceneId.value) ?? null)
        : null;
});

/**
 * 当前编辑中的 Thread。
 */
const editingThread = computed(() => {
    return editingThreadId.value
        ? (threads.value.find((thread) => thread.id === editingThreadId.value) ?? null)
        : null;
});

/**
 * 当前编辑中的 Scene。
 */
const editingScene = computed(() => {
    return editingSceneId.value
        ? (scenes.value.find((scene) => scene.id === editingSceneId.value) ?? null)
        : null;
});

/**
 * 当前 Thread 下已缓存的 Plot，用于列表统计。
 */
const visiblePlots = computed<PlotThreadPanelPlot[]>(() => {
    if (!selectedThreadId.value) {
        return [];
    }

    return Object.values(sceneDetailMap.value)
        .filter((detail) => detail.threadId === selectedThreadId.value)
        .flatMap((detail) => detail.plots.map(mapPlotDto));
});

/**
 * 剧本工作台顶部展示的 Story 概要。
 */
const workbenchStory = computed(() => {
    const story = plotWorkbenchData.value?.story;
    return {
        id: story?.id ?? currentNovelId.value ?? "current-novel",
        title: story?.title ?? currentNovel.value?.title ?? "当前小说",
        summary: story?.summary ?? currentNovel.value?.summary ?? "",
    };
});

/**
 * 剧本工作台阶段数据。
 */
const workbenchPhases = computed(() => {
    const data = plotWorkbenchData.value;
    if (data) {
        const phases = data.phases.map((phase) => ({
            id: phase.id,
            title: phase.title,
            summary: phase.summary,
        }));
        return phases.length
            ? phases
            : [{
                id: "ungrouped",
                title: "未分阶段",
                summary: "",
            }];
    }

    const phaseIds = [...new Set(threads.value.map((thread) => thread.phaseId).filter((phaseId): phaseId is string => Boolean(phaseId)))];
    return phaseIds.length
        ? phaseIds.map((phaseId, index) => ({
            id: phaseId,
            title: `阶段 ${index + 1}`,
            summary: "",
        }))
        : [{
            id: "phase-current",
            title: "当前阶段",
            summary: "",
        }];
});

/**
 * 剧本工作台线程视图，优先来自聚合接口。
 */
const workbenchThreads = computed<PlotThreadPanelThread[]>(() => {
    const nodes = flattenWorkbenchThreads();
    if (!nodes.length) {
        return threads.value;
    }

    return nodes.map((item, index) => ({
        id: item.thread.id,
        phaseId: item.phaseId,
        title: item.thread.title,
        summary: item.thread.summary,
        status: item.thread.status,
        isMainThread: item.thread.isMainThread,
        tags: [...item.thread.tags],
        writingTip: item.thread.writingTip,
        tone: resolveThreadTone(index),
        refs: [],
    }));
});

/**
 * 剧本工作台 Scene 视图，优先来自聚合接口。
 */
const workbenchScenes = computed<PlotThreadPanelScene[]>(() => {
    const nodes = flattenWorkbenchThreads();
    if (!nodes.length) {
        return scenes.value;
    }

    return nodes.flatMap((item) => item.thread.scenes.map((scene) => ({
        id: scene.id,
        threadId: scene.threadId,
        chapterPath: scene.chapterPath,
        title: scene.title,
        summary: scene.summary,
        purpose: scene.purpose,
        status: scene.status,
        threadSortOrder: scene.threadSortOrder,
        chapterSortOrder: scene.chapterSortOrder,
        writingTip: scene.writingTip,
        refs: scene.refs.map((refItem, index) => mapStoryRefDto(refItem, `scene:${scene.id}:ref:${String(index)}`, "scene")),
    })));
});

/**
 * 剧本工作台 Plot 视图，优先来自聚合接口。
 */
const workbenchPlots = computed<PlotThreadPanelPlot[]>(() => {
    const nodes = flattenWorkbenchThreads();
    if (!nodes.length) {
        return Object.values(sceneDetailMap.value)
            .flatMap((detail) => detail.plots.map(mapPlotDto));
    }

    return nodes.flatMap((item) => item.thread.scenes.flatMap((scene) => scene.plots.map(mapPlotDto)));
});

/**
 * 当前编辑 Scene 的 refs。
 */
const editingSceneRefs = computed<PlotThreadPanelRef[]>(() => {
    const sceneId = editingSceneId.value;
    if (!sceneId) {
        return [];
    }

    return (sceneDetailMap.value[sceneId]?.refs ?? []).map((refItem, index) => ({
        id: `scene:${sceneId}:ref:${String(index)}`,
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
        source: "scene",
    }));
});

/**
 * 当前编辑 Scene 的 plots。
 */
const editingScenePlots = computed<PlotThreadPanelPlot[]>(() => {
    const sceneId = editingSceneId.value;
    if (!sceneId) {
        return [];
    }

    return (sceneDetailMap.value[sceneId]?.plots ?? [])
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(mapPlotDto);
});

/**
 * 当前 detail 面板所需数据。
 */
const currentDetail = computed<PlotThreadPanelDetail | null>(() => {
    const thread = selectedThread.value;
    const scene = selectedScene.value;
    if (!thread || !scene || scene.threadId !== thread.id) {
        return null;
    }

    const sceneDetail = sceneDetailMap.value[scene.id] ?? null;
    const chapter = scene.chapterPath
        ? (chapters.value.find((item) => item.id === scene.chapterPath) ?? null)
        : null;

    return {
        thread,
        scene,
        chapter,
        plots: (sceneDetail?.plots ?? []).map(mapPlotDto),
        effectiveRefs: sceneDetail
            ? sceneDetail.effectiveRefs.map(createPanelRefFromEffectiveRef)
            : [...thread.refs, ...scene.refs],
    };
});

/**
 * 删除确认文案。
 */
const deleteMessage = computed(() => {
    if (!deleteTarget.value) {
        return "";
    }

    if (deleteTarget.value.type === "thread") {
        const thread = threads.value.find((item) => item.id === deleteTarget.value?.id);
        return `确认删除「${thread?.title ?? "当前 Thread"}」吗？该 Thread 下的 Scene 和 Plot 会一起删除。`;
    }

    if (deleteTarget.value.type === "plot") {
        const plot = workbenchPlots.value.find((item) => item.id === deleteTarget.value?.id)
            ?? visiblePlots.value.find((item) => item.id === deleteTarget.value?.id);
        return `确认删除「${plot?.summary.slice(0, 40) || "当前 Plot"}」吗？`;
    }

    const scene = scenes.value.find((item) => item.id === deleteTarget.value?.id);
    return `确认删除「${scene?.title ?? "当前 Scene"}」吗？该 Scene 下的 Plot 会一起删除。`;
});

/**
 * 从错误对象提取适合展示的文案。
 * 这里使用 unknown 是因为 fetch / createError / 普通 Error 都可能进入 catch。
 */
function resolveErrorMessage(error: unknown, fallback: string): string {
    return resolveApiErrorMessage(error, fallback);
}

/**
 * 拼接写接口 diagnostics 文案。
 */
function formatDiagnosticsText(detail: {
    diagnostics?: {
        warnings: string[];
        notes: string[];
    };
}): string {
    return [
        ...(detail.diagnostics?.warnings ?? []),
        ...(detail.diagnostics?.notes ?? []),
    ].join("；");
}

/**
 * 规范化章节 content-node 目录路径。
 */
function normalizeChapterPath(path: string): string {
    const withoutIndex = path.replace(/\\/g, "/").replace(/\/index\.md$/i, "/");
    return withoutIndex.endsWith("/") ? withoutIndex : `${withoutIndex}/`;
}

/**
 * 从章节路径推导所属卷标题。
 */
function resolveVolumeTitle(path: string): string {
    const segments = normalizeChapterPath(path).split("/").filter(Boolean);
    return segments.at(-2) ?? "manuscript";
}

/**
 * 生成章节标签。
 */
function buildChapterLabel(path: string, fallbackIndex: number): string {
    const segments = normalizeChapterPath(path).split("/").filter(Boolean);
    const volumeToken = segments.at(-2) ?? "";
    const chapterToken = segments.at(-1) ?? "";
    const volumeNumber = volumeToken.match(/(\d+)/)?.[1] ?? "1";
    const chapterNumber = chapterToken.match(/(\d+)/)?.[1] ?? String(fallbackIndex + 1);
    return `第${volumeNumber}卷-${chapterNumber.padStart(2, "0")}章`;
}

/**
 * 根据顺序分配线程色板。
 */
function resolveThreadTone(index: number): PlotThreadTone {
    return toneCycle[index % toneCycle.length] ?? "amber";
}

/**
 * 把 Plot DTO 映射成面板 Plot。
 */
function mapPlotDto(plot: StoryPlotDto): PlotThreadPanelPlot {
    return {
        id: plot.id,
        sceneId: plot.sceneId,
        sortOrder: plot.sortOrder,
        kind: plot.kind,
        summary: plot.summary,
        effect: plot.effect,
        writingTip: plot.writingTip,
        note: plot.note,
    };
}

/**
 * 把接口 ref 映射成面板 ref。
 */
function mapStoryRefDto(refItem: StoryRefDto, id: string, source?: "thread" | "scene"): PlotThreadPanelRef {
    return {
        id,
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
        source,
    };
}

/**
 * 展开剧本工作台聚合 Thread。
 */
function flattenWorkbenchThreads(): Array<{
    phaseId: string | null;
    thread: PlotWorkbenchDto["phases"][number]["threads"][number];
}> {
    const data = plotWorkbenchData.value;
    if (!data) {
        return [];
    }

    return [
        ...data.phases.flatMap((phase) => phase.threads.map((thread) => ({
            phaseId: phase.id,
            thread,
        }))),
        ...data.ungroupedThreads.map((thread) => ({
            phaseId: null,
            thread,
        })),
    ];
}

/**
 * 把缓存里的 Scene refs 映射到面板模型。
 */
function mapSceneRefs(sceneId: string): PlotThreadPanelRef[] {
    return (sceneDetailMap.value[sceneId]?.refs ?? []).map((refItem, index) => (
        mapStoryRefDto(refItem, `scene:${sceneId}:ref:${String(index)}`, "scene")
    ));
}

/**
 * 生成 Thread slug。
 */
function createThreadName(title: string): string {
    const base = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "thread";
    return `${base}-${String(Date.now())}`;
}

/**
 * 去掉前端补充字段，转成接口 refs。
 */
function toStoryRefs(refs: PlotThreadPanelRef[]): StoryRefDto[] {
    return refs.map((refItem) => ({
        relation: refItem.relation,
        target: refItem.target,
        visibility: refItem.visibility,
        note: refItem.note,
    }));
}

/**
 * 用最新剧情树重建当前面板列表。
 */
function applyPlotTree(tree: PlotTreeDto): void {
    const threadNodes: Array<{phaseId: string | null; thread: StoryThreadTreeNodeDto}> = [
        ...tree.phases.flatMap((phase) => phase.threads.map((thread) => ({
            phaseId: phase.id,
            thread,
        }))),
        ...tree.ungroupedThreads.map((thread) => ({
            phaseId: null,
            thread,
        })),
    ];

    threads.value = threadNodes.map((item, index) => ({
        id: item.thread.id,
        phaseId: item.phaseId,
        title: item.thread.title,
        summary: item.thread.summary,
        status: item.thread.status,
        isMainThread: item.thread.isMainThread,
        tags: [...item.thread.tags],
        writingTip: item.thread.writingTip,
        tone: resolveThreadTone(index),
        refs: [],
    }));

    scenes.value = threadNodes.flatMap((item) => item.thread.scenes.map((scene) => ({
        id: scene.id,
        threadId: scene.threadId,
        chapterPath: scene.chapterPath,
        title: scene.title,
        summary: scene.summary,
        purpose: scene.purpose,
        status: scene.status,
        threadSortOrder: scene.threadSortOrder,
        chapterSortOrder: scene.chapterSortOrder,
        writingTip: scene.writingTip,
        refs: mapSceneRefs(scene.id),
    })));
}

/**
 * 根据当前列表修正选中态。
 */
function syncSelection(options: {
    preferredThreadId?: string | null;
    preferredSceneId?: string | null;
} = {}): void {
    const nextThreadId = (
        options.preferredThreadId
        && threads.value.some((thread) => thread.id === options.preferredThreadId)
    )
        ? options.preferredThreadId
        : (
            selectedThreadId.value
            && threads.value.some((thread) => thread.id === selectedThreadId.value)
                ? selectedThreadId.value
                : (threads.value[0]?.id ?? null)
        );
    selectedThreadId.value = nextThreadId;

    const threadScenes = scenes.value
        .filter((scene) => scene.threadId === nextThreadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder);
    const nextSceneId = (
        options.preferredSceneId
        && threadScenes.some((scene) => scene.id === options.preferredSceneId)
    )
        ? options.preferredSceneId
        : (
            selectedSceneId.value
            && threadScenes.some((scene) => scene.id === selectedSceneId.value)
                ? selectedSceneId.value
                : (threadScenes[0]?.id ?? null)
        );
    selectedSceneId.value = nextSceneId;
}

/**
 * 把 Thread 详情写回缓存和列表。
 */
function applyThreadDetail(detail: StoryThreadDetailDto): void {
    threadDetailMap.value = {
        ...threadDetailMap.value,
        [detail.id]: detail,
    };

    threads.value = threads.value.map((thread) => thread.id === detail.id
        ? {
            ...thread,
            title: detail.title,
            summary: detail.summary,
            status: detail.status,
            isMainThread: detail.isMainThread,
            tags: [...detail.tags],
            writingTip: detail.writingTip,
            refs: [],
        }
        : thread);
}

/**
 * 把 Scene 详情写回缓存和列表。
 */
function applySceneDetail(detail: StorySceneDetailDto): void {
    sceneDetailMap.value = {
        ...sceneDetailMap.value,
        [detail.id]: detail,
    };

    scenes.value = scenes.value.map((scene) => scene.id === detail.id
        ? {
            ...scene,
            threadId: detail.threadId,
            chapterPath: detail.chapterPath,
            title: detail.title,
            summary: detail.summary,
            purpose: detail.purpose,
            status: detail.status,
            threadSortOrder: detail.threadSortOrder,
            chapterSortOrder: detail.chapterSortOrder,
            writingTip: detail.writingTip,
            refs: mapSceneRefs(detail.id),
        }
        : scene);
}

/**
 * 拉取剧情树，并刷新当前单 Thread 面板。
 */
async function loadPlotTree(options: {
    preferredThreadId?: string | null;
    preferredSceneId?: string | null;
} = {}): Promise<void> {
    if (!currentNovelId.value) {
        threads.value = [];
        scenes.value = [];
        selectedThreadId.value = null;
        selectedSceneId.value = null;
        treeError.value = "";
        return;
    }

    const requestVersion = ++treeRequestVersion;
    loadingTree.value = true;
    treeError.value = "";

    try {
        const response = await $fetch<PlotTreeDto>(`/api/novels/${currentNovelId.value}/plot/tree`);
        if (requestVersion !== treeRequestVersion) {
            return;
        }

        applyPlotTree(response);
        syncSelection(options);

        if (selectedThreadId.value) {
            void ensureThreadDetail(selectedThreadId.value);
            void preloadThreadScenes(selectedThreadId.value);
        }

        if (selectedSceneId.value) {
            void ensureSceneDetail(selectedSceneId.value);
        }
    } catch (error) {
        if (requestVersion !== treeRequestVersion) {
            return;
        }
        treeError.value = resolveErrorMessage(error, "加载剧情树失败");
    } finally {
        if (requestVersion === treeRequestVersion) {
            loadingTree.value = false;
        }
    }
}

/**
 * 拉取剧本工作台聚合数据。
 */
async function loadPlotWorkbench(force = false): Promise<void> {
    if (!currentNovelId.value) {
        plotWorkbenchData.value = null;
        workbenchError.value = "";
        return;
    }

    if (!force && plotWorkbenchData.value) {
        return;
    }

    const requestVersion = ++workbenchRequestVersion;
    loadingWorkbench.value = true;
    workbenchError.value = "";

    try {
        const response = await $fetch<PlotWorkbenchDto>(`/api/novels/${currentNovelId.value}/plot/workbench`);
        if (requestVersion !== workbenchRequestVersion) {
            return;
        }

        plotWorkbenchData.value = response;
    } catch (error) {
        if (requestVersion !== workbenchRequestVersion) {
            return;
        }
        workbenchError.value = resolveErrorMessage(error, "加载剧本工作台失败");
    } finally {
        if (requestVersion === workbenchRequestVersion) {
            loadingWorkbench.value = false;
        }
    }
}

/**
 * 确保 Thread 详情已加载。
 */
async function ensureThreadDetail(threadId: string, force = false): Promise<void> {
    if (!currentNovelId.value || (!force && threadDetailMap.value[threadId])) {
        return;
    }

    try {
        const detail = await $fetch<StoryThreadDetailDto>(`/api/novels/${currentNovelId.value}/plot/threads/${threadId}`);
        applyThreadDetail(detail);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "加载 Thread 详情失败");
    }
}

/**
 * 确保 Scene 详情已加载。
 */
async function ensureSceneDetail(sceneId: string, force = false): Promise<void> {
    if (!currentNovelId.value || (!force && sceneDetailMap.value[sceneId])) {
        return;
    }

    loadingDetail.value = true;
    detailError.value = "";

    try {
        const detail = await $fetch<StorySceneDetailDto>(`/api/novels/${currentNovelId.value}/plot/scenes/${sceneId}`);
        applySceneDetail(detail);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "加载 Scene 详情失败");
    } finally {
        loadingDetail.value = false;
    }
}

/**
 * 为当前 Thread 预加载所有 Scene 详情，用来补齐 Plot 统计。
 */
async function preloadThreadScenes(threadId: string): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    const missingSceneIds = scenes.value
        .filter((scene) => scene.threadId === threadId)
        .map((scene) => scene.id)
        .filter((sceneId) => !sceneDetailMap.value[sceneId]);

    if (!missingSceneIds.length) {
        return;
    }

    try {
        const details = await Promise.all(missingSceneIds.map((sceneId) => (
            $fetch<StorySceneDetailDto>(`/api/novels/${currentNovelId.value}/plot/scenes/${sceneId}`)
        )));

        for (const detail of details) {
            applySceneDetail(detail);
        }
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "预加载 Scene 详情失败");
    }
}

/**
 * 选中 Thread，并切到它的第一个 Scene。
 */
function selectThread(threadId: string): void {
    selectedThreadId.value = threadId;
    const nextScene = scenes.value
        .filter((scene) => scene.threadId === threadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0] ?? null;
    selectedSceneId.value = nextScene?.id ?? null;
    selectedPlotId.value = null;
    detailError.value = "";

    void ensureThreadDetail(threadId);
    void preloadThreadScenes(threadId);

    if (nextScene) {
        void ensureSceneDetail(nextScene.id);
    }
}

/**
 * 切换 Thread 前先提交 detail 草稿。
 */
async function selectThreadFromPanel(threadId: string): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    selectThread(threadId);
}

/**
 * 选中 Scene，并同步所属 Thread。
 */
function selectScene(sceneId: string): void {
    const scene = scenes.value.find((item) => item.id === sceneId) ?? null;
    if (!scene) {
        return;
    }

    selectedThreadId.value = scene.threadId;
    selectedSceneId.value = scene.id;
    selectedPlotId.value = null;
    detailError.value = "";

    void ensureThreadDetail(scene.threadId);
    void preloadThreadScenes(scene.threadId);
    void ensureSceneDetail(scene.id);
}

/**
 * 选中 Plot，并同步所属 Scene。
 */
function selectPlot(plotId: string): void {
    const plot = visiblePlots.value.find((item) => item.id === plotId)
        ?? Object.values(sceneDetailMap.value).flatMap((detail) => detail.plots.map(mapPlotDto)).find((item) => item.id === plotId)
        ?? null;
    if (!plot) {
        return;
    }

    selectedPlotId.value = plot.id;
    selectScene(plot.sceneId);
    selectedPlotId.value = plot.id;
}

/**
 * 切换 Scene 前先提交 detail 草稿。
 */
async function selectSceneFromPanel(sceneId: string): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    selectScene(sceneId);
}

/**
 * 收起底部 detail 面板。
 */
async function closeDetailPanel(): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    selectedSceneId.value = null;
    detailError.value = "";
}

/**
 * 强制提交 detail 面板里的 Scene 草稿。
 */
async function flushDetailPanel(): Promise<boolean> {
    if (!detailPanelRef.value) {
        return true;
    }

    return detailPanelRef.value.flushNow(quickUpdateScene);
}

/**
 * 打开上下文菜单。
 */
function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = items;
    contextMenuVisible.value = true;
}

/**
 * 关闭上下文菜单。
 */
function closeContextMenu(): void {
    contextMenuVisible.value = false;
}

/**
 * 打开 Thread 编辑器。
 */
function openThreadEditor(mode: "create" | "edit"): void {
    editorMode.value = mode;
    editorTarget.value = "thread";
    editingThreadId.value = mode === "edit" ? selectedThreadId.value : null;
    editingSceneId.value = null;
    editorVisible.value = true;
}

/**
 * 打开 Scene 编辑器。
 */
async function openSceneEditor(mode: "create" | "edit", sceneId?: string): Promise<void> {
    if (!selectedThreadId.value) {
        openThreadEditor("create");
        return;
    }

    editorMode.value = mode;
    editorTarget.value = "scene";
    editingThreadId.value = selectedThreadId.value;
    editingSceneId.value = mode === "edit" ? (sceneId ?? selectedSceneId.value) : null;

    if (editingSceneId.value) {
        await ensureSceneDetail(editingSceneId.value);
    }

    editorVisible.value = true;
}

/**
 * 从 detail 面板进入完整编辑器。
 */
async function openSceneEditorFromDetail(): Promise<void> {
    if (!(await flushDetailPanel())) {
        return;
    }

    await openSceneEditor("edit", selectedSceneId.value ?? undefined);
}

/**
 * 打开 Thread 菜单。
 */
function openThreadMenu(event: MouseEvent): void {
    openContextMenu(event, [
        {
            label: "新建 Thread",
            iconClass: "i-lucide-folder-plus",
            action: () => openThreadEditor("create"),
        },
        {
            label: "编辑当前 Thread",
            iconClass: "i-lucide-pencil-line",
            disabled: !selectedThread.value,
            action: () => openThreadEditor("edit"),
        },
        {
            label: "新建 Scene",
            iconClass: "i-lucide-clapperboard",
            disabled: !selectedThread.value,
            action: () => {
                void openSceneEditor("create");
            },
        },
        {separator: true},
        {
            label: "删除当前 Thread",
            iconClass: "i-lucide-trash-2",
            danger: true,
            disabled: !selectedThread.value,
            action: () => queueDelete("thread", selectedThreadId.value),
        },
    ]);
}

/**
 * 打开 Scene 菜单。
 */
function openSceneMenu(payload: {sceneId: string; event: MouseEvent}): void {
    const scene = scenes.value.find((item) => item.id === payload.sceneId) ?? null;
    if (!scene) {
        return;
    }

    openContextMenu(payload.event, [
        {
            label: "选中 Scene",
            iconClass: "i-lucide-crosshair",
            action: () => selectScene(scene.id),
        },
        {
            label: "新建 Scene",
            iconClass: "i-lucide-plus",
            action: () => {
                selectThread(scene.threadId);
                void openSceneEditor("create");
            },
        },
        {
            label: "编辑 Scene",
            iconClass: "i-lucide-pencil-line",
            action: () => {
                selectScene(scene.id);
                void openSceneEditor("edit", scene.id);
            },
        },
        {separator: true},
        {
            label: "删除 Scene",
            iconClass: "i-lucide-trash-2",
            danger: true,
            action: () => queueDelete("scene", scene.id),
        },
    ]);
}

/**
 * 打开空白区菜单。
 */
function openRootMenu(event: MouseEvent): void {
    openContextMenu(event, [
        {
            label: "新建 Thread",
            iconClass: "i-lucide-folder-plus",
            action: () => openThreadEditor("create"),
        },
        {
            label: "新建 Scene",
            iconClass: "i-lucide-clapperboard",
            disabled: !selectedThread.value,
            action: () => {
                void openSceneEditor("create");
            },
        },
        {separator: true},
        {
            label: "刷新剧情树",
            iconClass: "i-lucide-refresh-cw",
            action: () => {
                void loadPlotTree({
                    preferredThreadId: selectedThreadId.value,
                    preferredSceneId: selectedSceneId.value,
                });
            },
        },
    ]);
}

/**
 * 缓存待删除对象。
 */
function queueDelete(type: "thread" | "scene" | "plot", id: string | null): void {
    if (!id) {
        return;
    }

    closeContextMenu();
    deleteTarget.value = {type, id};
}

/**
 * 切换剧本工作台里的 Thread pin 状态。
 */
function toggleWorkbenchThreadPin(threadId: string): void {
    pinnedWorkbenchThreadIds.value = pinnedWorkbenchThreadIds.value.includes(threadId)
        ? pinnedWorkbenchThreadIds.value.filter((id) => id !== threadId)
        : [threadId, ...pinnedWorkbenchThreadIds.value];
}

/**
 * 快速更新 Thread 字段。
 */
async function updateWorkbenchThread(threadId: string, patch: Partial<PlotThreadPanelThread>): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    try {
        const updated = await $fetch<StoryThreadWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/threads/${threadId}`, {
            method: "PATCH",
            body: {
                title: patch.title,
                isMainThread: patch.isMainThread,
                status: patch.status,
                summary: patch.summary,
                tags: patch.tags,
                writingTip: patch.writingTip,
            } satisfies UpdateStoryThreadRequestDto,
        });
        detailDiagnostics.value = formatDiagnosticsText(updated);
        applyThreadDetail(updated);
        await loadPlotWorkbench(true);
    } catch (error) {
        treeError.value = resolveErrorMessage(error, "保存 Thread 失败");
    }
}

/**
 * 快速更新 Scene 字段。
 */
async function updateWorkbenchScene(sceneId: string, patch: Partial<PlotThreadPanelScene>): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    try {
        const updated = await $fetch<StorySceneWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/scenes/${sceneId}`, {
            method: "PATCH",
            body: {
                threadId: patch.threadId,
                chapterPath: patch.chapterPath,
                title: patch.title,
                status: patch.status,
                summary: patch.summary,
                purpose: patch.purpose,
                writingTip: patch.writingTip,
                refs: patch.refs ? toStoryRefs(patch.refs) : undefined,
            } satisfies UpdateStorySceneRequestDto,
        });
        detailDiagnostics.value = formatDiagnosticsText(updated);
        applySceneDetail(updated);
        await loadPlotWorkbench(true);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "保存 Scene 失败");
    }
}

/**
 * 快速更新 Plot 字段。
 */
async function updateWorkbenchPlot(plotId: string, patch: Partial<PlotThreadPanelPlot>): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    try {
        const updated = await $fetch<StoryPlotWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/plots/${plotId}`, {
            method: "PATCH",
            body: {
                sceneId: patch.sceneId,
                kind: patch.kind,
                summary: patch.summary,
                effect: patch.effect,
                writingTip: patch.writingTip,
                note: patch.note,
            } satisfies UpdateStoryPlotRequestDto,
        });
        detailDiagnostics.value = formatDiagnosticsText(updated);
        const sceneId = updated.sceneId;
        if (sceneId) {
            await ensureSceneDetail(sceneId, true);
        }
        await loadPlotWorkbench(true);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "保存 Plot 失败");
    }
}

/**
 * 快速保存当前 Scene 常用字段。
 */
async function quickUpdateScene(payload: PlotThreadQuickSceneUpdate): Promise<void> {
    if (!currentNovelId.value || savingQuickScene.value) {
        return;
    }

    savingQuickScene.value = true;
    detailError.value = "";

    try {
        const detail = await $fetch<StorySceneDetailDto>(`/api/novels/${currentNovelId.value}/plot/scenes/${payload.sceneId}`, {
            method: "PATCH",
            body: {
                title: payload.title,
                summary: payload.summary,
                purpose: payload.purpose,
                writingTip: payload.writingTip,
                status: payload.status,
                chapterPath: payload.chapterPath,
            } satisfies UpdateStorySceneRequestDto,
        });

        applySceneDetail(detail);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "保存 Scene 详情失败");
    } finally {
        savingQuickScene.value = false;
    }
}

/**
 * 保存 Thread 编辑结果。
 */
async function saveThread(payload: PlotThreadEditorSave): Promise<void> {
    if (!currentNovelId.value || payload.target !== "thread" || savingEditor.value) {
        return;
    }

    savingEditor.value = true;
    treeError.value = "";
    detailDiagnostics.value = "";

    try {
        if (editorMode.value === "create") {
            const created = await $fetch<StoryThreadWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/threads`, {
                method: "POST",
                body: {
                    storyPhaseId: selectedThread.value?.phaseId ?? null,
                    name: createThreadName(payload.title),
                    title: payload.title,
                    isMainThread: payload.isMainThread,
                    status: payload.status,
                    summary: payload.summary,
                    tags: payload.tags,
                    writingTip: payload.writingTip,
                } satisfies CreateStoryThreadRequestDto,
            });
            detailDiagnostics.value = formatDiagnosticsText(created);

            applyThreadDetail(created);
            await loadPlotTree({
                preferredThreadId: created.id,
            });
            await loadPlotWorkbench(true);
            return;
        }

        if (!editingThreadId.value) {
            return;
        }

        const updated = await $fetch<StoryThreadWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/threads/${editingThreadId.value}`, {
            method: "PATCH",
            body: {
                title: payload.title,
                isMainThread: payload.isMainThread,
                status: payload.status,
                summary: payload.summary,
                tags: payload.tags,
                writingTip: payload.writingTip,
            } satisfies UpdateStoryThreadRequestDto,
        });
        detailDiagnostics.value = formatDiagnosticsText(updated);

        applyThreadDetail(updated);
        await loadPlotTree({
            preferredThreadId: updated.id,
            preferredSceneId: selectedSceneId.value,
        });
        await loadPlotWorkbench(true);
    } catch (error) {
        treeError.value = resolveErrorMessage(error, "保存 Thread 失败");
        throw error;
    } finally {
        savingEditor.value = false;
    }
}

/**
 * 保存 Scene 和它下属的 Plot。
 */
async function saveScene(payload: PlotThreadEditorSave): Promise<void> {
    if (!currentNovelId.value || payload.target !== "scene" || savingEditor.value || !selectedThreadId.value) {
        return;
    }

    savingEditor.value = true;
    detailError.value = "";
    detailDiagnostics.value = "";

    try {
        let sceneId = editingSceneId.value;

        if (editorMode.value === "create") {
            const createdScene = await $fetch<StorySceneWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/scenes`, {
                method: "POST",
                body: {
                    threadId: selectedThreadId.value,
                    chapterPath: payload.chapterPath,
                    title: payload.title,
                    status: payload.status,
                    summary: payload.summary,
                    purpose: payload.purpose,
                    writingTip: payload.writingTip,
                    refs: toStoryRefs(payload.refs),
                } satisfies CreateStorySceneRequestDto,
            });
            detailDiagnostics.value = formatDiagnosticsText(createdScene);

            sceneId = createdScene.id;
            applySceneDetail(createdScene);

            const createdPlots: StoryPlotDto[] = [];
            for (const plot of payload.plots) {
                const createdPlot = await $fetch<StoryPlotWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/plots`, {
                    method: "POST",
                    body: {
                        sceneId: createdScene.id,
                        kind: plot.kind,
                        summary: plot.summary,
                        effect: plot.effect,
                        writingTip: plot.writingTip,
                    } satisfies CreateStoryPlotRequestDto,
                });
                detailDiagnostics.value = [detailDiagnostics.value, formatDiagnosticsText(createdPlot)].filter(Boolean).join("；");
                createdPlots.push(createdPlot);
            }

            if (createdPlots.length) {
                await $fetch(`/api/novels/${currentNovelId.value}/plot/plots/reorder`, {
                    method: "POST",
                    body: {
                        items: createdPlots.map((plot, index) => ({
                            plotId: plot.id,
                            sceneId: createdScene.id,
                            sortOrder: index,
                        })),
                    } satisfies ReorderStoryPlotsRequestDto,
                });
            }
        } else if (sceneId) {
            const updatedScene = await $fetch<StorySceneWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/scenes/${sceneId}`, {
                method: "PATCH",
                body: {
                    threadId: selectedThreadId.value,
                    chapterPath: payload.chapterPath,
                    title: payload.title,
                    status: payload.status,
                    summary: payload.summary,
                    purpose: payload.purpose,
                    writingTip: payload.writingTip,
                    refs: toStoryRefs(payload.refs),
                } satisfies UpdateStorySceneRequestDto,
            });
            detailDiagnostics.value = formatDiagnosticsText(updatedScene);
            applySceneDetail(updatedScene);

            const existingPlots = new Map((sceneDetailMap.value[sceneId]?.plots ?? []).map((plot) => [plot.id, plot]));
            const nextPlotIds = new Set(payload.plots.map((plot) => plot.id));

            for (const plot of existingPlots.values()) {
                if (!nextPlotIds.has(plot.id)) {
                    await $fetch(`/api/novels/${currentNovelId.value}/plot/plots/${plot.id}`, {
                        method: "DELETE",
                    });
                }
            }

            const orderedIds: string[] = [];
            for (const plot of payload.plots) {
                if (existingPlots.has(plot.id)) {
                    const updatedPlot = await $fetch<StoryPlotWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/plots/${plot.id}`, {
                        method: "PATCH",
                        body: {
                            kind: plot.kind,
                            summary: plot.summary,
                            effect: plot.effect,
                            writingTip: plot.writingTip,
                        } satisfies UpdateStoryPlotRequestDto,
                    });
                    detailDiagnostics.value = [detailDiagnostics.value, formatDiagnosticsText(updatedPlot)].filter(Boolean).join("；");
                    orderedIds.push(updatedPlot.id);
                    continue;
                }

                const createdPlot = await $fetch<StoryPlotWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/plots`, {
                    method: "POST",
                    body: {
                        sceneId: sceneId!,
                        kind: plot.kind,
                        summary: plot.summary,
                        effect: plot.effect,
                        writingTip: plot.writingTip,
                    } satisfies CreateStoryPlotRequestDto,
                });
                detailDiagnostics.value = [detailDiagnostics.value, formatDiagnosticsText(createdPlot)].filter(Boolean).join("；");
                orderedIds.push(createdPlot.id);
            }

            if (orderedIds.length) {
                await $fetch(`/api/novels/${currentNovelId.value}/plot/plots/reorder`, {
                    method: "POST",
                    body: {
                        items: orderedIds.map((plotId, index) => ({
                            plotId,
                            sceneId: sceneId!,
                            sortOrder: index,
                        })),
                    } satisfies ReorderStoryPlotsRequestDto,
                });
            }
        }

        await loadPlotTree({
            preferredThreadId: selectedThreadId.value,
            preferredSceneId: sceneId,
        });
        await loadPlotWorkbench(true);

        if (sceneId) {
            await ensureSceneDetail(sceneId, true);
        }
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "保存 Scene 失败");
        throw error;
    } finally {
        savingEditor.value = false;
    }
}

/**
 * 统一处理编辑器保存。
 */
async function handleEditorSave(payload: PlotThreadEditorSave): Promise<void> {
    if (payload.target === "thread") {
        await saveThread(payload);
        editorVisible.value = false;
        return;
    }

    await saveScene(payload);
    editorVisible.value = false;
}

/**
 * 删除 Thread。
 */
async function deleteThread(threadId: string): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    await $fetch(`/api/novels/${currentNovelId.value}/plot/threads/${threadId}`, {
        method: "DELETE",
    });

    delete threadDetailMap.value[threadId];
    await loadPlotTree();
    await loadPlotWorkbench(true);
}

/**
 * 删除 Scene。
 */
async function deleteScene(sceneId: string): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    const fallbackThreadId = scenes.value.find((scene) => scene.id === sceneId)?.threadId ?? selectedThreadId.value;
    await $fetch(`/api/novels/${currentNovelId.value}/plot/scenes/${sceneId}`, {
        method: "DELETE",
    });

    delete sceneDetailMap.value[sceneId];
    await loadPlotTree({
        preferredThreadId: fallbackThreadId,
    });
    await loadPlotWorkbench(true);
}

/**
 * 删除 Plot。
 */
async function deletePlot(plotId: string): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    const fallbackSceneId = workbenchPlots.value.find((plot) => plot.id === plotId)?.sceneId
        ?? visiblePlots.value.find((plot) => plot.id === plotId)?.sceneId
        ?? selectedSceneId.value;
    await $fetch(`/api/novels/${currentNovelId.value}/plot/plots/${plotId}`, {
        method: "DELETE",
    });

    if (selectedPlotId.value === plotId) {
        selectedPlotId.value = null;
    }
    if (fallbackSceneId) {
        await ensureSceneDetail(fallbackSceneId, true);
    }
    await loadPlotWorkbench(true);
}

/**
 * 在指定 Scene 下创建一个 Plot 草稿。
 */
async function createWorkbenchPlot(sceneId: string): Promise<void> {
    if (!currentNovelId.value) {
        return;
    }

    try {
        const created = await $fetch<StoryPlotWriteResponseDto>(`/api/novels/${currentNovelId.value}/plot/plots`, {
            method: "POST",
            body: {
                sceneId,
                kind: "setup",
                summary: "新建 Plot：记录这个情节点的动作、信息或转折。",
                effect: null,
                writingTip: null,
            } satisfies CreateStoryPlotRequestDto,
        });
        detailDiagnostics.value = formatDiagnosticsText(created);
        selectedPlotId.value = created.id;
        selectScene(sceneId);
        selectedPlotId.value = created.id;
        await ensureSceneDetail(sceneId, true);
        await loadPlotWorkbench(true);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "创建 Plot 失败");
    }
}

/**
 * 确认删除当前对象。
 */
async function confirmDelete(): Promise<void> {
    if (!deleteTarget.value) {
        return;
    }

    const target = deleteTarget.value;
    deleteTarget.value = null;

    try {
        if (target.type === "thread") {
            await deleteThread(target.id);
            return;
        }

        if (target.type === "plot") {
            await deletePlot(target.id);
            return;
        }

        await deleteScene(target.id);
    } catch (error) {
        treeError.value = resolveErrorMessage(error, "删除剧情对象失败");
    }
}

/**
 * 保存 Scene 内的 Plot 排序。
 */
async function reorderPlots(payload: {sceneId: string; plotIds: string[]}): Promise<void> {
    if (!currentNovelId.value || reorderingPlots.value) {
        return;
    }

    reorderingPlots.value = true;
    detailError.value = "";

    try {
        await $fetch(`/api/novels/${currentNovelId.value}/plot/plots/reorder`, {
            method: "POST",
            body: {
                items: payload.plotIds.map((plotId, index) => ({
                    plotId,
                    sceneId: payload.sceneId,
                    sortOrder: index,
                })),
            } satisfies ReorderStoryPlotsRequestDto,
        });

        await ensureSceneDetail(payload.sceneId, true);
        await loadPlotWorkbench(true);
    } catch (error) {
        detailError.value = resolveErrorMessage(error, "保存 Plot 顺序失败");
    } finally {
        reorderingPlots.value = false;
    }
}

/**
 * 保存当前 Thread 下的 Scene 排序。
 */
async function reorderScenes(sceneIds: string[]): Promise<void> {
    if (!currentNovelId.value || !selectedThreadId.value || reorderingScenes.value) {
        return;
    }

    const sceneMap = new Map(scenes.value.map((scene) => [scene.id, scene]));
    const items = sceneIds.map((sceneId, index) => {
        const scene = sceneMap.get(sceneId);
        if (!scene) {
            throw new Error(`缺少待重排 Scene: ${sceneId}`);
        }

        return {
            sceneId,
            threadId: scene.threadId,
            chapterPath: scene.chapterPath,
            threadSortOrder: index,
            chapterSortOrder: scene.chapterSortOrder,
        };
    });

    reorderingScenes.value = true;
    treeError.value = "";

    try {
        await $fetch(`/api/novels/${currentNovelId.value}/plot/scenes/reorder`, {
            method: "POST",
            body: {
                items,
            } satisfies ReorderStoryScenesRequestDto,
        });

        await loadPlotTree({
            preferredThreadId: selectedThreadId.value,
            preferredSceneId: selectedSceneId.value,
        });
        await loadPlotWorkbench(true);
    } catch (error) {
        treeError.value = resolveErrorMessage(error, "保存 Scene 顺序失败");
    } finally {
        reorderingScenes.value = false;
    }
}

watch(() => ({
    novelId: currentNovelId.value,
    workspaceLoading: loadingWorkspace.value,
}), async ({novelId, workspaceLoading}) => {
    closeContextMenu();
    deleteTarget.value = null;
    editorVisible.value = false;
    plotWorkbenchOpen.value = false;
    selectedPlotId.value = null;
    treeError.value = "";
    detailError.value = "";
    detailDiagnostics.value = "";
    threadDetailMap.value = {};
    sceneDetailMap.value = {};
    plotWorkbenchData.value = null;
    workbenchError.value = "";

    if (workspaceLoading || !novelId) {
        threads.value = [];
        scenes.value = [];
        selectedThreadId.value = null;
        selectedSceneId.value = null;
        return;
    }

    await loadPlotTree();
}, {immediate: true});

watch(plotWorkbenchOpen, (open) => {
    if (open) {
        void loadPlotWorkbench();
    }
});

watch(plotRefreshVersion, async (version, previousVersion) => {
    if (!version || version === previousVersion || loadingWorkspace.value || !currentNovelId.value) {
        return;
    }

    await loadPlotTree({
        preferredThreadId: selectedThreadId.value,
        preferredSceneId: selectedSceneId.value,
    });
    await loadPlotWorkbench(true);
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 错误提示 -->
        <div v-if="treeError" class="border-b border-rose-500/20 bg-rose-500/8 px-3 py-2 text-[11px] text-rose-700">
            <div class="flex items-center justify-between gap-3">
                <span>{{ treeError }}</span>
                <button
                    type="button"
                    class="rounded-md border border-rose-500/20 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-rose-700 transition-colors hover:bg-rose-500/10"
                    @click="loadPlotTree({
                        preferredThreadId: selectedThreadId,
                        preferredSceneId: selectedSceneId,
                    })"
                >
                    重试
                </button>
            </div>
        </div>

        <!-- 剧情面板主体 -->
        <div class="relative flex min-h-0 flex-1 flex-col bg-[var(--bg-panel)]">
            <div
                v-if="loadingTree && threads.length === 0"
                class="flex min-h-0 flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]"
            >
                正在加载剧情面板...
            </div>

            <template v-else>
                <PlotThreadScenePanel
                    :threads="threads"
                    :scenes="scenes"
                    :chapters="chapters"
                    :plots="visiblePlots"
                    :selected-thread-id="selectedThreadId"
                    :selected-scene-id="selectedSceneId"
                    @select-thread="selectThreadFromPanel"
                    @select-scene="selectSceneFromPanel"
                    @create-scene="openSceneEditor('create')"
                    @edit-thread="openThreadEditor('edit')"
                    @edit-scene="openSceneEditor('edit', $event)"
                    @open-thread-menu="openThreadMenu"
                    @open-scene-menu="openSceneMenu"
                    @open-root-menu="openRootMenu"
                    @reorder-scenes="reorderScenes"
                />

                <PlotThreadDetailPanel
                    ref="detailPanelRef"
                    :chapters="chapters"
                    :detail="currentDetail"
                    :diagnostics="detailDiagnostics"
                    @close="closeDetailPanel"
                    @edit="openSceneEditorFromDetail"
                    @update-scene="quickUpdateScene"
                />
            </template>
        </div>

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="closeContextMenu"
        />

        <PlotThreadEditorDialog
            :visible="editorVisible"
            :target="editorTarget"
            :mode="editorMode"
            :thread="editingThread"
            :scene="editingScene"
            :chapters="chapters"
            :scene-refs="editingSceneRefs"
            :scene-plots="editingScenePlots"
            :saving="savingEditor"
            :error="detailError"
            @update:visible="editorVisible = $event"
            @save="handleEditorSave"
        />

        <PlotWorkbenchDialog
            v-model="plotWorkbenchOpen"
            :story="workbenchStory"
            :phases="workbenchPhases"
            :threads="workbenchThreads"
            :scenes="workbenchScenes"
            :plots="workbenchPlots"
            :chapters="chapters"
            :selected-thread-id="selectedThreadId"
            :selected-scene-id="selectedSceneId"
            :selected-plot-id="selectedPlotId"
            :pinned-thread-ids="pinnedWorkbenchThreadIds"
            :loading="loadingWorkbench"
            :error="workbenchError"
            @select-thread="selectThread"
            @select-scene="selectScene"
            @select-plot="selectPlot"
            @create-thread="openThreadEditor('create')"
            @toggle-thread-pin="toggleWorkbenchThreadPin"
            @toggle-thread-main="(threadId) => void updateWorkbenchThread(threadId, {isMainThread: !threads.find((thread) => thread.id === threadId)?.isMainThread})"
            @delete-thread="queueDelete('thread', $event)"
            @create-scene="(threadId) => { selectThread(threadId); void openSceneEditor('create'); }"
            @create-plot="(sceneId) => void createWorkbenchPlot(sceneId)"
            @delete-plot="queueDelete('plot', $event)"
            @auto-sort-scenes="reorderScenes"
            @reorder-scenes="reorderScenes"
            @reorder-plots="reorderPlots"
            @update-thread="(threadId, patch) => void updateWorkbenchThread(threadId, patch)"
            @update-scene="(sceneId, patch) => void updateWorkbenchScene(sceneId, patch)"
            @update-plot="(plotId, patch) => void updateWorkbenchPlot(plotId, patch)"
        />

        <Dialog
            :model-value="Boolean(deleteTarget)"
            title="删除确认"
            width="420px"
            show-cancel
            overlay-type="blur"
            @update:model-value="deleteTarget = null"
            @confirm="confirmDelete"
        >
            <div class="text-sm leading-6 text-[var(--text-secondary)]">{{ deleteMessage }}</div>
        </Dialog>
    </div>
</template>
