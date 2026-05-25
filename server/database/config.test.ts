import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

const originalCwd = process.cwd();
const originalDatabaseKind = process.env.DATABASE_KIND;
const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("database config", () => {
    beforeEach(() => {
        process.chdir(originalCwd);
        delete process.env.DATABASE_KIND;
        delete process.env.DATABASE_URL;
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        restoreEnv("DATABASE_KIND", originalDatabaseKind);
        restoreEnv("DATABASE_URL", originalDatabaseUrl);
        if (tempDir) {
            await rm(tempDir, {recursive: true, force: true});
            tempDir = null;
        }
    });

    it("无 env 和 config 时默认 SQLite 文件库", async () => {
        const {resolveDatabaseConfig} = await importFreshConfig();

        const result = resolveDatabaseConfig();

        expect(result.kind).toBe("sqlite");
        expect(result.url).toBe("file:./workspace/.nbook/neuro-book.sqlite");
    });

    it("Boot Config 可以选择自定义 SQLite 文件路径", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "nbook-db-config-"));
        process.chdir(tempDir);
        delete process.env.DATABASE_KIND;
        delete process.env.DATABASE_URL;
        await writeFile("config.yaml", [
            "database:",
            "  kind: sqlite",
            "  url: file:./workspace/.nbook/custom.sqlite",
            "",
        ].join("\n"), "utf-8");

        const {resolveDatabaseConfig} = await importFreshConfig();
        const result = resolveDatabaseConfig();

        expect(result.kind).toBe("sqlite");
        expect(result.url).toBe("file:./workspace/.nbook/custom.sqlite");
        expect(result.sqliteFilePath?.replaceAll("\\", "/")).toContain("/workspace/.nbook/custom.sqlite");
    });

    it("env 覆盖 Boot Config", async () => {
        tempDir = await mkdtemp(join(tmpdir(), "nbook-db-config-"));
        process.chdir(tempDir);
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/env.sqlite";
        await writeFile("config.yaml", [
            "database:",
            "  kind: postgres",
            "  url: postgresql://user:pass@localhost:5432/neuro_book",
            "",
        ].join("\n"), "utf-8");

        const {resolveDatabaseConfig} = await importFreshConfig();
        const result = resolveDatabaseConfig();

        expect(result.kind).toBe("sqlite");
        expect(result.url).toBe("file:./workspace/.nbook/env.sqlite");
    });
});

async function importFreshConfig() {
    return await import(`./config.ts?test=${Date.now()}-${Math.random()}`);
}

function restoreEnv(name: "DATABASE_KIND" | "DATABASE_URL", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
