import * as p from "@clack/prompts";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {existsSync} from "node:fs";
import {lstat, mkdir, readFile, readdir, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const DEFAULT_PORT = "3000";
const PORTABLE_ROOT = process.env.NEURO_BOOK_PORTABLE_ROOT
    ? resolve(process.env.NEURO_BOOK_PORTABLE_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(PORTABLE_ROOT, "app");
const DATA_DIR = join(PORTABLE_ROOT, "data");
const DATA_WORKSPACE_DIR = join(DATA_DIR, "workspace");
const APP_WORKSPACE_PATH = join(APP_DIR, "workspace");
const DEPLOY_DIR = join(DATA_DIR, ".deploy");
const STATE_PATH = join(DEPLOY_DIR, "windows-launcher.json");
const NODE_EXE = process.execPath;
const SERVER_ENTRY = join(APP_DIR, ".output", "server", "index.mjs");
const RELEASE_META = join(APP_DIR, "release-meta.json");

const COMMANDS = new Map([
    ["start", start],
    ["update", update],
    ["admin", createAdmin],
]);

/**
 * Windows Product Launcher 主入口。
 */
async function main() {
    const command = process.argv[2] ?? "start";
    const handler = COMMANDS.get(command);
    if (!handler) {
        throw new Error(`未知 Windows Launcher 命令：${command}`);
    }

    p.intro("NeuroBook Windows Launcher");
    await handler();
    p.outro("Done");
}

/**
 * 启动 Product Payload，并在首次运行时初始化 data/。
 */
async function start() {
    await assertProductPayload();
    await ensurePortableConfig();
    const env = await loadDataEnv();
    await ensurePortAvailable(env);
    await migrate();
    await ensureAdminUser();
    await runServer(await loadDataEnv());
}

/**
 * v1 先停止旧 git pull 更新路径，明确提示 Product Portable 的更新边界。
 */
async function update() {
    await assertProductPayload();
    await ensurePortableConfig();
    p.note([
        "Windows Product Portable 不再通过 git pull 更新。",
        "v1 请下载新版 neuro-book-windows-x64.zip，解压到新目录，保留旧目录的 data/ 后替换 app/。",
        "后续版本会把下载、解压、切换 app/ 做成自动更新流程。",
    ].join("\n"), "Product 更新方式");
}

/**
 * 创建或重置管理员。
 */
async function createAdmin() {
    await assertProductPayload();
    await ensurePortableConfig();
    await migrate();
    await runProductTsScript("cli/create-admin.ts", {stdio: "inherit"});
}

/**
 * 确认 app/ 是已经打包好的 Product Payload。
 */
async function assertProductPayload() {
    if (!existsSync(SERVER_ENTRY)) {
        throw new Error(`缺少 Product Payload 入口：${SERVER_ENTRY}`);
    }
    if (!existsSync(RELEASE_META)) {
        throw new Error(`缺少 Product release metadata：${RELEASE_META}`);
    }
}

/**
 * 生成 data/.env、data/config.yaml、data/workspace，并把 app/workspace 映射到 data/workspace。
 */
async function ensurePortableConfig() {
    await mkdir(join(DATA_WORKSPACE_DIR, ".nbook"), {recursive: true});
    await ensureWorkspaceLink();

    const envPath = join(DATA_DIR, ".env");
    if (!existsSync(envPath)) {
        await writeFile(envPath, renderEnv(DEFAULT_PORT, randomBytes(32).toString("hex")), "utf8");
    }

    const configPath = join(DATA_DIR, "config.yaml");
    if (!existsSync(configPath)) {
        await writeFile(configPath, renderBootConfig(DEFAULT_PORT), "utf8");
    }

    const globalConfigPath = join(DATA_WORKSPACE_DIR, ".nbook", "config.json");
    if (!existsSync(globalConfigPath)) {
        await writeFile(globalConfigPath, renderGlobalConfig(), "utf8");
    }
}

/**
 * app/workspace 是 Product Root 内的稳定入口，真实数据保存在 portable data/workspace。
 */
async function ensureWorkspaceLink() {
    if (existsSync(APP_WORKSPACE_PATH)) {
        const stats = await lstat(APP_WORKSPACE_PATH);
        if (stats.isSymbolicLink()) {
            const actual = await realpath(APP_WORKSPACE_PATH);
            const expected = await realpath(DATA_WORKSPACE_DIR);
            if (actual === expected) {
                return;
            }
            throw new Error(`app/workspace 已指向其他位置：${actual}`);
        }
        if (stats.isDirectory() && (await readdir(APP_WORKSPACE_PATH)).length === 0) {
            await rm(APP_WORKSPACE_PATH, {recursive: true, force: true});
        } else {
            throw new Error("app/workspace 已存在且不是 data/workspace 的目录联接。请备份后移除该目录再启动。");
        }
    }

    await mkdir(dirname(APP_WORKSPACE_PATH), {recursive: true});
    await symlink(DATA_WORKSPACE_DIR, APP_WORKSPACE_PATH, process.platform === "win32" ? "junction" : "dir");
}

/**
 * 执行 SQLite migration。
 */
async function migrate() {
    await run(NODE_EXE, [join(APP_DIR, ".output", "server", "scripts", "db", "prisma-migrate.mjs"), "--deploy"], {
        cwd: APP_DIR,
        env: await productEnv(),
    });
    await writeState({stage: "migrated"});
}

/**
 * 首次没有用户时，引导创建管理员。
 */
async function ensureAdminUser() {
    const result = await runProductTsScript("cli/has-users.ts", {stdio: "pipe"});
    if (result.trim() === "yes") {
        return;
    }

    p.note("当前还没有用户。请先创建管理员账号。", "首次启动");
    await runProductTsScript("cli/create-admin.ts", {stdio: "inherit"});
}

/**
 * 使用 Product 内置 tsx vendor 运行产品 TS 脚本，不依赖根 node_modules 或 Bun。
 */
async function runProductTsScript(relativeScript, options) {
    const requireFromProduct = createRequire(pathToFileURL(SERVER_ENTRY));
    const tsxCli = requireFromProduct.resolve("tsx/cli");
    const scriptPath = join(APP_DIR, ".output", "server", "scripts", relativeScript);
    return run(NODE_EXE, [tsxCli, scriptPath], {
        cwd: APP_DIR,
        env: await productEnv(),
        stdio: options.stdio,
    });
}

/**
 * 前台启动 Nitro 服务，并打开浏览器。
 */
async function runServer(env) {
    const port = webPort(env);
    const url = `http://localhost:${port}`;
    const child = spawn(NODE_EXE, [SERVER_ENTRY], {
        cwd: APP_DIR,
        env,
        stdio: "inherit",
        windowsHide: false,
    });

    if (process.env.NEURO_BOOK_NO_OPEN_BROWSER !== "1") {
        setTimeout(() => {
            void openBrowser(url);
        }, 1500);
    }

    await new Promise((resolvePromise, rejectPromise) => {
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`服务被信号中断：${signal}`));
                return;
            }
            if (code && code !== 0) {
                rejectPromise(new Error(`服务退出，退出码 ${code}`));
                return;
            }
            resolvePromise();
        });
    });
}

