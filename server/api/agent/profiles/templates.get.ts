import {listProfileTemplates} from "nbook/server/agent/profiles/workbench-service";

/**
 * 列出 TSX Profile Workbench 可用的新建模板。
 */
export default defineEventHandler(async () => {
    return listProfileTemplates();
});
