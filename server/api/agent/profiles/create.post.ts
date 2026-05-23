import {validateBody} from "nbook/server/utils/novel-chapter";
import {createProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileCreateRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 从系统模板创建用户 profile。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileCreateRequestDtoSchema);
    return createProfileSourceDraft(body);
});
