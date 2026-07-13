import fs from "node:fs";
import path from "node:path";
import * as yaml from "yaml";
import {resolveBootConfigPath, resolveStateRoot} from "nbook/server/runtime/installation-paths";

export type DatabaseKind = "sqlite";

export type DatabaseRuntimeConfig = {
    kind: DatabaseKind;
    url: string;
    sqliteFilePath: string | null;
};

const DEFAULT_SQLITE_URL = "file:./workspace/.nbook/neuro-book.sqlite";

/**
 * 解析当前进程实际使用的数据库配置。
 *
 * `.env` / 进程环境是执行真值源；`config.yaml` 只作为部署镜像和诊断输入，
 * 不覆盖进程环境。缺省时使用 App SQLite 文件库。
 */
export function resolveDatabaseConfig(): DatabaseRuntimeConfig {
    const bootDatabase = readBootDatabaseConfig();
    const envKind = normalizeKind(process.env.DATABASE_KIND);
    const envUrl = normalizeText(process.env.DATABASE_URL);
    const bootKind = normalizeKind(bootDatabase.kind);
    const bootUrl = normalizeText(bootDatabase.url);
    const kind = envKind ?? inferKindFromUrl(envUrl) ?? bootKind ?? inferKindFromUrl(bootUrl) ?? "sqlite";
    const url = envUrl || bootUrl || DEFAULT_SQLITE_URL;

    assertDatabaseConfig(kind, url);
    const sqliteFilePath = resolveSqliteFilePath(url);
    fs.mkdirSync(path.dirname(sqliteFilePath), {recursive: true});

    return {
        kind,
        url,
        sqliteFilePath,
    };
}

/**
 * 判断当前 Database Kind。
 */
export function currentDatabaseKind(): DatabaseKind {
    return resolveDatabaseConfig().kind;
}

/**
 * SQLite URL 默认值，供部署脚本和测试复用。
 */
export function defaultSqliteDatabaseUrl(): string {
    return DEFAULT_SQLITE_URL;
}

/**
 * 将 SQLite file URL 解析成本机绝对路径。
 */
export function resolveSqliteFilePath(url: string): string {
    if (!url.startsWith("file:")) {
        throw new Error(`SQLite DATABASE_URL 必须以 file: 开头，当前为：${url}`);
    }

    const rawPath = url.slice("file:".length);
    if (!rawPath || rawPath === ":memory:") {
        throw new Error("SQLite DATABASE_URL 必须指向文件路径，不能使用空路径或内存库。");
    }

    return path.resolve(resolveStateRoot(), rawPath);
}

function readBootDatabaseConfig(): {kind?: unknown; url?: unknown} {
    try {
        const text = fs.readFileSync(resolveBootConfigPath(), "utf-8");
        const expanded = expandEnvTemplates(text);
        const parsed = yaml.parse(expanded) as {database?: {kind?: unknown; url?: unknown}} | null;
        return parsed?.database && typeof parsed.database === "object" ? parsed.database : {};
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}

function expandEnvTemplates(input: string): string {
    return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
        const value = process.env[name];
        return value !== undefined && value !== "" ? value : fallback ?? "";
    });
}

function normalizeKind(input: unknown): DatabaseKind | null {
    const value = normalizeText(input).toLowerCase();
    if (!value) {
        return null;
    }
    if (value === "sqlite") {
        return "sqlite";
    }
    throw new Error(`DATABASE_KIND 只支持 sqlite，当前为：${String(input)}`);
}

function normalizeText(input: unknown): string {
    return typeof input === "string" ? input.trim() : "";
}

function inferKindFromUrl(url: string): DatabaseKind | null {
    if (!url) {
        return null;
    }
    if (url.startsWith("file:")) {
        return "sqlite";
    }
    throw new Error(`DATABASE_URL 只支持 SQLite file: URL，当前为：${url}`);
}

function assertDatabaseConfig(kind: DatabaseKind, url: string): void {
    if (kind !== "sqlite" || !url.startsWith("file:")) {
        throw new Error(`App SQLite DATABASE_URL 必须以 file: 开头，当前为：${url || "<empty>"}`);
    }
}
