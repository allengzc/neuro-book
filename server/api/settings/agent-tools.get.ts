import type {AgentToolSettingsDto} from "nbook/shared/dto/app-settings.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {loadAppConfig} from "nbook/server/utils/app-config";

/**
 * 读取 Agent tools 设定。
 */
export default defineEventHandler(async (): Promise<AgentToolSettingsDto> => {
    const harness = useAgentHarness();
    const appConfig = await loadAppConfig();

    return {
        allow: appConfig.agent.tools.allow,
        deny: appConfig.agent.tools.deny,
        allTools: harness.tools.keys(),
    };
});
