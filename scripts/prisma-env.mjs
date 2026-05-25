import "dotenv/config";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import * as yaml from "yaml";

const DEFAULT_SQLITE_URL = "file:./workspace/.nbook/neuro-book.sqlite";
const BOOT_CONFIG_PATH = resolve(process.cwd(), "config.yaml");

export function resolveDatabaseKind() {
    const rawKind = process.env.DATABASE_KIND?.trim().toLowerCase();
    const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
    const bootDatabase = readBootDatabaseConfig();
    const bootKind = normalizeKind(bootDatabase.kind);
    const bootUrl = normalizeText(bootDatabase.url);

    if (rawKind) {
        return normalizeKind(rawKind);
    }
    if (databaseUrl.startsWith("file:")) {
        return "sqlite";
    }
    if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
        return "postgres";
    }
    if (databaseUrl) {
        throw new Error(`DATABASE_URL 必须是 sqlite file: URL 或 PostgreSQL URL，当前为：${databaseUrl}`);
    }
    if (bootKind) {
        return bootKind;
    }
    if (bootUrl.startsWith("file:")) {
        return "sqlite";
    }
    if (bootUrl.startsWith("postgres://") || bootUrl.startsWith("postgresql://")) {
        return "postgres";
    }
    return "sqlite";
}

export function preparePrismaEnv() {
    const kind = resolveDatabaseKind();
    const bootDatabase = readBootDatabaseConfig();
    const bootUrl = normalizeText(bootDatabase.url);
    process.env.DATABASE_KIND = kind;
    if (!process.env.DATABASE_URL) {
        process.env.DATABASE_URL = bootUrl || (kind === "sqlite" ? DEFAULT_SQLITE_URL : "");
    }

    const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
    if (kind === "sqlite") {
        if (!databaseUrl.startsWith("file:")) {
            throw new Error(`DATABASE_KIND=sqlite 时 DATABASE_URL 必须以 file: 开头，当前为：${databaseUrl || "<empty>"}`);
        }
        mkdirSync(dirname(resolve(process.cwd(), databaseUrl.slice("file:".length))), {recursive: true});
        return {kind, databaseUrl};
    }

    if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
        throw new Error(`DATABASE_KIND=postgres 时 DATABASE_URL 必须是 PostgreSQL URL，当前为：${databaseUrl || "<empty>"}`);
    }
    return {kind, databaseUrl};
}

function readBootDatabaseConfig() {
    if (!existsSync(BOOT_CONFIG_PATH)) {
        return {};
    }

    const text = readFileSync(BOOT_CONFIG_PATH, "utf-8");
    const expanded = expandEnvTemplates(text);
    const parsed = yaml.parse(expanded);
    return parsed?.database && typeof parsed.database === "object" ? parsed.database : {};
}

function expandEnvTemplates(input) {
    return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name, fallback) => {
        const value = process.env[name];
        return value !== undefined && value !== "" ? value : fallback ?? "";
    });
}

function normalizeKind(input) {
    const value = normalizeText(input).toLowerCase();
    if (!value) {
        return null;
    }
    if (value === "sqlite" || value === "postgres") {
        return value;
    }
    if (value === "postgresql") {
        return "postgres";
    }
    throw new Error(`DATABASE_KIND 只支持 sqlite 或 postgres，当前为：${String(input)}`);
}

function normalizeText(input) {
    return typeof input === "string" ? input.trim() : "";
}
