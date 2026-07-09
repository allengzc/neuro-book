import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {describe, expect, it} from "vitest";
import {
    buildAgentSqlSchemaSummary,
    closeAgentSqliteClient,
    clearAgentSqlSchemaSummaryCache,
    getAgentSqlSchemaSummary,
    hasSqlStatementSeparator,
    validateExecuteSql,
} from "nbook/server/agent/tools/sql-tool";
import {
    resolveProjectAbsolutePath,
    writeProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

describe("v3 execute_sql tool", () => {
    it("schema summary 不会把 sceneId 错挂到 StoryScene", () => {
        const summary = buildAgentSqlSchemaSummary([
            row("StoryScene", "id", 1),
            row("StoryScene", "storyId", 2),
            row("StoryScene", "threadId", 3),
            row("StoryScene", "chapterPath", 4),
            row("StorySceneRef", "id", 1),
            row("StorySceneRef", "sceneId", 2),
        ], []);

        expect(summary).toContain('"StoryScene":');
        expect(summary).toContain('- "storyId": integer');
        expect(summary).toContain('- "sceneId": integer');
        expect(summary).toContain('"StorySceneRef":');
        expect(summary).not.toContain('"StoryScene"(id, "storyId", "threadId", "chapterPath", "sceneId")');
    });

    it("单语句 scanner 允许字符串和注释里的分号", () => {
        expect(hasSqlStatementSeparator("SELECT 'drop table; still text'")).toBe(false);
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

    it("未 open 的 Project 拒绝打开 execute_sql SQLite client", async () => {
        await expect(getAgentSqlSchemaSummary("workspace/not-open")).rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("关闭指定 Project SQLite client 后可以为另一个 Project 重建连接", async () => {
        const firstProjectPath = `workspace/sql-close-${randomUUID()}`;
        const secondProjectPath = `workspace/sql-close-${randomUUID()}`;
        try {
            await createProject(firstProjectPath);
            await createProject(secondProjectPath);

            await expect(getAgentSqlSchemaSummary(firstProjectPath)).resolves.toContain('"ProjectMetadata"');
            await closeAgentSqliteClient(firstProjectPath);

            await expect(getAgentSqlSchemaSummary(secondProjectPath)).resolves.toContain('"ProjectMetadata"');
        } finally {
            await Promise.all([
                closeProjectForTest(firstProjectPath).catch(() => undefined),
                closeProjectForTest(secondProjectPath).catch(() => undefined),
            ]);
            await closeAgentSqliteClient();
            await Promise.all([
                removeProjectRoot(firstProjectPath),
                removeProjectRoot(secondProjectPath),
            ]);
        }
    }, 15_000);
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

async function createProject(projectPath: string): Promise<void> {
    await writeProjectManifest(projectPath, {
        kind: "novel",
        title: projectPath,
        summary: "",
    });
    await openProjectForTest(projectPath);
}

async function removeProjectRoot(projectPath: string): Promise<void> {
    const projectRoot = resolveProjectAbsolutePath(projectPath);
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        collectReleasedSqliteHandles();
        try {
            await rm(projectRoot, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY")) {
                throw error;
            }
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw lastError;
}
