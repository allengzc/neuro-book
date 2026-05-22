import {z} from "zod";
import {useAgentSqlPool} from "nbook/server/utils/agent-sql-pool";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const AgentExecuteSqlToolInputSchema = z.object({
    sql: z.string().describe("A single SQL statement (SELECT / WITH / INSERT / UPDATE / DELETE). DDL, transaction control, and multi-statement queries are prohibited. Business table names with uppercase letters must be double-quoted (e.g. \"Novel\", \"Chapter\")."),
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
    detail?: string;
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
 * 规整 SQL 文本。
 */
function normalizeSql(sql: string): string {
    return sql.trim().replace(/;+$/g, "").trim();
}

/**
 * 对业务标识符做双引号转义。
 */
function quoteIdentifier(value: string): string {
    return `"${value.replaceAll("\"", "\"\"")}"`;
}

/**
 * 判断名称在当前数据库中是否必须使用双引号。
 */
function needsQuotedIdentifier(value: string): boolean {
    return /[A-Z]/.test(value);
}

/**
 * 将列名格式化为更接近可执行 SQL 的提示文本。
 */
function formatSummaryColumnName(columnName: string): string {
    return needsQuotedIdentifier(columnName) ? quoteIdentifier(columnName) : columnName;
}

/**
 * 将 SQL 类型摘要压缩为更易读的文本。
 */
function formatSummaryDataType(row: AgentSqlSchemaRow): string {
    if (row.dataType === "ARRAY") {
        return `${row.udtName.replace(/^_/, "")}[]`;
    }
    if (row.dataType === "USER-DEFINED") {
        return row.udtName;
    }
    return row.dataType;
}

/**
 * 将数据库默认值压缩为更适合 prompt 阅读的短文本。
 */
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

/**
 * 根据 information_schema 结果生成 schema 摘要。
 */
export function buildAgentSqlSchemaSummary(
    rows: AgentSqlSchemaRow[],
    foreignKeys: AgentSqlForeignKeyRow[],
): string {
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
        const currentColumns = tableColumns.get(row.tableName) ?? [];
        currentColumns.push(formatSummaryColumnName(row.columnName));
        tableColumns.set(row.tableName, currentColumns);

        const currentDetailedRows = detailedTableColumns.get(row.tableName) ?? [];
        currentDetailedRows.push(row);
        detailedTableColumns.set(row.tableName, currentDetailedRows);
    }

    const lines = ["可查询业务表（名称和 camelCase 字段必须按下列写法使用双引号）："];
    const detailedTableNames = Array.from(AGENT_SQL_DETAIL_TABLES.values()).filter((tableName) => tableColumns.has(tableName));

    if (detailedTableNames.length > 0) {
        lines.push("重点写入表详细结构：");
        for (const tableName of detailedTableNames) {
            const currentRows = detailedTableColumns.get(tableName) ?? [];
            lines.push(`${quoteIdentifier(tableName)}:`);

            for (const row of currentRows) {
                const flags: string[] = [
                    row.isNullable === "NO" ? "NOT NULL" : "NULLABLE",
                    formatColumnDefault(row.columnDefault),
                ];
                const foreignKey = foreignKeyMap.get(`${row.tableName}.${row.columnName}`);
                if (foreignKey) {
                    flags.push(`FK -> ${quoteIdentifier(foreignKey.foreignTableName)}.${formatSummaryColumnName(foreignKey.foreignColumnName)}`);
                }
                if (row.columnName === "createdAt" || row.columnName === "updatedAt") {
                    flags.push("由 PostgreSQL 自动填写，可在 INSERT 时省略");
                }

                lines.push(`- ${formatSummaryColumnName(row.columnName)}: ${formatSummaryDataType(row)}; ${flags.join("; ")}`);
            }

            if (tableName === "Chapter") {
                lines.push("- 写入提示：新增章节前先确认 \"volumeId\" 属于目标小说，并先查询同卷 MAX(\"sortOrder\") + 1。");
            }
        }
    }

    const compactTables = Array.from(tableColumns.entries())
        .filter(([tableName]) => !AGENT_SQL_DETAIL_TABLES.has(tableName));

    if (compactTables.length > 0) {
        lines.push("其他业务表简表：");
        let index = 1;
        for (const [tableName, columns] of compactTables) {
            lines.push(`${String(index)}. ${quoteIdentifier(tableName)}(${columns.join(", ")})`);
            index += 1;
        }
    }

    return lines.join("\n");
}

/**
 * 读取并缓存 schema 摘要。
 */
export async function getAgentSqlSchemaSummary(): Promise<string> {
    if (agentSqlSchemaSummaryCache) {
        return agentSqlSchemaSummaryCache;
    }

    if (!agentSqlSchemaSummaryPromise) {
        agentSqlSchemaSummaryPromise = (async () => {
            try {
                const pool = useAgentSqlPool();
                const columnsResult = await pool.query<AgentSqlSchemaRow>(AGENT_SQL_SCHEMA_QUERY);
                const foreignKeysResult = await pool.query<AgentSqlForeignKeyRow>(AGENT_SQL_FOREIGN_KEY_QUERY);
                agentSqlSchemaSummaryCache = buildAgentSqlSchemaSummary(columnsResult.rows, foreignKeysResult.rows);
                return agentSqlSchemaSummaryCache;
            } catch (error) {
                agentSqlSchemaSummaryPromise = undefined;
                throw error;
            }
        })();
    }

    return agentSqlSchemaSummaryPromise;
}

/**
 * 提取 SQL 首关键字。
 */
function getSqlLeadingKeyword(sql: string): string {
    const normalized = normalizeSql(sql);
    const match = normalized.match(/^[a-zA-Z]+/);
    return match?.[0]?.toLowerCase() ?? "";
}

/**
 * 判断是否为查询。
 */
function isReadSql(sql: string): boolean {
    const leadingKeyword = getSqlLeadingKeyword(sql);
    return leadingKeyword === "select" || leadingKeyword === "with";
}

/**
 * 推断 SQL 命令类型。
 */
function detectSqlCommand(sql: string): AgentSqlCommand {
    const normalized = normalizeSql(sql);
    const loweredSql = normalized.toLowerCase();

    if (/^\s*(select|with)\b/.test(loweredSql)) {
        return "SELECT";
    }
    if (/^\s*insert\b/.test(loweredSql)) {
        return "INSERT";
    }
    if (/^\s*update\b/.test(loweredSql)) {
        return "UPDATE";
    }
    if (/^\s*delete\b/.test(loweredSql)) {
        return "DELETE";
    }

    throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
}

/**
 * 判断是否需要刷新章节树。
 */
function shouldRefreshChapterTree(sql: string): boolean {
    const normalized = normalizeSql(sql);
    const loweredSql = normalized.toLowerCase();

    return (
        /\b(?:insert\s+into|update|delete\s+from)\s+"(?:Chapter|Volume|Novel)"/.test(normalized)
        || /\b(?:insert\s+into|update|delete\s+from)\s+"(?:chapter|volume|novel)"/.test(loweredSql)
    );
}

/**
 * 校验 SQL 仅包含单条查询或 DML。
 */
function validateExecuteSql(sql: string): void {
    const normalized = normalizeSql(sql);
    const leadingKeyword = getSqlLeadingKeyword(normalized);
    const blockedPattern = /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|set|reset|show|call)\b/;
    const blockedWritePattern = /\b(alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|reset|show|call)\b/;

    if (!normalized) {
        throw new Error("sql 不能为空");
    }
    if (normalized.includes(";")) {
        throw new Error("sql 只允许单条语句");
    }
    if (!["select", "with", "insert", "update", "delete"].includes(leadingKeyword)) {
        throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
    }
    if (isReadSql(normalized)) {
        if (blockedPattern.test(normalized.toLowerCase())) {
            throw new Error("sql 包含被禁止的关键字");
        }
        return;
    }
    if (blockedWritePattern.test(normalized.toLowerCase())) {
        throw new Error("sql 包含被禁止的关键字");
    }
}

