import {createClient} from "@libsql/client";
import type {Client as LibsqlClient} from "@libsql/client";
import {Type} from "typebox";
import type {Static} from "typebox";
import {resolveDatabaseConfig, type DatabaseKind} from "nbook/server/database/config";
import {useAgentSqlPool} from "nbook/server/utils/agent-sql-pool";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {JsonValue} from "nbook/server/agent/messages/types";

const ExecuteSqlSchema = Type.Object({
    sql: Type.String({description: "A single SQL statement: SELECT / WITH / INSERT / UPDATE / DELETE. DDL, transaction control, session control, and multi-statement queries are prohibited."}),
});

const AGENT_SQL_ROW_LIMIT = 200;
const AGENT_SQL_TIMEOUT_MS = 1_500;
const AGENT_SQL_SCHEMA_CACHE_TTL_MS = 30_000;
const POSTGRES_SCHEMA_QUERY = `
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
const POSTGRES_FOREIGN_KEY_QUERY = `
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
const SQLITE_TABLE_QUERY = `
    SELECT name AS "tableName"
    FROM sqlite_schema
    WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
    ORDER BY name ASC
`;
const AGENT_SQL_DETAIL_TABLES = new Set(["Novel", "Story", "StoryThread", "StoryScene", "StoryPlot", "StorySceneRef", "User"]);

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

