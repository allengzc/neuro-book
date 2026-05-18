import type {
    StorySceneRefWithTargets,
    StorySceneWithDetails,
} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {describe, expect, it} from "vitest";

function createSceneRef(input: Partial<StorySceneRefWithTargets>): StorySceneRefWithTargets {
    return {
        id: 2,
        sceneId: 20,
        sortOrder: 0,
        relation: "推动",
        rawTarget: "lorebook/note/y/",
        targetKind: "content",
        targetThreadId: null,
        targetSceneId: null,
        targetPlotId: null,
        visibility: "author",
        note: null,
        createdAt: new Date("2026-04-13T00:00:00.000Z"),
        updatedAt: new Date("2026-04-13T00:00:00.000Z"),
        targetThread: null,
        targetScene: null,
        targetPlot: null,
        ...input,
    };
}

describe("PlotDtoAssembler", () => {
    it("会从 scene refs 组装 effectiveRefs，并输出 canonical target", () => {
        const assembler = new PlotDtoAssembler();
        const scene = {
            id: 20,
            storyId: 1,
            threadId: 10,
            chapterPath: null,
            threadSortOrder: 0,
            chapterSortOrder: null,
            title: "场景",
            status: "draft",
            summary: "",
            purpose: null,
            writingTip: null,
            note: null,
            createdAt: new Date("2026-04-13T00:00:00.000Z"),
            updatedAt: new Date("2026-04-13T00:00:00.000Z"),
            plots: [],
            refs: [
                createSceneRef({
                    relation: "回收",
                    targetKind: "plot",
                    rawTarget: "plot://200",
                    targetPlot: {id: 200},
                    targetPlotId: 200,
                }),
            ],
            thread: {
                id: 10,
                storyId: 1,
                storyPhaseId: null,
                sortOrder: 0,
                name: "main-thread",
                title: "主线",
                isMainThread: true,
                status: "draft",
                summary: "",
                tags: [],
                writingTip: null,
                note: null,
                createdAt: new Date("2026-04-13T00:00:00.000Z"),
                updatedAt: new Date("2026-04-13T00:00:00.000Z"),
            },
        } satisfies StorySceneWithDetails;

        expect(assembler.buildEffectiveSceneRefs(scene)).toEqual([
            {
                relation: "回收",
                target: "plot://200",
                visibility: "author",
                note: null,
                sourceType: "scene",
                sourceId: "20",
            },
        ]);
    });
});
