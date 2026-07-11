import {getAgentSessionTreeSnapshot, requireAgentSessionId} from "nbook/server/agent/http";

/**
 * 读取完整 session tree。首屏 snapshot 默认不携带 tree，避免长会话打开时传输过大。
 */
export default defineEventHandler(async (event) => {
    const sessionId = requireAgentSessionId(event);
    return getAgentSessionTreeSnapshot(sessionId);
});
