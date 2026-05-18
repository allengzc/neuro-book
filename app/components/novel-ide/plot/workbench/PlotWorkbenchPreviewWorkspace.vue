<script setup lang="ts">
import {computed, ref} from "vue";
import {plotPreviewDataset} from "nbook/app/components/novel-ide/plot/plot-preview.data";
import type {
    PlotPreviewPlot,
    PlotPreviewRef,
    PlotPreviewScene,
    PlotPreviewThread,
} from "nbook/app/components/novel-ide/plot/plot-preview.types";
import PlotThreadPanelShell from "nbook/app/components/novel-ide/plot/thread-panel/PlotThreadPanelShell.vue";
import type {
    PlotThreadPanelDetail,
    PlotThreadPanelPlot,
    PlotThreadPanelRef,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import PlotWorkbenchDialog from "nbook/app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue";

const workbenchVisible = ref(true);
const selectedThreadId = ref<string | null>("thread-main");
const selectedSceneId = ref<string | null>("scene-auction");
const selectedPlotId = ref<string | null>("plot-bid-war");
const pinnedThreadIds = ref<string[]>(["thread-main"]);
const extraThreads: PlotThreadPanelThread[] = [
    {
        id: "thread-system",
        phaseId: "phase-arrival",
        title: "系统升级线",
        summary: "系统从濒死触发到逐步开放能力，服务逃亡与反击节奏。",
        status: "active",
        isMainThread: false,
        tags: ["系统", "成长"],
        writingTip: "系统信息只在主角做选择时出现，避免独立说明段。",
        tone: "sky",
        refs: [],
    },
    {
        id: "thread-ritual",
        phaseId: "phase-arrival",
        title: "秘法血脉线",
        summary: "祭坛、血脉与邪教仪式背后的规则线。",
        status: "paused",
        isMainThread: false,
        tags: ["血脉", "仪式"],
        writingTip: "每次揭示只给一个规则，不要一次解释完整体系。",
        tone: "rose",
        refs: [],
    },
    {
        id: "thread-doctrine",
        phaseId: "phase-unlock",
        title: "邪教仪式线",
        summary: "邪教追杀、祭司命令与献祭目标的压力来源。",
        status: "paused",
        isMainThread: false,
        tags: ["邪教", "追杀"],
        writingTip: "反派行动要有组织性，让追杀不是随机遭遇。",
        tone: "emerald",
        refs: [],
    },
    {
        id: "thread-hollow",
        phaseId: null,
        title: "虚空之路线",
        summary: "用于承接后续世界观扩展与异界通道。",
        status: "draft",
        isMainThread: false,
        tags: ["世界", "通道"],
        writingTip: null,
        tone: "sky",
        refs: [],
    },
];

const extraScenes: PlotThreadPanelScene[] = [
    {
        id: "scene-counterattack",
        threadId: "thread-main",
        chapterPath: "chapter-02",
        title: "反杀落单敌人，激活系统",
        summary: "主角利用祭坛阴影诱导追兵分散，在绝境中反杀落单敌人，并第一次触发系统反馈。",
        purpose: "把逃亡线从被动闪避推进到主动求生，建立系统能力的第一次可信使用。",
        status: "draft",
        threadSortOrder: 3,
        chapterSortOrder: 2,
        writingTip: "反杀要显得勉强，重点放在代价和判断，不要写成突然开挂。",
        refs: [],
    },
    {
        id: "scene-message",
        threadId: "thread-main",
        chapterPath: "chapter-02",
        title: "传送阵逃脱",
        summary: "主角抢在追兵合围前启动残破传送阵，带着未解的身份线索逃离祭坛区域。",
        purpose: "完成第一阶段逃亡，同时把下一阶段目的地和追杀后果抛给读者。",
        status: "draft",
        threadSortOrder: 4,
        chapterSortOrder: 3,
        writingTip: "传送不是胜利，而是从局部危机进入更大的未知。",
        refs: [],
    },
];

const extraPlots: PlotThreadPanelPlot[] = [
    {id: "plot-ritual-conflict", sceneId: "scene-auction", sortOrder: 2, kind: "conflict", summary: "祭司出现并开始仪式，准备献祭主角，火焰符文亮起，紧张感被彻底激活。", effect: "外部威胁从环境转为行动，推动主角立即脱身。", writingTip: null},
    {id: "plot-system-setup", sceneId: "scene-auction", sortOrder: 3, kind: "setup", summary: "主角在濒死之际感知到体内的“系统”被触发，眼前出现半透明的界面与提示。", effect: "系统的出现带来一线生机，但也伴随未知代价与限制。", writingTip: "关联 [荒野祭坛](lorebook/location/initial-stage/) 与 [祭司现身](plot://plot-ritual-conflict)。"},
    {id: "plot-near-threat", sceneId: "scene-cage", sortOrder: 1, kind: "conflict", summary: "邪物逼近走廊，主角必须在声音抵达前完成脱身。", effect: "把压迫感转换成明确倒计时。", writingTip: null},
    {id: "plot-dark-choice", sceneId: "scene-ledger", sortOrder: 1, kind: "twist", summary: "系统提示的安全路线反而通向更深处，主角意识到自己只能赌一次。", effect: "让系统不再只是帮助，也成为悬念来源。", writingTip: null},
    {id: "plot-counterattack", sceneId: "scene-counterattack", sortOrder: 0, kind: "reward", summary: "主角反杀落单追兵，夺得第一件可用武器。", effect: "获得短暂主动权。", writingTip: null},
    {id: "plot-teleport", sceneId: "scene-message", sortOrder: 0, kind: "payoff", summary: "传送阵启动，祭坛空间在身后坍塌。", effect: "阶段性逃离祭坛区域。", writingTip: null},
];

const threads = ref<PlotThreadPanelThread[]>(cloneThreads(plotPreviewDataset.threads));
const scenes = ref<PlotThreadPanelScene[]>(cloneScenes(plotPreviewDataset.scenes));
const plots = ref<PlotThreadPanelPlot[]>(clonePlots(plotPreviewDataset.plots));
const chapters = plotPreviewDataset.chapters;

const threadMap = computed(() => new Map(threads.value.map((thread) => [thread.id, thread])));
const sceneMap = computed(() => new Map(scenes.value.map((scene) => [scene.id, scene])));
const chapterMap = computed(() => new Map(chapters.map((chapter) => [chapter.id, chapter])));

const selectedThread = computed(() => selectedThreadId.value ? (threadMap.value.get(selectedThreadId.value) ?? null) : null);
const selectedScene = computed(() => selectedSceneId.value ? (sceneMap.value.get(selectedSceneId.value) ?? null) : null);
const detail = computed<PlotThreadPanelDetail | null>(() => {
    const thread = selectedThread.value;
    const scene = selectedScene.value;

    if (!thread || !scene || scene.threadId !== thread.id) {
        return null;
    }

    return {
        thread,
        scene,
        chapter: scene.chapterPath ? (chapterMap.value.get(scene.chapterPath) ?? null) : null,
        plots: plots.value.filter((plot) => plot.sceneId === scene.id).sort((left, right) => left.sortOrder - right.sortOrder),
        effectiveRefs: [
            ...thread.refs.map((refItem) => ({...refItem, source: "thread" as const})),
            ...scene.refs.map((refItem) => ({...refItem, source: "scene" as const})),
        ],
    };
});

/**
 * 选中 Thread，并同步到该 Thread 的第一个 Scene。
 */
function selectThread(threadId: string): void {
    selectedThreadId.value = threadId;

    const nextScene = scenes.value
        .filter((scene) => scene.threadId === threadId)
        .sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0] ?? null;
    selectedSceneId.value = nextScene?.id ?? null;
    selectedPlotId.value = nextScene ? (plots.value.find((plot) => plot.sceneId === nextScene.id)?.id ?? null) : null;
}

