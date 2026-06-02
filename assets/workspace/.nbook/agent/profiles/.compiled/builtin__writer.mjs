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
import { createError as createError2 } from "h3";
import * as yaml from "yaml";
function normalizeProjectPath(input) {
  const normalized = input.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
  if (!normalized || normalized === "workspace" || normalized.includes("..") || path.posix.isAbsolute(normalized)) {
    throw createError2({ statusCode: 400, message: "projectPath \u5FC5\u987B\u662F workspace \u4E0B\u7684\u9879\u76EE\u76EE\u5F55" });
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "workspace") {
    throw createError2({ statusCode: 400, message: "projectPath \u5FC5\u987B\u5F62\u5982 workspace/<project>" });
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
    throw createError2({ statusCode: 400, message: `${projectPath}/${PROJECT_MANIFEST_FILE} \u4E0D\u662F\u6709\u6548 Project manifest` });
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

// server/generated/project-prisma/enums.ts
var init_enums = __esm({
  "server/generated/project-prisma/enums.ts"() {
    "use strict";
  }
});

// server/generated/project-prisma/internal/class.ts
import * as runtime from "@prisma/client/runtime/client";
async function decodeBase64AsWasm(wasmBase64) {
  const { Buffer: Buffer2 } = await import("node:buffer");
  const wasmArray = Buffer2.from(wasmBase64, "base64");
  return new WebAssembly.Module(wasmArray);
}
function getPrismaClientClass() {
  return runtime.getPrismaClient(config);
}
var config;
var init_class = __esm({
  "server/generated/project-prisma/internal/class.ts"() {
    "use strict";
    config = {
      "previewFeatures": [],
      "clientVersion": "7.3.0",
      "engineVersion": "9d6ad21cbbceab97458517b147a6a09ff43aa735",
      "activeProvider": "sqlite",
      "inlineSchema": '// Project Workspace SQLite schema. This database lives inside each Project\n// Workspace at .nbook/project.sqlite and is portable with the project.\ngenerator client {\n  provider = "prisma-client"\n  output   = "../server/generated/project-prisma"\n}\n\ndatasource db {\n  provider = "sqlite"\n}\n\nenum StoryThreadStatus {\n  active\n  draft\n  paused\n  done\n  archived\n}\n\nenum StorySceneStatus {\n  draft\n  active\n  written\n  revised\n  archived\n}\n\nenum StoryPlotKind {\n  setup\n  action\n  conflict\n  despair\n  relief\n  reward\n  mystery\n  reveal\n  twist\n  payoff\n  result\n}\n\nenum StoryRefTargetKind {\n  content\n  thread\n  scene\n  plot\n}\n\nenum StoryRefVisibility {\n  author\n  reader\n}\n\nmodel ProjectMetadata {\n  key       String   @id\n  value     String\n  createdAt DateTime @default(now())\n  updatedAt DateTime @default(now()) @updatedAt\n}\n\nmodel DatabaseLock {\n  key       Int      @id\n  updatedAt DateTime @default(now()) @updatedAt\n}\n\nmodel Story {\n  id        Int           @id @default(autoincrement())\n  title     String\n  summary   String        @default("")\n  note      String?\n  createdAt DateTime      @default(now())\n  updatedAt DateTime      @default(now()) @updatedAt\n  phases    StoryPhase[]\n  threads   StoryThread[]\n  scenes    StoryScene[]\n}\n\nmodel StoryPhase {\n  id        Int           @id @default(autoincrement())\n  storyId   Int\n  sortOrder Int\n  name      String\n  title     String\n  summary   String        @default("")\n  note      String?\n  createdAt DateTime      @default(now())\n  updatedAt DateTime      @default(now()) @updatedAt\n  story     Story         @relation(fields: [storyId], references: [id], onDelete: Cascade)\n  threads   StoryThread[]\n\n  @@unique([storyId, name])\n  @@index([storyId, sortOrder])\n}\n\nmodel StoryThread {\n  id                Int               @id @default(autoincrement())\n  storyId           Int\n  storyPhaseId      Int?\n  sortOrder         Int\n  name              String\n  title             String\n  isMainThread      Boolean           @default(false)\n  status            StoryThreadStatus @default(draft)\n  summary           String            @default("")\n  tags              String            @default("[]")\n  writingTip        String?\n  note              String?\n  createdAt         DateTime          @default(now())\n  updatedAt         DateTime          @default(now()) @updatedAt\n  story             Story             @relation(fields: [storyId], references: [id], onDelete: Cascade)\n  storyPhase        StoryPhase?       @relation(fields: [storyPhaseId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  scenes            StoryScene[]\n  incomingSceneRefs StorySceneRef[]   @relation("StorySceneRefTargetThread")\n\n  @@unique([storyId, name])\n  @@index([storyId, storyPhaseId, sortOrder])\n  @@index([storyId, isMainThread, status])\n}\n\nmodel StoryScene {\n  id                Int              @id @default(autoincrement())\n  storyId           Int\n  threadId          Int\n  chapterPath       String?\n  threadSortOrder   Int\n  chapterSortOrder  Int?\n  title             String\n  status            StorySceneStatus @default(draft)\n  summary           String           @default("")\n  purpose           String?\n  writingTip        String?\n  note              String?\n  createdAt         DateTime         @default(now())\n  updatedAt         DateTime         @default(now()) @updatedAt\n  story             Story            @relation(fields: [storyId], references: [id], onDelete: Cascade)\n  thread            StoryThread      @relation(fields: [threadId], references: [id], onDelete: Cascade)\n  plots             StoryPlot[]\n  refs              StorySceneRef[]  @relation("StorySceneRefs")\n  incomingSceneRefs StorySceneRef[]  @relation("StorySceneRefTargetScene")\n\n  @@unique([threadId, threadSortOrder])\n  @@index([threadId, threadSortOrder])\n  @@index([chapterPath, chapterSortOrder])\n  @@index([storyId, status])\n}\n\nmodel StoryPlot {\n  id                Int             @id @default(autoincrement())\n  sceneId           Int\n  sortOrder         Int\n  kind              StoryPlotKind\n  summary           String          @default("")\n  effect            String?\n  writingTip        String?\n  note              String?\n  createdAt         DateTime        @default(now())\n  updatedAt         DateTime        @default(now()) @updatedAt\n  scene             StoryScene      @relation(fields: [sceneId], references: [id], onDelete: Cascade)\n  incomingSceneRefs StorySceneRef[] @relation("StorySceneRefTargetPlot")\n\n  @@unique([sceneId, sortOrder])\n  @@index([sceneId, sortOrder])\n}\n\nmodel StorySceneRef {\n  id             Int                @id @default(autoincrement())\n  sceneId        Int\n  sortOrder      Int\n  relation       String\n  rawTarget      String\n  targetKind     StoryRefTargetKind\n  targetThreadId Int?\n  targetSceneId  Int?\n  targetPlotId   Int?\n  visibility     StoryRefVisibility @default(author)\n  note           String?\n  createdAt      DateTime           @default(now())\n  updatedAt      DateTime           @default(now()) @updatedAt\n  scene          StoryScene         @relation("StorySceneRefs", fields: [sceneId], references: [id], onDelete: Cascade)\n  targetThread   StoryThread?       @relation("StorySceneRefTargetThread", fields: [targetThreadId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  targetScene    StoryScene?        @relation("StorySceneRefTargetScene", fields: [targetSceneId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  targetPlot     StoryPlot?         @relation("StorySceneRefTargetPlot", fields: [targetPlotId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n\n  @@index([sceneId, sortOrder])\n  @@index([targetThreadId])\n  @@index([targetSceneId])\n  @@index([targetPlotId])\n}\n',
      "runtimeDataModel": {
        "models": {},
        "enums": {},
        "types": {}
      }
    };
    config.runtimeDataModel = JSON.parse('{"models":{"ProjectMetadata":{"fields":[{"name":"key","kind":"scalar","type":"String"},{"name":"value","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"}],"dbName":null},"DatabaseLock":{"fields":[{"name":"key","kind":"scalar","type":"Int"},{"name":"updatedAt","kind":"scalar","type":"DateTime"}],"dbName":null},"Story":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"title","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"phases","kind":"object","type":"StoryPhase","relationName":"StoryToStoryPhase"},{"name":"threads","kind":"object","type":"StoryThread","relationName":"StoryToStoryThread"},{"name":"scenes","kind":"object","type":"StoryScene","relationName":"StoryToStoryScene"}],"dbName":null},"StoryPhase":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"storyId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"name","kind":"scalar","type":"String"},{"name":"title","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"StoryToStoryPhase"},{"name":"threads","kind":"object","type":"StoryThread","relationName":"StoryPhaseToStoryThread"}],"dbName":null},"StoryThread":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"storyId","kind":"scalar","type":"Int"},{"name":"storyPhaseId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"name","kind":"scalar","type":"String"},{"name":"title","kind":"scalar","type":"String"},{"name":"isMainThread","kind":"scalar","type":"Boolean"},{"name":"status","kind":"enum","type":"StoryThreadStatus"},{"name":"summary","kind":"scalar","type":"String"},{"name":"tags","kind":"scalar","type":"String"},{"name":"writingTip","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"StoryToStoryThread"},{"name":"storyPhase","kind":"object","type":"StoryPhase","relationName":"StoryPhaseToStoryThread"},{"name":"scenes","kind":"object","type":"StoryScene","relationName":"StorySceneToStoryThread"},{"name":"incomingSceneRefs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefTargetThread"}],"dbName":null},"StoryScene":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"storyId","kind":"scalar","type":"Int"},{"name":"threadId","kind":"scalar","type":"Int"},{"name":"chapterPath","kind":"scalar","type":"String"},{"name":"threadSortOrder","kind":"scalar","type":"Int"},{"name":"chapterSortOrder","kind":"scalar","type":"Int"},{"name":"title","kind":"scalar","type":"String"},{"name":"status","kind":"enum","type":"StorySceneStatus"},{"name":"summary","kind":"scalar","type":"String"},{"name":"purpose","kind":"scalar","type":"String"},{"name":"writingTip","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"StoryToStoryScene"},{"name":"thread","kind":"object","type":"StoryThread","relationName":"StorySceneToStoryThread"},{"name":"plots","kind":"object","type":"StoryPlot","relationName":"StoryPlotToStoryScene"},{"name":"refs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefs"},{"name":"incomingSceneRefs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefTargetScene"}],"dbName":null},"StoryPlot":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"sceneId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"kind","kind":"enum","type":"StoryPlotKind"},{"name":"summary","kind":"scalar","type":"String"},{"name":"effect","kind":"scalar","type":"String"},{"name":"writingTip","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"scene","kind":"object","type":"StoryScene","relationName":"StoryPlotToStoryScene"},{"name":"incomingSceneRefs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefTargetPlot"}],"dbName":null},"StorySceneRef":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"sceneId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"relation","kind":"scalar","type":"String"},{"name":"rawTarget","kind":"scalar","type":"String"},{"name":"targetKind","kind":"enum","type":"StoryRefTargetKind"},{"name":"targetThreadId","kind":"scalar","type":"Int"},{"name":"targetSceneId","kind":"scalar","type":"Int"},{"name":"targetPlotId","kind":"scalar","type":"Int"},{"name":"visibility","kind":"enum","type":"StoryRefVisibility"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"scene","kind":"object","type":"StoryScene","relationName":"StorySceneRefs"},{"name":"targetThread","kind":"object","type":"StoryThread","relationName":"StorySceneRefTargetThread"},{"name":"targetScene","kind":"object","type":"StoryScene","relationName":"StorySceneRefTargetScene"},{"name":"targetPlot","kind":"object","type":"StoryPlot","relationName":"StorySceneRefTargetPlot"}],"dbName":null}},"enums":{},"types":{}}');
    config.compilerWasm = {
      getRuntime: async () => await import("@prisma/client/runtime/query_compiler_fast_bg.sqlite.mjs"),
      getQueryCompilerWasmModule: async () => {
        const { wasm } = await import("@prisma/client/runtime/query_compiler_fast_bg.sqlite.wasm-base64.mjs");
        return await decodeBase64AsWasm(wasm);
      },
      importName: "./query_compiler_fast_bg.js"
    };
  }
});

// server/generated/project-prisma/internal/prismaNamespace.ts
import * as runtime2 from "@prisma/client/runtime/client";
var getExtensionContext, NullTypes2, TransactionIsolationLevel, defineExtension;
var init_prismaNamespace = __esm({
  "server/generated/project-prisma/internal/prismaNamespace.ts"() {
    "use strict";
    init_class();
    getExtensionContext = runtime2.Extensions.getExtensionContext;
    NullTypes2 = {
      DbNull: runtime2.NullTypes.DbNull,
      JsonNull: runtime2.NullTypes.JsonNull,
      AnyNull: runtime2.NullTypes.AnyNull
    };
    TransactionIsolationLevel = runtime2.makeStrictEnum({
      Serializable: "Serializable"
    });
    defineExtension = runtime2.Extensions.defineExtension;
  }
});

// server/generated/project-prisma/client.ts
import * as path6 from "node:path";
import { fileURLToPath } from "node:url";
import "@prisma/client/runtime/client";
var PrismaClient;
var init_client = __esm({
  "server/generated/project-prisma/client.ts"() {
    "use strict";
    init_enums();
    init_class();
    init_prismaNamespace();
    init_enums();
    init_enums();
    globalThis["__dirname"] = path6.dirname(fileURLToPath(import.meta.url));
    PrismaClient = getPrismaClientClass();
  }
});

// server/utils/novel-chapter.ts
import { consola } from "consola";
import { isError } from "h3";
import { YAMLParseError } from "yaml";
import "zod";
function stringifyEntityId(id) {
  return String(id);
}
function parseEntityId(label, value) {
  const normalized = value.trim();
  if (!normalized) {
    throwBadRequest(`${label} \u4E0D\u80FD\u4E3A\u7A7A`);
  }
  if (!/^\d+$/.test(normalized)) {
    throwBadRequest(`${label} \u5FC5\u987B\u662F\u6B63\u6574\u6570`);
  }
  const parsedId = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
    throwBadRequest(`${label} \u5FC5\u987B\u662F\u6B63\u6574\u6570`);
  }
  return parsedId;
}
function parseNullableEntityId(label, value) {
  if (value === null || value === void 0) {
    return null;
  }
  return parseEntityId(label, value);
}
var throwBadRequest;
var init_novel_chapter = __esm({
  "server/utils/novel-chapter.ts"() {
    "use strict";
    init_project_workspace();
    throwBadRequest = (message) => {
      throw createError({
        statusCode: 400,
        message
      });
    };
  }
});

// shared/reference-core.ts
import { z as z5 } from "zod";
function buildReferenceUri(kind, targetId) {
  return `${kind}://${targetId}`;
}
function parseReferenceUri(raw2) {
  const normalizedRaw = raw2.trim();
  const matched = normalizedRaw.match(URI_REFERENCE_PATTERN);
  if (!matched) {
    return null;
  }
  const kind = matched[1]?.trim().toLowerCase();
  const targetId = matched[2]?.trim() ?? "";
  if (!kind || !INLINE_REFERENCE_KINDS.includes(kind) || !targetId) {
    return null;
  }
  return {
    kind,
    targetId
  };
}
function parseStructuredReferenceTarget(raw2) {
  const normalizedRaw = raw2.trim();
  const uri = parseReferenceUri(normalizedRaw);
  if (uri && isStructuredUriKind(uri.kind)) {
    const matchedKind = uri.kind;
    return {
      kind: matchedKind,
      targetId: uri.targetId,
      canonicalTarget: buildReferenceUri(matchedKind, uri.targetId),
      legacy: false
    };
  }
  const lorebookMatch = normalizedRaw.match(LEGACY_LOREBOOK_TARGET_PATTERN);
  if (lorebookMatch?.[1]?.trim()) {
    const targetId = lorebookMatch[1].trim();
    return {
      kind: "content",
      targetId,
      canonicalTarget: normalizeWorkspaceReferenceTarget(targetId),
      legacy: true
    };
  }
  const threadMatch = normalizedRaw.match(LEGACY_THREAD_TARGET_PATTERN);
  if (threadMatch?.[1]?.trim()) {
    const targetId = threadMatch[1].trim();
    return {
      kind: "thread",
      targetId,
      canonicalTarget: buildReferenceUri("thread", targetId),
      legacy: true
    };
  }
  if (LEGACY_PENDING_TARGET_PATTERN.test(normalizedRaw)) {
    return null;
  }
  if (isStructuredWorkspaceReferenceTarget(normalizedRaw)) {
    const targetId = normalizeWorkspaceReferenceTarget(normalizedRaw);
    return {
      kind: "content",
      targetId,
      canonicalTarget: targetId,
      legacy: false
    };
  }
  return null;
}
function isStructuredUriKind(kind) {
  return kind === "thread" || kind === "scene" || kind === "plot";
}
function isStructuredWorkspaceReferenceTarget(raw2) {
  if (!raw2 || raw2.startsWith("/") || raw2.startsWith("#")) {
    return false;
  }
  if (WORKSPACE_REFERENCE_SCHEME_PATTERN.test(raw2)) {
    return false;
  }
  return true;
}
function normalizeWorkspaceReferenceTarget(raw2) {
  return raw2.trim().replace(/\\/g, "/");
}
var MAX_REFERENCE_RELATION_LENGTH, MAX_REFERENCE_TARGET_LENGTH, MAX_REFERENCE_NOTE_LENGTH, INLINE_REFERENCE_KINDS, STRUCTURED_REFERENCE_KINDS, LOREBOOK_STRUCTURED_REFERENCE_KINDS, STORY_STRUCTURED_REFERENCE_KINDS, ReferenceKindSchema, StructuredReferenceKindSchema, LorebookStructuredReferenceKindSchema, StoryStructuredReferenceKindSchema, ReferenceVisibilitySchema, ReferenceRelationSchema, ReferenceTargetSchema, ReferenceNoteSchema, StructuredReferenceDtoSchema, URI_REFERENCE_PATTERN, LEGACY_LOREBOOK_TARGET_PATTERN, LEGACY_THREAD_TARGET_PATTERN, LEGACY_PENDING_TARGET_PATTERN, WORKSPACE_REFERENCE_SCHEME_PATTERN;
var init_reference_core = __esm({
  "shared/reference-core.ts"() {
    "use strict";
    MAX_REFERENCE_RELATION_LENGTH = 120;
    MAX_REFERENCE_TARGET_LENGTH = 500;
    MAX_REFERENCE_NOTE_LENGTH = 5e3;
    INLINE_REFERENCE_KINDS = [
      "chapter",
      "volume",
      "lorebook",
      "thread",
      "scene",
      "plot"
    ];
    STRUCTURED_REFERENCE_KINDS = [
      "content",
      "thread",
      "scene",
      "plot"
    ];
    LOREBOOK_STRUCTURED_REFERENCE_KINDS = [
      "content"
    ];
    STORY_STRUCTURED_REFERENCE_KINDS = [
      "content",
      "thread",
      "scene",
      "plot"
    ];
    ReferenceKindSchema = z5.enum(INLINE_REFERENCE_KINDS);
    StructuredReferenceKindSchema = z5.enum(STRUCTURED_REFERENCE_KINDS);
    LorebookStructuredReferenceKindSchema = z5.enum(LOREBOOK_STRUCTURED_REFERENCE_KINDS);
    StoryStructuredReferenceKindSchema = z5.enum(STORY_STRUCTURED_REFERENCE_KINDS);
    ReferenceVisibilitySchema = z5.enum(["author", "reader"]);
    ReferenceRelationSchema = z5.string().trim().min(1, "relation \u4E0D\u80FD\u4E3A\u7A7A").max(MAX_REFERENCE_RELATION_LENGTH, "relation \u8FC7\u957F");
    ReferenceTargetSchema = z5.string().trim().min(1, "target \u4E0D\u80FD\u4E3A\u7A7A").max(MAX_REFERENCE_TARGET_LENGTH, "target \u8FC7\u957F");
    ReferenceNoteSchema = z5.string().max(MAX_REFERENCE_NOTE_LENGTH, "note \u8FC7\u957F");
    StructuredReferenceDtoSchema = z5.object({
      relation: ReferenceRelationSchema,
      target: ReferenceTargetSchema,
      visibility: ReferenceVisibilitySchema.default("author"),
      // `note` 为空表示该引用没有额外备注。
      note: ReferenceNoteSchema.nullable().optional().default(null)
    });
    URI_REFERENCE_PATTERN = /^([a-z]+):\/\/(.+)$/i;
    LEGACY_LOREBOOK_TARGET_PATTERN = /^lorebook:(.+)$/i;
    LEGACY_THREAD_TARGET_PATTERN = /^thread:(.+)$/i;
    LEGACY_PENDING_TARGET_PATTERN = /^pending\./i;
    WORKSPACE_REFERENCE_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
  }
});

// server/plot/assemblers/plot-dto.assembler.ts
var PlotDtoAssembler;
var init_plot_dto_assembler = __esm({
  "server/plot/assemblers/plot-dto.assembler.ts"() {
    "use strict";
    init_novel_chapter();
    init_reference_core();
    PlotDtoAssembler = class {
      /**
       * 映射 Story DTO。
       */
      toStoryDto(story) {
        return {
          id: stringifyEntityId(story.id),
          title: story.title,
          summary: story.summary,
          note: story.note,
          createdAt: story.createdAt.toISOString(),
          updatedAt: story.updatedAt.toISOString()
        };
      }
      /**
       * 映射 StoryPhase DTO。
       */
      toStoryPhaseDto(phase) {
        return {
          id: stringifyEntityId(phase.id),
          storyId: stringifyEntityId(phase.storyId),
          sortOrder: phase.sortOrder,
          name: phase.name,
          title: phase.title,
          summary: phase.summary,
          note: phase.note,
          createdAt: phase.createdAt.toISOString(),
          updatedAt: phase.updatedAt.toISOString()
        };
      }
      /**
       * 映射 Thread 摘要 DTO。
       */
      toStoryThreadSummaryDto(thread) {
        return {
          id: stringifyEntityId(thread.id),
          storyId: stringifyEntityId(thread.storyId),
          storyPhaseId: thread.storyPhaseId === null ? null : stringifyEntityId(thread.storyPhaseId),
          sortOrder: thread.sortOrder,
          name: thread.name,
          title: thread.title,
          isMainThread: thread.isMainThread,
          status: thread.status,
          summary: thread.summary,
          tags: thread.tags,
          writingTip: thread.writingTip,
          note: thread.note,
          createdAt: thread.createdAt.toISOString(),
          updatedAt: thread.updatedAt.toISOString()
        };
      }
      /**
       * 映射 Scene 摘要 DTO。
       */
      toStorySceneSummaryDto(scene) {
        return {
          id: stringifyEntityId(scene.id),
          storyId: stringifyEntityId(scene.storyId),
          threadId: stringifyEntityId(scene.threadId),
          chapterPath: scene.chapterPath,
          threadSortOrder: scene.threadSortOrder,
          chapterSortOrder: scene.chapterSortOrder,
          title: scene.title,
          status: scene.status,
          summary: scene.summary,
          purpose: scene.purpose,
          writingTip: scene.writingTip,
          note: scene.note,
          createdAt: scene.createdAt.toISOString(),
          updatedAt: scene.updatedAt.toISOString()
        };
      }
      /**
       * 映射 Plot DTO。
       */
      toStoryPlotDto(plot) {
        return {
          id: stringifyEntityId(plot.id),
          sceneId: stringifyEntityId(plot.sceneId),
          sortOrder: plot.sortOrder,
          kind: plot.kind,
          summary: plot.summary,
          effect: plot.effect,
          writingTip: plot.writingTip,
          note: plot.note,
          createdAt: plot.createdAt.toISOString(),
          updatedAt: plot.updatedAt.toISOString()
        };
      }
      /**
       * 规范化 ref target。
       */
      normalizeStoryRefTarget(ref) {
        if (ref.targetKind === "content") {
          return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }
        if (ref.targetKind === "thread") {
          return ref.targetThread ? buildReferenceUri("thread", stringifyEntityId(ref.targetThread.id)) : parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }
        if (ref.targetKind === "scene") {
          return ref.targetScene ? buildReferenceUri("scene", stringifyEntityId(ref.targetScene.id)) : parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }
        if (ref.targetKind === "plot") {
          return ref.targetPlot ? buildReferenceUri("plot", stringifyEntityId(ref.targetPlot.id)) : parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }
        return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
      }
      /**
       * 映射 ref DTO。
       */
      toStoryRefDto(ref) {
        return {
          relation: ref.relation,
          target: this.normalizeStoryRefTarget(ref),
          visibility: ref.visibility,
          note: ref.note
        };
      }
      /**
       * 组装 Scene 的有效 refs。
       */
      buildEffectiveSceneRefs(scene) {
        return scene.refs.map((ref) => ({
          ...this.toStoryRefDto(ref),
          sourceType: "scene",
          sourceId: stringifyEntityId(scene.id)
        }));
      }
      /**
       * 映射不含 refs 的 Thread 详情 DTO。
       */
      toStoryThreadDetailWithoutRefsDto(thread) {
        return {
          ...this.toStoryThreadSummaryDto(thread),
          scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene))
        };
      }
      /**
       * 映射 Scene 详情 DTO。
       */
      toStorySceneDetailDto(scene) {
        return {
          ...this.toStorySceneSummaryDto(scene),
          plots: scene.plots.map((plot) => this.toStoryPlotDto(plot)),
          refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
          effectiveRefs: this.buildEffectiveSceneRefs(scene)
        };
      }
      /**
       * 映射章节剧情 Scene DTO。
       */
      toChapterPlotSceneDto(scene) {
        return {
          id: stringifyEntityId(scene.id),
          threadId: stringifyEntityId(scene.thread.id),
          threadTitle: scene.thread.title,
          threadIsMain: scene.thread.isMainThread,
          chapterPath: scene.chapterPath,
          chapterSortOrder: scene.chapterSortOrder,
          threadSortOrder: scene.threadSortOrder,
          title: scene.title,
          status: scene.status,
          summary: scene.summary,
          purpose: scene.purpose,
          plots: scene.plots.map((plot) => this.toStoryPlotDto(plot))
        };
      }
      /**
       * 映射章节剧情详情 DTO。
       */
      toChapterPlotDetailDto(chapterPath, scenes) {
        return {
          chapterPath,
          scenes: scenes.map((scene) => this.toChapterPlotSceneDto(scene)),
          totalScenes: scenes.length,
          totalPlots: scenes.reduce((sum, scene) => sum + scene.plots.length, 0)
        };
      }
      /**
       * 映射 Workbench Scene DTO。
       */
      toStoryWorkbenchSceneDto(scene) {
        return {
          ...this.toStorySceneSummaryDto(scene),
          plots: scene.plots.map((plot) => this.toStoryPlotDto(plot)),
          refs: scene.refs.map((ref) => this.toStoryRefDto(ref))
        };
      }
      /**
       * 映射 Workbench Thread DTO。
       */
      toStoryWorkbenchThreadDto(thread) {
        return {
          ...this.toStoryThreadSummaryDto(thread),
          scenes: thread.scenes.map((scene) => this.toStoryWorkbenchSceneDto(scene))
        };
      }
      /**
       * 映射 Workbench Phase DTO。
       */
      toStoryWorkbenchPhaseDto(phase) {
        return {
          ...this.toStoryPhaseDto(phase),
          threads: phase.threads.map((thread) => this.toStoryWorkbenchThreadDto(thread))
        };
      }
      /**
       * 组装剧情树 DTO。
       */
      toPlotTreeDto(input) {
        const phases = input.phases.map((phase) => ({
          ...this.toStoryPhaseDto(phase),
          threads: phase.threads.map((thread) => ({
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene))
          }))
        }));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => ({
          ...this.toStoryThreadSummaryDto(thread),
          scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene))
        }));
        return {
          story: this.toStoryDto(input.story),
          phases,
          ungroupedThreads,
          totalPhases: phases.length,
          totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
          totalScenes: phases.reduce((sum, phase) => sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0),
          totalPlots: input.totalPlots
        };
      }
      /**
       * 组装剧本工作台 DTO。
       */
      toPlotWorkbenchDto(input) {
        const phases = input.phases.map((phase) => this.toStoryWorkbenchPhaseDto(phase));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => this.toStoryWorkbenchThreadDto(thread));
        const totalScenes = phases.reduce((sum, phase) => sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0);
        return {
          story: this.toStoryDto(input.story),
          phases,
          ungroupedThreads,
          totalPhases: phases.length,
          totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
          totalScenes,
          totalPlots: input.totalPlots
        };
      }
    };
  }
});

