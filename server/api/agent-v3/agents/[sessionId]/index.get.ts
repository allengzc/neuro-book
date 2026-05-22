import {getAgentV3Agent, requireAgentV3SessionId} from "nbook/server/agent/http";

/**
 * 查询指定 v3 agent session 摘要。
 */
export default defineEventHandler(async (event) => {
    return getAgentV3Agent(requireAgentV3SessionId(event), {});
});
