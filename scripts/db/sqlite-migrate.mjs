#!/usr/bin/env bun
import {readdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createClient} from "@libsql/client";
import {preparePrismaEnv} from "./prisma-env.mjs";

const MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations", "sqlite");

const env = preparePrismaEnv();
if (env.kind !== "sqlite") {
    throw new Error("sqlite-migrate 只能在 DATABASE_KIND=sqlite 时运行。");
}

const client = createClient({url: env.databaseUrl});
await client.execute(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "checksum" TEXT NOT NULL DEFAULT '',
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
`);

const entries = await readdir(MIGRATIONS_DIR, {withFileTypes: true});
const migrationNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

for (const migrationName of migrationNames) {
    const existing = await client.execute({
        sql: `SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = ? AND "finished_at" IS NOT NULL LIMIT 1`,
        args: [migrationName],
    });
    if (existing.rows.length > 0) {
        continue;
    }

    const sql = await readFile(resolve(MIGRATIONS_DIR, migrationName, "migration.sql"), "utf-8");
    await executeMigration(sql);
    await client.execute({
        sql: `
            INSERT INTO "_prisma_migrations" (
                "id",
                "checksum",
                "finished_at",
                "migration_name",
                "logs",
                "rolled_back_at",
                "started_at",
                "applied_steps_count"
            )
            VALUES (?, '', CURRENT_TIMESTAMP, ?, NULL, NULL, CURRENT_TIMESTAMP, 1)
        `,
        args: [`manual-${migrationName}`, migrationName],
    });
    console.log(`Applied SQLite migration ${migrationName}`);
}

async function executeMigration(sql) {
    const statements = splitSqlStatements(sql);
    await client.execute("BEGIN");
    try {
        for (const statement of statements) {
            await client.execute(statement);
        }
        await client.execute("COMMIT");
    } catch (error) {
        await client.execute("ROLLBACK");
        throw error;
    }
}

function splitSqlStatements(sql) {
    const statements = [];
    let current = "";
    let index = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < sql.length) {
        const char = sql[index] ?? "";
        const nextChar = sql[index + 1] ?? "";

        if (inLineComment) {
            current += char;
            if (char === "\n" || char === "\r") {
                inLineComment = false;
            }
            index++;
            continue;
        }
        if (inBlockComment) {
            current += char;
            if (char === "*" && nextChar === "/") {
                current += nextChar;
                inBlockComment = false;
                index += 2;
                continue;
            }
            index++;
            continue;
        }
        if (inSingleQuote) {
            current += char;
            if (char === "'" && nextChar === "'") {
                current += nextChar;
                index += 2;
                continue;
            }
            if (char === "'") {
                inSingleQuote = false;
            }
            index++;
            continue;
        }
        if (inDoubleQuote) {
            current += char;
            if (char === "\"" && nextChar === "\"") {
                current += nextChar;
                index += 2;
                continue;
            }
            if (char === "\"") {
                inDoubleQuote = false;
            }
            index++;
            continue;
        }
        if (char === "-" && nextChar === "-") {
            current += char + nextChar;
            inLineComment = true;
            index += 2;
            continue;
        }
        if (char === "/" && nextChar === "*") {
            current += char + nextChar;
            inBlockComment = true;
            index += 2;
            continue;
        }
        if (char === "'") {
            inSingleQuote = true;
            current += char;
            index++;
            continue;
        }
        if (char === "\"") {
            inDoubleQuote = true;
            current += char;
            index++;
            continue;
        }
        if (char === ";") {
            const statement = current.trim();
            if (statement) {
                statements.push(statement);
            }
            current = "";
            index++;
            continue;
        }
        current += char;
        index++;
    }

    const last = current.trim();
    if (last) {
        statements.push(last);
    }
    return statements;
}
