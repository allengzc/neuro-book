import {createError} from "h3";
import type {UpdateAgentToolSettingsRequestDto, AgentToolSettingsDto} from "nbook/shared/dto/app-settings.dto";
import {UpdateAgentToolSettingsRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";
import {useAgentV3Harness} from "nbook/server/agent/http";
import {saveAgentToolAccessConfig} from "nbook/server/utils/app-config";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 校验请求中的 tool keys 都已注册。
 */
function assertKnownToolKeys(toolNames: string[], knownToolSet: ReadonlySet<string>): void {
    for (const toolName of toolNames) {
        if (!knownToolSet.has(toolName)) {
            throw createError({
                statusCode: 400,
                message: `未知的 tool: ${toolName}`,
            });
        }
    }
}

/**
 * 更新 Agent tools 设定。
 */
export default defineEventHandler(async (event): Promise<AgentToolSettingsDto> => {
    const body = await validateBody<UpdateAgentToolSettingsRequestDto>(event, UpdateAgentToolSettingsRequestDtoSchema);
    const harness = useAgentV3Harness();
    const allTools = harness.tools.keys();
    const knownToolSet = new Set(allTools);

    assertKnownToolKeys(body.allow, knownToolSet);
    assertKnownToolKeys(body.deny, knownToolSet);

    const config = await saveAgentToolAccessConfig({
        allow: body.allow,
        deny: body.deny,
    });

    return {
        allow: config.agent.tools.allow,
        deny: config.agent.tools.deny,
        allTools,
    };
});
