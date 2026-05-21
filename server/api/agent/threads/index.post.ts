import {readClientVariablesHeader} from "nbook/server/agent/api";
import {useAgentSystem, toAgentThreadSummaryDto} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {CreateAgentThreadRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 创建新的 leader 线程。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, CreateAgentThreadRequestDtoSchema);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    const thread = await agentSystem.createLeaderThread({
        ...body,
        clientVariables,
    });
    const summaries = await agentSystem.listThreads({
        kind: "leader",
        profileKey: thread.profileKey,
    });
    const summary = summaries.find((item) => item.id === thread.id);
    if (!summary) {
        throw createError({
            statusCode: 500,
            message: "创建线程后未找到摘要",
        });
    }
    return toAgentThreadSummaryDto(summary);
});