type PgErrorLike = Error & {
    code?: string;
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
let agentSqlSchemaSummaryCacheKind: DatabaseKind | null = null;
let agentSqlSchemaSummaryCacheAt = 0;
let agentSqlSchemaSummaryPromise: Promise<string> | undefined;
let sqliteClient: LibsqlClient | null = null;
let sqliteClientUrl = "";

/**
 * 根据 schema 查询结果生成 Agent SQL 摘要。
 */
export function buildAgentSqlSchemaSummary(rows: AgentSqlSchemaRow[], foreignKeys: AgentSqlForeignKeyRow[], kind: DatabaseKind = "postgres"): string {
    if (rows.length === 0) {
        return kind === "sqlite"
            ? "当前 SQLite 数据库尚未发现业务表，请先确认迁移是否完成。"
            : "当前未发现 public schema 下的业务表，请先查询 information_schema.tables。";
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

    const lines = [
        kind === "sqlite"
            ? "当前 SQLite 业务表（表名和 camelCase 字段按原样双引号引用最稳）："
            : "当前 Postgres 业务表（名称和 camelCase 字段必须按下列写法使用双引号）：",
    ];
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
 * 读取并缓存 Agent SQL schema 摘要。
 */
export async function getAgentSqlSchemaSummary(): Promise<string> {
    const kind = resolveDatabaseConfig().kind;
    if (
        agentSqlSchemaSummaryCache
        && agentSqlSchemaSummaryCacheKind === kind
        && Date.now() - agentSqlSchemaSummaryCacheAt < AGENT_SQL_SCHEMA_CACHE_TTL_MS
    ) {
        return agentSqlSchemaSummaryCache;
    }
    if (!agentSqlSchemaSummaryPromise) {
        agentSqlSchemaSummaryPromise = readSchemaSummary(kind).then((summary) => {
            agentSqlSchemaSummaryCache = summary;
            agentSqlSchemaSummaryCacheKind = kind;
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
    agentSqlSchemaSummaryCacheKind = null;
    agentSqlSchemaSummaryCacheAt = 0;
    agentSqlSchemaSummaryPromise = undefined;
}

/**
 * 创建 execute_sql 工具。
 */
export function createSqlTool(): NeuroAgentTool {
    const databaseKind = resolveDatabaseConfig().kind;
    return {
        key: "execute_sql",
        name: "execute_sql",
        label: "Execute SQL",
        description: buildSqlToolDescription(databaseKind),
        parameters: ExecuteSqlSchema,
        async execute(_toolCallId, params: unknown) {
            const input = params as Static<typeof ExecuteSqlSchema>;
            const result = await executeSql(input.sql);
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: result as unknown as JsonValue,
            };
        },
    };
}

function buildSqlToolDescription(kind: DatabaseKind): string {
    const shared = [
        "Execute a single database SQL statement against the current application database.",
        `Current Database Kind: ${kind}.`,
        "Allowed: SELECT / WITH / INSERT / UPDATE / DELETE.",
        "Prohibited: DDL, transaction control, session control, COPY, VACUUM, and multi-statement queries.",
        `Query rows are capped at ${String(AGENT_SQL_ROW_LIMIT)} and statement timeout target is ${String(AGENT_SQL_TIMEOUT_MS)}ms.`,
        "Use read/write/edit/apply_patch for manuscript or document files; execute_sql is only for structured DB data.",
    ];

    if (kind === "sqlite") {
        return [
            ...shared,
            "SQLite dialect: quote business table and camelCase column names with double quotes when unsure, e.g. SELECT id, title FROM \"StoryThread\" ORDER BY \"createdAt\" DESC.",
            "Schema discovery uses sqlite_schema and PRAGMA table_info / foreign_key_list.",
            "Raw SQL does not apply Prisma @updatedAt client semantics; update \"updatedAt\" explicitly when needed.",
        ].join("\n");
    }

    return [
        ...shared,
        "PostgreSQL folds unquoted identifiers to lowercase. Business tables with uppercase letters and camelCase columns must be double-quoted, e.g. SELECT id, title FROM \"StoryThread\" WHERE \"storyId\" = 1 ORDER BY \"createdAt\" DESC.",
        "Schema discovery uses information_schema for public business tables.",
        "Raw SQL does not apply Prisma @updatedAt client semantics; update \"updatedAt\" explicitly when needed.",
    ].join("\n");
}

async function readSchemaSummary(kind: DatabaseKind): Promise<string> {
    if (kind === "sqlite") {
        const client = useSqliteClient();
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
        return buildAgentSqlSchemaSummary(rows, foreignKeys, kind);
    }

    const pool = useAgentSqlPool();
    const columnsResult = await pool.query<AgentSqlSchemaRow>(POSTGRES_SCHEMA_QUERY);
    const foreignKeysResult = await pool.query<AgentSqlForeignKeyRow>(POSTGRES_FOREIGN_KEY_QUERY);
    return buildAgentSqlSchemaSummary(columnsResult.rows, foreignKeysResult.rows, kind);
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

function formatColumnDefault(value: string | null): string {
    if (!value) {
        return "无默认值";
    }
    if (value.includes("CURRENT_TIMESTAMP") || value.includes("now()")) {
        return "DEFAULT CURRENT_TIMESTAMP";
    }
    if (value.includes("nextval(") || value.toUpperCase().includes("AUTOINCREMENT")) {
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
    let dollarQuoteTag: string | null = null;
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

function shouldRefreshChapterTree(sql: string): boolean {
    const normalized = normalizeSql(sql);
    return /\b(?:insert\s+into|update|delete\s+from)\s+"?(?:Novel)"?/i.test(normalized);
}

export function buildAgentSqlErrorMessage(sql: string, error: unknown, kind: DatabaseKind = resolveDatabaseConfig().kind): string {
    const message = error instanceof Error ? error.message : String(error);
    const pgError = error as PgErrorLike;
    const hintLines = [`SQL 执行失败：${message}`];
    if (kind === "postgres" && (pgError.code === "42P01" || message.includes("relation") && message.includes("does not exist"))) {
        hintLines.push("提示：Postgres 业务表名区分大小写，例如 Novel、StoryThread 必须写成 \"Novel\"、\"StoryThread\"。");
    }
    if (kind === "postgres" && (pgError.code === "42703" || message.includes("column") && message.includes("does not exist"))) {
        hintLines.push("提示：Postgres camelCase 字段区分大小写，例如 storyId、sortOrder、createdAt 必须写成 \"storyId\"、\"sortOrder\"、\"createdAt\"。");
    }
    if (kind === "sqlite" && /no such (?:table|column)/i.test(message)) {
        hintLines.push("提示：当前是 SQLite，先用 sqlite_schema 或 schema summary 确认表/列名；业务表和 camelCase 字段建议使用双引号。");
    }
    return hintLines.join("\n");
}

async function executeSql(sql: string): Promise<ExecuteSqlResult> {
    const normalized = normalizeSql(sql);
    validateExecuteSql(normalized);
    const kind = resolveDatabaseConfig().kind;
    return kind === "sqlite"
        ? executeSqliteSql(normalized)
        : executePostgresSql(normalized);
}

async function executePostgresSql(normalized: string): Promise<ExecuteSqlResult> {
    const pool = useAgentSqlPool();
    const client = await pool.connect();
    try {
        await client.query(isReadSql(normalized) ? "BEGIN READ ONLY" : "BEGIN");
        await client.query(`SET LOCAL statement_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
        const result = isReadSql(normalized)
            ? await client.query(`SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}`)
            : await client.query(normalized);
        await client.query("COMMIT");
        return toExecuteSqlResult(normalized, result.rows as Record<string, unknown>[], result.rowCount ?? result.rows.length);
    } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(buildAgentSqlErrorMessage(normalized, error, "postgres"));
    } finally {
        client.release();
    }
}

async function executeSqliteSql(normalized: string): Promise<ExecuteSqlResult> {
    const client = useSqliteClient();
    const statement = isReadSql(normalized)
        ? `SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}`
        : normalized;
    try {
        const result = await client.execute(statement);
        const rows = result.rows.map((row) => ({...row}) as Record<string, unknown>);
        return toExecuteSqlResult(normalized, rows, result.rowsAffected || rows.length);
    } catch (error) {
        throw new Error(buildAgentSqlErrorMessage(normalized, error, "sqlite"));
    }
}

function toExecuteSqlResult(normalized: string, rows: Record<string, unknown>[], rowCount: number): ExecuteSqlResult {
    return {
        mode: isReadSql(normalized) ? "read" : "write",
        command: detectSqlCommand(normalized),
        rowCount,
        rows,
        effects: {
            refreshChapterTree: !isReadSql(normalized) && shouldRefreshChapterTree(normalized),
        },
    };
}

function useSqliteClient(): LibsqlClient {
    const config = resolveDatabaseConfig();
    if (config.kind !== "sqlite") {
        throw new Error("当前 Database Kind 不是 sqlite，不能初始化 SQLite SQL client。");
    }
    if (!sqliteClient || sqliteClientUrl !== config.url) {
        sqliteClient = createClient({url: config.url});
        sqliteClientUrl = config.url;
    }
    return sqliteClient;
}
