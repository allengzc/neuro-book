import {getAgentV3Session, requireAgentV3SessionId} from "nbook/server/agent/http";

/**
 * 查询 v3 session 轻量摘要。
 */
export default defineEventHandler(async (event) => {
    return getAgentV3Session(requireAgentV3SessionId(event));
});
