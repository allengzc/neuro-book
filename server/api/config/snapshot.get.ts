import {getQuery} from "h3";
import {readConfigSnapshot} from "nbook/server/config/config-service";
import {validateConfigWorkspaceQuery} from "nbook/server/config/query";

/**
 * 读取业务运行使用的最新配置快照。
 */
export default defineEventHandler(async (event) => {
    return readConfigSnapshot(validateConfigWorkspaceQuery(getQuery(event)));
});
