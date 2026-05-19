import type {PlotRepository, SceneRepository, StoryRepository, ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotService} from "nbook/server/plot/services/plot.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {StoryService} from "nbook/server/plot/services/story.service";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

type CreateErrorInput = {statusCode: number; message: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

describe("PlotService", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input: CreateErrorInput) => Object.assign(new Error(input.message), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("重排 Plot 时会先写入临时排序，避免 sceneId + sortOrder 唯一约束冲突", async () => {
        const updateCalls: Array<{plotId: number; data: {sceneId?: number; sortOrder?: number}}> = [];
        const plotRepository = {
            findPlotIdsByStory: vi.fn(async () => [101, 102]),
            lockPlotOrderBucket: vi.fn(async () => undefined),
            findPlotsByScene: vi.fn(async () => [
                {id: 101, sortOrder: 0},
                {id: 102, sortOrder: 1},
            ]),
            updatePlot: vi.fn(async (plotId: number, data: {sceneId?: number; sortOrder?: number}) => {
                updateCalls.push({plotId, data});
                return {
                    id: plotId,
                    sceneId: data.sceneId ?? 11,
                    sortOrder: data.sortOrder ?? 0,
                    kind: "setup",
                    summary: "",
                    effect: null,
                    writingTip: null,
                    note: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
            }),
        } as unknown as PlotRepository;
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [11]),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(async () => ({
                story: {id: "1", novelId: "1", title: "小说", summary: "", note: null, createdAt: "", updatedAt: ""},
                phases: [],
                ungroupedThreads: [],
                totalPhases: 0,
                totalThreads: 0,
                totalScenes: 0,
                totalPlots: 2,
            })),
        } as unknown as StoryService;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
            plotRepository,
        );
        const service = new PlotService(
            plotRepository,
            sceneRepository,
            storyService,
            {} as PlotScopeGuard,
            orderService,
            new PlotDtoAssembler(),
        );

        await service.reorderStoryPlots(1, [
            {plotId: 101, sceneId: 11, sortOrder: 1},
            {plotId: 102, sceneId: 11, sortOrder: 0},
        ]);

        expect(plotRepository.lockPlotOrderBucket).toHaveBeenCalledWith(11);
        expect(updateCalls).toEqual([
            {plotId: 101, data: {sceneId: 11, sortOrder: -1}},
            {plotId: 102, data: {sceneId: 11, sortOrder: -2}},
            {plotId: 101, data: {sortOrder: 1}},
            {plotId: 102, data: {sortOrder: 0}},
        ]);
    });

    it("重排 Plot 时只要求覆盖目标 Scene，不要求提交整个 Story 的全部 Plot", async () => {
        const plotRepository = {
            findPlotIdsByStory: vi.fn(async () => [101, 102, 201]),
            lockPlotOrderBucket: vi.fn(async () => undefined),
            findPlotsByScene: vi.fn(async () => [
                {id: 101, sortOrder: 0},
                {id: 102, sortOrder: 1},
            ]),
            updatePlot: vi.fn(async (plotId: number, data: {sceneId?: number; sortOrder?: number}) => ({
                id: plotId,
                sceneId: data.sceneId ?? 11,
                sortOrder: data.sortOrder ?? 0,
                kind: "setup",
                summary: "",
                effect: null,
                writingTip: null,
                note: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
        } as unknown as PlotRepository;
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [11, 22]),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(async () => ({
                story: {id: "1", novelId: "1", title: "小说", summary: "", note: null, createdAt: "", updatedAt: ""},
                phases: [],
                ungroupedThreads: [],
                totalPhases: 0,
                totalThreads: 0,
                totalScenes: 0,
                totalPlots: 3,
            })),
        } as unknown as StoryService;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
            plotRepository,
        );
        const service = new PlotService(
            plotRepository,
            sceneRepository,
            storyService,
            {} as PlotScopeGuard,
            orderService,
            new PlotDtoAssembler(),
        );

        await service.reorderStoryPlots(1, [
            {plotId: 101, sceneId: 11, sortOrder: 1},
            {plotId: 102, sceneId: 11, sortOrder: 0},
        ]);

        expect(plotRepository.updatePlot).toHaveBeenCalledTimes(4);
        expect(plotRepository.lockPlotOrderBucket).toHaveBeenCalledWith(11);
    });

    it("重排 Plot 时会拒绝没有覆盖目标 Scene bucket 的请求", async () => {
        const plotRepository = {
            findPlotIdsByStory: vi.fn(async () => [101, 102]),
            lockPlotOrderBucket: vi.fn(async () => undefined),
            findPlotsByScene: vi.fn(async () => [
                {id: 101, sortOrder: 0},
                {id: 102, sortOrder: 1},
            ]),
            updatePlot: vi.fn(),
        } as unknown as PlotRepository;
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [11]),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(),
        } as unknown as StoryService;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
            plotRepository,
        );
        const service = new PlotService(
            plotRepository,
            sceneRepository,
            storyService,
            {} as PlotScopeGuard,
            orderService,
            new PlotDtoAssembler(),
        );

        await expect(service.reorderStoryPlots(1, [
            {plotId: 101, sceneId: 11, sortOrder: 0},
        ])).rejects.toThrow("剧情场景 11 下的 Plot 重排必须覆盖当前 Scene 的全部 Plot");
        expect(plotRepository.updatePlot).not.toHaveBeenCalled();
    });
});
