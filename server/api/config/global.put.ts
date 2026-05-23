import {getQuery} from "h3";
import {saveGlobalConfig} from "nbook/server/config/config-service";
import {validateConfigWorkspaceQuery} from "nbook/server/config/query";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {GlobalConfigDtoSchema} from "nbook/shared/dto/config.dto";

/**
 * 保存 Workspace Root `.nbook/config.json`。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, GlobalConfigDtoSchema);
    return saveGlobalConfig(body, validateConfigWorkspaceQuery(getQuery(event)));
});
