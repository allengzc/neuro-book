import {validateBody} from "nbook/server/utils/novel-chapter";
import {useAgentHarness} from "nbook/server/agent/http";
import {readProfileSource} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSourceRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 按 fileName 读取用户 profile 源码与 diagnostics。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSourceRequestDtoSchema);
    return readProfileSource(useAgentHarness().profiles, body);
});
