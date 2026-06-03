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
import { createError } from "h3";
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
  return initProjectDatabaseAtRoot(resolveProjectAbsolutePath(projectPath));
}
async function initProjectDatabaseAtRoot(projectRoot) {
  const databasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const client = createClient({ url: toSqliteFileUrl(databasePath) });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    for (const statement of splitSqlStatements(PROJECT_MIGRATION_SQL)) {
      await client.execute(statement);
    }
  } finally {
    await client.close();
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
    executionMode: "sequential",
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

// assets/workspace/.nbook/agent/profiles/builtin/rp.actor.profile.tsx
import { readFile as readFile2 } from "node:fs/promises";
import { isAbsolute as isAbsolute2, relative as relative3, resolve as resolve2 } from "node:path";
import { Type as Type3 } from "typebox";

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

// server/agent/profiles/profile-dsl.ts
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, relative as relative2 } from "node:path";

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
  const allowedKeys = /* @__PURE__ */ new Set(["systemPrompt", "historyInitMessages", "appendingMessages", "modelContextAppendingMessages", "modelContextMessages", "stateWrites"]);
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
    render: props.render,
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
function Import(props) {
  return {
    kind: "StringFragment",
    text: () => renderImportedContext(props)
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
function RuntimeLocationReminder(props = {}) {
  return Reminder({
    id: props.id ?? "runtime-location",
    watch: (ctx) => ({
      toolCwd: normalizeDisplayPath(ctx.session.workspaceRoot),
      sourceRoot: normalizeAbsoluteDisplayPath(process.cwd()),
      referenceRoot: normalizeAbsoluteDisplayPath(resolve(process.cwd(), "reference")),
      mode: props.mode ?? "workspace"
    }),
    repeatEveryTurns: props.repeatEveryTurns,
    render: (change) => {
      const location = readRuntimeLocationState(change.currentValue);
      if (location.mode === "userAssets") {
        return Message({ children: systemReminder([
          "Runtime Location:",
          `- Tool cwd: ${ensureTrailingSlash(location.toolCwd)}`,
          `- This is the cwd itself. Use . for the cwd; do not prefix file paths with ${ensureTrailingSlash(location.toolCwd)}`,
          `- Source root: ${location.sourceRoot}`,
          `- Reference root: ${location.referenceRoot}`,
          "- user-assets is Workspace Root .nbook, not a Project Workspace.",
          "- Agent profiles, skills, writing presets, and variables live under agent/ in the current user-assets cwd.",
          "- Do not write novel lorebook, manuscript, plot data, chapter prose, world facts, or Project SQLite into user-assets."
        ].join("\n")) });
      }
      return Message({ children: systemReminder([
        "Runtime Location:",
        `- Tool cwd: ${ensureTrailingSlash(location.toolCwd)}`,
        `- This is the cwd itself. Use . for the cwd; do not prefix file paths with ${ensureTrailingSlash(location.toolCwd)}`,
        `- Source root: ${location.sourceRoot}`,
        `- Reference root: ${location.referenceRoot}`,
        "- If a tool asks for cwd-relative workspace files, use paths under the tool cwd, for example project-slug/manuscript/...",
        "- If a tool asks for projectPath, use workspace/project-slug."
      ].join("\n")) });
    }
  });
}
function WorkspaceFocusReminder(props = {}) {
  return Reminder({
    id: props.id ?? "workspace-focus",
    watch: readWorkspaceFocus,
    repeatEveryTurns: props.repeatEveryTurns,
    render: (change) => {
      const focus = readWorkspaceFocusState(change.currentValue);
      if (!focus.currentProjectWorkspace) {
        return Message({ children: systemReminder("Current Workspace Focus:\n- Current Project Workspace: none\n- Current selected file: none") });
      }
      const projectSlug = projectSlugFromWorkspace(focus.currentProjectWorkspace);
      const selectedFile = renderSelectedWorkspaceFile(projectSlug, focus.selectedFilePath);
      if (change.hasPreviousValue && change.didChange) {
        const previous = readWorkspaceFocusState(change.previousValue);
        const projectChanged = previous.currentProjectWorkspace !== focus.currentProjectWorkspace;
        const selectedChanged = previous.selectedFilePath !== focus.selectedFilePath;
        if (projectChanged) {
          return Message({ children: systemReminder([
            `User switched Current Project Workspace to ${focus.currentProjectWorkspace}.`,
            "Tool cwd is unchanged.",
            `Use ${projectSlug}/lorebook/..., ${projectSlug}/manuscript/..., and ${projectSlug}/reference/... for project files.`,
            `Do not use workspace/${projectSlug}/... unless a tool explicitly asks for projectPath.`,
            `Current selected file: ${selectedFile}`
          ].join("\n")) });
        }
        if (selectedChanged) {
          return Message({ children: systemReminder([
            `Current selected file changed to ${selectedFile}.`,
            "Use this cwd-relative path directly in file tools."
          ].join("\n")) });
        }
      }
      return Message({ children: systemReminder([
        "Current Workspace Focus:",
        `- Current Project Workspace: ${focus.currentProjectWorkspace}`,
        `- For project files in file tools and shell, use ${projectSlug}/lorebook/... or ${projectSlug}/manuscript/...`,
        `- Current selected file: ${selectedFile}`,
        `- project.yaml is at ${projectSlug}/project.yaml.`,
        `- Do not use workspace/${projectSlug}/... unless a tool explicitly asks for projectPath.`
      ].join("\n")) });
    }
  });
}
function PlanModeAvailabilityReminder(props = {}) {
  return Reminder({
    id: props.id ?? "plan-mode-availability",
    watch: (ctx) => ctx.session.planModeActive ? "active" : "inactive",
    repeatEveryTurns: props.repeatEveryTurns,
    render: (change) => change.currentValue === "inactive" ? Message({ children: systemReminder("Plan mode is inactive. For large, risky, or multi-step changes, use enter_plan_mode before editing.") }) : null
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
    if (zone !== "message" && zone !== "system" && zone !== "assistant" && zone !== "reminder" && zone !== "watch") {
      throw new Error("string fragment \u53EA\u80FD\u653E\u5728\u652F\u6301 string \u7684\u8282\u70B9\u5185\u90E8\u3002");
    }
    return [];
  }
  if (child.kind === "PlanModeSlot") {
    throw new Error(`${slotNodeName(child.slot)} \u53EA\u80FD\u4F5C\u4E3A PlanModeReminder \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
  }
  throw new Error(`\u672A\u77E5 Profile DSL \u8282\u70B9\uFF1A${JSON.stringify(child)}`);
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
  const change = {
    previousValue: previous?.hasValue ? previous.value ?? null : void 0,
    currentValue,
    hasPreviousValue: Boolean(previous?.hasValue),
    hasCurrentValue: currentValue !== void 0,
    didChange: didFingerprintChange,
    session: state.context.session
  };
  const rendered = node.render ? await node.render(change) : node.children;
  if (!rendered || rendered === true) {
    return [];
  }
  const messages = await renderChildren(state, "reminder", normalizeChildren(rendered));
  if (messages.length === 0) {
    return [];
  }
  if (hasWatchValue || node.repeatEveryTurns) {
    state.nextRuntimeState.reminders = {
      ...state.nextRuntimeState.reminders,
      [node.id]: {
        ...hasWatchValue ? {
          hasValue: currentValue !== void 0,
          value: currentValue === void 0 ? null : currentValue
        } : {},
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
async function renderImportedContext(props) {
  if (props.as && props.as !== "text") {
    throw new Error(`Import.as \u7B2C\u4E00\u7248\u53EA\u652F\u6301 text\uFF1A${props.as}`);
  }
  const path2 = normalizeImportPath(props.path);
  const readResult = await readImportFile(path2, props.required === true);
  if (!readResult.exists) {
    return "";
  }
  let body = readResult.text;
  if (props.heading) {
    const extracted = extractMarkdownHeading(body, props.heading);
    if (extracted === null) {
      if (props.required === false) {
        return "";
      }
      throw new Error(`Import \u672A\u627E\u5230 Markdown heading\uFF1A${path2}#${props.heading}`);
    }
    body = extracted;
  }
  const truncated = props.maxBytes ? truncateUtf8(body, props.maxBytes) : { text: body, truncated: false };
  return renderImportFence({
    path: path2,
    maxBytes: props.maxBytes,
    truncated: truncated.truncated,
    text: truncated.text
  });
}
function normalizeImportPath(input) {
  const path2 = input.trim().replaceAll("\\", "/");
  if (!path2) {
    throw new Error("Import.path \u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  if (isAbsolute(path2) || path2.startsWith("/") || path2.includes("://")) {
    throw new Error(`Import.path \u53EA\u5141\u8BB8 repo / app root \u76F8\u5BF9\u8DEF\u5F84\uFF1A${input}`);
  }
  const normalized = path2.split("/").filter((part) => part && part !== ".").join("/");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error(`Import.path \u4E0D\u5141\u8BB8\u4F7F\u7528 .. \u8D8A\u754C\uFF1A${input}`);
  }
  if (!isAllowedImportPath(normalized)) {
    throw new Error(`Import.path \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8 AGENTS.md\u3001reference/** \u6216 docs/**\uFF1A${input}`);
  }
  return normalized;
}
function isAllowedImportPath(path2) {
  return path2 === "AGENTS.md" || path2.startsWith("reference/") || path2.startsWith("docs/");
}
async function readImportFile(path2, required) {
  const target = resolve(process.cwd(), path2);
  const cwd = resolve(process.cwd());
  if (relative2(cwd, target).split(/[\\/]/).includes("..")) {
    throw new Error(`Import.path \u89E3\u6790\u540E\u8D8A\u754C\uFF1A${path2}`);
  }
  try {
    return {
      exists: true,
      text: await readFile(target, "utf8")
    };
  } catch (error) {
    if (!isMissingFileError(error) || required) {
      throw error;
    }
    return { exists: false };
  }
}
function isMissingFileError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function extractMarkdownHeading(text, heading) {
  const expected = normalizeMarkdownHeadingText(heading);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }
    const title = normalizeMarkdownHeadingText(match[2] ?? "");
    if (title === expected) {
      start = index;
      level = match[1]?.length ?? 1;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+/);
    if (match && (match[1]?.length ?? 1) <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}
function normalizeMarkdownHeadingText(text) {
  return text.trim().replace(/\s+/g, " ");
}
function truncateUtf8(text, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Import.maxBytes \u5FC5\u987B\u662F\u6B63\u6574\u6570\u3002");
  }
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(chars.slice(0, middle).join(""), "utf8") <= maxBytes) {
      low = middle;
      continue;
    }
    high = middle - 1;
  }
  return {
    text: chars.slice(0, low).join(""),
    truncated: true
  };
}
function renderImportFence(props) {
  return [
    props.truncated ? `[Import truncated: ${props.path} maxBytes=${props.maxBytes}]` : "",
    `\`\`\`${props.path}`,
    props.text.trim(),
    "```"
  ].filter((line) => line !== "").join("\n");
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
      hasValue: typeof item.hasValue === "boolean" ? item.hasValue : false,
      value: item.value ?? null,
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
async function readCurrentProjectWorkspace(ctx) {
  const value = await ctx.vars.get("client.currentProjectWorkspace");
  const projectWorkspace = typeof value === "string" && value.trim() ? value : ctx.session.projectPath ?? "";
  return projectWorkspace ? normalizeDisplayPath(projectWorkspace) : "";
}
async function readWorkspaceFocus(ctx) {
  const selectedFilePath = await ctx.vars.get("client.studio.selectedFilePath");
  return {
    currentProjectWorkspace: await readCurrentProjectWorkspace(ctx),
    selectedFilePath: typeof selectedFilePath === "string" && selectedFilePath.trim() ? normalizeDisplayPath(selectedFilePath) : null
  };
}
function readRuntimeLocationState(value) {
  const record = readRecord(value);
  return {
    toolCwd: typeof record.toolCwd === "string" && record.toolCwd.trim() ? record.toolCwd : "workspace",
    sourceRoot: typeof record.sourceRoot === "string" && record.sourceRoot.trim() ? record.sourceRoot : normalizeAbsoluteDisplayPath(process.cwd()),
    referenceRoot: typeof record.referenceRoot === "string" && record.referenceRoot.trim() ? record.referenceRoot : normalizeAbsoluteDisplayPath(resolve(process.cwd(), "reference")),
    mode: typeof record.mode === "string" && record.mode.trim() ? record.mode : "workspace"
  };
}
function readWorkspaceFocusState(value) {
  const record = readRecord(value);
  return {
    currentProjectWorkspace: typeof record.currentProjectWorkspace === "string" ? record.currentProjectWorkspace : "",
    selectedFilePath: typeof record.selectedFilePath === "string" && record.selectedFilePath.trim() ? record.selectedFilePath : null
  };
}
function normalizeDisplayPath(value) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const relativeToRepo = relative2(process.cwd(), value).replace(/\\/g, "/");
  if (relativeToRepo && !relativeToRepo.startsWith("..") && !relativeToRepo.startsWith("/")) {
    return relativeToRepo.replace(/\/+$/g, "");
  }
  return normalized;
}
function normalizeAbsoluteDisplayPath(value) {
  return resolve(value).replace(/\\/g, "/").replace(/\/+$/g, "");
}
function ensureTrailingSlash(value) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized ? `${normalized}/` : "";
}
function projectSlugFromWorkspace(projectWorkspace) {
  const normalized = projectWorkspace.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized.startsWith("workspace/") ? normalized.slice("workspace/".length) : normalized;
}
function renderSelectedWorkspaceFile(projectSlug, selectedFilePath) {
  if (!selectedFilePath) {
    return "none";
  }
  const normalized = selectedFilePath.replace(/\\/g, "/").replace(/^\/+/g, "").replace(/\/+$/g, "");
  if (!projectSlug) {
    return normalized;
  }
  if (normalized === projectSlug || normalized.startsWith(`${projectSlug}/`)) {
    return normalized;
  }
  if (normalized.startsWith("workspace/")) {
    const withoutWorkspace = normalized.slice("workspace/".length);
    return withoutWorkspace === projectSlug || withoutWorkspace.startsWith(`${projectSlug}/`) ? withoutWorkspace : normalized;
  }
  if (/^(manuscript|lorebook|reference|upload|simulation|\.nbook)(\/|$)/.test(normalized)) {
    return `${projectSlug}/${normalized}`;
  }
  return normalized;
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

// server/agent/profiles/define-agent-runtime.ts
function defineAgentRuntime(runtime) {
  const hooks = expandRuntimeHooks(runtime.hooks);
  const seen = /* @__PURE__ */ new Set();
  for (const hook of hooks) {
    if (!hook.name.trim()) {
      throw new Error("runtime hook name \u4E0D\u80FD\u4E3A\u7A7A");
    }
    const key = `${hook.stage}:${hook.name}`;
    if (seen.has(key)) {
      throw new Error(`runtime hook \u91CD\u590D\uFF1A${key}`);
    }
    seen.add(key);
  }
  return { hooks };
}
var agentRuntimeBuiltins = {
  defaultSessionRuntime() {
    return defineAgentRuntime({
      hooks: [
        this.sessionRuntime()
      ]
    });
  },
  sessionRuntime() {
    return {
      kind: "builtin",
      name: "sessionRuntime",
      hooks: [
        this.profilePrompt(),
        this.sessionContext(),
        this.transcriptPersistence(),
        this.reportResult()
      ]
    };
  },
  profilePrompt() {
    return builtinHook("profilePrompt", "prepareRun", {
      builtinBehavior: {
        profilePrompt: true
      }
    });
  },
  sessionContext() {
    return builtinHook("sessionContext", "prepareRun", {
      builtinBehavior: {
        sessionContext: true
      }
    });
  },
  transcriptPersistence() {
    return builtinHook("transcriptPersistence", "ingestTurn", {
      transcript: "persist"
    });
  },
  runtimeOnlyTranscript() {
    return builtinHook("runtimeOnlyTranscript", "ingestTurn", {
      transcript: "runtime_only"
    });
  },
  reportResult() {
    return builtinHook("reportResult", "prepareRun", {
      builtinBehavior: {
        reportResultReminder: true
      }
    });
  }
};
function expandRuntimeHooks(items) {
  return items.flatMap((item) => isRuntimeBuiltin(item) ? item.hooks : [item]);
}
function isRuntimeBuiltin(item) {
  return "kind" in item && item.kind === "builtin";
}
function builtinHook(name, stage, result = {}) {
  return {
    name: `builtin.${name}`,
    stage,
    builtin: true,
    run() {
      return result;
    }
  };
}

// server/agent/profiles/define-agent-profile.ts
function defineAgentProfile(profile) {
  assertProfileManifest(profile.manifest);
  assertProfileSummarizer(profile.manifest.key, profile.summarizer);
  validateCompactionPlan(profile.manifest.key, profile.compaction);
  assertProfileSidecars(profile.manifest.key, profile.allowedToolKeys, profile.sidecars);
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
  const runtime = profile.runtime ? defineAgentRuntime(profile.runtime) : agentRuntimeBuiltins.defaultSessionRuntime();
  return {
    ...profile,
    runtime,
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
function assertProfileSidecars(profileKey, allowedToolKeys2, sidecars) {
  if (!sidecars) {
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  const allowed = new Set(allowedToolKeys2);
  for (const sidecar of sidecars) {
    if (!sidecar.name.trim()) {
      throw new Error(`profile ${profileKey} sidecar.name \u4E0D\u80FD\u4E3A\u7A7A`);
    }
    if (seen.has(sidecar.name)) {
      throw new Error(`profile ${profileKey} sidecar \u91CD\u590D\uFF1A${sidecar.name}`);
    }
    seen.add(sidecar.name);
    if (sidecar.stage !== "prepareRun" && sidecar.stage !== "settleRun") {
      throw new Error(`profile ${profileKey} sidecar ${sidecar.name} stage \u53EA\u652F\u6301 prepareRun \u6216 settleRun`);
    }
    for (const toolKey of sidecar.allowedToolKeys ?? []) {
      if (!allowed.has(toolKey)) {
        throw new Error(`profile ${profileKey} sidecar ${sidecar.name} allowedToolKeys \u5FC5\u987B\u662F profile allowedToolKeys \u5B50\u96C6\uFF1A${toolKey}`);
      }
    }
    const sidecarToolKeys = sidecar.allowedToolKeys ?? allowedToolKeys2;
    if (!sidecarToolKeys.includes("report_result") && !sidecar.outputFallback) {
      throw new Error(`profile ${profileKey} sidecar ${sidecar.name} \u672A\u5141\u8BB8 report_result \u65F6\u5FC5\u987B\u58F0\u660E outputFallback\u3002`);
    }
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
var LeaderRpInputSchema = Type2.Object({
  simulationRoot: Type2.Optional(Type2.String({ description: "\u53EF\u9009 simulation \u76EE\u5F55\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\u3002\u9ED8\u8BA4\u4F7F\u7528\u5F53\u524D Project Workspace \u4E0B\u7684 simulation/\u3002" }))
});
var LeaderRpOutputSchema = Type2.Object({
  result: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u603B\u7ED3\u6587\u672C\u3002leader.rp \u901A\u5E38\u76F4\u63A5\u9762\u5411\u7528\u6237\u8F93\u51FA writer prose\uFF0C\u4E0D\u8981\u6C42 report_result\u3002" }))
});
var RpActorInputSchema = Type2.Object({
  actorId: Type2.String({ description: "\u672C\u5C40 subject simulator id\uFF0C\u5FC5\u987B\u4E0E simulation/cast.yaml \u4E2D\u7684 subject id \u5BF9\u5E94\u3002" }),
  actorName: Type2.Optional(Type2.String({ description: "\u89D2\u8272\u53EF\u8BFB\u540D\u3002\u4E3A\u7A7A\u65F6\u4F7F\u7528 actorId\u3002" })),
  kind: Type2.Optional(Type2.String({ description: "actor \u7C7B\u578B\uFF0C\u4F8B\u5982 player\u3001npc\u3001faction\u3001system\u3002" })),
  instructionPath: Type2.String({ description: "subject simulator \u6307\u4EE4\u6587\u4EF6\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\uFF0C\u4F8B\u5982 project-slug/simulation/subjects/erina/subject.md\u3002" }),
  eventsPath: Type2.String({ description: "\u89D2\u8272\u4E8B\u4EF6\u6D41\u6C34\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\uFF0C\u4F8B\u5982 project-slug/simulation/subjects/erina/events.md\u3002" }),
  knowledgePath: Type2.String({ description: "\u89D2\u8272\u53EF\u77E5\u4E16\u754C\u4E66\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\uFF0C\u4F8B\u5982 project-slug/simulation/subjects/erina/knowledge.md\u3002" }),
  mindPath: Type2.String({ description: "\u89D2\u8272\u5F53\u524D\u601D\u7EF4\u6587\u4EF6\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\uFF0C\u4F8B\u5982 project-slug/simulation/subjects/erina/mind.md\u3002" }),
  statePath: Type2.String({ description: "\u89D2\u8272\u5F53\u524D\u72B6\u6001\u6587\u4EF6\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\uFF0C\u4F8B\u5982 project-slug/simulation/subjects/erina/state.md\u3002" })
});
var RpActorOutputSchema = Type2.Object({
  visible_action: Type2.String({ description: "\u89D2\u8272\u5728\u573A\u666F\u4E2D\u53EF\u88AB\u89C2\u5BDF\u5230\u7684\u52A8\u4F5C\u3001\u795E\u6001\u3001\u59FF\u6001\u6216\u6C89\u9ED8\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  spoken_dialogue: Type2.String({ description: "\u89D2\u8272\u660E\u786E\u8BF4\u51FA\u53E3\u7684\u53F0\u8BCD\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  private_intent: Type2.String({ description: "\u53EA\u7ED9 GM \u4F7F\u7528\u7684\u79C1\u4E0B\u610F\u56FE\u3001\u5224\u65AD\u6216\u77ED\u671F\u76EE\u6807\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  emotional_state: Type2.String({ description: "\u53EA\u7ED9 GM \u4F7F\u7528\u7684\u60C5\u7EEA\u72B6\u6001\u6458\u8981\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  assumptions: Type2.Array(Type2.String({ description: "\u89D2\u8272\u57FA\u4E8E\u81EA\u8EAB\u77E5\u8BC6\u548C\u672C Tick packet \u5F62\u6210\u7684\u5224\u65AD\u3001\u8BEF\u89E3\u6216\u5047\u8BBE\u3002" }), { description: "\u6CA1\u6709\u5219\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002" }),
  questions_to_gm: Type2.Array(Type2.String({ description: "\u9700\u8981 GM \u88C1\u51B3\u3001\u8865\u5145\u6216\u786E\u8BA4\u7684\u95EE\u9898\u3002" }), { description: "\u6CA1\u6709\u5219\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002" }),
  event_update: Type2.String({ description: "\u672C Tick \u540E\u5E94\u5199\u5165 events.md \u7684 subject \u89C6\u89D2\u4E8B\u4EF6\u6D41\u6C34\u6458\u8981\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  knowledge_update: Type2.String({ description: "\u672C Tick \u540E\u5E94\u5199\u5165 knowledge.md \u7684\u65B0\u589E\u8BA4\u77E5\u6458\u8981\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  mind_update: Type2.String({ description: "\u672C Tick \u540E\u5E94\u5199\u5165 mind.md \u7684\u5F53\u524D\u60F3\u6CD5\u3001\u5224\u65AD\u6216\u52A8\u673A\u6458\u8981\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  state_update: Type2.String({ description: "\u672C Tick \u540E\u5E94\u5199\u5165 state.md \u7684\u4F4D\u7F6E\u3001\u6301\u6709\u7269\u3001\u4F24\u52BF\u3001\u5173\u7CFB\u538B\u529B\u6216\u77ED\u671F\u76EE\u6807\u53D8\u5316\uFF1B\u6CA1\u6709\u5219\u586B\u7A7A\u5B57\u7B26\u4E32\u3002" })
});
var RpWriterInputSchema = Type2.Object({
  writerInstructionPath: Type2.String({ description: "RP writer \u63D0\u793A\u8BCD\u7D20\u6750\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\uFF0C\u4F8B\u5982 project-slug/simulation/writer.md\u3002" }),
  style: Type2.Optional(Type2.String({ description: "\u7A33\u5B9A\u6587\u98CE\u504F\u597D\u3002\u4E34\u65F6 Tick \u6587\u98CE\u8981\u6C42\u5E94\u653E\u5728 writer brief \u4E2D\u3002" })),
  outputRequirements: Type2.Optional(Type2.Array(Type2.String({ description: "\u7A33\u5B9A\u8F93\u51FA\u7EA6\u675F\uFF0C\u4F8B\u5982\u4EBA\u79F0\u3001\u7BC7\u5E45\u3001Markdown \u89C4\u5219\u3002" }), { description: "\u53EF\u9009\u7A33\u5B9A\u8F93\u51FA\u7EA6\u675F\u3002" })),
  language: Type2.Optional(Type2.String({ description: "\u8F93\u51FA\u8BED\u8A00\uFF0C\u4F8B\u5982 zh-CN\u3002\u9ED8\u8BA4\u8DDF\u968F GM writer brief\u3002" }))
});
var RpWriterOutputSchema = Type2.Object({
  result: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u7ED3\u679C\u8BF4\u660E\u3002rp.writer \u901A\u5E38\u76F4\u63A5\u7528\u666E\u901A assistant \u56DE\u590D\u8F93\u51FA\u6B63\u6587\uFF0C\u4E0D\u8981\u6C42 report_result\u3002" }))
});
var SessionSummarizerInputSchema = Type2.Object({
  sourceSessionId: Type2.Number({ description: "\u7531 harness \u6CE8\u5165\u7684 source session id\u3002" }),
  trigger: Type2.Optional(Type2.Union([
    Type2.Literal("afterInvocation")
  ], { description: "\u89E6\u53D1\u65F6\u673A\u3002\u7B2C\u4E00\u7248\u4EC5\u652F\u6301 afterInvocation\u3002" })),
  interval: Type2.Optional(Type2.Object({
    kind: Type2.Union([
      Type2.Literal("sourceInvocation"),
      Type2.Literal("dialogueContentTokens")
    ]),
    value: Type2.Number({ description: "\u89E6\u53D1\u95F4\u9694\u3002sourceInvocation \u8868\u793A source invocation \u6B21\u6570\uFF0CdialogueContentTokens \u8868\u793A\u65B0\u589E\u6B63\u6587 token\u3002" })
  }, { description: "\u540E\u53F0\u6458\u8981\u5468\u671F\u89E6\u53D1\u914D\u7F6E\u3002" })),
  maxDialogueContentTokens: Type2.Optional(Type2.Number({ description: "Agent Dialogue Content \u8D85\u8FC7\u8BE5 token \u4F30\u7B97\u503C\u65F6\u8DF3\u8FC7\u672C\u6B21\u6458\u8981\u3002" }))
});
var SessionSummarizerOutputSchema = Type2.Object({
  title: Type2.String({ description: "\u7B80\u77ED session \u6807\u9898\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 32 \u5B57\u3002" }),
  summary: Type2.String({ description: "\u5F53\u524D session \u7684\u53EF\u8BFB\u6458\u8981\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 240 \u5B57\u3002" })
});
var WriterInputSchema = Type2.Object({
  prompt: Type2.String({ description: "\u672C\u6B21\u5199\u4F5C\u4EFB\u52A1\u3002\u5199\u6E05\u8981\u5199\u4EC0\u4E48\u3001\u662F\u91CD\u5199\u8FD8\u662F\u5C40\u90E8\u4FEE\u6539\u3001\u7AE0\u8282\u8FB9\u754C\u548C\u4EA4\u4ED8\u8981\u6C42\u3002" }),
  chapterPaths: Type2.Array(Type2.String({ description: "\u7AE0\u8282\u5185\u5BB9\u8282\u70B9\u76EE\u5F55\u8DEF\u5F84\uFF0C\u5FC5\u987B\u76F8\u5BF9\u4E8E Agent cwd\u3002\u666E\u901A Project agent \u7684 cwd \u662F workspace \u5BB9\u5668\u6839\uFF0C\u56E0\u6B64\u5E94\u4F20 project-slug/manuscript/.../\uFF0C\u4E0D\u8981\u4F20 manuscript/.../ \u6216 workspace/project-slug/.../\u3002" }), {
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
var ResearcherInputSchema = Type2.Object({
  topic: Type2.Optional(Type2.String({
    maxLength: 500,
    description: "Long-lived research topic for this researcher session. Omit for a general researcher."
  })),
  goal: Type2.Optional(Type2.String({
    maxLength: 1200,
    description: "Stable research goal or operating brief for this researcher session. Per-turn questions should be sent via invoke_agent.message, not stored here."
  })),
  allowed_domains: Type2.Optional(Type2.Array(Type2.String({
    minLength: 1,
    description: "Default allowed domain filter inherited by web_search unless the turn asks otherwise."
  }), { maxItems: 20 })),
  blocked_domains: Type2.Optional(Type2.Array(Type2.String({
    minLength: 1,
    description: "Default blocked domain filter inherited by web_search unless the turn asks otherwise."
  }), { maxItems: 50 })),
  default_recency_days: Type2.Optional(Type2.Integer({
    minimum: 1,
    maximum: 3650,
    description: "Default freshness preference for web_search. Omit for no default recency filter."
  })),
  source_policy: Type2.Optional(Type2.Union([
    Type2.Literal("balanced"),
    Type2.Literal("primary_sources"),
    Type2.Literal("recent_first")
  ], {
    description: "Default source preference. primary_sources means prefer official docs, papers, laws, specs, or original announcements when available."
  })),
  output_language: Type2.Optional(Type2.String({
    description: "Preferred response language, for example zh-CN or en. Default follows the caller/user language."
  }))
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
  Message,
  AIMessage,
  ToolCall,
  ToolResult,
  Reminder,
  Watch,
  If,
  SystemReminder,
  LinkedAgentsSummary,
  LinkedAgentsReminder,
  RuntimeLocationReminder,
  WorkspaceFocusReminder,
  PlanModeAvailabilityReminder,
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
  Import,
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

// assets/workspace/.nbook/agent/profiles/builtin/rp.actor.profile.tsx
var profileManifest = {
  key: "rp.actor",
  name: "RP Subject Simulator",
  description: "\u901A\u7528 subject simulator\uFF1A\u57FA\u4E8E subject \u6307\u4EE4\u3001knowledge/mind/state \u548C simulator leader \u7684\u620F\u5185\u6D88\u606F\u56DE\u5E94\uFF0C\u901A\u8FC7 report_result \u8FD4\u56DE\u7ED3\u6784\u5316 actor packet\u3002"
};
var InputSchema = RpActorInputSchema;
var OutputSchema = RpActorOutputSchema;
var allowedToolKeys = ["read", "write", "edit", "report_result"];
var DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 24e3;
var ActorContextLoadSidecarSchema = Type3.Object({
  actor_safe_context: Type3.String({ description: "\u51C6\u5907\u6CE8\u5165 actor \u4E3B run \u7684\u89D2\u8272\u53EF\u77E5\u8BBE\u5B9A\u6458\u8981\uFF1B\u6CA1\u6709\u989D\u5916\u4FE1\u606F\u65F6\u5199\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  sources: Type3.Array(Type3.String({ description: "\u672C\u6B21\u6458\u8981\u53C2\u8003\u7684 actor \u6587\u4EF6\u6216 actor-safe lorebook \u8DEF\u5F84\u3002" })),
  withheld: Type3.Array(Type3.String({ description: "\u53D1\u73B0\u4F46\u4E0D\u5E94\u6CE8\u5165\u7ED9\u89D2\u8272\u7684\u9690\u85CF\u4FE1\u606F\u7C7B\u522B\u6216\u539F\u56E0\uFF1B\u6CA1\u6709\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002" })),
  confidence: Type3.String({ description: "\u5BF9\u672C\u6B21\u8FC7\u6EE4\u7ED3\u679C\u7684\u628A\u63E1\uFF0C\u4F8B\u5982 high\u3001medium\u3001low\u3002" })
});
var ActorMemorySaveSidecarSchema = Type3.Object({
  changed_files: Type3.Array(Type3.String({ description: "\u672C\u6B21\u5B9E\u9645\u4FEE\u6539\u7684\u6587\u4EF6\u8DEF\u5F84\uFF1B\u6CA1\u6709\u4FEE\u6539\u8FD4\u56DE\u7A7A\u6570\u7EC4\u3002" })),
  events_summary: Type3.String({ description: "events.md \u7684\u66F4\u65B0\u6458\u8981\uFF1B\u6CA1\u6709\u4FEE\u6539\u5199\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  knowledge_summary: Type3.String({ description: "knowledge.md \u7684\u66F4\u65B0\u6458\u8981\uFF1B\u6CA1\u6709\u4FEE\u6539\u5199\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  mind_summary: Type3.String({ description: "mind.md \u7684\u66F4\u65B0\u6458\u8981\uFF1B\u6CA1\u6709\u4FEE\u6539\u5199\u7A7A\u5B57\u7B26\u4E32\u3002" }),
  skipped: Type3.Array(Type3.String({ description: "\u672C\u6B21\u6CA1\u6709\u5199\u5165\u7684\u539F\u56E0\u3001\u88AB\u8DF3\u8FC7\u7684\u66F4\u65B0\u6216\u4EA4\u7ED9\u5176\u4ED6\u7CFB\u7EDF\u5904\u7406\u7684\u5185\u5BB9\u3002" })),
  needs_gm_review: Type3.Array(Type3.String({ description: "\u9700\u8981 GM \u540E\u7EED\u88C1\u51B3\u6216\u786E\u8BA4\u7684\u4FE1\u606F\u3002" }))
});
function renderSystemPrompt(input) {
  const actorName = input.actorName?.trim() || input.actorId;
  return profileText`
        你是 NeuroBook 的 rp.actor，也是一个 subject simulator。你现在只扮演一个角色：${actorName}（actorId: ${input.actorId}）。使用中文作为默认语言。

        # 核心职责

        - 全心全意扮演该角色，而不是 GM、作者、旁白或 writer。
        - 只根据 <subject_instruction>、<subject_events>、<subject_knowledge>、<subject_mind>、<subject_state> 和 simulator leader 本 Tick 发来的戏内消息回应。
        - 输出结构化 actor response packet 给 GM，不写最终小说正文。
        - 不操控用户角色，不替用户决定核心行动，不推进全局世界状态。
        - 如果你扮演的是玩家 actor，用户输入高于你的推测；不要替用户新增行动、台词、情绪或目标，只报告已知边界、状态和基于用户输入的可见反应。

        # 信息边界

        - 你不能读取完整 simulation/、simulation/simulator.md、simulation/writer.md、lorebook/、reference/、其他 subject 目录或 GM scratch。
        - 你知道的世界等于 actor knowledge、mind、state 加上 GM 当前消息。即使你怀疑有隐藏真相，也只能以角色的有限认知表达。
        - knowledge.md 是给你看的角色视角资料；你把它当作当前已知信息使用，不判断它是否符合上帝视角真相。
        - GM 没有写入当前消息或你的角色文件的信息，不能变成你的台词、判断或内心确定事实。

        # 角色记忆边界

        - 主扮演阶段不要主动调用 read、write 或 edit，不要亲自维护文件。
        - 角色文件维护由 actor.memory-save 旁路完成；你只在 report_result.data 里返回本 Tick 的更新摘要。
        - event_update 只写角色本 Tick 经历、观察、听说、被告知或发生认知变化的事件流水；没有就填空字符串。
        - knowledge_update 只写角色本 Tick 新知道、被告知、观察到或自然推断到的信息摘要；没有就填空字符串。
        - mind_update 只写角色当前想法、判断、犹豫、情绪或动机变化摘要；没有就填空字符串。
        - state_update 只报告你观察到的状态变化候选，最终是否更新 state.md 由 GM / 后续状态系统裁决。
        - knowledge.md 记录角色已经知道、被告知、观察到或自然推断到的信息，不写 GM 推理或真实隐藏设定。
        - knowledge.md 使用二级章节归类，用三级标题表示具体条目；新增内容写成三级标题加正文段落，不要用 Markdown 列表堆条目。
        - 不要在 knowledge.md 新增“信念与误解”“最近更新”或“更新规则”章节。写入规则由本提示词负责。
        - knowledge.md 可以保留 GM 明确允许该角色知道的 lorebook 引用；引用使用 Markdown 相对路径链接，例如 [王都公共常识](../../lorebook/world/capital.md)。即使看到 lorebook 路径，也不要自行读取 lorebook，等待 GM 注入摘要或明确授权。
        - mind.md 记录角色当前正在想什么、判断什么、犹豫什么、想要什么；它是短期心理状态，不是世界真相。
        - events.md 记录角色怎么知道、经历或变化的流水，用 subject 视角写事件，不写上帝视角裁决。
        - state.md 记录位置、随身物品、伤势、姿态、关系压力和短期目标等可变状态。
        - 当前工具没有 runtime path scope，遵守这个边界是你的硬性职责。
        - 如果本 Tick 没有真实变化，不要为了“完成更新”而编造 update；在对应 update 字段填空字符串。

        # 扮演方式

        - visible_action 和 spoken_dialogue 要像角色自然反应，不要出现字段名、分析语气或“作为某某”。
        - private_intent 可以包含角色短期打算，但不能变成全局剧情安排。
        - emotional_state 写角色当下情绪，不写作者点评。
        - assumptions 写角色基于有限信息形成的判断或假设；不确定就保持不确定。
        - questions_to_gm 只放需要 GM 裁决的信息，不向用户提问。

        # 输出合同

        必须调用 report_result。report_result.result 写一句简短可读结果；report_result.data 必须包含：

        - visible_action: 可被观察到的动作、神态、沉默或行为；没有填空字符串。
        - spoken_dialogue: 角色说出口的台词；没有填空字符串。
        - private_intent: 只给 GM 的私下意图或短期目标；没有填空字符串。
        - emotional_state: 只给 GM 的情绪状态；没有填空字符串。
        - assumptions: 角色形成的判断或假设数组；没有返回 []。
        - questions_to_gm: 需要 GM 裁决的问题数组；没有返回 []。
        - event_update: 本 Tick 后应写入 events.md 的 subject 视角事件流水摘要；没有填空字符串。
        - knowledge_update: 本 Tick 后应写入 knowledge.md 的新增认知摘要；没有填空字符串。
        - mind_update: 本 Tick 后应写入 mind.md 的当前想法、判断或动机摘要；没有填空字符串。
        - state_update: 本 Tick 后应写入 state.md 的位置、持有物、伤势、关系压力或短期目标变化；没有填空字符串。

        不要把 packet 当作普通 final answer 输出。
    `;
}
async function renderActorContext(ctx) {
  const instruction = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.instructionPath);
  const events = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.eventsPath);
  const knowledge = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.knowledgePath);
  const mind = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.mindPath);
  const state = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.statePath);
  return profileText`
        <rp_subject_context>
        actorId: ${ctx.input.actorId}
        actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        kind: ${ctx.input.kind?.trim() || "\u672A\u6307\u5B9A"}
        instructionPath: ${ctx.input.instructionPath}
        eventsPath: ${ctx.input.eventsPath}
        knowledgePath: ${ctx.input.knowledgePath}
        mindPath: ${ctx.input.mindPath}
        statePath: ${ctx.input.statePath}

        <subject_instruction>
        ${instruction}
        </subject_instruction>

        <subject_events>
        ${events}
        </subject_events>

        <subject_knowledge>
        ${knowledge}
        </subject_knowledge>

        <subject_mind>
        ${mind}
        </subject_mind>

        <subject_state>
        ${state}
        </subject_state>
        </rp_subject_context>
    `;
}
function renderInvocationReminder(input) {
  return profileText`
        本轮请等待或处理 GM 通过当前 user message 发来的 actor-facing message。
        只回复 GM，并必须调用 report_result。不要主动读写文件；只在 event_update、knowledge_update、mind_update、state_update 中报告本 Tick 产生的更新候选。
        如果消息信息不足，只基于角色会观察到的表层事实回应，可以在 questions_to_gm 中请求裁决，不要自行补隐藏设定。
    `;
}
var actorContextLoadPass = {
  name: "actor.context-load",
  stage: "prepareRun",
  allowedToolKeys: ["read", "report_result"],
  sidecarDataSchema: ActorContextLoadSidecarSchema,
  enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 rp.actor 的 context-load 旁路，不要扮演角色，不要输出角色台词。

        目标：在 actor 主扮演 run 开始前，基于当前 GM actor-facing message 检索并整理该角色合理可知的补充设定。

        当前 actor：
        - actorId: ${ctx.input.actorId}
        - actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        - kind: ${ctx.input.kind?.trim() || "\u672A\u6307\u5B9A"}
        - instructionPath: ${ctx.input.instructionPath}
        - eventsPath: ${ctx.input.eventsPath}
        - knowledgePath: ${ctx.input.knowledgePath}
        - mindPath: ${ctx.input.mindPath}
        - statePath: ${ctx.input.statePath}

        规则：
        - 你可以读取当前 subject 自己的 subject.md、events.md、knowledge.md、mind.md、state.md。
        - 你可以读取与 GM 当前消息直接相关、且可以过滤成 actor-safe 摘要的 lorebook 条目。
        - 不要读取 simulation/simulator.md、simulation/writer.md、simulation/runs、GM scratch、其他 subject 目录或 reference 原始素材。
        - 如果 lorebook 条目混有公开信息和隐藏真相，只提取角色此刻合理能知道、看见、听见、感受到或自然推断到的部分。
        - 不要把隐藏真相、作者设定、GM 裁决过程、其他角色私密知识注入 actor_safe_context。
        - 如果没有额外 actor-safe 设定，actor_safe_context 返回空字符串，并在 withheld 说明原因。

        完成后调用 report_result，把结构化结果放在 sidecar_data 字段，不要使用主路 data 字段。
    `,
  merge(_ctx, result) {
    const data = result.sidecarData;
    const context = data.actor_safe_context.trim() || "\u672C Tick \u6CA1\u6709\u989D\u5916 actor-safe \u8BBE\u5B9A\u6CE8\u5165\u3002";
    return {
      runtimeMessages: [
        createUserMessage({
          text: profileText`
                        <actor_sidecar_context source="actor.context-load">
                        ${context}

                        sources: ${data.sources.length ? data.sources.join(", ") : "\u65E0"}
                        withheld: ${data.withheld.length ? `\u6709 ${data.withheld.length} \u6761\u4E0D\u5E94\u7531\u89D2\u8272\u5F97\u77E5\u7684\u4FE1\u606F\u5DF2\u4FDD\u7559\u3002` : "\u65E0"}
                        confidence: ${data.confidence}
                        </actor_sidecar_context>
                    `
        })
      ]
    };
  }
};
var actorMemorySavePass = {
  name: "actor.memory-save",
  stage: "settleRun",
  allowedToolKeys: ["read", "write", "edit", "report_result"],
  sidecarDataSchema: ActorMemorySaveSidecarSchema,
  enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是 rp.actor 的 memory-save 旁路，不要继续扮演角色，不要新增角色台词或行动。

        目标：根据刚刚完成的 actor 主 run 结果，维护该 actor 的 events.md、knowledge.md 与 mind.md。

        当前 actor：
        - actorId: ${ctx.input.actorId}
        - actorName: ${ctx.input.actorName?.trim() || ctx.input.actorId}
        - eventsPath: ${ctx.input.eventsPath}
        - knowledgePath: ${ctx.input.knowledgePath}
        - mindPath: ${ctx.input.mindPath}
        - statePath: ${ctx.input.statePath}

        主 run report_result.data：
        ${formatJson(ctx.runResult?.reportResult?.data)}

        写入规则：
        - 只允许读取和修改 eventsPath、knowledgePath 与 mindPath。
        - 不要修改 subject.md。
        - 不要修改 statePath；即使主 run 返回 state_update，也只在 skipped 或 needs_gm_review 中说明交给 GM / 后续状态系统处理。
        - events.md 只写 subject 视角事件流水：这个角色本 Tick 经历了什么、听见什么、被告知什么、怎么获得某条信息。
        - events.md 不写 GM 推理、真实隐藏设定、其他角色私密知识或完整 packet。
        - knowledge.md 只写角色已经知道、被告知、观察到或自然推断到的信息，不写 GM 推理、真实隐藏设定或其他角色私密知识。
        - mind.md 只写角色当前想法、判断、犹豫、情绪或动机，不写世界真相。
        - 如果 event_update、knowledge_update 或 mind_update 为空，或者现有文件已经覆盖该信息，不要为了更新而改文件。
        - 文件更新要短，优先局部 edit；只有确实需要完整重写时才使用 write。
        - 不要把 report_result packet 写进文件。

        完成后调用 report_result，把结构化结果放在 sidecar_data 字段，不要使用主路 data 字段。
    `,
  merge(_ctx, result) {
    return {
      runtimeState: {
        changed_files: result.sidecarData.changed_files,
        events_summary: result.sidecarData.events_summary,
        knowledge_summary: result.sidecarData.knowledge_summary,
        mind_summary: result.sidecarData.mind_summary,
        skipped: result.sidecarData.skipped,
        needs_gm_review: result.sidecarData.needs_gm_review
      }
    };
  }
};
function formatJson(value) {
  if (value === void 0) {
    return "\u672A\u63D0\u4F9B report_result.data\u3002";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
var rp_actor_profile_default = defineAgentProfile({
  manifest: profileManifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  allowedToolKeys,
  compaction: {
    reserveTokens: 25600,
    keepRecentTokens: DEFAULT_COMPACTION_KEEP_RECENT_TOKENS
  },
  sidecars: [
    actorContextLoadPass,
    actorMemorySavePass
  ],
  async context(ctx) {
    const actorContext = await renderActorContext(ctx);
    return /* @__PURE__ */ jsxs(ProfilePrompt, { children: [
      /* @__PURE__ */ jsx(System, { children: renderSystemPrompt(ctx.input) }),
      /* @__PURE__ */ jsxs(ModelContext, { children: [
        /* @__PURE__ */ jsx(Message, { children: actorContext }),
        /* @__PURE__ */ jsx(Message, { children: renderInvocationReminder(ctx.input) })
      ] }),
      /* @__PURE__ */ jsx(AppendingSet, { children: /* @__PURE__ */ jsx(RuntimeLocationReminder, {}) })
    ] });
  }
});
async function readWorkspaceFile(workspaceRoot, relativePath) {
  const root = resolve2(workspaceRoot);
  const normalizedPath = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedPath) {
    throw new Error("rp.actor \u8F93\u5165\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  const absolutePath = resolve2(root, normalizedPath);
  const relativeToWorkspace = relative3(root, absolutePath);
  if (relativeToWorkspace.startsWith("..") || isAbsolute2(relativeToWorkspace)) {
    throw new Error(`rp.actor \u8F93\u5165\u8DEF\u5F84\u8D8A\u8FC7 workspace: ${relativePath}`);
  }
  try {
    const content = await readFile2(absolutePath, "utf-8");
    return content.trim() || "\u7A7A";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`rp.actor \u65E0\u6CD5\u8BFB\u53D6 ${relativePath}: ${message}`);
  }
}
export {
  InputSchema,
  OutputSchema,
  rp_actor_profile_default as default,
  profileManifest
};
