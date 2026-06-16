import path from "node:path";
import {compileProfileArtifacts, type CompileProfileArtifactsResult} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions, type VariableDefinitionManifest} from "nbook/server/agent/variables/definition-artifact";
import {syncSystemAssetsToUserAssets, type UserAssetsSyncResult} from "nbook/server/workspace-files/novel-workspace";

export type SystemAssetsPreflightResult = {
    variableManifest: VariableDefinitionManifest;
    profileResult: CompileProfileArtifactsResult;
    userAssetsSync?: UserAssetsSyncResult;
};

/**
 * 准备系统 assets runtime artifact，并按需同步到用户 assets。
 */
export async function prepareSystemAssets(options: {syncUserAssets?: boolean; force?: boolean; forceSyncUserAssets?: boolean} = {}): Promise<SystemAssetsPreflightResult> {
    const profileRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
    const variableDefinitionRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "variables");
    const variableManifest = await compileVariableDefinitions({
        definitionRoot: variableDefinitionRoot,
        rootLabel: "assets/workspace/.nbook/agent/variables",
        skipFresh: !options.force,
    });
    const profileResult = await compileProfileArtifacts({
        profileRoot,
        rootLabel: "assets/workspace/.nbook/agent/profiles",
        skipFresh: !options.force,
    });
    const userAssetsSync = options.syncUserAssets
        ? await syncSystemAssetsToUserAssets({force: options.forceSyncUserAssets})
        : undefined;
    return {variableManifest, profileResult, userAssetsSync};
}
