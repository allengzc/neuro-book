import type {
    PlotRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotBadRequest} from "nbook/server/plot/core/errors";
import type {
    ParsedReorderStoryPhaseItem,
    ParsedReorderStoryPlotItem,
    ParsedReorderStorySceneItem,
    ParsedReorderStoryThreadItem,
} from "nbook/server/plot/core/types";

/**
 * 排序与重排规则服务。
 */
export class OrderService {
    constructor(
        private readonly storyRepository: StoryRepository,
        private readonly threadRepository: ThreadRepository,
        private readonly sceneRepository: SceneRepository,
        private readonly plotRepository: PlotRepository,
    ) {}

    /**
     * 读取阶段 bucket 的下一个排序值。
     */
    async getNextPhaseSortOrder(storyId: number): Promise<number> {
        const phases = await this.storyRepository.findPhasesByStory(storyId);
        const lastPhase = phases.at(-1);
        return lastPhase ? lastPhase.sortOrder + 1 : 0;
    }

    /**
     * 读取线程 bucket 的下一个排序值。
     */
    async getNextThreadSortOrder(storyId: number, storyPhaseId: number | null): Promise<number> {
        const threads = await this.threadRepository.findThreadsByStoryPhase(storyId, storyPhaseId);
        const lastThread = threads.at(-1);
        return lastThread ? lastThread.sortOrder + 1 : 0;
    }

    /**
     * 读取线程内 Scene 的下一个排序值。
     */
    async getNextSceneThreadSortOrder(threadId: number): Promise<number> {
        const scenes = await this.sceneRepository.findScenesByThread(threadId);
        const lastScene = scenes.at(-1);
        return lastScene ? lastScene.threadSortOrder + 1 : 0;
    }

    /**
     * 读取章节内 Scene 的下一个排序值。
     */
    async getNextSceneChapterSortOrder(chapterPath: string | null): Promise<number | null> {
        if (chapterPath === null) {
            return null;
        }

        const scenes = await this.sceneRepository.findScenesByChapter(chapterPath);
        const lastScene = scenes.at(-1);
        return lastScene?.chapterSortOrder === undefined || lastScene.chapterSortOrder === null
            ? 0
            : lastScene.chapterSortOrder + 1;
    }

    /**
     * 读取 Scene 内 Plot 的下一个排序值。
     */
    async getNextPlotSortOrder(sceneId: number): Promise<number> {
        const plots = await this.plotRepository.findPlotsByScene(sceneId);
        const lastPlot = plots.at(-1);
        return lastPlot ? lastPlot.sortOrder + 1 : 0;
    }

    /**
     * 压缩阶段排序。
     */
    async normalizePhases(storyId: number): Promise<void> {
        const phases = await this.storyRepository.findPhasesByStory(storyId);
        for (const [index, phase] of phases.entries()) {
            if (phase.sortOrder === index) {
                continue;
            }
            await this.storyRepository.updatePhase(phase.id, {sortOrder: index});
        }
    }

    /**
     * 压缩线程 bucket 排序。
     */
    async normalizeThreads(storyId: number, storyPhaseId: number | null): Promise<void> {
        const threads = await this.threadRepository.findThreadsByStoryPhase(storyId, storyPhaseId);
        for (const [index, thread] of threads.entries()) {
            if (thread.sortOrder === index) {
                continue;
            }
            await this.threadRepository.updateThread(thread.id, {sortOrder: index});
        }
    }

    /**
     * 压缩线程内 Scene 排序。
     */
    async normalizeSceneThread(threadId: number): Promise<void> {
        const scenes = await this.sceneRepository.findScenesByThread(threadId);
        for (const [index, scene] of scenes.entries()) {
            if (scene.threadSortOrder === index) {
                continue;
            }
            await this.sceneRepository.updateScene(scene.id, {threadSortOrder: index});
        }
    }

    /**
     * 压缩章节内 Scene 排序。
     */
    async normalizeSceneChapter(chapterPath: string | null): Promise<void> {
        if (chapterPath === null) {
            return;
        }

        const scenes = await this.sceneRepository.findScenesByChapter(chapterPath);
        for (const [index, scene] of scenes.entries()) {
            if (scene.chapterSortOrder === index) {
                continue;
            }
            await this.sceneRepository.updateScene(scene.id, {chapterSortOrder: index});
        }
    }

    /**
     * 压缩 Scene 内 Plot 排序。
     */
    async normalizePlots(sceneId: number): Promise<void> {
        const plots = await this.plotRepository.findPlotsByScene(sceneId);
        for (const [index, plot] of plots.entries()) {
            if (plot.sortOrder === index) {
                continue;
            }
            await this.plotRepository.updatePlot(plot.id, {sortOrder: index});
        }
    }

    /**
     * 校验阶段重排输入。
     */
    validatePhaseReorderItems(existingPhaseIds: number[], items: ParsedReorderStoryPhaseItem[]): ParsedReorderStoryPhaseItem[] {
        this.assertCompleteCoverage(existingPhaseIds, items.map((item) => item.phaseId), "剧情阶段");
        this.assertContinuousSortOrders(items.map((item) => item.sortOrder), "剧情阶段");
        return items;
    }

