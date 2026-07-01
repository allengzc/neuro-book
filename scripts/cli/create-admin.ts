import {cancel, isCancel, password as promptPassword, text} from "@clack/prompts";
import {ensurePrismaRuntime} from "./prisma-runtime-preflight";
import {hashUserPassword} from "nbook/server/utils/password";
import {spawn} from "node:child_process";
import {resolve as resolvePath} from "node:path";
import {fileURLToPath} from "node:url";

const [, , usernameArg, passwordArg] = process.argv;
const scriptRoot = resolvePath(fileURLToPath(import.meta.url), "..", "..");
type PrismaClientInstance = typeof import("nbook/server/utils/prisma").prisma;
let prisma: PrismaClientInstance | null = null;

/**
 * 确保 App SQLite schema 已迁移到当前版本。
 */
async function ensureDatabaseSchema(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [resolvePath(scriptRoot, "db", "prisma-migrate.mjs"), "--deploy"], {
            stdio: "inherit",
            env: process.env,
        });

        child.on("exit", (code, signal) => {
            if (signal) {
                reject(new Error(`数据库迁移被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                reject(new Error(`数据库迁移失败，退出码：${code ?? 1}`));
                return;
            }
            resolve();
        });
        child.on("error", reject);
    });
}

/**
 * 读取管理员用户名。优先用参数或环境变量，缺失时交互输入。
 */
async function readUsername(): Promise<string> {
    const username = usernameArg?.trim() || process.env.AUTH_ADMIN_USERNAME?.trim();
    if (username) {
        return username;
    }

    const input = await text({
        message: "管理员用户名",
        placeholder: "admin",
        validate: (value) => value.trim() ? undefined : "用户名不能为空",
    });
    if (isCancel(input)) {
        cancel("已取消创建管理员");
        process.exit(1);
    }
    return input.trim();
}

/**
 * 读取管理员密码。禁止用位置参数传密码，避免写入 shell history。
 */
async function readPassword(): Promise<string> {
    if (passwordArg) {
        throw new Error("不要把密码作为命令行参数传入，这会被 shell history 记录。请运行管理员创建命令后按提示隐藏输入密码，或在非交互环境中设置 AUTH_ADMIN_PASSWORD。");
    }

    const envPassword = process.env.AUTH_ADMIN_PASSWORD;
    if (envPassword) {
        return envPassword;
    }

    const input = await promptPassword({
        message: "管理员密码",
        validate: (value) => value.length >= 8 ? undefined : "管理员密码至少 8 个字符",
    });
    if (isCancel(input)) {
        cancel("已取消创建管理员");
        process.exit(1);
    }
    return input;
}

/**
 * 创建或升级管理员账号。
 */
async function main(): Promise<void> {
    await ensurePrismaRuntime({log: (message) => console.log(message)});
    const username = await readUsername();
    const password = await readPassword();
    if (password.length < 8) {
        throw new Error("管理员密码至少 8 个字符");
    }

    await ensureDatabaseSchema();
    ({prisma} = await import("nbook/server/utils/prisma"));
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
        await prisma?.$disconnect();
    });
