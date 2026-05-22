import {invokeAgentSession, requireAgentSessionId} from "nbook/server/agent/http";
import {AgentInvokeRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 阻塞式调用 Agent session。slash command 会被视为普通文本。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const body = await validateBody(event, AgentInvokeRequestDtoSchema);
    return invokeAgentSession(sessionId, body);
});
