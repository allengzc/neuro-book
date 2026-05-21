import {useAgentSystem} from "nbook/server/agent/http";
import {listAgentProfileCatalog} from "nbook/server/agent/profiles/profile-catalog.service";

/**
 * 列出当前系统 assets 与用户 assets 合成后的 profile catalog。
 */
export default defineEventHandler(async () => {
    return listAgentProfileCatalog(useAgentSystem());
});
