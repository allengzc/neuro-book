var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/workspace-files/project-workspace.ts
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import * as yaml from "yaml";
function normalizeProjectPath(input) {
  const normalized = input.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
  if (!normalized || normalized === "workspace" || normalized.includes("..") || path.posix.isAbsolute(normalized)) {
    throw createError({ statusCode: 400, message: "projectPath \u5FC5\u987B\u662F workspace \u4E0B\u7684\u9879\u76EE\u76EE\u5F55" });
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "workspace") {
    throw createError({ statusCode: 400, message: "projectPath \u5FC5\u987B\u5F62\u5982 workspace/<project>" });
  }
  return normalized;
}
function resolveProjectAbsolutePath(projectPath) {
  return path.resolve(process.cwd(), normalizeProjectPath(projectPath));
}
function resolveProjectDatabasePath(projectPath) {
  return path.join(resolveProjectAbsolutePath(projectPath), PROJECT_DATABASE_RELATIVE_PATH);
}
async function readProjectManifest(projectPath) {
  const manifestPath = path.join(resolveProjectAbsolutePath(projectPath), PROJECT_MANIFEST_FILE);
  const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8"));
  if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
    throw createError({ statusCode: 400, message: `${projectPath}/${PROJECT_MANIFEST_FILE} \u4E0D\u662F\u6709\u6548 Project manifest` });
  }
  return {
    kind: "novel",
    title: parsed.title,
    summary: typeof parsed.summary === "string" ? parsed.summary : ""
  };
}
async function initProjectDatabase(projectPath) {
  const databasePath = resolveProjectDatabasePath(projectPath);
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const client = createClient({ url: toSqliteFileUrl(databasePath) });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
      await client.execute(statement);
    }
  } finally {
    client.close();
  }
  return databasePath;
}
function toSqliteFileUrl(filePath) {
  return `file:${path.resolve(filePath).replaceAll("\\", "/")}`;
}
function splitSqlStatements(sql) {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}
var PROJECT_MANIFEST_FILE, PROJECT_DATABASE_RELATIVE_PATH, PROJECT_MIGRATION_SQL;
var init_project_workspace = __esm({
  "server/workspace-files/project-workspace.ts"() {
    "use strict";
    PROJECT_MANIFEST_FILE = "project.yaml";
    PROJECT_DATABASE_RELATIVE_PATH = ".nbook/project.sqlite";
    PROJECT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS "ProjectMetadata" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "DatabaseLock" (
    "key" INTEGER NOT NULL PRIMARY KEY,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Story" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "StoryPhase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPhase_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryThread" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "storyPhaseId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isMainThread" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryThread_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryThread_storyPhaseId_fkey" FOREIGN KEY ("storyPhaseId") REFERENCES "StoryPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryScene" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "chapterPath" TEXT,
    "threadSortOrder" INTEGER NOT NULL,
    "chapterSortOrder" INTEGER,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryScene_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StoryPlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "effect" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPlot_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "StorySceneRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetThreadId" INTEGER,
    "targetSceneId" INTEGER,
    "targetPlotId" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'author',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorySceneRef_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetPlotId_fkey" FOREIGN KEY ("targetPlotId") REFERENCES "StoryPlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPhase_storyId_name_key" ON "StoryPhase"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryPhase_storyId_sortOrder_idx" ON "StoryPhase"("storyId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryThread_storyId_name_key" ON "StoryThread"("storyId", "name");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_storyPhaseId_sortOrder_idx" ON "StoryThread"("storyId", "storyPhaseId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StoryThread_storyId_isMainThread_status_idx" ON "StoryThread"("storyId", "isMainThread", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_chapterPath_chapterSortOrder_idx" ON "StoryScene"("chapterPath", "chapterSortOrder");
CREATE INDEX IF NOT EXISTS "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryPlot_sceneId_sortOrder_key" ON "StoryPlot"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StoryPlot_sceneId_sortOrder_idx" ON "StoryPlot"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId");
CREATE INDEX IF NOT EXISTS "StorySceneRef_targetPlotId_idx" ON "StorySceneRef"("targetPlotId");
INSERT INTO "ProjectMetadata" ("key", "value", "updatedAt")
VALUES ('schemaVersion', '1', CURRENT_TIMESTAMP)
ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
`;
  }
});

// server/agent/tools/sql-tool.ts
var sql_tool_exports = {};
__export(sql_tool_exports, {
  buildAgentSqlErrorMessage: () => buildAgentSqlErrorMessage,
  buildAgentSqlSchemaSummary: () => buildAgentSqlSchemaSummary,
  clearAgentSqlSchemaSummaryCache: () => clearAgentSqlSchemaSummaryCache,
  createSqlTool: () => createSqlTool,
  getAgentSqlSchemaSummary: () => getAgentSqlSchemaSummary,
  hasSqlStatementSeparator: () => hasSqlStatementSeparator,
  validateExecuteSql: () => validateExecuteSql
});
import { createClient as createClient2 } from "@libsql/client";
import { Type } from "typebox";
function buildAgentSqlSchemaSummary(rows, foreignKeys) {
  if (rows.length === 0) {
    return "\u5F53\u524D Project SQLite \u5C1A\u672A\u53D1\u73B0\u4E1A\u52A1\u8868\uFF0C\u8BF7\u5148\u786E\u8BA4\u9879\u76EE\u6570\u636E\u5E93\u662F\u5426\u5B8C\u6210\u521D\u59CB\u5316\u3002";
  }
  const tableColumns = /* @__PURE__ */ new Map();
  const detailedTableColumns = /* @__PURE__ */ new Map();
  const foreignKeyMap = /* @__PURE__ */ new Map();
  for (const foreignKey of foreignKeys) {
    foreignKeyMap.set(`${foreignKey.tableName}.${foreignKey.columnName}`, foreignKey);
  }
  for (const row of rows) {
    tableColumns.set(row.tableName, [...tableColumns.get(row.tableName) ?? [], formatSummaryColumnName(row.columnName)]);
    detailedTableColumns.set(row.tableName, [...detailedTableColumns.get(row.tableName) ?? [], row]);
  }
  const lines = ["\u5F53\u524D Project SQLite \u4E1A\u52A1\u8868\uFF08\u8868\u540D\u548C camelCase \u5B57\u6BB5\u6309\u539F\u6837\u53CC\u5F15\u53F7\u5F15\u7528\u6700\u7A33\uFF09\uFF1A"];
  for (const tableName of Array.from(AGENT_SQL_DETAIL_TABLES.values()).filter((name) => tableColumns.has(name))) {
    lines.push(`${quoteIdentifier(tableName)}:`);
    for (const row of detailedTableColumns.get(tableName) ?? []) {
      const flags = [
        row.isNullable === "NO" ? "NOT NULL" : "NULLABLE",
        formatColumnDefault(row.columnDefault)
      ];
      const foreignKey = foreignKeyMap.get(`${row.tableName}.${row.columnName}`);
      if (foreignKey) {
        flags.push(`FK -> ${quoteIdentifier(foreignKey.foreignTableName)}.${formatSummaryColumnName(foreignKey.foreignColumnName)}`);
      }
      if (row.columnName === "tags") {
        flags.push("JSON array persisted as string[] DTO");
      }
      lines.push(`- ${formatSummaryColumnName(row.columnName)}: ${formatSummaryDataType(row)}; ${flags.join("; ")}`);
    }
  }
  const compactTables = Array.from(tableColumns.entries()).filter(([tableName]) => !AGENT_SQL_DETAIL_TABLES.has(tableName));
  if (compactTables.length > 0) {
    lines.push("\u5176\u4ED6\u4E1A\u52A1\u8868\u7B80\u8868\uFF1A");
    compactTables.forEach(([tableName, columns], index) => {
      lines.push(`${String(index + 1)}. ${quoteIdentifier(tableName)}(${columns.join(", ")})`);
    });
  }
  return lines.join("\n");
}
async function getAgentSqlSchemaSummary(projectPath) {
  const resolvedProjectPath = requireProjectPath(projectPath);
  if (agentSqlSchemaSummaryCache && agentSqlSchemaSummaryCacheProjectPath === resolvedProjectPath && Date.now() - agentSqlSchemaSummaryCacheAt < AGENT_SQL_SCHEMA_CACHE_TTL_MS) {
    return agentSqlSchemaSummaryCache;
  }
  if (!agentSqlSchemaSummaryPromise) {
    agentSqlSchemaSummaryPromise = readSchemaSummary(resolvedProjectPath).then((summary) => {
      agentSqlSchemaSummaryCache = summary;
      agentSqlSchemaSummaryCacheProjectPath = resolvedProjectPath;
      agentSqlSchemaSummaryCacheAt = Date.now();
      agentSqlSchemaSummaryPromise = void 0;
      return agentSqlSchemaSummaryCache;
    }).catch((error) => {
      agentSqlSchemaSummaryPromise = void 0;
      throw error;
    });
  }
  return agentSqlSchemaSummaryPromise;
}
function clearAgentSqlSchemaSummaryCache() {
  agentSqlSchemaSummaryCache = "";
  agentSqlSchemaSummaryCacheProjectPath = "";
  agentSqlSchemaSummaryCacheAt = 0;
  agentSqlSchemaSummaryPromise = void 0;
}
function createSqlTool() {
  return {
    key: "execute_sql",
    name: "execute_sql",
    label: "Execute SQL",
    description: buildSqlToolDescription(),
    parameters: ExecuteSqlSchema,
    async execute() {
      throw new Error("execute_sql \u9700\u8981 v3 session context\uFF0C\u5E76\u4E14\u53EA\u80FD\u8BBF\u95EE\u5F53\u524D Project Workspace \u7684 .nbook/project.sqlite\u3002");
    },
    async executeWithContext(context, _toolCallId, params) {
      const input = params;
      const result = await executeSql(context, input.sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result
      };
    }
  };
}
function buildSqlToolDescription() {
  return [
    "Execute a single SQL statement against the current Project Workspace SQLite database.",
    "Target database is fixed to the current Project Workspace .nbook/project.sqlite.",
    "The tool has no sqlitePath/databasePath parameter and cannot access App SQLite.",
    "Allowed: SELECT / WITH / INSERT / UPDATE / DELETE.",
    "Prohibited: DDL, transaction control, session control, PRAGMA, ATTACH/DETACH, VACUUM, and multi-statement queries.",
    `Query rows are capped at ${String(AGENT_SQL_ROW_LIMIT)}.`,
    "Use read/write/edit/apply_patch for manuscript or document files; execute_sql is only for structured Project SQLite data.",
    'SQLite dialect: quote business table and camelCase column names with double quotes when unsure, e.g. SELECT id, title FROM "StoryThread" ORDER BY "createdAt" DESC.',
    "Schema discovery uses sqlite_schema and PRAGMA table_info / foreign_key_list internally; agents may not execute PRAGMA directly.",
    'Raw SQL does not apply Prisma @updatedAt client semantics; update "updatedAt" explicitly when needed.'
  ].join("\n");
}
async function readSchemaSummary(projectPath) {
  const client = await useSqliteClient(projectPath);
  const tablesResult = await client.execute(SQLITE_TABLE_QUERY);
  const tableNames = tablesResult.rows.map((row) => String(row.tableName));
  const rows = [];
  const foreignKeys = [];
  for (const tableName of tableNames) {
    const columns = await client.execute(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
    rows.push(...columns.rows.map((row) => ({
      tableName,
      columnName: String(row.name),
      ordinalPosition: Number(row.cid) + 1,
      isNullable: Number(row.notnull) === 1 || Number(row.pk) === 1 ? "NO" : "YES",
      columnDefault: row.dflt_value === null || row.dflt_value === void 0 ? null : String(row.dflt_value),
      dataType: String(row.type || "TEXT"),
      udtName: String(row.type || "TEXT")
    })));
    const fkRows = await client.execute(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`);
    foreignKeys.push(...fkRows.rows.map((row) => ({
      tableName,
      columnName: String(row.from),
      foreignTableName: String(row.table),
      foreignColumnName: String(row.to)
    })));
  }
  return buildAgentSqlSchemaSummary(rows, foreignKeys);
}
function normalizeSql(sql) {
  return sql.trim().replace(/;+$/g, "").trim();
}
function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
function formatSummaryColumnName(columnName) {
  return /[A-Z]/.test(columnName) ? quoteIdentifier(columnName) : columnName;
}
function formatSummaryDataType(row) {
  return row.dataType.toUpperCase() === "JSONB" ? "JSON" : row.dataType;
}
function formatColumnDefault(value) {
  if (!value) {
    return "\u65E0\u9ED8\u8BA4\u503C";
  }
  if (value.includes("CURRENT_TIMESTAMP")) {
    return "DEFAULT CURRENT_TIMESTAMP";
  }
  if (value.toUpperCase().includes("AUTOINCREMENT")) {
    return "DEFAULT \u81EA\u589E";
  }
  return `DEFAULT ${value}`;
}
function getSqlLeadingKeyword(sql) {
  return normalizeSql(sql).match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() ?? "";
}
function isReadSql(sql) {
  const leadingKeyword = getSqlLeadingKeyword(sql);
  return leadingKeyword === "select" || leadingKeyword === "with";
}
function detectSqlCommand(sql) {
  const leadingKeyword = getSqlLeadingKeyword(sql);
  if (leadingKeyword === "select" || leadingKeyword === "with") {
    return "SELECT";
  }
  if (leadingKeyword === "insert") {
    return "INSERT";
  }
  if (leadingKeyword === "update") {
    return "UPDATE";
  }
  if (leadingKeyword === "delete") {
    return "DELETE";
  }
  throw new Error("sql \u53EA\u5141\u8BB8 SELECT / WITH / INSERT / UPDATE / DELETE");
}
function validateExecuteSql(sql) {
  const normalized = normalizeSql(sql);
  const leadingKeyword = getSqlLeadingKeyword(normalized);
  const blockedPattern = /\b(alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|reset|show|call|pragma|attach|detach)\b/i;
  if (!normalized) {
    throw new Error("sql \u4E0D\u80FD\u4E3A\u7A7A");
  }
  if (hasSqlStatementSeparator(normalized)) {
    throw new Error("sql \u53EA\u5141\u8BB8\u5355\u6761\u8BED\u53E5");
  }
  if (!["select", "with", "insert", "update", "delete"].includes(leadingKeyword)) {
    throw new Error("sql \u53EA\u5141\u8BB8 SELECT / WITH / INSERT / UPDATE / DELETE");
  }
  if (blockedPattern.test(stripSqlLiterals(normalized))) {
    throw new Error("sql \u5305\u542B\u88AB\u7981\u6B62\u7684\u5173\u952E\u5B57");
  }
}
function hasSqlStatementSeparator(sql) {
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const nextChar = sql[index + 1] ?? "";
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      index++;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index++;
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && nextChar === "'") {
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
      if (char === '"' && nextChar === '"') {
        index += 2;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      index++;
      continue;
    }
    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      index++;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      index++;
      continue;
    }
    if (char === ";") {
      return true;
    }
    index++;
  }
  return false;
}
function stripSqlLiterals(sql) {
  let result = "";
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const nextChar = sql[index + 1] ?? "";
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        result += char;
      } else {
        result += " ";
      }
      index++;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        result += "  ";
        inBlockComment = false;
        index += 2;
        continue;
      }
      result += " ";
      index++;
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && nextChar === "'") {
        result += "  ";
        index += 2;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      result += " ";
      index++;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && nextChar === '"') {
        result += "  ";
        index += 2;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      result += " ";
      index++;
      continue;
    }
    if (char === "-" && nextChar === "-") {
      result += "  ";
      inLineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      result += "  ";
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      result += " ";
      index++;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      result += " ";
      index++;
      continue;
    }
    result += char;
    index++;
  }
  return result;
}
function buildAgentSqlErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const hintLines = [`SQL \u6267\u884C\u5931\u8D25\uFF1A${message}`];
  if (/no such (?:table|column)/i.test(message)) {
    hintLines.push("\u63D0\u793A\uFF1A\u5F53\u524D\u76EE\u6807\u662F Project SQLite\uFF1B\u5148\u786E\u8BA4\u5F53\u524D Project Workspace \u548C\u8868/\u5217\u540D\u3002\u4E1A\u52A1\u8868\u548C camelCase \u5B57\u6BB5\u5EFA\u8BAE\u4F7F\u7528\u53CC\u5F15\u53F7\u3002");
  }
  return hintLines.join("\n");
}
async function executeSql(context, sql) {
  const normalized = normalizeSql(sql);
  validateExecuteSql(normalized);
  return executeSqliteSql(requireProjectPath(context.projectPath), normalized);
}
async function executeSqliteSql(projectPath, normalized) {
  const client = await useSqliteClient(projectPath);
  const statement = isReadSql(normalized) ? `SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}` : normalized;
  try {
    const result = await client.execute(statement);
    const rows = result.rows.map((row) => ({ ...row }));
    return toExecuteSqlResult(normalized, rows, result.rowsAffected || rows.length);
  } catch (error) {
    throw new Error(buildAgentSqlErrorMessage(error));
  }
}
function toExecuteSqlResult(normalized, rows, rowCount) {
  return {
    mode: isReadSql(normalized) ? "read" : "write",
    command: detectSqlCommand(normalized),
    rowCount,
    rows,
    effects: {
      refreshChapterTree: false
    }
  };
}
async function useSqliteClient(projectPath) {
  await readProjectManifest(projectPath);
  await initProjectDatabase(projectPath);
  const url = toSqliteFileUrl(resolveProjectDatabasePath(projectPath));
  if (!sqliteClient || sqliteClientUrl !== url) {
    sqliteClient?.close();
    sqliteClient = createClient2({ url });
    sqliteClientUrl = url;
  }
  return sqliteClient;
}
function requireProjectPath(projectPath) {
  if (!projectPath || projectPath === "workspace" || projectPath === "workspace/.nbook") {
    throw new Error("execute_sql \u9700\u8981\u5F53\u524D session \u4F4D\u4E8E\u5177\u4F53 Project Workspace\uFF1B\u76EE\u6807\u56FA\u5B9A\u4E3A\u8BE5\u9879\u76EE\u7684 .nbook/project.sqlite\u3002");
  }
  return projectPath;
}
var ExecuteSqlSchema, AGENT_SQL_ROW_LIMIT, AGENT_SQL_SCHEMA_CACHE_TTL_MS, SQLITE_TABLE_QUERY, AGENT_SQL_DETAIL_TABLES, agentSqlSchemaSummaryCache, agentSqlSchemaSummaryCacheProjectPath, agentSqlSchemaSummaryCacheAt, agentSqlSchemaSummaryPromise, sqliteClient, sqliteClientUrl;
var init_sql_tool = __esm({
  "server/agent/tools/sql-tool.ts"() {
    "use strict";
    init_project_workspace();
    ExecuteSqlSchema = Type.Object({
      sql: Type.String({ description: "A single Project SQLite statement: SELECT / WITH / INSERT / UPDATE / DELETE. DDL, transaction control, PRAGMA, ATTACH/DETACH, and multi-statement queries are prohibited." })
    });
    AGENT_SQL_ROW_LIMIT = 200;
    AGENT_SQL_SCHEMA_CACHE_TTL_MS = 3e4;
    SQLITE_TABLE_QUERY = `
    SELECT name AS "tableName"
    FROM sqlite_schema
    WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
    ORDER BY name ASC
`;
    AGENT_SQL_DETAIL_TABLES = /* @__PURE__ */ new Set(["Story", "StoryPhase", "StoryThread", "StoryScene", "StoryPlot", "StorySceneRef", "ProjectMetadata"]);
    agentSqlSchemaSummaryCache = "";
    agentSqlSchemaSummaryCacheProjectPath = "";
    agentSqlSchemaSummaryCacheAt = 0;
    sqliteClient = null;
    sqliteClientUrl = "";
  }
});