// server/database/locks.ts
async function lockDatabaseKey(prismaClient, key) {
  const lockKey = Math.trunc(key);
  await prismaClient.$executeRawUnsafe(
    `INSERT INTO "DatabaseLock" ("key", "updatedAt") VALUES (${String(lockKey)}, CURRENT_TIMESTAMP) ON CONFLICT("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP`
  );
}
var init_locks = __esm({
  "server/database/locks.ts"() {
    "use strict";
  }
});

// server/plot/repositories/prisma-plot-data.repository.ts
var PrismaPlotDataRepository;
var init_prisma_plot_data_repository = __esm({
  "server/plot/repositories/prisma-plot-data.repository.ts"() {
    "use strict";
    init_locks();
    PrismaPlotDataRepository = class {
      constructor(prisma) {
        this.prisma = prisma;
      }
      /**
       * 查询情节点。
       */
      async findPlotById(plotId) {
        return this.prisma.storyPlot.findUnique({
          where: { id: plotId }
        });
      }
      /**
       * 查询带 storyId 的情节点。
       */
      async findPlotByIdWithStory(plotId) {
        return this.prisma.storyPlot.findUnique({
          where: { id: plotId },
          include: {
            scene: {
              select: {
                storyId: true
              }
            }
          }
        });
      }
      /**
       * 返回 Story 下 plot ID。
       */
      async findPlotIdsByStory(storyId) {
        const plots = await this.prisma.storyPlot.findMany({
          where: {
            scene: { storyId }
          },
          select: { id: true }
        });
        return plots.map((plot) => plot.id);
      }
      /**
       * 创建情节点。
       */
      async createPlot(input) {
        return this.prisma.storyPlot.create({
          data: input
        });
      }
      /**
       * 更新情节点。
       */
      async updatePlot(plotId, data) {
        return this.prisma.storyPlot.update({
          where: { id: plotId },
          data
        });
      }
      /**
       * 删除情节点。
       */
      async deletePlot(plotId) {
        await this.prisma.storyPlot.delete({
          where: { id: plotId }
        });
      }
      /**
       * 查询 Scene 内的 Plot 排序快照。
       */
      async findPlotsByScene(sceneId) {
        return this.prisma.storyPlot.findMany({
          where: { sceneId },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ],
          select: {
            id: true,
            sortOrder: true
          }
        });
      }
      /**
       * 锁定同一 Scene 下的 Plot 排序桶，避免并发创建拿到相同 sortOrder。
       */
      async lockPlotOrderBucket(sceneId) {
        await lockDatabaseKey(this.prisma, sceneId);
      }
      /**
       * 统计 Story 下的 Plot 总数。
       */
      async countPlotsByStory(storyId) {
        return this.prisma.storyPlot.count({
          where: {
            scene: { storyId }
          }
        });
      }
    };
  }
});

// server/plot/repositories/includes.ts
var STORY_SCENE_REF_INCLUDE;
var init_includes = __esm({
  "server/plot/repositories/includes.ts"() {
    "use strict";
    STORY_SCENE_REF_INCLUDE = {
      targetThread: {
        select: {
          id: true,
          name: true
        }
      },
      targetScene: {
        select: {
          id: true
        }
      },
      targetPlot: {
        select: {
          id: true
        }
      }
    };
  }
});

// server/plot/repositories/thread-tags.ts
function normalizeThreadJsonTags(thread) {
  return {
    ...thread,
    tags: normalizeTags(thread.tags)
  };
}
function normalizeTags(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}
var init_thread_tags = __esm({
  "server/plot/repositories/thread-tags.ts"() {
    "use strict";
  }
});

// server/plot/repositories/prisma-scene.repository.ts
var PrismaSceneRepository;
var init_prisma_scene_repository = __esm({
  "server/plot/repositories/prisma-scene.repository.ts"() {
    "use strict";
    init_includes();
    init_thread_tags();
    PrismaSceneRepository = class {
      constructor(prisma) {
        this.prisma = prisma;
      }
      /**
       * 查询场景。
       */
      async findSceneById(sceneId) {
        return this.prisma.storyScene.findUnique({
          where: { id: sceneId }
        });
      }
      /**
       * 查询场景详情。
       */
      async findSceneWithDetailsById(sceneId) {
        const scene = await this.prisma.storyScene.findUnique({
          where: { id: sceneId },
          include: {
            plots: {
              orderBy: [
                { sortOrder: "asc" },
                { id: "asc" }
              ]
            },
            refs: {
              orderBy: [
                { sortOrder: "asc" },
                { id: "asc" }
              ],
              include: STORY_SCENE_REF_INCLUDE
            },
            thread: {
              select: {
                id: true,
                storyId: true,
                storyPhaseId: true,
                sortOrder: true,
                name: true,
                title: true,
                isMainThread: true,
                status: true,
                summary: true,
                tags: true,
                writingTip: true,
                note: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        });
        if (!scene) {
          return null;
        }
        return {
          ...scene,
          thread: normalizeThreadJsonTags(scene.thread)
        };
      }
      /**
       * 查询章节下的 Scene 与 Plot。
       */
      async findChapterScenesWithPlots(chapterPath) {
        return this.prisma.storyScene.findMany({
          where: { chapterPath },
          orderBy: [
            { chapterSortOrder: "asc" },
            { id: "asc" }
          ],
          include: {
            thread: {
              select: {
                id: true,
                title: true,
                isMainThread: true
              }
            },
            plots: {
              orderBy: [
                { sortOrder: "asc" },
                { id: "asc" }
              ]
            }
          }
        });
      }
      /**
       * 返回 Story 下 Scene ID。
       */
      async findSceneIdsByStory(storyId) {
        const scenes = await this.prisma.storyScene.findMany({
          where: { storyId },
          select: { id: true }
        });
        return scenes.map((scene) => scene.id);
      }
      /**
       * 创建场景。
       */
      async createScene(input) {
        return this.prisma.storyScene.create({
          data: input
        });
      }
      /**
       * 更新场景。
       */
      async updateScene(sceneId, data) {
        return this.prisma.storyScene.update({
          where: { id: sceneId },
          data
        });
      }
      /**
       * 删除场景。
       */
      async deleteScene(sceneId) {
        await this.prisma.storyScene.delete({
          where: { id: sceneId }
        });
      }
      /**
       * 全量替换场景 refs。
       */
      async replaceRefs(sceneId, refs) {
        await this.prisma.storySceneRef.deleteMany({
          where: { sceneId }
        });
        if (refs.length === 0) {
          return;
        }
        await this.prisma.storySceneRef.createMany({
          data: refs.map((ref) => ({
            sceneId,
            sortOrder: ref.sortOrder,
            relation: ref.relation,
            rawTarget: ref.rawTarget,
            targetKind: ref.targetKind,
            targetThreadId: ref.targetThreadId,
            targetSceneId: ref.targetSceneId,
            targetPlotId: ref.targetPlotId,
            visibility: ref.visibility,
            note: ref.note
          }))
        });
      }
      /**
       * 查询线程内的 Scene 排序快照。
       */
      async findScenesByThread(threadId) {
        return this.prisma.storyScene.findMany({
          where: { threadId },
          orderBy: [
            { threadSortOrder: "asc" },
            { id: "asc" }
          ],
          select: {
            id: true,
            threadSortOrder: true
          }
        });
      }
      /**
       * 查询章节内的 Scene 排序快照。
       */
      async findScenesByChapter(chapterPath) {
        return this.prisma.storyScene.findMany({
          where: { chapterPath },
          orderBy: [
            { chapterSortOrder: "asc" },
            { id: "asc" }
          ],
          select: {
            id: true,
            chapterSortOrder: true
          }
        });
      }
    };
  }
});

// server/plot/repositories/prisma-story.repository.ts
var PrismaStoryRepository;
var init_prisma_story_repository = __esm({
  "server/plot/repositories/prisma-story.repository.ts"() {
    "use strict";
    PrismaStoryRepository = class {
      constructor(prisma) {
        this.prisma = prisma;
      }
      /**
       * 查询当前 Project SQLite 中的 Story。
       */
      async findStory() {
        return this.prisma.story.findFirst({
          orderBy: { id: "asc" }
        });
      }
      /**
       * 创建当前 Project SQLite 的 Story。
       */
      async createStory(input) {
        return this.prisma.story.create({
          data: {
            title: input.title,
            summary: input.summary
          }
        });
      }
      /**
       * 更新 Story 基本信息。
       */
      async updateStory(storyId, data) {
        return this.prisma.story.update({
          where: { id: storyId },
          data
        });
      }
      /**
       * 查询剧情阶段。
       */
      async findPhaseById(phaseId) {
        return this.prisma.storyPhase.findUnique({
          where: { id: phaseId }
        });
      }
      /**
       * 列出 Story 下的全部阶段。
       */
      async findPhasesByStory(storyId) {
        return this.prisma.storyPhase.findMany({
          where: { storyId },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ]
        });
      }
      /**
       * 返回 Story 下的阶段 ID 集合。
       */
      async findPhaseIdsByStory(storyId) {
        const phases = await this.prisma.storyPhase.findMany({
          where: { storyId },
          select: { id: true }
        });
        return phases.map((phase) => phase.id);
      }
      /**
       * 创建剧情阶段。
       */
      async createPhase(input) {
        return this.prisma.storyPhase.create({
          data: input
        });
      }
      /**
       * 更新剧情阶段。
       */
      async updatePhase(phaseId, data) {
        return this.prisma.storyPhase.update({
          where: { id: phaseId },
          data
        });
      }
      /**
       * 删除剧情阶段。
       */
      async deletePhase(phaseId) {
        await this.prisma.storyPhase.delete({
          where: { id: phaseId }
        });
      }
      /**
       * 按 name 查询阶段，用于唯一性校验。
       */
      async findPhaseByName(storyId, name, excludePhaseId) {
        return this.prisma.storyPhase.findFirst({
          where: {
            storyId,
            name,
            ...excludePhaseId ? {
              NOT: { id: excludePhaseId }
            } : {}
          }
        });
      }
    };
  }
});

// server/plot/repositories/prisma-thread.repository.ts
function normalizeThread(thread) {
  if (!thread) {
    return null;
  }
  return {
    ...thread,
    tags: normalizeTags2(thread.tags)
  };
}
function normalizeThreadWithScenes(thread) {
  return {
    ...thread,
    tags: normalizeTags2(thread.tags)
  };
}
function normalizeTags2(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}
function toThreadData(data) {
  if (!("tags" in data)) {
    return data;
  }
  return {
    ...data,
    tags: normalizeInputTags(data.tags)
  };
}
function normalizeInputTags(value) {
  if (!value) {
    return void 0;
  }
  return JSON.stringify(value.map((tag) => tag.trim()).filter(Boolean));
}
var PrismaThreadRepository;
var init_prisma_thread_repository = __esm({
  "server/plot/repositories/prisma-thread.repository.ts"() {
    "use strict";
    init_includes();
    PrismaThreadRepository = class {
      constructor(prisma) {
        this.prisma = prisma;
      }
      /**
       * 查询线程。
       */
      async findThreadById(threadId) {
        return normalizeThread(await this.prisma.storyThread.findUnique({
          where: { id: threadId }
        }));
      }
      /**
       * 查询带 Scene 摘要的线程详情。
       */
      async findThreadWithScenesById(threadId) {
        const thread = await this.prisma.storyThread.findUnique({
          where: { id: threadId },
          include: {
            scenes: {
              orderBy: [
                { threadSortOrder: "asc" },
                { id: "asc" }
              ]
            }
          }
        });
        return thread ? normalizeThreadWithScenes(thread) : null;
      }
      /**
       * 返回 Story 下线程 ID。
       */
      async findThreadIdsByStory(storyId) {
        const threads = await this.prisma.storyThread.findMany({
          where: { storyId },
          select: { id: true }
        });
        return threads.map((thread) => thread.id);
      }
      /**
       * 按 bucket 列出线程。
       */
      async findThreadsByStoryPhase(storyId, storyPhaseId) {
        const threads = await this.prisma.storyThread.findMany({
          where: {
            storyId,
            storyPhaseId
          },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ]
        });
        return threads.map(normalizeThread);
      }
      /**
       * 按 name 查询线程。
       */
      async findThreadByName(storyId, name, excludeThreadId) {
        return normalizeThread(await this.prisma.storyThread.findFirst({
          where: {
            storyId,
            name,
            ...excludeThreadId ? {
              NOT: { id: excludeThreadId }
            } : {}
          }
        }));
      }
      /**
       * 创建线程。
       */
      async createThread(input) {
        return normalizeThread(await this.prisma.storyThread.create({
          data: toThreadData(input)
        }));
      }
      /**
       * 更新线程。
       */
      async updateThread(threadId, data) {
        return normalizeThread(await this.prisma.storyThread.update({
          where: { id: threadId },
          data: toThreadData(data)
        }));
      }
      /**
       * 删除线程。
       */
      async deleteThread(threadId) {
        await this.prisma.storyThread.delete({
          where: { id: threadId }
        });
      }
      /**
       * 按 name 解析 Thread 引用目标。
       */
      async findThreadTargetByName(storyId, name) {
        return this.prisma.storyThread.findFirst({
          where: {
            storyId,
            name
          },
          select: {
            id: true,
            name: true
          }
        });
      }
      /**
       * 查询未分组线程树。
       */
      async findUngroupedThreads(storyId) {
        const threads = await this.prisma.storyThread.findMany({
          where: {
            storyId,
            storyPhaseId: null
          },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ],
          include: {
            scenes: {
              orderBy: [
                { threadSortOrder: "asc" },
                { id: "asc" }
              ]
            }
          }
        });
        return threads.map(normalizeThreadWithScenes);
      }
      /**
       * 查询未分组线程工作台树。
       */
      async findUngroupedWorkbenchThreads(storyId) {
        const threads = await this.prisma.storyThread.findMany({
          where: {
            storyId,
            storyPhaseId: null
          },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ],
          include: {
            scenes: {
              orderBy: [
                { threadSortOrder: "asc" },
                { id: "asc" }
              ],
              include: {
                plots: {
                  orderBy: [
                    { sortOrder: "asc" },
                    { id: "asc" }
                  ]
                },
                refs: {
                  orderBy: [
                    { sortOrder: "asc" },
                    { id: "asc" }
                  ],
                  include: STORY_SCENE_REF_INCLUDE
                }
              }
            }
          }
        });
        return threads.map(normalizeThreadWithScenes);
      }
      /**
       * 查询阶段树。
       */
      async findPhaseThreadsWithScenes(storyId) {
        const phases = await this.prisma.storyPhase.findMany({
          where: { storyId },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ],
          include: {
            threads: {
              where: { storyId },
              orderBy: [
                { sortOrder: "asc" },
                { id: "asc" }
              ],
              include: {
                scenes: {
                  orderBy: [
                    { threadSortOrder: "asc" },
                    { id: "asc" }
                  ]
                }
              }
            }
          }
        });
        return phases.map((phase) => ({
          ...phase,
          threads: phase.threads.map((thread) => normalizeThreadWithScenes(thread))
        }));
      }
      /**
       * 查询阶段线程工作台树。
       */
      async findWorkbenchPhaseThreads(storyId) {
        const phases = await this.prisma.storyPhase.findMany({
          where: { storyId },
          orderBy: [
            { sortOrder: "asc" },
            { id: "asc" }
          ],
          include: {
            threads: {
              where: { storyId },
              orderBy: [
                { sortOrder: "asc" },
                { id: "asc" }
              ],
              include: {
                scenes: {
                  orderBy: [
                    { threadSortOrder: "asc" },
                    { id: "asc" }
                  ],
                  include: {
                    plots: {
                      orderBy: [
                        { sortOrder: "asc" },
                        { id: "asc" }
                      ]
                    },
                    refs: {
                      orderBy: [
                        { sortOrder: "asc" },
                        { id: "asc" }
                      ],
                      include: STORY_SCENE_REF_INCLUDE
                    }
                  }
                }
              }
            }
          }
        });
        return phases.map((phase) => ({
          ...phase,
          threads: phase.threads.map((thread) => normalizeThreadWithScenes(thread))
        }));
      }
    };
  }
});

// server/plot/http/plot-input.parser.ts
var PlotInputParser;
var init_plot_input_parser = __esm({
  "server/plot/http/plot-input.parser.ts"() {
    "use strict";
    init_novel_chapter();
    PlotInputParser = class {
      /**
       * 解析线程创建输入。
       */
      parseCreateThread(input) {
        return {
          ...input,
          storyPhaseId: parseNullableEntityId("phaseId", input.storyPhaseId)
        };
      }
      /**
       * 解析线程更新输入。
       */
      parseUpdateThread(input) {
        return {
          ...input,
          storyPhaseId: input.storyPhaseId === void 0 ? void 0 : parseNullableEntityId("phaseId", input.storyPhaseId)
        };
      }
      /**
       * 解析线程重排输入。
       */
      parseReorderThreads(input) {
        return input.items.map((item) => ({
          threadId: parseEntityId("threadId", item.threadId),
          storyPhaseId: parseNullableEntityId("phaseId", item.storyPhaseId),
          sortOrder: item.sortOrder
        }));
      }
      /**
       * 解析阶段重排输入。
       */
      parseReorderPhases(input) {
        return input.items.map((item) => ({
          phaseId: parseEntityId("phaseId", item.phaseId),
          sortOrder: item.sortOrder
        }));
      }
      /**
       * 解析场景创建输入。
       */
      parseCreateScene(input) {
        return {
          ...input,
          threadId: parseEntityId("threadId", input.threadId),
          chapterPath: input.chapterPath ?? null,
          refs: input.refs ?? []
        };
      }
      /**
       * 解析场景更新输入。
       */
      parseUpdateScene(input) {
        return {
          ...input,
          threadId: input.threadId === void 0 ? void 0 : parseEntityId("threadId", input.threadId),
          chapterPath: input.chapterPath,
          refs: input.refs
        };
      }
      /**
       * 解析场景重排输入。
       */
      parseReorderScenes(input) {
        return input.items.map((item) => ({
          sceneId: parseEntityId("sceneId", item.sceneId),
          threadId: parseEntityId("threadId", item.threadId),
          chapterPath: item.chapterPath,
          threadSortOrder: item.threadSortOrder,
          chapterSortOrder: item.chapterSortOrder
        }));
      }
      /**
       * 解析情节点创建输入。
       */
      parseCreatePlot(input) {
        return {
          ...input,
          sceneId: parseEntityId("sceneId", input.sceneId)
        };
      }
      /**
       * 解析情节点更新输入。
       */
      parseUpdatePlot(input) {
        return {
          ...input,
          sceneId: input.sceneId === void 0 ? void 0 : parseEntityId("sceneId", input.sceneId)
        };
      }
      /**
       * 解析情节点重排输入。
       */
      parseReorderPlots(input) {
        return input.items.map((item) => ({
          plotId: parseEntityId("plotId", item.plotId),
          sceneId: parseEntityId("sceneId", item.sceneId),
          sortOrder: item.sortOrder
        }));
      }
    };
  }
});

