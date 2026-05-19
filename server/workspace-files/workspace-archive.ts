import fs from "node:fs/promises";
import path from "node:path";
import type {Readable} from "node:stream";
import {ZipFile} from "yazl";
import {
    readWorkspaceIgnoreRules,
    resolveWorkspaceRoot,
    shouldSkipWorkspacePath,
    type WorkspaceIgnoreRule,
} from "nbook/server/workspace-files/workspace-files";

export type WorkspaceArchive = {
    root: string;
    filename: string;
    stream: Readable;
};

/**
 * 创建当前 workspace 的 zip 输出流。
 */
export async function createWorkspaceZipStream(rootInput: string | undefined): Promise<WorkspaceArchive> {
    const root = resolveWorkspaceRoot(rootInput);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
        throw new Error("Workspace root is not a directory");
    }

    const ignoreRules = await readWorkspaceIgnoreRules(root);
    const zipFile = new ZipFile();
    await addWorkspaceEntries(zipFile, root, root, ignoreRules);
    zipFile.end();

    return {
        root,
        filename: `${path.basename(root)}.zip`,
        stream: zipFile.outputStream,
    };
}

/**
 * 递归加入 workspace 文件；目录只在为空时写入 zip，文件保留相对路径。
 */
async function addWorkspaceEntries(zipFile: ZipFile, root: string, currentPath: string, ignoreRules: WorkspaceIgnoreRule[]): Promise<boolean> {
    const entries = await fs.readdir(currentPath, {withFileTypes: true});
    let added = false;

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"))) {
        const absolutePath = path.join(currentPath, entry.name);
        if (shouldSkipWorkspacePath(root, absolutePath, entry.isDirectory(), ignoreRules)) {
            continue;
        }

        const archivePath = toArchivePath(root, absolutePath);
        if (entry.isDirectory()) {
            const childAdded = await addWorkspaceEntries(zipFile, root, absolutePath, ignoreRules);
            if (!childAdded) {
                zipFile.addEmptyDirectory(`${archivePath}/`);
            }
            added = true;
            continue;
        }

        if (entry.isFile()) {
            zipFile.addFile(absolutePath, archivePath);
            added = true;
        }
    }

    return added;
}

/**
 * 把绝对路径转成 zip 内使用的 POSIX 相对路径。
 */
function toArchivePath(root: string, absolutePath: string): string {
    return path.relative(root, absolutePath).split(path.sep).join("/");
}