// server/agent/profiles/profile-dsl.ts
import { resolve } from "node:path";

// server/agent/messages/message-utils.ts
var EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};
function now() {
  return Date.now();
}
function createUserMessage(input, timestamp = now()) {
  const textBlock = {
    type: "text",
    text: input.text
  };
  return {
    role: "user",
    content: input.images?.length ? [textBlock, ...input.images] : [textBlock],
    timestamp
  };
}
function createTextToolResult(input) {
  return {
    role: "toolResult",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    content: [{ type: "text", text: input.text }],
    details: input.details,
    isError: input.isError ?? false,
    timestamp: input.timestamp ?? now()
  };
}
function createAssistantTextMessage(input) {
  return {
    role: "assistant",
    content: [{ type: "text", text: input.text }],
    api: input.api ?? "neuro-book",
    provider: input.provider ?? "neuro-book",
    model: input.model ?? "neuro-agent",
    usage: input.usage ?? EMPTY_USAGE,
    stopReason: input.stopReason ?? "stop",
    timestamp: input.timestamp ?? now()
  };
}
function messageText(message) {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  }
  if (message.role === "assistant") {
    return message.content.map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "thinking") {
        return block.thinking;
      }
      return `[tool:${block.name}]`;
    }).join("\n");
  }
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

// server/agent/plan-mode-path.ts
import { join, normalize, relative } from "node:path";
function planModeDirectory(workspaceRoot) {
  return join(workspaceRoot, ".agent", "plan");
}

// server/agent/session/custom-state-keys.ts
var AGENT_TASKS_STATE_KEY = "agent.tasks";
var AGENT_PLAN_MODE_STATE_KEY = "agent.planMode";

