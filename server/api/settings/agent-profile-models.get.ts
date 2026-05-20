import type {AgentProfileModelSettingsDto} from "nbook/shared/dto/app-settings.dto";
import {useAgentSystem} from "nbook/server/agent/http";
import {loadAppConfig} from "nbook/server/utils/app-config";
import {buildAgentProfileModelSettingsDto} from "nbook/server/utils/model";

/**
 * 读取 Agent Profile 模型设定。
 */
export default defineEventHandler(async (): Promise<AgentProfileModelSettingsDto> => {
    const appConfig = await loadAppConfig();
    const agentSystem = useAgentSystem();

    const profiles = await agentSystem.profileRegistry.list();

    return buildAgentProfileModelSettingsDto(appConfig, profiles.map((profile) => ({
        profileKey: profile.key,
        name: profile.name,
        kind: profile.kind,
    })));
});