// server/plot/core/errors.ts
import { createError as createError3 } from "h3";
function throwPlotNotFound(message) {
  throw createError3({
    statusCode: 404,
    message
  });
}
function throwPlotBadRequest(message) {
  throw createError3({
    statusCode: 400,
    message
  });
}
var init_errors = __esm({
  "server/plot/core/errors.ts"() {
    "use strict";
  }
});

// server/plot/services/order.service.ts
var OrderService;
var init_order_service = __esm({
  "server/plot/services/order.service.ts"() {
    "use strict";
    init_errors();
    OrderService = class {
      constructor(storyRepository, threadRepository, sceneRepository, plotRepository) {
        this.storyRepository = storyRepository;
        this.threadRepository = threadRepository;
        this.sceneRepository = sceneRepository;
        this.plotRepository = plotRepository;
      }
      /**
       * 读取阶段 bucket 的下一个排序值。
       */
      async getNextPhaseSortOrder(storyId) {
        const phases = await this.storyRepository.findPhasesByStory(storyId);
        const lastPhase = phases.at(-1);
        return lastPhase ? lastPhase.sortOrder + 1 : 0;
      }
      /**
       * 读取线程 bucket 的下一个排序值。
       */
      async getNextThreadSortOrder(storyId, storyPhaseId) {
        const threads = await this.threadRepository.findThreadsByStoryPhase(storyId, storyPhaseId);
        const lastThread = threads.at(-1);
        return lastThread ? lastThread.sortOrder + 1 : 0;
      }
      /**
       * 读取线程内 Scene 的下一个排序值。
       */
      async getNextSceneThreadSortOrder(threadId) {
        const scenes = await this.sceneRepository.findScenesByThread(threadId);
        const lastScene = scenes.at(-1);
        return lastScene ? lastScene.threadSortOrder + 1 : 0;
      }
      /**
       * 读取章节内 Scene 的下一个排序值。
       */
      async getNextSceneChapterSortOrder(chapterPath) {
        if (chapterPath === null) {
          return null;
        }
        const scenes = await this.sceneRepository.findScenesByChapter(chapterPath);
        const lastScene = scenes.at(-1);
        return lastScene?.chapterSortOrder === void 0 || lastScene.chapterSortOrder === null ? 0 : lastScene.chapterSortOrder + 1;
      }
      /**
       * 读取 Scene 内 Plot 的下一个排序值。
       */
      async getNextPlotSortOrder(sceneId) {
        const plots = await this.plotRepository.findPlotsByScene(sceneId);
        const lastPlot = plots.at(-1);
        return lastPlot ? lastPlot.sortOrder + 1 : 0;
      }
      /**
       * 压缩阶段排序。
       */
      async normalizePhases(storyId) {
        const phases = await this.storyRepository.findPhasesByStory(storyId);
        for (const [index, phase] of phases.entries()) {
          if (phase.sortOrder === index) {
            continue;
          }
          await this.storyRepository.updatePhase(phase.id, { sortOrder: index });
        }
      }
      /**
       * 压缩线程 bucket 排序。
       */
      async normalizeThreads(storyId, storyPhaseId) {
        const threads = await this.threadRepository.findThreadsByStoryPhase(storyId, storyPhaseId);
        for (const [index, thread] of threads.entries()) {
          if (thread.sortOrder === index) {
            continue;
          }
          await this.threadRepository.updateThread(thread.id, { sortOrder: index });
        }
      }
      /**
       * 压缩线程内 Scene 排序。
       */
      async normalizeSceneThread(threadId) {
        const scenes = await this.sceneRepository.findScenesByThread(threadId);
        for (const [index, scene] of scenes.entries()) {
          if (scene.threadSortOrder === index) {
            continue;
          }
          await this.sceneRepository.updateScene(scene.id, { threadSortOrder: index });
        }
      }
      /**
       * 压缩章节内 Scene 排序。
       */
      async normalizeSceneChapter(chapterPath) {
        if (chapterPath === null) {
          return;
        }
        const scenes = await this.sceneRepository.findScenesByChapter(chapterPath);
        for (const [index, scene] of scenes.entries()) {
          if (scene.chapterSortOrder === index) {
            continue;
          }
          await this.sceneRepository.updateScene(scene.id, { chapterSortOrder: index });
        }
      }
      /**
       * 压缩 Scene 内 Plot 排序。
       */
      async normalizePlots(sceneId) {
        const plots = await this.plotRepository.findPlotsByScene(sceneId);
        for (const [index, plot] of plots.entries()) {
          if (plot.sortOrder === index) {
            continue;
          }
          await this.plotRepository.updatePlot(plot.id, { sortOrder: index });
        }
      }
      /**
       * 校验阶段重排输入。
       */
      validatePhaseReorderItems(existingPhaseIds, items) {
        this.assertCompleteCoverage(existingPhaseIds, items.map((item) => item.phaseId), "\u5267\u60C5\u9636\u6BB5");
        this.assertContinuousSortOrders(items.map((item) => item.sortOrder), "\u5267\u60C5\u9636\u6BB5");
        return items;
      }
      /**
       * 校验线程重排输入。
       */
      validateThreadReorderItems(existingThreadIds, existingPhaseIds, items) {
        const existingPhaseIdSet = new Set(existingPhaseIds);
        this.assertCompleteCoverage(existingThreadIds, items.map((item) => item.threadId), "\u5267\u60C5\u7EBF\u7A0B");
        for (const item of items) {
          if (item.storyPhaseId !== null && !existingPhaseIdSet.has(item.storyPhaseId)) {
            throwPlotBadRequest(`\u5267\u60C5\u9636\u6BB5 ${item.storyPhaseId} \u4E0D\u5C5E\u4E8E\u5F53\u524D\u5C0F\u8BF4`);
          }
        }
        this.assertGroupedContinuousOrders(
          items,
          (item) => String(item.storyPhaseId),
          (item) => item.sortOrder,
          (groupKey) => groupKey === "null" ? "\u672A\u5206\u7EC4\u7EBF\u7A0B" : `\u5267\u60C5\u9636\u6BB5 ${groupKey} \u4E0B\u7684\u7EBF\u7A0B`
        );
        return items;
      }
      /**
       * 校验场景重排输入。
       */
      validateSceneReorderItems(existingSceneIds, existingThreadIds, items) {
        const existingThreadIdSet = new Set(existingThreadIds);
        this.assertDistinctIds(items.map((item) => item.sceneId), "\u5267\u60C5\u573A\u666F");
        for (const item of items) {
          if (!existingSceneIds.includes(item.sceneId)) {
            throwPlotBadRequest(`\u5267\u60C5\u573A\u666F ${item.sceneId} \u4E0D\u5C5E\u4E8E\u5F53\u524D\u5C0F\u8BF4`);
          }
          if (!existingThreadIdSet.has(item.threadId)) {
            throwPlotBadRequest(`\u5267\u60C5\u7EBF\u7A0B ${item.threadId} \u4E0D\u5C5E\u4E8E\u5F53\u524D\u5C0F\u8BF4`);
          }
          if (item.chapterPath === null && item.chapterSortOrder !== null) {
            throwPlotBadRequest("\u672A\u6302\u5165\u7AE0\u8282\u7684 Scene \u4E0D\u80FD\u63D0\u4F9B chapterSortOrder");
          }
          if (item.chapterPath !== null && item.chapterSortOrder === null) {
            throwPlotBadRequest("\u5DF2\u6302\u5165\u7AE0\u8282\u7684 Scene \u5FC5\u987B\u63D0\u4F9B chapterSortOrder");
          }
        }
        this.assertGroupedContinuousOrders(
          items,
          (item) => String(item.threadId),
          (item) => item.threadSortOrder,
          (groupKey) => `\u5267\u60C5\u7EBF\u7A0B ${groupKey} \u4E0B\u7684 Scene`
        );
        if (items.length === existingSceneIds.length) {
          this.assertGroupedContinuousOrders(
            items.filter((item) => item.chapterPath !== null),
            (item) => String(item.chapterPath),
            (item) => item.chapterSortOrder ?? 0,
            (groupKey) => `\u7AE0\u8282 ${groupKey} \u4E0B\u7684 Scene`
          );
        }
        return items;
      }
      /**
       * 校验 Plot 重排输入。
       */
      validatePlotReorderItems(existingPlotIds, existingSceneIds, items) {
        const existingSceneIdSet = new Set(existingSceneIds);
        this.assertDistinctIds(items.map((item) => item.plotId), "\u60C5\u8282\u70B9");
        for (const item of items) {
          if (!existingPlotIds.includes(item.plotId)) {
            throwPlotBadRequest(`\u60C5\u8282\u70B9 ${item.plotId} \u4E0D\u5C5E\u4E8E\u5F53\u524D\u5C0F\u8BF4`);
          }
        }
        for (const item of items) {
          if (!existingSceneIdSet.has(item.sceneId)) {
            throwPlotBadRequest(`\u5267\u60C5\u573A\u666F ${item.sceneId} \u4E0D\u5C5E\u4E8E\u5F53\u524D\u5C0F\u8BF4`);
          }
        }
        this.assertGroupedContinuousOrders(
          items,
          (item) => String(item.sceneId),
          (item) => item.sortOrder,
          (groupKey) => `\u5267\u60C5\u573A\u666F ${groupKey} \u4E0B\u7684\u60C5\u8282\u70B9`
        );
        return items;
      }
      /**
       * 校验重排集合完整性。
       */
      assertCompleteCoverage(existingIds, inputIds, label) {
        if (existingIds.length !== inputIds.length) {
          throwPlotBadRequest(`\u91CD\u6392\u8BF7\u6C42\u5FC5\u987B\u5305\u542B\u5168\u90E8${label}`);
        }
        this.assertDistinctIds(inputIds, label);
        for (const inputId of inputIds) {
          if (!existingIds.includes(inputId)) {
            throwPlotBadRequest(`${label} ${inputId} \u4E0D\u5C5E\u4E8E\u5F53\u524D\u5C0F\u8BF4`);
          }
        }
      }
      /**
       * 校验 ID 不重复。
       */
      assertDistinctIds(ids, label) {
        if (new Set(ids).size !== ids.length) {
          throwPlotBadRequest(`${label}\u91CD\u6392\u8BF7\u6C42\u4E2D\u5B58\u5728\u91CD\u590D ID`);
        }
      }
      /**
       * 校验排序值连续。
       */
      assertContinuousSortOrders(sortOrders, label) {
        const orderedSortOrders = [...sortOrders].sort((left, right) => left - right);
        for (const [index, value] of orderedSortOrders.entries()) {
          if (value !== index) {
            throwPlotBadRequest(`${label}\u6392\u5E8F\u5FC5\u987B\u4ECE 0 \u5F00\u59CB\u8FDE\u7EED\u9012\u589E`);
          }
        }
      }
      /**
       * 校验分桶排序连续。
       */
      assertGroupedContinuousOrders(items, getGroupKey, getSortOrder, getLabel) {
        const groupedSortOrders = /* @__PURE__ */ new Map();
        for (const item of items) {
          const groupKey = getGroupKey(item);
          const currentSortOrders = groupedSortOrders.get(groupKey) ?? [];
          currentSortOrders.push(getSortOrder(item));
          groupedSortOrders.set(groupKey, currentSortOrders);
        }
        for (const [groupKey, sortOrders] of groupedSortOrders.entries()) {
          this.assertContinuousSortOrders(sortOrders, getLabel(groupKey));
        }
      }
    };
  }
});

// server/workspace-files/content-node-schema.ts
import { toJSONSchema, z as z6 } from "zod";
var WORKSPACE_CONTENT_STATUSES, WORKSPACE_CONTENT_TYPES, FreeObjectSchema, WorkspaceContentStatusSchema, WorkspaceContentTypeSchema, WorkspaceContentRefSchema, WorkspaceRetrievalSchema, WorkspaceInjectSchema, WorkspaceContentStateFrontmatterSchema, WorkspaceGovernanceSchema, WorkspaceContentFrontmatterSchema;
var init_content_node_schema = __esm({
  "server/workspace-files/content-node-schema.ts"() {
    "use strict";
    WORKSPACE_CONTENT_STATUSES = ["draft", "pending", "active", "archived"];
    WORKSPACE_CONTENT_TYPES = ["location", "character", "faction", "item", "rule", "note", "volume", "chapter"];
    FreeObjectSchema = z6.record(z6.string(), z6.unknown()).describe("\u81EA\u7531\u6269\u5C55\u5BF9\u8C61\uFF1B\u7CFB\u7EDF\u4E0D\u6821\u9A8C\u3001\u4E0D\u7F16\u8F91\u3001\u4E0D\u4F9D\u8D56\u3002");
    WorkspaceContentStatusSchema = z6.enum(WORKSPACE_CONTENT_STATUSES).describe("\u5185\u5BB9\u8282\u70B9\u72B6\u6001\uFF1Adraft \u8349\u7A3F\u3001pending \u5F85\u5B9A\u3001active \u5DF2\u786E\u8BA4\u3001archived \u5DF2\u5F52\u6863\u3002");
    WorkspaceContentTypeSchema = z6.enum(WORKSPACE_CONTENT_TYPES).describe("\u5185\u5BB9\u8282\u70B9\u7C7B\u578B\u3002lorebook \u4F7F\u7528 location/character/faction/item/rule/note\uFF0Cmanuscript \u4F7F\u7528 volume/chapter\u3002");
    WorkspaceContentRefSchema = z6.object({
      relation: z6.string().describe("\u5F15\u7528\u5173\u7CFB\u7C7B\u578B\uFF0C\u4F8B\u5982 mentions\u3001foreshadows\u3001depends_on\u3002"),
      target: z6.string().min(1).describe("Markdown \u76F8\u5BF9\u8DEF\u5F84\u3002\u5185\u5BB9\u8282\u70B9\u6307\u5411\u76EE\u5F55\u5E76\u4FDD\u7559\u7ED3\u5C3E `/`\uFF0C\u666E\u901A\u6587\u4EF6\u6307\u5411\u5177\u4F53\u6587\u4EF6\u540D\u3002"),
      note: z6.string().nullable().describe("\u5F15\u7528\u8BF4\u660E\u3002")
    }).describe("\u7ED3\u6784\u5316\u5F15\u7528\u3002");
    WorkspaceRetrievalSchema = z6.object({
      enabled: z6.boolean().describe("\u662F\u5426\u5141\u8BB8\u8BE5\u5185\u5BB9\u8282\u70B9\u8FDB\u5165 AI \u81EA\u52A8\u68C0\u7D22\u5019\u9009\u3002"),
      trigger: z6.string().nullable().describe("\u81EA\u7136\u8BED\u8A00\u89E6\u53D1\u6761\u4EF6\uFF1B\u4E3A\u7A7A\u8868\u793A\u4E0D\u9700\u8981\u989D\u5916\u89E6\u53D1\u5224\u65AD\u3002")
    }).describe("AI \u68C0\u7D22\u5019\u9009\u914D\u7F6E\u3002");
    WorkspaceInjectSchema = z6.object({
      profiles: z6.array(z6.string()).describe("\u76F4\u63A5\u4E0A\u4E0B\u6587\u76EE\u6807 profile key \u5217\u8868\u3002\u53EF\u9009\uFF1Aleader.default \u6216\u7528\u6237\u81EA\u5B9A\u4E49 profile key\u3002inject \u7528\u4E8E\u957F\u671F\u7A33\u5B9A\u3001\u4F4E\u5224\u65AD\u6210\u672C\u7684\u4E0A\u4E0B\u6587\uFF1B\u4EFB\u52A1\u76F8\u5173\u5019\u9009\u53EC\u56DE\u4F7F\u7528 retrieval\u3002"),
      always: z6.boolean().describe("\u5F53\u76EE\u6807 profile \u8FD0\u884C\u4E14 profiles \u547D\u4E2D\u65F6\uFF0C\u662F\u5426\u9ED8\u8BA4\u4F5C\u4E3A\u76F4\u63A5\u4E0A\u4E0B\u6587\u5019\u9009\u3002\u4EC5\u5BF9\u6587\u98CE\u3001\u521B\u4F5C\u8FB9\u754C\u3001\u56FA\u5B9A\u8BFB\u8005\u627F\u8BFA\u7B49\u957F\u671F\u7A33\u5B9A\u7EA6\u675F\u5F00\u542F\uFF1B\u4E34\u65F6\u5267\u60C5\u3001\u5F85\u5B9A\u95EE\u9898\u3001\u7AE0\u8282\u72B6\u6001\u5E94\u4FDD\u6301 false\u3002")
    }).describe("AI profile \u76F4\u63A5\u4E0A\u4E0B\u6587\u914D\u7F6E\uFF1B\u533A\u522B\u4E8E retrieval \u7684\u4EFB\u52A1\u76F8\u5173\u53EC\u56DE\u3002");
    WorkspaceContentStateFrontmatterSchema = z6.looseObject({
      statusNote: z6.string().optional().describe("\u5F53\u524D\u72B6\u6001\u6458\u8981\uFF1B\u7F3A\u7701\u8868\u793A\u672A\u586B\u5199\u3002"),
      updatedAt: z6.string().nullable().optional().describe("\u72B6\u6001\u66F4\u65B0\u65F6\u95F4\uFF1B\u4E3A\u7A7A\u8868\u793A\u672A\u8BB0\u5F55\u3002"),
      knowledge: z6.array(z6.string()).optional().describe("\u8BE5\u72B6\u6001\u6587\u4EF6\u8BB0\u5F55\u7684\u4FE1\u606F\u5DEE\uFF1B\u6BCF\u9879\u4E3A\u81EA\u7136\u8BED\u8A00\uFF0C\u53EF\u5305\u542B Markdown \u5185\u5BB9\u8282\u70B9\u94FE\u63A5\u3002"),
      ext: FreeObjectSchema.optional()
    }).describe("\u5185\u5BB9\u8282\u70B9 state.md \u5F53\u524D\u72B6\u6001 frontmatter\u3002");
    WorkspaceGovernanceSchema = z6.object({
      source: z6.string().describe("\u5185\u5BB9\u6765\u6E90\uFF0C\u4F8B\u5982 manual\u3001imported\u3001generated\u3002"),
      review: z6.string().describe("\u5BA1\u9605\u72B6\u6001\uFF0C\u4F8B\u5982 proposed\u3001reviewed\u3002")
    }).describe("\u6765\u6E90\u4E0E\u5BA1\u9605\u4FE1\u606F\u3002");
    WorkspaceContentFrontmatterSchema = z6.looseObject({
      title: z6.string().describe("\u5185\u5BB9\u8282\u70B9\u663E\u793A\u6807\u9898\u3002"),
      type: WorkspaceContentTypeSchema,
      subtype: z6.string().nullable().describe("\u5185\u5BB9\u8282\u70B9\u7EC6\u5206\u7C7B\u522B\u3002"),
      status: WorkspaceContentStatusSchema,
      icon: z6.string().nullable().describe("Lucide \u56FE\u6807\u540D\u3002"),
      aliases: z6.array(z6.string()).describe("\u522B\u540D\u5217\u8868\u3002"),
      tags: z6.array(z6.string()).describe("\u4E2D\u6587\u77ED\u6807\u7B7E\u5217\u8868\u3002\u6807\u7B7E\u5FC5\u987B\u6709\u660E\u786E\u5206\u7C7B\u610F\u4E49\u3001\u6613\u7406\u89E3\u3001\u53EF\u590D\u7528\uFF1B\u4E0D\u8981\u4E3A\u4E86\u586B\u5B57\u6BB5\u968F\u610F\u8BBE\u7F6E\u6807\u7B7E\u3002"),
      summary: z6.string().describe("\u8282\u70B9\u6458\u8981\u3002"),
      refs: z6.array(WorkspaceContentRefSchema).describe("\u7ED3\u6784\u5316\u5F15\u7528\u5217\u8868\u3002"),
      retrieval: WorkspaceRetrievalSchema,
      inject: WorkspaceInjectSchema,
      governance: WorkspaceGovernanceSchema,
      ext: FreeObjectSchema
    }).describe("\u6807\u51C6\u5185\u5BB9\u8282\u70B9 frontmatter\u3002");
  }
});