/**
 * 选中 Scene，并同步所属 Thread。
 */
function selectScene(sceneId: string): void {
    const scene = sceneMap.value.get(sceneId) ?? null;
    if (!scene) {
        return;
    }

    selectedSceneId.value = scene.id;
    selectedThreadId.value = scene.threadId;
    selectedPlotId.value = plots.value.find((plot) => plot.sceneId === scene.id)?.id ?? null;
}

/**
 * 选中 Plot，并同步到所属 Scene。
 */
function selectPlot(plotId: string): void {
    const plot = plots.value.find((item) => item.id === plotId) ?? null;
    if (!plot) {
        return;
    }

    selectedPlotId.value = plot.id;
    selectScene(plot.sceneId);
    selectedPlotId.value = plot.id;
}

/**
 * 收起剧情大纲底部详情。
 */
function closeDetail(): void {
    selectedSceneId.value = null;
    selectedPlotId.value = null;
}

/**
 * 按拖拽结果重排当前 Thread 的 Scene。
 */
function reorderScenes(sceneIds: string[]): void {
    const orderMap = new Map(sceneIds.map((sceneId, index) => [sceneId, index]));
    scenes.value = scenes.value.map((scene) => {
        const nextOrder = orderMap.get(scene.id);
        return nextOrder === undefined ? scene : {...scene, threadSortOrder: nextOrder};
    });
}

