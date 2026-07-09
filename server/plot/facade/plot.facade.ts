import {Prisma, PrismaClient} from "nbook/server/generated/project-prisma/client";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {PrismaChapterRepository} from "nbook/server/plot/repositories/prisma-chapter.repository";
import {PrismaSceneRepository} from "nbook/server/plot/repositories/prisma-scene.repository";
import {PrismaStoryRepository} from "nbook/server/plot/repositories/prisma-story.repository";
import {PrismaThreadRepository} from "nbook/server/plot/repositories/prisma-thread.repository";
import type {PrismaExecutor, SceneWorldAnchor} from "nbook/server/plot/core/types";
import {PlotInputParser} from "nbook/server/plot/http/plot-input.parser";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {ChapterService} from "nbook/server/plot/services/chapter.service";
import {ChapterBootstrapService, writeProsePointers, type CarrierTreeBootstrapResult} from "nbook/server/plot/services/chapter-bootstrap.service";
import {ChapterProseService, type ChapterProseNode} from "nbook/server/plot/services/chapter-prose.service";
import {OrderService} from "nbook/server/plot/services/order.service";
import {ChapterWriterBriefService} from "nbook/server/plot/services/chapter-writer-brief.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {SceneService} from "nbook/server/plot/services/scene.service";
import {SceneWorldAnchorValidator} from "nbook/server/plot/services/scene-world-anchor.validator";
import {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import {StoryService} from "nbook/server/plot/services/story.service";
import {ThreadService} from "nbook/server/plot/services/thread.service";
import {initProjectDatabase, normalizeProjectPath, resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {touchProjectResources} from "nbook/server/workspace-files/project-resources";
import {readProjectWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import {worldEngineFacade} from "nbook/server/world-engine";
import {
    mergeContentDiagnostics,
    processTextFieldsWithResults,
    processStructuredReferences,
    toResponseContentDiagnostics,
} from "nbook/server/content/content-middleware";
import {STORY_STRUCTURED_REFERENCE_KINDS} from "nbook/shared/reference-core";
import type {
    ChapterPlotDetailDto,
    ChapterWriterBriefDto,
    ChapterWriterBriefMode,
    PlotWorkbenchDto,
    CreateStoryActRequestDto,
    CreateStoryChapterRequestDto,
    CreateStoryPhaseRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    PlotTreeDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    SceneWorldContextDto,
    StoryActDto,
    StoryChapterDto,
    StoryDto,
    StoryPhaseDto,
    StorySceneDetailDto,
    StorySceneWriteResponseDto,
    StoryThreadDetailDto,
    StoryThreadWriteResponseDto,
    UpdateStoryActRequestDto,
    UpdateStoryChapterRequestDto,
    UpdateStoryPhaseRequestDto,
    UpdateStoryRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
    StorySceneWorldAnchorInputDto,
    StorySceneWorldAnchorDto,
} from "nbook/shared/dto/plot.dto";

type PlotModule = {
    inputParser: PlotInputParser;
    storyService: StoryService;
    threadService: ThreadService;
    sceneService: SceneService;
    chapterService: ChapterService;
    chapterBootstrapService: ChapterBootstrapService;
    sceneWorldContextService: SceneWorldContextService;
    chapterWriterBriefService: ChapterWriterBriefService;
    refResolverService: RefResolverService;
};

type PlotClientEntry = {
    client: PrismaClient;
    adapter: TrackedPrismaLibSql;
};

/**
 * 剧情模块门面。
 */
export class PlotFacade {
    private readonly clients = new Map<string, PlotClientEntry>();
    private readonly sceneWorldAnchorResolutionService = new SceneWorldAnchorResolutionService(worldEngineFacade);
    // Prose 反指解析不依赖 Project SQLite,直接复用 workspace 内存索引,做 facade 级单例。
    private readonly chapterProseService = new ChapterProseService();

    constructor() {}

    /**
     * 解析指定章的 Prose 文件(frontmatter `chapter: <name>` 反指)。
     */
    async findProseForChapter(projectPath: string, chapterName: string): Promise<ChapterProseNode[]> {
        return this.chapterProseService.findProseForChapter(normalizeProjectPath(projectPath), chapterName);
    }

    /**
     * 按已注册 Chapter name 分拣孤儿 Prose 指针。
     */
    async findOrphanProsePointers(projectPath: string): Promise<ChapterProseNode[]> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const module = await this.createModule(projectPath);
        const story = await module.storyService.ensureStory(normalizedProjectPath);
        const chapters = await module.chapterService.listChapterNames(normalizedProjectPath, story.id);
        return this.chapterProseService.findOrphanPointers(normalizedProjectPath, new Set(chapters));
    }

    /**
     * 承载树 Bootstrap:把现有 manuscript 目录导入 Act/Chapter,并回写 Prose frontmatter 反指。
     * 一次性迁移工具,幂等可重跑。
     *
     * 事务边界:manuscript 目录扫描(事务前)与 frontmatter 回写(事务提交后)都是慢文件 I/O,必须留在
     * DB interactive transaction 之外——否则真实项目会撑爆默认 5s 事务超时(Task 87 实测踩坑)。
     * 事务内只做 Act/Chapter 的纯 DB 写入。
     */
    async bootstrapCarrierTree(projectPath: string): Promise<CarrierTreeBootstrapResult> {
        const normalized = normalizeProjectPath(projectPath);
        const snapshot = await readProjectWorkspaceTreeSnapshot({root: normalized});
        const dbResult = await this.runInTransaction(normalized, (module) => module.chapterBootstrapService.applyCarrierTree(normalized, snapshot.nodes));
        const fsResult = await writeProsePointers(normalized, dbResult.pendingPointers);
        return {
            actsCreated: dbResult.actsCreated,
            chaptersCreated: dbResult.chaptersCreated,
            chaptersLinkedToAct: dbResult.chaptersLinkedToAct,
            proseFrontmatterWritten: fsResult.proseFrontmatterWritten,
            warnings: fsResult.warnings,
        };
    }

    /**
     * 关闭指定 Project SQLite 的 PrismaClient。Project 删除前必须先释放文件句柄。
     */
    async closeProject(projectPath: string): Promise<void> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        const cacheKey = databasePath.replace(/\\/g, "/");
        const entry = this.clients.get(cacheKey);
        if (!entry) {
            return;
        }
        this.clients.delete(cacheKey);
        await entry.client.$disconnect();
        entry.adapter.closeTrackedClients();
        collectReleasedSqliteHandles();
    }

    /**
     * 关闭全部已打开的 Project SQLite PrismaClient。服务关停与统一资源生命周期用。
     */
    async closeAllProjects(): Promise<void> {
        const entries = [...this.clients.values()];
        this.clients.clear();
        for (const entry of entries) {
            await entry.client.$disconnect();
            entry.adapter.closeTrackedClients();
        }
        collectReleasedSqliteHandles();
    }

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
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return this.formatPlotTreeAnchors(normalizedProjectPath, await (await this.createModule(projectPath)).storyService.getPlotTree(normalizedProjectPath));
    }

    /**
     * 查询剧本工作台聚合数据。
     */
    async getPlotWorkbench(projectPath: string): Promise<PlotWorkbenchDto> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return this.formatPlotWorkbenchAnchors(normalizedProjectPath, await (await this.createModule(projectPath)).storyService.getPlotWorkbench(normalizedProjectPath));
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
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return this.formatThreadDetailAnchors(normalizedProjectPath, await (await this.createModule(projectPath)).threadService.getStoryThreadDetailDto(normalizedProjectPath, threadId));
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
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return this.formatSceneDetailAnchor(normalizedProjectPath, await (await this.createModule(projectPath)).sceneService.getStorySceneDetailDto(normalizedProjectPath, sceneId));
    }

    /**
     * 查询章节下的剧情 Scene。
     */
    async getChapterPlotDetailDto(projectPath: string, chapterId: number): Promise<ChapterPlotDetailDto> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return this.formatChapterPlotAnchors(normalizedProjectPath, await (await this.createModule(projectPath)).sceneService.getChapterPlotDetailDto(normalizedProjectPath, chapterId));
    }

    /**
     * 查询章节 writer brief。
     * @param mode 防全知模式;默认 autonomous。
     */
    async getChapterWriterBrief(projectPath: string, chapterId: number, mode: ChapterWriterBriefMode = "autonomous"): Promise<ChapterWriterBriefDto> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return (await this.createModule(projectPath)).chapterWriterBriefService.getChapterWriterBrief(normalizedProjectPath, chapterId, mode);
    }

    /**
     * 查询卷详情。
     */
    async getStoryActDto(projectPath: string, actId: number): Promise<StoryActDto> {
        return (await this.createModule(projectPath)).chapterService.getStoryActDto(normalizeProjectPath(projectPath), actId);
    }

    /**
     * 创建卷。
     */
    async createStoryAct(projectPath: string, input: CreateStoryActRequestDto): Promise<StoryActDto> {
        return this.runInTransaction(projectPath, (module) => module.chapterService.createStoryAct(normalizeProjectPath(projectPath), input));
    }

    /**
     * 更新卷。
     */
    async updateStoryAct(projectPath: string, actId: number, patch: UpdateStoryActRequestDto): Promise<StoryActDto> {
        return this.runInTransaction(projectPath, (module) => module.chapterService.updateStoryAct(normalizeProjectPath(projectPath), actId, patch));
    }

    /**
     * 删除卷。
     */
    async deleteStoryAct(projectPath: string, actId: number): Promise<void> {
        await this.runInTransaction(projectPath, (module) => module.chapterService.deleteStoryAct(normalizeProjectPath(projectPath), actId));
    }

    /**
     * 查询章详情(含 ChapterBrief)。
     */
    async getStoryChapterDto(projectPath: string, chapterId: number): Promise<StoryChapterDto> {
        return (await this.createModule(projectPath)).chapterService.getStoryChapterDto(normalizeProjectPath(projectPath), chapterId);
    }

    /**
     * 创建章。
     */
    async createStoryChapter(projectPath: string, input: CreateStoryChapterRequestDto): Promise<StoryChapterDto> {
        const processedInput = processTextFieldsWithResults(input, ["note"]);
        return this.runInTransaction(projectPath, (module) => (
            module.chapterService.createStoryChapter(normalizeProjectPath(projectPath), module.inputParser.parseCreateChapter({
                ...processedInput.values,
            }))
        ));
    }

    /**
     * 更新章(含 ChapterBrief 字段)。
     */
    async updateStoryChapter(projectPath: string, chapterId: number, patch: UpdateStoryChapterRequestDto): Promise<StoryChapterDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["note"]);
        return this.runInTransaction(projectPath, (module) => (
            module.chapterService.updateStoryChapter(normalizeProjectPath(projectPath), chapterId, module.inputParser.parseUpdateChapter({
                ...processedPatch.values,
            }))
        ));
    }

    /**
     * 删除章。
     */
    async deleteStoryChapter(projectPath: string, chapterId: number): Promise<void> {
        await this.runInTransaction(projectPath, (module) => module.chapterService.deleteStoryChapter(normalizeProjectPath(projectPath), chapterId));
    }

    /**
     * 查询 Scene 对应的 World Engine 上下文。
     */
    async getSceneWorldContext(projectPath: string, sceneId: number): Promise<SceneWorldContextDto> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return (await this.createModule(projectPath)).sceneWorldContextService.getSceneWorldContext(normalizedProjectPath, sceneId);
    }

    /**
     * 创建 Scene。
     */
    async createStoryScene(projectPath: string, input: CreateStorySceneRequestDto): Promise<StorySceneWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "purpose", "writingTip", "note"]);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const result = await this.runInTransaction(projectPath, async (module) => {
            const story = await module.storyService.ensureStory(normalizedProjectPath);
            const processedRefs = await processStructuredReferences({
                refs: processedInput.values.refs ?? [],
                allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                label: "plot",
                resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs),
            });
            const detail = await module.sceneService.createStoryScene(normalizeProjectPath(projectPath), module.inputParser.parseCreateScene({
                ...processedInput.values,
                worldAnchor: await this.parseWorldAnchorDto(normalizedProjectPath, processedInput.values.worldAnchor),
                refs: processedRefs.normalized,
                resolvedRefs: processedRefs.resolved,
            }));
            return {
                detail,
                diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
                    processedInput.diagnostics,
                    processedRefs.diagnostics,
                )),
            };
        });
        return {
            ...await this.formatSceneDetailAnchor(normalizedProjectPath, result.detail),
            diagnostics: result.diagnostics,
        };
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
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const result = await this.runInTransaction(projectPath, async (module) => {
            const story = await module.storyService.ensureStory(normalizedProjectPath);
            const processedRefs = processedPatch.values.refs === undefined
                ? null
                : await processStructuredReferences({
                    refs: processedPatch.values.refs,
                    allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                    label: "plot",
                    resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs),
                });
            const detail = await module.sceneService.updateStoryScene(
                normalizedProjectPath,
                sceneId,
                module.inputParser.parseUpdateScene({
                    ...processedPatch.values,
                    worldAnchor: processedPatch.values.worldAnchor === undefined
                        ? undefined
                        : await this.parseWorldAnchorDto(normalizedProjectPath, processedPatch.values.worldAnchor),
                    refs: processedRefs?.normalized,
                    resolvedRefs: processedRefs?.resolved,
                }),
            );
            return {
                detail,
                diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
                    processedPatch.diagnostics,
                    processedRefs?.diagnostics ?? {errors: [], warnings: [], notes: []},
                )),
            };
        });
        return {
            ...await this.formatSceneDetailAnchor(normalizedProjectPath, result.detail),
            diagnostics: result.diagnostics,
        };
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
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const tree = await this.runInTransaction(projectPath, async (module) => (
            module.sceneService.reorderStoryScenes(normalizedProjectPath, module.inputParser.parseReorderScenes(input))
        ));
        return this.formatPlotTreeAnchors(normalizedProjectPath, tree);
    }

    /**
     * 将 HTTP DTO 的日历字符串解析为服务层 World Anchor。
     */
    private async parseWorldAnchorDto(projectPath: string, dto?: StorySceneWorldAnchorInputDto): Promise<SceneWorldAnchor> {
        if (!dto) {
            return {
                startInstant: null,
                endInstant: null,
                subjectIds: [],
                locationSubjectId: null,
            };
        }

        return {
            startInstant: dto.startTime === null ? null : await worldEngineFacade.parseTime(projectPath, dto.startTime),
            endInstant: dto.endTime === null ? null : await worldEngineFacade.parseTime(projectPath, dto.endTime),
            subjectIds: dto.subjectIds.map((subjectId) => subjectId.trim()),
            locationSubjectId: dto.locationSubjectId === null ? null : dto.locationSubjectId.trim(),
        };
    }

    /**
     * 格式化剧情树里所有 Scene 的 World Anchor。
     */
    private async formatPlotTreeAnchors(projectPath: string, tree: PlotTreeDto): Promise<PlotTreeDto> {
        const anchorMap = await this.resolveSceneAnchorMap(projectPath, [
            ...tree.phases.flatMap((phase) => phase.threads.flatMap((thread) => thread.scenes)),
            ...tree.ungroupedThreads.flatMap((thread) => thread.scenes),
        ]);
        return {
            ...tree,
            phases: await Promise.all(tree.phases.map(async (phase) => ({
                ...phase,
                threads: await Promise.all(phase.threads.map(async (thread) => ({
                    ...thread,
                    scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
                }))),
            }))),
            ungroupedThreads: await Promise.all(tree.ungroupedThreads.map(async (thread) => ({
                ...thread,
                scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
            }))),
        };
    }

    /**
     * 格式化工作台里所有 Scene 的 World Anchor。
     */
    private async formatPlotWorkbenchAnchors(projectPath: string, workbench: PlotWorkbenchDto): Promise<PlotWorkbenchDto> {
        const anchorMap = await this.resolveSceneAnchorMap(projectPath, [
            ...workbench.phases.flatMap((phase) => phase.threads.flatMap((thread) => thread.scenes)),
            ...workbench.ungroupedThreads.flatMap((thread) => thread.scenes),
        ]);
        return {
            ...workbench,
            phases: await Promise.all(workbench.phases.map(async (phase) => ({
                ...phase,
                threads: await Promise.all(phase.threads.map(async (thread) => ({
                    ...thread,
                    scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
                }))),
            }))),
            ungroupedThreads: await Promise.all(workbench.ungroupedThreads.map(async (thread) => ({
                ...thread,
                scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
            }))),
        };
    }

    /**
     * 格式化 Thread 详情里的 Scene World Anchor。
     */
    private async formatThreadDetailAnchors(projectPath: string, detail: StoryThreadDetailDto): Promise<StoryThreadDetailDto> {
        const anchorMap = await this.resolveSceneAnchorMap(projectPath, detail.scenes ?? []);
        return {
            ...detail,
            scenes: detail.scenes === undefined
                ? undefined
                : detail.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
        };
    }

    /**
     * 格式化 Scene 详情里的 World Anchor。
     */
    private async formatSceneDetailAnchor(projectPath: string, detail: StorySceneDetailDto): Promise<StorySceneDetailDto> {
        return {
            ...detail,
            worldAnchor: await this.sceneWorldAnchorResolutionService.resolve(projectPath, detail.worldAnchor),
        };
    }

    /**
     * 格式化章节剧情里的 Scene World Anchor。
     */
    private async formatChapterPlotAnchors(projectPath: string, detail: ChapterPlotDetailDto): Promise<ChapterPlotDetailDto> {
        const anchorMap = await this.resolveSceneAnchorMap(projectPath, detail.scenes);
        return {
            ...detail,
            scenes: detail.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
        };
    }

    /**
     * 批量解析 Scene 摘要中的 World Anchor。
     */
    private async resolveSceneAnchorMap<TScene extends {worldAnchor: StorySceneWorldAnchorDto}>(
        projectPath: string,
        scenes: TScene[],
    ): Promise<Map<TScene, StorySceneWorldAnchorDto>> {
        const resolvedAnchors = await this.sceneWorldAnchorResolutionService.resolveMany(
            projectPath,
            scenes.map((scene) => scene.worldAnchor),
        );
        return new Map(scenes.map((scene, index) => [scene, resolvedAnchors[index] ?? scene.worldAnchor]));
    }

    /**
     * 把已解析的 World Anchor 接回 Scene DTO。
     */
    private attachResolvedAnchor<TScene extends {worldAnchor: StorySceneWorldAnchorDto}>(
        scene: TScene,
        anchorMap: Map<TScene, StorySceneWorldAnchorDto>,
    ): TScene {
        return {
            ...scene,
            worldAnchor: anchorMap.get(scene) ?? scene.worldAnchor,
        };
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
        touchProjectResources(normalizedProjectPath);
        await initProjectDatabase(normalizedProjectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        const cacheKey = databasePath.replace(/\\/g, "/");
        const existing = this.clients.get(cacheKey);
        if (existing) {
            return existing.client;
        }
        const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        const client = new PrismaClient({
            adapter,
        });
        this.clients.set(cacheKey, {client, adapter});
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
        const chapterRepository = new PrismaChapterRepository(executor);
        const orderService = new OrderService(storyRepository, threadRepository, sceneRepository);
        const scopeGuard = new PlotScopeGuard(
            storyRepository,
            threadRepository,
            sceneRepository,
            chapterRepository,
        );
        const storyService = new StoryService(
            storyRepository,
            threadRepository,
            chapterRepository,
            orderService,
            assembler,
            scopeGuard,
        );
        const refResolverService = new RefResolverService(threadRepository, scopeGuard);
        const worldAnchorValidator = new SceneWorldAnchorValidator();
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
            worldAnchorValidator,
            assembler,
        );
        const sceneWorldContextService = new SceneWorldContextService(
            sceneRepository,
            storyService,
            scopeGuard,
            worldEngineFacade,
        );
        const chapterService = new ChapterService(
            chapterRepository,
            storyService,
            scopeGuard,
            assembler,
        );
        const chapterBootstrapService = new ChapterBootstrapService(
            chapterRepository,
            storyService,
            scopeGuard,
        );
        const chapterWriterBriefService = new ChapterWriterBriefService(
            sceneRepository,
            storyService,
            scopeGuard,
            sceneWorldContextService,
            this.sceneWorldAnchorResolutionService,
            assembler,
        );

        return {
            inputParser,
            storyService,
            threadService,
            sceneService,
            chapterService,
            chapterBootstrapService,
            sceneWorldContextService,
            chapterWriterBriefService,
            refResolverService,
        };
    }
}
