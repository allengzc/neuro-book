import {validateBody} from "nbook/server/utils/novel-chapter";
import {useAgentHarness} from "nbook/server/agent/http";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-http-service";
import {AgentProfilePreparePreviewRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 调用真实 profile.prepare 生成 TSX Profile 预览。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfilePreparePreviewRequestDtoSchema);
    return previewAgentProfilePrepare(useAgentHarness(), body);
});
