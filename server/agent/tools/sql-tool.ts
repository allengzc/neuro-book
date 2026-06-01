import {createClient} from "@libsql/client";
import type {Client as LibsqlClient} from "@libsql/client";
import {Type} from "typebox";
import type {Static} from "typebox";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {initProjectDatabase, readProjectManifest, resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

const ExecuteSqlSchema = Type.Object({
    sql: Type.String({description: "A single Project SQLite statement: SELECT / WITH / INSERT / UPDATE / DELETE. DDL, transaction control, PRAGMA, ATTACH/DETACH, and multi-statement queries are prohibited."}),
});

const AGENT_SQL_ROW_LIMIT = 200;
const AGENT_SQL_SCHEMA_CACHE_TTL_MS = 30_000;
const SQLITE_TABLE_QUERY = `
    SELECT name AS "tableName"
    FROM sqlite_schema
    WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
    ORDER BY name ASC
`;
const AGENT_SQL_DETAIL_TABLES = new Set(["Story", "StoryPhase", "StoryThread", "StoryScene", "StoryPlot", "StorySceneRef", "ProjectMetadata"]);

type AgentSqlSchemaRow = {
    tableName: string;
    columnName: string;
    ordinalPosition: number;
    isNullable: "YES" | "NO";
    columnDefault: string | null;
    dataType: string;
    udtName: string;
};

type AgentSqlForeignKeyRow = {
    tableName: string;
    columnName: string;
    foreignTableName: string;
    foreignColumnName: string;
};

type AgentSqlCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

type ExecuteSqlResult = {
    mode: "read" | "write";
    command: AgentSqlCommand;
    rowCount: number;
    rows: Record<string, unknown>[];
    effects: {
        refreshChapterTree: boolean;
    };
};

let agentSqlSchemaSummaryCache = "";
let agentSqlSchemaSummaryCacheProjectPath = "";
let agentSqlSchemaSummaryCacheAt = 0;
let agentSqlSchemaSummaryPromise: Promise<string> | undefined;
let sqliteClient: LibsqlClient | null = null;
let sqliteClientUrl = "";

/**
 * 根据 schema 查询结果生成 Agent SQL 摘要。
 */
export function buildAgentSqlSchemaSummary(rows: AgentSqlSchemaRow[], foreignKeys: AgentSqlForeignKeyRow[]): string {
    if (rows.length === 0) {
        return "当前 Project SQLite 尚未发现业务表，请先确认项目数据库是否完成初始化。";
    }

    const tableColumns = new Map<string, string[]>();
    const detailedTableColumns = new Map<string, AgentSqlSchemaRow[]>();
    const foreignKeyMap = new Map<string, AgentSqlForeignKeyRow>();

    for (const foreignKey of foreignKeys) {
        foreignKeyMap.set(`${foreignKey.tableName}.${foreignKey.columnName}`, foreignKey);
    }
    for (const row of rows) {
        tableColumns.set(row.tableName, [...tableColumns.get(row.tableName) ?? [], formatSummaryColumnName(row.columnName)]);
        detailedTableColumns.set(row.tableName, [...detailedTableColumns.get(row.tableName) ?? [], row]);
    }

    const lines = ["当前 Project SQLite 业务表（表名和 camelCase 字段按原样双引号引用最稳）："];
    for (const tableName of Array.from(AGENT_SQL_DETAIL_TABLES.values()).filter((name) => tableColumns.has(name))) {
        lines.push(`${quoteIdentifier(tableName)}:`);
        for (const row of detailedTableColumns.get(tableName) ?? []) {
            const flags = [
                row.isNullable === "NO" ? "NOT NULL" : "NULLABLE",
                formatColumnDefault(row.columnDefault),
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
        lines.push("其他业务表简表：");
        compactTables.forEach(([tableName, columns], index) => {
            lines.push(`${String(index + 1)}. ${quoteIdentifier(tableName)}(${columns.join(", ")})`);
        });
    }
    return lines.join("\n");
}

/**
 * 读取并缓存当前 Project SQLite schema 摘要。
 */
export async function getAgentSqlSchemaSummary(projectPath?: string): Promise<string> {
    const resolvedProjectPath = requireProjectPath(projectPath);
    if (
        agentSqlSchemaSummaryCache
        && agentSqlSchemaSummaryCacheProjectPath === resolvedProjectPath
        && Date.now() - agentSqlSchemaSummaryCacheAt < AGENT_SQL_SCHEMA_CACHE_TTL_MS
    ) {
        return agentSqlSchemaSummaryCache;
    }
    if (!agentSqlSchemaSummaryPromise) {
        agentSqlSchemaSummaryPromise = readSchemaSummary(resolvedProjectPath).then((summary) => {
            agentSqlSchemaSummaryCache = summary;
            agentSqlSchemaSummaryCacheProjectPath = resolvedProjectPath;
            agentSqlSchemaSummaryCacheAt = Date.now();
            agentSqlSchemaSummaryPromise = undefined;
            return agentSqlSchemaSummaryCache;
        }).catch((error) => {
            agentSqlSchemaSummaryPromise = undefined;
            throw error;
        });
    }
    return agentSqlSchemaSummaryPromise;
}

/**
 * 清空 schema summary 缓存。测试和迁移后刷新可以显式调用。
 */
export function clearAgentSqlSchemaSummaryCache(): void {
    agentSqlSchemaSummaryCache = "";
    agentSqlSchemaSummaryCacheProjectPath = "";
    agentSqlSchemaSummaryCacheAt = 0;
    agentSqlSchemaSummaryPromise = undefined;
}

/**
 * 创建 execute_sql 工具。
 */
export function createSqlTool(): NeuroAgentTool {
    return {
        key: "execute_sql",
        name: "execute_sql",
        label: "Execute SQL",
        executionMode: "sequential",
        description: buildSqlToolDescription(),
        parameters: ExecuteSqlSchema,
        async execute() {
            throw new Error("execute_sql 需要 v3 session context，并且只能访问当前 Project Workspace 的 .nbook/project.sqlite。");
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as Static<typeof ExecuteSqlSchema>;
            const result = await executeSql(context, input.sql);
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: result as unknown as JsonValue,
            };
        },
    };
}

function buildSqlToolDescription(): string {
    return [
        "Execute a single SQL statement against the current Project Workspace SQLite database.",
        "Target database is fixed to the current Project Workspace .nbook/project.sqlite.",
        "The tool has no sqlitePath/databasePath parameter and cannot access App SQLite.",
        "Allowed: SELECT / WITH / INSERT / UPDATE / DELETE.",
        "Prohibited: DDL, transaction control, session control, PRAGMA, ATTACH/DETACH, VACUUM, and multi-statement queries.",
        `Query rows are capped at ${String(AGENT_SQL_ROW_LIMIT)}.`,
        "Use read/write/edit/apply_patch for manuscript or document files; execute_sql is only for structured Project SQLite data.",
        "SQLite dialect: quote business table and camelCase column names with double quotes when unsure, e.g. SELECT id, title FROM \"StoryThread\" ORDER BY \"createdAt\" DESC.",
        "Schema discovery uses sqlite_schema and PRAGMA table_info / foreign_key_list internally; agents may not execute PRAGMA directly.",
        "Raw SQL does not apply Prisma @updatedAt client semantics; update \"updatedAt\" explicitly when needed.",
    ].join("\n");
}

async function readSchemaSummary(projectPath: string): Promise<string> {
    const client = await useSqliteClient(projectPath);
    const tablesResult = await client.execute(SQLITE_TABLE_QUERY);
    const tableNames = tablesResult.rows.map((row) => String(row.tableName));
    const rows: AgentSqlSchemaRow[] = [];
    const foreignKeys: AgentSqlForeignKeyRow[] = [];

    for (const tableName of tableNames) {
        const columns = await client.execute(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
        rows.push(...columns.rows.map((row) => ({
            tableName,
            columnName: String(row.name),
            ordinalPosition: Number(row.cid) + 1,
            isNullable: Number(row.notnull) === 1 || Number(row.pk) === 1 ? "NO" as const : "YES" as const,
            columnDefault: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
            dataType: String(row.type || "TEXT"),
            udtName: String(row.type || "TEXT"),
        })));

        const fkRows = await client.execute(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`);
        foreignKeys.push(...fkRows.rows.map((row) => ({
            tableName,
            columnName: String(row.from),
            foreignTableName: String(row.table),
            foreignColumnName: String(row.to),
        })));
    }
    return buildAgentSqlSchemaSummary(rows, foreignKeys);
}

function normalizeSql(sql: string): string {
    return sql.trim().replace(/;+$/g, "").trim();
}

function quoteIdentifier(value: string): string {
    return `"${value.replaceAll("\"", "\"\"")}"`;
}

function formatSummaryColumnName(columnName: string): string {
    return /[A-Z]/.test(columnName) ? quoteIdentifier(columnName) : columnName;
}

function formatSummaryDataType(row: AgentSqlSchemaRow): string {
    return row.dataType.toUpperCase() === "JSONB" ? "JSON" : row.dataType;
}

function formatColumnDefault(value: string | null): string {
    if (!value) {
        return "无默认值";
    }
    if (value.includes("CURRENT_TIMESTAMP")) {
        return "DEFAULT CURRENT_TIMESTAMP";
    }
    if (value.toUpperCase().includes("AUTOINCREMENT")) {
        return "DEFAULT 自增";
    }
    return `DEFAULT ${value}`;
}

function getSqlLeadingKeyword(sql: string): string {
    return normalizeSql(sql).match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() ?? "";
}

function isReadSql(sql: string): boolean {
    const leadingKeyword = getSqlLeadingKeyword(sql);
    return leadingKeyword === "select" || leadingKeyword === "with";
}

function detectSqlCommand(sql: string): AgentSqlCommand {
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
    throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
}

export function validateExecuteSql(sql: string): void {
    const normalized = normalizeSql(sql);
    const leadingKeyword = getSqlLeadingKeyword(normalized);
    const blockedPattern = /\b(alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|reset|show|call|pragma|attach|detach)\b/i;

    if (!normalized) {
        throw new Error("sql 不能为空");
    }
    if (hasSqlStatementSeparator(normalized)) {
        throw new Error("sql 只允许单条语句");
    }
    if (!["select", "with", "insert", "update", "delete"].includes(leadingKeyword)) {
        throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
    }
    if (blockedPattern.test(stripSqlLiterals(normalized))) {
        throw new Error("sql 包含被禁止的关键字");
    }
}

/**
 * 检测真正的 SQL 语句分隔符。字符串、quoted identifier 和注释内的分号不算多语句。
 */
export function hasSqlStatementSeparator(sql: string): boolean {
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
            if (char === "\"" && nextChar === "\"") {
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
        if (char === "\"") {
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

function stripSqlLiterals(sql: string): string {
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
            if (char === "\"" && nextChar === "\"") {
                result += "  ";
                index += 2;
                continue;
            }
            if (char === "\"") {
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
        if (char === "\"") {
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

export function buildAgentSqlErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const hintLines = [`SQL 执行失败：${message}`];
    if (/no such (?:table|column)/i.test(message)) {
        hintLines.push("提示：当前目标是 Project SQLite；先确认当前 Project Workspace 和表/列名。业务表和 camelCase 字段建议使用双引号。");
    }
    return hintLines.join("\n");
}

async function executeSql(context: ToolExecutionContext, sql: string): Promise<ExecuteSqlResult> {
    const normalized = normalizeSql(sql);
    validateExecuteSql(normalized);
    return executeSqliteSql(requireProjectPath(context.projectPath), normalized);
}

async function executeSqliteSql(projectPath: string, normalized: string): Promise<ExecuteSqlResult> {
    const client = await useSqliteClient(projectPath);
    const statement = isReadSql(normalized)
        ? `SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}`
        : normalized;
    try {
        const result = await client.execute(statement);
        const rows = result.rows.map((row) => ({...row}) as Record<string, unknown>);
        return toExecuteSqlResult(normalized, rows, result.rowsAffected || rows.length);
    } catch (error) {
        throw new Error(buildAgentSqlErrorMessage(error));
    }
}

function toExecuteSqlResult(normalized: string, rows: Record<string, unknown>[], rowCount: number): ExecuteSqlResult {
    return {
        mode: isReadSql(normalized) ? "read" : "write",
        command: detectSqlCommand(normalized),
        rowCount,
        rows,
        effects: {
            refreshChapterTree: false,
        },
    };
}

async function useSqliteClient(projectPath: string): Promise<LibsqlClient> {
    await readProjectManifest(projectPath);
    await initProjectDatabase(projectPath);
    const url = toSqliteFileUrl(resolveProjectDatabasePath(projectPath));
    if (!sqliteClient || sqliteClientUrl !== url) {
        sqliteClient?.close();
        sqliteClient = createClient({url});
        sqliteClientUrl = url;
    }
    return sqliteClient;
}

function requireProjectPath(projectPath: string | undefined): string {
    if (!projectPath || projectPath === "workspace" || projectPath === "workspace/.nbook") {
        throw new Error("execute_sql 需要当前 session 位于具体 Project Workspace；目标固定为该项目的 .nbook/project.sqlite。");
    }
    return projectPath;
}
