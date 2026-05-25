import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
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

export {
    requirePhaseId,
    requirePlotId,
    requireSceneId,
    requireStoryThreadId,
};
