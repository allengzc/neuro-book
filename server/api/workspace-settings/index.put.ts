import {getQuery} from "h3";
import {UpdateWorkspaceSettingsRequestDtoSchema} from "nbook/shared/dto/workspace-settings.dto";
import {updateWorkspaceSettings} from "nbook/server/workspace-settings/workspace-settings";
import {validateWorkspaceSettingsQuery} from "nbook/server/workspace-settings/workspace-settings-query";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 更新当前 workspace 设置。
 */
export default defineEventHandler(async (event) => {
    const query = validateWorkspaceSettingsQuery(getQuery(event));
    const body = await validateBody(event, UpdateWorkspaceSettingsRequestDtoSchema);
    return updateWorkspaceSettings({prisma, query, body});
});