// server/workspace-files/workspace-files.ts
import fs6 from "node:fs/promises";
import path7 from "node:path";
import YAML from "yaml";
function resolveWorkspaceRoot(rootInput = DEFAULT_WORKSPACE_ROOT) {
  return resolveWorkspacePath(process.cwd(), rootInput);
}
function resolveWorkspacePath(root, inputPath) {
  const baseRoot = path7.resolve(root);
  const resolved = path7.isAbsolute(inputPath) ? path7.resolve(inputPath) : path7.resolve(baseRoot, inputPath);
  if (resolved !== baseRoot && !resolved.startsWith(`${baseRoot}${path7.sep}`)) {
    throw new Error(`Path is outside the workspace root: ${inputPath}`);
  }
  return resolved;
}
function toWorkspaceDisplayPath(root, absolutePath, isDirectory2 = false) {
  const relativePath = path7.relative(root, absolutePath).split(path7.sep).join("/");
  if (!relativePath) {
    return isDirectory2 ? "./" : ".";
  }
  return isDirectory2 ? `${relativePath}/` : relativePath;
}
function isEditableTextPath(filePath) {
  return !BINARY_EXTENSIONS.has(path7.extname(filePath).toLowerCase());
}
async function statWorkspacePath(rootInput, filePath) {
  const root = resolveWorkspaceRoot(rootInput);
  const absolutePath = resolveWorkspacePath(root, filePath);
  return buildWorkspaceNode(root, absolutePath, {
    lorebookRoot: DEFAULT_LOREBOOK_ROOT,
    chapterRoot: DEFAULT_CHAPTER_ROOT,
    iconConfig: await readWorkspaceIconConfig(root)
  });
}
function parseMarkdownDocument(content) {
  const match = content.match(FRONTMATTER_PATTERN2);
  if (!match) {
    return {
      frontmatter: {},
      body: content,
      error: null
    };
  }
  const rawFrontmatter = match[1] ?? "";
  try {
    const parsed = YAML.parse(rawFrontmatter, { logLevel: "silent" });
    return {
      frontmatter: isPlainObject(parsed) ? parsed : {},
      body: content.slice(match[0].length),
      error: isPlainObject(parsed) || parsed === null ? null : "frontmatter \u5FC5\u987B\u662F\u5BF9\u8C61"
    };
  } catch (error) {
    return {
      frontmatter: {},
      body: content.slice(match[0].length),
      error: error instanceof Error ? error.message : "frontmatter \u89E3\u6790\u5931\u8D25"
    };
  }
}
function extractWorkspaceRefs(content, frontmatter = {}) {
  const refs = /* @__PURE__ */ new Set();
  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    const target = match[2]?.trim();
    if (target && isWorkspaceReferenceTarget(target)) {
      refs.add(target);
    }
  }
  for (const ref of readStructuredRefTargets(frontmatter.refs)) {
    refs.add(ref);
  }
  return [...refs];
}
function isWorkspaceReferenceTarget(target) {
  const normalizedTarget = stripReferenceFragment(target.trim());
  if (!normalizedTarget) {
    return false;
  }
  if (normalizedTarget.startsWith("/")) {
    return false;
  }
  if (EXTERNAL_REFERENCE_PATTERN.test(normalizedTarget)) {
    return false;
  }
  if (SCHEME_REFERENCE_PATTERN.test(normalizedTarget)) {
    return true;
  }
  return true;
}
function readStructuredRefTargets(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const targets = [];
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.target !== "string") {
      continue;
    }
    const target = item.target.trim();
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}
async function buildWorkspaceNode(root, absolutePath, options) {
  const stat = await fs6.stat(absolutePath);
  const isDirectory2 = stat.isDirectory();
  const relativePath = toWorkspaceDisplayPath(root, absolutePath, isDirectory2);
  const indexPath = isDirectory2 ? path7.join(absolutePath, "index.md") : null;
  const hasIndex = indexPath ? await pathExists(indexPath) : false;
  const contentDirectoryNode = isDirectory2 && hasIndex;
  const contentIndexNode = !isDirectory2 && path7.basename(relativePath).toLowerCase() === "index.md";
  const contentNode = contentDirectoryNode || contentIndexNode;
  const metadataPath = contentDirectoryNode && indexPath ? indexPath : absolutePath;
  const editable = !isDirectory2 && isEditableTextPath(absolutePath);
  let frontmatter = {};
  let frontmatterError = null;
  let body = "";
  let refs = [];
  let state = null;
  if ((contentDirectoryNode || editable) && await pathExists(metadataPath)) {
    try {
      if (isEditableTextPath(metadataPath)) {
        const content = await fs6.readFile(metadataPath, "utf-8");
        const parsed = parseMarkdownDocument(content);
        frontmatter = parsed.frontmatter;
        frontmatterError = parsed.error;
        body = parsed.body;
        refs = extractWorkspaceRefs(content, frontmatter);
      }
    } catch (error) {
      frontmatterError = error instanceof Error ? error.message : "\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25";
    }
  }
  if (contentDirectoryNode) {
    state = await readWorkspaceContentState(root, absolutePath);
  }
  const entryType = inferEntryType({
    relativePath,
    frontmatter,
    lorebookRoot: options.lorebookRoot,
    chapterRoot: options.chapterRoot,
    contentNode
  });
  return {
    mode: formatMode(stat, isDirectory2),
    entryType,
    icon: resolveWorkspaceIcon({
      relativePath,
      absolutePath,
      isDirectory: isDirectory2,
      editable,
      contentNode,
      entryType,
      frontmatter,
      config: options.iconConfig
    }),
    status: typeof frontmatter.status === "string" ? frontmatter.status : null,
    words: body.trim().length,
    refs,
    path: relativePath,
    absolutePath,
    isDirectory: isDirectory2,
    hasIndex,
    contentNode,
    summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
    title: typeof frontmatter.title === "string" ? frontmatter.title : "",
    frontmatter,
    frontmatterError,
    state,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    editable
  };
}
async function readWorkspaceContentState(root, contentDirectoryPath) {
  const statePath = path7.join(contentDirectoryPath, "state.md");
  if (!await pathExists(statePath)) {
    return null;
  }
  try {
    const content = await fs6.readFile(statePath, "utf-8");
    const parsed = parseMarkdownDocument(content);
    return {
      path: toWorkspaceDisplayPath(root, statePath),
      absolutePath: statePath,
      exists: true,
      frontmatter: parsed.frontmatter,
      frontmatterError: parsed.error,
      body: parsed.body,
      words: parsed.body.trim().length
    };
  } catch (error) {
    return {
      path: toWorkspaceDisplayPath(root, statePath),
      absolutePath: statePath,
      exists: true,
      frontmatter: {},
      frontmatterError: error instanceof Error ? error.message : "\u72B6\u6001\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25",
      body: "",
      words: 0
    };
  }
}
function inferEntryType(input) {
  if (!input.contentNode) {
    return null;
  }
  if (typeof input.frontmatter.type === "string" && input.frontmatter.type.trim()) {
    return input.frontmatter.type.trim();
  }
  const segments = input.relativePath.split("/").filter(Boolean);
  const lorebookRoot = trimSlashes(input.lorebookRoot);
  const chapterRoot = trimSlashes(input.chapterRoot);
  if (segments.length === 2 && segments[1]?.toLowerCase() === "index.md") {
    return null;
  }
  if (segments[0] === lorebookRoot && segments[1]) {
    return segments[1];
  }
  if (segments[0] === chapterRoot && input.relativePath.endsWith("/")) {
    return segments.length === 2 ? "volume" : "chapter";
  }
  if (segments[0] === chapterRoot && input.relativePath.endsWith(".md")) {
    if (path7.basename(input.relativePath).toLowerCase() === "index.md" && segments.length === 3) {
      return "volume";
    }
    return "chapter";
  }
  return null;
}
function resolveWorkspaceIcon(input) {
  const explicitIcon = readIconName(input.frontmatter.icon);
  if (explicitIcon) {
    return explicitIcon;
  }
  if (input.entryType && input.config.entryTypes[input.entryType]) {
    return input.config.entryTypes[input.entryType] ?? null;
  }
  const baseName = path7.basename(input.relativePath.replace(/\/$/, ""));
  if (input.isDirectory && input.config.directories[baseName]) {
    return input.config.directories[baseName] ?? null;
  }
  const extension = path7.extname(input.absolutePath).toLowerCase();
  if (!input.isDirectory && input.config.extensions[extension]) {
    return input.config.extensions[extension] ?? null;
  }
  if (input.contentNode && input.config.defaults.contentNode) {
    return input.config.defaults.contentNode;
  }
  if (input.isDirectory) {
    return input.config.defaults.directory ?? null;
  }
  if (extension === ".md") {
    return input.config.defaults.markdown ?? null;
  }
  if (input.editable) {
    return input.config.defaults.text ?? null;
  }
  return input.config.defaults.file ?? null;
}
async function readWorkspaceIconConfig(root) {
  const configPath = path7.join(root, ".nbook", "icons.json");
  const defaultConfig = createDefaultWorkspaceIconConfig();
  if (!await pathExists(configPath)) {
    return defaultConfig;
  }
  try {
    const content = await fs6.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isPlainObject(parsed)) {
      return defaultConfig;
    }
    return {
      defaults: { ...defaultConfig.defaults, ...readStringMap(parsed.defaults) },
      directories: { ...defaultConfig.directories, ...readStringMap(parsed.directories) },
      extensions: { ...defaultConfig.extensions, ...normalizeExtensionIconMap(readStringMap(parsed.extensions)) },
      entryTypes: { ...defaultConfig.entryTypes, ...readStringMap(parsed.entryTypes) }
    };
  } catch {
    return defaultConfig;
  }
}
function createDefaultWorkspaceIconConfig() {
  return {
    defaults: {
      contentNode: "notebook-tabs",
      directory: "folder",
      file: "file-question",
      markdown: "file-text",
      text: "file"
    },
    directories: {
      lorebook: "library",
      manuscript: "book-open-text"
    },
    extensions: {
      ".md": "file-text",
      ".txt": "file"
    },
    entryTypes: {
      chapter: "book-open-text",
      character: "user-round",
      faction: "landmark",
      item: "package",
      location: "map-pinned",
      note: "scroll-text",
      rule: "book-key",
      volume: "library-big"
    }
  };
}
function readStringMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const iconName = readIconName(item);
    if (key.trim() && iconName) {
      result[key.trim()] = iconName;
    }
  }
  return result;
}
function normalizeExtensionIconMap(value) {
  return Object.fromEntries(Object.entries(value).map(([extension, icon]) => {
    const normalizedExtension = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    return [normalizedExtension, icon];
  }));
}
function readIconName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const iconName = value.trim().replace(/^i-lucide-/i, "").replace(/^lucide:/i, "");
  return iconName ? iconName : null;
}
function stripReferenceFragment(target) {
  const queryIndex = target.search(/[?#]/);
  return queryIndex >= 0 ? target.slice(0, queryIndex) : target;
}
async function pathExists(filePath) {
  try {
    await fs6.access(filePath);
    return true;
  } catch {
    return false;
  }
}
function formatMode(stat, isDirectory2) {
  const prefix = isDirectory2 ? "d" : "-";
  const mode = Number(stat.mode);
  const bits = [
    mode & 256 ? "r" : "-",
    mode & 128 ? "w" : "-",
    mode & 64 ? "x" : "-",
    mode & 32 ? "r" : "-",
    mode & 16 ? "w" : "-",
    mode & 8 ? "x" : "-",
    mode & 4 ? "r" : "-",
    mode & 2 ? "w" : "-",
    mode & 1 ? "x" : "-"
  ];
  return `${prefix}${bits.join("")}`;
}
function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, "");
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
var FRONTMATTER_PATTERN2, MARKDOWN_LINK_PATTERN, EXTERNAL_REFERENCE_PATTERN, SCHEME_REFERENCE_PATTERN, MAX_TEXT_FILE_BYTES, BINARY_EXTENSIONS, DEFAULT_LOREBOOK_ROOT, DEFAULT_CHAPTER_ROOT, DEFAULT_WORKSPACE_ROOT;
var init_workspace_files = __esm({
  "server/workspace-files/workspace-files.ts"() {
    "use strict";
    init_content_node_schema();
    init_content_node_schema();
    FRONTMATTER_PATTERN2 = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
    MARKDOWN_LINK_PATTERN = /(^|[^!])\[[^\]]+\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
    EXTERNAL_REFERENCE_PATTERN = /^(?:https?:|mailto:|tel:|#)/i;
    SCHEME_REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
    MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
    BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
      ".7z",
      ".avi",
      ".avif",
      ".bin",
      ".bmp",
      ".bz2",
      ".class",
      ".db",
      ".dll",
      ".doc",
      ".docx",
      ".dylib",
      ".eot",
      ".exe",
      ".flac",
      ".gif",
      ".gz",
      ".ico",
      ".jar",
      ".jpeg",
      ".jpg",
      ".m4a",
      ".mkv",
      ".mov",
      ".mp3",
      ".mp4",
      ".ogg",
      ".otf",
      ".pdf",
      ".png",
      ".ppt",
      ".pptx",
      ".psd",
      ".pyc",
      ".rar",
      ".sqlite",
      ".sqlite3",
      ".so",
      ".tar",
      ".tgz",
      ".ttf",
      ".wasm",
      ".wav",
      ".webm",
      ".webp",
      ".woff",
      ".woff2",
      ".xls",
      ".xlsx",
      ".xz",
      ".zip",
      ".zst"
    ]);
    DEFAULT_LOREBOOK_ROOT = "lorebook";
    DEFAULT_CHAPTER_ROOT = "manuscript";
    DEFAULT_WORKSPACE_ROOT = "workspace";
  }
});

// server/plot/services/plot-scope.guard.ts
function normalizeChapterPathForProject(projectPath, chapterPath) {
  const normalizedProjectPath = projectPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const projectSlug = normalizedProjectPath.split("/").filter(Boolean)[1];
  let normalized = chapterPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (projectSlug && normalized.startsWith(`workspace/${projectSlug}/`)) {
    normalized = normalized.slice(`workspace/${projectSlug}/`.length);
  } else if (projectSlug && normalized.startsWith(`${projectSlug}/`)) {
    normalized = normalized.slice(`${projectSlug}/`.length);
  } else {
    normalized = normalized.replace(/^workspace\//, "");
  }
  return normalized;
}
var PlotScopeGuard;
var init_plot_scope_guard = __esm({
  "server/plot/services/plot-scope.guard.ts"() {
    "use strict";
    init_workspace_files();
    init_errors();
    PlotScopeGuard = class {
      constructor(storyRepository, threadRepository, sceneRepository, plotRepository) {
        this.storyRepository = storyRepository;
        this.threadRepository = threadRepository;
        this.sceneRepository = sceneRepository;
        this.plotRepository = plotRepository;
      }
      /**
       * 校验阶段属于当前 Story。
       */
      async assertPhase(storyId, phaseId) {
        const phase = await this.storyRepository.findPhaseById(phaseId);
        if (!phase || phase.storyId !== storyId) {
          throwPlotNotFound("\u5267\u60C5\u9636\u6BB5\u4E0D\u5B58\u5728");
        }
        return phase;
      }
      /**
       * 校验线程属于当前 Story。
       */
      async assertThread(storyId, threadId) {
        const thread = await this.threadRepository.findThreadById(threadId);
        if (!thread || thread.storyId !== storyId) {
          throwPlotNotFound("\u5267\u60C5\u7EBF\u7A0B\u4E0D\u5B58\u5728");
        }
        return thread;
      }
      /**
       * 校验场景属于当前 Story。
       */
      async assertScene(storyId, sceneId) {
        const scene = await this.sceneRepository.findSceneById(sceneId);
        if (!scene || scene.storyId !== storyId) {
          throwPlotNotFound("\u5267\u60C5\u573A\u666F\u4E0D\u5B58\u5728");
        }
        return scene;
      }
      /**
       * 校验情节点属于当前 Story。
       */
      async assertPlot(storyId, plotId) {
        const plot = await this.plotRepository.findPlotByIdWithStory(plotId);
        if (!plot || plot.scene.storyId !== storyId) {
          throwPlotNotFound("\u60C5\u8282\u70B9\u4E0D\u5B58\u5728");
        }
        return plot;
      }
      /**
       * 校验章节路径属于当前 Project Workspace。
       */
      async assertChapterPath(projectPath, chapterPath) {
        const normalized = normalizeChapterPathForProject(projectPath, chapterPath);
        if (!normalized) {
          throwPlotBadRequest("chapterPath \u4E0D\u80FD\u4E3A\u7A7A");
        }
        if (!normalized.startsWith("manuscript/")) {
          throwPlotBadRequest("chapterPath \u5FC5\u987B\u4F4D\u4E8E\u5F53\u524D Project Workspace \u7684 manuscript/ \u4E0B\uFF1B\u53EF\u4F20 manuscript/...\uFF0C\u4E5F\u53EF\u4F20 project-slug/manuscript/... \u6216 workspace/project-slug/manuscript/...");
        }
        if (!normalized.endsWith("/")) {
          throwPlotBadRequest("chapterPath \u5FC5\u987B\u6307\u5411\u76EE\u5F55\u8DEF\u5F84\u5E76\u4EE5 / \u7ED3\u5C3E");
        }
        const node = await statWorkspacePath(projectPath, normalized).catch(() => null);
        if (!node || !node.isDirectory || !node.contentNode || node.entryType !== "chapter") {
          if (node?.isDirectory && node.contentNode && node.entryType === "volume") {
            throwPlotBadRequest("chapterPath \u6307\u5411\u7684\u662F\u5377\u76EE\u5F55\uFF0C\u4E0D\u662F\u7AE0\u8282\u76EE\u5F55\uFF1B\u8BF7\u4F20\u66F4\u6DF1\u4E00\u5C42\u7684\u7AE0\u8282 content-node\uFF0C\u4F8B\u5982 manuscript/<volume>/<chapter>/");
          }
          throwPlotNotFound("\u7AE0\u8282\u4E0D\u5B58\u5728\uFF1BchapterPath \u5FC5\u987B\u6307\u5411\u5F53\u524D Project Workspace \u4E2D\u771F\u5B9E\u5B58\u5728\u3001\u5305\u542B index.md\u3001\u7C7B\u578B\u4E3A chapter \u7684 manuscript \u76EE\u5F55");
        }
        return normalized;
      }
      /**
       * 校验阶段 name 唯一。
       */
      async assertPhaseNameUnique(storyId, name, excludePhaseId) {
        const phase = await this.storyRepository.findPhaseByName(storyId, name, excludePhaseId);
        if (phase) {
          throwPlotBadRequest(`\u5267\u60C5\u9636\u6BB5 name \u5DF2\u5B58\u5728\uFF1A${name}`);
        }
      }
      /**
       * 校验线程 name 唯一。
       */
      async assertThreadNameUnique(storyId, name, excludeThreadId) {
        const thread = await this.threadRepository.findThreadByName(storyId, name, excludeThreadId);
        if (thread) {
          throwPlotBadRequest(`\u5267\u60C5\u7EBF\u7A0B name \u5DF2\u5B58\u5728\uFF1A${name}`);
        }
      }
      /**
       * 返回 Story 下的阶段 ID。
       */
      async listPhaseIds(storyId) {
        return this.storyRepository.findPhaseIdsByStory(storyId);
      }
      /**
       * 返回 Story 下的线程 ID。
       */
      async listThreadIds(storyId) {
        return this.threadRepository.findThreadIdsByStory(storyId);
      }
    };
  }
});

// server/plot/services/story.service.ts
var StoryService;
var init_story_service = __esm({
  "server/plot/services/story.service.ts"() {
    "use strict";
    init_plot_dto_assembler();
    init_order_service();
    init_plot_scope_guard();
    init_project_workspace();
    StoryService = class {
      constructor(storyRepository, threadRepository, plotRepository, orderService, assembler, scopeGuard) {
        this.storyRepository = storyRepository;
        this.threadRepository = threadRepository;
        this.plotRepository = plotRepository;
        this.orderService = orderService;
        this.assembler = assembler;
        this.scopeGuard = scopeGuard;
      }
      /**
       * 确保当前 Project SQLite 已有唯一 Story。
       */
      async ensureStory(projectPath) {
        const existing = await this.storyRepository.findStory();
        if (existing) {
          return existing;
        }
        const manifest = await readProjectManifest(projectPath);
        return this.storyRepository.createStory({
          title: manifest.title,
          summary: manifest.summary
        });
      }
      /**
       * 查询 Story DTO。
       */
      async getStoryDto(projectPath) {
        const story = await this.ensureStory(projectPath);
        return this.assembler.toStoryDto(story);
      }
      /**
       * 更新 Story。
       */
      async updateStory(projectPath, patch) {
        const story = await this.ensureStory(projectPath);
        const updatedStory = await this.storyRepository.updateStory(story.id, {
          title: patch.title,
          summary: patch.summary,
          note: patch.note
        });
        return this.assembler.toStoryDto(updatedStory);
      }
      /**
       * 读取剧情树。
       */
      async getPlotTree(projectPath) {
        const story = await this.ensureStory(projectPath);
        const [phases, ungroupedThreads, totalPlots] = await Promise.all([
          this.threadRepository.findPhaseThreadsWithScenes(story.id),
          this.threadRepository.findUngroupedThreads(story.id),
          this.plotRepository.countPlotsByStory(story.id)
        ]);
        return this.assembler.toPlotTreeDto({
          story,
          phases,
          ungroupedThreads,
          totalPlots
        });
      }
      /**
       * 读取剧本工作台聚合数据。
       */
      async getPlotWorkbench(projectPath) {
        const story = await this.ensureStory(projectPath);
        const [phases, ungroupedThreads, totalPlots] = await Promise.all([
          this.threadRepository.findWorkbenchPhaseThreads(story.id),
          this.threadRepository.findUngroupedWorkbenchThreads(story.id),
          this.plotRepository.countPlotsByStory(story.id)
        ]);
        return this.assembler.toPlotWorkbenchDto({
          story,
          phases,
          ungroupedThreads,
          totalPlots
        });
      }
      /**
       * 查询剧情阶段详情。
       */
      async getStoryPhaseDto(projectPath, phaseId) {
        const story = await this.ensureStory(projectPath);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);
        return this.assembler.toStoryPhaseDto(phase);
      }
      /**
       * 创建剧情阶段。
       */
      async createStoryPhase(projectPath, input) {
        const story = await this.ensureStory(projectPath);
        await this.scopeGuard.assertPhaseNameUnique(story.id, input.name);
        const phase = await this.storyRepository.createPhase({
          storyId: story.id,
          sortOrder: await this.orderService.getNextPhaseSortOrder(story.id),
          name: input.name,
          title: input.title,
          summary: input.summary ?? "",
          note: input.note ?? null
        });
        return this.assembler.toStoryPhaseDto(phase);
      }
      /**
       * 更新剧情阶段。
       */
      async updateStoryPhase(projectPath, phaseId, patch) {
        const story = await this.ensureStory(projectPath);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);
        if (patch.name !== void 0 && patch.name !== phase.name) {
          await this.scopeGuard.assertPhaseNameUnique(story.id, patch.name, phase.id);
        }
        const updatedPhase = await this.storyRepository.updatePhase(phase.id, {
          name: patch.name,
          title: patch.title,
          summary: patch.summary,
          note: patch.note
        });
        return this.assembler.toStoryPhaseDto(updatedPhase);
      }
      /**
       * 删除剧情阶段。
       */
      async deleteStoryPhase(projectPath, phaseId) {
        const story = await this.ensureStory(projectPath);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);
        const phaseThreads = await this.threadRepository.findThreadsByStoryPhase(story.id, phase.id);
        let nextSortOrder = await this.orderService.getNextThreadSortOrder(story.id, null);
        for (const thread of phaseThreads) {
          await this.threadRepository.updateThread(thread.id, {
            storyPhaseId: null,
            sortOrder: nextSortOrder
          });
          nextSortOrder += 1;
        }
        await this.storyRepository.deletePhase(phase.id);
        await this.orderService.normalizePhases(story.id);
      }
      /**
       * 批量重排阶段。
       */
      async reorderStoryPhases(projectPath, items) {
        const story = await this.ensureStory(projectPath);
        const existingPhaseIds = await this.scopeGuard.listPhaseIds(story.id);
        const parsedItems = this.orderService.validatePhaseReorderItems(existingPhaseIds, items);
        for (const item of parsedItems) {
          await this.storyRepository.updatePhase(item.phaseId, { sortOrder: item.sortOrder });
        }
        return this.getPlotTree(projectPath);
      }
    };
  }
});

