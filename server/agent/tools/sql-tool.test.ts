import {describe, expect, it} from "vitest";
import {
    buildAgentSqlSchemaSummary,
    clearAgentSqlSchemaSummaryCache,
    hasSqlStatementSeparator,
    validateExecuteSql,
} from "nbook/server/agent/tools/sql-tool";

describe("v3 execute_sql tool", () => {
    it("schema summary 不会把 sceneId 错挂到 StoryScene", () => {
        const summary = buildAgentSqlSchemaSummary([
            row("StoryScene", "id", 1),
            row("StoryScene", "storyId", 2),
            row("StoryScene", "threadId", 3),
            row("StoryScene", "chapterPath", 4),
            row("StoryPlot", "id", 1),
            row("StoryPlot", "sceneId", 2),
            row("StorySceneRef", "id", 1),
            row("StorySceneRef", "sceneId", 2),
        ], []);

        expect(summary).toContain('"StoryScene"(id, "storyId", "threadId", "chapterPath")');
        expect(summary).toContain('"StoryPlot"(id, "sceneId")');
        expect(summary).toContain('"StorySceneRef"(id, "sceneId")');
        expect(summary).not.toContain('"StoryScene"(id, "storyId", "threadId", "chapterPath", "sceneId")');
    });

    it("单语句 scanner 允许字符串和注释里的分号", () => {
        expect(hasSqlStatementSeparator("SELECT 'drop table; still text'")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT $$a;b$$")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT 1 -- ; comment\n")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT /* ; */ 1")).toBe(false);
        expect(hasSqlStatementSeparator("SELECT 1; SELECT 2")).toBe(true);
    });

    it("SQL 校验允许 CTE、尾部分号和写入语句", () => {
        expect(() => validateExecuteSql("WITH rows AS (SELECT 1) SELECT * FROM rows")).not.toThrow();
        expect(() => validateExecuteSql("SELECT 1;")).not.toThrow();
        expect(() => validateExecuteSql("INSERT INTO \"StoryScene\" (id) VALUES (1)")).not.toThrow();
        expect(() => validateExecuteSql("UPDATE \"StoryScene\" SET title = 'x' WHERE id = 1")).not.toThrow();
        expect(() => validateExecuteSql("DELETE FROM \"StoryScene\" WHERE id = 1")).not.toThrow();
    });

    it("SQL 校验拒绝多语句和不允许的首关键字", () => {
        expect(() => validateExecuteSql("SELECT 1; SELECT 2")).toThrow("sql 只允许单条语句");
        for (const keyword of ["ALTER", "CREATE", "DROP", "TRUNCATE", "COPY", "VACUUM"]) {
            expect(() => validateExecuteSql(`${keyword} TABLE "StoryScene"`)).toThrow("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
        }
    });

    it("schema summary cache 支持显式清空", () => {
        expect(() => clearAgentSqlSchemaSummaryCache()).not.toThrow();
    });
});

function row(tableName: string, columnName: string, ordinalPosition: number) {
    return {
        tableName,
        columnName,
        ordinalPosition,
        isNullable: "NO" as const,
        columnDefault: null,
        dataType: "integer",
        udtName: "int4",
    };
}
