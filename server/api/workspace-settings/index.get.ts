import {getQuery} from "h3";
import {readWorkspaceSettings} from "nbook/server/workspace-settings/workspace-settings";
import {validateWorkspaceSettingsQuery} from "nbook/server/workspace-settings/workspace-settings-query";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 读取当前 workspace 设置。
 */
export default defineEventHandler(async (event) => {
    const query = validateWorkspaceSettingsQuery(getQuery(event));
    return readWorkspaceSettings({prisma, query});
});
