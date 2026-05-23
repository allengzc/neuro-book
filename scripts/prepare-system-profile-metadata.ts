import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {sha256File, type SystemProfileMetadata} from "nbook/server/workspace-files/novel-workspace";

const profileRoot = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const metadataPath = path.join(profileRoot, ".system-profile-metadata.json");

const profileFiles = await findProfileFiles(profileRoot);
const profiles: SystemProfileMetadata["profiles"] = [];

for (const filePath of profileFiles) {
    const relativePath = path.relative(profileRoot, filePath).split(path.sep).join("/");
    const moduleUrl = `${pathToFileURL(filePath).href}?metadata=${Date.now()}`;
    const mod = await importProfile(moduleUrl);
    const profile = mod.default as {manifest?: {key?: unknown}};
    if (!profile?.manifest || typeof profile.manifest.key !== "string" || !profile.manifest.key.trim()) {
        throw new Error(`系统 profile 缺少有效 manifest.key: ${relativePath}`);
    }
    const hash = await sha256File(filePath);
    profiles.push({
        fileName: relativePath,
        profileKey: profile.manifest.key,
        sha256: hash.sha256,
        bytes: hash.bytes,
    });
}

const metadata: SystemProfileMetadata = {
    generatedAt: new Date().toISOString(),
    profilesRoot: "assets/workspace/.nbook/agent/profiles",
    profiles: profiles.sort((left, right) => left.fileName.localeCompare(right.fileName)),
};

await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
console.log(`prepared system profile metadata: ${metadata.profiles.length} profiles`);

async function importProfile(moduleUrl: string): Promise<{default?: unknown}> {
    try {
        return await import(moduleUrl) as {default?: unknown};
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Unknown file extension")) {
            throw error;
        }
        const {tsImport} = await import("tsx/esm/api");
        return await tsImport(moduleUrl, {
            parentURL: import.meta.url,
            tsconfig: path.resolve(process.cwd(), "tsconfig.json"),
        }) as {default?: unknown};
    }
}

async function findProfileFiles(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, {withFileTypes: true});
    const result: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...await findProfileFiles(fullPath));
            continue;
        }
        if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            result.push(fullPath);
        }
    }
    return result.sort((left, right) => left.localeCompare(right));
}