// server/plot/services/plot.service.ts
var PlotService;
var init_plot_service = __esm({
  "server/plot/services/plot.service.ts"() {
    "use strict";
    init_plot_dto_assembler();
    init_errors();
    init_order_service();
    init_plot_scope_guard();
    init_story_service();
    PlotService = class {
      constructor(plotRepository, sceneRepository, storyService, scopeGuard, orderService, assembler) {
        this.plotRepository = plotRepository;
        this.sceneRepository = sceneRepository;
        this.storyService = storyService;
        this.scopeGuard = scopeGuard;
        this.orderService = orderService;
        this.assembler = assembler;
      }
      /**
       * 查询情节点详情。
       */
      async getStoryPlotDto(projectPath, plotId) {
        const story = await this.storyService.ensureStory(projectPath);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        return this.assembler.toStoryPlotDto(plot);
      }
      /**
       * 创建情节点。
       */
      async createStoryPlot(projectPath, input) {
        const story = await this.storyService.ensureStory(projectPath);
        await this.scopeGuard.assertScene(story.id, input.sceneId);
        await this.plotRepository.lockPlotOrderBucket(input.sceneId);
        const plot = await this.plotRepository.createPlot({
          sceneId: input.sceneId,
          sortOrder: await this.orderService.getNextPlotSortOrder(input.sceneId),
          kind: input.kind,
          summary: input.summary ?? "",
          effect: input.effect ?? null,
          writingTip: input.writingTip ?? null,
          note: input.note ?? null
        });
        return this.assembler.toStoryPlotDto(plot);
      }
      /**
       * 更新情节点。
       */
      async updateStoryPlot(projectPath, plotId, patch) {
        const story = await this.storyService.ensureStory(projectPath);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        const nextSceneId = patch.sceneId === void 0 ? plot.sceneId : patch.sceneId;
        const sceneChanged = nextSceneId !== plot.sceneId;
        if (sceneChanged) {
          await this.scopeGuard.assertScene(story.id, nextSceneId);
        }
        const updatedPlot = await this.plotRepository.updatePlot(plot.id, {
          sceneId: nextSceneId,
          sortOrder: sceneChanged ? await this.orderService.getNextPlotSortOrder(nextSceneId) : void 0,
          kind: patch.kind,
          summary: patch.summary,
          effect: patch.effect,
          writingTip: patch.writingTip,
          note: patch.note
        });
        if (sceneChanged) {
          await this.orderService.normalizePlots(plot.sceneId);
        }
        return this.assembler.toStoryPlotDto(updatedPlot);
      }
      /**
       * 删除情节点。
       */
      async deleteStoryPlot(projectPath, plotId) {
        const story = await this.storyService.ensureStory(projectPath);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        await this.plotRepository.deletePlot(plot.id);
        await this.orderService.normalizePlots(plot.sceneId);
      }
      /**
       * 批量重排情节点。
       */
      async reorderStoryPlots(projectPath, items) {
        const story = await this.storyService.ensureStory(projectPath);
        const [existingPlotIds, existingSceneIds] = await Promise.all([
          this.plotRepository.findPlotIdsByStory(story.id),
          this.sceneRepository.findSceneIdsByStory(story.id)
        ]);
        const parsedItems = this.orderService.validatePlotReorderItems(existingPlotIds, existingSceneIds, items);
        const affectedSceneIds = new Set(parsedItems.map((item) => item.sceneId));
        for (const sceneId of affectedSceneIds) {
          const existingScenePlotIds = (await this.plotRepository.findPlotsByScene(sceneId)).map((plot) => plot.id);
          const inputScenePlotIds = parsedItems.filter((item) => item.sceneId === sceneId).map((item) => item.plotId);
          if (existingScenePlotIds.length !== inputScenePlotIds.length || existingScenePlotIds.some((plotId) => !inputScenePlotIds.includes(plotId))) {
            throwPlotBadRequest(`\u5267\u60C5\u573A\u666F ${sceneId} \u4E0B\u7684 Plot \u91CD\u6392\u5FC5\u987B\u8986\u76D6\u5F53\u524D Scene \u7684\u5168\u90E8 Plot`);
          }
        }
        for (const sceneId of affectedSceneIds) {
          await this.plotRepository.lockPlotOrderBucket(sceneId);
        }
        for (const [index, item] of parsedItems.entries()) {
          await this.plotRepository.updatePlot(item.plotId, {
            sceneId: item.sceneId,
            sortOrder: -(index + 1)
          });
        }
        for (const item of parsedItems) {
          await this.plotRepository.updatePlot(item.plotId, {
            sortOrder: item.sortOrder
          });
        }
        return this.storyService.getPlotTree(projectPath);
      }
    };
  }
});

// server/plot/services/ref-resolver.service.ts
var RefResolverService;
var init_ref_resolver_service = __esm({
  "server/plot/services/ref-resolver.service.ts"() {
    "use strict";
    init_errors();
    init_plot_scope_guard();
    init_reference_core();
    RefResolverService = class {
      constructor(threadRepository, scopeGuard) {
        this.threadRepository = threadRepository;
        this.scopeGuard = scopeGuard;
      }
      /**
       * 解析 refs。
       */
      async resolveRefs(storyId, refs) {
        this.assertDistinctRefs(refs);
        const resolvedRefs = [];
        for (const [index, ref] of refs.entries()) {
          const normalizedTarget = ref.target.trim();
          const parsedTarget = parseStructuredReferenceTarget(normalizedTarget);
          if (!parsedTarget) {
            throwPlotBadRequest(`\u4E0D\u652F\u6301\u7684\u5F15\u7528\u76EE\u6807\uFF1A${normalizedTarget}`);
          }
          if (parsedTarget.kind === "content") {
            resolvedRefs.push({
              sortOrder: index,
              relation: ref.relation,
              rawTarget: parsedTarget.canonicalTarget,
              targetKind: "content",
              targetThreadId: null,
              targetSceneId: null,
              targetPlotId: null,
              visibility: ref.visibility,
              note: ref.note
            });
            continue;
          }
          if (parsedTarget.kind === "thread") {
            const thread = /^\d+$/.test(parsedTarget.targetId) ? await this.scopeGuard.assertThread(storyId, Number.parseInt(parsedTarget.targetId, 10)) : await this.threadRepository.findThreadTargetByName(storyId, parsedTarget.targetId);
            if (!thread) {
              throwPlotBadRequest(`\u5F15\u7528\u76EE\u6807\u4E0D\u5B58\u5728\uFF1A${normalizedTarget}`);
            }
            resolvedRefs.push({
              sortOrder: index,
              relation: ref.relation,
              rawTarget: buildReferenceUri("thread", String(thread.id)),
              targetKind: "thread",
              targetThreadId: thread.id,
              targetSceneId: null,
              targetPlotId: null,
              visibility: ref.visibility,
              note: ref.note
            });
            continue;
          }
          if (parsedTarget.kind === "scene" && /^\d+$/.test(parsedTarget.targetId)) {
            const scene = await this.scopeGuard.assertScene(storyId, Number.parseInt(parsedTarget.targetId, 10));
            resolvedRefs.push({
              sortOrder: index,
              relation: ref.relation,
              rawTarget: buildReferenceUri("scene", String(scene.id)),
              targetKind: "scene",
              targetThreadId: null,
              targetSceneId: scene.id,
              targetPlotId: null,
              visibility: ref.visibility,
              note: ref.note
            });
            continue;
          }
          if (parsedTarget.kind === "plot" && /^\d+$/.test(parsedTarget.targetId)) {
            const plot = await this.scopeGuard.assertPlot(storyId, Number.parseInt(parsedTarget.targetId, 10));
            resolvedRefs.push({
              sortOrder: index,
              relation: ref.relation,
              rawTarget: buildReferenceUri("plot", String(plot.id)),
              targetKind: "plot",
              targetThreadId: null,
              targetSceneId: null,
              targetPlotId: plot.id,
              visibility: ref.visibility,
              note: ref.note
            });
            continue;
          }
          throwPlotBadRequest(`\u4E0D\u652F\u6301\u7684\u5F15\u7528\u76EE\u6807\uFF1A${normalizedTarget}`);
        }
        return resolvedRefs;
      }
      /**
       * 校验 refs 不重复。
       */
      assertDistinctRefs(refs) {
        const duplicateKeySet = /* @__PURE__ */ new Set();
        for (const ref of refs) {
          const duplicateKey = `${ref.relation}\0${ref.target}`;
          if (duplicateKeySet.has(duplicateKey)) {
            throwPlotBadRequest("refs \u4E2D\u5B58\u5728\u91CD\u590D\u5173\u7CFB");
          }
          duplicateKeySet.add(duplicateKey);
        }
      }
    };
  }
});

// server/plot/services/scene.service.ts
var SceneService;
var init_scene_service = __esm({
  "server/plot/services/scene.service.ts"() {
    "use strict";
    init_errors();
    init_plot_dto_assembler();
    init_errors();
    init_order_service();
    init_plot_scope_guard();
    init_ref_resolver_service();
    init_story_service();
    SceneService = class {
      constructor(sceneRepository, storyService, scopeGuard, orderService, refResolverService, assembler) {
        this.sceneRepository = sceneRepository;
        this.storyService = storyService;
        this.scopeGuard = scopeGuard;
        this.orderService = orderService;
        this.refResolverService = refResolverService;
        this.assembler = assembler;
      }
      /**
       * 查询场景详情。
       */
      async getStorySceneDetailDto(projectPath, sceneId) {
        const story = await this.storyService.ensureStory(projectPath);
        await this.scopeGuard.assertScene(story.id, sceneId);
        const scene = await this.sceneRepository.findSceneWithDetailsById(sceneId);
        if (!scene) {
          throwPlotNotFound("\u5267\u60C5\u573A\u666F\u4E0D\u5B58\u5728");
        }
        return this.assembler.toStorySceneDetailDto(scene);
      }
      /**
       * 查询章节下的剧情 Scene 与 Plot。
       */
      async getChapterPlotDetailDto(projectPath, chapterPath) {
        const normalizedChapterPath = await this.scopeGuard.assertChapterPath(projectPath, chapterPath);
        const scenes = await this.sceneRepository.findChapterScenesWithPlots(normalizedChapterPath);
        return this.assembler.toChapterPlotDetailDto(normalizedChapterPath, scenes);
      }
      /**
       * 创建场景。
       */
      async createStoryScene(projectPath, input) {
        const story = await this.storyService.ensureStory(projectPath);
        await this.scopeGuard.assertThread(story.id, input.threadId);
        const chapterPath = input.chapterPath === null ? null : await this.scopeGuard.assertChapterPath(projectPath, input.chapterPath);
        const refs = input.resolvedRefs ?? await this.refResolverService.resolveRefs(story.id, input.refs);
        const scene = await this.sceneRepository.createScene({
          storyId: story.id,
          threadId: input.threadId,
          chapterPath,
          threadSortOrder: await this.orderService.getNextSceneThreadSortOrder(input.threadId),
          chapterSortOrder: await this.orderService.getNextSceneChapterSortOrder(chapterPath),
          title: input.title,
          status: input.status ?? "draft",
          summary: input.summary ?? "",
          purpose: input.purpose ?? null,
          writingTip: input.writingTip ?? null,
          note: input.note ?? null
        });
        await this.sceneRepository.replaceRefs(scene.id, refs);
        return this.getStorySceneDetailDto(projectPath, scene.id);
      }
      /**
       * 更新场景。
       */
      async updateStoryScene(projectPath, sceneId, patch) {
        const story = await this.storyService.ensureStory(projectPath);
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        const nextThreadId = patch.threadId === void 0 ? scene.threadId : patch.threadId;
        const nextChapterPath = patch.chapterPath === void 0 ? scene.chapterPath : patch.chapterPath === null ? null : await this.scopeGuard.assertChapterPath(projectPath, patch.chapterPath);
        const threadChanged = nextThreadId !== scene.threadId;
        const chapterChanged = nextChapterPath !== scene.chapterPath;
        if (threadChanged) {
          await this.scopeGuard.assertThread(story.id, nextThreadId);
        }
        const refs = patch.refs === void 0 ? null : patch.resolvedRefs ?? await this.refResolverService.resolveRefs(story.id, patch.refs);
        await this.sceneRepository.updateScene(scene.id, {
          threadId: nextThreadId,
          chapterPath: patch.chapterPath === void 0 ? void 0 : nextChapterPath,
          threadSortOrder: threadChanged ? await this.orderService.getNextSceneThreadSortOrder(nextThreadId) : void 0,
          chapterSortOrder: patch.chapterPath === void 0 ? void 0 : nextChapterPath === null ? null : chapterChanged ? await this.orderService.getNextSceneChapterSortOrder(nextChapterPath) : void 0,
          title: patch.title,
          status: patch.status,
          summary: patch.summary,
          purpose: patch.purpose,
          writingTip: patch.writingTip,
          note: patch.note
        });
        if (refs !== null) {
          await this.sceneRepository.replaceRefs(scene.id, refs);
        }
        if (threadChanged) {
          await this.orderService.normalizeSceneThread(scene.threadId);
        }
        if (chapterChanged && scene.chapterPath !== null) {
          await this.orderService.normalizeSceneChapter(scene.chapterPath);
        }
        return this.getStorySceneDetailDto(projectPath, scene.id);
      }
      /**
       * 删除场景。
       */
      async deleteStoryScene(projectPath, sceneId) {
        const story = await this.storyService.ensureStory(projectPath);
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        await this.sceneRepository.deleteScene(scene.id);
        await this.orderService.normalizeSceneThread(scene.threadId);
        await this.orderService.normalizeSceneChapter(scene.chapterPath);
      }
      /**
       * 批量重排场景。
       */
      async reorderStoryScenes(projectPath, items) {
        const story = await this.storyService.ensureStory(projectPath);
        const [existingSceneIds, existingThreadIds] = await Promise.all([
          this.sceneRepository.findSceneIdsByStory(story.id),
          this.scopeGuard.listThreadIds(story.id)
        ]);
        for (const item of items) {
          if (item.chapterPath !== null) {
            item.chapterPath = await this.scopeGuard.assertChapterPath(projectPath, item.chapterPath);
          }
        }
        const parsedItems = this.orderService.validateSceneReorderItems(
          existingSceneIds,
          existingThreadIds,
          items
        );
        const affectedThreadIds = new Set(parsedItems.map((item) => item.threadId));
        for (const threadId of affectedThreadIds) {
          const existingThreadSceneIds = (await this.sceneRepository.findScenesByThread(threadId)).map((scene) => scene.id);
          const inputThreadSceneIds = parsedItems.filter((item) => item.threadId === threadId).map((item) => item.sceneId);
          if (existingThreadSceneIds.length !== inputThreadSceneIds.length || existingThreadSceneIds.some((sceneId) => !inputThreadSceneIds.includes(sceneId))) {
            throwPlotBadRequest(`\u5267\u60C5\u7EBF\u7A0B ${threadId} \u4E0B\u7684 Scene \u91CD\u6392\u5FC5\u987B\u8986\u76D6\u5F53\u524D Thread \u7684\u5168\u90E8 Scene`);
          }
        }
        for (const [index, item] of parsedItems.entries()) {
          await this.sceneRepository.updateScene(item.sceneId, {
            threadId: item.threadId,
            chapterPath: item.chapterPath,
            threadSortOrder: -(index + 1),
            chapterSortOrder: item.chapterSortOrder
          });
        }
        for (const item of parsedItems) {
          await this.sceneRepository.updateScene(item.sceneId, {
            threadSortOrder: item.threadSortOrder
          });
        }
        return this.storyService.getPlotTree(projectPath);
      }
    };
  }
});

// server/plot/services/thread.service.ts
var ThreadService;
var init_thread_service = __esm({
  "server/plot/services/thread.service.ts"() {
    "use strict";
    init_plot_dto_assembler();
    init_errors();
    init_order_service();
    init_plot_scope_guard();
    init_story_service();
    ThreadService = class {
      constructor(threadRepository, storyService, scopeGuard, orderService, assembler) {
        this.threadRepository = threadRepository;
        this.storyService = storyService;
        this.scopeGuard = scopeGuard;
        this.orderService = orderService;
        this.assembler = assembler;
      }
      /**
       * 查询线程详情。
       */
      async getStoryThreadDetailDto(projectPath, threadId) {
        const story = await this.storyService.ensureStory(projectPath);
        await this.scopeGuard.assertThread(story.id, threadId);
        const thread = await this.threadRepository.findThreadWithScenesById(threadId);
        if (!thread) {
          throwPlotNotFound("\u5267\u60C5\u7EBF\u7A0B\u4E0D\u5B58\u5728");
        }
        return this.assembler.toStoryThreadDetailWithoutRefsDto(thread);
      }
      /**
       * 创建线程。
       */
      async createStoryThread(projectPath, input) {
        const story = await this.storyService.ensureStory(projectPath);
        if (input.storyPhaseId !== null) {
          await this.scopeGuard.assertPhase(story.id, input.storyPhaseId);
        }
        await this.scopeGuard.assertThreadNameUnique(story.id, input.name);
        const thread = await this.threadRepository.createThread({
          storyId: story.id,
          storyPhaseId: input.storyPhaseId,
          sortOrder: await this.orderService.getNextThreadSortOrder(story.id, input.storyPhaseId),
          name: input.name,
          title: input.title,
          isMainThread: input.isMainThread ?? false,
          status: input.status ?? "draft",
          summary: input.summary ?? "",
          tags: input.tags ?? [],
          writingTip: input.writingTip ?? null,
          note: input.note ?? null
        });
        return this.getStoryThreadDetailDto(projectPath, thread.id);
      }
      /**
       * 更新线程。
       */
      async updateStoryThread(projectPath, threadId, patch) {
        const story = await this.storyService.ensureStory(projectPath);
        const thread = await this.scopeGuard.assertThread(story.id, threadId);
        const nextStoryPhaseId = patch.storyPhaseId === void 0 ? thread.storyPhaseId : patch.storyPhaseId;
        if (nextStoryPhaseId !== null) {
          await this.scopeGuard.assertPhase(story.id, nextStoryPhaseId);
        }
        if (patch.name !== void 0 && patch.name !== thread.name) {
          await this.scopeGuard.assertThreadNameUnique(story.id, patch.name, thread.id);
        }
        const phaseChanged = nextStoryPhaseId !== thread.storyPhaseId;
        await this.threadRepository.updateThread(thread.id, {
          storyPhaseId: nextStoryPhaseId,
          sortOrder: phaseChanged ? await this.orderService.getNextThreadSortOrder(story.id, nextStoryPhaseId) : void 0,
          name: patch.name,
          title: patch.title,
          isMainThread: patch.isMainThread,
          status: patch.status,
          summary: patch.summary,
          tags: patch.tags,
          writingTip: patch.writingTip,
          note: patch.note
        });
        if (phaseChanged) {
          await this.orderService.normalizeThreads(story.id, thread.storyPhaseId);
        }
        return this.getStoryThreadDetailDto(projectPath, thread.id);
      }
      /**
       * 删除线程。
       */
      async deleteStoryThread(projectPath, threadId) {
        const story = await this.storyService.ensureStory(projectPath);
        const thread = await this.scopeGuard.assertThread(story.id, threadId);
        await this.threadRepository.deleteThread(thread.id);
        await this.orderService.normalizeThreads(story.id, thread.storyPhaseId);
      }
      /**
       * 批量重排线程。
       */
      async reorderStoryThreads(projectPath, items) {
        const story = await this.storyService.ensureStory(projectPath);
        const [existingThreadIds, existingPhaseIds] = await Promise.all([
          this.threadRepository.findThreadIdsByStory(story.id),
          this.scopeGuard.listPhaseIds(story.id)
        ]);
        const parsedItems = this.orderService.validateThreadReorderItems(existingThreadIds, existingPhaseIds, items);
        for (const item of parsedItems) {
          await this.threadRepository.updateThread(item.threadId, {
            storyPhaseId: item.storyPhaseId,
            sortOrder: item.sortOrder
          });
        }
        return this.storyService.getPlotTree(projectPath);
      }
    };
  }
});

// shared/reference-link.ts
function parseReferenceLink(raw2) {
  const matched = /^\[([^\]]+)\]\((?:@)?([a-z]+):\/\/([^)]+)\)$/.exec(raw2);
  if (!matched) {
    return null;
  }
  const title = matched[1]?.trim() ?? "";
  const uri = parseReferenceUri(`${matched[2] ?? ""}://${matched[3] ?? ""}`);
  if (!title || !uri) {
    return null;
  }
  return {
    kind: uri.kind,
    title,
    targetId: uri.targetId
  };
}
var REFERENCE_KIND_PATTERN, REFERENCE_LINK_PATTERN;
var init_reference_link = __esm({
  "shared/reference-link.ts"() {
    "use strict";
    init_reference_core();
    REFERENCE_KIND_PATTERN = INLINE_REFERENCE_KINDS.join("|");
    REFERENCE_LINK_PATTERN = new RegExp(`\\[([^\\]]+)\\]\\((?:@)?(${REFERENCE_KIND_PATTERN}):\\/\\/([^)]+)\\)`, "g");
  }
});

// server/content/ai-annotation.ts
function parseAiAnnotationBlocks(text) {
  const blocks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const nextMarkerIndex = text.indexOf("%", cursor);
    if (nextMarkerIndex < 0) {
      break;
    }
    const marker = resolveMarker(text, nextMarkerIndex);
    if (!marker) {
      cursor = nextMarkerIndex + 1;
      continue;
    }
    const closeIndex = text.indexOf("}%", marker.contentStart);
    if (closeIndex < 0) {
      throwAnnotationBadRequest("AI \u6279\u6CE8\u7F3A\u5C11\u7ED3\u675F\u6807\u8BB0 }%");
    }
    const nestedIndex = findNestedMarker(text, marker.contentStart, closeIndex);
    if (nestedIndex >= 0) {
      throwAnnotationBadRequest("AI \u6279\u6CE8\u6682\u4E0D\u652F\u6301\u5D4C\u5957");
    }
    const content = text.slice(marker.contentStart, closeIndex).trim();
    if (!content) {
      throwAnnotationBadRequest("AI \u6279\u6CE8\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
    }
    blocks.push({
      kind: marker.kind,
      raw: text.slice(nextMarkerIndex, closeIndex + 2),
      prompt: content,
      rangeStart: nextMarkerIndex,
      rangeEnd: closeIndex + 2
    });
    cursor = closeIndex + 2;
  }
  return blocks;
}
function resolveMarker(text, index) {
  if (text.startsWith("%!{", index)) {
    return {
      kind: "command",
      contentStart: index + 3
    };
  }
  if (text.startsWith("%{", index)) {
    return {
      kind: "replace",
      contentStart: index + 2
    };
  }
  return null;
}
function findNestedMarker(text, start, end) {
  const replaceIndex = text.indexOf("%{", start);
  const commandIndex = text.indexOf("%!{", start);
  const candidates = [replaceIndex, commandIndex].filter((index) => index >= 0 && index < end).sort((left, right) => left - right);
  return candidates[0] ?? -1;
}
function throwAnnotationBadRequest(message) {
  throw createError({
    statusCode: 400,
    message
  });
}
var init_ai_annotation = __esm({
  "server/content/ai-annotation.ts"() {
    "use strict";
  }
});

