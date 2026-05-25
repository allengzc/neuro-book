import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {defineConfig, env} from "prisma/config";
import * as yaml from "yaml";

type DatabaseKind = "sqlite" | "postgres";

const databaseConfig = resolveDatabaseConfig();
process.env.DATABASE_KIND = databaseConfig.kind;
process.env.DATABASE_URL = databaseConfig.url;

export default defineConfig({
    schema: databaseConfig.kind === "sqlite" ? "prisma/schema.sqlite.prisma" : "prisma/schema.postgres.prisma",
    datasource: {
        url: env("DATABASE_URL"),
    },
    migrations: {
        path: databaseConfig.kind === "sqlite" ? "prisma/migrations/sqlite" : "prisma/migrations/postgres",
    },
});

function resolveDatabaseConfig(): {kind: DatabaseKind; url: string} {
    const rawKind = process.env.DATABASE_KIND?.trim().toLowerCase();
    const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
    const bootDatabase = readBootDatabaseConfig();
    const bootKind = normalizeKind(bootDatabase.kind);
    const bootUrl = normalizeText(bootDatabase.url);
    const kind = rawKind ? normalizeKind(rawKind) : inferKindFromUrl(databaseUrl) ?? bootKind ?? inferKindFromUrl(bootUrl) ?? "sqlite";
    const url = databaseUrl || bootUrl || (kind === "sqlite" ? "file:./workspace/.nbook/neuro-book.sqlite" : "");

    assertDatabaseConfig(kind, url);
    return {kind, url};
}

function readBootDatabaseConfig(): {kind?: unknown; url?: unknown} {
    const configPath = path.resolve(process.cwd(), "config.yaml");
    if (!fs.existsSync(configPath)) {
        return {};
    }

    const text = fs.readFileSync(configPath, "utf-8");
    const expanded = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
        const value = process.env[name];
        return value !== undefined && value !== "" ? value : fallback ?? "";
    });
    const parsed = yaml.parse(expanded) as {database?: {kind?: unknown; url?: unknown}} | null;
    return parsed?.database && typeof parsed.database === "object" ? parsed.database : {};
}

function normalizeKind(input: unknown): DatabaseKind | null {
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

function normalizeText(input: unknown): string {
    return typeof input === "string" ? input.trim() : "";
}

function inferKindFromUrl(url: string): DatabaseKind | null {
    if (url.startsWith("file:")) {
        return "sqlite";
    }
    if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
        return "postgres";
    }
    return null;
}

function assertDatabaseConfig(kind: DatabaseKind, url: string): void {
    if (kind === "sqlite") {
        if (!url.startsWith("file:")) {
            throw new Error(`DATABASE_KIND=sqlite 时 DATABASE_URL 必须以 file: 开头，当前为：${url || "<empty>"}`);
        }
        return;
    }
    if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
        throw new Error(`DATABASE_KIND=postgres 时 DATABASE_URL 必须是 PostgreSQL URL，当前为：${url || "<empty>"}`);
    }
}
