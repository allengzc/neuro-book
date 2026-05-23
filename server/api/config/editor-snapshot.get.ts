import {getQuery} from "h3";
import {readConfigEditorSnapshot} from "nbook/server/config/config-service";
import {validateConfigWorkspaceQuery} from "nbook/server/config/query";

/**
 * 读取设置页使用的配置编辑快照。
 */
export default defineEventHandler(async (event) => {
    return readConfigEditorSnapshot(validateConfigWorkspaceQuery(getQuery(event)));
});