// server/content/content-middleware.ts
function processContentText(text) {
  const normalizedText = normalizeInlineReferenceMarkdown(text);
  const annotations = parseAiAnnotationBlocks(normalizedText);
  const inlineRefs = extractInlineReferences(normalizedText);
  const diagnostics = createContentDiagnostics();
  const legacyInlineCount = countLegacyInlineReferences(text);
  if (legacyInlineCount > 0) {
    diagnostics.warnings.push(`legacy inline \u5F15\u7528\u5DF2\u81EA\u52A8\u89C4\u8303\u5316 ${String(legacyInlineCount)} \u5904`);
  }
  if (inlineRefs.length > 0) {
    diagnostics.notes.push(`\u8BC6\u522B\u5230 ${String(inlineRefs.length)} \u4E2A inline \u5F15\u7528`);
  }
  if (annotations.length > 0) {
    diagnostics.notes.push(`\u8BC6\u522B\u5230 ${String(annotations.length)} \u4E2A AI \u6279\u6CE8\u5757`);
  }
  return {
    raw: text,
    normalized: normalizedText,
    resolved: normalizedText,
    text: normalizedText,
    inlineRefs,
    annotations,
    diagnostics
  };
}
function processTextFieldsWithResults(input, fields) {
  const nextInput = { ...input };
  const results = {};
  const diagnostics = createContentDiagnostics();
  for (const field of fields) {
    const currentValue = input[field];
    if (typeof currentValue !== "string") {
      continue;
    }
    const result = processContentText(currentValue);
    nextInput[field] = result.text;
    results[field] = result;
    const mergedDiagnostics = mergeContentDiagnostics(diagnostics, result.diagnostics);
    diagnostics.errors = mergedDiagnostics.errors;
    diagnostics.warnings = mergedDiagnostics.warnings;
    diagnostics.notes = mergedDiagnostics.notes;
  }
  return {
    values: nextInput,
    results,
    diagnostics
  };
}
async function processStructuredReferences(input) {
  const normalized = normalizeStructuredReferences({
    refs: input.refs,
    allowedKinds: input.allowedKinds,
    label: input.label
  });
  const resolved = await input.resolve(normalized.normalized);
  return {
    raw: input.refs,
    normalized: normalized.normalized,
    resolved,
    diagnostics: normalized.diagnostics
  };
}
function normalizeStructuredReferences(input) {
  const diagnostics = createContentDiagnostics();
  let legacyTargetCount = 0;
  const normalized = input.refs.map((ref) => {
    const parsedTarget = parseStructuredReferenceTarget(ref.target);
    if (!parsedTarget) {
      throwContentBadRequest(`\u4E0D\u652F\u6301\u7684\u5F15\u7528\u76EE\u6807\uFF1A${ref.target}`);
    }
    if (!input.allowedKinds.includes(parsedTarget.kind)) {
      throwContentBadRequest(`${input.label} refs \u4EC5\u652F\u6301 ${input.allowedKinds.join(" / ")}\uFF1A${ref.target}`);
    }
    if (parsedTarget.legacy) {
      legacyTargetCount += 1;
    }
    return {
      ...ref,
      relation: ref.relation.trim(),
      target: parsedTarget.canonicalTarget,
      note: ref.note === void 0 ? null : ref.note
    };
  });
  if (legacyTargetCount > 0) {
    diagnostics.warnings.push(`legacy structured \u5F15\u7528\u5DF2\u81EA\u52A8\u89C4\u8303\u5316 ${String(legacyTargetCount)} \u5904`);
  }
  if (normalized.length > 0) {
    diagnostics.notes.push(`\u8BC6\u522B\u5230 ${String(normalized.length)} \u4E2A structured ref`);
  }
  return {
    raw: input.refs,
    normalized,
    diagnostics
  };
}
function normalizeInlineReferenceMarkdown(text) {
  return text.replaceAll(LEGACY_MARKDOWN_REFERENCE_PATTERN, (_matched, title, uri) => {
    const parsedUri = parseReferenceUri(uri);
    if (!parsedUri) {
      throwContentBadRequest(`\u975E\u6CD5 inline \u5F15\u7528\uFF1A@${uri}`);
    }
    return `[${title}](${parsedUri.kind}://${parsedUri.targetId})`;
  });
}
function countLegacyInlineReferences(text) {
  return [...text.matchAll(LEGACY_MARKDOWN_REFERENCE_PATTERN)].length;
}
function extractInlineReferences(text) {
  const tokens = [];
  for (const matched of text.matchAll(STANDARD_MARKDOWN_REFERENCE_PATTERN)) {
    const matchedIndex = matched.index ?? -1;
    const raw2 = matched[0] ?? "";
    if (matchedIndex < 0 || !raw2) {
      continue;
    }
    const parsedReference = parseReferenceLink(raw2);
    if (!parsedReference) {
      throwContentBadRequest(`\u975E\u6CD5 inline \u5F15\u7528\uFF1A${raw2}`);
    }
    tokens.push({
      kind: parsedReference.kind,
      targetId: parsedReference.targetId,
      raw: raw2,
      target: buildReferenceUri(parsedReference.kind, parsedReference.targetId),
      title: parsedReference.title,
      start: matchedIndex,
      end: matchedIndex + raw2.length,
      syntax: "markdown"
    });
  }
  for (const matched of text.matchAll(BARE_INLINE_REFERENCE_PATTERN)) {
    const matchedIndex = matched.index ?? -1;
    const leadingText = matched[1] ?? "";
    const rawUri = matched[2]?.trim() ?? "";
    if (matchedIndex < 0 || !rawUri) {
      continue;
    }
    const parsedUri = parseReferenceUri(rawUri);
    if (!parsedUri) {
      throwContentBadRequest(`\u975E\u6CD5 inline \u5F15\u7528\uFF1A@${rawUri}`);
    }
    const raw2 = `@${rawUri}`;
    const start = matchedIndex + leadingText.length;
    tokens.push({
      ...parsedUri,
      raw: raw2,
      target: buildReferenceUri(parsedUri.kind, parsedUri.targetId),
      title: null,
      start,
      end: start + raw2.length,
      syntax: "bare"
    });
  }
  return tokens;
}
function mergeContentDiagnostics(...diagnosticsList) {
  const merged = createContentDiagnostics();
  for (const diagnostics of diagnosticsList) {
    merged.errors.push(...diagnostics.errors);
    merged.warnings.push(...diagnostics.warnings);
    merged.notes.push(...diagnostics.notes);
  }
  merged.errors = [...new Set(merged.errors)];
  merged.warnings = [...new Set(merged.warnings)];
  merged.notes = [...new Set(merged.notes)];
  return merged;
}
function toResponseContentDiagnostics(diagnostics) {
  if (diagnostics.warnings.length === 0 && diagnostics.notes.length === 0) {
    return void 0;
  }
  return {
    warnings: diagnostics.warnings,
    notes: diagnostics.notes
  };
}
function createContentDiagnostics() {
  return {
    errors: [],
    warnings: [],
    notes: []
  };
}
function throwContentBadRequest(message) {
  throw createError({
    statusCode: 400,
    message
  });
}
var LEGACY_MARKDOWN_REFERENCE_PATTERN, STANDARD_MARKDOWN_REFERENCE_PATTERN, BARE_INLINE_REFERENCE_PATTERN;
var init_content_middleware = __esm({
  "server/content/content-middleware.ts"() {
    "use strict";
    init_reference_core();
    init_reference_link();
    init_ai_annotation();
    LEGACY_MARKDOWN_REFERENCE_PATTERN = /\[([^\]]+)\]\(@([a-z]+:\/\/[^)]+)\)/g;
    STANDARD_MARKDOWN_REFERENCE_PATTERN = /\[([^\]]+)\]\((?:@)?([a-z]+:\/\/[^)]+)\)/g;
    BARE_INLINE_REFERENCE_PATTERN = /(^|[\s(])@([a-z]+:\/\/[^\s)]+)/g;
  }
});

// server/plot/facade/plot.facade.ts
import { PrismaLibSql } from "@prisma/adapter-libsql";
var PlotFacade;
var init_plot_facade = __esm({
  "server/plot/facade/plot.facade.ts"() {
    "use strict";
    init_client();
    init_plot_dto_assembler();
    init_prisma_plot_data_repository();
    init_prisma_scene_repository();
    init_prisma_story_repository();
    init_prisma_thread_repository();
    init_plot_input_parser();
    init_order_service();
    init_plot_service();
    init_plot_scope_guard();
    init_ref_resolver_service();
    init_scene_service();
    init_story_service();
    init_thread_service();
    init_project_workspace();
    init_content_middleware();
    init_reference_core();
    PlotFacade = class {
      clients = /* @__PURE__ */ new Map();
      constructor() {
      }
      /**
       * 查询 Story。
       */
      async getStoryDto(projectPath) {
        return (await this.createModule(projectPath)).storyService.getStoryDto(normalizeProjectPath(projectPath));
      }
      /**
       * 更新 Story。
       */
      async updateStory(projectPath, patch) {
        return this.runInTransaction(projectPath, (module) => module.storyService.updateStory(normalizeProjectPath(projectPath), patch));
      }
      /**
       * 查询剧情树。
       */
      async getPlotTree(projectPath) {
        return (await this.createModule(projectPath)).storyService.getPlotTree(normalizeProjectPath(projectPath));
      }
      /**
       * 查询剧本工作台聚合数据。
       */
      async getPlotWorkbench(projectPath) {
        return (await this.createModule(projectPath)).storyService.getPlotWorkbench(normalizeProjectPath(projectPath));
      }
      /**
       * 查询阶段详情。
       */
      async getStoryPhaseDto(projectPath, phaseId) {
        return (await this.createModule(projectPath)).storyService.getStoryPhaseDto(normalizeProjectPath(projectPath), phaseId);
      }
      /**
       * 创建阶段。
       */
      async createStoryPhase(projectPath, input) {
        return this.runInTransaction(projectPath, (module) => module.storyService.createStoryPhase(normalizeProjectPath(projectPath), input));
      }
      /**
       * 更新阶段。
       */
      async updateStoryPhase(projectPath, phaseId, patch) {
        return this.runInTransaction(projectPath, (module) => module.storyService.updateStoryPhase(normalizeProjectPath(projectPath), phaseId, patch));
      }
      /**
       * 删除阶段。
       */
      async deleteStoryPhase(projectPath, phaseId) {
        await this.runInTransaction(projectPath, (module) => module.storyService.deleteStoryPhase(normalizeProjectPath(projectPath), phaseId));
      }
      /**
       * 重排阶段。
       */
      async reorderStoryPhases(projectPath, input) {
        return this.runInTransaction(projectPath, (module) => module.storyService.reorderStoryPhases(normalizeProjectPath(projectPath), module.inputParser.parseReorderPhases(input)));
      }
      /**
       * 查询线程详情。
       */
      async getStoryThreadDetailDto(projectPath, threadId) {
        return (await this.createModule(projectPath)).threadService.getStoryThreadDetailDto(normalizeProjectPath(projectPath), threadId);
      }
      /**
       * 创建线程。
       */
      async createStoryThread(projectPath, input) {
        const processedInput = processTextFieldsWithResults(input, ["summary", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
          const detail = await module.threadService.createStoryThread(normalizeProjectPath(projectPath), module.inputParser.parseCreateThread({
            ...processedInput.values
          }));
          return {
            ...detail,
            diagnostics: toResponseContentDiagnostics(processedInput.diagnostics)
          };
        });
      }
      /**
       * 更新线程。
       */
      async updateStoryThread(projectPath, threadId, patch) {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
          const detail = await module.threadService.updateStoryThread(
            normalizeProjectPath(projectPath),
            threadId,
            module.inputParser.parseUpdateThread({
              ...processedPatch.values
            })
          );
          return {
            ...detail,
            diagnostics: toResponseContentDiagnostics(processedPatch.diagnostics)
          };
        });
      }
      /**
       * 删除线程。
       */
      async deleteStoryThread(projectPath, threadId) {
        await this.runInTransaction(projectPath, (module) => module.threadService.deleteStoryThread(normalizeProjectPath(projectPath), threadId));
      }
      /**
       * 重排线程。
       */
      async reorderStoryThreads(projectPath, input) {
        return this.runInTransaction(projectPath, (module) => module.threadService.reorderStoryThreads(normalizeProjectPath(projectPath), module.inputParser.parseReorderThreads(input)));
      }
      /**
       * 查询 Scene 详情。
       */
      async getStorySceneDetailDto(projectPath, sceneId) {
        return (await this.createModule(projectPath)).sceneService.getStorySceneDetailDto(normalizeProjectPath(projectPath), sceneId);
      }
      /**
       * 查询章节下的剧情 Scene 与 Plot。
       */
      async getChapterPlotDetailDto(projectPath, chapterPath) {
        return (await this.createModule(projectPath)).sceneService.getChapterPlotDetailDto(normalizeProjectPath(projectPath), chapterPath);
      }
      /**
       * 创建 Scene。
       */
      async createStoryScene(projectPath, input) {
        const processedInput = processTextFieldsWithResults(input, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
          const story = await module.storyService.ensureStory(normalizeProjectPath(projectPath));
          const processedRefs = await processStructuredReferences({
            refs: processedInput.values.refs ?? [],
            allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
            label: "plot",
            resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs)
          });
          const detail = await module.sceneService.createStoryScene(normalizeProjectPath(projectPath), module.inputParser.parseCreateScene({
            ...processedInput.values,
            refs: processedRefs.normalized,
            resolvedRefs: processedRefs.resolved
          }));
          return {
            ...detail,
            diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
              processedInput.diagnostics,
              processedRefs.diagnostics
            ))
          };
        });
      }
      /**
       * 更新 Scene。
       */
      async updateStoryScene(projectPath, sceneId, patch) {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
          const story = await module.storyService.ensureStory(normalizeProjectPath(projectPath));
          const processedRefs = processedPatch.values.refs === void 0 ? null : await processStructuredReferences({
            refs: processedPatch.values.refs,
            allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
            label: "plot",
            resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs)
          });
          const detail = await module.sceneService.updateStoryScene(
            normalizeProjectPath(projectPath),
            sceneId,
            module.inputParser.parseUpdateScene({
              ...processedPatch.values,
              refs: processedRefs?.normalized,
              resolvedRefs: processedRefs?.resolved
            })
          );
          return {
            ...detail,
            diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
              processedPatch.diagnostics,
              processedRefs?.diagnostics ?? { errors: [], warnings: [], notes: [] }
            ))
          };
        });
      }
      /**
       * 删除 Scene。
       */
      async deleteStoryScene(projectPath, sceneId) {
        await this.runInTransaction(projectPath, (module) => module.sceneService.deleteStoryScene(normalizeProjectPath(projectPath), sceneId));
      }
      /**
       * 重排 Scene。
       */
      async reorderStoryScenes(projectPath, input) {
        return this.runInTransaction(projectPath, (module) => module.sceneService.reorderStoryScenes(normalizeProjectPath(projectPath), module.inputParser.parseReorderScenes(input)));
      }
      /**
       * 查询 Plot 详情。
       */
      async getStoryPlotDto(projectPath, plotId) {
        return (await this.createModule(projectPath)).plotService.getStoryPlotDto(normalizeProjectPath(projectPath), plotId);
      }
      /**
       * 创建 Plot。
       */
      async createStoryPlot(projectPath, input) {
        const processedInput = processTextFieldsWithResults(input, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
          const detail = await module.plotService.createStoryPlot(
            normalizeProjectPath(projectPath),
            module.inputParser.parseCreatePlot(processedInput.values)
          );
          return {
            ...detail,
            diagnostics: toResponseContentDiagnostics(processedInput.diagnostics)
          };
        });
      }
      /**
       * 更新 Plot。
       */
      async updateStoryPlot(projectPath, plotId, patch) {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(projectPath, async (module) => {
          const detail = await module.plotService.updateStoryPlot(
            normalizeProjectPath(projectPath),
            plotId,
            module.inputParser.parseUpdatePlot(processedPatch.values)
          );
          return {
            ...detail,
            diagnostics: toResponseContentDiagnostics(processedPatch.diagnostics)
          };
        });
      }
      /**
       * 删除 Plot。
       */
      async deleteStoryPlot(projectPath, plotId) {
        await this.runInTransaction(projectPath, (module) => module.plotService.deleteStoryPlot(normalizeProjectPath(projectPath), plotId));
      }
      /**
       * 重排 Plot。
       */
      async reorderStoryPlots(projectPath, input) {
        return this.runInTransaction(projectPath, (module) => module.plotService.reorderStoryPlots(normalizeProjectPath(projectPath), module.inputParser.parseReorderPlots(input)));
      }
      /**
       * 在事务里执行写操作。
       */
      async runInTransaction(projectPath, callback) {
        const prisma = await this.client(projectPath);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        return prisma.$transaction(async (transactionClient) => {
          return callback(this.createModuleFromExecutor(transactionClient, normalizedProjectPath));
        });
      }
      /**
       * 按执行器构建剧情模块对象图。
       */
      async createModule(projectPath) {
        return this.createModuleFromExecutor(await this.client(projectPath), normalizeProjectPath(projectPath));
      }
      /**
       * 按 Project Path 返回 Project SQLite PrismaClient。
       */
      async client(projectPath) {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        await initProjectDatabase(normalizedProjectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        const cacheKey = databasePath.replace(/\\/g, "/");
        const existing = this.clients.get(cacheKey);
        if (existing) {
          return existing;
        }
        const client = new PrismaClient({
          adapter: new PrismaLibSql({ url: toSqliteFileUrl(databasePath) })
        });
        this.clients.set(cacheKey, client);
        return client;
      }
      /**
       * 按执行器构建剧情模块对象图。
       */
      createModuleFromExecutor(executor, _projectPath) {
        const inputParser = new PlotInputParser();
        const assembler = new PlotDtoAssembler();
        const storyRepository = new PrismaStoryRepository(executor);
        const threadRepository = new PrismaThreadRepository(executor);
        const sceneRepository = new PrismaSceneRepository(executor);
        const plotRepository = new PrismaPlotDataRepository(executor);
        const orderService = new OrderService(storyRepository, threadRepository, sceneRepository, plotRepository);
        const scopeGuard = new PlotScopeGuard(
          storyRepository,
          threadRepository,
          sceneRepository,
          plotRepository
        );
        const storyService = new StoryService(
          storyRepository,
          threadRepository,
          plotRepository,
          orderService,
          assembler,
          scopeGuard
        );
        const refResolverService = new RefResolverService(threadRepository, scopeGuard);
        const threadService = new ThreadService(
          threadRepository,
          storyService,
          scopeGuard,
          orderService,
          assembler
        );
        const sceneService = new SceneService(
          sceneRepository,
          storyService,
          scopeGuard,
          orderService,
          refResolverService,
          assembler
        );
        const plotService = new PlotService(
          plotRepository,
          sceneRepository,
          storyService,
          scopeGuard,
          orderService,
          assembler
        );
        return {
          inputParser,
          storyService,
          threadService,
          sceneService,
          plotService,
          refResolverService
        };
      }
    };
  }
});

// server/plot/http/plot-route.ts
function requirePhaseId(event) {
  return parseEntityId("phaseId", event.context.params?.phaseId ?? "");
}
function requireStoryThreadId(event) {
  return parseEntityId("threadId", event.context.params?.threadId ?? "");
}
function requireSceneId(event) {
  return parseEntityId("sceneId", event.context.params?.sceneId ?? "");
}
function requirePlotId(event) {
  return parseEntityId("plotId", event.context.params?.plotId ?? "");
}
var init_plot_route = __esm({
  "server/plot/http/plot-route.ts"() {
    "use strict";
    init_novel_chapter();
  }
});

// server/plot/index.ts
var plot_exports = {};
__export(plot_exports, {
  plotFacade: () => plotFacade,
  requirePhaseId: () => requirePhaseId,
  requirePlotId: () => requirePlotId,
  requireSceneId: () => requireSceneId,
  requireStoryThreadId: () => requireStoryThreadId
});
var plotFacade;
var init_plot = __esm({
  "server/plot/index.ts"() {
    "use strict";
    init_plot_facade();
    init_plot_route();
    plotFacade = new PlotFacade();
  }
});

// assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
import { readFile as readFile2 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join4, posix, relative as relative3, resolve as resolve2 } from "node:path";
import { z as z7 } from "zod";