/**
 * 在当前 Thread 下新增一个 Scene 草稿。
 */
function createScene(threadId: string): void {
    const threadScenes = scenes.value.filter((scene) => scene.threadId === threadId);
    const nextOrder = threadScenes.length;
    const nextScene: PlotThreadPanelScene = {
        id: `scene-preview-${Date.now()}`,
        threadId,
        chapterPath: null,
        title: `新建 Scene ${nextOrder + 1}`,
        summary: "这里记录新 Scene 的主要事件、场面变化和读者需要获得的信息。",
        purpose: "明确这个 Scene 推进哪一段冲突或揭示哪一条线索。",
        status: "draft",
        threadSortOrder: nextOrder,
        chapterSortOrder: null,
        writingTip: "先写目标，再补动作，不要让场景只承担说明功能。",
        refs: [],
    };

    scenes.value = [...scenes.value, nextScene];
    selectedThreadId.value = threadId;
    selectedSceneId.value = nextScene.id;
    selectedPlotId.value = null;
}

/**
 * 按当前 Scene 列表顺序重排 Plot。
 */
function reorderPlots(payload: {sceneId: string; plotIds: string[]}): void {
    const orderMap = new Map(payload.plotIds.map((plotId, index) => [plotId, index]));
    plots.value = plots.value.map((plot) => plot.sceneId === payload.sceneId
        ? {
            ...plot,
            sortOrder: orderMap.get(plot.id) ?? plot.sortOrder,
        }
        : plot);
}

/**
 * 在 Scene 下新增一个 Plot 草稿。
 */
function createPlot(sceneId: string): void {
    const scenePlots = plots.value.filter((plot) => plot.sceneId === sceneId);
    const nextPlot: PlotThreadPanelPlot = {
        id: `plot-preview-${Date.now()}`,
        sceneId,
        sortOrder: scenePlots.length,
        kind: "setup",
        summary: "新建 Plot：记录这个情节点的动作、信息或转折。",
        effect: null,
        writingTip: null,
        note: null,
    };

    plots.value = [...plots.value, nextPlot];
    selectPlot(nextPlot.id);
}

/**
 * 新建一个 preview Thread。
 */
function createThread(): void {
    const nextIndex = threads.value.length + 1;
    const nextThread: PlotThreadPanelThread = {
        id: `thread-preview-${Date.now()}`,
        phaseId: null,
        title: `新建剧情线 ${nextIndex}`,
        summary: "用于临时验证剧本工作台里的 Thread 创建、筛选与右键操作。",
        status: "draft",
        isMainThread: false,
        tags: ["mock"],
        writingTip: "先写清楚这条线承担的冲突，再拆成 Scene。",
        tone: "sky",
        refs: [],
    };
    threads.value = [nextThread, ...threads.value];
    selectedThreadId.value = nextThread.id;
    selectedSceneId.value = null;
    selectedPlotId.value = null;
}

/**
 * Pin 或取消 Pin Thread。
 */
function toggleThreadPin(threadId: string): void {
    pinnedThreadIds.value = pinnedThreadIds.value.includes(threadId)
        ? pinnedThreadIds.value.filter((id) => id !== threadId)
        : [threadId, ...pinnedThreadIds.value];
}

/**
 * 标记或取消主线。
 */
function toggleThreadMain(threadId: string): void {
    threads.value = threads.value.map((thread) => thread.id === threadId
        ? {
            ...thread,
            isMainThread: !thread.isMainThread,
        }
        : thread);
}

/**
 * 删除 preview Thread，并清理其下 Scene/Plot。
 */
function deleteThread(threadId: string): void {
    const deletedSceneIds = new Set(scenes.value.filter((scene) => scene.threadId === threadId).map((scene) => scene.id));
    threads.value = threads.value.filter((thread) => thread.id !== threadId);
    scenes.value = scenes.value.filter((scene) => scene.threadId !== threadId);
    plots.value = plots.value.filter((plot) => !deletedSceneIds.has(plot.sceneId));
    pinnedThreadIds.value = pinnedThreadIds.value.filter((id) => id !== threadId);

    if (selectedThreadId.value !== threadId) {
        return;
    }
    const nextThread = threads.value[0] ?? null;
    selectedThreadId.value = nextThread?.id ?? null;
    const nextScene = nextThread
        ? scenes.value.filter((scene) => scene.threadId === nextThread.id).sort((left, right) => left.threadSortOrder - right.threadSortOrder)[0] ?? null
        : null;
    selectedSceneId.value = nextScene?.id ?? null;
    selectedPlotId.value = nextScene ? (plots.value.find((plot) => plot.sceneId === nextScene.id)?.id ?? null) : null;
}

