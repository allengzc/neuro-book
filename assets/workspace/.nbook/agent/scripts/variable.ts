import {pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const variableEntry = await resolveVariableEntry(import.meta.dirname);
await import(pathToFileURL(variableEntry).href);

/**
 * 定位 variable CLI 入口。Product Root 下优先使用 `.output/server` 里的
 * 已打包脚本；开发环境再 fallback 到仓库源码入口。
 */
async function resolveVariableEntry(startDirectory: string): Promise<string> {
    let currentDirectory = path.resolve(startDirectory);
    while (true) {
        const productEntry = path.join(currentDirectory, ".output", "server", "scripts", "build", "variable.ts");
        if (await pathExists(productEntry)) {
            return productEntry;
        }
        const sourceEntry = path.join(currentDirectory, "scripts", "build", "variable.ts");
        if (await pathExists(path.join(currentDirectory, "package.json")) && await pathExists(sourceEntry)) {
            return sourceEntry;
        }
        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            throw new Error("无法定位 NeuroBook variable CLI 入口。");
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
