import {open, rm} from "node:fs/promises";
import {dirname} from "node:path";

import {ensureDirectory} from "#manager/files";

/** 在 Installation Root 级安装锁内执行操作。 */
export async function withInstallLock<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
    await ensureDirectory(dirname(lockPath));
    let handle;
    try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(`${JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()})}\n`, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new Error(`另一个 NeuroBook Manager 操作正在执行：${lockPath}`);
        }
        throw error;
    }
    try {
        return await task();
    } finally {
        await handle.close();
        await rm(lockPath, {force: true});
    }
}