/**
 * 更新 Thread mock 数据。
 */
function updateThread(threadId: string, patch: Partial<PlotThreadPanelThread>): void {
    threads.value = threads.value.map((thread) => thread.id === threadId
        ? {
            ...thread,
            ...patch,
        }
        : thread);
}

/**
 * 更新 Scene mock 数据。
 */
function updateScene(sceneId: string, patch: Partial<PlotThreadPanelScene>): void {
    scenes.value = scenes.value.map((scene) => scene.id === sceneId
        ? {
            ...scene,
            ...patch,
        }
        : scene);
}

/**
 * 更新 Plot mock 数据。
 */
function updatePlot(plotId: string, patch: Partial<PlotThreadPanelPlot>): void {
    plots.value = plots.value.map((plot) => plot.id === plotId
        ? {
            ...plot,
            ...patch,
        }
        : plot);
}

/**
 * 删除一个 Plot。
 */
function deletePlot(plotId: string): void {
    const target = plots.value.find((plot) => plot.id === plotId) ?? null;
    plots.value = plots.value.filter((plot) => plot.id !== plotId);
    if (selectedPlotId.value !== plotId || !target) {
        return;
    }

    selectedPlotId.value = plots.value
        .filter((plot) => plot.sceneId === target.sceneId)
        .sort((left, right) => left.sortOrder - right.sortOrder)[0]?.id ?? null;
}

/**
 * 把预览引用转换为侧边栏引用模型。
 */
function cloneRefs(source: PlotPreviewRef[]): PlotThreadPanelRef[] {
    return source.map((refItem) => ({...refItem}));
}

/**
 * 克隆 Thread mock 数据。
 */
function cloneThreads(source: PlotPreviewThread[]): PlotThreadPanelThread[] {
    return [...source.map((thread) => ({
        ...thread,
        ...(thread.id === "thread-main"
            ? {
                title: "荒野祭坛逃亡线",
                summary: "主角在荒野祭坛醒来，卷入邪教仪式并被追杀。为生存，他激活系统，获得能力，逃出祭坛区域，开启与邪教的对抗之旅。",
                writingTip: "突出 [荒野祭坛](lorebook/location/initial-stage/) 的环境压迫感与逃离节奏；克制描写主角状态，更多通过行动与选择展现性格；初期隐藏最终祭品概念，逐步揭示系统与身份背景。",
                tags: ["逃亡", "仪式", "系统"],
            }
            : {}),
        status: thread.status as PlotThreadPanelThread["status"],
        tags: thread.id === "thread-main" ? ["逃亡", "仪式", "系统"] : [...thread.tags],
        refs: cloneRefs(thread.refs),
    })), ...extraThreads];
}

/**
 * 克隆 Scene mock 数据。
 */
function cloneScenes(source: PlotPreviewScene[]): PlotThreadPanelScene[] {
    return [...source.map((scene) => ({
        ...scene,
        ...(scene.id === "scene-auction"
            ? {
                title: "祭坛苏醒",
                summary: "主角在 [荒野祭坛](lorebook/location/initial-stage/) 醒来，意识混乱，发现自己被困在诡异的仪式现场。四周烛火摇曳，空气中弥漫着血与香料的混合气味，远处传来低沉的吟诵声。身体的疼痛让他判断自己被卷入一场以献祭为名的仪式，必须尽快挣脱束缚并理解眼前的规则，才能找到逃生的机会。",
                purpose: "建立环境压迫感，引出主角身份危机与系统触发，为后续 [系统触发](plot://plot-system-setup) 与逃脱对抗埋下伏笔。",
                writingTip: "通过感官描写与碎片记忆渲染混乱；节奏压抑，避免过早释出关键信息。",
            }
            : {}),
        ...(scene.id === "scene-cage"
            ? {
                title: "邪物气息逼近",
                summary: "仪式外侧传来拖拽与喘息声，主角意识到真正的危险正在靠近，必须在守卫发现前完成脱身。",
                purpose: "把静态压迫转成即时追逐，迫使主角做出第一次选择。",
                writingTip: "声音先于实体出现，用距离变化制造倒计时感。",
            }
            : {}),
        ...(scene.id === "scene-ledger"
            ? {
                title: "逃入黑暗走廊",
                summary: "主角挣脱束缚后冲入祭坛后的石廊，借助微弱提示避开第一轮搜捕。",
                purpose: "完成第一段逃脱，同时展示系统不是万能解法，只能提供有限线索。",
                writingTip: "动作要短促，避免解释系统设定，把信息藏在逃亡判断里。",
            }
            : {}),
        refs: cloneRefs(scene.refs),
    })), ...extraScenes];
}

