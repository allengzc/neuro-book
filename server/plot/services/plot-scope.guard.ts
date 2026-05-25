import type {
    StoryPhase,
    StoryPlot,
    StoryScene,
} from "nbook/server/generated/project-prisma/client";
import type {StoryThreadEntity} from "nbook/server/plot/core/types";
import {statWorkspacePath} from "nbook/server/workspace-files/workspace-files";
import type {
    PlotRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotBadRequest, throwPlotNotFound} from "nbook/server/plot/core/errors";

/**
 * 剧情模块作用域守卫。
 * 负责跨 service 复用的存在性、归属关系、唯一性校验。
 */
export class PlotScopeGuard {
    constructor(
        private readonly storyRepository: StoryRepository,
        private readonly threadRepository: ThreadRepository,
        private readonly sceneRepository: SceneRepository,
        private readonly plotRepository: PlotRepository,
    ) {}

    /**
     * 校验阶段属于当前 Story。
     */
    async assertPhase(storyId: number, phaseId: number): Promise<StoryPhase> {
        const phase = await this.storyRepository.findPhaseById(phaseId);
        if (!phase || phase.storyId !== storyId) {
            throwPlotNotFound("剧情阶段不存在");
        }
        return phase;
    }

    /**
     * 校验线程属于当前 Story。
     */
    async assertThread(storyId: number, threadId: number): Promise<StoryThreadEntity> {
        const thread = await this.threadRepository.findThreadById(threadId);
        if (!thread || thread.storyId !== storyId) {
            throwPlotNotFound("剧情线程不存在");
        }
        return thread;
    }

    /**
     * 校验场景属于当前 Story。
     */
    async assertScene(storyId: number, sceneId: number): Promise<StoryScene> {
        const scene = await this.sceneRepository.findSceneById(sceneId);
        if (!scene || scene.storyId !== storyId) {
            throwPlotNotFound("剧情场景不存在");
        }
        return scene;
    }

    /**
     * 校验情节点属于当前 Story。
     */
    async assertPlot(storyId: number, plotId: number): Promise<StoryPlot> {
        const plot = await this.plotRepository.findPlotByIdWithStory(plotId);
        if (!plot || plot.scene.storyId !== storyId) {
            throwPlotNotFound("情节点不存在");
        }
        return plot as StoryPlot;
    }

    /**
     * 校验章节路径属于当前 Project Workspace。
     */
    async assertChapterPath(projectPath: string, chapterPath: string): Promise<string> {
        const normalized = chapterPath.trim().replace(/\\/g, "/").replace(/^workspace\//, "");
        if (!normalized) {
            throwPlotBadRequest("chapterPath 不能为空");
        }
        if (!normalized.startsWith("manuscript/")) {
            throwPlotBadRequest("chapterPath 必须位于 manuscript/ 下");
        }
        if (!normalized.endsWith("/")) {
            throwPlotBadRequest("chapterPath 必须指向目录路径并以 / 结尾");
        }
        const node = await statWorkspacePath(projectPath, normalized).catch(() => null);
        if (!node || !node.isDirectory || !node.contentNode || node.entryType !== "chapter") {
            throwPlotNotFound("章节不存在");
        }
        return normalized;
    }

    /**
     * 校验阶段 name 唯一。
     */
    async assertPhaseNameUnique(storyId: number, name: string, excludePhaseId?: number): Promise<void> {
        const phase = await this.storyRepository.findPhaseByName(storyId, name, excludePhaseId);
        if (phase) {
            throwPlotBadRequest(`剧情阶段 name 已存在：${name}`);
        }
    }

    /**
     * 校验线程 name 唯一。
     */
    async assertThreadNameUnique(storyId: number, name: string, excludeThreadId?: number): Promise<void> {
        const thread = await this.threadRepository.findThreadByName(storyId, name, excludeThreadId);
        if (thread) {
            throwPlotBadRequest(`剧情线程 name 已存在：${name}`);
        }
    }

    /**
     * 返回 Story 下的阶段 ID。
     */
    async listPhaseIds(storyId: number): Promise<number[]> {
        return this.storyRepository.findPhaseIdsByStory(storyId);
    }

    /**
     * 返回 Story 下的线程 ID。
     */
    async listThreadIds(storyId: number): Promise<number[]> {
        return this.threadRepository.findThreadIdsByStory(storyId);
    }

}
