import * as p from "@clack/prompts";
import {spawn} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const REPO_URL = "https://github.com/notnotype/neuro-book.git";
const DEFAULT_PORT = "3000";
const PORTABLE_ROOT = process.env.NEURO_BOOK_PORTABLE_ROOT
    ? resolve(process.env.NEURO_BOOK_PORTABLE_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(PORTABLE_ROOT, "app");
const DEPLOY_DIR = join(PORTABLE_ROOT, ".deploy");
const STATE_PATH = join(DEPLOY_DIR, "windows-portable.json");
const NODE_EXE = process.execPath;

const COMMANDS = new Map([
    ["start", start],
    ["update", update],
    ["rebuild", rebuild],
    ["admin", createAdmin],
]);

const REQUIRED_TOOLS = [
    {command: "git", label: "Git", wingetId: "Git.Git"},
    {command: "bun", label: "Bun", wingetId: "Oven-sh.Bun"},
    {command: "rg", label: "ripgrep", wingetId: "BurntSushi.ripgrep.MSVC"},
];
const BOOTSTRAP_ROOT_FILES = [
    "Start Neuro Book.cmd",
    "Start Neuro Book.ps1",
    "Update Neuro Book.cmd",
    "Update Neuro Book.ps1",
    "Rebuild Neuro Book.cmd",
    "Rebuild Neuro Book.ps1",
    "Create Admin.cmd",
    "Create Admin.ps1",
    "README-Windows.md",
];

/**
 * Windows portable bootstrap 主入口。
 */
async function main() {
    const command = process.argv[2] ?? "start";
    const handler = COMMANDS.get(command);
    if (!handler) {
        throw new Error(`未知 Windows bootstrap 命令：${command}`);
    }

    p.intro("NeuroBook Windows");
    await handler();
    p.outro("Done");
}

/**
 * 启动本地服务。首次运行会完成依赖、源码、构建、迁移和管理员初始化。
 */
async function start() {
    await ensureRequiredTools();
    const sourceCreated = await ensureSourceReady();
    await ensurePortableConfig();
    const env = await loadAppEnv();
    await ensurePortAvailable(env);

    if (sourceCreated || await shouldBuildOnStart()) {
        await installAndBuild();
    }

    await migrate();
    await ensureAdminUser();
    await runServer(await loadAppEnv());
}

/**
 * 拉取 master 最新提交并重建。
 */
async function update() {
    await ensureRequiredTools();
    await ensureSourceReady();
    await ensurePortableConfig();
    await assertMasterCheckout();
    await assertCleanTrackedWorktree();
    await run("git", ["pull", "--ff-only", "origin", "master"], {cwd: APP_DIR});
    await installAndBuild();
    await migrate();
    await syncBootstrapFromCheckout();
}

/**
 * 按当前源码重建。
 */
async function rebuild() {
    await ensureRequiredTools();
    await assertSourceReady();
    await ensurePortableConfig();
    await installAndBuild();
    await migrate();
}

/**
 * 创建或重置管理员。
 */
async function createAdmin() {
    await ensureRequiredTools();
    await assertSourceReady();
    await ensurePortableConfig();
    await migrate();
    await run("bun", ["run", "auth:create-admin"], {cwd: APP_DIR, env: await loadAppEnv()});
}

/**
 * 检查缺失工具，并通过 winget 引导安装。
 */
async function ensureRequiredTools() {
    const missing = [];
    for (const tool of REQUIRED_TOOLS) {
        if (!await commandAvailable(tool.command)) {
            missing.push(tool);
        }
    }
    if (missing.length === 0) {
        await writeState({stage: "dependencies-ready"});
        return;
    }
    if (!await commandAvailable("winget")) {
        throw new Error(`缺少工具：${missing.map((item) => item.label).join(", ")}。请先安装 winget 或手动安装这些工具。`);
    }

    const commands = missing.map((item) => `winget install --id ${item.wingetId} --exact --source winget`);
    p.note(commands.join("\n"), "将安装缺失工具");
    const shouldInstall = await p.confirm({
        message: "是否现在安装缺失工具？",
        initialValue: true,
    });
    if (p.isCancel(shouldInstall) || !shouldInstall) {
        p.cancel("已取消安装。");
        process.exit(1);
    }

    for (const item of missing) {
        await run("winget", ["install", "--id", item.wingetId, "--exact", "--source", "winget"]);
    }

    p.note("安装完成后请重新打开 PowerShell，或重新运行启动脚本。", "需要重新运行");
    process.exit(0);
}

/**
 * 确保 app/ 是 master checkout。返回本次是否新 clone。
 */
async function ensureSourceReady() {
    if (existsSync(join(APP_DIR, ".git"))) {
        await writeState({stage: "source-ready"});
        return false;
    }

    if (existsSync(APP_DIR) && (await readdir(APP_DIR)).length > 0) {
        throw new Error(`app 目录已存在但不是 Git checkout：${APP_DIR}`);
    }

    await mkdir(PORTABLE_ROOT, {recursive: true});
    await run("git", ["clone", "--branch", "master", "--single-branch", REPO_URL, APP_DIR], {cwd: PORTABLE_ROOT});
    await writeState({stage: "source-ready"});
    return true;
}

/**
 * 要求源码已经物化。
 */
async function assertSourceReady() {
    if (!existsSync(join(APP_DIR, ".git"))) {
        throw new Error("源码尚未初始化。请先运行 Start Neuro Book.cmd 或 Update Neuro Book.cmd。");
    }
}

/**
 * tracked 文件必须干净，避免更新覆盖用户或 Agent 改动。
 */
async function assertCleanTrackedWorktree() {
    const status = await runCapture("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: APP_DIR});
    if (status.trim()) {
        throw new Error(`源码目录存在 tracked 改动，已停止更新：\n${status.trim()}\n请提交、备份或恢复这些改动后重试。`);
    }
}

/**
 * 更新入口要求 app/ 仍绑定 GitHub master。
 */
async function assertMasterCheckout() {
    const branch = (await runCapture("git", ["branch", "--show-current"], {cwd: APP_DIR})).trim();
    const remote = (await runCapture("git", ["config", "--get", "remote.origin.url"], {cwd: APP_DIR})).trim();
    if (branch !== "master" || !isExpectedOrigin(remote)) {
        throw new Error(`源码目录没有绑定到 origin/master，已停止更新。\n当前分支：${branch || "<detached>"}\norigin：${remote || "<missing>"}`);
    }
}

function isExpectedOrigin(remote) {
    return remote === REPO_URL || remote === "git@github.com:notnotype/neuro-book.git";
}

/**
 * 生成 .env / config.yaml / Global Config。
 */
async function ensurePortableConfig() {
    await mkdir(join(APP_DIR, "workspace", ".nbook"), {recursive: true});
    const envPath = join(APP_DIR, ".env");
    if (!existsSync(envPath)) {
        await writeFile(envPath, renderEnv(DEFAULT_PORT, randomBytes(32).toString("hex")), "utf8");
    }
    const configPath = join(APP_DIR, "config.yaml");
    if (!existsSync(configPath)) {
        await writeFile(configPath, renderBootConfig(DEFAULT_PORT), "utf8");
    }
    const globalConfigPath = join(APP_DIR, "workspace", ".nbook", "config.json");
    if (!existsSync(globalConfigPath)) {
        await writeFile(globalConfigPath, renderGlobalConfig(), "utf8");
    }
}

/**
 * 如果端口被占用，提示用户换端口并写回配置。
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
 * Start 用于首次启动和失败恢复；已成功构建过但产物丢失时，交给 Rebuild 处理。
 */
async function shouldBuildOnStart() {
    const serverEntry = join(APP_DIR, ".output", "server", "index.mjs");
    if (existsSync(serverEntry)) {
        return false;
    }

    const state = await readState();
    if (state.stage === "build-ready" || state.stage === "migrated") {
        throw new Error("构建产物缺失。请运行 Rebuild Neuro Book.cmd 重新构建当前源码。");
    }
    return true;
}

/**
 * 安装依赖并构建 Nuxt。
 */
async function installAndBuild() {
    await run("bun", ["install", "--frozen-lockfile"], {cwd: APP_DIR, env: await loadAppEnv()});
    await writeState({stage: "install-ready"});
    await run("bun", ["run", "nuxt:prepare"], {cwd: APP_DIR, env: await loadAppEnv()});
    await run("bun", ["run", "generate"], {cwd: APP_DIR, env: await loadAppEnv()});
    await run("bun", ["run", "nuxt:build"], {cwd: APP_DIR, env: await loadAppEnv()});
    await writeState({stage: "build-ready"});
}

/**
 * 执行 SQLite migration。
 */
async function migrate() {
    await run("bun", ["run", "migrate:deploy"], {cwd: APP_DIR, env: await loadAppEnv()});
    await writeState({stage: "migrated"});
}

/**
 * 首次没有用户时，引导创建管理员。
 */
async function ensureAdminUser() {
    const result = await runCapture("bun", ["scripts/cli/has-users.ts"], {cwd: APP_DIR, env: await loadAppEnv()});
    if (result.trim() === "yes") {
        return;
    }

    p.note("当前还没有用户。请先创建管理员账号。", "首次启动");
    await run("bun", ["run", "auth:create-admin"], {cwd: APP_DIR, env: await loadAppEnv()});
}

/**
 * 前台启动 Nitro 服务，并打开浏览器。
 */
async function runServer(env) {
    const port = webPort(env);
    const url = `http://localhost:${port}`;
    const child = spawn(NODE_EXE, [".output/server/index.mjs"], {
        cwd: APP_DIR,
        env: {...process.env, ...env, PORT: port, NITRO_PORT: port},
        stdio: "inherit",
        windowsHide: false,
    });

    setTimeout(() => {
        void openBrowser(url);
    }, 1500);

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
 * Update 后，把 repo 内 bootstrap 源同步回 Portable Root。
 */
async function syncBootstrapFromCheckout() {
    const sourceRoot = join(APP_DIR, "scripts", "deploy", "windows-portable", "bootstrap");
    if (!existsSync(sourceRoot)) {
        return;
    }

    for (const fileName of BOOTSTRAP_ROOT_FILES) {
        await cp(join(sourceRoot, fileName), join(PORTABLE_ROOT, fileName), {force: true});
    }
    await mkdir(join(PORTABLE_ROOT, "bootstrap"), {recursive: true});
    await run("bun", [
        "x",
        "esbuild",
        join(sourceRoot, "bootstrap.mjs"),
        "--bundle",
        "--platform=node",
        "--format=esm",
        `--outfile=${join(PORTABLE_ROOT, "bootstrap", "bootstrap.mjs")}`,
        "--external:node:*",
    ], {cwd: APP_DIR});
}

/**
 * 读取 app/.env。
 */
async function loadAppEnv() {
    const envPath = join(APP_DIR, ".env");
    if (!existsSync(envPath)) {
        return {};
    }

    return parseEnv(await readFile(envPath, "utf8"));
}

/**
 * 记录 portable 状态。
 */
async function writeState(patch) {
    await mkdir(DEPLOY_DIR, {recursive: true});
    const current = await readState();
    await writeFile(STATE_PATH, `${JSON.stringify({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
        appDir: APP_DIR,
    }, null, 4)}\n`, "utf8");
}

/**
 * 读取 portable 状态。
 */
async function readState() {
    if (!existsSync(STATE_PATH)) {
        return {};
    }
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
}

/**
 * 命令是否可用。
 */
async function commandAvailable(command) {
    try {
        await run(command, ["--version"], {stdio: "ignore"});
        return true;
    } catch {
        return false;
    }
}

/**
 * 执行命令并继承 stdio。
 */
function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ? {...process.env, ...options.env} : process.env,
            stdio: options.stdio ?? "inherit",
            windowsHide: true,
        });
        child.on("error", (error) => {
            rejectPromise(new Error(`命令不可用或启动失败：${command}\n${error.message}`));
        });
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`命令被信号中断：${command} ${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`命令执行失败：${command} ${args.join(" ")}，退出码 ${code}`));
                return;
            }
            resolvePromise();
        });
    });
}

/**
 * 执行命令并返回 stdout。
 */
function runCapture(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ? {...process.env, ...options.env} : process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", rejectPromise);
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
    await run("node", ["-e", `import('node:child_process').then(({spawn})=>spawn(${JSON.stringify(process.platform === "darwin" ? "open" : "xdg-open")},[${JSON.stringify(url)}],{stdio:'ignore',detached:true}).unref())`], {stdio: "ignore"});
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
 * 解析 .env。
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
        result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
    return result;
}

function webPort(env) {
    return env.NITRO_PORT ?? env.PORT ?? env.NUXT_PORT ?? DEFAULT_PORT;
}

/**
 * 写入 .env 单个值。
 */
async function writeEnvValue(name, value) {
    const envPath = join(APP_DIR, ".env");
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
 * 同步 config.yaml 中的端口。
 */
async function writeConfigPort(port) {
    const configPath = join(APP_DIR, "config.yaml");
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
        "DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite",
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
  url: \${DATABASE_URL:-file:./workspace/.nbook/neuro-book.sqlite}
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
