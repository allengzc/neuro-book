import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join, resolve} from "node:path";

/** Manager 的标准目录集合。 */
export type InstallationPaths = {
    root: string;
    deploy: string;
    runtime: string;
    state: string;
    manifest: string;
    staging: string;
    backups: string;
    operations: string;
};

/** 根据 Profile 解析 State Root。 */
export function installationPaths(root: string, portable = false): InstallationPaths {
    const absoluteRoot = resolve(root);
    const deploy = join(absoluteRoot, ".deploy");
    return {
        root: absoluteRoot,
        deploy,
        runtime: join(absoluteRoot, ".runtime"),
        state: portable ? join(absoluteRoot, "data") : absoluteRoot,
        manifest: join(deploy, "installation.json"),
        staging: join(deploy, "staging"),
        backups: join(deploy, "backups"),
        operations: join(deploy, "operations"),
    };
}

/** 从当前目录向上寻找 installation.json 或 Git checkout。 */
export function discoverInstallationRoot(start = process.cwd()): string {
    let current = resolve(start);
    while (true) {
        if (existsSync(join(current, ".deploy", "installation.json")) || existsSync(join(current, ".git"))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return resolve(start);
}

/** Stage 0 与 Manager 使用的用户级 cache。 */
export function managerCacheRoot(): string {
    if (process.platform === "win32") {
        return resolve(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "NeuroBook", "manager");
    }
    return resolve(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "neuro-book-manager");
}
