import {validateBody} from "nbook/server/utils/novel-chapter";
import {saveProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSaveRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 保存用户 profile 源码。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSaveRequestDtoSchema);
    return saveProfileSourceDraft(body);
});
