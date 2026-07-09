import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";

const args = new Set(process.argv.slice(2));
const syncUserAssets = args.has("--sync-user-assets");
const force = args.has("--force");
const forceSyncUserAssets = args.has("--force-sync-user-assets");

const result = await prepareSystemAssets({syncUserAssets, force, forceSyncUserAssets});

console.log(`prepared system variable definitions: ${result.variableManifest.definitions.length} definition file(s)`);
console.log(`prepared system profiles: ${result.profileResult.manifest.profiles.length} profile(s), compiled ${result.profileResult.compiled.length} stale profile(s)`);

if (result.userAssetsSync) {
    console.log(`synced user assets: copied ${result.userAssetsSync.copied}, updated profiles ${result.userAssetsSync.updatedProfiles ?? 0}, updated assets ${result.userAssetsSync.updatedAssets ?? 0}, skipped ${result.userAssetsSync.skipped}`);
    for (const warning of result.userAssetsSync.profileWarnings ?? []) {
        console.warn(`profile sync warning: ${warning.fileName} ${warning.message}`);
    }
    for (const warning of result.userAssetsSync.assetWarnings ?? []) {
        console.warn(`asset sync warning: ${warning.assetPath} ${warning.message}`);
    }
}