/**
 * 如果端口被占用，提示用户换端口并写回 data/.env 与 data/config.yaml。
 */
async function ensurePortAvailable(env) {
    const port = webPort(env);
    if (await portAvailable(Number(port))) {
        return;
    }

    const nextPort = await p.text({
        message: `端口 ${port} 已被占用，请输入新的 Web 端口`,
        initialValue: "3001",
        validate: (value) => /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536 ? undefined : "请输入 1-65535 的端口",
    });
    if (p.isCancel(nextPort)) {
        p.cancel("已取消启动。");
        process.exit(1);
    }

    await writeEnvValue("NUXT_PORT", nextPort);
    await writeEnvValue("PORT", nextPort);
    await writeEnvValue("NITRO_PORT", nextPort);
    await writeConfigPort(nextPort);
    await writeState({port: nextPort});
}

/**
 * Product 运行环境以 data/.env 为真值源。
 */
async function productEnv() {
    const env = await loadDataEnv();
    const port = webPort(env);
    return {
        ...process.env,
        ...env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_KIND: env.DATABASE_KIND ?? "sqlite",
        DATABASE_URL: env.DATABASE_URL ?? "file:../data/workspace/.nbook/neuro-book.sqlite",
        PORT: port,
        NITRO_PORT: port,
        NUXT_PORT: port,
    };
}

/**
 * 读取 data/.env。
 */
async function loadDataEnv() {
    const envPath = join(DATA_DIR, ".env");
    if (!existsSync(envPath)) {
        return {};
    }
    return parseEnv(await readFile(envPath, "utf8"));
}

