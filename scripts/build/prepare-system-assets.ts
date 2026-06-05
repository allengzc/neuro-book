import path from "node:path";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions} from "nbook/server/agent/variables/definition-artifact";
import {syncSystemAssetsToUserAssets} from "nbook/server/workspace-files/novel-workspace";

const args = new Set(process.argv.slice(2));
const syncUserAssets = args.has("--sync-user-assets");
const force = args.has("--force");

const profileRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const variableDefinitionRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "variables");

const variableManifest = await compileVariableDefinitions({
    definitionRoot: variableDefinitionRoot,
    rootLabel: "assets/workspace/.nbook/agent/variables",
    skipFresh: !force,
});

const profileResult = await compileProfileArtifacts({
    profileRoot,
    rootLabel: "assets/workspace/.nbook/agent/profiles",
    skipFresh: !force,
});

console.log(`prepared system variable definitions: ${variableManifest.definitions.length} definition file(s)`);
console.log(`prepared system profiles: ${profileResult.manifest.profiles.length} profile(s), compiled ${profileResult.compiled.length} stale profile(s)`);

if (syncUserAssets) {
    const result = await syncSystemAssetsToUserAssets();
    console.log(`synced user assets: copied ${result.copied}, updated profiles ${result.updatedProfiles ?? 0}, updated assets ${result.updatedAssets ?? 0}, skipped ${result.skipped}`);
    for (const warning of result.profileWarnings ?? []) {
        console.warn(`profile sync warning: ${warning.fileName} ${warning.message}`);
    }
    for (const warning of result.assetWarnings ?? []) {
        console.warn(`asset sync warning: ${warning.assetPath} ${warning.message}`);
    }
}
