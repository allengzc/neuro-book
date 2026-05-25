import {randomBytes, scrypt as scryptCallback, timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import type {H3Event} from "h3";
import {getRequestProtocol} from "h3";
import type {Prisma, PrismaClient, User, UserRole} from "nbook/server/generated/prisma/client";
import {loadGlobalEffectiveConfigSync} from "nbook/server/config/config-service";
import {lockDatabaseKey} from "nbook/server/database/locks";
import {prisma} from "nbook/server/utils/prisma";
import type {AdminUserListItemDto, AuthUserDto} from "nbook/shared/dto/auth.dto";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

const scrypt = promisify(scryptCallback);
const passwordHashPrefix = "scrypt";
const passwordKeyLength = 64;
const adminStateLockId = 550317001;
const lastSeenWriteIntervalMs = 60_000;

/**
 * 根据当前请求协议生成 session 配置。HTTP 测试站点不能使用 Secure cookie。
 */
function authSessionConfig(event: H3Event) {
    return {
        cookie: {
            secure: getRequestProtocol(event) === "https",
            sameSite: "lax" as const,
        },
    };
}

/**
 * 判断当前配置是否启用全站鉴权。未配置时默认启用。
 */
export function isAuthEnabled(): boolean {
    return loadGlobalEffectiveConfigSync().auth.enabled;
}

/**
 * 写入当前用户 session。
 */
export async function setAuthSession(event: H3Event, user: AuthUserDto): Promise<void> {
    await setUserSession(event, {user}, authSessionConfig(event));
}

/**
 * 清理当前用户 session。
 */
export async function clearAuthSession(event: H3Event): Promise<void> {
    await clearUserSession(event, authSessionConfig(event));
}

/**
 * 将用户实体映射为可写入 session 的轻量身份。
 */
export function toAuthUser(user: Pick<User, "id" | "username" | "displayName" | "role" | "sessionVersion">): AuthUserDto {
    return {
        id: String(user.id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        sessionVersion: user.sessionVersion,
    };
}

/**
 * 将用户实体映射为管理员列表 DTO。
 */
export function toAdminUserListItem(user: User): AdminUserListItemDto {
    return {
        id: String(user.id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        sessionVersion: user.sessionVersion,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    };
}

/**
 * 生成 scrypt 密码哈希。
 */
export async function hashUserPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, passwordKeyLength) as Buffer;
    return `${passwordHashPrefix}:${salt}:${key.toString("hex")}`;
}

/**
 * 校验明文密码是否匹配存储哈希。
 */
export async function verifyUserPassword(password: string, storedHash: string): Promise<boolean> {
    const [prefix, salt, keyHex] = storedHash.split(":");
    if (prefix !== passwordHashPrefix || !salt || !keyHex) {
        return false;
    }

    const storedKey = Buffer.from(keyHex, "hex");
    const inputKey = await scrypt(password, salt, storedKey.length) as Buffer;
    if (storedKey.length !== inputKey.length) {
        return false;
    }

    return timingSafeEqual(storedKey, inputKey);
}

/**
 * 解析用户 ID 路由参数。
 */
export function requireUserId(event: H3Event): number {
    const rawUserId = event.context.params?.userId ?? "";
    if (!/^\d+$/.test(rawUserId)) {
        throw createError({
            statusCode: 400,
            message: "userId 必须是正整数",
        });
    }

    const userId = Number.parseInt(rawUserId, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw createError({
            statusCode: 400,
            message: "userId 必须是正整数",
        });
    }

    return userId;
}

/**
 * 获取当前请求的有效用户。
 */
export async function getCurrentUser(event: H3Event): Promise<User | null> {
    const session = await getUserSession(event);
    const sessionUserId = session.user?.id;
    if (!sessionUserId) {
        return null;
    }

    const userId = Number.parseInt(sessionUserId, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        await clearAuthSession(event);
        return null;
    }

    const user = await prisma.user.findUnique({
        where: {id: userId},
    });
    if (!user || user.status !== "active" || user.sessionVersion !== session.user?.sessionVersion) {
        await clearAuthSession(event);
        return null;
    }

    const lastSeenThreshold = new Date(Date.now() - lastSeenWriteIntervalMs);
    if (!user.lastSeenAt || user.lastSeenAt < lastSeenThreshold) {
        const now = new Date();
        await prisma.user.updateMany({
            where: {
                id: user.id,
                OR: [
                    {lastSeenAt: null},
                    {lastSeenAt: {lt: lastSeenThreshold}},
                ],
            },
            data: {lastSeenAt: now},
        });
        return {
            ...user,
            lastSeenAt: now,
        };
    }

    return user;
}

/**
 * 要求当前请求来自已登录用户。
 */
export async function requireCurrentUser(event: H3Event): Promise<User> {
    const user = await getCurrentUser(event);
    if (!user) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }

    return user;
}

/**
 * 要求当前请求来自管理员。
 */
export async function requireAdmin(event: H3Event): Promise<User> {
    const user = await requireCurrentUser(event);
    if (user.role !== "admin") {
        throw createError({
            statusCode: 403,
            message: "需要管理员权限",
        });
    }

    return user;
}

/**
 * 在事务内串行化管理员状态变更，避免并发撤掉最后一个管理员。
 */
export async function lockAdminStateChanges(prismaClient: PrismaExecutor): Promise<void> {
    await lockDatabaseKey(prismaClient, adminStateLockId);
}

/**
 * 确保不会移除最后一个可用管理员。
 */
export async function assertCanChangeAdminState(prismaClient: PrismaExecutor, userId: number, nextRole?: UserRole, nextStatus?: "active" | "disabled"): Promise<void> {
    const user = await prismaClient.user.findUnique({
        where: {id: userId},
    });
    if (!user || user.role !== "admin" || user.status !== "active") {
        return;
    }

    const removesAdminPower = nextRole === "user" || nextStatus === "disabled";
    if (!removesAdminPower) {
        return;
    }

    const activeAdminCount = await prismaClient.user.count({
        where: {
            role: "admin",
            status: "active",
            id: {not: userId},
        },
    });
    if (activeAdminCount === 0) {
        throw createError({
            statusCode: 400,
            message: "不能移除最后一个可用管理员",
        });
    }
}
