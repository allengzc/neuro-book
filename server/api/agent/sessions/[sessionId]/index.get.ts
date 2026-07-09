import {getAgentSessionSnapshot, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 读取 Agent session snapshot。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    const sessionId = requireAgentSessionId(event);
    return getAgentSessionSnapshot(sessionId, undefined, timing);
});
