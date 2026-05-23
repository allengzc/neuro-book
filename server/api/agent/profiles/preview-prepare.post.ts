import {validateBody} from "nbook/server/utils/novel-chapter";
import {useAgentHarness} from "nbook/server/agent/http";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {previewAgentProfilePrepare} from "nbook/server/agent/profiles/profile-http-service";
import {withProfileSourceOverride} from "nbook/server/agent/profiles/profile-source-check";
import {AgentProfilePreparePreviewRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 调用真实 profile.prepare 生成 TSX Profile 预览。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfilePreparePreviewRequestDtoSchema);
    const harness = useAgentHarness();
    if (!body.sourceOverride) {
        return previewAgentProfilePrepare(harness, body);
    }
    return withProfileSourceOverride(body.sourceOverride, async (profiles) => {
        const previewHarness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles,
            skills: harness.skills,
        });
        return previewAgentProfilePrepare(previewHarness, body);
    });
});
