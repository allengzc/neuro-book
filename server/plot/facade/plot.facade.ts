import {Prisma} from "nbook/server/generated/prisma/client";
import {PrismaClient} from "nbook/server/generated/prisma/client";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {PrismaPlotDataRepository} from "nbook/server/plot/repositories/prisma-plot-data.repository";
import {PrismaSceneRepository} from "nbook/server/plot/repositories/prisma-scene.repository";
import {PrismaStoryRepository} from "nbook/server/plot/repositories/prisma-story.repository";
import {PrismaThreadRepository} from "nbook/server/plot/repositories/prisma-thread.repository";
import type {PrismaExecutor} from "nbook/server/plot/core/types";
import {PlotInputParser} from "nbook/server/plot/http/plot-input.parser";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotService} from "nbook/server/plot/services/plot.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {SceneService} from "nbook/server/plot/services/scene.service";
import {StoryService} from "nbook/server/plot/services/story.service";
import {ThreadService} from "nbook/server/plot/services/thread.service";
import {
    mergeContentDiagnostics,
    processTextFieldsWithResults,
    processStructuredReferences,
    toResponseContentDiagnostics,
} from "nbook/server/content/content-middleware";
import {STORY_STRUCTURED_REFERENCE_KINDS} from "nbook/shared/reference-core";
import type {
    ChapterPlotDetailDto,
    PlotWorkbenchDto,
    CreateStoryPhaseRequestDto,
    CreateStoryPlotRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    PlotTreeDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryPlotsRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    StoryDto,
    StoryPhaseDto,
    StoryPlotDto,
    StorySceneDetailDto,
    StorySceneWriteResponseDto,
    StoryThreadDetailDto,
    StoryThreadWriteResponseDto,
    StoryPlotWriteResponseDto,
    UpdateStoryPhaseRequestDto,
    UpdateStoryPlotRequestDto,
    UpdateStoryRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";

type PlotModule = {
    inputParser: PlotInputParser;
    storyService: StoryService;
    threadService: ThreadService;
    sceneService: SceneService;
    plotService: PlotService;
    refResolverService: RefResolverService;
};

/**
 * 剧情模块门面。
 */
export class PlotFacade {
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * 查询 Story。
     */
    async getStoryDto(novelId: number): Promise<StoryDto> {
        return this.createModule(this.prisma).storyService.getStoryDto(novelId);
    }

    /**
     * 更新 Story。
     */
    async updateStory(novelId: number, patch: UpdateStoryRequestDto): Promise<StoryDto> {
        return this.runInTransaction((module) => module.storyService.updateStory(novelId, patch));
    }

    /**
     * 查询剧情树。
     */
    async getPlotTree(novelId: number): Promise<PlotTreeDto> {
        return this.createModule(this.prisma).storyService.getPlotTree(novelId);
    }

    /**
     * 查询剧本工作台聚合数据。
     */
    async getPlotWorkbench(novelId: number): Promise<PlotWorkbenchDto> {
        return this.createModule(this.prisma).storyService.getPlotWorkbench(novelId);
    }

    /**
     * 查询阶段详情。
     */
    async getStoryPhaseDto(novelId: number, phaseId: number): Promise<StoryPhaseDto> {
        return this.createModule(this.prisma).storyService.getStoryPhaseDto(novelId, phaseId);
    }

    /**
     * 创建阶段。
     */
    async createStoryPhase(novelId: number, input: CreateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        return this.runInTransaction((module) => module.storyService.createStoryPhase(novelId, input));
    }

    /**
     * 更新阶段。
     */
    async updateStoryPhase(novelId: number, phaseId: number, patch: UpdateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        return this.runInTransaction((module) => module.storyService.updateStoryPhase(novelId, phaseId, patch));
    }

    /**
     * 删除阶段。
     */
    async deleteStoryPhase(novelId: number, phaseId: number): Promise<void> {
        await this.runInTransaction((module) => module.storyService.deleteStoryPhase(novelId, phaseId));
    }

    /**
     * 重排阶段。
     */
    async reorderStoryPhases(novelId: number, input: ReorderStoryPhasesRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction((module) => (
            module.storyService.reorderStoryPhases(novelId, module.inputParser.parseReorderPhases(input))
        ));
    }

    /**
     * 查询线程详情。
     */
    async getStoryThreadDetailDto(novelId: number, threadId: number): Promise<StoryThreadDetailDto> {
        return this.createModule(this.prisma).threadService.getStoryThreadDetailDto(novelId, threadId);
    }

    /**
     * 创建线程。
     */
    async createStoryThread(novelId: number, input: CreateStoryThreadRequestDto): Promise<StoryThreadWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const detail = await module.threadService.createStoryThread(novelId, module.inputParser.parseCreateThread({
                ...processedInput.values,
            }));
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedInput.diagnostics),
            };
        });
    }

    /**
     * 更新线程。
     */
    async updateStoryThread(
        novelId: number,
        threadId: number,
        patch: UpdateStoryThreadRequestDto,
    ): Promise<StoryThreadWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const detail = await module.threadService.updateStoryThread(
                novelId,
                threadId,
                module.inputParser.parseUpdateThread({
                    ...processedPatch.values,
                }),
            );
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedPatch.diagnostics),
            };
        });
    }

    /**
     * 删除线程。
     */
    async deleteStoryThread(novelId: number, threadId: number): Promise<void> {
        await this.runInTransaction((module) => module.threadService.deleteStoryThread(novelId, threadId));
    }

    /**
     * 重排线程。
     */
    async reorderStoryThreads(novelId: number, input: ReorderStoryThreadsRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction((module) => (
            module.threadService.reorderStoryThreads(novelId, module.inputParser.parseReorderThreads(input))
        ));
    }

    /**
     * 查询 Scene 详情。
     */
    async getStorySceneDetailDto(novelId: number, sceneId: number): Promise<StorySceneDetailDto> {
        return this.createModule(this.prisma).sceneService.getStorySceneDetailDto(novelId, sceneId);
    }

    /**
     * 查询章节下的剧情 Scene 与 Plot。
     */
    async getChapterPlotDetailDto(novelId: number, chapterPath: string): Promise<ChapterPlotDetailDto> {
        return this.createModule(this.prisma).sceneService.getChapterPlotDetailDto(novelId, chapterPath);
    }

    /**
     * 创建 Scene。
     */
    async createStoryScene(novelId: number, input: CreateStorySceneRequestDto): Promise<StorySceneWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const story = await module.storyService.ensureStory(novelId);
            const processedRefs = await processStructuredReferences({
                refs: processedInput.values.refs ?? [],
                allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                label: "plot",
                resolve: (nextRefs) => module.refResolverService.resolveRefs(novelId, story.id, nextRefs),
            });
            const detail = await module.sceneService.createStoryScene(novelId, module.inputParser.parseCreateScene({
                ...processedInput.values,
                refs: processedRefs.normalized,
                resolvedRefs: processedRefs.resolved,
            }));
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
                    processedInput.diagnostics,
                    processedRefs.diagnostics,
                )),
            };
        });
    }

    /**
     * 更新 Scene。
     */
    async updateStoryScene(
        novelId: number,
        sceneId: number,
        patch: UpdateStorySceneRequestDto,
    ): Promise<StorySceneWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const story = await module.storyService.ensureStory(novelId);
            const processedRefs = processedPatch.values.refs === undefined
                ? null
                : await processStructuredReferences({
                    refs: processedPatch.values.refs,
                    allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                    label: "plot",
                    resolve: (nextRefs) => module.refResolverService.resolveRefs(novelId, story.id, nextRefs),
                });
            const detail = await module.sceneService.updateStoryScene(
                novelId,
                sceneId,
                module.inputParser.parseUpdateScene({
                    ...processedPatch.values,
                    refs: processedRefs?.normalized,
                    resolvedRefs: processedRefs?.resolved,
                }),
            );
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
                    processedPatch.diagnostics,
                    processedRefs?.diagnostics ?? {errors: [], warnings: [], notes: []},
                )),
            };
        });
    }

    /**
     * 删除 Scene。
     */
    async deleteStoryScene(novelId: number, sceneId: number): Promise<void> {
        await this.runInTransaction((module) => module.sceneService.deleteStoryScene(novelId, sceneId));
    }

    /**
     * 重排 Scene。
     */
    async reorderStoryScenes(novelId: number, input: ReorderStoryScenesRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction((module) => (
            module.sceneService.reorderStoryScenes(novelId, module.inputParser.parseReorderScenes(input))
        ));
    }

    /**
     * 查询 Plot 详情。
     */
    async getStoryPlotDto(novelId: number, plotId: number): Promise<StoryPlotDto> {
        return this.createModule(this.prisma).plotService.getStoryPlotDto(novelId, plotId);
    }

    /**
     * 创建 Plot。
     */
    async createStoryPlot(novelId: number, input: CreateStoryPlotRequestDto): Promise<StoryPlotWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const detail = await module.plotService.createStoryPlot(
                novelId,
                module.inputParser.parseCreatePlot(processedInput.values),
            );
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedInput.diagnostics),
            };
        });
    }

    /**
     * 更新 Plot。
     */
    async updateStoryPlot(novelId: number, plotId: number, patch: UpdateStoryPlotRequestDto): Promise<StoryPlotWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const detail = await module.plotService.updateStoryPlot(
                novelId,
                plotId,
                module.inputParser.parseUpdatePlot(processedPatch.values),
            );
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedPatch.diagnostics),
            };
        });
    }

    /**
     * 删除 Plot。
     */
    async deleteStoryPlot(novelId: number, plotId: number): Promise<void> {
        await this.runInTransaction((module) => module.plotService.deleteStoryPlot(novelId, plotId));
    }

    /**
     * 重排 Plot。
     */
    async reorderStoryPlots(novelId: number, input: ReorderStoryPlotsRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction((module) => (
            module.plotService.reorderStoryPlots(novelId, module.inputParser.parseReorderPlots(input))
        ));
    }

    /**
     * 在事务里执行写操作。
     */
    private runInTransaction<TResult>(callback: (module: PlotModule) => Promise<TResult>): Promise<TResult> {
        return this.prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
            return callback(this.createModule(transactionClient));
        });
    }

    /**
     * 按执行器构建剧情模块对象图。
     */
    private createModule(executor: PrismaExecutor): PlotModule {
        const inputParser = new PlotInputParser();
        const assembler = new PlotDtoAssembler();
        const storyRepository = new PrismaStoryRepository(executor);
        const threadRepository = new PrismaThreadRepository(executor);
        const sceneRepository = new PrismaSceneRepository(executor);
        const plotRepository = new PrismaPlotDataRepository(executor);
        const orderService = new OrderService(storyRepository, threadRepository, sceneRepository, plotRepository);
        const scopeGuard = new PlotScopeGuard(
            storyRepository,
            threadRepository,
            sceneRepository,
            plotRepository,
            plotRepository,
        );
        const storyService = new StoryService(
            storyRepository,
            threadRepository,
            plotRepository,
            plotRepository,
            orderService,
            assembler,
            scopeGuard,
        );
        const refResolverService = new RefResolverService(plotRepository, threadRepository, scopeGuard);
        const threadService = new ThreadService(
            threadRepository,
            storyService,
            scopeGuard,
            orderService,
            assembler,
        );
        const sceneService = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            refResolverService,
            assembler,
        );
        const plotService = new PlotService(
            plotRepository,
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            assembler,
        );

        return {
            inputParser,
            storyService,
            threadService,
            sceneService,
            plotService,
            refResolverService,
        };
    }
}
