import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export type PrismaRuntimeMode = "product" | "source";

export type PrismaRuntimePlan = {
    mode: PrismaRuntimeMode;
    clientPath: string;
    generateScriptPath: string | null;
};

type CommandRunner = (
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: typeof process.env;
        stdio: "inherit";
    },
) => Promise<void>;

export type PrismaRuntimePreflightOptions = {
    cwd?: string;
    scriptPath?: string;
    exists?: (path: string) => boolean;
    runCommand?: CommandRunner;
    log?: (message: string) => void;
    env?: typeof process.env;
};

/**
 * 解析当前 CLI 应该使用源码 Prisma Client 还是 Product 内打包的 Client。
 */
export function resolvePrismaRuntimePlan(options: PrismaRuntimePreflightOptions = {}): PrismaRuntimePlan {
    const cwd = resolve(options.cwd ?? process.cwd());
    const scriptPath = normalizePath(options.scriptPath ?? fileURLToPath(import.meta.url));
    const productMode = scriptPath.includes("/.output/server/scripts/");

    if (productMode) {
        return {
            mode: "product",
            clientPath: resolve(cwd, ".output", "server", "node_modules", "nbook", "server", "generated", "prisma", "client.ts"),
            generateScriptPath: null,
        };
    }

    return {
        mode: "source",
        clientPath: resolve(cwd, "server", "generated", "prisma", "client.ts"),
        generateScriptPath: resolve(cwd, "scripts", "db", "prisma-generate.mjs"),
    };
}

/**
 * 确保 CLI 在导入 App Prisma 前拥有可用的 Prisma Client。
 */
export async function ensurePrismaRuntime(options: PrismaRuntimePreflightOptions = {}): Promise<void> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const exists = options.exists ?? existsSync;
    const plan = resolvePrismaRuntimePlan({...options, cwd});

    if (exists(plan.clientPath)) {
        return;
    }

    if (plan.mode === "product") {
        throw new Error([
            `Product Runtime 缺少打包后的 Prisma Client：${plan.clientPath}`,
            "请拉取与部署脚本匹配的 GHCR 镜像，或重新运行 bun run nuxt:build / bun run product:stage。",
            "Product/GHCR 运行机不会执行 Prisma generate。",
        ].join("\n"));
    }

    if (!plan.generateScriptPath || !exists(plan.generateScriptPath)) {
        throw new Error(`源码部署缺少 Prisma generate 脚本：${plan.generateScriptPath ?? "<unknown>"}`);
    }

    const nuxtTsConfigPath = resolve(cwd, ".nuxt", "tsconfig.json");
    if (!exists(nuxtTsConfigPath)) {
        options.log?.("未找到 Nuxt TS 配置，正在执行 nuxt:prepare。");
        await (options.runCommand ?? runCommand)(process.execPath, ["run", "nuxt:prepare"], {
            cwd,
            env: options.env ?? process.env,
            stdio: "inherit",
        });
    }

    options.log?.("未找到 App Prisma Client，正在自动生成。");
    await (options.runCommand ?? runCommand)(process.execPath, [plan.generateScriptPath], {
        cwd,
        env: options.env ?? process.env,
        stdio: "inherit",
    });

    if (!exists(plan.clientPath)) {
        throw new Error(`Prisma generate 已执行，但仍缺少 App Prisma Client：${plan.clientPath}`);
    }
}

/**
 * 执行外部命令并继承当前终端输出。
 */
async function runCommand(command: string, args: string[], options: {cwd: string; env: typeof process.env; stdio: "inherit"}): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: options.stdio,
            shell: false,
            windowsHide: true,
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`Prisma generate 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`Prisma generate 失败，退出码：${code ?? 1}`));
                return;
            }
            resolvePromise();
        });
    });
}

function normalizePath(path: string): string {
    return path.replaceAll("\\", "/");
}