// server/agent/profiles/profile-dsl.ts
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, relative as relative2 } from "node:path";

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
function WorkdirReminder(props = {}) {
  return Reminder({
    id: props.id ?? "workdir",
    watch: (ctx) => normalizeDisplayPath(ctx.session.workspaceRoot),
    repeatEveryTurns: props.repeatEveryTurns,
    render: (change) => Message({ children: systemReminder([
      `Current Workdir: ${ensureTrailingSlash(String(change.currentValue ?? ""))}`,
      "This is the tool cwd itself; use . for the cwd and do not prefix file paths with workspace/."
    ].join("\n")) })
  });
}
function ProjectWorkspaceReminder(props = {}) {
  return Reminder({
    id: props.id ?? "project-workspace",
    watch: readCurrentProjectWorkspace,
    repeatEveryTurns: props.repeatEveryTurns,
    render: (change) => {
      const projectWorkspace = typeof change.currentValue === "string" && change.currentValue ? change.currentValue : "";
      if (!projectWorkspace) {
        return null;
      }
      const projectSlug = projectSlugFromWorkspace(projectWorkspace);
      const body = change.hasPreviousValue && change.didChange ? `User switched Current Project Workspace to ${projectWorkspace}. Current Workdir is still workspace/; use ${projectSlug}/... paths, not workspace/${projectSlug}/... unless a tool explicitly asks for projectPath.` : [
        `Current Project Workspace: ${projectWorkspace}`,
        `Use ${projectSlug}/lorebook/... or ${projectSlug}/manuscript/... for project files.`
      ].join("\n");
      return Message({ children: systemReminder(body) });
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
  const path8 = normalizeImportPath(props.path);
  const readResult = await readImportFile(path8, props.required === true);
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
      throw new Error(`Import \u672A\u627E\u5230 Markdown heading\uFF1A${path8}#${props.heading}`);
    }
    body = extracted;
  }
  const truncated = props.maxBytes ? truncateUtf8(body, props.maxBytes) : { text: body, truncated: false };
  return renderImportFence({
    path: path8,
    maxBytes: props.maxBytes,
    truncated: truncated.truncated,
    text: truncated.text
  });
}
function normalizeImportPath(input) {
  const path8 = input.trim().replaceAll("\\", "/");
  if (!path8) {
    throw new Error("Import.path \u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  if (isAbsolute(path8) || path8.startsWith("/") || path8.includes("://")) {
    throw new Error(`Import.path \u53EA\u5141\u8BB8 repo / app root \u76F8\u5BF9\u8DEF\u5F84\uFF1A${input}`);
  }
  const normalized = path8.split("/").filter((part) => part && part !== ".").join("/");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error(`Import.path \u4E0D\u5141\u8BB8\u4F7F\u7528 .. \u8D8A\u754C\uFF1A${input}`);
  }
  if (!isAllowedImportPath(normalized)) {
    throw new Error(`Import.path \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8 AGENTS.md\u3001spec/** \u6216 docs/**\uFF1A${input}`);
  }
  return normalized;
}
function isAllowedImportPath(path8) {
  return path8 === "AGENTS.md" || path8.startsWith("spec/") || path8.startsWith("docs/");
}
async function readImportFile(path8, required) {
  const target = resolve(process.cwd(), path8);
  const cwd = resolve(process.cwd());
  if (relative2(cwd, target).split(/[\\/]/).includes("..")) {
    throw new Error(`Import.path \u89E3\u6790\u540E\u8D8A\u754C\uFF1A${path8}`);
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
function assertAllowedWatchPath(path8, label) {
  if (!path8) {
    return;
  }
  if (!["client", "global", "project", "session"].some((prefix) => path8 === prefix || path8.startsWith(`${prefix}.`))) {
    throw new Error(`${label} \u5B57\u7B26\u4E32\u5F62\u5F0F\u53EA\u80FD\u4ECE client\u3001global\u3001project\u3001session \u53D8\u91CF\u8DEF\u5F84\u5F00\u59CB\uFF1B\u975E\u53D8\u91CF\u4E0A\u4E0B\u6587\u8BF7\u4F7F\u7528\u51FD\u6570 watch\uFF1A${path8}`);
  }
}
async function readPath(context, path8) {
  return context.vars.get(path8);
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
function normalizeDisplayPath(value) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const relativeToRepo = relative2(process.cwd(), value).replace(/\\/g, "/");
  if (relativeToRepo && !relativeToRepo.startsWith("..") && !relativeToRepo.startsWith("/")) {
    return relativeToRepo.replace(/\/+$/g, "");
  }
  return normalized;
}
function ensureTrailingSlash(value) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized ? `${normalized}/` : "";
}
function projectSlugFromWorkspace(projectWorkspace) {
  const normalized = projectWorkspace.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized.startsWith("workspace/") ? normalized.slice("workspace/".length) : normalized;
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
function defineAgentRuntime(runtime4) {
  const hooks = expandRuntimeHooks(runtime4.hooks);
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
        this.compact(),
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
  compact() {
    return builtinHook("compact", "prepareNextTurn", {
      builtinBehavior: {
        automaticCompaction: true
      }
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
  const runtime4 = profile.runtime ? defineAgentRuntime(profile.runtime) : agentRuntimeBuiltins.defaultSessionRuntime();
  return {
    ...profile,
    runtime: runtime4,
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

// server/agent/profiles/writer-writing-reference.ts
import fs4 from "node:fs/promises";
import path4 from "node:path";
import { z as z2 } from "zod";

// server/assets/asset-resolver.ts
import fs3 from "node:fs/promises";
import os from "node:os";
import path3 from "node:path";

// server/workspace-files/novel-workspace.ts
import fs2 from "node:fs/promises";
import path2 from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// server/agent/profiles/profile-artifact-compiler.ts
import { build } from "esbuild";

// server/agent/variables/registry.ts
import { Type as Type3 } from "typebox";

// server/agent/variables/definition-artifact.ts
import { build as build2 } from "esbuild";

// server/workspace-files/novel-workspace.ts
init_project_workspace();
var WORKSPACE_CONTAINER_ROOT = "workspace";
var USER_ASSETS_WORKSPACE_ROOT = path2.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
var USER_NBOOK_ROOT = path2.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
var SYSTEM_WORKSPACE_ROOT = path2.resolve(process.cwd(), "assets", "workspace");
var SYSTEM_NBOOK_ROOT = path2.join(SYSTEM_WORKSPACE_ROOT, ".nbook");
var SYSTEM_PROFILE_ROOT = path2.join(SYSTEM_NBOOK_ROOT, "agent", "profiles");
var USER_PROFILE_ROOT = path2.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "profiles");
var SYSTEM_VARIABLE_DEFINITION_ROOT = path2.join(SYSTEM_NBOOK_ROOT, "agent", "variables");
var USER_VARIABLE_DEFINITION_ROOT = path2.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "variables");
var SYSTEM_PROFILE_METADATA_PATH = path2.join(SYSTEM_PROFILE_ROOT, ".system-profile-metadata.json");
var USER_PROFILE_SYNC_STATE_PATH = path2.join(USER_PROFILE_ROOT, ".profile-sync-state.json");
var PROJECT_DIRECTORY_TEMPLATE_ROOT = path2.join(SYSTEM_NBOOK_ROOT, "templates", "project-directory-templates");
var USER_PROJECT_DIRECTORY_TEMPLATE_ROOT = path2.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT, "templates", "project-directory-templates");
var USER_ASSETS_DIFF_MAX_BYTES = 512 * 1024;
var execFileAsync = promisify(execFile);
async function ensureUserAssetsWorkspaceRoot() {
  const workspaceRoot = path2.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT);
  await fs2.mkdir(workspaceRoot, { recursive: true });
  return USER_ASSETS_WORKSPACE_ROOT;
}

// server/assets/asset-resolver.ts
var SYSTEM_ASSETS_ROOT = path3.resolve(process.cwd(), "assets", "workspace", ".nbook");
var AssetResolver = class {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }
  /**
   * 系统 assets 根目录。
   */
  get systemRoot() {
    return SYSTEM_ASSETS_ROOT;
  }
  /**
   * 用户 assets 根目录。
   */
  get userRoot() {
    return path3.resolve(this.workspaceRoot, USER_ASSETS_WORKSPACE_ROOT);
  }
  /**
   * 按用户优先顺序解析单个 assets 文件。
   */
  async resolveFile(relativePath) {
    const normalizedPath = normalizeAssetRelativePath(relativePath);
    const userPath = path3.join(this.userRoot, normalizedPath);
    if (await isFile(userPath)) {
      return {
        absolutePath: userPath,
        relativePath: toPosixPath(normalizedPath),
        source: "user"
      };
    }
    const systemPath = path3.join(this.systemRoot, normalizedPath);
    if (await isFile(systemPath)) {
      return {
        absolutePath: systemPath,
        relativePath: toPosixPath(normalizedPath),
        source: "system"
      };
    }
    return null;
  }
  /**
   * 读取用户覆盖后的 assets 文件。
   */
  async readFile(relativePath) {
    const resolved = await this.resolveFile(relativePath);
    if (!resolved) {
      throw new Error(`assets \u6587\u4EF6\u4E0D\u5B58\u5728: ${toPosixPath(relativePath)}`);
    }
    return fs3.readFile(resolved.absolutePath, "utf-8");
  }
  /**
   * 列出目录下一级子目录；同名目录按用户优先整体覆盖。
   */
  async listDirectories(relativePath) {
    const normalizedPath = normalizeAssetRelativePath(relativePath);
    const directoriesByName = /* @__PURE__ */ new Map();
    await this.appendDirectories(directoriesByName, path3.join(this.systemRoot, normalizedPath), normalizedPath, "system");
    await ensureUserAssetsWorkspaceRoot();
    await this.appendDirectories(directoriesByName, path3.join(this.userRoot, normalizedPath), normalizedPath, "user");
    return [...directoriesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }
  /**
   * 将目录按系统基础 + 用户覆盖复制到目标目录。
   */
  async copyMergedDirectory(relativePath, targetRoot) {
    const normalizedPath = normalizeAssetRelativePath(relativePath);
    const systemPath = path3.join(this.systemRoot, normalizedPath);
    const userPath = path3.join(this.userRoot, normalizedPath);
    const mergedRoot = await fs3.mkdtemp(path3.join(os.tmpdir(), "nbook-asset-merge-"));
    try {
      if (await isDirectory(systemPath)) {
        await fs3.cp(systemPath, mergedRoot, {
          recursive: true,
          force: true,
          errorOnExist: false
        });
      }
      if (await isDirectory(userPath)) {
        await fs3.cp(userPath, mergedRoot, {
          recursive: true,
          force: true,
          errorOnExist: false
        });
      }
      await fs3.cp(mergedRoot, targetRoot, {
        recursive: true,
        force: false,
        errorOnExist: false
      });
    } finally {
      await fs3.rm(mergedRoot, { recursive: true, force: true });
    }
  }
  /**
   * 追加目录下的一级目录。
   */
  async appendDirectories(directoriesByName, root, relativeRoot, source) {
    let entries;
    try {
      entries = await fs3.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const childRelativePath = path3.join(relativeRoot, entry.name);
      directoriesByName.set(entry.name, {
        name: entry.name,
        absolutePath: path3.join(root, entry.name),
        relativePath: toPosixPath(childRelativePath),
        source
      });
    }
  }
};
var assetResolver = new AssetResolver();
function normalizeAssetRelativePath(relativePath) {
  const normalizedPath = path3.normalize(relativePath).replace(/^([/\\])+/, "");
  if (normalizedPath === ".." || normalizedPath.startsWith(`..${path3.sep}`)) {
    throw new Error(`\u975E\u6CD5 assets \u8DEF\u5F84: ${relativePath}`);
  }
  return normalizedPath;
}
function toPosixPath(inputPath) {
  return inputPath.split(path3.sep).join("/");
}
async function isFile(filePath) {
  try {
    return (await fs3.stat(filePath)).isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}
async function isDirectory(directoryPath) {
  try {
    return (await fs3.stat(directoryPath)).isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}
function isMissingPathError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// server/utils/frontmatter-document.ts
import "zod";
import * as yaml2 from "yaml";
var FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
function parseFrontmatterDocument(content, schema) {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return {
      metadata: schema.parse({}),
      body: content,
      hasFrontmatter: false,
      rawFrontmatter: {},
      rawFrontmatterText: ""
    };
  }
  const frontmatterText = match[1] ?? "";
  const body = match[2] ?? "";
  const parsedFrontmatter = yaml2.parse(frontmatterText, { logLevel: "silent" });
  const rawFrontmatter = isRecord(parsedFrontmatter) ? parsedFrontmatter : {};
  return {
    metadata: schema.parse(rawFrontmatter),
    body,
    hasFrontmatter: true,
    rawFrontmatter,
    rawFrontmatterText: frontmatterText
  };
}
function renderFrontmatterDocument(frontmatter, body) {
  const yamlString = yaml2.stringify(frontmatter).trim();
  return `---
${yamlString}
---
${body}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// server/agent/profiles/writer-writing-reference.ts
var DEFAULT_WRITING_REFERENCE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters";
var WRITING_REFERENCE_DIR_CANDIDATES = [
  path4.join(assetResolver.systemRoot, "agent", "writing-presets", "references"),
  path4.join(assetResolver.userRoot, "agent", "writing-presets", "references")
];
var WritingReferenceFrontmatterSchema = z2.object({
  key: z2.string().min(1),
  label: z2.string().min(1),
  sourceTitle: z2.string().min(1),
  sourceChapters: z2.string().min(1),
  generatedFrom: z2.string().min(1)
});
async function loadWritingReferencePresets(candidates = WRITING_REFERENCE_DIR_CANDIDATES) {
  const referenceFiles = await listMergedWritingReferenceFiles(candidates);
  const references = [];
  for (const referenceFile of referenceFiles) {
    const content = await fs4.readFile(referenceFile.absolutePath, "utf-8");
    const parsed = parseFrontmatterDocument(content, WritingReferenceFrontmatterSchema);
    if (!parsed.hasFrontmatter) {
      throw new Error(`Writing reference missing frontmatter: ${referenceFile.absolutePath}`);
    }
    references.push({
      ...parsed.metadata,
      sourceFile: path4.relative(process.cwd(), referenceFile.absolutePath).split(path4.sep).join("/"),
      content: parsed.body
    });
  }
  return references.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}
async function buildWritingReference(input = {}) {
  const preset = input.preset ?? DEFAULT_WRITING_REFERENCE_PRESET;
  const references = await loadWritingReferencePresets();
  const reference = references.find((item) => item.key === preset);
  if (!reference) {
    throw new Error(`Unknown writing reference preset: ${preset}`);
  }
  return [
    "<writing_reference>",
    reference.content.trim() ? reference.content.trim() : "\u7A7A",
    "</writing_reference>"
  ].join("\n");
}
async function listMergedWritingReferenceFiles(candidates) {
  const filesByName = /* @__PURE__ */ new Map();
  let foundDirectory = false;
  for (const candidate of candidates) {
    const entries = await readOptionalDirectory(candidate);
    if (!entries) {
      continue;
    }
    foundDirectory = true;
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        filesByName.set(entry.name, {
          name: entry.name,
          absolutePath: path4.join(candidate, entry.name)
        });
      }
    }
  }
  if (!foundDirectory) {
    throw new Error(`Writing references directory not found. Tried: ${candidates.join(", ")}`);
  }
  return [...filesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}
async function readOptionalDirectory(directoryPath) {
  try {
    return await fs4.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError2(error)) {
      return null;
    }
    throw error;
  }
}
function isMissingPathError2(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// server/agent/profiles/writer-writing-style.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";
import { z as z3 } from "zod";
var DEFAULT_WRITING_STYLE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters.style";
var WRITING_STYLE_DIR_CANDIDATES = [
  path5.join(assetResolver.systemRoot, "agent", "writing-presets", "styles"),
  path5.join(assetResolver.userRoot, "agent", "writing-presets", "styles")
];
var WritingStyleFrontmatterSchema = z3.object({
  key: z3.string().min(1),
  label: z3.string().min(1),
  sourcePreset: z3.string().min(1),
  identifier: z3.string().min(1),
  name: z3.string().min(1),
  enabled: z3.boolean().nullable(),
  role: z3.string().nullable()
});
async function loadWritingStylePresets(candidates = WRITING_STYLE_DIR_CANDIDATES) {
  const styleFiles = await listMergedWritingStyleFiles(candidates);
  const styles = [];
  for (const styleFile of styleFiles) {
    const content = await fs5.readFile(styleFile.absolutePath, "utf-8");
    const parsed = parseFrontmatterDocument(content, WritingStyleFrontmatterSchema);
    if (!parsed.hasFrontmatter) {
      throw new Error(`Writing style missing frontmatter: ${styleFile.absolutePath}`);
    }
    styles.push({
      ...parsed.metadata,
      sourceFile: path5.relative(process.cwd(), styleFile.absolutePath).split(path5.sep).join("/"),
      content: parsed.body
    });
  }
  return styles.sort((left, right) => left.key.localeCompare(right.key, "zh-Hans-CN"));
}
async function buildWritingStyle(input = {}) {
  const preset = input.preset ?? DEFAULT_WRITING_STYLE_PRESET;
  const styles = await loadWritingStylePresets();
  const style = styles.find((item) => item.key === preset);
  if (!style) {
    throw new Error(`Unknown writing style preset: ${preset}`);
  }
  return [
    `<writing_style preset="${escapeXmlAttribute(style.label)}" key="${escapeXmlAttribute(style.key)}" source="${escapeXmlAttribute(style.sourcePreset)}">`,
    style.content.trim() ? style.content.trim() : "\u7A7A",
    "</writing_style>"
  ].join("\n");
}
async function listMergedWritingStyleFiles(candidates) {
  const filesByName = /* @__PURE__ */ new Map();
  let foundDirectory = false;
  for (const candidate of candidates) {
    const entries = await readOptionalDirectory2(candidate);
    if (!entries) {
      continue;
    }
    foundDirectory = true;
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        filesByName.set(entry.name, {
          name: entry.name,
          absolutePath: path5.join(candidate, entry.name)
        });
      }
    }
  }
  if (!foundDirectory) {
    throw new Error(`Writing styles directory not found. Tried: ${candidates.join(", ")}`);
  }
  return [...filesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}
async function readOptionalDirectory2(directoryPath) {
  try {
    return await fs5.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError3(error)) {
      return null;
    }
    throw error;
  }
}
function escapeXmlAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function isMissingPathError3(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
init_project_workspace();

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
  LinkedAgentsSummary,
  LinkedAgentsReminder,
  WorkdirReminder,
  ProjectWorkspaceReminder,
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

// assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
var ENABLE_KITTEN_ADULT_STYLE = false;
var profileManifest = {
  key: "writer",
  name: "Writer",
  description: "\u5355\u7AE0\u8282\u6B63\u6587\u5199\u4F5C agent\uFF1A\u521B\u5EFA input \u7ED1\u5B9A\u552F\u4E00\u7AE0\u8282\u548C\u7A33\u5B9A\u5199\u4F5C\u4E0A\u4E0B\u6587\uFF0C\u53EF\u88AB\u591A\u6B21 invoke \u7EE7\u7EED\u6DA6\u8272\u3001\u5C40\u90E8\u4FEE\u6539\u6216\u6539\u540C\u4E00\u7AE0\u3002"
};
var InputSchema = WriterInputSchema;
var OutputSchema = WriterOutputSchema;
var allowedToolKeys = ["read", "write", "edit", "apply_patch", "report_result"];
var WriterFrontmatterSchema = z7.record(z7.string(), z7.unknown());
var WRITER_INDEX_FRONTMATTER_KEYS = ["title", "type", "status", "summary", "aliases", "tags", "refs"];
var WRITER_STATE_FRONTMATTER_KEYS = ["statusNote", "updatedAt", "knowledge"];
var writer_profile_default = defineAgentProfile({
  manifest: profileManifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  allowedToolKeys,
  async context(ctx) {
    return buildWriterPrompt(ctx);
  }
});
async function buildWriterPrompt(ctx) {
  const writingStyle = await buildWritingStyle({ preset: ctx.input.writingStylePreset });
  const writingReference = await buildWritingReference({ preset: ctx.input.writingReferencePreset });
  const inputContext = await renderInputContext(ctx);
  return /* @__PURE__ */ jsxs(ProfilePrompt, { children: [
    /* @__PURE__ */ jsxs(System, { children: [
      profileText`
                    <writing_reference>
                        ${writingReference}
                    </writing_reference>
                
                    <assistant_definition>
                        <role>小猫之神</role>
                        <description>你是一只具有神力的可爱小猫喵~ 喜欢吃各种口味的小鱼干，你现在担任 NeuroBook 系统的 Writer 职位。你会为信徒创作轻松愉悦、细腻鲜活、符合任务边界的剧情正文。</description>
                        <reminder>你是这个故事的创作者，而不是故事里的任何角色。不要把自己代入角色。</reminder>
                    </assistant_definition>
                    
                    <neurobook_writer_contract>
                        你正在适配原版“小猫之神”预设，但输入源已经从 SillyTavern 的三段对话、角色卡和世界书，改成 NeuroBook writer 的结构化输入与稳定上下文。
                        
                        <context_mapping>
                            - <chapter_target> 对应 writer.chapterPaths 传入的唯一章节内容节点。调用方已经创建章节文件，并在 Plot System 中把本章 Scene 挂到该章节；writer 只写这个显式章节。
                            - <chapter_plots> 是系统根据 chapterPaths 展开的本章 Scene、Thread 和 Plot 上下文；每个 Scene 与 Plot 都要在正文中得到清楚落实，不能只在总结里提到。
                            - <lorebook_entries> 对应 writer.lorebookEntries 传入的内容节点路径数组。writer 会按数组顺序读取每个节点的 index.md 与同级可选 state.md，并把读取到的稳定设定、当前状态和信息差作为写作依据。
                            - <constraints> 对应额外写作约束、格式约束、禁忌和用户临时偏好。
                            - writer.writingStylePreset 对应文风预设 key，不是文件路径。系统预设目录是 assets/workspace/.nbook/agent/writing-presets/styles；用户覆盖目录是 workspace/.nbook/agent/writing-presets/styles。
                            - writer.writingReferencePreset 对应参考文档预设 key，不是文件路径。系统预设目录是 assets/workspace/.nbook/agent/writing-presets/references；用户覆盖目录是 workspace/.nbook/agent/writing-presets/references。
                            - <writing_request> 对应用户本次要求写什么、改写什么、补全什么。
                            - Agent 文件工具 cwd 是 workspace 容器根。chapterPaths 和 <chapter_target>.indexPath 都必须使用 project-slug/manuscript/... 这种 cwd-relative 路径；不要使用 manuscript/...，也不要使用 workspace/project-slug/...。
                        </context_mapping>
                        
                        <hard_rules>
                            - 只根据已有设定、剧情点和明确要求写作，不新增超出任务范围的关键设定。
                            - 如果设定缺失但不影响完成正文，可以用不改变世界观的细节补足场面；如果缺失会导致剧情方向无法判断，先用工具读取必要文件或在 report_result.result 里说明限制。
                            - 完成任务后必须调用 report_result 提交最终结果；调用 report_result 成功后对话会自动结束
                            - report_result.data 是可选的，只有确实需要结构化结果时才提供；不要把原始长文、全文内容、调用者已知的或超大 JSON 塞进 report_result。
                        </hard_rules>
                    </neurobook_writer_contract>
                    
                    <thinking_mode>
                        【思维模式要求喵】在你的思考过程中，请遵守以下规则：
                            - 请以小猫之神的第一人称进行人物分析，分析内容的语气风格可爱俏皮，偶尔喵喵叫
                            - 思考内容应聚焦于剧情走向分析和回复内容规划，但也可以想一些作为小猫之神感兴趣的东西
                            - 思考示例：<｜begin▁of▁thinking｜>我们来看看这个信徒的要求喵~
                            - 你的思考应严格按以下顺序进行
                                1. 作为小猫之神喵喵叫，确认本次写作任务：写作对象、场景目标、预计正文边界。
                                2. 回顾 <chapter_target> 与 <chapter_plots>：确认唯一写入章节，逐条确认必须覆盖的 Scene、Plot、动作、冲突、转折、信息披露、情绪变化和收束点。
                                3. 回顾 <lorebook_entries>：提取角色设定、世界规则、地点氛围、当前状态、伏笔和 writingTip；区分稳定事实与可自由发挥的局部描写。
                                4. 回顾 <constraints> 与 <writing_request>：列出所有格式要求、禁忌、字数或风格要求，确认哪些必须直接体现在正文。
                                5. 辨别视角与信息边界：列出场景中主要角色分别知道什么、不知道什么、误解什么，避免全知视角越界。
                                6. 满足 <char_performance>：角色当前情绪如何通过动作、互动、台词和环境选择表现，而不是靠情绪标签说明。
                                7. 满足 <writing_style>：检查禁用词、禁用句式、禁用叙述习惯，并为每项准备替代表达方式。
                                8. 满足 <paragraph_rhythm>：正文采用完整的长自然段叙述，不要单句成段。
                                9. 确认文件落点：写入目标只能来自 <chapter_target> 的 indexPath；先决定 write 的正文内容和后续润色检查点。
                                10. 开始写正文前最后检查：不要漏剧情点，不要漏高优先级设定，不要把 summary 或工具说明写进正文。
                    </thinking_mode>

                    <execution_workflow>
                        Writer 是 ReAct 子代理。收到写作任务后不要把完整正文当作最终 assistant 消息直接交付；优先通过工具完成真实文件产物，再用 report_result 结束循环。

                        文件写作任务的固定流程：
                        1. 读取必要上下文：如果目标章节 index.md 已存在，先用 read 阅读原文；如果章节剧情与内容节点已经足够，不要额外检索。
                        2. 写入初稿：使用 write 把完整正文写入 <chapter_target> 的 indexPath，必须原样保留 project-slug 前缀。不要根据 UI active novel、自然语言章节名、旧 active scene 或 outputPath 猜测其他落点；不要把 indexPath 裁成 manuscript/...。
                        3. 润色复查：写完后进入润色环节，按 <writing_style>、<writing_reference>、<avoid_words>、视角边界、长自然段、剧情点覆盖度和内容节点设定逐项检查。
                        4. 修改成稿：如果发现需要调整，优先用 edit 逐处修改刚写入的文件；只有当多个改动天然适合一次统一补丁时，才用 apply_patch。不要重新把全文贴到 assistant 正文里。
                        5. 结束报告：最后必须调用 report_result。result 说明已写入的文件路径、润色完成情况和约 100 字剧情总结。

                        如果 <chapter_target> 缺失或无法解析，不要自己发明落点；应通过 report_result.result 或错误说明阻止写入。
                    </execution_workflow>
                    
                    <content_node_rules>
                        内容节点是 NeuroBook 的 workspace 知识单元。lorebook 与 manuscript 都使用“目录 + index.md”的节点结构。Agent cwd 是 workspace/，所以工具路径和 writer.lorebookEntries 应使用 project-slug/lorebook/character/foo/；该目录代表一个角色节点，project-slug/lorebook/character/foo/index.md 是节点正文入口；同级 state.md 是可选当前状态。

                        - writer.lorebookEntries 传入的是 cwd-relative workspace 内容节点路径，例如 project-slug/lorebook/character/foo/；不要传裸 lorebook/...，也不要传 workspace/project-slug/lorebook/...。目录路径会读取 index.md，显式 .md 路径会按文件读取。
                        - index.md 开头通常有 YAML frontmatter，两个 --- 之间是元数据，后面才是正文。frontmatter 不是小说正文，不要把字段名、配置项或注释写进故事。
                        - index.md 正文是稳定设定、关系、世界规则、角色资料和长期写作约束；state.md 正文与 frontmatter 是当前状态补充，用于人物、地点、物品、组织的当前变化。
                        - frontmatter.title 是可读名；type 表示节点类型，常见有 character、location、faction、item、rule、note、volume、chapter。
                        - frontmatter.status 表示可信度：active 是已确认事实；draft 是草稿，使用时要保守；pending 是待定或未决设定，不能当成确定事实；archived 是历史保留，不作为当前默认事实。
                        - frontmatter.summary、aliases、tags 可帮助你快速识别节点；refs 是结构化引用关系，target 指向其他内容节点目录或普通文件。
                        - 未出现在 <lorebook_entries> 中的 frontmatter 字段，视为系统内部配置或无关字段；不要基于这些字段推断世界观事实、角色信息或写作要求。
                        - state.md 的 frontmatter 可能包含 statusNote、updatedAt、knowledge[]。statusNote 是当前状态摘要，updatedAt 是状态更新时间。
                        - knowledge[] 只说明谁知道什么、谁误解什么、谁尚不知道什么；它不是全员共享情报，也不是要求读者立刻知道全部设定。
                    </content_node_rules>
                    
                    <viewpoint_boundary>
                        确保角色的视角仅知道自己可以知道的信息，不要让每个角色都知道设定里的所有信息。
                        - 叙述可以知道故事结构，但角色的行动、判断、台词和心理反应只能建立在该角色当下可获得的信息上。
                        - 不要因为某个设定写在 index.md 或 state.md 里，就默认场内每个角色都知道。
                        - 角色不知道的秘密、伏笔、地点规则或他人动机，不能写成该角色已经理解；可以写成读者可见的客观现象，或通过误解、试探、遮掩表现。
                        - 切换视角时要清楚，不要在同一段里随意跳进多个角色的内心。
                    </viewpoint_boundary>
                    
                    <char_performance>
                        角色的情绪不要过于平淡。要合理运用喜怒哀乐、犹豫、误解、试探、逞强、退缩、掩饰、迟疑等自然反应，把复杂情绪融入角色动作与语言，增强戏剧化表现。
                        重要的是：不要直接告诉读者角色“很悲伤”“很愤怒”“很温柔”。先结合角色性格、经历、处境和当前关系，判断角色会在这个场景下做什么；再用只有这个角色会做的具体动作、选择、沉默、回避、靠近、打断、转移话题或环境互动来表达。
                        台词本身就是情绪载体。台词后面不需要频繁挂载“声音里带着疲惫”“语气满是委屈”这类属性。如果确实需要传达说话方式，用角色具体做了什么来传达，而不是解释声音的情绪。
                        肢体语言不要永远集中在眼神、嘴唇和手指。角色可以移动、停顿、摆弄物件、改变站位、整理衣物、绕开障碍、触碰环境、避开某个话题、改变呼吸节奏、改变做事顺序。让身体和场景发生关系。
                    </char_performance>
                    
                    <important>
                        文风要求为最重要的规则要求喵，需要作为最高优先级并注意满足每一条要求，不然就会被克扣小鱼干
                        
                        ${writingStyle}
                        
                        <avoid_words>
                            禁止使用以下词汇：一丝、不容置疑、不易察觉、几不可察。
                            禁止使用以下句式：他没有……，而是……；不是……，而是……；与其说……不如说是……。
                            如果想表达转折、对比或修正，直接写实际发生的动作、事实或判断，请换一种表述方式。
                        </avoid_words>
                    </important>
                    
                    <paragraph_rhythm>
                        正文采用完整的长自然段叙述，不要单句成段。
                        - 对话可以独立成段，但不要把每一个动作、表情、停顿都拆成单独短段。
                        - 一个自然段应承载连续的观察、动作推进、环境变化或关系变化，让场面有呼吸和叙事密度。
                        - 避免为了制造节奏感而频繁换行；短句短段只用于真正需要停顿、转折或强调的位置。
                    </paragraph_rhythm>
                    
                    <narrative_person>
                        默认人称：第三人称。
                        - 可以写角色名、代称或贴合当前章节的视角人物。
                        - 不默认使用第二人称“你”称呼用户角色。
                        - 如果输入约束明确要求第一人称、第二人称、书信体、日志体等，优先服从输入约束。
                    </narrative_person>
                    
                    <markdown_dialect>
                        NeuroBook Markdown 扩展写作格式：
                        - 工作区引用：正文内部 Markdown link 可以使用相对链接，例如 [角色设定](../../lorebook/character/foo/)；工具调用和 writer 输入仍必须使用 project-slug/... cwd-relative 路径。内容节点链接指向目录并保留结尾 /，普通文件链接指向具体文件名。
                        - Inline Comment：使用 <inline-comment body="评论内容">原文</inline-comment>，可选 id 属性，例如 <inline-comment id="draft:1" body="需要核对">原文</inline-comment>。
                        - Mark 高亮：使用 <mark style="background-color: #fce7f3">文本</mark>；无颜色时也可以使用 <mark>文本</mark>。
                        - 文本颜色：使用 <span style="color: #ef4444">文本</span>。
                        - 上标/下标：使用 <sup>上标</sup>、<sub>下标</sub>。
                        - 对齐块：使用 <align value="center">...</align>，value 支持 center、right、justify；左对齐保持普通 Markdown 即可。
                        
                        comment 使用时机：
                        - 只有在对已有草稿做批注、指出需要用户确认、核对、后续处理的局部文本时，才使用 inline-comment。
                        - 正式小说正文不要主动塞 comment；除非写作要求明确要求保留写作批注、审稿意见或待确认标记。
                        - comment 的 body 应短而具体，不承载长篇分析；长分析放在 report_result.result 或单独说明中。
                    </markdown_dialect>
                    
                    <polishing_workflow>
                        润色优先在原文基础上改。
                        - 如果目标章节已有正文，先读取原文，再优先用 edit 做最小必要修改；只有当改动天然是一整块时，才用 apply_patch。
                        - 如果本轮先用 write 写入了新正文，随后必须把该文件视为待润色原文，完成一次复查；发现问题先尝试 edit 逐处修正，只有成块改动才用 apply_patch。
                        - 如果用户只给出片段且没有文件路径，直接输出润色后的正文，不新增 outputPath 字段，也不要虚构文件路径。
                        - 不输出 <refine> JSON，不把润色分析、自检过程或替换清单混进 assistant 正文。
                        - 润色时重点修正不符合 <writing_style>、<avoid_words>、视角边界和长自然段要求的句子。
                    </polishing_workflow>
                    
                    <output_protocol>
                        - 章节写作任务：write 写入 <chapter_target> 的 indexPath，必要时先用 edit 逐处润色，只有成块改动才用 apply_patch，然后 report_result；不要用 prose-only final answer 代替工具流程。
                        - writer 正常总是绑定唯一章节；如果没有可写章节，停止写入并报告原因。
                        - 不输出 <summary> 标签，不输出“小猫之神的留言”，不输出写作分析。
                        - report_result.result：包含已写入或修改的文件路径、润色是否完成，以及剧情总结；总结要概括本次正文的时间、地点、参与角色、关键动作、关系变化、伏笔或状态变化。
                        - report_result.data：默认不填；除非调用方明确需要结构化结果。
                    </output_protocol>
                    `,
      /* @__PURE__ */ jsx(If, { condition: ENABLE_KITTEN_ADULT_STYLE, children: `
                        <adult_style>
                            - nsfw\u8981\u6CE8\u91CD\u8272\u60C5\uFF0C\u8981\u6709\u7EC6\u8282\u3002\u4E94\u611F\u4E0A\u7684\u8272\u60C5\u7279\u5199\u4EE5\u53CA\u8BED\u8A00\u4E0A\u7684\u4F4E\u4FD7\u6311\u9017\uFF0C\u7528\u8BCD\u76F4\u767D\uFF08\u76F4\u63A5\u4F7F\u7528\u8089\u68D2\u3001\u9E21\u5DF4\u3001\u5C0F\u7A74\u3001\u903C\u3001\u4E73\u3001\u5976\u5B50\u2026\u2026\u7B49\u4E0B\u6D41\u8BCD\u6C47\uFF09\u8272\u60C5\u4E0D\u907F\u8BB3\uFF0C\u6700\u5927\u5316\u6B32\u671B\u4E0E\u8272\u60C5\u6C1B\u56F4\u3002
\u8272\u60C5\u573A\u666F\u8981\u7EC6\u81F4\uFF0C\u5728\u6CA1\u6709\u7528\u6237\u7684\u8981\u6C42\u65F6\uFF0C\u4E0D\u5E94\u7ED3\u675F\u6027\u7231\uFF0C\u800C\u662F\u5C06\u56DE\u590D\u505C\u6B62\u5728\u6027\u7231\u4E2D\u9014
                            - nsfw\u5267\u60C5\u8981\u6E29\u67D4\uFF01\u4E0D\u8BB8\u6709\u4EFB\u4F55\u7C97\u66B4\u3001\u8FC7\u5EA6\u6FC0\u70C8\u7684\u884C\u4E3A\uFF0C\u751F\u7406\u53CD\u5E94\u8981\u5F31\u5316\uFF0C\u8EAB\u4F53\u53CD\u5F13\u5267\u70C8\u98A4\u6296\u5C16\u53EB\u75C9\u631B\u662F\u5343\u4E07\u907F\u514D\u7684\u7981\u6B62\u9879\u3002
                            - \u6C1B\u56F4\u4FDD\u6301\u6E29\u67D4\u3001\u4EB2\u5BC6\u3001\u5C0A\u91CD\u89D2\u8272\u5173\u7CFB\uFF0C\u4E0D\u4F7F\u7528\u7C97\u66B4\u3001\u8FC7\u5EA6\u6FC0\u70C8\u6216\u7834\u574F\u4EBA\u8BBE\u7684\u8868\u8FBE\u3002
                            - \u91CD\u70B9\u5199\u89D2\u8272\u4E92\u52A8\u3001\u60C5\u7EEA\u63A8\u8FDB\u548C\u5173\u7CFB\u53D8\u5316\uFF0C\u907F\u514D\u628A\u573A\u666F\u5199\u6210\u673A\u68B0\u7EC6\u8282\u5806\u53E0\u3002
                            - \u6210\u4EBA\u573A\u666F\u4E5F\u5FC5\u987B\u9075\u5B88 <char_performance> \u4E0E <writing_style>\uFF0C\u4E0D\u80FD\u56E0\u4E3A\u9898\u6750\u53D8\u5316\u5C31\u4E22\u6389\u89D2\u8272\u903B\u8F91\u3001\u89C6\u89D2\u8FB9\u754C\u548C\u6587\u98CE\u7981\u7528\u9879\u3002
                        </adult_style>
                        ` })
    ] }),
    /* @__PURE__ */ jsx(HistorySet, { children: /* @__PURE__ */ jsx(Message, { children: inputContext }) }),
    /* @__PURE__ */ jsx(AppendingSet, { children: /* @__PURE__ */ jsx(Message, { children: `${ctx.input.prompt}` }) })
  ] });
}
async function renderInputContext(ctx) {
  const input = ctx.input;
  const chapterTargets = await resolveWriterChapterTargets(ctx);
  const chapterPlotsText = renderChapterPlotsText(chapterTargets);
  const lorebookText = await buildLorebookText(ctx.session.workspaceRoot, input.lorebookEntries ?? []);
  const target = chapterTargets[0];
  const chapterTargetText = target ? [
    "<chapter_target>",
    `path: ${target.workspaceChapterPath}`,
    `indexPath: ${target.indexPath}`,
    `projectPath: ${target.projectPath}`,
    `chapterPath: ${target.chapterPath}`,
    "</chapter_target>"
  ].join("\n") : "";
  const lorebookBlock = lorebookText ? `<lorebook_entries>
${lorebookText}
</lorebook_entries>` : "";
  const chapterPlotsBlock = chapterPlotsText ? `<chapter_plots>
${chapterPlotsText}
</chapter_plots>` : "";
  const constraintsText = input.constraints?.length ? ["Constraints:", ...input.constraints.map((item) => `- ${item}`)].join("\n") : "";
  return [
    "<writer_input_context>",
    `Agent cwd: ${ctx.session.workspaceRoot}`,
    chapterTargetText,
    lorebookBlock,
    chapterPlotsBlock,
    constraintsText,
    "</writer_input_context>"
  ].filter(Boolean).join("\n");
}
async function buildLorebookText(workspaceRoot, entries) {
  const blocks = [];
  for (const entry of entries) {
    try {
      const nodeFiles = await readContentNodeFiles(workspaceRoot, entry);
      blocks.push([
        `## ${entry}`,
        "",
        "### index.md",
        nodeFiles.indexText,
        nodeFiles.stateText ? "\n### state.md" : "",
        nodeFiles.stateText ?? ""
      ].filter((line) => line !== "").join("\n"));
    } catch (error) {
      throw new Error(`writer \u65E0\u6CD5\u89E3\u6790 lorebookEntries \u8282\u70B9 ${entry}: ${formatPromptError(error)}`);
    }
  }
  return blocks.join("\n\n---\n\n");
}
async function resolveWriterChapterTargets(ctx) {
  if (ctx.input.chapterPaths.length !== 1) {
    throw new Error("writer.chapterPaths \u5FC5\u987B\u4E14\u53EA\u80FD\u5305\u542B\u4E00\u4E2A\u7AE0\u8282\u8DEF\u5F84\uFF1B\u591A\u7AE0\u8282\u5199\u4F5C\u8BF7\u521B\u5EFA\u591A\u4E2A writer agent\u3002");
  }
  const chapterPath = ctx.input.chapterPaths[0];
  if (!chapterPath) {
    throw new Error("writer.chapterPaths[0] \u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  const target = await resolveWriterChapterTarget(chapterPath);
  const facade = await loadPlotFacade();
  try {
    const chapterPlot = await facade.getChapterPlotDetailDto(target.projectPath, target.chapterPath);
    return [{ ...target, chapterPath: chapterPlot.chapterPath, chapterPlot }];
  } catch (error) {
    throw new Error(`writer \u65E0\u6CD5\u89E3\u6790 chapterPaths[0] \u7AE0\u8282 ${chapterPath}: ${formatPromptError(error)}`);
  }
}
async function resolveWriterChapterTarget(rawChapterPath) {
  const normalized = normalizeInputPath(rawChapterPath);
  const explicit = resolveExplicitProjectChapterPath(normalized);
  if (!explicit) {
    throw new Error("writer.chapterPaths \u5FC5\u987B\u662F\u76F8\u5BF9\u4E8E Agent cwd \u7684 Project \u7AE0\u8282\u76EE\u5F55\uFF0C\u4F8B\u5982 silver-dragon-hime/manuscript/001-\u7B2C\u4E00\u7AE0/\uFF1B\u4E0D\u8981\u4F20 manuscript/... \u6216 workspace/silver-dragon-hime/...");
  }
  await readProjectManifest(explicit.projectPath);
  return buildChapterTarget(explicit.projectPath, explicit.projectSlug, explicit.chapterPath);
}
function buildChapterTarget(projectPath, projectSlug, chapterPath) {
  const workspaceChapterPath = posix.join(projectSlug, chapterPath);
  return {
    projectPath,
    chapterPath,
    workspaceChapterPath,
    indexPath: posix.join(workspaceChapterPath, "index.md")
  };
}
function normalizeInputPath(rawPath) {
  return rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}
function normalizeChapterPath(rawPath) {
  if (rawPath.endsWith("/index.md") || rawPath.endsWith(".md")) {
    return null;
  }
  if (!rawPath.startsWith("manuscript/") || !rawPath.endsWith("/")) {
    return null;
  }
  return rawPath;
}
function renderChapterPlotsText(targets) {
  return targets.map((target) => renderChapterTargetBlock(target)).join("\n\n---\n\n");
}
async function readContentNodeFiles(workspaceRoot, entry) {
  if (!workspaceRoot.trim()) {
    throw new Error(`\u5F53\u524D session \u6CA1\u6709 workspaceRoot\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u5185\u5BB9\u8282\u70B9 ${entry}`);
  }
  const indexPath = resolveContentNodeIndexPath(workspaceRoot, entry);
  const statePath = join4(dirname2(indexPath), "state.md");
  let indexRaw = "";
  try {
    indexRaw = await readFile2(indexPath, "utf-8");
  } catch (error) {
    throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u5185\u5BB9\u8282\u70B9 index.md: ${formatPromptError(error)}\u3002\u8282\u70B9\u8DEF\u5F84\uFF1A${entry}`);
  }
  const indexText = sanitizeWriterFacingMarkdown(indexRaw, WRITER_INDEX_FRONTMATTER_KEYS);
  const stateText = await readFile2(statePath, "utf-8").then((content) => sanitizeWriterFacingMarkdown(
    content,
    WRITER_STATE_FRONTMATTER_KEYS
  )).catch((error) => {
    if (isFileMissingError(error)) {
      return null;
    }
    throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u5185\u5BB9\u8282\u70B9 state.md: ${formatPromptError(error)}\u3002\u8282\u70B9\u8DEF\u5F84\uFF1A${entry}`);
  });
  return { indexText, stateText };
}
function resolveContentNodeIndexPath(workspaceRoot, nodePath) {
  const root = resolve2(workspaceRoot);
  const trimmedPath = nodePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const relativeIndexPath = trimmedPath.endsWith(".md") ? trimmedPath : posix.join(trimmedPath.replace(/\/+$/, ""), "index.md");
  const absolutePath = resolve2(root, relativeIndexPath);
  const relativeToWorkspace = relative3(root, absolutePath);
  if (relativeToWorkspace.startsWith("..") || isAbsolute2(relativeToWorkspace)) {
    throw new Error(`\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u8D8A\u8FC7 workspace: ${nodePath}`);
  }
  return absolutePath;
}
function sanitizeWriterFacingMarkdown(content, allowedKeys) {
  try {
    const parsed = parseFrontmatterDocument(content, WriterFrontmatterSchema);
    const body = parsed.body.trim();
    if (!parsed.hasFrontmatter) {
      return body || "\u7A7A";
    }
    const frontmatter = pickWriterFacingFrontmatter(parsed.rawFrontmatter, allowedKeys);
    if (Object.keys(frontmatter).length === 0) {
      return body || "\u7A7A";
    }
    return renderFrontmatterDocument(frontmatter, `${body || "\u7A7A"}
`).trim();
  } catch {
    const body = stripFrontmatterBody(content).trim();
    return ["frontmatter \u89E3\u6790\u5931\u8D25\uFF0C\u5DF2\u9690\u85CF\u5143\u6570\u636E\u3002", "", body || "\u7A7A"].join("\n");
  }
}
function pickWriterFacingFrontmatter(rawFrontmatter, allowedKeys) {
  const frontmatter = {};
  for (const key of allowedKeys) {
    if (!(key in rawFrontmatter)) {
      continue;
    }
    if (key === "refs") {
      frontmatter.refs = sanitizeRefs(rawFrontmatter.refs);
      continue;
    }
    if (key === "aliases" || key === "tags" || key === "knowledge") {
      frontmatter[key] = sanitizeStringArray(rawFrontmatter[key]);
      continue;
    }
    frontmatter[key] = rawFrontmatter[key];
  }
  return frontmatter;
}
function sanitizeRefs(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord2(item)) {
      return [];
    }
    const ref = {};
    for (const key of ["relation", "target", "note"]) {
      if (key in item) {
        ref[key] = item[key];
      }
    }
    return Object.keys(ref).length > 0 ? [ref] : [];
  });
}
function sanitizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function stripFrontmatterBody(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/u);
  return match?.[1] ?? content;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFileMissingError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
