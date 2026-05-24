import fs from "node:fs/promises";
import path from "node:path";
import {
    compileProfileArtifacts,
    readProfileArtifactManifest,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {SystemProfileMetadata} from "nbook/server/workspace-files/novel-workspace";

const profileRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const metadataPath = path.join(profileRoot, ".system-profile-metadata.json");

await compileProfileArtifacts({
    profileRoot,
    rootLabel: "assets/workspace/.nbook/agent/profiles",
});

const artifactManifest = await readProfileArtifactManifest(profileRoot);
const metadata: SystemProfileMetadata = {
    generatedAt: new Date().toISOString(),
    profilesRoot: "assets/workspace/.nbook/agent/profiles",
    profiles: artifactManifest.profiles
        .map((profile) => ({
            fileName: profile.fileName,
            profileKey: profile.profileKey,
            sha256: profile.sourceSha256,
            bytes: profile.sourceBytes,
        }))
        .sort((left, right) => left.fileName.localeCompare(right.fileName)),
};

await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
console.log(`prepared system profile metadata: ${metadata.profiles.length} profiles`);
