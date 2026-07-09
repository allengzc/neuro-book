import {validateBody} from "nbook/server/utils/novel-chapter";
import {createProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileCreateRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";
import {useAgentHarness} from "nbook/server/agent/http";

/**
 * 从系统模板创建用户 profile。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileCreateRequestDtoSchema);
    const result = await createProfileSourceDraft(body);
    await useAgentHarness().profiles.enqueueBuild({
        fileName: body.fileName ?? `${body.profileKey}.profile.tsx`,
        reason: "profile_source_created",
    });
    return result;
});
