import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {registerProjectResourceOwner} from "nbook/server/workspace-files/project-resources";
import {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
} from "nbook/server/plot/http/plot-route";

/**
 * 剧情模块单例门面。
 */
export const plotFacade = new PlotFacade();

// Project 资源生命周期：Plot 的 Project PrismaClient 缓存交由统一注册表关闭（删除/空闲/关停）。
registerProjectResourceOwner({
    name: "plot-facade",
    close: (projectPath) => plotFacade.closeProject(projectPath),
    closeAll: () => plotFacade.closeAllProjects(),
});

export {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
};