/**
 * 记录 launcher 状态。
 */
async function writeState(patch) {
    await mkdir(DEPLOY_DIR, {recursive: true});
    const current = await readState();
    await writeFile(STATE_PATH, `${JSON.stringify({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
        appDir: APP_DIR,
        dataDir: DATA_DIR,
    }, null, 4)}\n`, "utf8");
}

/**
 * 读取 launcher 状态。
 */
async function readState() {
    if (!existsSync(STATE_PATH)) {
        return {};
    }
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
}

/**
 * 执行命令。
 */
function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: options.stdio ?? "inherit",
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        if (child.stdout) {
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
                stdout += chunk;
            });
        }
        if (child.stderr) {
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (chunk) => {
                stderr += chunk;
            });
        }
        child.on("error", (error) => {
            rejectPromise(new Error(`命令不可用或启动失败：${command}\n${error.message}`));
        });
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`命令被信号中断：${command} ${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`命令执行失败：${command} ${args.join(" ")}，退出码 ${code}\n${stderr.trim()}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}

/**
 * 打开浏览器。
 */
async function openBrowser(url) {
    if (process.platform === "win32") {
        await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Start-Process '${url.replaceAll("'", "''")}'`], {stdio: "ignore"});
        return;
    }
    await run(NODE_EXE, ["-e", `import('node:child_process').then(({spawn})=>spawn(${JSON.stringify(process.platform === "darwin" ? "open" : "xdg-open")},[${JSON.stringify(url)}],{stdio:'ignore',detached:true}).unref())`], {stdio: "ignore"});
}

/**
 * 端口是否可用。
 */
function portAvailable(port) {
    return new Promise((resolvePromise) => {
        const server = createServer();
        server.once("error", () => {
            resolvePromise(false);
        });
        server.once("listening", () => {
            server.close(() => resolvePromise(true));
        });
        server.listen(port, "127.0.0.1");
    });
}

/**
 * 解析简单 KEY=VALUE `.env`。
 */
function parseEnv(text) {
    const result = {};
    for (const line of text.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const index = trimmed.indexOf("=");
        if (index === -1) {
            continue;
        }
        result[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^['"]|['"]$/gu, "");
    }
    return result;
}

function webPort(env) {
    return env.NITRO_PORT ?? env.PORT ?? env.NUXT_PORT ?? DEFAULT_PORT;
}

/**
 * 写入 data/.env 单个值。
 */
async function writeEnvValue(name, value) {
    const envPath = join(DATA_DIR, ".env");
    const env = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
    const lines = env.split(/\r?\n/u);
    let changed = false;
    const next = lines.map((line) => {
        if (line.startsWith(`${name}=`)) {
            changed = true;
            return `${name}=${value}`;
        }
        return line;
    });
    if (!changed) {
        next.push(`${name}=${value}`);
    }
    await writeFile(envPath, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}\n`, "utf8");
}

/**
 * 同步 data/config.yaml 中的端口。
 */
async function writeConfigPort(port) {
    const configPath = join(DATA_DIR, "config.yaml");
    const text = existsSync(configPath) ? await readFile(configPath, "utf8") : renderBootConfig(port);
    await writeFile(configPath, text.replace(/port:\s*\d+/u, `port: ${port}`), "utf8");
}

function renderEnv(port, sessionPassword) {
    return [
        `NUXT_PORT=${port}`,
        `PORT=${port}`,
        `NITRO_PORT=${port}`,
        `NUXT_SESSION_PASSWORD=${sessionPassword}`,
        "",
        "DATABASE_KIND=sqlite",
        "DATABASE_URL=file:../data/workspace/.nbook/neuro-book.sqlite",
        "",
    ].join("\n");
}

function renderBootConfig(port) {
    return `# neuro-book Boot Config.
server:
  host: '0.0.0.0'
  port: ${port}
database:
  kind: \${DATABASE_KIND:-sqlite}
  url: \${DATABASE_URL:-file:../data/workspace/.nbook/neuro-book.sqlite}
`;
}

function renderGlobalConfig() {
    return `${JSON.stringify({
        auth: {enabled: true},
        models: {
            default: null,
            providers: [],
        },
        agent: {
            defaultProfileKey: {
                novel: "leader.default",
                userAssets: "leader.assets",
            },
            profiles: {},
        },
        ui: {theme: "sepia"},
        editor: {},
    }, null, 4)}\n`;
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
