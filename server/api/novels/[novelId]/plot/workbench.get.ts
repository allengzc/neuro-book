import {plotFacade} from "nbook/server/plot";
import {requireNovelId} from "nbook/server/utils/novel-chapter";

/**
 * 查询剧本工作台聚合数据。
 */
export default defineEventHandler(async (event) => {
    return plotFacade.getPlotWorkbench(requireNovelId(event));
});