// server/agent/profiles/profile-dsl.ts
var PROFILE_STATE_KEY_PREFIX = "profileState.";
async function compileProfileContext(profile, context, tree) {
  const currentRuntimeState = readProfileRuntimeState(context.session.customState[profileStateKey(profile.manifest.key)]);
  const state = {
    context,
    profileKey: profile.manifest.key,
    currentRuntimeState,
    nextRuntimeState: cloneProfileRuntimeState(currentRuntimeState),
    stateTouched: false,
    currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
    pendingToolCallIds: [],
    plan: {}
  };
  await renderRoot(state, tree);
  if (state.stateTouched) {
    state.plan.stateWrites = [{
      type: "custom",
      key: profileStateKey(profile.manifest.key),
      value: state.nextRuntimeState
    }];
  }
  validateProfileTurnPlan(profile.manifest.key, state.plan);
  return state.plan;
}
function validateProfileTurnPlan(profileKey, plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error(`profile ${profileKey} prepare/context \u5FC5\u987B\u8FD4\u56DE ProfileTurnPlan\u3002`);
  }
  const allowedKeys = /* @__PURE__ */ new Set(["systemPrompt", "historyInitMessages", "appendingMessages", "modelContextAppendingMessages", "modelContextMessages", "stateWrites", "compaction"]);
  const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
  if (illegalKey) {
    throw new Error(`profile ${profileKey} ProfileTurnPlan \u4E0D\u5141\u8BB8\u8FD4\u56DE ${illegalKey}\u3002`);
  }
  for (const write of plan.stateWrites ?? []) {
    if (write.type !== "custom") {
      throw new Error(`profile ${profileKey} stateWrites \u53EA\u5141\u8BB8\u5199 custom entry\u3002`);
    }
    if (write.key !== profileStateKey(profileKey)) {
      throw new Error(`profile ${profileKey} stateWrites \u53EA\u5141\u8BB8\u5199 ${profileStateKey(profileKey)}\u3002`);
    }
    validateProfileRuntimeStateWrite(profileKey, write.value);
  }
  validateCompactionPlan(profileKey, plan.compaction);
}
function profileStateKey(profileKey) {
  return `${PROFILE_STATE_KEY_PREFIX}${profileKey}`;
}
function ProfilePrompt(props) {
  return {
    kind: "ProfilePrompt",
    children: normalizeChildren(props.children)
  };
}
function System(props) {
  return {
    kind: "System",
    children: normalizeChildren(props.children)
  };
}
function HistorySet(props) {
  return {
    kind: "HistorySet",
    children: normalizeChildren(props.children)
  };
}
function ModelContext(props) {
  return {
    kind: "ModelContext",
    children: normalizeChildren(props.children)
  };
}
function AppendingSet(props) {
  return {
    kind: "AppendingSet",
    children: normalizeChildren(props.children)
  };
}
function Compaction(props) {
  return {
    kind: "Compaction",
    enabled: props.enabled,
    triggerPercent: props.triggerPercent,
    triggerTokens: props.triggerTokens,
    reserveTokens: props.reserveTokens,
    keepRecentTokens: props.keepRecentTokens,
    keepRecentPercent: props.keepRecentPercent,
    children: normalizeChildren(props.children)
  };
}
function CompactionPrompt(props) {
  return {
    kind: "CompactionPrompt",
    children: normalizeChildren(props.children)
  };
}
function CompactionSummaryPrefix(props) {
  return {
    kind: "CompactionSummaryPrefix",
    children: normalizeChildren(props.children)
  };
}
function Message(props) {
  if (props.role === "system") {
    throw new Error('<Message role="system"> \u4E0D\u88AB\u652F\u6301\uFF0C\u8BF7\u4F7F\u7528 <System> \u6216 <AppendingSet><Message>\u3002');
  }
  return {
    kind: "Message",
    role: props.role ?? "user",
    children: normalizeChildren(props.children)
  };
}
function AIMessage(props) {
  return {
    kind: "AIMessage",
    role: "assistant",
    children: normalizeChildren(props.children)
  };
}
function ToolCall(props) {
  return {
    kind: "ToolCall",
    id: props.id,
    name: props.name,
    args: props.args
  };
}
function ToolResult(props) {
  return {
    kind: "ToolResult",
    role: "toolResult",
    toolCallId: props.toolCallId,
    toolName: props.toolName,
    isError: props.isError,
    children: normalizeChildren(props.children)
  };
}
function Reminder(props) {
  return {
    kind: "Reminder",
    id: props.id,
    when: props.when ?? true,
    watchPath: props.watchPath,
    watchValue: props.watchValue,
    watch: props.watch,
    repeatEveryTurns: props.repeatEveryTurns,
    children: normalizeChildren(props.children)
  };
}
function Watch(props) {
  return {
    kind: "Watch",
    id: props.id,
    path: props.path,
    value: props.value,
    render: props.render,
    children: normalizeChildren(props.children)
  };
}
function If(props) {
  return {
    kind: "If",
    condition: props.condition ?? false,
    children: normalizeChildren(props.children)
  };
}
function SkillCatalog(props) {
  return {
    kind: "StringFragment",
    text: props.text ?? defaultSkillCatalogText
  };
}
function AgentCatalog(props) {
  return {
    kind: "StringFragment",
    text: props.text ?? defaultAgentCatalogText
  };
}
function ActivatedSkills(props) {
  return {
    kind: "StringFragment",
    text: props.text ?? defaultActivatedSkillsText
  };
}
function SqlSchemaSummary(props) {
  return {
    kind: "StringFragment",
    text: props.text ?? defaultSqlSchemaSummaryText
  };
}
function Variable(props) {
  return {
    kind: "Variable",
    path: props.path,
    label: props.label,
    maxBytes: props.maxBytes
  };
}
function VariableSchema(props) {
  return {
    kind: "VariableSchema",
    namespace: props.namespace,
    prefix: props.prefix,
    paths: props.paths,
    writableOnly: props.writableOnly,
    detail: props.detail,
    includeToolGuide: props.includeToolGuide
  };
}
function SystemReminder(props) {
  return {
    kind: "StringFragment",
    text: async (ctx) => {
      const body = await renderStandaloneString(ctx, normalizeChildren(props.children));
      return body.trim() ? systemReminder(body) : "";
    }
  };
}
function RuntimeContext(props = {}) {
  return {
    kind: "StringFragment",
    text: async (ctx) => {
      const planModeState = readRecord(ctx.session.customState[AGENT_PLAN_MODE_STATE_KEY]);
      const currentProjectWorkspace = await readCurrentProjectWorkspace(ctx);
      const lines = [
        "<dynamic-context>",
        `Agent cwd: ${ctx.session.workspaceRoot}`,
        currentProjectWorkspace ? `Current Project Workspace: ${currentProjectWorkspace}` : "",
        `Profile key: ${ctx.session.profileKey}`,
        readInputRole(ctx) ? `Input role: ${readInputRole(ctx)}` : "",
        ctx.session.planModeActive ? "Plan mode: active" : "Plan mode: inactive",
        typeof planModeState.workDirectory === "string" ? `Plan mode work directory: ${planModeState.workDirectory}` : "",
        linkedAgentsSummaryText(ctx.session),
        await renderStandaloneString(ctx, normalizeChildren(props.children)),
        "</dynamic-context>"
      ].filter(Boolean);
      return lines.join("\n");
    }
  };
}
function LinkedAgentsSummary(_props = {}) {
  return {
    kind: "StringFragment",
    text: (ctx) => linkedAgentsSummaryText(ctx.session)
  };
}
function LinkedAgentsReminder(props = {}) {
  return Reminder({
    id: props.id ?? "linked-agents",
    watch: (ctx) => ctx.session.linkedAgents,
    repeatEveryTurns: props.repeatEveryTurns,
    children: Message({ children: LinkedAgentsReminderText() })
  });
}
function TaskReminder(props = {}) {
  const stateKey = props.stateKey ?? AGENT_TASKS_STATE_KEY;
  return Reminder({
    id: props.id ?? "tasks",
    watch: (ctx) => ctx.session.customState[stateKey] ?? null,
    repeatEveryTurns: props.repeatEveryTurns ?? 8,
    children: Message({ children: TaskReminderText({ stateKey }) })
  });
}
function PlanModeReminder(props = {}) {
  const stateKey = props.stateKey ?? AGENT_PLAN_MODE_STATE_KEY;
  return Reminder({
    id: props.id ?? "plan-mode",
    watch: (ctx) => ({
      active: ctx.session.planModeActive,
      state: ctx.session.customState[stateKey] ?? null
    }),
    repeatEveryTurns: props.repeatEveryTurns,
    children: Message({ children: PlanModeReminderText({ stateKey, slots: readPlanModeSlots(normalizeChildren(props.children)) }) })
  });
}
function ActivePlanModeReminder(props = {}) {
  const stateKey = props.stateKey ?? AGENT_PLAN_MODE_STATE_KEY;
  return Reminder({
    id: props.id ?? "plan-mode-active",
    watch: (ctx) => readRecord(ctx.session.customState[stateKey]).active,
    children: Message({ children: PlanModeReminderText({ stateKey }) })
  });
}
function MentionedSkillsReminder(_props = {}) {
  return {
    kind: "StringFragment",
    text: mentionedSkillsReminderText
  };
}
function PlanModeFull(props) {
  return PlanModeSlot("full", props.children);
}
function PlanModeSparse(props) {
  return PlanModeSlot("sparse", props.children);
}
function PlanModeExit(props) {
  return PlanModeSlot("exit", props.children);
}
function PlanModeReentry(props) {
  return PlanModeSlot("reentry_full", props.children);
}
function PlanModeSlot(slot, children) {
  return {
    kind: "PlanModeSlot",
    slot,
    children: normalizeChildren(children)
  };
}
function readPlanModeSlots(children) {
  const slots = {};
  const flat = children.flatMap(flattenChildren);
  for (const child of flat) {
    if (child === null || child === void 0 || child === false || child === true) {
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      if (String(child).trim() !== "") {
        throw new Error("PlanModeReminder \u53EA\u80FD\u76F4\u63A5\u5305\u542B PlanModeFull/PlanModeSparse/PlanModeExit/PlanModeReentry\u3002");
      }
      continue;
    }
    if (Array.isArray(child)) {
      continue;
    }
    if (child.kind !== "PlanModeSlot") {
      throw new Error(`PlanModeReminder \u53EA\u80FD\u76F4\u63A5\u5305\u542B PlanModeFull/PlanModeSparse/PlanModeExit/PlanModeReentry\uFF0C\u4E0D\u80FD\u5305\u542B ${child.kind}\u3002`);
    }
    if (slots[child.slot]) {
      throw new Error(`${slotNodeName(child.slot)} \u53EA\u80FD\u51FA\u73B0\u4E00\u6B21\u3002`);
    }
    slots[child.slot] = child.children;
  }
  return slots;
}
function slotNodeName(slot) {
  if (slot === "full") {
    return "PlanModeFull";
  }
  if (slot === "sparse") {
    return "PlanModeSparse";
  }
  if (slot === "exit") {
    return "PlanModeExit";
  }
  return "PlanModeReentry";
}
async function renderRoot(state, tree) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.kind !== "ProfilePrompt") {
    throw new Error("context(ctx) \u5FC5\u987B\u8FD4\u56DE <ProfilePrompt> \u6839\u8282\u70B9\u3002");
  }
  await renderChildren(state, "root", tree.children);
}
async function renderChildren(state, zone, children) {
  const messages = [];
  for (const child of children) {
    messages.push(...await renderChild(state, zone, child));
  }
  return messages;
}
async function renderChild(state, zone, child) {
  if (child === null || child === void 0 || child === false || child === true) {
    return [];
  }
  if (Array.isArray(child)) {
    return renderChildren(state, zone, child);
  }
  if (typeof child === "string" || typeof child === "number") {
    if (String(child).trim() !== "") {
      throw new Error(`${zone} \u4E2D\u7684\u6587\u672C\u5FC5\u987B\u653E\u5728\u652F\u6301 string \u7684\u8282\u70B9\u5185\u90E8\u3002`);
    }
    return [];
  }
  if (child.kind === "Fragment") {
    return renderChildren(state, zone, child.children);
  }
  if (child.kind === "If") {
    if (!child.condition) {
      return [];
    }
    return renderChildren(state, zone, child.children);
  }
  if (child.kind === "System") {
    assertZone(zone, "root", "System \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    validateSystemChildren(child.children);
    const text = await renderStringChildren(state, "system", child.children);
    state.plan.systemPrompt = [state.plan.systemPrompt, text].filter(Boolean).join("\n\n");
    return [];
  }
  if (child.kind === "HistorySet") {
    assertZone(zone, "root", "HistorySet \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    const messages = await renderChildren(state, "history", child.children);
    state.plan.historyInitMessages = [...state.plan.historyInitMessages ?? [], ...onlyMessages(messages, "HistorySet")];
    return [];
  }
  if (child.kind === "ModelContext") {
    assertZone(zone, "root", "ModelContext \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    const messages = await renderChildren(state, "model", child.children);
    if (messages.length > 0) {
      state.plan.modelContextMessages = [...state.plan.modelContextMessages ?? [], ...messages];
    }
    return [];
  }
  if (child.kind === "AppendingSet") {
    assertZone(zone, "root", "AppendingSet \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    const messages = await renderChildren(state, "appending", child.children);
    state.plan.appendingMessages = [...state.plan.appendingMessages ?? [], ...onlyMessages(messages, "AppendingSet")];
    return [];
  }
  if (child.kind === "Compaction") {
    assertZone(zone, "root", "Compaction \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    state.plan.compaction = await renderCompactionNode(state, child);
    return [];
  }
  if (child.kind === "CompactionPrompt" || child.kind === "CompactionSummaryPrefix") {
    assertZone(zone, "compaction", `${child.kind} \u53EA\u80FD\u653E\u5728 Compaction \u5185\u3002`);
    return [];
  }
  if (child.kind === "Reminder") {
    if (zone !== "appending" && zone !== "model") {
      throw new Error("Reminder \u53EA\u5141\u8BB8\u653E\u5728 AppendingSet \u6216 ModelContext \u5185\u3002");
    }
    const messages = await renderReminder(state, child);
    if (zone === "model") {
      state.plan.modelContextAppendingMessages = [
        ...state.plan.modelContextAppendingMessages ?? [],
        ...onlyMessages(messages, "ModelContext Reminder")
      ];
      return [];
    }
    return messages;
  }
  if (child.kind === "Watch") {
    if (zone !== "appending" && zone !== "model") {
      throw new Error("Watch \u53EA\u5141\u8BB8\u653E\u5728 AppendingSet \u6216 ModelContext \u5185\u3002");
    }
    return renderWatch(state, zone, child);
  }
  if (child.kind === "Variable") {
    assertZone(zone, "model", "Variable \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8\u653E\u5728 ModelContext \u5185\u3002");
    const text = await renderVariableNode(state, child);
    return text.trim() ? [createUserMessage({ text })] : [];
  }
  if (child.kind === "VariableSchema") {
    assertZone(zone, "model", "VariableSchema \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8\u653E\u5728 ModelContext \u5185\u3002");
    const text = renderVariableSchemaNode(state, child);
    return text.trim() ? [createUserMessage({ text })] : [];
  }
  if (child.kind === "Message" || child.kind === "AIMessage" || child.kind === "ToolResult") {
    if (!["history", "model", "appending", "reminder", "watch"].includes(zone)) {
      throw new Error(`${child.kind} \u4E0D\u80FD\u76F4\u63A5\u653E\u5728 ${zone} \u5185\u3002`);
    }
    return onlyNonEmptyMessage(await renderMessageNode(state, child));
  }
  if (child.kind === "ToolCall") {
    throw new Error("ToolCall \u53EA\u80FD\u4F5C\u4E3A AIMessage \u7684\u5B50\u8282\u70B9\u3002");
  }
  if (child.kind === "StringFragment") {
    if (zone !== "message" && zone !== "system" && zone !== "assistant" && zone !== "reminder" && zone !== "watch" && zone !== "compaction") {
      throw new Error("string fragment \u53EA\u80FD\u653E\u5728\u652F\u6301 string \u7684\u8282\u70B9\u5185\u90E8\u3002");
    }
    return [];
  }
  if (child.kind === "PlanModeSlot") {
    throw new Error(`${slotNodeName(child.slot)} \u53EA\u80FD\u4F5C\u4E3A PlanModeReminder \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
  }
  throw new Error(`\u672A\u77E5 Profile DSL \u8282\u70B9\uFF1A${JSON.stringify(child)}`);
}
async function renderCompactionNode(state, node) {
  const plan = {
    enabled: node.enabled,
    triggerPercent: node.triggerPercent,
    triggerTokens: node.triggerTokens,
    reserveTokens: node.reserveTokens,
    keepRecentTokens: node.keepRecentTokens,
    keepRecentPercent: node.keepRecentPercent
  };
  for (const child of node.children.flatMap(flattenChildren)) {
    if (child === null || child === void 0 || child === false || child === true) {
      continue;
    }
    if (Array.isArray(child)) {
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      if (String(child).trim() !== "") {
        throw new Error("Compaction \u4E2D\u7684\u6587\u672C\u5FC5\u987B\u653E\u5728 CompactionPrompt \u6216 CompactionSummaryPrefix \u5185\u3002");
      }
      continue;
    }
    if (child.kind === "Fragment") {
      const nested = await renderCompactionNode(state, {
        kind: "Compaction",
        children: child.children
      });
      plan.prompt = nested.prompt ?? plan.prompt;
      plan.summaryPrefix = nested.summaryPrefix ?? plan.summaryPrefix;
      continue;
    }
    if (child.kind === "If") {
      if (!child.condition) {
        continue;
      }
      const nested = await renderCompactionNode(state, {
        kind: "Compaction",
        children: child.children
      });
      plan.prompt = nested.prompt ?? plan.prompt;
      plan.summaryPrefix = nested.summaryPrefix ?? plan.summaryPrefix;
      continue;
    }
    if (child.kind === "CompactionPrompt") {
      plan.prompt = await renderStringChildren(state, "compaction", child.children);
      continue;
    }
    if (child.kind === "CompactionSummaryPrefix") {
      plan.summaryPrefix = await renderStringChildren(state, "compaction", child.children);
      continue;
    }
    throw new Error(`Compaction \u53EA\u80FD\u5305\u542B CompactionPrompt / CompactionSummaryPrefix\uFF0C\u4E0D\u80FD\u5305\u542B ${child.kind}\u3002`);
  }
  validateCompactionPlan(state.profileKey, plan);
  return plan;
}
function validateSystemChildren(children) {
  for (const child of children.flatMap(flattenChildren)) {
    if (Array.isArray(child)) {
      validateSystemChildren(child);
      continue;
    }
    if (!child || typeof child !== "object") {
      continue;
    }
    if (child.kind === "StringFragment" || child.kind === "Fragment" || child.kind === "If") {
      if (child.kind === "Fragment" || child.kind === "If") {
        validateSystemChildren(child.children);
      }
      continue;
    }
    if (child.kind === "Variable" || child.kind === "VariableSchema") {
      throw new Error(`${child.kind} \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8\u653E\u5728 ModelContext\u3002`);
    }
    throw new Error(`System \u53EA\u80FD\u5305\u542B string-like children\uFF0C\u4E0D\u80FD\u5305\u542B ${child.kind}\u3002`);
  }
}
async function renderMessageNode(state, node) {
  if (node.kind === "Message") {
    if (node.role === "system") {
      throw new Error('<Message role="system"> \u4E0D\u88AB\u652F\u6301\uFF0C\u8BF7\u4F7F\u7528 <System> \u6216 <AppendingSet><Message>\u3002');
    }
    return createUserMessage({
      text: await renderStringChildren(state, "message", node.children)
    });
  }
  if (node.kind === "AIMessage") {
    validateAssistantChildren(node.children);
    const contentText = await renderStringChildren(state, "assistant", node.children);
    const toolCalls = collectToolCalls(node.children).map((toolCall) => ({
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.args ?? {}
    }));
    const assistant = createAssistantTextMessage({
      text: contentText,
      stopReason: toolCalls.length > 0 ? "toolUse" : "stop"
    });
    state.pendingToolCallIds.push(...toolCalls.map((toolCall) => toolCall.id));
    return {
      ...assistant,
      content: [
        ...contentText ? [{ type: "text", text: contentText }] : [],
        ...toolCalls
      ]
    };
  }
  if (!node.toolCallId || !node.toolName) {
    throw new Error("ToolResult \u5FC5\u987B\u63D0\u4F9B toolCallId \u548C toolName\u3002");
  }
  if (!state.pendingToolCallIds.includes(node.toolCallId)) {
    throw new Error(`ToolResult.toolCallId \u672A\u5339\u914D\u524D\u5E8F ToolCall\uFF1A${node.toolCallId}`);
  }
  state.pendingToolCallIds = state.pendingToolCallIds.filter((toolCallId) => toolCallId !== node.toolCallId);
  return createTextToolResult({
    toolCallId: node.toolCallId,
    toolName: node.toolName,
    text: await renderStringChildren(state, "message", node.children),
    isError: node.isError
  });
}
function validateAssistantChildren(children) {
  validateAssistantChildSequence(children, false);
}
function collectToolCalls(children) {
  const toolCalls = [];
  const visit = (child) => {
    if (child === null || child === void 0 || child === false || child === true) {
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        visit(item);
      }
      return;
    }
    if (typeof child === "string" || typeof child === "number" || child.kind === "StringFragment") {
      return;
    }
    if (child.kind === "ToolCall") {
      toolCalls.push(child);
      return;
    }
    if (child.kind === "Fragment") {
      for (const item of child.children) {
        visit(item);
      }
      return;
    }
    if (child.kind === "PlanModeSlot") {
      for (const item of child.children) {
        visit(item);
      }
      return;
    }
    if (child.kind === "If" && child.condition) {
      for (const item of child.children) {
        visit(item);
      }
    }
  };
  for (const child of children) {
    visit(child);
  }
  return toolCalls;
}
function validateAssistantChildSequence(children, seenToolCall) {
  let localSeenToolCall = seenToolCall;
  for (const child of children) {
    if (child === null || child === void 0 || child === false || child === true) {
      continue;
    }
    if (Array.isArray(child)) {
      localSeenToolCall = validateAssistantChildSequence(child, localSeenToolCall);
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      if (localSeenToolCall && String(child).trim() !== "") {
        throw new Error("AIMessage \u7684 ToolCall \u540E\u4E0D\u80FD\u518D\u8FFD\u52A0\u975E ToolCall \u5B50\u8282\u70B9\u3002");
      }
      continue;
    }
    if (child.kind === "ToolCall") {
      localSeenToolCall = true;
      continue;
    }
    if (child.kind === "StringFragment") {
      if (localSeenToolCall) {
        throw new Error("AIMessage \u7684 ToolCall \u540E\u4E0D\u80FD\u518D\u8FFD\u52A0\u975E ToolCall \u5B50\u8282\u70B9\u3002");
      }
      continue;
    }
    if (child.kind === "Fragment") {
      localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
      continue;
    }
    if (child.kind === "PlanModeSlot") {
      localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
      continue;
    }
    if (child.kind === "If") {
      if (child.condition) {
        localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
      }
      continue;
    }
    if (localSeenToolCall) {
      throw new Error("AIMessage \u7684 ToolCall \u540E\u4E0D\u80FD\u518D\u8FFD\u52A0\u975E ToolCall \u5B50\u8282\u70B9\u3002");
    }
  }
  return localSeenToolCall;
}
async function renderReminder(state, node) {
  if (!node.when) {
    return [];
  }
  const watchSourceCount = [node.watchPath, node.watchValue, node.watch].filter((source) => source !== void 0).length;
  if (watchSourceCount > 1) {
    throw new Error("Reminder.watchPath\u3001Reminder.watchValue \u4E0E Reminder.watch \u53EA\u80FD\u63D0\u4F9B\u4E00\u4E2A\u3002");
  }
  if (node.repeatEveryTurns !== void 0 && (!Number.isInteger(node.repeatEveryTurns) || node.repeatEveryTurns <= 0)) {
    throw new Error("Reminder.repeatEveryTurns \u5FC5\u987B\u662F\u6B63\u6574\u6570\u3002");
  }
  assertAllowedWatchPath(node.watchPath, "Reminder.watchPath");
  const currentValue = node.watch ? await node.watch(state.context) : node.watchPath ? await readPath(state.context, node.watchPath) : node.watchValue;
  const hasWatchValue = node.watchPath !== void 0 || node.watchValue !== void 0 || node.watch !== void 0;
  const fingerprint = hasWatchValue ? stableStringifyJsonValue(currentValue) : void 0;
  const previous = state.currentRuntimeState.reminders?.[node.id];
  const didFingerprintChange = hasWatchValue && previous?.fingerprint !== fingerprint;
  const shouldRepeat = typeof node.repeatEveryTurns === "number" && (!previous || state.currentTurn - previous.injectedAtTurn >= node.repeatEveryTurns);
  const shouldInject = hasWatchValue || node.repeatEveryTurns ? didFingerprintChange || shouldRepeat : true;
  if (!shouldInject) {
    return [];
  }
  const messages = await renderChildren(state, "reminder", node.children);
  if (messages.length === 0) {
    return [];
  }
  if (hasWatchValue || node.repeatEveryTurns) {
    state.nextRuntimeState.reminders = {
      ...state.nextRuntimeState.reminders,
      [node.id]: {
        ...fingerprint !== void 0 ? { fingerprint } : {},
        injectedAtTurn: state.currentTurn
      }
    };
    state.stateTouched = true;
  }
  return messages;
}
async function renderWatch(state, zone, node) {
  if (node.path !== void 0 && node.value !== void 0) {
    throw new Error("Watch.path \u4E0E Watch.value \u4E0D\u80FD\u540C\u65F6\u63D0\u4F9B\u3002");
  }
  assertAllowedWatchPath(node.path, "Watch.path");
  if (node.value !== void 0 && !node.id) {
    throw new Error("Watch.value \u6A21\u5F0F\u5FC5\u987B\u63D0\u4F9B id\u3002");
  }
  const key = node.id ?? node.path;
  if (!key) {
    throw new Error("Watch \u5FC5\u987B\u63D0\u4F9B path \u6216 id\u3002");
  }
  const currentValue = node.path ? await readPath(state.context, node.path) : node.value;
  const currentBaseline = {
    hasValue: currentValue !== void 0,
    value: currentValue === void 0 ? null : currentValue,
    fingerprint: stableStringifyJsonValue(currentValue)
  };
  const previous = state.nextRuntimeState.watches?.[key] ?? state.currentRuntimeState.watches?.[key];
  state.nextRuntimeState.watches = {
    ...state.nextRuntimeState.watches,
    [key]: currentBaseline
  };
  state.stateTouched = true;
  if (!previous && currentValue === void 0) {
    return [];
  }
  if (previous?.fingerprint === currentBaseline.fingerprint) {
    return [];
  }
  const change = {
    previousValue: previous?.hasValue ? previous.value : void 0,
    currentValue,
    path: key,
    hasPreviousValue: Boolean(previous?.hasValue),
    hasCurrentValue: currentValue !== void 0,
    session: state.context.session
  };
  const rendered = node.render ? await node.render(change) : node.children;
  if (!rendered || rendered === true) {
    return [];
  }
  return renderChildren(state, zone === "model" ? "watch" : "watch", normalizeChildren(rendered));
}
async function renderVariableNode(state, node) {
  const result = await state.context.vars.read(node.path, {
    maxBytes: node.maxBytes
  });
  if (result.issue) {
    return [
      "<variable>",
      `path: ${node.path}`,
      `issue: ${result.issue.message}`,
      "</variable>"
    ].join("\n");
  }
  return [
    "<variable>",
    `path: ${node.path}`,
    node.label ? `label: ${node.label}` : "",
    result.truncated ? "truncated: true" : "",
    "value:",
    JSON.stringify(result.value ?? null, null, 2),
    "</variable>"
  ].filter(Boolean).join("\n");
}
function renderVariableSchemaNode(state, node) {
  const result = state.context.vars.catalog({
    namespace: node.namespace,
    prefix: node.prefix,
    paths: node.paths,
    writableOnly: node.writableOnly,
    detail: node.detail
  });
  const payload = { catalog: result.catalog, schemas: result.schemas, issues: result.issues };
  return [
    "<variable-schema>",
    JSON.stringify(payload, null, 2),
    node.includeToolGuide === false ? "" : [
      "Tool workflow:",
      "- variable_schema: inspect focused variable schemas. Use namespace/prefix/paths; do not request everything.",
      "- variable_read: read a registered variable value before editing.",
      "- variable_patch: update one writable registered variable path with RFC 6902 JSON Patch, then read again to verify important changes."
    ].join("\n"),
    "</variable-schema>"
  ].filter(Boolean).join("\n");
}
async function renderStringChildren(state, zone, children) {
  const parts = [];
  const visit = async (child) => {
    if (child === null || child === void 0 || child === false || child === true) {
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        await visit(item);
      }
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
      return;
    }
    if (child.kind === "Fragment") {
      for (const item of child.children) {
        await visit(item);
      }
      return;
    }
    if (child.kind === "If") {
      if (!child.condition) {
        return;
      }
      for (const item of child.children) {
        await visit(item);
      }
      return;
    }
    if (child.kind === "StringFragment") {
      parts.push(typeof child.text === "function" ? await child.text(state.context) : child.text);
      return;
    }
    if (child.kind === "Variable" || child.kind === "VariableSchema") {
      throw new Error(`${child.kind} \u7B2C\u4E00\u7248\u53EA\u80FD\u4F5C\u4E3A ModelContext \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
    }
    if (child.kind === "PlanModeSlot") {
      throw new Error(`${slotNodeName(child.slot)} \u53EA\u80FD\u4F5C\u4E3A PlanModeReminder \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
    }
    if (child.kind === "ToolCall" && zone === "assistant") {
      return;
    }
    throw new Error(`${child.kind} \u4E0D\u80FD\u653E\u5728 string \u5185\u5BB9\u8282\u70B9\u5185\u3002`);
  };
  for (const child of children) {
    await visit(child);
  }
  return parts.join("").trim();
}
async function renderStandaloneString(context, children) {
  const state = {
    context,
    profileKey: context.session.profileKey,
    currentRuntimeState: {},
    nextRuntimeState: {},
    stateTouched: false,
    currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
    pendingToolCallIds: [],
    plan: {}
  };
  return renderStringChildren(state, "message", children);
}
function normalizeChildren(children) {
  if (children === void 0) {
    return [];
  }
  return Array.isArray(children) ? children : [children];
}
function flattenChildren(child) {
  if (child === null || child === void 0 || child === false || child === true) {
    return [];
  }
  if (Array.isArray(child)) {
    return child.flatMap(flattenChildren);
  }
  return [child];
}
function onlyMessages(messages, label) {
  return messages.filter((message) => {
    if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
      return true;
    }
    throw new Error(`${label} \u53EA\u80FD\u4EA7\u51FA user/assistant/toolResult message\u3002`);
  });
}
function onlyNonEmptyMessage(message) {
  if (message.role === "toolResult") {
    return [message];
  }
  if (message.role === "assistant") {
    const hasContent = message.content.some((block) => {
      return block.type !== "text" || block.text.trim().length > 0;
    });
    return hasContent ? [message] : [];
  }
  return messageText(message).trim() ? [message] : [];
}
function assertZone(current, expected, message) {
  if (current !== expected) {
    throw new Error(message);
  }
}
function countUserTurns(messages) {
  return messages.filter((message) => {
    return message.role === "user";
  }).length;
}
function assertAllowedWatchPath(path2, label) {
  if (!path2) {
    return;
  }
  if (!["client", "global", "project", "session"].some((prefix) => path2 === prefix || path2.startsWith(`${prefix}.`))) {
    throw new Error(`${label} \u5B57\u7B26\u4E32\u5F62\u5F0F\u53EA\u80FD\u4ECE client\u3001global\u3001project\u3001session \u53D8\u91CF\u8DEF\u5F84\u5F00\u59CB\uFF1B\u975E\u53D8\u91CF\u4E0A\u4E0B\u6587\u8BF7\u4F7F\u7528\u51FD\u6570 watch\uFF1A${path2}`);
  }
}
async function readPath(context, path2) {
  return context.vars.get(path2);
}
function stableStringifyJsonValue(value) {
  if (value === void 0) {
    return "__undefined__";
  }
  return JSON.stringify(sortJson(value));
}
function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}
function cloneProfileRuntimeState(state) {
  return {
    reminders: state.reminders ? { ...state.reminders } : void 0,
    watches: state.watches ? { ...state.watches } : void 0
  };
}
function readProfileRuntimeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const state = value;
  return {
    reminders: readReminderStateMap(state.reminders),
    watches: readWatchStateMap(state.watches)
  };
}
function validateProfileRuntimeStateWrite(profileKey, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`profile ${profileKey} stateWrites \u7684 profile runtime state \u5FC5\u987B\u662F object\u3002`);
  }
  const state = value;
  const illegalKey = Object.keys(state).find((key) => key !== "reminders" && key !== "watches");
  if (illegalKey) {
    throw new Error(`profile ${profileKey} stateWrites \u7684 profile runtime state \u4E0D\u5141\u8BB8\u5199 ${illegalKey}\u3002`);
  }
  assertOptionalStateMap(profileKey, state.reminders, "reminders");
  assertOptionalStateMap(profileKey, state.watches, "watches");
  readReminderStateMap(state.reminders);
  readWatchStateMap(state.watches);
}
function validateCompactionPlan(profileKey, plan) {
  if (!plan) {
    return;
  }
  const allowedKeys = /* @__PURE__ */ new Set(["enabled", "triggerPercent", "triggerTokens", "reserveTokens", "keepRecentTokens", "keepRecentPercent", "prompt", "summaryPrefix"]);
  const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
  if (illegalKey) {
    throw new Error(`profile ${profileKey} compaction \u4E0D\u5141\u8BB8\u8FD4\u56DE ${illegalKey}\u3002`);
  }
  if (typeof plan.enabled !== "undefined" && typeof plan.enabled !== "boolean") {
    throw new Error(`profile ${profileKey} compaction.enabled \u5FC5\u987B\u662F boolean\u3002`);
  }
  if (plan.triggerPercent !== void 0 && plan.triggerTokens !== void 0) {
    throw new Error(`profile ${profileKey} compaction.triggerPercent \u4E0E triggerTokens \u4E0D\u80FD\u540C\u65F6\u63D0\u4F9B\u3002`);
  }
  if (plan.keepRecentPercent !== void 0 && plan.keepRecentTokens !== void 0) {
    throw new Error(`profile ${profileKey} compaction.keepRecentPercent \u4E0E keepRecentTokens \u4E0D\u80FD\u540C\u65F6\u63D0\u4F9B\u3002`);
  }
  assertOptionalPercent(profileKey, plan.triggerPercent, "triggerPercent");
  assertOptionalPercent(profileKey, plan.keepRecentPercent, "keepRecentPercent");
  assertOptionalPositiveInteger(profileKey, plan.triggerTokens, "triggerTokens");
  assertOptionalPositiveInteger(profileKey, plan.reserveTokens, "reserveTokens");
  assertOptionalPositiveInteger(profileKey, plan.keepRecentTokens, "keepRecentTokens");
  assertOptionalString(profileKey, plan.prompt, "prompt");
  assertOptionalString(profileKey, plan.summaryPrefix, "summaryPrefix");
}
function assertOptionalPercent(profileKey, value, name) {
  if (value === void 0) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`profile ${profileKey} compaction.${name} \u5FC5\u987B\u5728 (0, 1] \u8303\u56F4\u5185\u3002`);
  }
}
function assertOptionalPositiveInteger(profileKey, value, name) {
  if (value === void 0) {
    return;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`profile ${profileKey} compaction.${name} \u5FC5\u987B\u662F\u6B63\u6574\u6570\u3002`);
  }
}
function assertOptionalString(profileKey, value, name) {
  if (value === void 0) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`profile ${profileKey} compaction.${name} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\u3002`);
  }
}
function assertOptionalStateMap(profileKey, value, key) {
  if (value === void 0) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`profile ${profileKey} stateWrites \u7684 ${key} \u5FC5\u987B\u662F object map\u3002`);
  }
}
function readReminderStateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const reminders = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.injectedAtTurn !== "number") {
      throw new Error(`profile runtime reminder state \u975E\u6CD5\uFF1A${key}`);
    }
    reminders[key] = {
      fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : void 0,
      injectedAtTurn: item.injectedAtTurn
    };
  }
  return reminders;
}
function readWatchStateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const watches = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.hasValue !== "boolean" || typeof item.fingerprint !== "string") {
      throw new Error(`profile runtime watch state \u975E\u6CD5\uFF1A${key}`);
    }
    watches[key] = {
      hasValue: item.hasValue,
      value: item.value ?? null,
      fingerprint: item.fingerprint
    };
  }
  return watches;
}
function renderAgentCatalogIndexItem(profile) {
  const lines = [
    `- key: ${profile.key}`,
    `  name: ${profile.name}`,
    profile.description ? `  description: ${profile.description}` : "",
    profile.source ? `  source: ${profile.source}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}
function systemReminder(body) {
  return [
    "<system-reminder>",
    body.trim(),
    "</system-reminder>"
  ].join("\n");
}
function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function readInputRole(ctx) {
  const input = readRecord(ctx.input);
  return typeof input.role === "string" ? input.role : "";
}
async function readCurrentProjectWorkspace(ctx) {
  const value = await ctx.vars.get("client.currentProjectWorkspace");
  return typeof value === "string" ? value : "";
}
function linkedAgentsSummaryText(session) {
  if (session.linkedAgents.length === 0) {
    return "Linked agents: none";
  }
  return [
    "Linked agents:",
    ...session.linkedAgents.map((agent) => `- session ${agent.sessionId}: ${agent.profileKey}${agent.detached ? " (detached)" : ""}`)
  ].join("\n");
}
function readTaskList(ctx, stateKey = AGENT_TASKS_STATE_KEY) {
  const value = ctx.session.customState[stateKey];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value;
  if (!Array.isArray(record.steps)) {
    return null;
  }
  return {
    title: typeof record.title === "string" ? record.title : void 0,
    steps: record.steps.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const step = item;
      if (typeof step.id !== "string" || typeof step.text !== "string" || typeof step.status !== "string") {
        return [];
      }
      return [{
        id: step.id,
        text: step.text,
        status: step.status,
        note: typeof step.note === "string" ? step.note : void 0
      }];
    })
  };
}
function LinkedAgentsReminderText() {
  return {
    kind: "StringFragment",
    text: (ctx) => systemReminder([
      "Current linked agents:",
      linkedAgentsSummaryText(ctx.session)
    ].join("\n"))
  };
}
function TaskReminderText(props) {
  return {
    kind: "StringFragment",
    text: (ctx) => {
      const taskList = readTaskList(ctx, props.stateKey);
      if (!taskList) {
        return "";
      }
      const openSteps = taskList.steps.filter((step) => step.status !== "completed");
      if (openSteps.length === 0) {
        return "";
      }
      return systemReminder([
        taskList.title ? `Current task list: ${taskList.title}` : "Current task list:",
        ...openSteps.map((step) => `- [${step.status}] ${step.id}: ${step.text}${step.note ? ` (${step.note})` : ""}`),
        "Use task_set_status when you start or complete a step."
      ].join("\n"));
    }
  };
}
function PlanModeReminderText(props) {
  return {
    kind: "StringFragment",
    text: async (ctx) => {
      const planModeState = readRecord(ctx.session.customState[props.stateKey]);
      const active = typeof planModeState.active === "boolean" ? planModeState.active : ctx.session.planModeActive;
      const kind = typeof planModeState.reminderKind === "string" ? planModeState.reminderKind : active ? "full" : "";
      const workDirectory = typeof planModeState.workDirectory === "string" ? planModeState.workDirectory : planModeDirectory(ctx.session.workspaceRoot).replace(/\\/g, "/");
      return renderPlanModeReminderText(ctx, kind, workDirectory, props.slots ?? {});
    }
  };
}
async function renderPlanModeReminderText(ctx, kind, workDirectory, slots) {
  if (!kind) {
    return "";
  }
  if (kind === "full" || kind === "sparse" || kind === "exit" || kind === "reentry_full") {
    const custom = slots[kind];
    if (custom) {
      return renderPlanModeSlotText(ctx, custom, workDirectory);
    }
  }
  if (kind === "exit") {
    return systemReminder([
      "## Exited Plan Mode",
      "",
      "You have exited plan mode. You can now make edits, run tools, and take actions.",
      `Use the approved plan from the exit approval. If a Markdown file was shown from ${workDirectory}, treat that Project Workspace plan file as the implementation reference and read or cite only that file for details.`
    ].join("\n"));
  }
  if (kind === "sparse") {
    return systemReminder([
      "Plan mode still active (see full instructions earlier in conversation).",
      "This project uses soft Plan Mode: follow the restriction yourself even though tools are still visible.",
      `Read-only except optional Markdown work files under ${workDirectory}. Do not modify other files, configs, plot data, database data, or commits.`,
      "Do not create or invoke Explore agents.",
      "Keep the user informed in chat: summarize important findings, unresolved decisions, and the current plan.",
      `For implementation planning, keep the plan in chat and, when the work is non-trivial, capture the reviewable plan, walkthrough, or research notes in a Markdown file under ${workDirectory}. It is the Project Workspace shared plan directory, not a session-specific directory.`,
      "Do not put scratch/cache/command-output drafts under Project Workspace .agent; use the system temp directory for temporary files.",
      "If an unresolved decision materially changes the plan, use request_user_input before exiting.",
      "Before exit_plan_mode, tell the user what was planned and cite the .agent/plan Markdown file path when one exists. Never ask for plan approval via plain text or request_user_input; exit_plan_mode is the approval request."
    ].join("\n"));
  }
  const reentry = kind === "reentry_full" ? [
    "## Re-entering Plan Mode",
    "",
    `You are returning to plan mode after previously exiting it. Only Markdown files under ${workDirectory} are writable while Plan Mode is active.`,
    "Before proceeding, inspect the latest chat context and any relevant Markdown plan file in that directory when available. Revise the visible plan in chat and update the plan file when the task still requires an implementation plan.",
    ""
  ].join("\n") : "";
  return systemReminder([
    reentry,
    "Plan mode is active. The user indicated that they do not want you to execute yet.",
    "This project implements soft Plan Mode: tools are still visible, but you MUST treat this run as planning-only.",
    "",
    "## Thread Work Directory",
    "",
    `The Project Workspace Plan Mode directory is ${workDirectory}. It can contain plan files, walkthrough files, or research notes for this project.`,
    "No file is bound when entering Plan Mode. Choose a short readable Markdown file name in this directory when the task needs persisted planning or walkthrough notes.",
    "If a relevant Markdown file already exists in this exact plan directory, you can read it and make incremental edits using read and edit.",
    "This directory is the only place you may create or edit files while Plan Mode is active. Do not create files just for formality for small non-editing tasks.",
    "Do not create scratch/cache/command-output drafts in Project Workspace .agent; use the system temp directory for temporary files.",
    "Build the plan visibly in chat as you learn and keep any Markdown work file aligned when one is used. Do not hide important decisions only in a file.",
    "The final planning response before exit_plan_mode should summarize the implementation plan for the user and cite the .agent/plan Markdown file path when one was prepared.",
    "",
    "## Restrictions",
    "",
    `- Do not edit, create, delete, move, format, migrate, commit, or otherwise mutate files or product data, except Markdown work files under ${workDirectory}.`,
    "- Read-only code and document exploration is allowed.",
    "- Tests or commands are allowed only when they are read-only enough to refine the plan and do not update tracked files.",
    "- Do not create or invoke Explore agents. Work locally with read/search tools.",
    "- Do not write outside the .agent/plan directory while Plan Mode is active. Temporary scratch/cache belongs in the system temp directory.",
    "- If the user asks you to implement while Plan Mode is active, keep planning instead. For anything beyond a small non-editing task, explain that implementation requires leaving Plan Mode through exit_plan_mode after the plan is ready.",
    "- Do not work silently for long stretches. After meaningful exploration, report concise findings and the current direction in chat.",
    "",
    "## Workflow",
    "",
    "1. Ground in the real repository with read-only exploration: inspect relevant files, schemas, tools, tests, and existing patterns.",
    "2. Report what you learned in chat when it changes the plan, including unresolved decisions and the next intended step.",
    "3. Ask the user via request_user_input only when an unresolved decision cannot be discovered from the repo and materially changes the implementation.",
    `4. Present a concise execution-ready plan in chat. For non-trivial implementation work, also write or update a readable Markdown plan, walkthrough, or research note under ${workDirectory}; the file name is your choice and the system will not generate a random slug.`,
    "5. Before exit_plan_mode, briefly report the plan status in chat and cite the Markdown file path when you wrote one. If you skip a file because the task is only a small non-editing task, say that briefly before requesting approval.",
    "6. Call exit_plan_mode when the plan is complete and ready for approval. The tool can request approval from the visible chat plan, and planFilePath should point to a Markdown file under .agent/plan/ when one should be previewed.",
    "7. After approval, implement from the approved chat plan or the approved Markdown file shown during exit approval.",
    "",
    "The user explicitly requested no Explore agent for this project Plan Mode."
  ].join("\n"));
}
async function renderPlanModeSlotText(ctx, children, workDirectory) {
  const body = await renderStandaloneString(ctx, [
    `Thread work directory: ${workDirectory}
`,
    ...children
  ]);
  return body.trim() ? systemReminder(body) : "";
}
function mentionedSkillsReminderText(ctx) {
  const latestUser = ctx.runtime?.pendingUserMessage ?? [...ctx.session.messages].reverse().find((message) => message.role === "user");
  if (!latestUser || latestUser.role !== "user") {
    return "";
  }
  const text = messageText(latestUser);
  const names = [...text.matchAll(/\$([^\s$]+)/gu)].map((match) => match[1]).filter(Boolean);
  if (names.length === 0) {
    return "";
  }
  return systemReminder([
    `The user explicitly mentioned skill(s): ${names.map((name) => `$${name}`).join(", ")}.`,
    "If these skills are visible in the catalog, read the matching SKILL.md location from SkillCatalog before continuing.",
    "Use the original skill key exactly. Do not translate it into English, pinyin, or a new slug."
  ].join("\n"));
}
function displaySkillLocation(skillPath) {
  return resolve(skillPath);
}
async function defaultSkillCatalogText(ctx) {
  if (ctx.skills.length === 0) {
    return "";
  }
  const skillLines = ctx.skills.map((skillItem) => [
    `- key: ${skillItem.key}`,
    `  name: ${skillItem.name}`,
    `  description: ${skillItem.description ?? skillItem.key}`,
    skillItem.whenToUse ? `  when_to_use: ${skillItem.whenToUse}` : "",
    `  location: ${displaySkillLocation(skillItem.skillPath)}`
  ].filter(Boolean).join("\n")).join("\n\n");
  return [
    "<system-reminder>",
    "## Skill",
    "",
    "Skills are reusable work methods. They are not long-term memory and they are not mandatory for every turn.",
    "",
    "- Skill roots: workspace/.nbook/agent/skills/ overrides assets/workspace/.nbook/agent/skills/.",
    "- User assets override system assets by whole skill directory, not by merging individual files.",
    "- There is no separate skill tool. To use a skill, read the SKILL.md file at the catalog location.",
    "- Read SKILL.md first as the entry card; if it references relative files such as references, scripts, templates, or examples, read only the needed files under the same skill directory.",
    "- Skill keys may be Chinese. Use the original key from the catalog exactly; do not translate, romanize, or invent a slug.",
    "- If the user explicitly types $skill-key, or the task clearly matches a catalog description, read the matching SKILL.md before continuing.",
    "- If the user did not mention a skill and the task does not clearly match one, do not read a skill just for formality.",
    "- A skill guides this turn only. Stable world facts belong in Lorebook, plot progress belongs in Plot System, and temporary plans stay in the conversation.",
    "- If a skill conflicts with the user's goal, prioritize the user's goal; ask one minimal clarification only when the conflict materially changes the result.",
    "- After using a skill, the final response should report key output and necessary verification, not repeat the full skill content.",
    "",
    "## Available Skills",
    "",
    skillLines,
    "</system-reminder>"
  ].join("\n");
}
async function defaultAgentCatalogText(ctx) {
  const profiles = ctx.catalog.profiles.filter((profile) => profile.loadStatus === "loaded").map(renderAgentCatalogIndexItem);
  if (profiles.length === 0) {
    return "";
  }
  return [
    "<system-reminder>",
    "## Available Agents",
    "",
    "These agent profiles are currently available through create_agent / invoke_agent.",
    "This catalog is only an index. Before calling an unfamiliar profile, call get_agent_profile({ profileKey }) to inspect InputSchema, OutputSchema, report_result schema, and allowed tools.",
    "",
    ...profiles,
    "</system-reminder>"
  ].join("\n");
}
async function defaultActivatedSkillsText(ctx) {
  const latestUser = ctx.runtime?.pendingUserMessage ?? [...ctx.session.messages].reverse().find((message) => message.role === "user");
  const text = latestUser && latestUser.role === "user" ? messageText(latestUser) : "";
  const skillNames = [...text.matchAll(/\$([^\s$]+)/gu)].map((match) => match[1]).filter(Boolean);
  if (skillNames.length === 0) {
    return "";
  }
  return systemReminder([
    `The user explicitly mentioned skill(s): ${skillNames.map((name) => `$${name}`).join(", ")}.`,
    "If each mentioned skill is visible in SkillCatalog, read the matching SKILL.md location before continuing.",
    "If a mentioned skill is not visible in the catalog, say that directly and continue with the best fallback."
  ].join("\n"));
}
async function defaultSqlSchemaSummaryText(ctx) {
  try {
    const { getAgentSqlSchemaSummary: getAgentSqlSchemaSummary2 } = await Promise.resolve().then(() => (init_sql_tool(), sql_tool_exports));
    return [
      "<sql-schema-summary>",
      "Target database is current Project Workspace .nbook/project.sqlite. App SQLite is not accessible from execute_sql.",
      'Double-quote business tables with uppercase letters and camelCase columns, e.g. "createdAt", "sortOrder".',
      await getAgentSqlSchemaSummary2(ctx.session.projectPath),
      "</sql-schema-summary>"
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ["<sql-schema-summary>", `SQL schema summary \u6682\u4E0D\u53EF\u7528\uFF1A${message}`, "</sql-schema-summary>"].join("\n");
  }
}

// server/agent/profiles/define-agent-profile.ts
function defineAgentProfile(profile) {
  assertProfileManifest(profile.manifest);
  assertProfileSummarizer(profile.manifest.key, profile.summarizer);
  if (profile.context && profile.prepare) {
    throw new Error(`profile ${profile.manifest.key} \u4E0D\u80FD\u540C\u65F6\u5B9A\u4E49 context \u548C prepare\u3002`);
  }
  if (!profile.context && !profile.prepare) {
    throw new Error(`profile ${profile.manifest.key} \u5FC5\u987B\u5B9A\u4E49 context \u6216 prepare\u3002`);
  }
  const prepare = profile.prepare ? async (...args) => {
    const plan = await profile.prepare(...args);
    validateProfileTurnPlan(profile.manifest.key, plan);
    return plan;
  } : async (...args) => {
    const ctx = args[0];
    const tree = await profile.context(ctx);
    return compileProfileContext(profile, ctx, tree);
  };
  return {
    ...profile,
    prepare
  };
}
function assertProfileManifest(manifest) {
  if (!manifest.key.trim()) {
    throw new Error("profile manifest.key \u4E0D\u80FD\u4E3A\u7A7A");
  }
  if (!manifest.name.trim()) {
    throw new Error(`profile ${manifest.key} manifest.name \u4E0D\u80FD\u4E3A\u7A7A`);
  }
}
function assertProfileSummarizer(profileKey, summarizer) {
  if (!summarizer) {
    return;
  }
  if (summarizer.enabled === false) {
    return;
  }
  if (!summarizer.profileKey || !summarizer.profileKey.trim()) {
    throw new Error(`profile ${profileKey} summarizer.profileKey \u4E0D\u80FD\u4E3A\u7A7A`);
  }
  if (summarizer.input !== void 0 && (typeof summarizer.input !== "object" || summarizer.input === null || Array.isArray(summarizer.input))) {
    throw new Error(`profile ${profileKey} summarizer.input \u5FC5\u987B\u662F\u5BF9\u8C61`);
  }
}

// server/agent/profiles/builtin-contracts.ts
import { Type as Type2 } from "typebox";
var LeaderDefaultInputSchema = Type2.Object({
  role: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u7684\u8FD0\u884C\u89D2\u8272\u63D0\u793A\uFF0C\u7528\u4E8E\u8BA9 leader \u5728\u9ED8\u8BA4\u534F\u4F5C\u6A21\u5F0F\u4E4B\u5916\u4E34\u65F6\u504F\u5411\u67D0\u4E2A\u5DE5\u4F5C\u8EAB\u4EFD\u3002" }))
});
var LeaderDefaultOutputSchema = Type2.Object({
  result: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u603B\u7ED3\u6587\u672C\u3002leader.default \u901A\u5E38\u4E0D\u8981\u6C42 report_result\u3002" }))
});
var SessionSummarizerInputSchema = Type2.Object({
  sourceSessionId: Type2.Number({ description: "\u7531 harness \u6CE8\u5165\u7684\u6E90 leader session id\u3002" }),
  trigger: Type2.Optional(Type2.Union([
    Type2.Literal("after_invocation")
  ], { description: "\u9996\u6B21\u89E6\u53D1\u65F6\u673A\u3002\u7B2C\u4E00\u7248\u4EC5\u652F\u6301 after_invocation\u3002" })),
  interval: Type2.Optional(Type2.Object({
    kind: Type2.Union([
      Type2.Literal("turn"),
      Type2.Literal("loop"),
      Type2.Literal("dialogueContentTokens")
    ]),
    value: Type2.Number({ description: "\u89E6\u53D1\u95F4\u9694\u3002turn/loop \u8868\u793A\u6B21\u6570\uFF0CdialogueContentTokens \u8868\u793A\u65B0\u589E\u6B63\u6587 token\u3002" })
  }, { description: "\u540E\u53F0\u6458\u8981\u5468\u671F\u89E6\u53D1\u914D\u7F6E\u3002" })),
  maxDialogueContentTokens: Type2.Optional(Type2.Number({ description: "Agent Dialogue Content \u8D85\u8FC7\u8BE5 token \u4F30\u7B97\u503C\u65F6\u8DF3\u8FC7\u672C\u6B21\u6458\u8981\u3002" }))
});
var SessionSummarizerOutputSchema = Type2.Object({
  title: Type2.String({ description: "\u7B80\u77ED session \u6807\u9898\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 32 \u5B57\u3002" }),
  summary: Type2.String({ description: "\u5F53\u524D session \u7684\u53EF\u8BFB\u6458\u8981\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 240 \u5B57\u3002" })
});
var WriterInputSchema = Type2.Object({
  prompt: Type2.String({ description: "\u672C\u6B21\u5199\u4F5C\u4EFB\u52A1\u3002\u5199\u6E05\u8981\u5199\u4EC0\u4E48\u3001\u662F\u91CD\u5199\u8FD8\u662F\u5C40\u90E8\u4FEE\u6539\u3001\u7AE0\u8282\u8FB9\u754C\u548C\u4EA4\u4ED8\u8981\u6C42\u3002" }),
  chapterPaths: Type2.Array(Type2.String({ description: "\u7AE0\u8282\u5185\u5BB9\u8282\u70B9\u76EE\u5F55\u8DEF\u5F84\u3002\u5F53\u524D Project Workspace \u4F7F\u7528 manuscript/.../\uFF1B\u8DE8 Project Workspace \u4F7F\u7528 novel-slug/manuscript/.../\u3002" }), {
    minItems: 1,
    maxItems: 1,
    description: "\u672C writer session \u7ED1\u5B9A\u7684\u552F\u4E00\u7AE0\u8282\u3002\u8C03\u7528\u65B9\u5FC5\u987B\u5148\u521B\u5EFA\u7AE0\u8282\u5185\u5BB9\u8282\u70B9\uFF0C\u5E76\u5728 Plot System \u4E2D\u628A Scene \u6302\u5230\u8BE5\u7AE0\u8282\u3002"
  }),
  lorebookEntries: Type2.Optional(Type2.Array(Type2.String({ description: "\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\uFF0C\u6309 writer agent cwd \u89E3\u6790\u3002writer \u4F1A\u6309\u6570\u7EC4\u987A\u5E8F\u8BFB\u53D6 index.md \u4E0E\u540C\u7EA7\u53EF\u9009 state.md\u3002" }), { description: "\u672C\u6B21\u5199\u4F5C\u9700\u8981\u8BFB\u53D6\u7684 Lorebook/Manuscript \u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u6570\u7EC4\u3002" })),
  constraints: Type2.Optional(Type2.Array(Type2.String({ description: "\u989D\u5916\u5199\u4F5C\u7EA6\u675F\u3001\u683C\u5F0F\u7EA6\u675F\u3001\u7981\u5FCC\u3001\u5B57\u6570\u6216\u7528\u6237\u4E34\u65F6\u504F\u597D\u3002" }), { description: "\u672C\u8F6E\u5199\u4F5C\u7EA6\u675F\u5217\u8868\u3002" })),
  writingStylePreset: Type2.Optional(Type2.String({ description: "\u53EF\u9009 writing style \u9884\u8BBE key\uFF0C\u4E0D\u662F\u6587\u4EF6\u8DEF\u5F84\u3002\u7CFB\u7EDF\u9884\u8BBE\u76EE\u5F55\uFF1Aassets/workspace/.nbook/agent/writing-presets/styles\uFF1B\u7528\u6237\u8986\u76D6\u76EE\u5F55\uFF1Aworkspace/.nbook/agent/writing-presets/styles\u3002\u4E3A\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6587\u98CE\u3002" })),
  writingReferencePreset: Type2.Optional(Type2.String({ description: "\u53EF\u9009 writing reference \u9884\u8BBE key\uFF0C\u4E0D\u662F\u6587\u4EF6\u8DEF\u5F84\u3002\u7CFB\u7EDF\u9884\u8BBE\u76EE\u5F55\uFF1Aassets/workspace/.nbook/agent/writing-presets/references\uFF1B\u7528\u6237\u8986\u76D6\u76EE\u5F55\uFF1Aworkspace/.nbook/agent/writing-presets/references\u3002\u4E3A\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u53C2\u8003\u6587\u6863\u3002" }))
});
var WriterOutputSchema = Type2.Object({
  summary: Type2.String({ description: "\u5199\u4F5C\u6458\u8981\uFF0C\u8BF4\u660E\u65F6\u95F4\u3001\u5730\u70B9\u3001\u53C2\u4E0E\u89D2\u8272\u3001\u5173\u952E\u52A8\u4F5C\u3001\u5173\u7CFB\u53D8\u5316\u548C\u4F0F\u7B14/\u72B6\u6001\u53D8\u5316\u3002" }),
  outputPath: Type2.Optional(Type2.String({ description: "\u5B9E\u9645\u5199\u5165\u6216\u4FEE\u6539\u7684\u6587\u4EF6\u8DEF\u5F84\u3002\u6CA1\u6709\u6587\u4EF6\u843D\u70B9\u65F6\u4E0D\u8981\u586B\u3002" }))
});
var RetrievalInputSchema = Type2.Object({
  prompt: Type2.String({ description: "\u68C0\u7D22\u8BF7\u6C42\u3002\u5199\u6E05\u4EFB\u52A1\u76EE\u6807\u3001\u8981\u627E\u4EC0\u4E48\u3001\u7ED9\u8C01\u7528\u3001\u7AE0\u8282/\u6B63\u6587\u4E0A\u4E0B\u6587\u3001\u6392\u9664\u9879\u548C\u6570\u91CF\u504F\u597D\u3002" })
});
var RetrievalOutputSchema = Type2.Object({
  entries: Type2.Array(Type2.Object({
    path: Type2.String({ description: "\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u3002Leader \u8C03 writer \u65F6\u53EA\u63D0\u53D6\u8FD9\u4E2A path\u3002" }),
    reason: Type2.String({ description: "\u4E3A\u4EC0\u4E48\u8FD9\u4E2A\u8282\u70B9\u5E94\u8BE5\u4F20\u7ED9 writer\u3002\u6309\u5F53\u524D\u5199\u4F5C\u4EFB\u52A1\u6982\u62EC\uFF0C\u4E0D\u8981\u5B8C\u6574\u590D\u8FF0\u8282\u70B9 summary\u3002" }),
    use: Type2.Optional(Type2.String({ description: "\u5EFA\u8BAE writer \u91CD\u70B9\u4F7F\u7528\u8FD9\u4E2A\u8282\u70B9\u7684\u54EA\u4E00\u90E8\u5206\u4FE1\u606F\uFF1B\u7ED9 Leader \u5224\u65AD\u7528\uFF0C\u4E0D\u76F4\u63A5\u4F20\u7ED9 writer\u3002" })),
    risk: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u98CE\u9669\u8BF4\u660E\uFF0C\u4F8B\u5982\u53EA\u662F\u5F31\u76F8\u5173\u3001\u72B6\u6001\u53EF\u80FD\u8FC7\u65F6\u3001\u9700\u8981\u7528\u6237\u786E\u8BA4\u3001\u53EF\u80FD\u4E0E\u4EFB\u52A1\u51B2\u7A81\u3002" }))
  }), { description: "\u6309\u63A8\u8350\u4F18\u5148\u7EA7\u6392\u5E8F\u7684\u5019\u9009\u5185\u5BB9\u8282\u70B9\u3002" }),
  note: Type2.Optional(Type2.String({ description: "\u6574\u4F53\u68C0\u7D22\u8BF4\u660E\uFF0C\u4F8B\u5982\u6CA1\u6709\u5F3A\u76F8\u5173\u6761\u76EE\u3001\u7ED3\u679C\u504F\u5C11\u3001\u5EFA\u8BAE\u8865\u5145\u641C\u7D22\u6761\u4EF6\u3002" }))
});

// server/agent/profiles/profile-text.ts
function profileText(strings, ...values) {
  const rawParts = strings.raw.map((part) => decodeUnicodeEscapes(part).replace(/\r\n/g, "\n"));
  const firstPart = rawParts[0] ?? "";
  const lastIndex = rawParts.length - 1;
  rawParts[0] = firstPart.replace(/^\n/, "");
  rawParts[lastIndex] = (rawParts[lastIndex] ?? "").replace(/\n[ \t]*$/, "");
  const indent = minimumIndent(rawParts);
  return rawParts.map((part, index) => {
    const value = index < values.length ? String(values[index] ?? "") : "";
    return stripIndent(part, indent) + value;
  }).join("").trim();
}
function decodeUnicodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}
function minimumIndent(parts) {
  const indents = parts.flatMap((part) => part.split("\n")).filter((line) => line.trim().length > 0).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  return indents.length > 0 ? Math.min(...indents) : 0;
}
function stripIndent(text, indent) {
  if (indent <= 0) {
    return text;
  }
  return text.split("\n").map((line) => line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line).join("\n");
}

// server/agent/profiles/profile-dsl/jsx-runtime.ts
var components = {
  ProfilePrompt,
  System,
  HistorySet,
  ModelContext,
  AppendingSet,
  Compaction,
  CompactionPrompt,
  CompactionSummaryPrefix,
  Message,
  AIMessage,
  ToolCall,
  ToolResult,
  Reminder,
  Watch,
  If,
  SystemReminder,
  RuntimeContext,
  LinkedAgentsSummary,
  LinkedAgentsReminder,
  TaskReminder,
  PlanModeReminder,
  PlanModeFull,
  PlanModeSparse,
  PlanModeExit,
  PlanModeReentry,
  ActivePlanModeReminder,
  MentionedSkillsReminder,
  AgentCatalog,
  SkillCatalog,
  ActivatedSkills,
  SqlSchemaSummary,
  Variable,
  VariableSchema
};
function jsx(type, props) {
  return createElement(type, props);
}
var jsxs = jsx;
function createElement(type, props) {
  if (typeof type === "function") {
    return type(props);
  }
  const component = components[type];
  if (!component) {
    throw new Error(`\u672A\u77E5 Profile DSL JSX \u8282\u70B9\uFF1A${String(type)}`);
  }
  return component(props);
}

// assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx
var profileManifest = {
  key: "retrieval",
  name: "Retrieval",
  description: "\u5185\u5BB9\u8282\u70B9\u53EC\u56DE\u548C\u5019\u9009\u5224\u65AD agent\uFF1A\u4E3A Leader \u67E5\u627E lorebook/manuscript \u76F8\u5173\u8282\u70B9\uFF0C\u8F93\u51FA entries \u7ED9\u8C03\u7528\u65B9\u5224\u65AD\uFF0C\u4E0D\u76F4\u63A5\u66FF writer \u5199\u6B63\u6587\u3002"
};
var InputSchema = RetrievalInputSchema;
var OutputSchema = RetrievalOutputSchema;
var allowedToolKeys = ["bash", "read", "report_result"];
var retrieval_profile_default = defineAgentProfile({
  manifest: profileManifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  allowedToolKeys,
  context(ctx) {
    return /* @__PURE__ */ jsxs(ProfilePrompt, { children: [
      /* @__PURE__ */ jsx(System, { children: renderSystemPrompt() }),
      /* @__PURE__ */ jsx(HistorySet, { children: /* @__PURE__ */ jsx(Message, { children: /* @__PURE__ */ jsx(SkillCatalog, {}) }) }),
      /* @__PURE__ */ jsx(ModelContext, { children: /* @__PURE__ */ jsx(Message, { children: /* @__PURE__ */ jsx(RuntimeContext, {}) }) }),
      /* @__PURE__ */ jsx(AppendingSet, { children: /* @__PURE__ */ jsx(Message, { children: `Search prompt:
${ctx.input.prompt}` }) })
    ] });
  }
});
function renderSystemPrompt() {
  return profileText`
        You are the retrieval profile. 使用中文作为你的默认语言，使用中文思考。你的任务是在写作前为 Leader 选择一小组值得交给 writer 阅读的内容节点候选。你是检索器和候选解释器，不是正文作者。

        # 内容节点事实

        - 常规检索优先以当前 Project Workspace 为边界。当前 Project Workspace 内路径通常是 lorebook/... 或 manuscript/...。
        - 跨 Project Workspace 检索必须在路径中显式写出目标 Project Workspace，不要根据自然语言猜项目。
        - 内容节点通常是目录 + index.md。frontmatter 存 title、type、status、summary、refs、retrieval、inject 等元数据。
        - 同级 state.md 存当前世界状态、角色位置、物品、目标和信息差；缺失 state.md 是正常情况。
        - retrieval.enabled=false 表示该节点通常不应作为自动检索候选。
        - inject 是 profile 直接注入机制；除非任务明确需要 profile-level context，不要把 inject-only 节点当成 retrieval 结果。
        - retrieval.trigger 是自然语言相关性提示，不是关键词列表。把它当作“什么时候应该召回这个节点”的语义条件。
        - refs 是结构关系，可用于从强命中节点扩展一跳相关角色、地点、物品或规则。
        - writer 只消费 path 字符串数组。你的结构化结果面向 Leader；Leader 会阅读 reason/use/risk/note 后，只把 entries[].path 传给 writer.lorebookEntries。

        # 固定检索流程

        1. 第一条搜索命令必须建立“内容节点元数据清单”，不能先做正文关键词搜索。
           - bash: rg --files | rg '(^|/)index\.md$' | workspace node parse --stdin --ndjson
           - bash 命令里的 workspace 相对路径优先使用 / 分隔；不要写未加引号的 Windows 反斜杠路径。
        2. 从 Search prompt 自己理解任务目标、给谁用、章节/正文上下文、排除项和数量偏好；不要要求调用方额外提供结构化字段。
        3. 用 Search prompt、节点 title/type/status/summary/refs/retrieval.trigger 初筛候选。除非任务就是未决事实，否则优先 active 节点，谨慎使用 draft/pending。
        4. 生成清单后才允许用 rg 做精确验证。rg 要有边界，优先 lorebook 或 manuscript 下的明确 root，不要反复跑全局巨大 alternation。
           - 限制输出示例：rg -n "term" lorebook/character | head -n 30
        5. 通常不要读取候选全文。只有元数据歧义会影响 Leader 取舍时才 read 少量 index.md。
        6. 默认不读取 state.md；如果 Search prompt 明确需要当前状态，可以谨慎读取少量 state.md，并在 risk 中标注可能过时或需要确认。
        7. 如果 rg 超时或一次没有有用结果，不要反复重试宽泛搜索；回到元数据清单和 refs 判断。
        8. 只对强候选做 refs 一跳扩展，扩展到明显相关的角色、地点、物品或规则即可。
        9. 结果保持紧凑；数组顺序就是推荐优先级。
        10. 必须调用 report_result；report_result.data 必须是 { entries, note? }。

        # 输出合同

        - entries 是给 Leader 的候选列表，不是 writer 的直接输入。
        - entries[].path 是唯一会被 Leader 传给 writer 的字段。
        - entries[].reason 必填，说明这个节点为什么应该传给 writer；按当前写作任务概括，不要完整复述内容节点 summary。
        - entries[].use 可选，说明建议 writer 重点使用节点里的哪类信息。
        - entries[].risk 可选，说明弱相关、状态可能过时、需要用户确认或可能冲突的风险。
        - note 可选，用于整体说明没有强相关条目、结果偏少、建议补充搜索条件等情况。
        - 不要输出上述合同以外的旧字段或自造字段。
        - report_result.walkthrough 只写一句简短说明。不要编辑文件，不要用 prose-only final answer 代替 report_result。
    `;
}
export {
  InputSchema,
  OutputSchema,
  retrieval_profile_default as default,
  profileManifest
};
