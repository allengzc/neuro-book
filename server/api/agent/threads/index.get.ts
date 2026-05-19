import {getQuery} from "h3";
import {useAgentSystem} from "nbook/server/agent/http";
import {ListAgentThreadsQueryDtoSchema} from "nbook/shared/dto/agent-chat.dto";
import {toAgentThreadSummaryDto} from "nbook/server/agent/http";

/**
 * 查询 Agent 线程列表。
 */
export default defineEventHandler(async (event) => {
    const query = ListAgentThreadsQueryDtoSchema.parse(getQuery(event));
    const agentSystem = useAgentSystem();
    const threads = await agentSystem.listThreads({
        kind: query.kind ?? "leader",
        profileKey: query.profileKey,
    });
    return threads.map(toAgentThreadSummaryDto);
});
