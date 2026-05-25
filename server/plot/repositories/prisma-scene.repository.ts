import type {StoryScene} from "nbook/server/generated/prisma/client";
import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {
    ChapterPlotSceneWithThread,
    PrismaExecutor,
    ResolvedStoryRefInput,
    StorySceneWithDetails,
    StoryThreadEntity,
} from "nbook/server/plot/core/types";
import {STORY_SCENE_REF_INCLUDE} from "nbook/server/plot/repositories/includes";
import {normalizeThreadJsonTags} from "nbook/server/plot/repositories/thread-tags";

/**
 * Prisma 版 Scene 仓储。
 */
export class PrismaSceneRepository implements SceneRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询场景。
     */
    async findSceneById(sceneId: number): Promise<StoryScene | null> {
        return this.prisma.storyScene.findUnique({
            where: {id: sceneId},
        });
    }

    /**
     * 查询场景详情。
     */
    async findSceneWithDetailsById(sceneId: number): Promise<StorySceneWithDetails | null> {
        const scene = await this.prisma.storyScene.findUnique({
            where: {id: sceneId},
            include: {
                plots: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                },
                refs: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: STORY_SCENE_REF_INCLUDE,
                },
                thread: {
                    select: {
                        id: true,
                        storyId: true,
                        storyPhaseId: true,
                        sortOrder: true,
                        name: true,
                        title: true,
                        isMainThread: true,
                        status: true,
                        summary: true,
                        tags: true,
                        writingTip: true,
                        note: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        }) as Omit<StorySceneWithDetails, "thread"> & {thread: Omit<StoryThreadEntity, "tags"> & {tags: string}} | null;
        if (!scene) {
            return null;
        }
        return {
            ...scene,
            thread: normalizeThreadJsonTags(scene.thread),
        };
    }

    /**
     * 查询章节下的 Scene 与 Plot。
     */
    async findChapterScenesWithPlots(chapterPath: string): Promise<ChapterPlotSceneWithThread[]> {
        return this.prisma.storyScene.findMany({
            where: {chapterPath},
            orderBy: [
                {chapterSortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                thread: {
                    select: {
                        id: true,
                        title: true,
                        isMainThread: true,
                    },
                },
                plots: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                },
            },
        }) as Promise<ChapterPlotSceneWithThread[]>;
    }

    /**
     * 返回 Story 下 Scene ID。
     */
    async findSceneIdsByStory(storyId: number): Promise<number[]> {
        const scenes = await this.prisma.storyScene.findMany({
            where: {storyId},
            select: {id: true},
        });
        return scenes.map((scene) => scene.id);
    }

    /**
     * 创建场景。
     */
    async createScene(input: {
        storyId: number;
        threadId: number;
        chapterPath: string | null;
        threadSortOrder: number;
        chapterSortOrder: number | null;
        title: string;
        status: StoryScene["status"];
        summary: string;
        purpose: string | null;
        writingTip: string | null;
        note: string | null;
    }): Promise<StoryScene> {
        return this.prisma.storyScene.create({
            data: input,
        });
    }

    /**
     * 更新场景。
     */
    async updateScene(
        sceneId: number,
        data: Partial<Pick<
        StoryScene,
        "threadId" | "chapterPath" | "threadSortOrder" | "chapterSortOrder" | "title" | "status" | "summary" | "purpose" | "writingTip" | "note"
    >>,
    ): Promise<StoryScene> {
        return this.prisma.storyScene.update({
            where: {id: sceneId},
            data,
        });
    }

    /**
     * 删除场景。
     */
    async deleteScene(sceneId: number): Promise<void> {
        await this.prisma.storyScene.delete({
            where: {id: sceneId},
        });
    }

    /**
     * 全量替换场景 refs。
     */
    async replaceRefs(sceneId: number, refs: ResolvedStoryRefInput[]): Promise<void> {
        await this.prisma.storySceneRef.deleteMany({
            where: {sceneId},
        });

        if (refs.length === 0) {
            return;
        }

        await this.prisma.storySceneRef.createMany({
            data: refs.map((ref) => ({
                sceneId,
                sortOrder: ref.sortOrder,
                relation: ref.relation,
                rawTarget: ref.rawTarget,
                targetKind: ref.targetKind,
                targetThreadId: ref.targetThreadId,
                targetSceneId: ref.targetSceneId,
                targetPlotId: ref.targetPlotId,
                visibility: ref.visibility,
                note: ref.note,
            })),
        });
    }

    /**
     * 查询线程内的 Scene 排序快照。
     */
    async findScenesByThread(threadId: number): Promise<Pick<StoryScene, "id" | "threadSortOrder">[]> {
        return this.prisma.storyScene.findMany({
            where: {threadId},
            orderBy: [
                {threadSortOrder: "asc"},
                {id: "asc"},
            ],
            select: {
                id: true,
                threadSortOrder: true,
            },
        });
    }

    /**
     * 查询章节内的 Scene 排序快照。
     */
    async findScenesByChapter(chapterPath: string): Promise<Pick<StoryScene, "id" | "chapterSortOrder">[]> {
        return this.prisma.storyScene.findMany({
            where: {chapterPath},
            orderBy: [
                {chapterSortOrder: "asc"},
                {id: "asc"},
            ],
            select: {
                id: true,
                chapterSortOrder: true,
            },
        });
    }
}
