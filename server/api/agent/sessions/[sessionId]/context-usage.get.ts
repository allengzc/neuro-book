import {getAgentSessionContextUsage, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 读取 Agent session 的上下文 token 估算。
 */
export default defineEventHandler(async (event) => {
    return withProjectNotOpenHttpError(async () => {
        const timing = createServerTiming(event);
        const sessionId = requireAgentSessionId(event);
        return getAgentSessionContextUsage(sessionId, undefined, timing);
    });
});
