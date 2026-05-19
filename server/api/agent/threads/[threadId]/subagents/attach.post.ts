import {readClientVariablesHeader, requireThreadId} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {AttachSubAgentThreadRequestDtoSchema} from "nbook/shared/dto/agent-chat.dto";

/**
 * 关联已有 subagent。
 */
export default defineEventHandler(async (event) => {
    const threadId = requireThreadId(event);
    const body = await validateBody(event, AttachSubAgentThreadRequestDtoSchema);
    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(threadId, clientVariables);
    }
    await agentSystem.attachSubAgent(threadId, String(body.subagentThreadId).trim());
    return {
        ok: true,
    };
});
