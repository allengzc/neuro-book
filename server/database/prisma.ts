import {PrismaLibSql} from "@prisma/adapter-libsql";
import "@libsql/isomorphic-ws";
import {PrismaClient} from "nbook/server/generated/prisma/client";
import {resolveDatabaseConfig} from "nbook/server/database/config";

export type {PrismaClient};
export {Prisma} from "nbook/server/generated/prisma/client";
export type {
    User,
    UserRole,
} from "nbook/server/generated/prisma/client";

type GlobalPrisma = {
    prismaClient?: PrismaClient;
};

const globalForPrisma = globalThis as typeof globalThis & GlobalPrisma;
/**
 * 创建 App SQLite PrismaClient。
 */
const createPrismaClient = (): PrismaClient => {
    const config = resolveDatabaseConfig();
    const adapter = new PrismaLibSql({url: config.url});

    return new PrismaClient({
        adapter,
    });
};

/**
 * 获取进程级 PrismaClient 单例。
 */
export const usePrismaClient = (): PrismaClient => {
    if (!globalForPrisma.prismaClient) {
        globalForPrisma.prismaClient = createPrismaClient();
    }

    return globalForPrisma.prismaClient;
};

/**
 * 便捷导出：适合在 server/api 中直接使用。
 */
export const prisma = usePrismaClient();
