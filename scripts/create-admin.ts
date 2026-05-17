import {hashUserPassword} from "nbook/server/utils/auth";
import {prisma} from "nbook/server/utils/prisma";

const [, , usernameArg, passwordArg] = process.argv;
const username = usernameArg?.trim() || process.env.AUTH_ADMIN_USERNAME?.trim();
const password = passwordArg || process.env.AUTH_ADMIN_PASSWORD;

/**
 * 创建或升级管理员账号。
 */
async function main(): Promise<void> {
    if (!username || !password) {
        throw new Error("用法：bun run auth:create-admin <username> <password>，或设置 AUTH_ADMIN_USERNAME / AUTH_ADMIN_PASSWORD");
    }
    if (password.length < 8) {
        throw new Error("管理员密码至少 8 个字符");
    }

    const passwordHash = await hashUserPassword(password);
    const user = await prisma.user.upsert({
        where: {username},
        create: {
            username,
            displayName: username,
            passwordHash,
            role: "admin",
            status: "active",
        },
        update: {
            passwordHash,
            role: "admin",
            status: "active",
            sessionVersion: {increment: 1},
        },
    });

    console.log(`管理员已就绪：${user.username} (#${user.id})`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
