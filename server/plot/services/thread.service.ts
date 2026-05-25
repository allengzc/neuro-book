import type {ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ParsedCreateStoryThreadInput,
    ParsedReorderStoryThreadItem,
    ParsedUpdateStoryThreadInput,
} from "nbook/server/plot/core/types";
import {throwPlotNotFound} from "nbook/server/plot/core/errors";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {
    PlotTreeDto,
    StoryThreadDetailDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Thread 用例服务。
 */
export class ThreadService {
    constructor(
        private readonly threadRepository: ThreadRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly orderService: OrderService,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * 查询线程详情。
     */
    async getStoryThreadDetailDto(projectPath: string, threadId: number): Promise<StoryThreadDetailDto> {
        const story = await this.storyService.ensureStory(projectPath);
        await this.scopeGuard.assertThread(story.id, threadId);
        const thread = await this.threadRepository.findThreadWithScenesById(threadId);
        if (!thread) {
            throwPlotNotFound("剧情线程不存在");
        }
        return this.assembler.toStoryThreadDetailWithoutRefsDto(thread);
    }

    /**
     * 创建线程。
     */
    async createStoryThread(projectPath: string, input: ParsedCreateStoryThreadInput): Promise<StoryThreadDetailDto> {
        const story = await this.storyService.ensureStory(projectPath);

        if (input.storyPhaseId !== null) {
            await this.scopeGuard.assertPhase(story.id, input.storyPhaseId);
        }

        await this.scopeGuard.assertThreadNameUnique(story.id, input.name);
        const thread = await this.threadRepository.createThread({
            storyId: story.id,
            storyPhaseId: input.storyPhaseId,
            sortOrder: await this.orderService.getNextThreadSortOrder(story.id, input.storyPhaseId),
            name: input.name,
            title: input.title,
            isMainThread: input.isMainThread ?? false,
            status: input.status ?? "draft",
            summary: input.summary ?? "",
            tags: input.tags ?? [],
            writingTip: input.writingTip ?? null,
            note: input.note ?? null,
        });
        return this.getStoryThreadDetailDto(projectPath, thread.id);
    }

    /**
     * 更新线程。
     */
    async updateStoryThread(
        projectPath: string,
        threadId: number,
        patch: ParsedUpdateStoryThreadInput,
    ): Promise<StoryThreadDetailDto> {
        const story = await this.storyService.ensureStory(projectPath);
        const thread = await this.scopeGuard.assertThread(story.id, threadId);
        const nextStoryPhaseId = patch.storyPhaseId === undefined
            ? thread.storyPhaseId
            : patch.storyPhaseId;

        if (nextStoryPhaseId !== null) {
            await this.scopeGuard.assertPhase(story.id, nextStoryPhaseId);
        }
        if (patch.name !== undefined && patch.name !== thread.name) {
            await this.scopeGuard.assertThreadNameUnique(story.id, patch.name, thread.id);
        }

        const phaseChanged = nextStoryPhaseId !== thread.storyPhaseId;
        await this.threadRepository.updateThread(thread.id, {
            storyPhaseId: nextStoryPhaseId,
            sortOrder: phaseChanged
                ? await this.orderService.getNextThreadSortOrder(story.id, nextStoryPhaseId)
                : undefined,
            name: patch.name,
            title: patch.title,
            isMainThread: patch.isMainThread,
            status: patch.status,
            summary: patch.summary,
            tags: patch.tags,
            writingTip: patch.writingTip,
            note: patch.note,
        });

        if (phaseChanged) {
            await this.orderService.normalizeThreads(story.id, thread.storyPhaseId);
        }

        return this.getStoryThreadDetailDto(projectPath, thread.id);
    }

    /**
     * 删除线程。
     */
    async deleteStoryThread(projectPath: string, threadId: number): Promise<void> {
        const story = await this.storyService.ensureStory(projectPath);
        const thread = await this.scopeGuard.assertThread(story.id, threadId);
        await this.threadRepository.deleteThread(thread.id);
        await this.orderService.normalizeThreads(story.id, thread.storyPhaseId);
    }

    /**
     * 批量重排线程。
     */
    async reorderStoryThreads(projectPath: string, items: ParsedReorderStoryThreadItem[]): Promise<PlotTreeDto> {
        const story = await this.storyService.ensureStory(projectPath);
        const [existingThreadIds, existingPhaseIds] = await Promise.all([
            this.threadRepository.findThreadIdsByStory(story.id),
            this.scopeGuard.listPhaseIds(story.id),
        ]);
        const parsedItems = this.orderService.validateThreadReorderItems(existingThreadIds, existingPhaseIds, items);

        for (const item of parsedItems) {
            await this.threadRepository.updateThread(item.threadId, {
                storyPhaseId: item.storyPhaseId,
                sortOrder: item.sortOrder,
            });
        }

        return this.storyService.getPlotTree(projectPath);
    }
}
