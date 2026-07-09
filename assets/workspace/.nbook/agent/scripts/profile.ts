import {pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const profileEntry = await resolveProfileEntry(import.meta.dirname);
process.chdir(profileEntry.applicationRoot);
await import(pathToFileURL(profileEntry.entry).href);

/**
 * 定位 profile CLI 入口。Product Runtime 必须走 `.output/server`，避免
 * portable 环境从根目录源码脚本解析裸依赖；源码仓则优先使用源码入口，
 * 避免开发目录里残留的 `.output` stale copy 被误用。
 */
async function resolveProfileEntry(startDirectory: string): Promise<{entry: string; applicationRoot: string}> {
    let currentDirectory = path.resolve(startDirectory);
    while (true) {
        const productEntry = path.join(currentDirectory, ".output", "server", "scripts", "build", "profile.ts");
        if (await isProductRuntimeRoot(currentDirectory) && await pathExists(productEntry)) {
            return {entry: productEntry, applicationRoot: currentDirectory};
        }
        const sourceEntry = path.join(currentDirectory, "scripts", "build", "profile.ts");
        if (await pathExists(path.join(currentDirectory, "package.json")) && await pathExists(sourceEntry)) {
            return {entry: sourceEntry, applicationRoot: currentDirectory};
        }
        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            throw new Error("无法定位 NeuroBook profile CLI 入口。");
        }
        currentDirectory = parentDirectory;
    }
}

async function isProductRuntimeRoot(root: string): Promise<boolean> {
    if (!await pathExists(path.join(root, ".output", "server", "index.mjs"))) {
        return false;
    }
    if (await packageManifestName(path.join(root, "package.json")) === "neuro-book-product") {
        return true;
    }
    return await packageManifestName(path.join(root, ".output", "server", "package.json")) === "neuro-book-output"
        && !await pathExists(path.join(root, "node_modules"));
}

async function packageManifestName(filePath: string): Promise<string | null> {
    try {
        const manifest = JSON.parse(await fs.readFile(filePath, "utf8")) as {name?: unknown};
        return typeof manifest.name === "string" ? manifest.name : null;
    } catch {
        return null;
    }
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