/**
 * 克隆 Plot mock 数据。
 */
function clonePlots(source: PlotPreviewPlot[]): PlotThreadPanelPlot[] {
    return [...source.map((plot) => ({
        ...plot,
        ...(plot.id === "plot-bid-war"
            ? {
                kind: "mystery" as const,
                summary: "主角睁眼，头晕目眩，视线模糊，只能听到低沉的吟诵与心跳声，四周是刻满符文的石柱。",
                effect: "读者先进入混乱感，再逐步确认这是献祭现场。",
            }
            : {}),
        ...(plot.id === "plot-price-backfire"
            ? {
                kind: "reveal" as const,
                summary: "他尝试起身，发现双手被粗糙锁链锁在祭坛石柱上，身体无法动弹，记忆也一片空白。",
                effect: "确认主角处于被献祭的位置，形成第一层求生目标。",
            }
            : {}),
        ...(plot.id === "plot-cage-probe"
            ? {
                kind: "conflict" as const,
                summary: "祭司出现并开始仪式，准备献祭主角，火焰符文亮起，紧张感被彻底激活。",
                effect: "外部威胁从环境转为行动，推动主角立即脱身。",
            }
            : {}),
    })), ...extraPlots];
}
</script>

<template>
    <!-- 剧情大纲侧边栏 + 工作台 Dialog 预览 -->
    <div class="flex min-h-[760px] w-full gap-5">
        <div class="flex min-h-[760px] shrink-0 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
            <PlotThreadPanelShell
                :threads="threads"
                :scenes="scenes"
                :chapters="chapters"
                :plots="plots"
                :selected-thread-id="selectedThreadId"
                :selected-scene-id="selectedSceneId"
                :detail="detail"
                diagnostics=""
                @select-thread="selectThread"
                @select-scene="selectScene"
                @close-detail="closeDetail"
                @create-scene="workbenchVisible = true"
                @edit-thread="workbenchVisible = true"
                @edit-scene="workbenchVisible = true"
                @quick-update-scene="() => undefined"
                @open-thread-menu="workbenchVisible = true"
                @open-scene-menu="workbenchVisible = true"
                @open-root-menu="workbenchVisible = true"
                @reorder-scenes="reorderScenes"
            />
        </div>

        <section class="flex min-w-0 flex-1 flex-col justify-center rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)]/70 px-8 py-10 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <span class="i-lucide-panels-top-left h-6 w-6"></span>
            </div>
            <h2 class="mt-4 text-xl font-semibold text-[var(--text-main)]">剧本工作台 Dialog 预览</h2>
            <p class="mx-auto mt-3 max-w-[560px] text-sm leading-7 text-[var(--text-secondary)]">
                左侧剧情大纲侧边栏保持现状。点击按钮打开新的剧本工作台 mock，用于验证截图方向的信息密度、布局和主题表现。
            </p>
            <button
                type="button"
                class="mx-auto mt-5 inline-flex h-10 items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
                @click="workbenchVisible = true"
            >
                <span class="i-lucide-panels-top-left h-4 w-4"></span>
                打开剧本工作台
            </button>
        </section>

        <PlotWorkbenchDialog
            v-model="workbenchVisible"
            :story="plotPreviewDataset.story"
            :phases="plotPreviewDataset.phases"
            :threads="threads"
            :scenes="scenes"
            :plots="plots"
            :chapters="chapters"
            :selected-thread-id="selectedThreadId"
            :selected-scene-id="selectedSceneId"
            :selected-plot-id="selectedPlotId"
            :pinned-thread-ids="pinnedThreadIds"
            @select-thread="selectThread"
            @select-scene="selectScene"
            @select-plot="selectPlot"
            @create-thread="createThread"
            @toggle-thread-pin="toggleThreadPin"
            @toggle-thread-main="toggleThreadMain"
            @delete-thread="deleteThread"
            @create-scene="createScene"
            @create-plot="createPlot"
            @delete-plot="deletePlot"
            @auto-sort-scenes="reorderScenes"
            @reorder-scenes="reorderScenes"
            @reorder-plots="reorderPlots"
            @update-thread="updateThread"
            @update-scene="updateScene"
            @update-plot="updatePlot"
        />
    </div>
</template>
