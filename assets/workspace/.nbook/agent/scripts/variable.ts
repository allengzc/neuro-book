import {pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const repositoryRoot = await findRepositoryRoot(import.meta.dirname);
await import(pathToFileURL(path.join(repositoryRoot, "scripts", "variable.ts")).href);

async function findRepositoryRoot(startDirectory: string): Promise<string> {
    let currentDirectory = path.resolve(startDirectory);
    while (true) {
        if (await pathExists(path.join(currentDirectory, "package.json")) && await pathExists(path.join(currentDirectory, "scripts", "variable.ts"))) {
            return currentDirectory;
        }
        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            throw new Error("无法定位 neuro-book 仓库根目录。");
        }
        currentDirectory = parentDirectory;
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
