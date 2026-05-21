import {getQuery} from "h3";
import {
    readWorkspaceAgentProfileSettings,
    resolveWorkspaceProfileSettingsTarget,
} from "nbook/server/agent/profile-settings/workspace-profile-settings";
import {useAgentSystem} from "nbook/server/agent/http";
import {prisma} from "nbook/server/utils/prisma";
import {WorkspaceAgentProfileSettingsQueryDtoSchema} from "nbook/shared/dto/app-settings.dto";
import type {WorkspaceAgentProfileSettingsDto} from "nbook/shared/dto/app-settings.dto";

/**
 * 读取当前 workspace 的 Agent Profile 默认选择。
 */
export default defineEventHandler(async (event): Promise<WorkspaceAgentProfileSettingsDto> => {
    const query = WorkspaceAgentProfileSettingsQueryDtoSchema.parse(getQuery(event));
    const target = await resolveWorkspaceProfileSettingsTarget(prisma, query);

    return readWorkspaceAgentProfileSettings({
        agentSystem: useAgentSystem(),
        workspaceRoot: target.workspaceRoot,
        workspaceKind: target.workspaceKind,
    });
});
