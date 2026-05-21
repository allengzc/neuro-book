import {getQuery} from "h3";
import {
    resolveWorkspaceProfileSettingsTarget,
    updateWorkspaceAgentProfileSettings,
} from "nbook/server/agent/profile-settings/workspace-profile-settings";
import {useAgentSystem} from "nbook/server/agent/http";
import {prisma} from "nbook/server/utils/prisma";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {
    UpdateWorkspaceAgentProfileSettingsRequestDtoSchema,
    WorkspaceAgentProfileSettingsQueryDtoSchema,
} from "nbook/shared/dto/app-settings.dto";
import type {
    UpdateWorkspaceAgentProfileSettingsRequestDto,
    WorkspaceAgentProfileSettingsDto,
} from "nbook/shared/dto/app-settings.dto";

/**
 * 更新当前 workspace 的 Agent Profile 默认选择。
 */
export default defineEventHandler(async (event): Promise<WorkspaceAgentProfileSettingsDto> => {
    const query = WorkspaceAgentProfileSettingsQueryDtoSchema.parse(getQuery(event));
    const body = await validateBody<UpdateWorkspaceAgentProfileSettingsRequestDto>(
        event,
        UpdateWorkspaceAgentProfileSettingsRequestDtoSchema,
    );
    const target = await resolveWorkspaceProfileSettingsTarget(prisma, query);

    return updateWorkspaceAgentProfileSettings({
        agentSystem: useAgentSystem(),
        workspaceRoot: target.workspaceRoot,
        workspaceKind: target.workspaceKind,
        body,
    });
});
