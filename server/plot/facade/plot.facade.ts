import {PrismaLibSql} from "@prisma/adapter-libsql";
import {Prisma, PrismaClient} from "nbook/server/generated/project-prisma/client";
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
import {initProjectDatabase, normalizeProjectPath, resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
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
    CreateStoryPlotsRequestDto,
    CreateStoryPlotsResponseDto,
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
    private readonly clients = new Map<string, PrismaClient>();

    constructor() {}

    /**
     * 查询 Story。
     */
    async getStoryDto(projectPath: string): Promise<StoryDto> {
        return (await this.createModule(projectPath)).storyService.getStoryDto(normalizeProjectPath(projectPath));
    }

    /**
     * 更新 Story。
     */
    async updateStory(projectPath: string, patch: UpdateStoryRequestDto): Promise<StoryDto> {
        return this.runInTransaction(projectPath, (module) => module.storyService.updateStory(normalizeProjectPath(projectPath), patch));
    }

    /**
     * 查询剧情树。
     */
    async getPlotTree(projectPath: string): Promise<PlotTreeDto> {
        return (await this.createModule(projectPath)).storyService.getPlotTree(normalizeProjectPath(projectPath));
    }

    /**
     * 查询剧本工作台聚合数据。
     */
    async getPlotWorkbench(projectPath: string): Promise<PlotWorkbenchDto> {
        return (await this.createModule(projectPath)).storyService.getPlotWorkbench(normalizeProjectPath(projectPath));
    }

    /**
     * 查询阶段详情。
     */
    async getStoryPhaseDto(projectPath: string, phaseId: number): Promise<StoryPhaseDto> {
        return (await this.createModule(projectPath)).storyService.getStoryPhaseDto(normalizeProjectPath(projectPath), phaseId);
    }

    /**
     * 创建阶段。
     */
    async createStoryPhase(projectPath: string, input: CreateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        return this.runInTransaction(projectPath, (module) => module.storyService.createStoryPhase(normalizeProjectPath(projectPath), input));
    }

    /**
     * 更新阶段。
     */
    async updateStoryPhase(projectPath: string, phaseId: number, patch: UpdateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        return this.runInTransaction(projectPath, (module) => module.storyService.updateStoryPhase(normalizeProjectPath(projectPath), phaseId, patch));
    }

    /**
     * 删除阶段。
     */
    async deleteStoryPhase(projectPath: string, phaseId: number): Promise<void> {
        await this.runInTransaction(projectPath, (module) => module.storyService.deleteStoryPhase(normalizeProjectPath(projectPath), phaseId));
    }

    /**
     * 重排阶段。
     */
    async reorderStoryPhases(projectPath: string, input: ReorderStoryPhasesRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction(projectPath, (module) => (
            module.storyService.reorderStoryPhases(normalizeProjectPath(projectPath), module.inputParser.parseReorderPhases(input))
        ));
    }

    /**
     * 查询线程详情。
     */
    async getStoryThreadDetailDto(projectPath: string, threadId: number): Promise<StoryThreadDetailDto> {
        return (await this.createModule(projectPath)).threadService.getStoryThreadDetailDto(normalizeProjectPath(projectPath), threadId);
    }

    /**
     * 创建线程。
     */
    async createStoryThread(projectPath: string, input: CreateStoryThreadRequestDto): Promise<StoryThreadWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
            const detail = await module.threadService.createStoryThread(normalizeProjectPath(projectPath), module.inputParser.parseCreateThread({
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
        projectPath: string,
        threadId: number,
        patch: UpdateStoryThreadRequestDto,
    ): Promise<StoryThreadWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
            const detail = await module.threadService.updateStoryThread(
                normalizeProjectPath(projectPath),
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
    async deleteStoryThread(projectPath: string, threadId: number): Promise<void> {
        await this.runInTransaction(projectPath, (module) => module.threadService.deleteStoryThread(normalizeProjectPath(projectPath), threadId));
    }

    /**
     * 重排线程。
     */
    async reorderStoryThreads(projectPath: string, input: ReorderStoryThreadsRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction(projectPath, (module) => (
            module.threadService.reorderStoryThreads(normalizeProjectPath(projectPath), module.inputParser.parseReorderThreads(input))
        ));
    }

    /**
     * 查询 Scene 详情。
     */
    async getStorySceneDetailDto(projectPath: string, sceneId: number): Promise<StorySceneDetailDto> {
        return (await this.createModule(projectPath)).sceneService.getStorySceneDetailDto(normalizeProjectPath(projectPath), sceneId);
    }

    /**
     * 查询章节下的剧情 Scene 与 Plot。
     */
    async getChapterPlotDetailDto(projectPath: string, chapterPath: string): Promise<ChapterPlotDetailDto> {
        return (await this.createModule(projectPath)).sceneService.getChapterPlotDetailDto(normalizeProjectPath(projectPath), chapterPath);
    }

    /**
     * 创建 Scene。
     */
    async createStoryScene(projectPath: string, input: CreateStorySceneRequestDto): Promise<StorySceneWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
            const story = await module.storyService.ensureStory(normalizeProjectPath(projectPath));
            const processedRefs = await processStructuredReferences({
                refs: processedInput.values.refs ?? [],
                allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                label: "plot",
                resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs),
            });
            const detail = await module.sceneService.createStoryScene(normalizeProjectPath(projectPath), module.inputParser.parseCreateScene({
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
        projectPath: string,
        sceneId: number,
        patch: UpdateStorySceneRequestDto,
    ): Promise<StorySceneWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
            const story = await module.storyService.ensureStory(normalizeProjectPath(projectPath));
            const processedRefs = processedPatch.values.refs === undefined
                ? null
                : await processStructuredReferences({
                    refs: processedPatch.values.refs,
                    allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                    label: "plot",
                    resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs),
                });
            const detail = await module.sceneService.updateStoryScene(
                normalizeProjectPath(projectPath),
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
    async deleteStoryScene(projectPath: string, sceneId: number): Promise<void> {
        await this.runInTransaction(projectPath, (module) => module.sceneService.deleteStoryScene(normalizeProjectPath(projectPath), sceneId));
    }

    /**
     * 重排 Scene。
     */
    async reorderStoryScenes(projectPath: string, input: ReorderStoryScenesRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction(projectPath, (module) => (
            module.sceneService.reorderStoryScenes(normalizeProjectPath(projectPath), module.inputParser.parseReorderScenes(input))
        ));
    }

    /**
     * 查询 Plot 详情。
     */
    async getStoryPlotDto(projectPath: string, plotId: number): Promise<StoryPlotDto> {
        return (await this.createModule(projectPath)).plotService.getStoryPlotDto(normalizeProjectPath(projectPath), plotId);
    }

    /**
     * 创建 Plot。
     */
    async createStoryPlot(projectPath: string, input: CreateStoryPlotRequestDto): Promise<StoryPlotWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
            const detail = await module.plotService.createStoryPlot(
                normalizeProjectPath(projectPath),
                module.inputParser.parseCreatePlot(processedInput.values),
            );
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedInput.diagnostics),
            };
        });
    }

    /**
     * 在同一 Scene 下批量创建 Plot。
     */
    async createStoryPlots(projectPath: string, input: CreateStoryPlotsRequestDto): Promise<CreateStoryPlotsResponseDto> {
        let diagnostics = {errors: [] as string[], warnings: [] as string[], notes: [] as string[]};
        const processedPlots = input.plots.map((plot) => {
            const processedPlot = processTextFieldsWithResults(plot, ["summary", "effect", "writingTip", "note"]);
            diagnostics = mergeContentDiagnostics(diagnostics, processedPlot.diagnostics);
            return processedPlot.values;
        });
        const processedInput = {...input, plots: processedPlots};

        return this.runInTransaction(projectPath, async (module) => {
            const normalizedProjectPath = normalizeProjectPath(projectPath);
            const parsedInput = module.inputParser.parseCreatePlots(processedInput);
            const createdPlots = await module.plotService.createStoryPlots(normalizedProjectPath, parsedInput);
            const scene = await module.sceneService.getStorySceneDetailDto(normalizedProjectPath, parsedInput.sceneId);

            return {
                scene,
                createdPlots,
                diagnostics: toResponseContentDiagnostics(diagnostics),
            };
        });
    }

    /**
     * 更新 Plot。
     */
    async updateStoryPlot(projectPath: string, plotId: number, patch: UpdateStoryPlotRequestDto): Promise<StoryPlotWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
            const detail = await module.plotService.updateStoryPlot(
                normalizeProjectPath(projectPath),
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
    async deleteStoryPlot(projectPath: string, plotId: number): Promise<void> {
        await this.runInTransaction(projectPath, (module) => module.plotService.deleteStoryPlot(normalizeProjectPath(projectPath), plotId));
    }

    /**
     * 重排 Plot。
     */
    async reorderStoryPlots(projectPath: string, input: ReorderStoryPlotsRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction(projectPath, (module) => (
            module.plotService.reorderStoryPlots(normalizeProjectPath(projectPath), module.inputParser.parseReorderPlots(input))
        ));
    }

    /**
     * 在事务里执行写操作。
     */
    private async runInTransaction<TResult>(projectPath: string, callback: (module: PlotModule) => Promise<TResult>): Promise<TResult> {
        const prisma = await this.client(projectPath);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
            return callback(this.createModuleFromExecutor(transactionClient, normalizedProjectPath));
        });
    }

    /**
     * 按执行器构建剧情模块对象图。
     */
    private async createModule(projectPath: string): Promise<PlotModule> {
        return this.createModuleFromExecutor(await this.client(projectPath), normalizeProjectPath(projectPath));
    }

    /**
     * 按 Project Path 返回 Project SQLite PrismaClient。
     */
    private async client(projectPath: string): Promise<PrismaClient> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        await initProjectDatabase(normalizedProjectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        const cacheKey = databasePath.replace(/\\/g, "/");
        const existing = this.clients.get(cacheKey);
        if (existing) {
            return existing;
        }
        const client = new PrismaClient({
            adapter: new PrismaLibSql({url: toSqliteFileUrl(databasePath)}),
        });
        this.clients.set(cacheKey, client);
        return client;
    }

    /**
     * 按执行器构建剧情模块对象图。
     */
    private createModuleFromExecutor(executor: PrismaExecutor, _projectPath: string): PlotModule {
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
        );
        const storyService = new StoryService(
            storyRepository,
            threadRepository,
            plotRepository,
            orderService,
            assembler,
            scopeGuard,
        );
        const refResolverService = new RefResolverService(threadRepository, scopeGuard);
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
