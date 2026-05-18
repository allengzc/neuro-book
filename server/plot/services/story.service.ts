import type {
    Story,
} from "nbook/server/generated/prisma/client";
import type {
    PlotLookupRepository,
    PlotRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {throwPlotNotFound} from "nbook/server/plot/core/errors";
import type {ParsedReorderStoryPhaseItem} from "nbook/server/plot/core/types";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {
    CreateStoryPhaseRequestDto,
    PlotWorkbenchDto,
    PlotTreeDto,
    StoryDto,
    StoryPhaseDto,
    UpdateStoryPhaseRequestDto,
    UpdateStoryRequestDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Story 作用域与 Story/Phase 用例服务。
 */
export class StoryService {
    constructor(
        private readonly storyRepository: StoryRepository,
        private readonly threadRepository: ThreadRepository,
        private readonly plotRepository: PlotRepository,
        private readonly lookupRepository: PlotLookupRepository,
        private readonly orderService: OrderService,
        private readonly assembler: PlotDtoAssembler,
        private readonly scopeGuard: PlotScopeGuard,
    ) {}

    /**
     * 确保当前小说已有 Story。
     */
    async ensureStory(novelId: number): Promise<Story> {
        const novel = await this.lookupRepository.findNovelById(novelId);
        if (!novel) {
            throwPlotNotFound("小说不存在");
        }

        return this.storyRepository.upsertStoryForNovel({
            novelId: novel.id,
            title: novel.title,
            summary: novel.summary,
        }) as Promise<Story>;
    }

    /**
     * 查询 Story DTO。
     */
    async getStoryDto(novelId: number): Promise<StoryDto> {
        const story = await this.ensureStory(novelId);
        return this.assembler.toStoryDto(story);
    }

    /**
     * 更新 Story。
     */
    async updateStory(novelId: number, patch: UpdateStoryRequestDto): Promise<StoryDto> {
        const story = await this.ensureStory(novelId);
        const updatedStory = await this.storyRepository.updateStory(story.id, {
            title: patch.title,
            summary: patch.summary,
            note: patch.note,
        });

        return this.assembler.toStoryDto(updatedStory);
    }

    /**
     * 读取剧情树。
     */
    async getPlotTree(novelId: number): Promise<PlotTreeDto> {
        const story = await this.ensureStory(novelId);
        const [phases, ungroupedThreads, totalPlots] = await Promise.all([
            this.threadRepository.findPhaseThreadsWithScenes(story.id),
            this.threadRepository.findUngroupedThreads(story.id),
            this.plotRepository.countPlotsByStory(story.id),
        ]);

        return this.assembler.toPlotTreeDto({
            story,
            phases,
            ungroupedThreads,
            totalPlots,
        });
    }

    /**
     * 读取剧本工作台聚合数据。
     */
    async getPlotWorkbench(novelId: number): Promise<PlotWorkbenchDto> {
        const story = await this.ensureStory(novelId);
        const [phases, ungroupedThreads, totalPlots] = await Promise.all([
            this.threadRepository.findWorkbenchPhaseThreads(story.id),
            this.threadRepository.findUngroupedWorkbenchThreads(story.id),
            this.plotRepository.countPlotsByStory(story.id),
        ]);

        return this.assembler.toPlotWorkbenchDto({
            story,
            phases,
            ungroupedThreads,
            totalPlots,
        });
    }

    /**
     * 查询剧情阶段详情。
     */
    async getStoryPhaseDto(novelId: number, phaseId: number): Promise<StoryPhaseDto> {
        const story = await this.ensureStory(novelId);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);
        return this.assembler.toStoryPhaseDto(phase);
    }

    /**
     * 创建剧情阶段。
     */
    async createStoryPhase(novelId: number, input: CreateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        const story = await this.ensureStory(novelId);
        await this.scopeGuard.assertPhaseNameUnique(story.id, input.name);

        const phase = await this.storyRepository.createPhase({
            storyId: story.id,
            sortOrder: await this.orderService.getNextPhaseSortOrder(story.id),
            name: input.name,
            title: input.title,
            summary: input.summary ?? "",
            note: input.note ?? null,
        });

        return this.assembler.toStoryPhaseDto(phase);
    }

    /**
     * 更新剧情阶段。
     */
    async updateStoryPhase(
        novelId: number,
        phaseId: number,
        patch: UpdateStoryPhaseRequestDto,
    ): Promise<StoryPhaseDto> {
        const story = await this.ensureStory(novelId);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);

        if (patch.name !== undefined && patch.name !== phase.name) {
            await this.scopeGuard.assertPhaseNameUnique(story.id, patch.name, phase.id);
        }

        const updatedPhase = await this.storyRepository.updatePhase(phase.id, {
            name: patch.name,
            title: patch.title,
            summary: patch.summary,
            note: patch.note,
        });

        return this.assembler.toStoryPhaseDto(updatedPhase);
    }

    /**
     * 删除剧情阶段。
     */
    async deleteStoryPhase(novelId: number, phaseId: number): Promise<void> {
        const story = await this.ensureStory(novelId);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);
        const phaseThreads = await this.threadRepository.findThreadsByStoryPhase(story.id, phase.id);

        let nextSortOrder = await this.orderService.getNextThreadSortOrder(story.id, null);
        for (const thread of phaseThreads) {
            await this.threadRepository.updateThread(thread.id, {
                storyPhaseId: null,
                sortOrder: nextSortOrder,
            });
            nextSortOrder += 1;
        }

        await this.storyRepository.deletePhase(phase.id);
        await this.orderService.normalizePhases(story.id);
    }

    /**
     * 批量重排阶段。
     */
    async reorderStoryPhases(novelId: number, items: ParsedReorderStoryPhaseItem[]): Promise<PlotTreeDto> {
        const story = await this.ensureStory(novelId);
        const existingPhaseIds = await this.scopeGuard.listPhaseIds(story.id);
        const parsedItems = this.orderService.validatePhaseReorderItems(existingPhaseIds, items);

        for (const item of parsedItems) {
            await this.storyRepository.updatePhase(item.phaseId, {sortOrder: item.sortOrder});
        }

        return this.getPlotTree(novelId);
    }
}
