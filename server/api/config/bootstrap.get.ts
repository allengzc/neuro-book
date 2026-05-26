import {getQuery} from "h3";
import {readConfigBootstrap} from "nbook/server/config/config-service";
import {validateConfigWorkspaceQuery} from "nbook/server/config/query";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 读取首页启动所需的轻量配置。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    try {
        return await timing.measure("config.bootstrap", () => readConfigBootstrap(validateConfigWorkspaceQuery(getQuery(event))));
    } finally {
        timing.commit();
    }
});
