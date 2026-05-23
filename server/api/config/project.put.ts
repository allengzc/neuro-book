import {getQuery} from "h3";
import {saveProjectConfig} from "nbook/server/config/config-service";
import {validateConfigWorkspaceQuery} from "nbook/server/config/query";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {ProjectConfigDtoSchema} from "nbook/shared/dto/config.dto";

/**
 * 保存当前 Project Workspace `.nbook/config.json`。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectConfigDtoSchema);
    return saveProjectConfig(body, validateConfigWorkspaceQuery(getQuery(event)));
});
