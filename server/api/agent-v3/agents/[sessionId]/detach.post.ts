import {AgentV3DetachRequestDtoSchema} from "nbook/shared/dto/agent-v3.dto";
import {detachAgentV3Agent, requireAgentV3SessionId} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 解除 owner session 对目标 agent session 的 link。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentV3SessionId(event);
    const body = await validateBody(event, AgentV3DetachRequestDtoSchema);
    return detachAgentV3Agent(sessionId, body);
});
