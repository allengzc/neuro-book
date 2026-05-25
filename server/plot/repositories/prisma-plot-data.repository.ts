import {lockDatabaseKey} from "nbook/server/database/locks";
import type {PlotRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {PrismaExecutor} from "nbook/server/plot/core/types";
import type {StoryPlotKindDto} from "nbook/shared/dto/plot.dto";

/**
 * Prisma 版剧情数据仓储。
 * 同时承载 Plot 与剧情模块所需的辅助查询能力。
 */
export class PrismaPlotDataRepository implements PlotRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询情节点。
     */
    async findPlotById(plotId: number) {
        return this.prisma.storyPlot.findUnique({
            where: {id: plotId},
        });
    }

    /**
     * 查询带 storyId 的情节点。
     */
    async findPlotByIdWithStory(plotId: number) {
        return this.prisma.storyPlot.findUnique({
            where: {id: plotId},
            include: {
                scene: {
                    select: {
                        storyId: true,
                    },
                },
            },
        });
    }

    /**
     * 返回 Story 下 plot ID。
     */
    async findPlotIdsByStory(storyId: number): Promise<number[]> {
        const plots = await this.prisma.storyPlot.findMany({
            where: {
                scene: {storyId},
            },
            select: {id: true},
        });
        return plots.map((plot) => plot.id);
    }

    /**
     * 创建情节点。
     */
    async createPlot(input: {
        sceneId: number;
        sortOrder: number;
        kind: StoryPlotKindDto;
        summary: string;
        effect: string | null;
        writingTip: string | null;
        note: string | null;
    }) {
        return this.prisma.storyPlot.create({
            data: input,
        });
    }

    /**
     * 更新情节点。
     */
    async updatePlot(plotId: number, data: {
        sceneId?: number;
        sortOrder?: number;
        kind?: StoryPlotKindDto;
        summary?: string;
        effect?: string | null;
        writingTip?: string | null;
        note?: string | null;
    }) {
        return this.prisma.storyPlot.update({
            where: {id: plotId},
            data,
        });
    }

    /**
     * 删除情节点。
     */
    async deletePlot(plotId: number): Promise<void> {
        await this.prisma.storyPlot.delete({
            where: {id: plotId},
        });
    }

    /**
     * 查询 Scene 内的 Plot 排序快照。
     */
    async findPlotsByScene(sceneId: number) {
        return this.prisma.storyPlot.findMany({
            where: {sceneId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            select: {
                id: true,
                sortOrder: true,
            },
        });
    }

    /**
     * 锁定同一 Scene 下的 Plot 排序桶，避免并发创建拿到相同 sortOrder。
     */
    async lockPlotOrderBucket(sceneId: number): Promise<void> {
        await lockDatabaseKey(this.prisma, sceneId);
    }

    /**
     * 统计 Story 下的 Plot 总数。
     */
    async countPlotsByStory(storyId: number): Promise<number> {
        return this.prisma.storyPlot.count({
            where: {
                scene: {storyId},
            },
        });
    }

}
