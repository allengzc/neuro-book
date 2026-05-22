import type {AgentProfileModelSettingsDto} from "nbook/shared/dto/app-settings.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {loadAppConfig} from "nbook/server/utils/app-config";
import {buildAgentProfileModelSettingsDto} from "nbook/server/utils/model-settings";

/**
 * 读取 Agent Profile 模型设定。
 */
export default defineEventHandler(async (): Promise<AgentProfileModelSettingsDto> => {
    const appConfig = await loadAppConfig();
    const harness = useAgentHarness();
    const catalog = await harness.profiles.snapshot();

    return buildAgentProfileModelSettingsDto(appConfig, catalog.profiles.map((profile) => ({
        profileKey: profile.key,
        name: profile.name,
        kind: profile.key.startsWith("subagent.") ? "subagent" : "leader",
    })));
});
