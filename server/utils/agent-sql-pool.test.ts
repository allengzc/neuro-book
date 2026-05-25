import {afterEach, beforeEach, describe, expect, it} from "vitest";

const originalDatabaseKind = process.env.DATABASE_KIND;
const originalDatabaseUrl = process.env.DATABASE_URL;

describe("agent SQL pool", () => {
    beforeEach(() => {
        delete process.env.DATABASE_KIND;
        delete process.env.DATABASE_URL;
    });

    afterEach(() => {
        restoreEnv("DATABASE_KIND", originalDatabaseKind);
        restoreEnv("DATABASE_URL", originalDatabaseUrl);
    });

    it("使用统一数据库配置创建 Postgres pool", async () => {
        process.env.DATABASE_KIND = "postgres";
        process.env.DATABASE_URL = "postgresql://from-config";
        const {useAgentSqlPool} = await import("nbook/server/utils/agent-sql-pool");

        const pool = useAgentSqlPool();

        expect(pool.options.connectionString).toBe("postgresql://from-config");
    });

    it("SQLite 下拒绝初始化 Postgres pool", async () => {
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/test-sql-pool.sqlite";
        const {useAgentSqlPool} = await import("nbook/server/utils/agent-sql-pool");

        expect(() => useAgentSqlPool()).toThrow("当前 Database Kind 不是 postgres");
    });
});

function restoreEnv(name: "DATABASE_KIND" | "DATABASE_URL", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
