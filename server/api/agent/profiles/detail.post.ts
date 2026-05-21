import {useAgentSystem} from "nbook/server/agent/http";
import {readAgentProfileDetail} from "nbook/server/agent/profiles/profile-catalog.service";
import {AgentProfileDetailRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 读取 profile 详情。加载失败的 profile 也返回源码和 issue。
 */
export default defineEventHandler(async (event) => {
    const body = AgentProfileDetailRequestDtoSchema.parse(await readBody(event));
    return readAgentProfileDetail(useAgentSystem(), body);
});
