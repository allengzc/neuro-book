import type {Ref} from "vue";
import {computed, ref, watch} from "vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuItem,
    AgentTriggerMenuSection,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";
import type {AgentSkillCatalogItemDto} from "nbook/shared/dto/agent-session.dto";
import type {
    PlotTreeDto,
    StorySceneDetailDto,
    StoryPlotDto,
} from "nbook/shared/dto/plot.dto";

type QuickTextItem = {
    id: string;
    label: string;
    description: string;
    iconClass: string;
    value: string;
};

type PlotThreadReferenceCandidate = {
    id: string;
    title: string;
    name: string;
    summary: string;
    isMainThread: boolean;
};

type PlotSceneReferenceCandidate = {
    id: string;
    threadId: string;
    threadTitle: string;
    title: string;
    summary: string;
    chapterPath: string | null;
};

type PlotReferenceCandidate = {
    id: string;
    sceneId: string;
    sceneTitle: string;
    threadTitle: string;
    summary: string;
    kind: StoryPlotDto["kind"];
};

const PLOT_RESULT_LIMIT = 20;

const COMMAND_ITEMS: QuickTextItem[] = [
    {id: "command:plan", label: "plan", description: "切换 Plan Mode。", iconClass: "i-lucide-clipboard-list", value: "/plan"},
    {id: "command:compact", label: "compact", description: "压缩当前 Agent Session 上下文。", iconClass: "i-lucide-archive", value: "/compact"},
    {id: "command:clear", label: "clear", description: "清空当前 Session 视图并回到空历史。", iconClass: "i-lucide-trash", value: "/clear"},
    {id: "command:new", label: "new", description: "新建 Agent Session。", iconClass: "i-lucide-plus", value: "/new"},
    {id: "command:settings", label: "settings", description: "保留设置入口。", iconClass: "i-lucide-settings", value: "/settings"},
];

export interface UseStructuredReferenceMenuOptions {
    novelId: Ref<string>;
    selectedStoryThreadId: Ref<string | null>;
    selectedStorySceneId: Ref<string | null>;
    workspaceTree?: Ref<WorkspaceFileNode[]>;
}

