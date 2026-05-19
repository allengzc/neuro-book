import {readClientVariablesHeader} from "nbook/server/agent/api";
import {useAgentSystem} from "nbook/server/agent/http";
import {PreviewProfileTemplateRequestDtoSchema} from "nbook/shared/dto/profile-template.dto";
import {previewProfileTemplate} from "nbook/server/agent/profile-templates/profile-template-service";
import type {ProfileKey} from "nbook/server/agent/types";

/**
 * 预览 TSX profile 模板消息。
 */
export default defineEventHandler(async (event) => {
    const body = PreviewProfileTemplateRequestDtoSchema.parse(await readBody(event));
    if (!body.threadId) {
        return previewProfileTemplate(body);
    }

    const agentSystem = useAgentSystem();
    const clientVariables = readClientVariablesHeader(event);
    if (clientVariables) {
        await agentSystem.syncClientVariables(body.threadId, clientVariables);
    }
    const scope = agentSystem.getThreadScope(body.threadId);
    const profile = agentSystem.profileRegistry.get(scope.agent.profileKey as ProfileKey);
    return previewProfileTemplate({
        ...body,
        scope,
        profile,
    });
});
