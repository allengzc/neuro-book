import {getAgentSessionSnapshot, requireAgentSessionId} from "nbook/server/agent/http";

/**
 * 读取 Agent session snapshot。
 */
export default defineEventHandler(async (event) => {
    return getAgentSessionSnapshot(requireAgentSessionId(event));
});
