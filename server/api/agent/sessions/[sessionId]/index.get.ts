import {getQuery} from "h3";
import {getAgentSessionSnapshot, requireAgentSessionId} from "nbook/server/agent/http";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {AgentSessionSnapshotQueryDtoSchema} from "nbook/shared/dto/agent-session.dto";

/**
 * 读取 Agent session snapshot。
 */
export default defineEventHandler(async (event) => {
    return withProjectNotOpenHttpError(async () => {
        const timing = createServerTiming(event);
        const sessionId = requireAgentSessionId(event);
        const query = AgentSessionSnapshotQueryDtoSchema.parse(getQuery(event));
        return getAgentSessionSnapshot(sessionId, undefined, timing, {
            entryLimit: query.entryLimit ?? 120,
            includeTree: query.includeTree ?? false,
            includeSystemPrompt: query.includeSystemPrompt ?? false,
            includeContextUsage: query.includeContextUsage ?? false,
        });
    });
});
