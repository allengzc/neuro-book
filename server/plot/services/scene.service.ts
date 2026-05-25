import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotNotFound} from "nbook/server/plot/core/errors";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ParsedCreateStorySceneInput,
    ParsedReorderStorySceneItem,
    ParsedUpdateStorySceneInput,
} from "nbook/server/plot/core/types";
import {throwPlotBadRequest} from "nbook/server/plot/core/errors";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {
    ChapterPlotDetailDto,
    PlotTreeDto,
    StorySceneDetailDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Scene 用例服务。
 */
export class SceneService {
    constructor(
        private readonly sceneRepository: SceneRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly orderService: OrderService,
        private readonly refResolverService: RefResolverService,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * 查询场景详情。
     */
    async getStorySceneDetailDto(projectPath: string, sceneId: number): Promise<StorySceneDetailDto> {
        const story = await this.storyService.ensureStory(projectPath);
        await this.scopeGuard.assertScene(story.id, sceneId);
        const scene = await this.sceneRepository.findSceneWithDetailsById(sceneId);
        if (!scene) {
            throwPlotNotFound("剧情场景不存在");
        }

        return this.assembler.toStorySceneDetailDto(scene);
    }

    /**
     * 查询章节下的剧情 Scene 与 Plot。
     */
    async getChapterPlotDetailDto(projectPath: string, chapterPath: string): Promise<ChapterPlotDetailDto> {
        const normalizedChapterPath = await this.scopeGuard.assertChapterPath(projectPath, chapterPath);
        const scenes = await this.sceneRepository.findChapterScenesWithPlots(normalizedChapterPath);
        return this.assembler.toChapterPlotDetailDto(normalizedChapterPath, scenes);
    }

    /**
     * 创建场景。
     */
    async createStoryScene(projectPath: string, input: ParsedCreateStorySceneInput): Promise<StorySceneDetailDto> {
        const story = await this.storyService.ensureStory(projectPath);

        await this.scopeGuard.assertThread(story.id, input.threadId);
        const chapterPath = input.chapterPath === null ? null : await this.scopeGuard.assertChapterPath(projectPath, input.chapterPath);

        const refs = input.resolvedRefs ?? await this.refResolverService.resolveRefs(story.id, input.refs);
        const scene = await this.sceneRepository.createScene({
            storyId: story.id,
            threadId: input.threadId,
            chapterPath,
            threadSortOrder: await this.orderService.getNextSceneThreadSortOrder(input.threadId),
            chapterSortOrder: await this.orderService.getNextSceneChapterSortOrder(chapterPath),
            title: input.title,
            status: input.status ?? "draft",
            summary: input.summary ?? "",
            purpose: input.purpose ?? null,
            writingTip: input.writingTip ?? null,
            note: input.note ?? null,
        });

        await this.sceneRepository.replaceRefs(scene.id, refs);
        return this.getStorySceneDetailDto(projectPath, scene.id);
    }

    /**
     * 更新场景。
     */
    async updateStoryScene(
        projectPath: string,
        sceneId: number,
        patch: ParsedUpdateStorySceneInput,
    ): Promise<StorySceneDetailDto> {
        const story = await this.storyService.ensureStory(projectPath);
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        const nextThreadId = patch.threadId === undefined ? scene.threadId : patch.threadId;
        const nextChapterPath = patch.chapterPath === undefined
            ? scene.chapterPath
            : patch.chapterPath === null
                ? null
                : await this.scopeGuard.assertChapterPath(projectPath, patch.chapterPath);
        const threadChanged = nextThreadId !== scene.threadId;
        const chapterChanged = nextChapterPath !== scene.chapterPath;

        if (threadChanged) {
            await this.scopeGuard.assertThread(story.id, nextThreadId);
        }

        const refs = patch.refs === undefined
            ? null
            : patch.resolvedRefs ?? await this.refResolverService.resolveRefs(story.id, patch.refs);
        await this.sceneRepository.updateScene(scene.id, {
            threadId: nextThreadId,
            chapterPath: patch.chapterPath === undefined ? undefined : nextChapterPath,
            threadSortOrder: threadChanged ? await this.orderService.getNextSceneThreadSortOrder(nextThreadId) : undefined,
            chapterSortOrder: patch.chapterPath === undefined
                ? undefined
                : nextChapterPath === null
                    ? null
                    : chapterChanged
                        ? await this.orderService.getNextSceneChapterSortOrder(nextChapterPath)
                        : undefined,
            title: patch.title,
            status: patch.status,
            summary: patch.summary,
            purpose: patch.purpose,
            writingTip: patch.writingTip,
            note: patch.note,
        });

        if (refs !== null) {
            await this.sceneRepository.replaceRefs(scene.id, refs);
        }
        if (threadChanged) {
            await this.orderService.normalizeSceneThread(scene.threadId);
        }
        if (chapterChanged && scene.chapterPath !== null) {
            await this.orderService.normalizeSceneChapter(scene.chapterPath);
        }

        return this.getStorySceneDetailDto(projectPath, scene.id);
    }

    /**
     * 删除场景。
     */
    async deleteStoryScene(projectPath: string, sceneId: number): Promise<void> {
        const story = await this.storyService.ensureStory(projectPath);
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        await this.sceneRepository.deleteScene(scene.id);
        await this.orderService.normalizeSceneThread(scene.threadId);
        await this.orderService.normalizeSceneChapter(scene.chapterPath);
    }

    /**
     * 批量重排场景。
     */
    async reorderStoryScenes(projectPath: string, items: ParsedReorderStorySceneItem[]): Promise<PlotTreeDto> {
        const story = await this.storyService.ensureStory(projectPath);
        const [existingSceneIds, existingThreadIds] = await Promise.all([
            this.sceneRepository.findSceneIdsByStory(story.id),
            this.scopeGuard.listThreadIds(story.id),
        ]);
        for (const item of items) {
            if (item.chapterPath !== null) {
                item.chapterPath = await this.scopeGuard.assertChapterPath(projectPath, item.chapterPath);
            }
        }
        const parsedItems = this.orderService.validateSceneReorderItems(
            existingSceneIds,
            existingThreadIds,
            items,
        );
        const affectedThreadIds = new Set(parsedItems.map((item) => item.threadId));

        for (const threadId of affectedThreadIds) {
            const existingThreadSceneIds = (await this.sceneRepository.findScenesByThread(threadId)).map((scene) => scene.id);
            const inputThreadSceneIds = parsedItems.filter((item) => item.threadId === threadId).map((item) => item.sceneId);
            if (
                existingThreadSceneIds.length !== inputThreadSceneIds.length
                || existingThreadSceneIds.some((sceneId) => !inputThreadSceneIds.includes(sceneId))
            ) {
                throwPlotBadRequest(`剧情线程 ${threadId} 下的 Scene 重排必须覆盖当前 Thread 的全部 Scene`);
            }
        }

        for (const [index, item] of parsedItems.entries()) {
            await this.sceneRepository.updateScene(item.sceneId, {
                threadId: item.threadId,
                chapterPath: item.chapterPath,
                threadSortOrder: -(index + 1),
                chapterSortOrder: item.chapterSortOrder,
            });
        }

        for (const item of parsedItems) {
            await this.sceneRepository.updateScene(item.sceneId, {
                threadSortOrder: item.threadSortOrder,
            });
        }

        return this.storyService.getPlotTree(projectPath);
    }
}
