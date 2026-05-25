var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/database/config.ts
import fs from "node:fs";
import path from "node:path";
import * as yaml from "yaml";
function resolveDatabaseConfig() {
  const bootDatabase = readBootDatabaseConfig();
  const envKind = normalizeKind(process.env.DATABASE_KIND);
  const envUrl = normalizeText(process.env.DATABASE_URL);
  const bootKind = normalizeKind(bootDatabase.kind);
  const bootUrl = normalizeText(bootDatabase.url);
  const kind = envKind ?? inferKindFromUrl(envUrl) ?? bootKind ?? inferKindFromUrl(bootUrl) ?? "sqlite";
  const url = envUrl || bootUrl || (kind === "sqlite" ? DEFAULT_SQLITE_URL : "");
  assertDatabaseConfig(kind, url);
  const sqliteFilePath = kind === "sqlite" ? resolveSqliteFilePath(url) : null;
  if (sqliteFilePath) {
    fs.mkdirSync(path.dirname(sqliteFilePath), { recursive: true });
  }
  return {
    kind,
    url,
    sqliteFilePath
  };
}
function currentDatabaseKind() {
  return resolveDatabaseConfig().kind;
}
function resolveSqliteFilePath(url) {
  if (!url.startsWith("file:")) {
    throw new Error(`SQLite DATABASE_URL \u5FC5\u987B\u4EE5 file: \u5F00\u5934\uFF0C\u5F53\u524D\u4E3A\uFF1A${url}`);
  }
  const rawPath = url.slice("file:".length);
  if (!rawPath || rawPath === ":memory:") {
    throw new Error("SQLite DATABASE_URL \u5FC5\u987B\u6307\u5411\u6587\u4EF6\u8DEF\u5F84\uFF0C\u4E0D\u80FD\u4F7F\u7528\u7A7A\u8DEF\u5F84\u6216\u5185\u5B58\u5E93\u3002");
  }
  return path.resolve(process.cwd(), rawPath);
}
function readBootDatabaseConfig() {
  try {
    const text = fs.readFileSync(BOOT_CONFIG_PATH, "utf-8");
    const expanded = expandEnvTemplates(text);
    const parsed = yaml.parse(expanded);
    return parsed?.database && typeof parsed.database === "object" ? parsed.database : {};
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
function expandEnvTemplates(input) {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name, fallback) => {
    const value = process.env[name];
    return value !== void 0 && value !== "" ? value : fallback ?? "";
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
  throw new Error(`DATABASE_KIND \u53EA\u652F\u6301 sqlite \u6216 postgres\uFF0C\u5F53\u524D\u4E3A\uFF1A${String(input)}`);
}
function normalizeText(input) {
  return typeof input === "string" ? input.trim() : "";
}
function inferKindFromUrl(url) {
  if (!url) {
    return null;
  }
  if (url.startsWith("file:")) {
    return "sqlite";
  }
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    return "postgres";
  }
  return null;
}
function assertDatabaseConfig(kind, url) {
  if (kind === "sqlite") {
    if (!url.startsWith("file:")) {
      throw new Error(`DATABASE_KIND=sqlite \u65F6 DATABASE_URL \u5FC5\u987B\u4EE5 file: \u5F00\u5934\uFF0C\u5F53\u524D\u4E3A\uFF1A${url || "<empty>"}`);
    }
    return;
  }
  if (!url) {
    throw new Error("DATABASE_KIND=postgres \u65F6\u5FC5\u987B\u914D\u7F6E DATABASE_URL\u3002");
  }
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    throw new Error(`DATABASE_KIND=postgres \u65F6 DATABASE_URL \u5FC5\u987B\u662F PostgreSQL URL\uFF0C\u5F53\u524D\u4E3A\uFF1A${url}`);
  }
}
var DEFAULT_SQLITE_URL, BOOT_CONFIG_PATH;
var init_config = __esm({
  "server/database/config.ts"() {
    "use strict";
    DEFAULT_SQLITE_URL = "file:./workspace/.nbook/neuro-book.sqlite";
    BOOT_CONFIG_PATH = path.resolve(process.cwd(), "config.yaml");
  }
});

