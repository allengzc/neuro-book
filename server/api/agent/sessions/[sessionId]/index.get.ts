import {getAgentSessionSnapshot, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

/**
 * 读取 Agent session snapshot。
 */
export default defineEventHandler(async (event) => {
    return withProjectNotOpenHttpError(async () => {
        const timing = createServerTiming(event);
        const sessionId = requireAgentSessionId(event);
        return getAgentSessionSnapshot(sessionId, undefined, timing);
    });
});
