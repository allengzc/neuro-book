import {Pool} from "pg";
import {resolveDatabaseConfig} from "nbook/server/database/config";

type GlobalAgentSqlPool = {
    agentSqlPool?: Pool;
    agentSqlPoolUrl?: string;
};

const globalForAgentSqlPool = globalThis as typeof globalThis & GlobalAgentSqlPool;

/**
 * 获取 Agent 专用 PostgreSQL 连接池。
 */
export const useAgentSqlPool = (): Pool => {
    const databaseConfig = resolveDatabaseConfig();
    if (databaseConfig.kind !== "postgres") {
        throw new Error("当前 Database Kind 不是 postgres，不能初始化 Agent PostgreSQL 连接池");
    }

    if (globalForAgentSqlPool.agentSqlPool && globalForAgentSqlPool.agentSqlPoolUrl === databaseConfig.url) {
        return globalForAgentSqlPool.agentSqlPool;
    }

    if (globalForAgentSqlPool.agentSqlPool) {
        void globalForAgentSqlPool.agentSqlPool.end();
    }

    globalForAgentSqlPool.agentSqlPool = new Pool({
        connectionString: databaseConfig.url,
    });
    globalForAgentSqlPool.agentSqlPoolUrl = databaseConfig.url;
    return globalForAgentSqlPool.agentSqlPool;
};
