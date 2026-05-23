import {validateBody} from "nbook/server/utils/novel-chapter";
import {useAgentHarness} from "nbook/server/agent/http";
import {saveProfileSource} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSaveRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 保存用户 profile 源码。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSaveRequestDtoSchema);
    return saveProfileSource(useAgentHarness().profiles, body);
});