    /**
     * 校验线程重排输入。
     */
    validateThreadReorderItems(
        existingThreadIds: number[],
        existingPhaseIds: number[],
        items: ParsedReorderStoryThreadItem[],
    ): ParsedReorderStoryThreadItem[] {
        const existingPhaseIdSet = new Set(existingPhaseIds);

        this.assertCompleteCoverage(existingThreadIds, items.map((item) => item.threadId), "剧情线程");
        for (const item of items) {
            if (item.storyPhaseId !== null && !existingPhaseIdSet.has(item.storyPhaseId)) {
                throwPlotBadRequest(`剧情阶段 ${item.storyPhaseId} 不属于当前小说`);
            }
        }
        this.assertGroupedContinuousOrders(
            items,
            (item) => String(item.storyPhaseId),
            (item) => item.sortOrder,
            (groupKey) => groupKey === "null" ? "未分组线程" : `剧情阶段 ${groupKey} 下的线程`,
        );

        return items;
    }

    /**
     * 校验场景重排输入。
     */
    validateSceneReorderItems(
        existingSceneIds: number[],
        existingThreadIds: number[],
        items: ParsedReorderStorySceneItem[],
    ): ParsedReorderStorySceneItem[] {
        const existingThreadIdSet = new Set(existingThreadIds);

        this.assertDistinctIds(items.map((item) => item.sceneId), "剧情场景");
        for (const item of items) {
            if (!existingSceneIds.includes(item.sceneId)) {
                throwPlotBadRequest(`剧情场景 ${item.sceneId} 不属于当前小说`);
            }
            if (!existingThreadIdSet.has(item.threadId)) {
                throwPlotBadRequest(`剧情线程 ${item.threadId} 不属于当前小说`);
            }
            if (item.chapterPath === null && item.chapterSortOrder !== null) {
                throwPlotBadRequest("未挂入章节的 Scene 不能提供 chapterSortOrder");
            }
            if (item.chapterPath !== null && item.chapterSortOrder === null) {
                throwPlotBadRequest("已挂入章节的 Scene 必须提供 chapterSortOrder");
            }
        }

        this.assertGroupedContinuousOrders(
            items,
            (item) => String(item.threadId),
            (item) => item.threadSortOrder,
            (groupKey) => `剧情线程 ${groupKey} 下的 Scene`,
        );
        if (items.length === existingSceneIds.length) {
            this.assertGroupedContinuousOrders(
                items.filter((item) => item.chapterPath !== null),
                (item) => String(item.chapterPath),
                (item) => item.chapterSortOrder ?? 0,
                (groupKey) => `章节 ${groupKey} 下的 Scene`,
            );
        }

        return items;
    }

    /**
     * 校验 Plot 重排输入。
     */
    validatePlotReorderItems(
        existingPlotIds: number[],
        existingSceneIds: number[],
        items: ParsedReorderStoryPlotItem[],
    ): ParsedReorderStoryPlotItem[] {
        const existingSceneIdSet = new Set(existingSceneIds);

        this.assertDistinctIds(items.map((item) => item.plotId), "情节点");
        for (const item of items) {
            if (!existingPlotIds.includes(item.plotId)) {
                throwPlotBadRequest(`情节点 ${item.plotId} 不属于当前小说`);
            }
        }
        for (const item of items) {
            if (!existingSceneIdSet.has(item.sceneId)) {
                throwPlotBadRequest(`剧情场景 ${item.sceneId} 不属于当前小说`);
            }
        }
        this.assertGroupedContinuousOrders(
            items,
            (item) => String(item.sceneId),
            (item) => item.sortOrder,
            (groupKey) => `剧情场景 ${groupKey} 下的情节点`,
        );

        return items;
    }

    /**
     * 校验重排集合完整性。
     */
    private assertCompleteCoverage(existingIds: number[], inputIds: number[], label: string): void {
        if (existingIds.length !== inputIds.length) {
            throwPlotBadRequest(`重排请求必须包含全部${label}`);
        }

        this.assertDistinctIds(inputIds, label);
        for (const inputId of inputIds) {
            if (!existingIds.includes(inputId)) {
                throwPlotBadRequest(`${label} ${inputId} 不属于当前小说`);
            }
        }
    }

    /**
     * 校验 ID 不重复。
     */
    private assertDistinctIds(ids: number[], label: string): void {
        if (new Set(ids).size !== ids.length) {
            throwPlotBadRequest(`${label}重排请求中存在重复 ID`);
        }
    }

    /**
     * 校验排序值连续。
     */
    private assertContinuousSortOrders(sortOrders: number[], label: string): void {
        const orderedSortOrders = [...sortOrders].sort((left, right) => left - right);
        for (const [index, value] of orderedSortOrders.entries()) {
            if (value !== index) {
                throwPlotBadRequest(`${label}排序必须从 0 开始连续递增`);
            }
        }
    }

    /**
     * 校验分桶排序连续。
     */
    private assertGroupedContinuousOrders<T>(
        items: T[],
        getGroupKey: (item: T) => string,
        getSortOrder: (item: T) => number,
        getLabel: (groupKey: string) => string,
    ): void {
        const groupedSortOrders = new Map<string, number[]>();
        for (const item of items) {
            const groupKey = getGroupKey(item);
            const currentSortOrders = groupedSortOrders.get(groupKey) ?? [];
            currentSortOrders.push(getSortOrder(item));
            groupedSortOrders.set(groupKey, currentSortOrders);
        }

        for (const [groupKey, sortOrders] of groupedSortOrders.entries()) {
            this.assertContinuousSortOrders(sortOrders, getLabel(groupKey));
        }
    }
}
