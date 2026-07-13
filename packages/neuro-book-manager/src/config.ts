import {randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {parse, stringify} from "yaml";

import {ensureDirectory, pathExists, writeJsonAtomic, writeTextAtomic} from "#manager/files";

/** 初始化 State Root，并返回本次新建的路径供事务回滚。 */
export async function ensureStateFiles(stateRoot: string, port: number, authEnabled: boolean): Promise<string[]> {
    const created: string[] = [];
    const workspaceRoot = join(stateRoot, "workspace");
    if (!await pathExists(workspaceRoot)) created.push(workspaceRoot);
    await ensureDirectory(join(workspaceRoot, ".nbook"));
    if (!await pathExists(join(stateRoot, "logs"))) created.push(join(stateRoot, "logs"));
    await ensureDirectory(join(stateRoot, "logs"));
    const envPath = join(stateRoot, ".env");
    if (!await pathExists(envPath)) {
        created.push(envPath);
        await writeTextAtomic(envPath, [
            `NUXT_PORT=${port}`,
            `PORT=${port}`,
            "DATABASE_KIND=sqlite",
            "DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite",
            `NUXT_SESSION_PASSWORD=${randomBytes(32).toString("hex")}`,
            "",
        ].join("\n"));
    }
    const bootConfigPath = join(stateRoot, "config.yaml");
    if (!await pathExists(bootConfigPath)) {
        created.push(bootConfigPath);
        await writeTextAtomic(bootConfigPath, stringify({
            server: {host: "0.0.0.0", port},
            database: {kind: "${DATABASE_KIND}", url: "${DATABASE_URL}"},
            auth: {enabled: authEnabled},
        }));
    }
    const globalConfigPath = join(workspaceRoot, ".nbook", "config.json");
    if (!await pathExists(globalConfigPath)) {
        created.push(globalConfigPath);
        await writeJsonAtomic(globalConfigPath, {models: {default: null, providers: []}});
    }
    return created;
}

/** 读取简单 KEY=VALUE 环境文件。 */
export async function loadStateEnv(stateRoot: string): Promise<NodeJS.ProcessEnv> {
    const content = await readFile(join(stateRoot, ".env"), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return "";
        }
        throw error;
    });
    const result: NodeJS.ProcessEnv = {};
    for (const line of content.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const separator = trimmed.indexOf("=");
        if (separator > 0) {
            result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
        }
    }
    return result;
}

/** 仅供 Windows Portable 创建管理员成功后启用鉴权。 */
export async function enableAuthentication(stateRoot: string): Promise<void> {
    const path = join(stateRoot, "config.yaml");
    const config = parse(await readFile(path, "utf8")) as {
        server?: {host?: string; port?: number};
        database?: {kind?: string; url?: string};
        auth?: {enabled?: boolean};
    };
    config.auth = {...config.auth, enabled: true};
    await writeTextAtomic(path, stringify(config));
}