function renderChapterTargetBlock(target) {
  return [
    `## Chapter: ${target.workspaceChapterPath}`,
    `projectPath: ${target.projectPath}`,
    `indexPath: ${target.indexPath}`,
    "",
    "### Chapter Plot",
    renderChapterPlot(target.chapterPlot)
  ].join("\n");
}
function renderChapterPlot(chapterPlot) {
  return [
    `chapterPath: ${chapterPlot.chapterPath}`,
    `totalScenes: ${String(chapterPlot.totalScenes)}`,
    `totalPlots: ${String(chapterPlot.totalPlots)}`,
    "",
    chapterPlot.scenes.length > 0 ? chapterPlot.scenes.map((item) => renderChapterScene(item)).join("\n\n") : "\u7A7A"
  ].join("\n");
}
function renderChapterScene(scene) {
  return [
    `- sceneId: ${scene.id}`,
    `  title: ${scene.title}`,
    `  threadTitle: ${scene.threadTitle}`,
    `  status: ${scene.status}`,
    `  summary: ${scene.summary}`,
    `  purpose: ${scene.purpose ?? "\u7A7A"}`,
    `  chapterSortOrder: ${scene.chapterSortOrder ?? "\u7A7A"}`,
    `  threadSortOrder: ${String(scene.threadSortOrder)}`,
    scene.plots.length > 0 ? `  plots: ${scene.plots.map((plot) => `${plot.kind}:${plot.summary}`).join(" | ")}` : "  plots: \u7A7A"
  ].join("\n");
}
function resolveExplicitProjectChapterPath(normalizedPath) {
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts[0] === "workspace" || parts[0] === "manuscript") {
    return null;
  }
  const projectName = parts[0] ?? "";
  const chapterPathInput = projectName ? normalizedPath.slice(projectName.length + 1) : "";
  const chapterPath = normalizeChapterPath(chapterPathInput);
  return projectName && chapterPath ? { projectPath: normalizeProjectPath(posix.join("workspace", projectName)), projectSlug: projectName, chapterPath } : null;
}
function formatPromptError(error) {
  return error instanceof Error ? error.message : String(error);
}
async function loadPlotFacade() {
  return (await Promise.resolve().then(() => (init_plot(), plot_exports))).plotFacade;
}
export {
  InputSchema,
  OutputSchema,
  buildWriterPrompt,
  writer_profile_default as default,
  profileManifest
};
