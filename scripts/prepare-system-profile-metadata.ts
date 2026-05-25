import fs from "node:fs/promises";
import path from "node:path";
import {
    compileProfileArtifacts,
    readProfileArtifactManifest,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions} from "nbook/server/agent/variables/definition-artifact";
import type {SystemProfileMetadata} from "nbook/server/workspace-files/novel-workspace";

const profileRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const variableDefinitionRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "variables");
const metadataPath = path.join(profileRoot, ".system-profile-metadata.json");

await compileVariableDefinitions({
    definitionRoot: variableDefinitionRoot,
    rootLabel: "assets/workspace/.nbook/agent/variables",
});

await compileProfileArtifacts({
    profileRoot,
    rootLabel: "assets/workspace/.nbook/agent/profiles",
});

const artifactManifest = await readProfileArtifactManifest(profileRoot);
const existingMetadata = await readExistingMetadata(metadataPath);
const profiles = artifactManifest.profiles
    .map((profile) => ({
        fileName: profile.fileName,
        profileKey: profile.profileKey,
        sha256: profile.sourceSha256,
        bytes: profile.sourceBytes,
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
const metadata: SystemProfileMetadata = {
    generatedAt: JSON.stringify(existingMetadata?.profiles) === JSON.stringify(profiles)
        ? existingMetadata.generatedAt
        : new Date().toISOString(),
    profilesRoot: "assets/workspace/.nbook/agent/profiles",
    profiles,
};

await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
console.log(`prepared system profile metadata: ${metadata.profiles.length} profiles`);

async function readExistingMetadata(filePath: string): Promise<SystemProfileMetadata | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf-8")) as SystemProfileMetadata;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