// server/utils/agent-sql-pool.ts
import { Pool } from "pg";
var globalForAgentSqlPool, useAgentSqlPool;
var init_agent_sql_pool = __esm({
  "server/utils/agent-sql-pool.ts"() {
    "use strict";
    init_config();
    globalForAgentSqlPool = globalThis;
    useAgentSqlPool = () => {
      const databaseConfig = resolveDatabaseConfig();
      if (databaseConfig.kind !== "postgres") {
        throw new Error("\u5F53\u524D Database Kind \u4E0D\u662F postgres\uFF0C\u4E0D\u80FD\u521D\u59CB\u5316 Agent PostgreSQL \u8FDE\u63A5\u6C60");
      }
      if (globalForAgentSqlPool.agentSqlPool && globalForAgentSqlPool.agentSqlPoolUrl === databaseConfig.url) {
        return globalForAgentSqlPool.agentSqlPool;
      }
      if (globalForAgentSqlPool.agentSqlPool) {
        void globalForAgentSqlPool.agentSqlPool.end();
      }
      globalForAgentSqlPool.agentSqlPool = new Pool({
        connectionString: databaseConfig.url
      });
      globalForAgentSqlPool.agentSqlPoolUrl = databaseConfig.url;
      return globalForAgentSqlPool.agentSqlPool;
    };
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
import { createClient } from "@libsql/client";
import { Type } from "typebox";
function buildAgentSqlSchemaSummary(rows, foreignKeys, kind = "postgres") {
  if (rows.length === 0) {
    return kind === "sqlite" ? "\u5F53\u524D SQLite \u6570\u636E\u5E93\u5C1A\u672A\u53D1\u73B0\u4E1A\u52A1\u8868\uFF0C\u8BF7\u5148\u786E\u8BA4\u8FC1\u79FB\u662F\u5426\u5B8C\u6210\u3002" : "\u5F53\u524D\u672A\u53D1\u73B0 public schema \u4E0B\u7684\u4E1A\u52A1\u8868\uFF0C\u8BF7\u5148\u67E5\u8BE2 information_schema.tables\u3002";
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
  const lines = [
    kind === "sqlite" ? "\u5F53\u524D SQLite \u4E1A\u52A1\u8868\uFF08\u8868\u540D\u548C camelCase \u5B57\u6BB5\u6309\u539F\u6837\u53CC\u5F15\u53F7\u5F15\u7528\u6700\u7A33\uFF09\uFF1A" : "\u5F53\u524D Postgres \u4E1A\u52A1\u8868\uFF08\u540D\u79F0\u548C camelCase \u5B57\u6BB5\u5FC5\u987B\u6309\u4E0B\u5217\u5199\u6CD5\u4F7F\u7528\u53CC\u5F15\u53F7\uFF09\uFF1A"
  ];
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
async function getAgentSqlSchemaSummary() {
  const kind = resolveDatabaseConfig().kind;
  if (agentSqlSchemaSummaryCache && agentSqlSchemaSummaryCacheKind === kind && Date.now() - agentSqlSchemaSummaryCacheAt < AGENT_SQL_SCHEMA_CACHE_TTL_MS) {
    return agentSqlSchemaSummaryCache;
  }
  if (!agentSqlSchemaSummaryPromise) {
    agentSqlSchemaSummaryPromise = readSchemaSummary(kind).then((summary) => {
      agentSqlSchemaSummaryCache = summary;
      agentSqlSchemaSummaryCacheKind = kind;
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
  agentSqlSchemaSummaryCacheKind = null;
  agentSqlSchemaSummaryCacheAt = 0;
  agentSqlSchemaSummaryPromise = void 0;
}
function createSqlTool() {
  const databaseKind = resolveDatabaseConfig().kind;
  return {
    key: "execute_sql",
    name: "execute_sql",
    label: "Execute SQL",
    description: buildSqlToolDescription(databaseKind),
    parameters: ExecuteSqlSchema,
    async execute(_toolCallId, params) {
      const input = params;
      const result = await executeSql(input.sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result
      };
    }
  };
}
function buildSqlToolDescription(kind) {
  const shared = [
    "Execute a single database SQL statement against the current application database.",
    `Current Database Kind: ${kind}.`,
    "Allowed: SELECT / WITH / INSERT / UPDATE / DELETE.",
    "Prohibited: DDL, transaction control, session control, COPY, VACUUM, and multi-statement queries.",
    `Query rows are capped at ${String(AGENT_SQL_ROW_LIMIT)} and statement timeout target is ${String(AGENT_SQL_TIMEOUT_MS)}ms.`,
    "Use read/write/edit/apply_patch for manuscript or document files; execute_sql is only for structured DB data."
  ];
  if (kind === "sqlite") {
    return [
      ...shared,
      'SQLite dialect: quote business table and camelCase column names with double quotes when unsure, e.g. SELECT id, title FROM "StoryThread" ORDER BY "createdAt" DESC.',
      "Schema discovery uses sqlite_schema and PRAGMA table_info / foreign_key_list.",
      'Raw SQL does not apply Prisma @updatedAt client semantics; update "updatedAt" explicitly when needed.'
    ].join("\n");
  }
  return [
    ...shared,
    'PostgreSQL folds unquoted identifiers to lowercase. Business tables with uppercase letters and camelCase columns must be double-quoted, e.g. SELECT id, title FROM "StoryThread" WHERE "storyId" = 1 ORDER BY "createdAt" DESC.',
    "Schema discovery uses information_schema for public business tables.",
    'Raw SQL does not apply Prisma @updatedAt client semantics; update "updatedAt" explicitly when needed.'
  ].join("\n");
}
async function readSchemaSummary(kind) {
  if (kind === "sqlite") {
    const client = useSqliteClient();
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
    return buildAgentSqlSchemaSummary(rows, foreignKeys, kind);
  }
  const pool = useAgentSqlPool();
  const columnsResult = await pool.query(POSTGRES_SCHEMA_QUERY);
  const foreignKeysResult = await pool.query(POSTGRES_FOREIGN_KEY_QUERY);
  return buildAgentSqlSchemaSummary(columnsResult.rows, foreignKeysResult.rows, kind);
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
  if (row.dataType === "ARRAY") {
    return `${row.udtName.replace(/^_/, "")}[]`;
  }
  if (row.dataType === "USER-DEFINED") {
    return row.udtName;
  }
  if (row.dataType.toUpperCase() === "JSONB") {
    return "JSON";
  }
  return row.dataType;
}
function formatColumnDefault(value) {
  if (!value) {
    return "\u65E0\u9ED8\u8BA4\u503C";
  }
  if (value.includes("CURRENT_TIMESTAMP") || value.includes("now()")) {
    return "DEFAULT CURRENT_TIMESTAMP";
  }
  if (value.includes("nextval(") || value.toUpperCase().includes("AUTOINCREMENT")) {
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
  let dollarQuoteTag = null;
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
    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        result += " ".repeat(dollarQuoteTag.length);
        index += dollarQuoteTag.length;
        dollarQuoteTag = null;
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
    if (char === "$") {
      const match = /^\$[a-zA-Z_][a-zA-Z0-9_]*\$|^\$\$/.exec(sql.slice(index));
      if (match) {
        dollarQuoteTag = match[0];
        result += " ".repeat(dollarQuoteTag.length);
        index += dollarQuoteTag.length;
        continue;
      }
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
function shouldRefreshChapterTree(sql) {
  const normalized = normalizeSql(sql);
  return /\b(?:insert\s+into|update|delete\s+from)\s+"?(?:Novel)"?/i.test(normalized);
}
function buildAgentSqlErrorMessage(sql, error, kind = resolveDatabaseConfig().kind) {
  const message = error instanceof Error ? error.message : String(error);
  const pgError = error;
  const hintLines = [`SQL \u6267\u884C\u5931\u8D25\uFF1A${message}`];
  if (kind === "postgres" && (pgError.code === "42P01" || message.includes("relation") && message.includes("does not exist"))) {
    hintLines.push('\u63D0\u793A\uFF1APostgres \u4E1A\u52A1\u8868\u540D\u533A\u5206\u5927\u5C0F\u5199\uFF0C\u4F8B\u5982 Novel\u3001StoryThread \u5FC5\u987B\u5199\u6210 "Novel"\u3001"StoryThread"\u3002');
  }
  if (kind === "postgres" && (pgError.code === "42703" || message.includes("column") && message.includes("does not exist"))) {
    hintLines.push('\u63D0\u793A\uFF1APostgres camelCase \u5B57\u6BB5\u533A\u5206\u5927\u5C0F\u5199\uFF0C\u4F8B\u5982 storyId\u3001sortOrder\u3001createdAt \u5FC5\u987B\u5199\u6210 "storyId"\u3001"sortOrder"\u3001"createdAt"\u3002');
  }
  if (kind === "sqlite" && /no such (?:table|column)/i.test(message)) {
    hintLines.push("\u63D0\u793A\uFF1A\u5F53\u524D\u662F SQLite\uFF0C\u5148\u7528 sqlite_schema \u6216 schema summary \u786E\u8BA4\u8868/\u5217\u540D\uFF1B\u4E1A\u52A1\u8868\u548C camelCase \u5B57\u6BB5\u5EFA\u8BAE\u4F7F\u7528\u53CC\u5F15\u53F7\u3002");
  }
  return hintLines.join("\n");
}
async function executeSql(sql) {
  const normalized = normalizeSql(sql);
  validateExecuteSql(normalized);
  const kind = resolveDatabaseConfig().kind;
  return kind === "sqlite" ? executeSqliteSql(normalized) : executePostgresSql(normalized);
}
async function executePostgresSql(normalized) {
  const pool = useAgentSqlPool();
  const client = await pool.connect();
  try {
    await client.query(isReadSql(normalized) ? "BEGIN READ ONLY" : "BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
    const result = isReadSql(normalized) ? await client.query(`SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}`) : await client.query(normalized);
    await client.query("COMMIT");
    return toExecuteSqlResult(normalized, result.rows, result.rowCount ?? result.rows.length);
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(buildAgentSqlErrorMessage(normalized, error, "postgres"));
  } finally {
    client.release();
  }
}
async function executeSqliteSql(normalized) {
  const client = useSqliteClient();
  const statement = isReadSql(normalized) ? `SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}` : normalized;
  try {
    const result = await client.execute(statement);
    const rows = result.rows.map((row) => ({ ...row }));
    return toExecuteSqlResult(normalized, rows, result.rowsAffected || rows.length);
  } catch (error) {
    throw new Error(buildAgentSqlErrorMessage(normalized, error, "sqlite"));
  }
}
function toExecuteSqlResult(normalized, rows, rowCount) {
  return {
    mode: isReadSql(normalized) ? "read" : "write",
    command: detectSqlCommand(normalized),
    rowCount,
    rows,
    effects: {
      refreshChapterTree: !isReadSql(normalized) && shouldRefreshChapterTree(normalized)
    }
  };
}
function useSqliteClient() {
  const config2 = resolveDatabaseConfig();
  if (config2.kind !== "sqlite") {
    throw new Error("\u5F53\u524D Database Kind \u4E0D\u662F sqlite\uFF0C\u4E0D\u80FD\u521D\u59CB\u5316 SQLite SQL client\u3002");
  }
  if (!sqliteClient || sqliteClientUrl !== config2.url) {
    sqliteClient = createClient({ url: config2.url });
    sqliteClientUrl = config2.url;
  }
  return sqliteClient;
}
var ExecuteSqlSchema, AGENT_SQL_ROW_LIMIT, AGENT_SQL_TIMEOUT_MS, AGENT_SQL_SCHEMA_CACHE_TTL_MS, POSTGRES_SCHEMA_QUERY, POSTGRES_FOREIGN_KEY_QUERY, SQLITE_TABLE_QUERY, AGENT_SQL_DETAIL_TABLES, agentSqlSchemaSummaryCache, agentSqlSchemaSummaryCacheKind, agentSqlSchemaSummaryCacheAt, agentSqlSchemaSummaryPromise, sqliteClient, sqliteClientUrl;
var init_sql_tool = __esm({
  "server/agent/tools/sql-tool.ts"() {
    "use strict";
    init_config();
    init_agent_sql_pool();
    ExecuteSqlSchema = Type.Object({
      sql: Type.String({ description: "A single SQL statement: SELECT / WITH / INSERT / UPDATE / DELETE. DDL, transaction control, session control, and multi-statement queries are prohibited." })
    });
    AGENT_SQL_ROW_LIMIT = 200;
    AGENT_SQL_TIMEOUT_MS = 1500;
    AGENT_SQL_SCHEMA_CACHE_TTL_MS = 3e4;
    POSTGRES_SCHEMA_QUERY = `
    SELECT
        columns.table_name AS "tableName",
        columns.column_name AS "columnName",
        columns.ordinal_position AS "ordinalPosition",
        columns.is_nullable AS "isNullable",
        columns.column_default AS "columnDefault",
        columns.data_type AS "dataType",
        columns.udt_name AS "udtName"
    FROM information_schema.columns AS columns
    INNER JOIN information_schema.tables AS tables
        ON tables.table_schema = columns.table_schema
        AND tables.table_name = columns.table_name
    WHERE columns.table_schema = 'public'
        AND tables.table_type = 'BASE TABLE'
        AND columns.table_name ~ '[A-Z]'
    ORDER BY columns.table_name ASC, columns.ordinal_position ASC
`;
    POSTGRES_FOREIGN_KEY_QUERY = `
    SELECT
        key_usage.table_name AS "tableName",
        key_usage.column_name AS "columnName",
        constraint_usage.table_name AS "foreignTableName",
        constraint_usage.column_name AS "foreignColumnName"
    FROM information_schema.table_constraints AS constraints
    INNER JOIN information_schema.key_column_usage AS key_usage
        ON key_usage.constraint_name = constraints.constraint_name
        AND key_usage.table_schema = constraints.table_schema
    INNER JOIN information_schema.constraint_column_usage AS constraint_usage
        ON constraint_usage.constraint_name = constraints.constraint_name
        AND constraint_usage.table_schema = constraints.table_schema
    WHERE constraints.table_schema = 'public'
        AND constraints.constraint_type = 'FOREIGN KEY'
        AND key_usage.table_name ~ '[A-Z]'
    ORDER BY key_usage.table_name ASC, key_usage.ordinal_position ASC
`;
    SQLITE_TABLE_QUERY = `
    SELECT name AS "tableName"
    FROM sqlite_schema
    WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
    ORDER BY name ASC
`;
    AGENT_SQL_DETAIL_TABLES = /* @__PURE__ */ new Set(["Novel", "Story", "StoryThread", "StoryScene", "StoryPlot", "StorySceneRef", "User"]);
    agentSqlSchemaSummaryCache = "";
    agentSqlSchemaSummaryCacheKind = null;
    agentSqlSchemaSummaryCacheAt = 0;
    sqliteClient = null;
    sqliteClientUrl = "";
  }
});

// server/utils/novel-chapter.ts
import { consola } from "consola";
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
    throwBadRequest = (message) => {
      throw createError({
        statusCode: 400,
        message
      });
    };
  }
});

// server/generated/prisma/enums.ts
var init_enums = __esm({
  "server/generated/prisma/enums.ts"() {
    "use strict";
  }
});

// server/generated/prisma/internal/class.ts
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
  "server/generated/prisma/internal/class.ts"() {
    "use strict";
    config = {
      "previewFeatures": [],
      "clientVersion": "7.3.0",
      "engineVersion": "9d6ad21cbbceab97458517b147a6a09ff43aa735",
      "activeProvider": "postgresql",
      "inlineSchema": '// schema.postgres.prisma\ngenerator client {\n  provider = "prisma-client"\n  output   = "../server/generated/prisma"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n\nenum StoryThreadStatus {\n  active\n  draft\n  paused\n  done\n  archived\n}\n\nenum StorySceneStatus {\n  draft\n  active\n  written\n  revised\n  archived\n}\n\nenum StoryPlotKind {\n  setup\n  action\n  conflict\n  despair\n  relief\n  reward\n  mystery\n  reveal\n  twist\n  payoff\n  result\n}\n\nenum StoryRefTargetKind {\n  content\n  thread\n  scene\n  plot\n}\n\nenum StoryRefVisibility {\n  author\n  reader\n}\n\nenum UserRole {\n  admin\n  user\n}\n\nenum UserStatus {\n  active\n  disabled\n}\n\nmodel User {\n  id             Int        @id @default(autoincrement())\n  username       String     @unique\n  displayName    String     @default("")\n  passwordHash   String\n  role           UserRole   @default(user)\n  status         UserStatus @default(active)\n  sessionVersion Int        @default(1)\n  lastLoginAt    DateTime?\n  lastSeenAt     DateTime?\n  createdAt      DateTime   @default(now())\n  updatedAt      DateTime   @default(now()) @updatedAt\n\n  @@index([role, status])\n  @@index([lastSeenAt])\n  @@index([updatedAt])\n}\n\nmodel DatabaseLock {\n  key       Int      @id\n  updatedAt DateTime @default(now()) @updatedAt\n}\n\nmodel Novel {\n  id            Int      @id @default(autoincrement())\n  title         String\n  summary       String   @default("")\n  workspaceSlug String   @unique\n  createdAt     DateTime @default(now())\n  updatedAt     DateTime @default(now()) @updatedAt\n  story         Story?\n}\n\nmodel Story {\n  id        Int           @id @default(autoincrement())\n  novelId   Int           @unique\n  title     String\n  summary   String        @default("")\n  note      String?\n  createdAt DateTime      @default(now())\n  updatedAt DateTime      @default(now()) @updatedAt\n  novel     Novel         @relation(fields: [novelId], references: [id], onDelete: Cascade)\n  phases    StoryPhase[]\n  threads   StoryThread[]\n  scenes    StoryScene[]\n}\n\nmodel StoryPhase {\n  id        Int           @id @default(autoincrement())\n  storyId   Int\n  sortOrder Int\n  name      String\n  title     String\n  summary   String        @default("")\n  note      String?\n  createdAt DateTime      @default(now())\n  updatedAt DateTime      @default(now()) @updatedAt\n  story     Story         @relation(fields: [storyId], references: [id], onDelete: Cascade)\n  threads   StoryThread[]\n\n  @@unique([storyId, name])\n  @@index([storyId, sortOrder])\n}\n\nmodel StoryThread {\n  id                Int               @id @default(autoincrement())\n  storyId           Int\n  storyPhaseId      Int?\n  sortOrder         Int\n  name              String\n  title             String\n  isMainThread      Boolean           @default(false)\n  status            StoryThreadStatus @default(draft)\n  summary           String            @default("")\n  tags              String            @default("[]")\n  writingTip        String?\n  note              String?\n  createdAt         DateTime          @default(now())\n  updatedAt         DateTime          @default(now()) @updatedAt\n  story             Story             @relation(fields: [storyId], references: [id], onDelete: Cascade)\n  storyPhase        StoryPhase?       @relation(fields: [storyPhaseId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  scenes            StoryScene[]\n  incomingSceneRefs StorySceneRef[]   @relation("StorySceneRefTargetThread")\n\n  @@unique([storyId, name])\n  @@index([storyId, storyPhaseId, sortOrder])\n  @@index([storyId, isMainThread, status])\n}\n\nmodel StoryScene {\n  id                Int              @id @default(autoincrement())\n  storyId           Int\n  threadId          Int\n  chapterPath       String?\n  threadSortOrder   Int\n  chapterSortOrder  Int?\n  title             String\n  status            StorySceneStatus @default(draft)\n  summary           String           @default("")\n  purpose           String?\n  writingTip        String?\n  note              String?\n  createdAt         DateTime         @default(now())\n  updatedAt         DateTime         @default(now()) @updatedAt\n  story             Story            @relation(fields: [storyId], references: [id], onDelete: Cascade)\n  thread            StoryThread      @relation(fields: [threadId], references: [id], onDelete: Cascade)\n  plots             StoryPlot[]\n  refs              StorySceneRef[]  @relation("StorySceneRefs")\n  incomingSceneRefs StorySceneRef[]  @relation("StorySceneRefTargetScene")\n\n  @@unique([threadId, threadSortOrder])\n  @@index([threadId, threadSortOrder])\n  @@index([chapterPath, chapterSortOrder])\n  @@index([storyId, status])\n}\n\nmodel StoryPlot {\n  id                Int             @id @default(autoincrement())\n  sceneId           Int\n  sortOrder         Int\n  kind              StoryPlotKind\n  summary           String          @default("")\n  effect            String?\n  writingTip        String?\n  note              String?\n  createdAt         DateTime        @default(now())\n  updatedAt         DateTime        @default(now()) @updatedAt\n  scene             StoryScene      @relation(fields: [sceneId], references: [id], onDelete: Cascade)\n  incomingSceneRefs StorySceneRef[] @relation("StorySceneRefTargetPlot")\n\n  @@unique([sceneId, sortOrder])\n  @@index([sceneId, sortOrder])\n}\n\nmodel StorySceneRef {\n  id             Int                @id @default(autoincrement())\n  sceneId        Int\n  sortOrder      Int\n  relation       String\n  rawTarget      String\n  targetKind     StoryRefTargetKind\n  targetThreadId Int?\n  targetSceneId  Int?\n  targetPlotId   Int?\n  visibility     StoryRefVisibility @default(author)\n  note           String?\n  createdAt      DateTime           @default(now())\n  updatedAt      DateTime           @default(now()) @updatedAt\n  scene          StoryScene         @relation("StorySceneRefs", fields: [sceneId], references: [id], onDelete: Cascade)\n  targetThread   StoryThread?       @relation("StorySceneRefTargetThread", fields: [targetThreadId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  targetScene    StoryScene?        @relation("StorySceneRefTargetScene", fields: [targetSceneId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  targetPlot     StoryPlot?         @relation("StorySceneRefTargetPlot", fields: [targetPlotId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n\n  @@index([sceneId, sortOrder])\n  @@index([targetThreadId])\n  @@index([targetSceneId])\n  @@index([targetPlotId])\n}\n',
      "runtimeDataModel": {
        "models": {},
        "enums": {},
        "types": {}
      }
    };
    config.runtimeDataModel = JSON.parse('{"models":{"User":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"username","kind":"scalar","type":"String"},{"name":"displayName","kind":"scalar","type":"String"},{"name":"passwordHash","kind":"scalar","type":"String"},{"name":"role","kind":"enum","type":"UserRole"},{"name":"status","kind":"enum","type":"UserStatus"},{"name":"sessionVersion","kind":"scalar","type":"Int"},{"name":"lastLoginAt","kind":"scalar","type":"DateTime"},{"name":"lastSeenAt","kind":"scalar","type":"DateTime"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"}],"dbName":null},"DatabaseLock":{"fields":[{"name":"key","kind":"scalar","type":"Int"},{"name":"updatedAt","kind":"scalar","type":"DateTime"}],"dbName":null},"Novel":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"title","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"workspaceSlug","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"NovelToStory"}],"dbName":null},"Story":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"novelId","kind":"scalar","type":"Int"},{"name":"title","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"novel","kind":"object","type":"Novel","relationName":"NovelToStory"},{"name":"phases","kind":"object","type":"StoryPhase","relationName":"StoryToStoryPhase"},{"name":"threads","kind":"object","type":"StoryThread","relationName":"StoryToStoryThread"},{"name":"scenes","kind":"object","type":"StoryScene","relationName":"StoryToStoryScene"}],"dbName":null},"StoryPhase":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"storyId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"name","kind":"scalar","type":"String"},{"name":"title","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"StoryToStoryPhase"},{"name":"threads","kind":"object","type":"StoryThread","relationName":"StoryPhaseToStoryThread"}],"dbName":null},"StoryThread":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"storyId","kind":"scalar","type":"Int"},{"name":"storyPhaseId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"name","kind":"scalar","type":"String"},{"name":"title","kind":"scalar","type":"String"},{"name":"isMainThread","kind":"scalar","type":"Boolean"},{"name":"status","kind":"enum","type":"StoryThreadStatus"},{"name":"summary","kind":"scalar","type":"String"},{"name":"tags","kind":"scalar","type":"String"},{"name":"writingTip","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"StoryToStoryThread"},{"name":"storyPhase","kind":"object","type":"StoryPhase","relationName":"StoryPhaseToStoryThread"},{"name":"scenes","kind":"object","type":"StoryScene","relationName":"StorySceneToStoryThread"},{"name":"incomingSceneRefs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefTargetThread"}],"dbName":null},"StoryScene":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"storyId","kind":"scalar","type":"Int"},{"name":"threadId","kind":"scalar","type":"Int"},{"name":"chapterPath","kind":"scalar","type":"String"},{"name":"threadSortOrder","kind":"scalar","type":"Int"},{"name":"chapterSortOrder","kind":"scalar","type":"Int"},{"name":"title","kind":"scalar","type":"String"},{"name":"status","kind":"enum","type":"StorySceneStatus"},{"name":"summary","kind":"scalar","type":"String"},{"name":"purpose","kind":"scalar","type":"String"},{"name":"writingTip","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"story","kind":"object","type":"Story","relationName":"StoryToStoryScene"},{"name":"thread","kind":"object","type":"StoryThread","relationName":"StorySceneToStoryThread"},{"name":"plots","kind":"object","type":"StoryPlot","relationName":"StoryPlotToStoryScene"},{"name":"refs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefs"},{"name":"incomingSceneRefs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefTargetScene"}],"dbName":null},"StoryPlot":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"sceneId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"kind","kind":"enum","type":"StoryPlotKind"},{"name":"summary","kind":"scalar","type":"String"},{"name":"effect","kind":"scalar","type":"String"},{"name":"writingTip","kind":"scalar","type":"String"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"scene","kind":"object","type":"StoryScene","relationName":"StoryPlotToStoryScene"},{"name":"incomingSceneRefs","kind":"object","type":"StorySceneRef","relationName":"StorySceneRefTargetPlot"}],"dbName":null},"StorySceneRef":{"fields":[{"name":"id","kind":"scalar","type":"Int"},{"name":"sceneId","kind":"scalar","type":"Int"},{"name":"sortOrder","kind":"scalar","type":"Int"},{"name":"relation","kind":"scalar","type":"String"},{"name":"rawTarget","kind":"scalar","type":"String"},{"name":"targetKind","kind":"enum","type":"StoryRefTargetKind"},{"name":"targetThreadId","kind":"scalar","type":"Int"},{"name":"targetSceneId","kind":"scalar","type":"Int"},{"name":"targetPlotId","kind":"scalar","type":"Int"},{"name":"visibility","kind":"enum","type":"StoryRefVisibility"},{"name":"note","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"DateTime"},{"name":"updatedAt","kind":"scalar","type":"DateTime"},{"name":"scene","kind":"object","type":"StoryScene","relationName":"StorySceneRefs"},{"name":"targetThread","kind":"object","type":"StoryThread","relationName":"StorySceneRefTargetThread"},{"name":"targetScene","kind":"object","type":"StoryScene","relationName":"StorySceneRefTargetScene"},{"name":"targetPlot","kind":"object","type":"StoryPlot","relationName":"StorySceneRefTargetPlot"}],"dbName":null}},"enums":{},"types":{}}');
    config.compilerWasm = {
      getRuntime: async () => await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs"),
      getQueryCompilerWasmModule: async () => {
        const { wasm } = await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs");
        return await decodeBase64AsWasm(wasm);
      },
      importName: "./query_compiler_fast_bg.js"
    };
  }
});

// server/generated/prisma/internal/prismaNamespace.ts
import * as runtime2 from "@prisma/client/runtime/client";
var getExtensionContext, NullTypes2, TransactionIsolationLevel, defineExtension;
var init_prismaNamespace = __esm({
  "server/generated/prisma/internal/prismaNamespace.ts"() {
    "use strict";
    init_class();
    getExtensionContext = runtime2.Extensions.getExtensionContext;
    NullTypes2 = {
      DbNull: runtime2.NullTypes.DbNull,
      JsonNull: runtime2.NullTypes.JsonNull,
      AnyNull: runtime2.NullTypes.AnyNull
    };
    TransactionIsolationLevel = runtime2.makeStrictEnum({
      ReadUncommitted: "ReadUncommitted",
      ReadCommitted: "ReadCommitted",
      RepeatableRead: "RepeatableRead",
      Serializable: "Serializable"
    });
    defineExtension = runtime2.Extensions.defineExtension;
  }
});

// server/generated/prisma/client.ts
import * as path6 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import "@prisma/client/runtime/client";
var PrismaClient;
var init_client = __esm({
  "server/generated/prisma/client.ts"() {
    "use strict";
    init_enums();
    init_class();
    init_prismaNamespace();
    init_enums();
    init_enums();
    globalThis["__dirname"] = path6.dirname(fileURLToPath3(import.meta.url));
    PrismaClient = getPrismaClientClass();
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
          novelId: stringifyEntityId(story.novelId),
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
  if (currentDatabaseKind() === "sqlite") {
    await prismaClient.$executeRawUnsafe(
      `INSERT INTO "DatabaseLock" ("key", "updatedAt") VALUES (${String(lockKey)}, CURRENT_TIMESTAMP) ON CONFLICT("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP`
    );
    return;
  }
  await prismaClient.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${String(lockKey)})`);
}
var init_locks = __esm({
  "server/database/locks.ts"() {
    "use strict";
    init_config();
  }
});

// server/plot/repositories/prisma-plot-data.repository.ts
var PrismaPlotDataRepository;
var init_prisma_plot_data_repository = __esm({
  "server/plot/repositories/prisma-plot-data.repository.ts"() {
    "use strict";
    init_locks();
    PrismaPlotDataRepository = class {
      constructor(prisma2) {
        this.prisma = prisma2;
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
      /**
       * 查询小说基础信息。
       */
      async findNovelById(novelId) {
        return this.prisma.novel.findUnique({
          where: { id: novelId },
          select: {
            id: true,
            title: true,
            summary: true,
            workspaceSlug: true
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
      constructor(prisma2) {
        this.prisma = prisma2;
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
      constructor(prisma2) {
        this.prisma = prisma2;
      }
      /**
       * 按 novelId 查询 Story。
       */
      async findStoryByNovelId(novelId) {
        return this.prisma.story.findUnique({
          where: { novelId }
        });
      }
      /**
       * 为指定小说创建或读取 Story。
       */
      async upsertStoryForNovel(input) {
        return this.prisma.story.upsert({
          where: { novelId: input.novelId },
          update: {},
          create: {
            novelId: input.novelId,
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
      constructor(prisma2) {
        this.prisma = prisma2;
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
function throwPlotNotFound(message) {
  throw createError({
    statusCode: 404,
    message
  });
}
function throwPlotBadRequest(message) {
  throw createError({
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
var PlotScopeGuard;
var init_plot_scope_guard = __esm({
  "server/plot/services/plot-scope.guard.ts"() {
    "use strict";
    init_workspace_files();
    init_errors();
    PlotScopeGuard = class {
      constructor(storyRepository, threadRepository, sceneRepository, plotRepository, lookupRepository) {
        this.storyRepository = storyRepository;
        this.threadRepository = threadRepository;
        this.sceneRepository = sceneRepository;
        this.plotRepository = plotRepository;
        this.lookupRepository = lookupRepository;
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
       * 校验章节路径属于当前小说 workspace。
       */
      async assertChapterPath(novelId, chapterPath) {
        const normalized = chapterPath.trim().replace(/\\/g, "/").replace(/^workspace\//, "");
        if (!normalized) {
          throwPlotBadRequest("chapterPath \u4E0D\u80FD\u4E3A\u7A7A");
        }
        if (!normalized.startsWith("manuscript/")) {
          throwPlotBadRequest("chapterPath \u5FC5\u987B\u4F4D\u4E8E manuscript/ \u4E0B");
        }
        if (!normalized.endsWith("/")) {
          throwPlotBadRequest("chapterPath \u5FC5\u987B\u6307\u5411\u76EE\u5F55\u8DEF\u5F84\u5E76\u4EE5 / \u7ED3\u5C3E");
        }
        const novel = await this.lookupRepository.findNovelById(novelId);
        if (!novel) {
          throwPlotNotFound("\u5C0F\u8BF4\u4E0D\u5B58\u5728");
        }
        const node = await statWorkspacePath(`workspace/${novel.workspaceSlug}`, normalized).catch(() => null);
        if (!node || !node.isDirectory || !node.contentNode || node.entryType !== "chapter") {
          throwPlotNotFound("\u7AE0\u8282\u4E0D\u5B58\u5728");
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
    init_errors();
    init_order_service();
    init_plot_scope_guard();
    StoryService = class {
      constructor(storyRepository, threadRepository, plotRepository, lookupRepository, orderService, assembler, scopeGuard) {
        this.storyRepository = storyRepository;
        this.threadRepository = threadRepository;
        this.plotRepository = plotRepository;
        this.lookupRepository = lookupRepository;
        this.orderService = orderService;
        this.assembler = assembler;
        this.scopeGuard = scopeGuard;
      }
      /**
       * 确保当前小说已有 Story。
       */
      async ensureStory(novelId) {
        const novel = await this.lookupRepository.findNovelById(novelId);
        if (!novel) {
          throwPlotNotFound("\u5C0F\u8BF4\u4E0D\u5B58\u5728");
        }
        return this.storyRepository.upsertStoryForNovel({
          novelId: novel.id,
          title: novel.title,
          summary: novel.summary
        });
      }
      /**
       * 查询 Story DTO。
       */
      async getStoryDto(novelId) {
        const story = await this.ensureStory(novelId);
        return this.assembler.toStoryDto(story);
      }
      /**
       * 更新 Story。
       */
      async updateStory(novelId, patch) {
        const story = await this.ensureStory(novelId);
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
      async getPlotTree(novelId) {
        const story = await this.ensureStory(novelId);
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
      async getPlotWorkbench(novelId) {
        const story = await this.ensureStory(novelId);
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
      async getStoryPhaseDto(novelId, phaseId) {
        const story = await this.ensureStory(novelId);
        const phase = await this.scopeGuard.assertPhase(story.id, phaseId);
        return this.assembler.toStoryPhaseDto(phase);
      }
      /**
       * 创建剧情阶段。
       */
      async createStoryPhase(novelId, input) {
        const story = await this.ensureStory(novelId);
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
      async updateStoryPhase(novelId, phaseId, patch) {
        const story = await this.ensureStory(novelId);
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
      async deleteStoryPhase(novelId, phaseId) {
        const story = await this.ensureStory(novelId);
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
      async reorderStoryPhases(novelId, items) {
        const story = await this.ensureStory(novelId);
        const existingPhaseIds = await this.scopeGuard.listPhaseIds(story.id);
        const parsedItems = this.orderService.validatePhaseReorderItems(existingPhaseIds, items);
        for (const item of parsedItems) {
          await this.storyRepository.updatePhase(item.phaseId, { sortOrder: item.sortOrder });
        }
        return this.getPlotTree(novelId);
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
      async getStoryPlotDto(novelId, plotId) {
        const story = await this.storyService.ensureStory(novelId);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        return this.assembler.toStoryPlotDto(plot);
      }
      /**
       * 创建情节点。
       */
      async createStoryPlot(novelId, input) {
        const story = await this.storyService.ensureStory(novelId);
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
      async updateStoryPlot(novelId, plotId, patch) {
        const story = await this.storyService.ensureStory(novelId);
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
      async deleteStoryPlot(novelId, plotId) {
        const story = await this.storyService.ensureStory(novelId);
        const plot = await this.scopeGuard.assertPlot(story.id, plotId);
        await this.plotRepository.deletePlot(plot.id);
        await this.orderService.normalizePlots(plot.sceneId);
      }
      /**
       * 批量重排情节点。
       */
      async reorderStoryPlots(novelId, items) {
        const story = await this.storyService.ensureStory(novelId);
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
        return this.storyService.getPlotTree(novelId);
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
      constructor(lookupRepository, threadRepository, scopeGuard) {
        this.lookupRepository = lookupRepository;
        this.threadRepository = threadRepository;
        this.scopeGuard = scopeGuard;
      }
      /**
       * 解析 refs。
       */
      async resolveRefs(novelId, storyId, refs) {
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
      async getStorySceneDetailDto(novelId, sceneId) {
        const story = await this.storyService.ensureStory(novelId);
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
      async getChapterPlotDetailDto(novelId, chapterPath) {
        const normalizedChapterPath = await this.scopeGuard.assertChapterPath(novelId, chapterPath);
        const scenes = await this.sceneRepository.findChapterScenesWithPlots(normalizedChapterPath);
        return this.assembler.toChapterPlotDetailDto(normalizedChapterPath, scenes);
      }
      /**
       * 创建场景。
       */
      async createStoryScene(novelId, input) {
        const story = await this.storyService.ensureStory(novelId);
        await this.scopeGuard.assertThread(story.id, input.threadId);
        const chapterPath = input.chapterPath === null ? null : await this.scopeGuard.assertChapterPath(novelId, input.chapterPath);
        const refs = input.resolvedRefs ?? await this.refResolverService.resolveRefs(novelId, story.id, input.refs);
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
        return this.getStorySceneDetailDto(novelId, scene.id);
      }
      /**
       * 更新场景。
       */
      async updateStoryScene(novelId, sceneId, patch) {
        const story = await this.storyService.ensureStory(novelId);
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        const nextThreadId = patch.threadId === void 0 ? scene.threadId : patch.threadId;
        const nextChapterPath = patch.chapterPath === void 0 ? scene.chapterPath : patch.chapterPath === null ? null : await this.scopeGuard.assertChapterPath(novelId, patch.chapterPath);
        const threadChanged = nextThreadId !== scene.threadId;
        const chapterChanged = nextChapterPath !== scene.chapterPath;
        if (threadChanged) {
          await this.scopeGuard.assertThread(story.id, nextThreadId);
        }
        const refs = patch.refs === void 0 ? null : patch.resolvedRefs ?? await this.refResolverService.resolveRefs(novelId, story.id, patch.refs);
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
        return this.getStorySceneDetailDto(novelId, scene.id);
      }
      /**
       * 删除场景。
       */
      async deleteStoryScene(novelId, sceneId) {
        const story = await this.storyService.ensureStory(novelId);
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        await this.sceneRepository.deleteScene(scene.id);
        await this.orderService.normalizeSceneThread(scene.threadId);
        await this.orderService.normalizeSceneChapter(scene.chapterPath);
      }
      /**
       * 批量重排场景。
       */
      async reorderStoryScenes(novelId, items) {
        const story = await this.storyService.ensureStory(novelId);
        const [existingSceneIds, existingThreadIds] = await Promise.all([
          this.sceneRepository.findSceneIdsByStory(story.id),
          this.scopeGuard.listThreadIds(story.id)
        ]);
        for (const item of items) {
          if (item.chapterPath !== null) {
            item.chapterPath = await this.scopeGuard.assertChapterPath(novelId, item.chapterPath);
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
        return this.storyService.getPlotTree(novelId);
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
      async getStoryThreadDetailDto(novelId, threadId) {
        const story = await this.storyService.ensureStory(novelId);
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
      async createStoryThread(novelId, input) {
        const story = await this.storyService.ensureStory(novelId);
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
        return this.getStoryThreadDetailDto(novelId, thread.id);
      }
      /**
       * 更新线程。
       */
      async updateStoryThread(novelId, threadId, patch) {
        const story = await this.storyService.ensureStory(novelId);
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
        return this.getStoryThreadDetailDto(novelId, thread.id);
      }
      /**
       * 删除线程。
       */
      async deleteStoryThread(novelId, threadId) {
        const story = await this.storyService.ensureStory(novelId);
        const thread = await this.scopeGuard.assertThread(story.id, threadId);
        await this.threadRepository.deleteThread(thread.id);
        await this.orderService.normalizeThreads(story.id, thread.storyPhaseId);
      }
      /**
       * 批量重排线程。
       */
      async reorderStoryThreads(novelId, items) {
        const story = await this.storyService.ensureStory(novelId);
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
        return this.storyService.getPlotTree(novelId);
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
var PlotFacade;
var init_plot_facade = __esm({
  "server/plot/facade/plot.facade.ts"() {
    "use strict";
    init_client();
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
    init_content_middleware();
    init_reference_core();
    PlotFacade = class {
      constructor(prisma2) {
        this.prisma = prisma2;
      }
      /**
       * 查询 Story。
       */
      async getStoryDto(novelId) {
        return this.createModule(this.prisma).storyService.getStoryDto(novelId);
      }
      /**
       * 更新 Story。
       */
      async updateStory(novelId, patch) {
        return this.runInTransaction((module) => module.storyService.updateStory(novelId, patch));
      }
      /**
       * 查询剧情树。
       */
      async getPlotTree(novelId) {
        return this.createModule(this.prisma).storyService.getPlotTree(novelId);
      }
      /**
       * 查询剧本工作台聚合数据。
       */
      async getPlotWorkbench(novelId) {
        return this.createModule(this.prisma).storyService.getPlotWorkbench(novelId);
      }
      /**
       * 查询阶段详情。
       */
      async getStoryPhaseDto(novelId, phaseId) {
        return this.createModule(this.prisma).storyService.getStoryPhaseDto(novelId, phaseId);
      }
      /**
       * 创建阶段。
       */
      async createStoryPhase(novelId, input) {
        return this.runInTransaction((module) => module.storyService.createStoryPhase(novelId, input));
      }
      /**
       * 更新阶段。
       */
      async updateStoryPhase(novelId, phaseId, patch) {
        return this.runInTransaction((module) => module.storyService.updateStoryPhase(novelId, phaseId, patch));
      }
      /**
       * 删除阶段。
       */
      async deleteStoryPhase(novelId, phaseId) {
        await this.runInTransaction((module) => module.storyService.deleteStoryPhase(novelId, phaseId));
      }
      /**
       * 重排阶段。
       */
      async reorderStoryPhases(novelId, input) {
        return this.runInTransaction((module) => module.storyService.reorderStoryPhases(novelId, module.inputParser.parseReorderPhases(input)));
      }
      /**
       * 查询线程详情。
       */
      async getStoryThreadDetailDto(novelId, threadId) {
        return this.createModule(this.prisma).threadService.getStoryThreadDetailDto(novelId, threadId);
      }
      /**
       * 创建线程。
       */
      async createStoryThread(novelId, input) {
        const processedInput = processTextFieldsWithResults(input, ["summary", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
          const detail = await module.threadService.createStoryThread(novelId, module.inputParser.parseCreateThread({
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
      async updateStoryThread(novelId, threadId, patch) {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
          const detail = await module.threadService.updateStoryThread(
            novelId,
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
      async deleteStoryThread(novelId, threadId) {
        await this.runInTransaction((module) => module.threadService.deleteStoryThread(novelId, threadId));
      }
      /**
       * 重排线程。
       */
      async reorderStoryThreads(novelId, input) {
        return this.runInTransaction((module) => module.threadService.reorderStoryThreads(novelId, module.inputParser.parseReorderThreads(input)));
      }
      /**
       * 查询 Scene 详情。
       */
      async getStorySceneDetailDto(novelId, sceneId) {
        return this.createModule(this.prisma).sceneService.getStorySceneDetailDto(novelId, sceneId);
      }
      /**
       * 查询章节下的剧情 Scene 与 Plot。
       */
      async getChapterPlotDetailDto(novelId, chapterPath) {
        return this.createModule(this.prisma).sceneService.getChapterPlotDetailDto(novelId, chapterPath);
      }
      /**
       * 创建 Scene。
       */
      async createStoryScene(novelId, input) {
        const processedInput = processTextFieldsWithResults(input, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
          const story = await module.storyService.ensureStory(novelId);
          const processedRefs = await processStructuredReferences({
            refs: processedInput.values.refs ?? [],
            allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
            label: "plot",
            resolve: (nextRefs) => module.refResolverService.resolveRefs(novelId, story.id, nextRefs)
          });
          const detail = await module.sceneService.createStoryScene(novelId, module.inputParser.parseCreateScene({
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
      async updateStoryScene(novelId, sceneId, patch) {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "purpose", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
          const story = await module.storyService.ensureStory(novelId);
          const processedRefs = processedPatch.values.refs === void 0 ? null : await processStructuredReferences({
            refs: processedPatch.values.refs,
            allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
            label: "plot",
            resolve: (nextRefs) => module.refResolverService.resolveRefs(novelId, story.id, nextRefs)
          });
          const detail = await module.sceneService.updateStoryScene(
            novelId,
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
      async deleteStoryScene(novelId, sceneId) {
        await this.runInTransaction((module) => module.sceneService.deleteStoryScene(novelId, sceneId));
      }
      /**
       * 重排 Scene。
       */
      async reorderStoryScenes(novelId, input) {
        return this.runInTransaction((module) => module.sceneService.reorderStoryScenes(novelId, module.inputParser.parseReorderScenes(input)));
      }
      /**
       * 查询 Plot 详情。
       */
      async getStoryPlotDto(novelId, plotId) {
        return this.createModule(this.prisma).plotService.getStoryPlotDto(novelId, plotId);
      }
      /**
       * 创建 Plot。
       */
      async createStoryPlot(novelId, input) {
        const processedInput = processTextFieldsWithResults(input, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
          const detail = await module.plotService.createStoryPlot(
            novelId,
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
      async updateStoryPlot(novelId, plotId, patch) {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "effect", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
          const detail = await module.plotService.updateStoryPlot(
            novelId,
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
      async deleteStoryPlot(novelId, plotId) {
        await this.runInTransaction((module) => module.plotService.deleteStoryPlot(novelId, plotId));
      }
      /**
       * 重排 Plot。
       */
      async reorderStoryPlots(novelId, input) {
        return this.runInTransaction((module) => module.plotService.reorderStoryPlots(novelId, module.inputParser.parseReorderPlots(input)));
      }
      /**
       * 在事务里执行写操作。
       */
      runInTransaction(callback) {
        return this.prisma.$transaction(async (transactionClient) => {
          return callback(this.createModule(transactionClient));
        });
      }
      /**
       * 按执行器构建剧情模块对象图。
       */
      createModule(executor) {
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
          plotRepository,
          plotRepository
        );
        const storyService = new StoryService(
          storyRepository,
          threadRepository,
          plotRepository,
          plotRepository,
          orderService,
          assembler,
          scopeGuard
        );
        const refResolverService = new RefResolverService(plotRepository, threadRepository, scopeGuard);
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

// server/database/prisma.ts
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaPg } from "@prisma/adapter-pg";
var globalForPrisma, createPrismaClient, usePrismaClient, prisma;
var init_prisma = __esm({
  "server/database/prisma.ts"() {
    "use strict";
    init_client();
    init_config();
    init_client();
    globalForPrisma = globalThis;
    createPrismaClient = () => {
      const config2 = resolveDatabaseConfig();
      const adapter = config2.kind === "sqlite" ? new PrismaLibSql({ url: config2.url }) : new PrismaPg({ connectionString: config2.url });
      return new PrismaClient({
        adapter
      });
    };
    usePrismaClient = () => {
      if (!globalForPrisma.prismaClient) {
        globalForPrisma.prismaClient = createPrismaClient();
      }
      return globalForPrisma.prismaClient;
    };
    prisma = usePrismaClient();
  }
});

// server/utils/prisma.ts
var prisma_exports = {};
__export(prisma_exports, {
  prisma: () => prisma,
  usePrismaClient: () => usePrismaClient
});
var init_prisma2 = __esm({
  "server/utils/prisma.ts"() {
    "use strict";
    init_prisma();
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
    init_prisma2();
    plotFacade = new PlotFacade(prisma);
  }
});

// assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx
import { readFile } from "node:fs/promises";
import { dirname as dirname2, isAbsolute, join as join4, posix, relative as relative2, resolve as resolve2 } from "node:path";
import { z as z7 } from "zod";

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
var PLOT_SELECTION_STATE_KEY = "plot.selection";
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
      const lines = [
        "<dynamic-context>",
        `Agent cwd: ${ctx.session.workspaceRoot}`,
        readCurrentProjectWorkspace(ctx) ? `Current Project Workspace: ${readCurrentProjectWorkspace(ctx)}` : "",
        ctx.session.novelId ? `Current novelId: ${ctx.session.novelId}` : "",
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
function ProjectReminder(props = {}) {
  return Reminder({
    id: props.id ?? "project",
    watchPath: "ctx.workspace.currentProject",
    repeatEveryTurns: props.repeatEveryTurns ?? 20,
    children: Message({ children: ProjectReminderText() })
  });
}
function LinkedAgentsReminder(props = {}) {
  return Reminder({
    id: props.id ?? "linked-agents",
    watchPath: "ctx.session.linkedAgents",
    repeatEveryTurns: props.repeatEveryTurns,
    children: Message({ children: LinkedAgentsReminderText() })
  });
}
function TaskReminder(props = {}) {
  const stateKey = props.stateKey ?? AGENT_TASKS_STATE_KEY;
  return Reminder({
    id: props.id ?? "tasks",
    watchPath: stateKeyPath(stateKey),
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
    watchPath: `${stateKeyPath(stateKey)}.active`,
    children: Message({ children: PlanModeReminderText({ stateKey }) })
  });
}
function MentionedSkillsReminder(_props = {}) {
  return {
    kind: "StringFragment",
    text: mentionedSkillsReminderText
  };
}
function PlotFocusReminder(props = {}) {
  return Reminder({
    id: props.id ?? "plot-focus",
    watchPath: stateKeyPath(PLOT_SELECTION_STATE_KEY),
    repeatEveryTurns: props.repeatEveryTurns,
    children: Message({ children: PlotFocusReminderText() })
  });
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
  const currentValue = node.watch ? await node.watch(state.context) : node.watchPath ? readPath(state.context, node.watchPath) : node.watchValue;
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
  const currentValue = node.path ? readPath(state.context, node.path) : node.value;
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
  if (!["ctx.session", "ctx.input", "ctx.runtime", "ctx.workspace"].some((prefix) => path8 === prefix || path8.startsWith(`${prefix}.`))) {
    throw new Error(`${label} \u53EA\u80FD\u4ECE ctx.session\u3001ctx.input\u3001ctx.runtime\u3001ctx.workspace \u5F00\u59CB\uFF1A${path8}`);
  }
}
function readPath(context, path8) {
  const customStatePrefix = "ctx.session.customState.";
  if (path8.startsWith(customStatePrefix)) {
    const customPath = path8.slice(customStatePrefix.length);
    const matchedKey = Object.keys(context.session.customState).filter((key) => customPath === key || customPath.startsWith(`${key}.`)).sort((left, right) => right.length - left.length)[0];
    if (matchedKey) {
      const value = context.session.customState[matchedKey];
      const rest2 = customPath === matchedKey ? [] : customPath.slice(matchedKey.length + 1).split(".");
      return readObjectPath(value, rest2);
    }
  }
  const roots = {
    "ctx.session": context.session,
    "ctx.input": context.input,
    "ctx.runtime": {
      now: context.runtime?.now ?? new Date(now()).toISOString(),
      promptUserTurnCount: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
      pendingUserMessage: context.runtime?.pendingUserMessage
    },
    "ctx.workspace": {
      root: context.session.workspaceRoot,
      currentProject: readCurrentProjectWorkspace(context),
      novelId: context.session.novelId
    }
  };
  const rootKey = Object.keys(roots).find((key) => path8 === key || path8.startsWith(`${key}.`));
  if (!rootKey) {
    return void 0;
  }
  const rest = path8 === rootKey ? [] : path8.slice(rootKey.length + 1).split(".");
  return readObjectPath(roots[rootKey], rest);
}
function readObjectPath(value, rest) {
  let current = value;
  for (const segment of rest) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      return void 0;
    }
    current = current[segment];
  }
  return toJsonValue(current);
}
function toJsonValue(value) {
  if (value === void 0) {
    return void 0;
  }
  return JSON.parse(JSON.stringify(value));
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
function stateKeyPath(key) {
  return `ctx.session.customState.${key}`;
}
function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function readInputRole(ctx) {
  const input = readRecord(ctx.input);
  return typeof input.role === "string" ? input.role : "";
}
function readCurrentProjectWorkspace(ctx) {
  const input = readRecord(ctx.input);
  const studio = readRecord(input.studio);
  return typeof studio.workspace === "string" ? studio.workspace : "";
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
function ProjectReminderText() {
  return {
    kind: "StringFragment",
    text: (ctx) => systemReminder([
      `Agent cwd: ${ctx.session.workspaceRoot}`,
      readCurrentProjectWorkspace(ctx) ? `Current Project Workspace: ${readCurrentProjectWorkspace(ctx)}` : "",
      ctx.session.novelId ? `Current novelId: ${ctx.session.novelId}` : "",
      "- Bash/read/write/edit/apply_patch relative paths resolve from Agent cwd.",
      "- Use Project Workspace paths such as novel-7/lorebook/... or novel-7/manuscript/... for the current novel when Agent cwd is workspace.",
      "- Cross-project work is allowed when the user asks; keep paths explicit so the target Project Workspace is clear."
    ].filter(Boolean).join("\n"))
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
function PlotFocusReminderText() {
  return {
    kind: "StringFragment",
    text: (ctx) => {
      const selection = readRecord(ctx.session.customState[PLOT_SELECTION_STATE_KEY]);
      const novelId = typeof selection.novelId === "string" ? selection.novelId : "";
      const threadId = typeof selection.threadId === "string" ? selection.threadId : "";
      const sceneId = typeof selection.sceneId === "string" ? selection.sceneId : "";
      if (!novelId && !threadId && !sceneId) {
        return "";
      }
      return systemReminder([
        "Current plot focus:",
        novelId ? `- novelId: ${novelId}` : "",
        threadId ? `- Thread: ${threadId}` : "",
        sceneId ? `- Scene: ${sceneId}` : "",
        "Plot tools may reuse threadId/sceneId from plot.selection, but novelId must still be passed explicitly."
      ].filter(Boolean).join("\n"));
    }
  };
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
async function defaultSqlSchemaSummaryText() {
  try {
    const { getAgentSqlSchemaSummary: getAgentSqlSchemaSummary2 } = await Promise.resolve().then(() => (init_sql_tool(), sql_tool_exports));
    return [
      "<sql-schema-summary>",
      'PostgreSQL folds unquoted identifiers to lowercase. Double-quote business tables with uppercase letters and camelCase columns, e.g. "novelId", "createdAt", "sortOrder". Otherwise SQL may fail with column does not exist.',
      await getAgentSqlSchemaSummary2(),
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

// server/agent/profiles/builtin-contracts.ts
import { Type as Type2 } from "typebox";
var LeaderDefaultInputSchema = Type2.Object({
  role: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u7684\u8FD0\u884C\u89D2\u8272\u63D0\u793A\uFF0C\u7528\u4E8E\u8BA9 leader \u5728\u9ED8\u8BA4\u534F\u4F5C\u6A21\u5F0F\u4E4B\u5916\u4E34\u65F6\u504F\u5411\u67D0\u4E2A\u5DE5\u4F5C\u8EAB\u4EFD\u3002" }))
});
var LeaderDefaultOutputSchema = Type2.Object({
  result: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u603B\u7ED3\u6587\u672C\u3002leader.default \u901A\u5E38\u4E0D\u8981\u6C42 report_result\u3002" }))
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
  targetProfile: Type2.String({ description: "\u53EC\u56DE\u7ED3\u679C\u8981\u670D\u52A1\u7684\u76EE\u6807 profile\uFF0C\u4F8B\u5982 writer\u3002" }),
  task: Type2.String({ description: "\u8C03\u7528\u65B9\u7684\u4E0A\u5C42\u4EFB\u52A1\u76EE\u6807\uFF0C\u8BF4\u660E\u4E3A\u4EC0\u4E48\u9700\u8981\u68C0\u7D22\u8FD9\u4E9B\u5185\u5BB9\u8282\u70B9\u3002" }),
  prompt: Type2.String({ description: "\u68C0\u7D22\u63D0\u793A\u8BCD\u3002\u53EF\u4EE5\u5305\u542B\u4EBA\u7269\u3001\u5730\u70B9\u3001\u51B2\u7A81\u3001\u7AE0\u8282\u76EE\u6807\u3001\u5173\u952E\u8BCD\u548C\u6392\u9664\u9879\u3002" }),
  chapterOutline: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u7AE0\u8282\u5927\u7EB2\uFF0C\u7528\u4E8E\u5E2E\u52A9 retrieval \u5224\u65AD\u76F8\u5173\u8282\u70B9\u3002" })),
  recentText: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u6700\u8FD1\u6B63\u6587\u6216\u8349\u7A3F\u7247\u6BB5\uFF0C\u7528\u4E8E\u53EC\u56DE\u4E0E\u5F53\u524D\u6BB5\u843D\u6700\u76F8\u5173\u7684\u8282\u70B9\u3002" })),
  constraints: Type2.Optional(Type2.Array(Type2.String({ description: "\u68C0\u7D22\u9650\u5236\uFF0C\u4F8B\u5982\u53EA\u67E5 active \u8282\u70B9\u3001\u6392\u9664\u67D0\u7C7B\u8282\u70B9\u3001\u6700\u591A\u67D0\u7C7B\u7ED3\u679C\u3002" }), { description: "\u68C0\u7D22\u7EA6\u675F\u5217\u8868\u3002" })),
  maxEntries: Type2.Optional(Type2.Number({ description: "\u6700\u591A\u8FD4\u56DE\u591A\u5C11\u4E2A\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u3002" }))
});
var RetrievalOutputSchema = Type2.Array(Type2.Object({
  path: Type2.String({ description: "\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u3002Leader \u8C03 writer \u65F6\u53EA\u628A\u8FD9\u4E2A path \u63D0\u53D6\u5230 writer.lorebookEntries\u3002" }),
  reason: Type2.Optional(Type2.String({ description: "\u4E3A\u4EC0\u4E48\u53EC\u56DE\u8BE5\u8282\u70B9\uFF0C\u4F9B Leader \u5224\u65AD\u662F\u5426\u4F20\u7ED9 writer\u3002" })),
  summary: Type2.Optional(Type2.String({ description: "\u8282\u70B9\u548C\u4EFB\u52A1\u7684\u76F8\u5173\u6458\u8981\uFF0C\u4F9B Leader \u5FEB\u901F\u5224\u65AD\u3002" })),
  priority: Type2.Optional(Type2.Number({ description: "\u4F18\u5148\u7EA7\uFF0C\u6570\u5B57\u8D8A\u5C0F\u8D8A\u91CD\u8981\u3002" })),
  writingTip: Type2.Optional(Type2.String({ description: "\u53EF\u9009\u5199\u4F5C\u4F7F\u7528\u5EFA\u8BAE\uFF0C\u4F9B Leader \u9605\u8BFB\uFF1B\u4E0D\u8981\u4F20\u7ED9 writer\u3002" }))
}), { description: "\u6309\u4F18\u5148\u7EA7\u6392\u5E8F\u7684\u5185\u5BB9\u8282\u70B9\u53EC\u56DE\u8BE6\u60C5\u6570\u7EC4\u3002" });

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
import { z as z3 } from "zod";

// server/assets/asset-resolver.ts
import fs3 from "node:fs/promises";
import os from "node:os";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// server/workspace-files/novel-workspace.ts
import fs2 from "node:fs/promises";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
init_novel_chapter();

// server/agent/profiles/profile-artifact-compiler.ts
import { build } from "esbuild";

// server/workspace-files/novel-workspace.ts
var WORKSPACE_CONTAINER_ROOT = "workspace";
var USER_ASSETS_WORKSPACE_ROOT = path2.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
var USER_NBOOK_ROOT = path2.posix.join(WORKSPACE_CONTAINER_ROOT, ".nbook");
var SYSTEM_WORKSPACE_ROOT = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "../../assets/workspace");
var SYSTEM_NBOOK_ROOT = path2.join(SYSTEM_WORKSPACE_ROOT, ".nbook");
var SYSTEM_PROFILE_ROOT = path2.join(SYSTEM_NBOOK_ROOT, "agent", "profiles");
var USER_PROFILE_ROOT = path2.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "profiles");
var SYSTEM_WRITING_PRESETS_ROOT = path2.join(SYSTEM_NBOOK_ROOT, "agent", "writing-presets");
var USER_WRITING_PRESETS_ROOT = path2.resolve(process.cwd(), USER_NBOOK_ROOT, "agent", "writing-presets");
var SYSTEM_PROFILE_METADATA_PATH = path2.join(SYSTEM_PROFILE_ROOT, ".system-profile-metadata.json");
var USER_PROFILE_SYNC_STATE_PATH = path2.join(USER_PROFILE_ROOT, ".profile-sync-state.json");
var NOVEL_DIRECTORY_TEMPLATE_ROOT = path2.join(SYSTEM_NBOOK_ROOT, "templates", "novel-directory-templates");
var USER_NOVEL_DIRECTORY_TEMPLATE_ROOT = path2.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT, "templates", "novel-directory-templates");
async function ensureUserAssetsWorkspaceRoot() {
  const workspaceRoot = path2.resolve(process.cwd(), USER_ASSETS_WORKSPACE_ROOT);
  await fs2.mkdir(workspaceRoot, { recursive: true });
  return USER_ASSETS_WORKSPACE_ROOT;
}

// server/assets/asset-resolver.ts
var SYSTEM_ASSETS_ROOT = path3.resolve(path3.dirname(fileURLToPath2(import.meta.url)), "../../assets/workspace/.nbook");
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
var WritingReferenceFrontmatterSchema = z3.object({
  key: z3.string().min(1),
  label: z3.string().min(1),
  sourceTitle: z3.string().min(1),
  sourceChapters: z3.string().min(1),
  generatedFrom: z3.string().min(1)
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
import { z as z4 } from "zod";
var DEFAULT_WRITING_STYLE_PRESET = "reborn-villain-loli-magic-girl.first-three-chapters.style";
var WRITING_STYLE_DIR_CANDIDATES = [
  path5.join(assetResolver.systemRoot, "agent", "writing-presets", "styles"),
  path5.join(assetResolver.userRoot, "agent", "writing-presets", "styles")
];
var WritingStyleFrontmatterSchema = z4.object({
  key: z4.string().min(1),
  label: z4.string().min(1),
  sourcePreset: z4.string().min(1),
  identifier: z4.string().min(1),
  name: z4.string().min(1),
  enabled: z4.boolean().nullable(),
  role: z4.string().nullable()
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
init_novel_chapter();

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
  ProjectReminder,
  LinkedAgentsReminder,
  TaskReminder,
  PlanModeReminder,
  PlanModeFull,
  PlanModeSparse,
  PlanModeExit,
  PlanModeReentry,
  ActivePlanModeReminder,
  MentionedSkillsReminder,
  PlotFocusReminder,
  AgentCatalog,
  SkillCatalog,
  ActivatedSkills,
  SqlSchemaSummary
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
var profileManifest = {
  key: "writer",
  name: "Writer",
  description: "\u4E13\u7528\u6B63\u6587\u5199\u4F5C agent\uFF0C\u4FDD\u7559\u5C0F\u732B\u4E4B\u795E persona\u3001\u5199\u4F5C\u98CE\u683C\u7EA6\u675F\u548C\u53C2\u8003\u6587\u6863\u6D41\u7A0B\u3002"
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
  const chapterTargets = await resolveWriterChapterTargets(ctx);
  const chapterPlotsText = renderChapterPlotsText(chapterTargets);
  const lorebookText = await buildLorebookText(ctx.session.workspaceRoot, ctx.input.lorebookEntries ?? []);
  return /* @__PURE__ */ jsxs(ProfilePrompt, { children: [
    /* @__PURE__ */ jsx(System, { children: renderSystemPrompt({ writingStyle, writingReference }) }),
    /* @__PURE__ */ jsx(HistorySet, { children: /* @__PURE__ */ jsx(Message, { children: renderStableWriterContext() }) }),
    /* @__PURE__ */ jsx(ModelContext, { children: /* @__PURE__ */ jsx(Message, { children: renderInputContext(ctx, { chapterTargets, chapterPlotsText, lorebookText }) }) }),
    /* @__PURE__ */ jsx(AppendingSet, { children: /* @__PURE__ */ jsx(Message, { children: `\u3010\u5199\u4F5C\u8981\u6C42\u3011
${ctx.input.prompt}` }) })
  ] });
}
function renderSystemPrompt(input) {
  return profileText`
        你是 Neuro Book 的 Writer 子代理，persona 是“小猫之神”。你是一只具有神力的可爱小猫喵，负责把调用方给出的章节剧情、设定节点和写作约束落实成单章正文或单章修改。

        <assistant_definition>
        <role>小猫之神</role>
        <description>你担任 NeuroBook 系统的 Writer 职位，会为信徒创作轻松愉悦、细腻鲜活、符合任务边界的剧情正文。</description>
        <reminder>你是这个故事的创作者，而不是故事里的任何角色。不要把自己代入角色。</reminder>
        </assistant_definition>

        <neurobook_writer_contract>
        - chapterPaths 对应本 writer session 绑定的唯一章节。调用方必须先创建章节内容节点，并在 Plot System 中把 Scene 挂到该章节。
        - chapterPaths 同时是剧情上下文来源和写入目标。系统会在进入模型前读取本章 Scene、Thread、Plots 和 Chapter Plot；你只写显式传入的这一章，不根据自然语言章节名或 UI active scene 猜测其他落点。
        - lorebookEntries 对应内容节点路径，按 Agent cwd 解析。普通小说 agent 的 cwd 是 workspace 容器根，因此通常应是 novel-slug/lorebook/... 或 novel-slug/manuscript/...。writer 会按数组顺序读取每个节点的 index.md 与同级可选 state.md，并把稳定设定、当前状态和信息差作为写作依据。
        - constraints 对应额外写作约束、格式约束、禁忌和用户临时偏好。
        - prompt 对应用户本次要求写什么、改写什么、补全什么。
        </neurobook_writer_contract>

        # 工作边界

        - 你是创作者，不是故事里的角色。不要把自己代入正文人物。
        - 只根据输入里的 prompt、chapterPaths、chapter_plots、lorebookEntries 和 constraints 写作，不擅自新增关键世界观事实。
        - 目标章节 index.md 是唯一文件落点。默认根据 prompt 判断重写或局部修改；需要完整成稿时可以用 write，局部改写或润色优先用 edit / apply_patch。
        - 完成后必须调用 report_result。walkthrough 说明写入路径、润色情况和约 100 字剧情总结；data.summary 给出本次写作摘要，data.outputPath 仅在真实写入文件时提供。

        # 写作流程

        1. 读取必要上下文：先 read 目标章节 index.md；lorebookEntries 已足够时不要额外检索。
        2. 写入或生成正文：正文采用完整自然段，不把分析、工具说明、summary 混入正文。
        3. 润色复查：检查写作风格、视角边界、角色表现、禁用词和剧情点覆盖度。
        4. 修改成稿：局部修改用 edit；成块统一变更才用 apply_patch。
        5. report_result 结束。

        # 小猫之神思考要求

        思考时可以用可爱俏皮的第一人称喵喵叫，但正文和交付内容必须服务作品本身。先确认写作对象、场景目标、必须覆盖的剧情点、设定边界、角色知道/不知道的信息，再动笔。
        思考顺序：确认目标章节和正文边界；回顾 chapter_plots；逐条回顾 lorebookEntries；整理 constraints；辨别视角和信息边界；规划角色动作、互动、台词和环境承载的情绪；检查文风禁用项与段落节奏；确认是重写还是局部修改。

        # 文风与正文约束

        - 默认第三人称。除非输入明确要求第一人称、第二人称、书信体、日志体等。
        - 角色情绪要通过动作、选择、停顿、台词、站位、环境互动表达，少用情绪标签解释。
        - 避免全知视角越界：角色的行动、判断、台词和心理反应只能建立在该角色当下可获得的信息上。
        - 正文采用完整长自然段叙述；对话可以独立成段，但不要把每个动作、表情、停顿都拆成单句短段。
        - 禁止词：一丝、不容置疑、不易察觉、几不可察。
        - 禁止句式：他没有……，而是……；不是……，而是……；与其说……不如说是……。

        # 内容节点规则

        内容节点是 NeuroBook 的 workspace 知识单元。lorebook 与 manuscript 都使用“目录 + index.md”的节点结构，同级 state.md 是可选当前状态。
        - index.md 的 frontmatter 是元数据，不是小说正文；不要把字段名、配置项或注释写进故事。
        - index.md 正文是稳定设定、关系、世界规则、角色资料和长期写作约束；state.md 正文与 frontmatter 是当前状态补充。
        - status: active 是已确认事实；draft 使用时要保守；pending 不能当成确定事实；archived 默认不作为当前事实。
        - knowledge[] 只说明谁知道什么、谁误解什么、谁尚不知道什么；它不是全员共享情报。

        # 视角边界与角色表现

        - 角色的行动、判断、台词和心理反应只能建立在该角色当下可获得的信息上。不要因为设定写在节点里，就默认场内每个角色都知道。
        - 秘密、伏笔、地点规则或他人动机，可以写成读者可见的客观现象、误解、试探或遮掩，不能写成角色已经理解。
        - 情绪不要直接贴标签。结合角色性格、经历、处境和关系，用具体动作、沉默、回避、靠近、打断、转移话题、整理物件、站位变化和环境互动表达。
        - 台词本身是情绪载体。不要频繁在台词后挂“声音里带着疲惫”“语气满是委屈”这类解释。

        # 段落节奏与 Markdown 方言

        - 正文采用完整长自然段叙述，不要单句成段。对话可以独立成段，但不要把每一个动作、表情、停顿都拆成短段。
        - 工作区引用使用普通 Markdown link；正式小说正文不要主动塞 inline-comment，除非任务要求批注或审稿意见。
        - 支持 <inline-comment>、<mark>、<span style="color: ...">、<sup>、<sub> 和 <align value="center"> 等 NeuroBook Markdown 扩展，但正式正文只在任务需要时使用。

        # 润色工作流与输出协议

        - 文件写作任务：先 read 目标章节 index.md，write 写入正文或用 edit / apply_patch 修改，必要时 edit 逐处润色；只有成块改动才用 apply_patch；最后 report_result。
        - 如果本轮先用 write 写入新正文，随后必须把该文件视为待润色原文，完成一次复查。
        - 不输出 <summary> 标签，不输出“小猫之神的留言”，不把写作分析、自检过程或替换清单混进正文。
        - report_result.walkthrough 包含已写入或修改的文件路径、润色是否完成，以及剧情总结；data.summary 给出摘要，data.outputPath 仅在真实写入文件时提供。

        # 写作风格与参考文档

        下面的 writing style 与 writing reference 来自 writer assets 机制。系统目录 agent/writing-presets 提供默认预设，用户 assets 中的同名 Markdown 文件可以覆盖系统文件。

        ${input.writingStyle}

        ${input.writingReference}
    `;
}
function renderStableWriterContext() {
  return profileText`
        <system-reminder>
        Writer 使用 v3 文件工具：read / write / edit / apply_patch。不要使用历史版本的文件工具命名。
        Agent cwd 通常是 workspace 容器根。内容节点路径通常是 novel-slug/lorebook/.../ 或 novel-slug/manuscript/.../；目录节点的正文入口是 index.md，同级 state.md 是当前状态。
        chapterPaths 绑定本 writer session 的唯一章节；写作目标是该章节 index.md，不要写 workspace/novel-slug/...。
        frontmatter 是元数据，不是小说正文；不要把字段名或配置项写进故事。
        </system-reminder>
    `;
}
function renderInputContext(ctx, expanded) {
  const input = ctx.input;
  const target = expanded.chapterTargets[0];
  return [
    "<dynamic-context>",
    `Agent cwd: ${ctx.session.workspaceRoot}`,
    target ? `Target chapter: ${target.workspaceChapterPath}` : "",
    target ? `Writing target index.md: ${target.indexPath}` : "",
    target ? `Novel ID: ${String(target.novelId)}` : "",
    input.writingStylePreset ? `Writing style preset: ${input.writingStylePreset}` : "",
    input.writingReferencePreset ? `Writing reference preset: ${input.writingReferencePreset}` : "",
    expanded.lorebookText ? `<lorebook_entries>
${expanded.lorebookText}
</lorebook_entries>` : "",
    expanded.chapterPlotsText ? `<chapter_plots>
${expanded.chapterPlotsText}
</chapter_plots>` : "",
    !expanded.lorebookText && input.lorebookEntries?.length ? [
      "Lorebook entries:",
      ...input.lorebookEntries.map((entry) => `- ${entry}`)
    ].join("\n") : "",
    input.constraints?.length ? ["Constraints:", ...input.constraints.map((item) => `- ${item}`)].join("\n") : "",
    "</dynamic-context>"
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
  const target = await resolveWriterChapterTarget(ctx.session.novelId ?? null, ctx.input.chapterPaths[0]);
  const facade = await loadPlotFacade();
  try {
    const chapterPlot = await facade.getChapterPlotDetailDto(target.novelId, target.chapterPath);
    return [{ ...target, chapterPath: chapterPlot.chapterPath, chapterPlot }];
  } catch (error) {
    throw new Error(`writer \u65E0\u6CD5\u89E3\u6790 chapterPaths[0] \u7AE0\u8282 ${ctx.input.chapterPaths[0]}: ${formatPromptError(error)}`);
  }
}
async function resolveWriterChapterTarget(sessionNovelIdText, rawChapterPath) {
  const normalized = normalizeInputPath(rawChapterPath);
  const currentPrefix = normalizeChapterPath(normalized);
  if (currentPrefix) {
    const novelId2 = resolveSessionNovelId(sessionNovelIdText);
    const workspaceSlug2 = await findWorkspaceSlugByNovelId(novelId2);
    return buildChapterTarget(novelId2, workspaceSlug2, currentPrefix);
  }
  const [workspaceSlug, ...rest] = normalized.split("/");
  const chapterPath = normalizeChapterPath(rest.join("/"));
  if (!workspaceSlug || !chapterPath) {
    throw new Error("chapterPaths \u5FC5\u987B\u662F manuscript/.../ \u6216 novel-slug/manuscript/.../\uFF0C\u4E14\u5FC5\u987B\u6307\u5411\u7AE0\u8282\u76EE\u5F55\u3002");
  }
  const novelId = await findNovelIdByWorkspaceSlug(workspaceSlug);
  return buildChapterTarget(novelId, workspaceSlug, chapterPath);
}
function buildChapterTarget(novelId, workspaceSlug, chapterPath) {
  const workspaceChapterPath = posix.join(workspaceSlug, chapterPath);
  return {
    novelId,
    workspaceSlug,
    chapterPath,
    workspaceChapterPath,
    indexPath: posix.join(workspaceChapterPath, "index.md")
  };
}
function normalizeInputPath(rawPath) {
  return rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^workspace\//, "");
}
function normalizeChapterPath(rawPath) {
  const withoutIndex = rawPath.replace(/\/index\.md$/u, "/");
  if (!withoutIndex.startsWith("manuscript/")) {
    return null;
  }
  return withoutIndex.endsWith("/") ? withoutIndex : `${withoutIndex}/`;
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
    indexRaw = await readFile(indexPath, "utf-8");
  } catch (error) {
    throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u5185\u5BB9\u8282\u70B9 index.md: ${formatPromptError(error)}\u3002\u8282\u70B9\u8DEF\u5F84\uFF1A${entry}`);
  }
  const indexText = sanitizeWriterFacingMarkdown(indexRaw, WRITER_INDEX_FRONTMATTER_KEYS);
  const stateText = await readFile(statePath, "utf-8").then((content) => sanitizeWriterFacingMarkdown(
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
  const relativeToWorkspace = relative2(root, absolutePath);
  if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
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
    `novelId: ${String(target.novelId)}`,
    `workspaceSlug: ${target.workspaceSlug}`,
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
function resolveSessionNovelId(novelIdText) {
  if (!novelIdText || !novelIdText.trim()) {
    throw new Error("writer \u65E0\u6CD5\u89E3\u6790 chapterPaths\uFF1A\u4F7F\u7528 manuscript/.../ \u5F53\u524D Project Workspace \u8DEF\u5F84\u65F6\uFF0Csession \u5FC5\u987B\u7ED1\u5B9A novelId\uFF1B\u8DE8 Project Workspace \u8BF7\u4F20 novel-slug/manuscript/.../\u3002");
  }
  return parseEntityId("novelId", novelIdText);
}
async function findWorkspaceSlugByNovelId(novelId) {
  const prisma2 = await loadPrisma();
  const novel = await prisma2.novel.findUnique({
    where: { id: novelId },
    select: { workspaceSlug: true }
  });
  if (!novel) {
    throw new Error(`\u5C0F\u8BF4\u4E0D\u5B58\u5728\uFF1AnovelId=${String(novelId)}`);
  }
  return novel.workspaceSlug;
}
async function findNovelIdByWorkspaceSlug(workspaceSlug) {
  const prisma2 = await loadPrisma();
  const novel = await prisma2.novel.findUnique({
    where: { workspaceSlug },
    select: { id: true }
  });
  if (!novel) {
    throw new Error(`Project Workspace \u4E0D\u5B58\u5728\u6216\u672A\u7ED1\u5B9A\u5C0F\u8BF4\uFF1A${workspaceSlug}`);
  }
  return novel.id;
}
function formatPromptError(error) {
  return error instanceof Error ? error.message : String(error);
}
async function loadPlotFacade() {
  return (await Promise.resolve().then(() => (init_plot(), plot_exports))).plotFacade;
}
async function loadPrisma() {
  return (await Promise.resolve().then(() => (init_prisma2(), prisma_exports))).prisma;
}
export {
  InputSchema,
  OutputSchema,
  buildWriterPrompt,
  writer_profile_default as default,
  profileManifest
};
