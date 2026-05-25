import {currentDatabaseKind} from "nbook/server/database/config";

type DatabaseLockExecutor = {
    $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

/**
 * 在当前事务中获取数据库锁。
 *
 * Postgres 使用 advisory lock；SQLite 在同一个 Prisma transaction 内写入
 * 内部锁表，借数据库写锁保护 read-before-write 的排序/管理员检查窗口。
 */
export async function lockDatabaseKey(prismaClient: DatabaseLockExecutor, key: number): Promise<void> {
    const lockKey = Math.trunc(key);
    if (currentDatabaseKind() === "sqlite") {
        await prismaClient.$executeRawUnsafe(
            `INSERT INTO "DatabaseLock" ("key", "updatedAt") VALUES (${String(lockKey)}, CURRENT_TIMESTAMP) ON CONFLICT("key") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP`,
        );
        return;
    }

    await prismaClient.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${String(lockKey)})`);
}
