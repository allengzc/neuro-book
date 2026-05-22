import {AgentV3CreateSessionRequestDtoSchema} from "nbook/shared/dto/agent-v3.dto";
import {createAgentV3Session} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 创建 v3 agent session。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, AgentV3CreateSessionRequestDtoSchema);
    return createAgentV3Session(body);
});
