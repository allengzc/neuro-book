import {getQuery} from "h3";
import {getAgentSessionEntries, requireAgentSessionId} from "nbook/server/agent/http";
import {AgentSessionEntriesQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

/**
 * 分页读取 Agent session active path entries。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    const query = AgentSessionEntriesQueryDtoSchema.parse(getQuery(event));
    return getAgentSessionEntries(sessionId, query);
});