export function useStructuredReferenceMenu(options: UseStructuredReferenceMenuOptions) {
    const skillCatalog = ref<AgentSkillCatalogItemDto[]>([]);
    const loadingSkillCatalog = ref(false);
    const skillCatalogLoaded = ref(false);
    let skillCatalogRequest: Promise<void> | null = null;
    const plotTree = ref<PlotTreeDto | null>(null);
    const plotTreeLoadedNovelId = ref("");
    const loadingPlotTreeEntries = ref(false);
    const selectedScenePlotDetail = ref<StorySceneDetailDto | null>(null);
    const selectedScenePlotLoadedId = ref("");
    const loadingSelectedScenePlotDetail = ref(false);
    const refreshVersion = ref(0);

    watch(options.novelId, () => {
        plotTree.value = null;
        plotTreeLoadedNovelId.value = "";
        selectedScenePlotDetail.value = null;
        selectedScenePlotLoadedId.value = "";
    });

    watch(options.selectedStorySceneId, () => {
        selectedScenePlotDetail.value = null;
        selectedScenePlotLoadedId.value = "";
    });

    function matchesReferenceQuery(query: string, fields: Array<string | null | undefined>): boolean {
        const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
        if (!normalizedQuery) {
            return true;
        }

        return fields
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    }

    async function refreshSkillCatalog(): Promise<void> {
        if (skillCatalogLoaded.value) {
            return;
        }
        if (skillCatalogRequest) {
            return await skillCatalogRequest;
        }

        skillCatalogRequest = (async () => {
            loadingSkillCatalog.value = true;
            try {
                skillCatalog.value = await $fetch<AgentSkillCatalogItemDto[]>("/api/agent/skills");
                skillCatalogLoaded.value = true;
                refreshVersion.value += 1;
            } finally {
                loadingSkillCatalog.value = false;
                skillCatalogRequest = null;
            }
        })();
        return await skillCatalogRequest;
    }

    function getThreadCandidates(query: string): PlotThreadReferenceCandidate[] {
        const threadGroups = plotTree.value
            ? [...plotTree.value.phases.flatMap((phase) => phase.threads), ...plotTree.value.ungroupedThreads]
            : [];
        return threadGroups
            .filter((thread) => matchesReferenceQuery(query, [thread.id, thread.name, thread.title, thread.summary]))
            .slice(0, PLOT_RESULT_LIMIT)
            .map((thread) => ({
                id: thread.id,
                title: thread.title,
                name: thread.name,
                summary: thread.summary,
                isMainThread: thread.isMainThread,
            }));
    }

    function getSceneCandidates(query: string): PlotSceneReferenceCandidate[] {
        const threadGroups = plotTree.value
            ? [...plotTree.value.phases.flatMap((phase) => phase.threads), ...plotTree.value.ungroupedThreads]
            : [];
        return threadGroups
            .flatMap((thread) => thread.scenes.map((scene) => ({
                id: scene.id,
                threadId: thread.id,
                threadTitle: thread.title,
                title: scene.title,
                summary: scene.summary,
                chapterPath: scene.chapterPath,
            })))
            .filter((scene) => matchesReferenceQuery(query, [scene.id, scene.title, scene.threadTitle, scene.summary]))
            .slice(0, PLOT_RESULT_LIMIT);
    }

    function getSelectedThreadTitle(): string {
        const selectedThreadIdValue = options.selectedStoryThreadId.value;
        if (!selectedThreadIdValue || !plotTree.value) {
            return "当前线程";
        }

        const thread = [...plotTree.value.phases.flatMap((phase) => phase.threads), ...plotTree.value.ungroupedThreads]
            .find((item) => item.id === selectedThreadIdValue);
        return thread?.title ?? "当前线程";
    }

    function getPlotCandidates(query: string): PlotReferenceCandidate[] {
        const sceneCandidates = selectedScenePlotDetail.value?.plots.map((plot) => ({
            id: plot.id,
            sceneId: plot.sceneId,
            sceneTitle: selectedScenePlotDetail.value?.title ?? "当前场景",
            threadTitle: getSelectedThreadTitle(),
            summary: plot.summary,
            kind: plot.kind,
        })) ?? [];

        return sceneCandidates
            .filter((plot) => matchesReferenceQuery(query, [plot.id, plot.sceneTitle, plot.threadTitle, plot.summary, plot.kind]))
            .slice(0, PLOT_RESULT_LIMIT);
    }

    async function ensurePlotTreeLoaded(): Promise<void> {
        if (!options.novelId.value || loadingPlotTreeEntries.value || plotTreeLoadedNovelId.value === options.novelId.value) {
            return;
        }

        loadingPlotTreeEntries.value = true;
        try {
            plotTree.value = await $fetch<PlotTreeDto>(`/api/projects/plot/tree`, projectPlotOptions());
            plotTreeLoadedNovelId.value = options.novelId.value;
            refreshVersion.value += 1;
        } finally {
            loadingPlotTreeEntries.value = false;
        }
    }

    async function ensureSelectedScenePlotDetailLoaded(): Promise<void> {
        if (!options.novelId.value || !options.selectedStorySceneId.value || loadingSelectedScenePlotDetail.value || selectedScenePlotLoadedId.value === options.selectedStorySceneId.value) {
            return;
        }

        loadingSelectedScenePlotDetail.value = true;
        try {
            selectedScenePlotDetail.value = await $fetch<StorySceneDetailDto>(`/api/projects/plot/scenes/${options.selectedStorySceneId.value}`, projectPlotOptions());
            selectedScenePlotLoadedId.value = options.selectedStorySceneId.value;
            refreshVersion.value += 1;
        } finally {
            loadingSelectedScenePlotDetail.value = false;
        }
    }

    function projectPlotOptions(): {query: {projectPath: string}} {
        return {query: {projectPath: options.novelId.value}};
    }

    function resolveMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
        if (context.kind === "reference-root") {
            const routedContext = routeReferenceRootQuery(context.query);
            if (routedContext) {
                return resolveMenu(routedContext);
            }

            void ensurePlotTreeLoaded();
            if (options.selectedStorySceneId.value) {
                void ensureSelectedScenePlotDetailLoaded();
            }

            const workspaceSections = options.workspaceTree
                ? buildWorkspaceReferenceSections(options.workspaceTree.value, context.query)
                : [];
            const plotSections = buildPlotRootSections(context.query);
            const sections = [...workspaceSections, ...plotSections];
            return {
                title: "引用",
                prefix: "@",
                sections: sections.length > 0 ? sections : [createEmptyReferenceSection(context.query)],
            };
        }

        if (context.kind === "lorebook") {
            return {
                title: "设定引用",
                prefix: "",
                sections: [{
                    id: "lorebook-path",
                    items: [{
                        id: "lorebook:path",
                        label: context.query || "lorebook/",
                        description: "输入 workspace 相对路径，例如 lorebook/character/苏雪/。",
                        iconClass: "i-lucide-library-big",
                        insertText: context.query,
                        trailingSpace: false,
                    }],
                }],
            };
        }

        if (context.kind === "thread") {
            void ensurePlotTreeLoaded();
            const threadCandidates = getThreadCandidates(context.query);
            if (loadingPlotTreeEntries.value && threadCandidates.length === 0) {
                return {title: "线程引用", prefix: "@thread://", sections: [{id: "thread-loading", items: [{id: "thread:loading", label: "加载线程中", description: "正在拉取当前小说的剧情树。", iconClass: "i-lucide-loader-circle animate-spin"}]}]};
            }

            const items = threadCandidates.map(toThreadMenuItem);
            return {title: "线程引用", prefix: "@thread://", sections: items.length > 0 ? [{id: "thread", items}] : []};
        }

        if (context.kind === "scene") {
            void ensurePlotTreeLoaded();
            const sceneCandidates = getSceneCandidates(context.query);
            if (loadingPlotTreeEntries.value && sceneCandidates.length === 0) {
                return {title: "场景引用", prefix: "@scene://", sections: [{id: "scene-loading", items: [{id: "scene:loading", label: "加载场景中", description: "正在拉取当前小说的剧情树。", iconClass: "i-lucide-loader-circle animate-spin"}]}]};
            }

            const items = sceneCandidates.map(toSceneMenuItem);
            return {title: "场景引用", prefix: "@scene://", sections: items.length > 0 ? [{id: "scene", items}] : []};
        }

        if (context.kind === "plot") {
            if (options.selectedStorySceneId.value) {
                void ensureSelectedScenePlotDetailLoaded();
            }

            const plotCandidates = getPlotCandidates(context.query);
            if (loadingSelectedScenePlotDetail.value && plotCandidates.length === 0) {
                return {title: "节点引用", prefix: "@plot://", sections: [{id: "plot-loading", items: [{id: "plot:loading", label: "加载情节点中", description: "正在拉取当前场景的情节点。", iconClass: "i-lucide-loader-circle animate-spin"}]}]};
            }

            if (!options.selectedStorySceneId.value && plotCandidates.length === 0) {
                return {title: "节点引用", prefix: "@plot://", sections: [{id: "plot-empty", items: [{id: "plot:empty", label: "缺少上下文", description: "请先选中剧情场景，再插入 plot 引用。", iconClass: "i-lucide-info"}]}]};
            }

            const items = plotCandidates.map(toPlotMenuItem);
            return {title: "节点引用", prefix: "@plot://", sections: items.length > 0 ? [{id: "plot", items}] : []};
        }

        if (context.kind === "skill") {
            if (!skillCatalogLoaded.value && !loadingSkillCatalog.value) {
                void refreshSkillCatalog();
            }
            const items = skillCatalog.value
                .filter((item) => matchesReferenceQuery(context.query, [item.name, item.description]))
                .map((item) => ({
                    id: `skill:${item.name}`,
                    label: item.name,
                    description: item.description,
                    iconClass: "i-lucide-sparkles",
                    hint: `$${item.name}`,
                    skill: {
                        name: item.name,
                    },
                }));
            if (loadingSkillCatalog.value && items.length === 0) {
                return {
                    title: "调用技能",
                    prefix: "$",
                    sections: [{
                        id: "skill-loading",
                        items: [{
                            id: "skill:loading",
                            label: "加载技能中",
                            description: "正在读取当前仓库的 skills catalog。",
                            iconClass: "i-lucide-loader-circle animate-spin",
                        }],
                    }],
                };
            }

            if (skillCatalogLoaded.value && items.length === 0) {
                return {
                    title: "调用技能",
                    prefix: "$",
                    sections: [{
                        id: "skill-empty",
                        items: [{
                            id: "skill:empty",
                            label: "没有匹配技能",
                            description: skillCatalog.value.length > 0 ? "当前查询没有匹配的 skill。" : "当前仓库还没有可用的 skill。",
                            iconClass: "i-lucide-info",
                        }],
                    }],
                };
            }

            return {title: "调用技能", prefix: "$", sections: items.length > 0 ? [{id: "skill", items}] : []};
        }

        const normalizedQuery = context.query.trim().toLocaleLowerCase("zh-CN");
        const items = COMMAND_ITEMS
            .filter((item) => !normalizedQuery || `${item.label} ${item.description}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
            .map((item) => ({id: item.id, label: item.label, description: item.description, iconClass: item.iconClass, insertText: item.value}));
        return {title: "执行命令", prefix: "/", sections: items.length > 0 ? [{id: "command", items}] : []};
    }

    /**
     * 显式输入 @thread:// / @scene:// / @plot:// 时切到对应剧情引用菜单。
     */
    function routeReferenceRootQuery(query: string): AgentTriggerMenuContext | null {
        const matched = /^(thread|scene|plot):\/\/(.*)$/u.exec(query.trim());
        if (!matched) {
            return null;
        }
        return {
            kind: matched[1] as Extract<AgentTriggerMenuContext["kind"], "thread" | "scene" | "plot">,
            query: matched[2] ?? "",
        };
    }

    /**
     * 生成 @ 根菜单里的剧情引用候选。
     */
    function buildPlotRootSections(query: string): AgentTriggerMenuSection[] {
        const sections: AgentTriggerMenuSection[] = [];
        const threadItems = getThreadCandidates(query).map(toThreadMenuItem);
        if (threadItems.length > 0) {
            sections.push({id: "plot-thread", title: "剧情线程", items: threadItems});
        }

        const sceneItems = getSceneCandidates(query).map(toSceneMenuItem);
        if (sceneItems.length > 0) {
            sections.push({id: "plot-scene", title: "剧情场景", items: sceneItems});
        }

        const plotItems = getPlotCandidates(query).map(toPlotMenuItem);
        if (plotItems.length > 0) {
            sections.push({id: "plot-node", title: "情节点", items: plotItems});
        }

        if (loadingPlotTreeEntries.value && threadItems.length === 0 && sceneItems.length === 0) {
            sections.push({
                id: "plot-loading",
                title: "剧情",
                items: [{
                    id: "plot-root-loading",
                    label: "加载剧情中",
                    description: "正在拉取当前小说的剧情树。",
                    iconClass: "i-lucide-loader-circle animate-spin",
                    disabled: true,
                }],
            });
        }

        return sections;
    }

    /**
     * 搜索无结果时仍保留菜单，避免 Suggestion 直接关闭。
     */
    function createEmptyReferenceSection(query: string): AgentTriggerMenuSection {
        return {
            id: "empty-reference",
            items: [{
                id: "empty-reference-result",
                label: query.trim() ? "没有匹配结果" : "暂无可引用内容",
                description: query.trim() ? "换一个关键词试试。" : "当前工作区没有可引用内容或剧情对象。",
                iconClass: "i-lucide-search-x",
                disabled: true,
            }],
        };
    }

    /**
     * 转换剧情线程候选。
     */
    function toThreadMenuItem(candidate: PlotThreadReferenceCandidate): AgentTriggerMenuItem {
        return {
            id: `thread:${candidate.id}`,
            label: candidate.title,
            description: `${candidate.name}${candidate.summary ? ` · ${candidate.summary}` : ""}`,
            iconClass: candidate.isMainThread ? "i-lucide-star" : "i-lucide-git-branch-plus",
            hint: "thread",
            reference: {kind: "thread" as const, title: candidate.title, targetId: candidate.id},
        };
    }

    /**
     * 转换剧情场景候选。
     */
    function toSceneMenuItem(candidate: PlotSceneReferenceCandidate): AgentTriggerMenuItem {
        return {
            id: `scene:${candidate.id}`,
            label: candidate.title,
            description: `${candidate.threadTitle}${candidate.summary ? ` · ${candidate.summary}` : ""}`,
            iconClass: "i-lucide-clapperboard",
            hint: "scene",
            reference: {kind: "scene" as const, title: candidate.title, targetId: candidate.id},
        };
    }

    /**
     * 转换情节点候选。
     */
    function toPlotMenuItem(candidate: PlotReferenceCandidate): AgentTriggerMenuItem {
        const label = candidate.summary || `${candidate.sceneTitle} · ${candidate.kind}`;
        return {
            id: `plot:${candidate.id}`,
            label,
            description: `${candidate.threadTitle} / ${candidate.sceneTitle} · ${candidate.kind}`,
            iconClass: "i-lucide-spline-pointer",
            hint: "plot",
            reference: {
                kind: "plot" as const,
                title: label,
                targetId: candidate.id,
            },
        };
    }

    const menuRefreshKey = computed(() => [
        refreshVersion.value,
        options.workspaceTree?.value.map((node) => `${node.path}:${node.mtimeMs}`).join("|") ?? "",
        loadingSkillCatalog.value ? "lk1" : "lk0",
        skillCatalogLoaded.value ? "sk1" : "sk0",
        skillCatalog.value.length,
        loadingPlotTreeEntries.value ? "lp1" : "lp0",
        plotTreeLoadedNovelId.value,
        plotTree.value?.phases.length ?? 0,
        plotTree.value?.ungroupedThreads.length ?? 0,
        loadingSelectedScenePlotDetail.value ? "ls1" : "ls0",
        selectedScenePlotLoadedId.value,
        selectedScenePlotDetail.value?.plots.length ?? 0,
    ].join("|"));

    return {
        resolveMenu,
        menuRefreshKey,
        refreshSkillCatalog,
    };
}