/**
 * 将数据库错误改写成更适合模型自修复的提示。
 */
export function buildAgentSqlErrorMessage(sql: string, error: unknown): string {
    const normalized = normalizeSql(sql);
    const message = error instanceof Error ? error.message : String(error);
    const pgError = error as PgErrorLike;
    const hintLines = [`SQL 执行失败：${message}`];

    if (pgError.code === "42P01" || message.includes("relation") && message.includes("does not exist")) {
        hintLines.push("提示：当前库的业务表名区分大小写。像 Novel、Chapter、Volume、AgentThread 这类表名必须写成双引号形式，例如 \"Novel\"。");
    }
    if (pgError.code === "42703" || message.includes("column") && message.includes("does not exist")) {
        hintLines.push("提示：当前库的 camelCase 字段区分大小写。像 novelId、sortOrder、createdAt 这类列名必须写成双引号形式，例如 \"novelId\"。");
    }

    if (
        hintLines.length > 1
        || /(?:\bNovel\b|\bVolume\b|\bChapter\b|\bAgentThread\b)/.test(normalized)
        || /(?:\bnovelId\b|\bvolumeId\b|\bsortOrder\b|\bcreatedAt\b|\bupdatedAt\b|\blastMessageAt\b|\blastSelectedChapterId\b)/.test(normalized)
    ) {
        hintLines.push("补充规则：");
        hintLines.push("1. information_schema.tables / information_schema.columns 这类系统表按标准小写查询。");
        hintLines.push("2. 业务表和 camelCase 字段必须使用双引号，例如 SELECT id, title FROM \"Chapter\" WHERE \"novelId\" = 1 ORDER BY \"sortOrder\"。");
        hintLines.push("3. 如果仍不确定结构，请先查询 information_schema.tables 或 information_schema.columns，不要猜。");
    }

    return hintLines.join("\n");
}

