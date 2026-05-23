import {validateBody} from "nbook/server/utils/novel-chapter";
import {deleteProfileSource} from "nbook/server/agent/profiles/workbench-service";
import {AgentProfileSourceRequestDtoSchema} from "nbook/shared/dto/agent-profile.dto";

/**
 * 删除用户 profile 文件，用于恢复系统版本或移除用户覆盖。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentProfileSourceRequestDtoSchema);
    return deleteProfileSource(body);
});
