import {AgentV3InvokeRequestDtoSchema} from "nbook/shared/dto/agent-v3.dto";
import {invokeAgentV3Session, requireAgentV3SessionId} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 阻塞式调用 v3 agent session。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentV3SessionId(event);
    const body = await validateBody(event, AgentV3InvokeRequestDtoSchema);
    return invokeAgentV3Session(sessionId, body);
});
