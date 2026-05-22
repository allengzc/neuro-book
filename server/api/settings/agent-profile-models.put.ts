import type {
    AgentProfileModelSettingsDto,
    UpdateAgentProfileModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import {UpdateAgentProfileModelSettingsRequestDtoSchema} from "nbook/shared/dto/app-settings.dto";
import {useAgentHarness} from "nbook/server/agent/http";
import {saveAgentProfileSettingsConfig, loadAppConfig} from "nbook/server/utils/app-config";
import {buildAgentProfileModelSettingsDto, convertAgentProfileModelSettingsRequestToConfig, resolveConfiguredModel} from "nbook/server/utils/model-settings";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 保存 Agent Profile 模型设定。
 */
export default defineEventHandler(async (event): Promise<AgentProfileModelSettingsDto> => {
    const body = await validateBody<UpdateAgentProfileModelSettingsRequestDto>(event, UpdateAgentProfileModelSettingsRequestDtoSchema);
    const harness = useAgentHarness();
    const catalog = await harness.profiles.snapshot();
    const profileDefinitions = catalog.profiles.map((profile) => ({
        profileKey: profile.key,
        name: profile.name,
        kind: profile.key.startsWith("subagent.") ? "subagent" as const : "leader" as const,
    }));
    const knownProfileKeys = new Set<string>(profileDefinitions.map((profile) => profile.profileKey));
    const currentConfig = await loadAppConfig();

    for (const profile of body.agentProfiles) {
        if (!knownProfileKeys.has(profile.profileKey)) {
            throw createError({
                statusCode: 400,
                statusMessage: `未知的 profileKey: ${profile.profileKey}`,
            });
        }

        if (profile.model.modelKey && !resolveConfiguredModel(currentConfig.models, profile.model.modelKey)) {
            throw createError({
                statusCode: 400,
                statusMessage: `profile ${profile.profileKey} 的模型不存在或未启用`,
            });
        }
    }

    const appConfig = await saveAgentProfileSettingsConfig(convertAgentProfileModelSettingsRequestToConfig(body));
    return buildAgentProfileModelSettingsDto(appConfig, profileDefinitions);
});
