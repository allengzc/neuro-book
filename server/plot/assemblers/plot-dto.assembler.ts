import type {
    Story,
    StoryPhase,
    StoryPlot,
    StoryScene,
    StoryThread,
} from "nbook/server/generated/prisma/client";
import type {
    ChapterPlotSceneWithThread,
    StorySceneRefWithTargets,
    StorySceneWithDetails,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchScene,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";
import {stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterPlotDetailDto,
    ChapterPlotSceneDto,
    PlotTreeDto,
    PlotWorkbenchDto,
    StoryDto,
    StoryEffectiveRefDto,
    StoryPhaseDto,
    StoryPlotDto,
    StoryRefDto,
    StorySceneDetailDto,
    StorySceneSummaryDto,
    StoryWorkbenchPhaseDto,
    StoryWorkbenchSceneDto,
    StoryWorkbenchThreadDto,
    StoryThreadDetailDto,
    StoryThreadSummaryDto,
} from "nbook/shared/dto/plot.dto";
import {
    buildReferenceUri,
    parseStructuredReferenceTarget,
} from "nbook/shared/reference-core";

/**
 * 剧情 DTO 组装器。
 */
export class PlotDtoAssembler {

    /**
     * 映射 Story DTO。
     */
    toStoryDto(story: Story): StoryDto {
        return {
            id: stringifyEntityId(story.id),
            novelId: stringifyEntityId(story.novelId),
            title: story.title,
            summary: story.summary,
            note: story.note,
            createdAt: story.createdAt.toISOString(),
            updatedAt: story.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 StoryPhase DTO。
     */
    toStoryPhaseDto(phase: StoryPhase): StoryPhaseDto {
        return {
            id: stringifyEntityId(phase.id),
            storyId: stringifyEntityId(phase.storyId),
            sortOrder: phase.sortOrder,
            name: phase.name,
            title: phase.title,
            summary: phase.summary,
            note: phase.note,
            createdAt: phase.createdAt.toISOString(),
            updatedAt: phase.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Thread 摘要 DTO。
     */
    toStoryThreadSummaryDto(thread: StoryThread): StoryThreadSummaryDto {
        return {
            id: stringifyEntityId(thread.id),
            storyId: stringifyEntityId(thread.storyId),
            storyPhaseId: thread.storyPhaseId === null ? null : stringifyEntityId(thread.storyPhaseId),
            sortOrder: thread.sortOrder,
            name: thread.name,
            title: thread.title,
            isMainThread: thread.isMainThread,
            status: thread.status,
            summary: thread.summary,
            tags: thread.tags,
            writingTip: thread.writingTip,
            note: thread.note,
            createdAt: thread.createdAt.toISOString(),
            updatedAt: thread.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Scene 摘要 DTO。
     */
    toStorySceneSummaryDto(scene: StoryScene): StorySceneSummaryDto {
        return {
            id: stringifyEntityId(scene.id),
            storyId: stringifyEntityId(scene.storyId),
            threadId: stringifyEntityId(scene.threadId),
            chapterPath: scene.chapterPath,
            threadSortOrder: scene.threadSortOrder,
            chapterSortOrder: scene.chapterSortOrder,
            title: scene.title,
            status: scene.status,
            summary: scene.summary,
            purpose: scene.purpose,
            writingTip: scene.writingTip,
            note: scene.note,
            createdAt: scene.createdAt.toISOString(),
            updatedAt: scene.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Plot DTO。
     */
    toStoryPlotDto(plot: StoryPlot): StoryPlotDto {
        return {
            id: stringifyEntityId(plot.id),
            sceneId: stringifyEntityId(plot.sceneId),
            sortOrder: plot.sortOrder,
            kind: plot.kind,
            summary: plot.summary,
            effect: plot.effect,
            writingTip: plot.writingTip,
            note: plot.note,
            createdAt: plot.createdAt.toISOString(),
            updatedAt: plot.updatedAt.toISOString(),
        };
    }

    /**
     * 规范化 ref target。
     */
    normalizeStoryRefTarget(ref: StorySceneRefWithTargets): string {
        if (ref.targetKind === "content") {
            return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }

        if (ref.targetKind === "thread") {
            return ref.targetThread ? buildReferenceUri("thread", stringifyEntityId(ref.targetThread.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        if (ref.targetKind === "scene") {
            return ref.targetScene ? buildReferenceUri("scene", stringifyEntityId(ref.targetScene.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        if (ref.targetKind === "plot") {
            return ref.targetPlot ? buildReferenceUri("plot", stringifyEntityId(ref.targetPlot.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
    }

    /**
     * 映射 ref DTO。
     */
    toStoryRefDto(ref: StorySceneRefWithTargets): StoryRefDto {
        return {
            relation: ref.relation,
            target: this.normalizeStoryRefTarget(ref),
            visibility: ref.visibility,
            note: ref.note,
        };
    }

    /**
     * 组装 Scene 的有效 refs。
     */
    buildEffectiveSceneRefs(scene: StorySceneWithDetails): StoryEffectiveRefDto[] {
        return scene.refs.map((ref) => ({
            ...this.toStoryRefDto(ref),
            sourceType: "scene" as const,
            sourceId: stringifyEntityId(scene.id),
        }));
    }

    /**
     * 映射不含 refs 的 Thread 详情 DTO。
     */
    toStoryThreadDetailWithoutRefsDto(thread: StoryThreadWithScenes): StoryThreadDetailDto {
        return {
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
        };
    }

    /**
     * 映射 Scene 详情 DTO。
     */
    toStorySceneDetailDto(scene: StorySceneWithDetails): StorySceneDetailDto {
        return {
            ...this.toStorySceneSummaryDto(scene),
            plots: scene.plots.map((plot) => this.toStoryPlotDto(plot)),
            refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
            effectiveRefs: this.buildEffectiveSceneRefs(scene),
        };
    }

    /**
     * 映射章节剧情 Scene DTO。
     */
    toChapterPlotSceneDto(scene: ChapterPlotSceneWithThread): ChapterPlotSceneDto {
        return {
            id: stringifyEntityId(scene.id),
            threadId: stringifyEntityId(scene.thread.id),
            threadTitle: scene.thread.title,
            threadIsMain: scene.thread.isMainThread,
            chapterPath: scene.chapterPath,
            chapterSortOrder: scene.chapterSortOrder,
            threadSortOrder: scene.threadSortOrder,
            title: scene.title,
            status: scene.status,
            summary: scene.summary,
            purpose: scene.purpose,
            plots: scene.plots.map((plot) => this.toStoryPlotDto(plot)),
        };
    }

    /**
     * 映射章节剧情详情 DTO。
     */
    toChapterPlotDetailDto(chapterPath: string, scenes: ChapterPlotSceneWithThread[]): ChapterPlotDetailDto {
        return {
            chapterPath,
            scenes: scenes.map((scene) => this.toChapterPlotSceneDto(scene)),
            totalScenes: scenes.length,
            totalPlots: scenes.reduce((sum, scene) => sum + scene.plots.length, 0),
        };
    }

    /**
     * 映射 Workbench Scene DTO。
     */
    toStoryWorkbenchSceneDto(scene: StoryWorkbenchScene): StoryWorkbenchSceneDto {
        return {
            ...this.toStorySceneSummaryDto(scene),
            plots: scene.plots.map((plot) => this.toStoryPlotDto(plot)),
            refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
        };
    }

    /**
     * 映射 Workbench Thread DTO。
     */
    toStoryWorkbenchThreadDto(thread: StoryWorkbenchThread): StoryWorkbenchThreadDto {
        return {
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStoryWorkbenchSceneDto(scene)),
        };
    }

    /**
     * 映射 Workbench Phase DTO。
     */
    toStoryWorkbenchPhaseDto(phase: StoryWorkbenchPhase): StoryWorkbenchPhaseDto {
        return {
            ...this.toStoryPhaseDto(phase),
            threads: phase.threads.map((thread) => this.toStoryWorkbenchThreadDto(thread)),
        };
    }

    /**
     * 组装剧情树 DTO。
     */
    toPlotTreeDto(input: {
        story: Story;
        phases: Array<StoryPhase & {threads: Array<StoryThread & {scenes: StoryScene[]}>}>;
        ungroupedThreads: Array<StoryThread & {scenes: StoryScene[]}>;
        totalPlots: number;
    }): PlotTreeDto {
        const phases = input.phases.map((phase) => ({
            ...this.toStoryPhaseDto(phase),
            threads: phase.threads.map((thread) => ({
                ...this.toStoryThreadSummaryDto(thread),
                scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
            })),
        }));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => ({
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
        }));

        return {
            story: this.toStoryDto(input.story),
            phases,
            ungroupedThreads,
            totalPhases: phases.length,
            totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
            totalScenes: phases.reduce((sum, phase) => (
                sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0)
            ), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0),
            totalPlots: input.totalPlots,
        };
    }

    /**
     * 组装剧本工作台 DTO。
     */
    toPlotWorkbenchDto(input: {
        story: Story;
        phases: StoryWorkbenchPhase[];
        ungroupedThreads: StoryWorkbenchThread[];
        totalPlots: number;
    }): PlotWorkbenchDto {
        const phases = input.phases.map((phase) => this.toStoryWorkbenchPhaseDto(phase));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => this.toStoryWorkbenchThreadDto(thread));
        const totalScenes = phases.reduce((sum, phase) => (
            sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0)
        ), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0);

        return {
            story: this.toStoryDto(input.story),
            phases,
            ungroupedThreads,
            totalPhases: phases.length,
            totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
            totalScenes,
            totalPlots: input.totalPlots,
        };
    }
}