/**
 * 执行只读 SQL。
 */
async function executeReadonlySql(sql: string): Promise<ExecuteSqlResult> {
    const normalized = normalizeSql(sql);
    validateExecuteSql(normalized);
    const pool = useAgentSqlPool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN READ ONLY");
        await client.query(`SET LOCAL statement_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
        const wrappedSql = `SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}`;
        const result = await client.query(wrappedSql);
        await client.query("COMMIT");

        return {
            mode: "read",
            command: "SELECT",
            rowCount: result.rowCount ?? result.rows.length,
            rows: result.rows,
            effects: {
                refreshChapterTree: false,
            },
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(buildAgentSqlErrorMessage(normalized, error));
    } finally {
        client.release();
    }
}

/**
 * 执行写入 SQL。
 */
async function executeWriteSql(sql: string): Promise<ExecuteSqlResult> {
    const normalized = normalizeSql(sql);
    validateExecuteSql(normalized);
    const pool = useAgentSqlPool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL statement_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${String(AGENT_SQL_TIMEOUT_MS)}ms'`);
        const result = await client.query(normalized);
        await client.query("COMMIT");

        return {
            mode: "write",
            command: detectSqlCommand(normalized),
            rowCount: result.rowCount ?? 0,
            rows: result.rows as Record<string, unknown>[],
            effects: {
                refreshChapterTree: shouldRefreshChapterTree(normalized),
            },
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(buildAgentSqlErrorMessage(normalized, error));
    } finally {
        client.release();
    }
}

/**
 * 执行 SQL。
 */
async function executeSql(sql: string): Promise<string> {
    const normalized = normalizeSql(sql);
    const result = isReadSql(normalized)
        ? await executeReadonlySql(normalized)
        : await executeWriteSql(normalized);

    return JSON.stringify(result);
}

/**
 * 数据库 SQL 工具。
 */
export const executeSqlTool: AgentTool<typeof AgentExecuteSqlToolInputSchema> = {
    key: "execute_sql",
    description: [
        "### Purpose",
        "Execute a single database SQL statement.",
        "",
        "### Allowed Operations",
        "Single SELECT / WITH / INSERT / UPDATE / DELETE.",
        "Prohibited: DDL, transaction control, session control, multi-statement queries.",
        "",
        "### Query Results",
        `Capped at ${String(AGENT_SQL_ROW_LIMIT)} rows, returned with fields: mode, command, rowCount, rows, effects.`,
        "",
        "### Key Rules",
        "1. Narrow queries with the current novelId when possible.",
        "2. Double-quote business tables with uppercase letters (e.g., \"Novel\", \"Chapter\").",
        "3. Double-quote camelCase columns (e.g., \"novelId\", \"sortOrder\", \"createdAt\").",
        "4. Query system tables (information_schema.tables / information_schema.columns) in lowercase.",
        "5. If unsure about schema or get \"relation/column does not exist\" errors, query information_schema first (do not guess).",
        "6. Raw SQL does not use Prisma @updatedAt semantics; createdAt/updatedAt are auto-handled by PostgreSQL.",
        "7. Use file system tools (read_file, edit_file, write_file, apply_patch) for manuscript/document files (not execute_sql).",
        "8. execute_sql is for structured queries/metadata writes only—do NOT read/write prose body text or overwrite existing document content.",
        "9. If INSERT fails (not-null/foreign key errors), recheck schema summary for required columns, defaults, and foreign keys before retrying.",
        "",
        "### Examples",
        "- Correct: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        "- Correct: SELECT id, title FROM \"Chapter\" WHERE \"novelId\" = 1 ORDER BY \"sortOrder\"",
        "- Correct: For local text files: read_file(\"manuscript/001-opening.md\") → edit_file/apply_patch",
        "- Incorrect: SELECT id, title FROM Chapter WHERE novelId = '...' ORDER BY sortOrder",
        "- Incorrect: UPDATE \"Chapter\" SET content = 'large prose block' WHERE id = 123",
        "- Incorrect: SELECT content FROM \"LorebookEntry\" WHERE id = 4",
    ].join("\n"),
    schema: AgentExecuteSqlToolInputSchema,
    async execute(input) {
        const result = await executeSql(input.sql);
        return createToolResultMessage(result, JSON.stringify(input));
    },
};
