import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {PlotRepository, SceneRepository, StoryRepository, ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {SceneService} from "nbook/server/plot/services/scene.service";
import type {StoryService} from "nbook/server/plot/services/story.service";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

type CreateErrorInput = {statusCode: number; message: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

describe("SceneService", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input: CreateErrorInput) => Object.assign(new Error(input.message), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("重排 Scene 时会先写入临时排序，避免 threadId + threadSortOrder 唯一约束冲突", async () => {
        const updateCalls: Array<{sceneId: number; data: {threadId?: number; threadSortOrder?: number; chapterPath?: string | null; chapterSortOrder?: number | null}}> = [];
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [101, 102]),
            findScenesByThread: vi.fn(async () => [
                {id: 101, threadSortOrder: 0},
                {id: 102, threadSortOrder: 1},
            ]),
            updateScene: vi.fn(async (sceneId: number, data: {threadId?: number; threadSortOrder?: number; chapterPath?: string | null; chapterSortOrder?: number | null}) => {
                updateCalls.push({sceneId, data});
                return {
                    id: sceneId,
                    storyId: 1,
                    threadId: data.threadId ?? 11,
                    chapterPath: data.chapterPath ?? null,
                    threadSortOrder: data.threadSortOrder ?? 0,
                    chapterSortOrder: data.chapterSortOrder ?? null,
                    title: "",
                    status: "draft",
                    summary: "",
                    purpose: null,
                    writingTip: null,
                    note: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
            }),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(async () => ({
                story: {id: "1", novelId: "1", title: "小说", summary: "", note: null, createdAt: "", updatedAt: ""},
                phases: [],
                ungroupedThreads: [],
                totalPhases: 0,
                totalThreads: 0,
                totalScenes: 2,
                totalPlots: 0,
            })),
        } as unknown as StoryService;
        const scopeGuard = {
            listThreadIds: vi.fn(async () => [11]),
        } as unknown as PlotScopeGuard;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
            {} as PlotRepository,
        );
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            {} as RefResolverService,
            new PlotDtoAssembler(),
        );

        await service.reorderStoryScenes(1, [
            {sceneId: 101, threadId: 11, chapterPath: null, threadSortOrder: 1, chapterSortOrder: null},
            {sceneId: 102, threadId: 11, chapterPath: null, threadSortOrder: 0, chapterSortOrder: null},
        ]);

        expect(updateCalls).toEqual([
            {sceneId: 101, data: {threadId: 11, chapterPath: null, threadSortOrder: -1, chapterSortOrder: null}},
            {sceneId: 102, data: {threadId: 11, chapterPath: null, threadSortOrder: -2, chapterSortOrder: null}},
            {sceneId: 101, data: {threadSortOrder: 1}},
            {sceneId: 102, data: {threadSortOrder: 0}},
        ]);
    });

    it("重排 Scene 时只要求覆盖目标 Thread，不要求提交整个 Story 的全部 Scene", async () => {
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [101, 102, 201]),
            findScenesByThread: vi.fn(async () => [
                {id: 101, threadSortOrder: 0},
                {id: 102, threadSortOrder: 1},
            ]),
            updateScene: vi.fn(async () => ({})),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(async () => ({
                story: {id: "1", novelId: "1", title: "小说", summary: "", note: null, createdAt: "", updatedAt: ""},
                phases: [],
                ungroupedThreads: [],
                totalPhases: 0,
                totalThreads: 0,
                totalScenes: 3,
                totalPlots: 0,
            })),
        } as unknown as StoryService;
        const scopeGuard = {
            listThreadIds: vi.fn(async () => [11, 22]),
        } as unknown as PlotScopeGuard;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
            {} as PlotRepository,
        );
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            {} as RefResolverService,
            new PlotDtoAssembler(),
        );

        await service.reorderStoryScenes(1, [
            {sceneId: 101, threadId: 11, chapterPath: null, threadSortOrder: 1, chapterSortOrder: null},
            {sceneId: 102, threadId: 11, chapterPath: null, threadSortOrder: 0, chapterSortOrder: null},
        ]);

        expect(sceneRepository.updateScene).toHaveBeenCalledTimes(4);
    });

    it("重排 Scene 时会拒绝没有覆盖目标 Thread bucket 的请求", async () => {
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [101, 102]),
            findScenesByThread: vi.fn(async () => [
                {id: 101, threadSortOrder: 0},
                {id: 102, threadSortOrder: 1},
            ]),
            updateScene: vi.fn(),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(),
        } as unknown as StoryService;
        const scopeGuard = {
            listThreadIds: vi.fn(async () => [11]),
        } as unknown as PlotScopeGuard;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
            {} as PlotRepository,
        );
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            {} as RefResolverService,
            new PlotDtoAssembler(),
        );

        await expect(service.reorderStoryScenes(1, [
            {sceneId: 101, threadId: 11, chapterPath: null, threadSortOrder: 0, chapterSortOrder: null},
        ])).rejects.toThrow("剧情线程 11 下的 Scene 重排必须覆盖当前 Thread 的全部 Scene");
        expect(sceneRepository.updateScene).not.toHaveBeenCalled();
    });
});
