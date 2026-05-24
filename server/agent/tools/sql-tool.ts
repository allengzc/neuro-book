import {Type} from "typebox";
import type {Static} from "typebox";
import {useAgentSqlPool} from "nbook/server/utils/agent-sql-pool";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {JsonValue} from "nbook/server/agent/messages/types";

const ExecuteSqlSchema = Type.Object({
    sql: Type.String({description: "A single SQL statement: SELECT / WITH / INSERT / UPDATE / DELETE. DDL, transaction control, session control, and multi-statement queries are prohibited."}),
});

const AGENT_SQL_ROW_LIMIT = 200;
const AGENT_SQL_TIMEOUT_MS = 1_500;
const AGENT_SQL_SCHEMA_QUERY = `
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
const AGENT_SQL_FOREIGN_KEY_QUERY = `
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
const AGENT_SQL_DETAIL_TABLES = new Set(["Chapter", "Volume", "Novel"]);

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
let agentSqlSchemaSummaryPromise: Promise<string> | undefined;

/**
 * 根据 information_schema 结果生成 schema 摘要。
 */
export function buildAgentSqlSchemaSummary(rows: AgentSqlSchemaRow[], foreignKeys: AgentSqlForeignKeyRow[]): string {
    if (rows.length === 0) {
        return "当前未发现 public schema 下的业务表，请先查询 information_schema.tables。";
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

    const lines = ["可查询业务表（名称和 camelCase 字段必须按下列写法使用双引号）："];
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
    if (agentSqlSchemaSummaryCache) {
        return agentSqlSchemaSummaryCache;
    }
    if (!agentSqlSchemaSummaryPromise) {
        agentSqlSchemaSummaryPromise = (async () => {
            const pool = useAgentSqlPool();
            const columnsResult = await pool.query<AgentSqlSchemaRow>(AGENT_SQL_SCHEMA_QUERY);
            const foreignKeysResult = await pool.query<AgentSqlForeignKeyRow>(AGENT_SQL_FOREIGN_KEY_QUERY);
            agentSqlSchemaSummaryCache = buildAgentSqlSchemaSummary(columnsResult.rows, foreignKeysResult.rows);
            return agentSqlSchemaSummaryCache;
        })().catch((error) => {
            agentSqlSchemaSummaryPromise = undefined;
            throw error;
        });
    }
    return agentSqlSchemaSummaryPromise;
}

/**
 * 创建 v3 execute_sql 工具。
 */
export function createSqlTool(): NeuroAgentTool {
    return {
        key: "execute_sql",
        name: "execute_sql",
        label: "Execute SQL",
        description: [
            "Execute a single database SQL statement.",
            "Allowed: SELECT / WITH / INSERT / UPDATE / DELETE.",
            "Prohibited: DDL, transaction control, session control, COPY, VACUUM, and multi-statement queries.",
            `Query rows are capped at ${String(AGENT_SQL_ROW_LIMIT)} and statement timeout is ${String(AGENT_SQL_TIMEOUT_MS)}ms.`,
            "PostgreSQL folds unquoted identifiers to lowercase. Business tables with uppercase letters and camelCase columns must be double-quoted, e.g. SELECT id, title FROM \"Chapter\" WHERE \"novelId\" = 1 ORDER BY \"createdAt\" DESC. Fields like \"novelId\", \"createdAt\", and \"sortOrder\" will fail as column does not exist if not quoted.",
            "Use read/write/edit/apply_patch for manuscript or document files; execute_sql is only for structured DB data.",
        ].join("\n"),
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
    return row.dataType === "USER-DEFINED" ? row.udtName : row.dataType;
}

function formatColumnDefault(value: string | null): string {
    if (!value) {
        return "无默认值";
    }
    if (value.includes("CURRENT_TIMESTAMP") || value.includes("now()")) {
        return "DEFAULT CURRENT_TIMESTAMP";
    }
    if (value.includes("nextval(")) {
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

function validateExecuteSql(sql: string): void {
    const normalized = normalizeSql(sql);
    const leadingKeyword = getSqlLeadingKeyword(normalized);
    const blockedReadPattern = /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|set|reset|show|call)\b/;
    const blockedWritePattern = /\b(alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|set|reset|show|call)\b/;
    if (!normalized) {
        throw new Error("sql 不能为空");
    }
    if (normalized.includes(";")) {
        throw new Error("sql 只允许单条语句");
    }
    if (!["select", "with", "insert", "update", "delete"].includes(leadingKeyword)) {
        throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
    }
    if (isReadSql(normalized) && blockedReadPattern.test(normalized.toLowerCase())) {
        throw new Error("sql 包含被禁止的关键字");
    }
    if (!isReadSql(normalized) && blockedWritePattern.test(normalized.toLowerCase())) {
        throw new Error("sql 包含被禁止的关键字");
    }
}

function shouldRefreshChapterTree(sql: string): boolean {
    const normalized = normalizeSql(sql);
    return /\b(?:insert\s+into|update|delete\s+from)\s+"(?:Chapter|Volume|Novel)"/.test(normalized);
}

export function buildAgentSqlErrorMessage(sql: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const pgError = error as PgErrorLike;
    const hintLines = [`SQL 执行失败：${message}`];
    if (pgError.code === "42P01" || message.includes("relation") && message.includes("does not exist")) {
        hintLines.push("提示：业务表名区分大小写，例如 Novel、Chapter、Volume 必须写成 \"Novel\"、\"Chapter\"、\"Volume\"。");
    }
    if (pgError.code === "42703" || message.includes("column") && message.includes("does not exist")) {
        hintLines.push("提示：camelCase 字段区分大小写，例如 novelId、sortOrder、createdAt 必须写成 \"novelId\"、\"sortOrder\"、\"createdAt\"。");
    }
    return hintLines.join("\n");
}

async function executeSql(sql: string): Promise<ExecuteSqlResult> {
    const normalized = normalizeSql(sql);
    validateExecuteSql(normalized);
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
        return {
            mode: isReadSql(normalized) ? "read" : "write",
            command: detectSqlCommand(normalized),
            rowCount: result.rowCount ?? result.rows.length,
            rows: result.rows as Record<string, unknown>[],
            effects: {
                refreshChapterTree: !isReadSql(normalized) && shouldRefreshChapterTree(normalized),
            },
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(buildAgentSqlErrorMessage(normalized, error));
    } finally {
        client.release();
    }
}
