import {getQuery} from "h3";
import {AgentV3OwnerQueryDtoSchema} from "nbook/shared/dto/agent-v3.dto";
import {getAgentV3Agent} from "nbook/server/agent/http";

/**
 * 查询当前 owner session 拥有的 agent 列表。
 */
export default defineEventHandler(async (event) => {
    const query = AgentV3OwnerQueryDtoSchema.parse(getQuery(event));
    return getAgentV3Agent(undefined, query);
});
