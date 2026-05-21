import {readClientVariablesHeader} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-preview.service";
import {AgentProfilePreparePreviewRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 真实调用当前 profile.prepare 生成 Message[] 预览。
 */
export default defineEventHandler(async (event) => {
    const body = AgentProfilePreparePreviewRequestDtoSchema.parse(await readBody(event));
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    return previewAgentProfilePrepare(agentSystem, body, clientVariables);
});
