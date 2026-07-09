import * as p from "@clack/prompts";
import {spawn} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {createWriteStream, existsSync} from "node:fs";
import {cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {unzipSync} from "fflate";

const DEFAULT_PORT = "3000";
const PORTABLE_ROOT = process.env.NEURO_BOOK_PORTABLE_ROOT
    ? resolve(process.env.NEURO_BOOK_PORTABLE_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(PORTABLE_ROOT, "app");
const DATA_DIR = join(PORTABLE_ROOT, "data");
const DATA_LOG_DIR = join(DATA_DIR, "logs");
const DATA_WORKSPACE_DIR = join(DATA_DIR, "workspace");
const APP_WORKSPACE_PATH = join(APP_DIR, "workspace");
const DEPLOY_DIR = join(DATA_DIR, ".deploy");
const STATE_PATH = join(DEPLOY_DIR, "windows-launcher.json");
const BUN_EXE = process.execPath;
const SERVER_ENTRY = join(APP_DIR, ".output", "server", "index.mjs");
const APP_PACKAGE = join(APP_DIR, "package.json");
const PORTABLE_RELEASE = join(PORTABLE_ROOT, "portable-release.json");
const PACKAGE_ROOT_NAME = "neuro-book-windows-x64";
const WINDOWS_ZIP_NAME = `${PACKAGE_ROOT_NAME}.zip`;
const SHA256SUMS_NAME = "SHA256SUMS";
const LAUNCHER_LOG_MAX_BYTES = 10 * 1024 * 1024;
const LAUNCHER_LOG_RETENTION = 8;
const UPDATE_RELEASE_API = process.env.NEURO_BOOK_UPDATE_RELEASE_API
    ?? "https://api.github.com/repos/notnotype/neuro-book/releases?per_page=30";
const LAUNCHER_ROOT_FILES = [
    "Start Neuro Book.cmd",
    "Start Neuro Book.ps1",
    "Update Neuro Book.cmd",
    "Update Neuro Book.ps1",
    "Create Admin.cmd",
    "Create Admin.ps1",
    "README-Windows.md",
];

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
    await writeLauncherLog("info", "launcher start");
    const env = await loadDataEnv();
    await ensurePortAvailable(env);
    await prepareSystemAssets();
    await migrate();
    await ensureAdminUser();
    await runServer(await loadDataEnv());
}

/**
 * 下载最新 Windows Product Portable，保留 data/ 并切换 Product Payload。
 */
async function update() {
    await assertProductPayload();
    await mkdir(DEPLOY_DIR, {recursive: true});
    const currentRelease = await readPortableRelease();
    const releases = await fetchUpdateReleases();
    const selectedRelease = await selectUpdateRelease(releases, currentRelease);
    const zipAsset = releaseAsset(selectedRelease, WINDOWS_ZIP_NAME);
    const sumsAsset = releaseAsset(selectedRelease, SHA256SUMS_NAME);

    if (currentRelease?.releaseTag === selectedRelease.tag_name && process.env.NEURO_BOOK_UPDATE_FORCE !== "1") {
        p.note(`当前已是所选版本：${selectedRelease.tag_name}`, "无需更新");
        return;
    }

    p.note([
        `当前版本：${currentRelease?.releaseTag ?? "unknown"}`,
        `目标版本：${selectedRelease.tag_name} (${releaseKind(selectedRelease)})`,
        "更新会替换 app/、launcher/、根启动脚本和 portable-release.json，并保留 data/。",
        "内置 Bun runtime 会保留当前版本，避免更新进程替换正在运行的 bun.exe。",
    ].join("\n"), "准备更新");
    if (process.env.NEURO_BOOK_UPDATE_ASSUME_YES !== "1") {
        const confirmed = await p.confirm({
            message: "现在下载并切换到所选版本？",
            initialValue: true,
        });
        if (p.isCancel(confirmed) || !confirmed) {
            p.cancel("已取消更新。");
            return;
        }
    }

    const stagedRoot = await downloadAndStageUpdate(selectedRelease, zipAsset, sumsAsset);
    await applyPortableUpdate(stagedRoot, selectedRelease.tag_name);
    p.note("更新完成。请重新运行 Start Neuro Book.cmd 启动新版。", "Product 更新完成");
}

/**
 * 读取当前 portable release metadata。
 */
async function readPortableRelease() {
    if (!existsSync(PORTABLE_RELEASE)) {
        return null;
    }
    return JSON.parse(await readFile(PORTABLE_RELEASE, "utf8"));
}

/**
 * 查询 GitHub releases。默认列出 stable 和 prerelease，供用户选择。
 */
async function fetchUpdateReleases() {
    const response = await fetch(UPDATE_RELEASE_API, {
        headers: {
            "Accept": "application/vnd.github+json",
            "User-Agent": "NeuroBook-Windows-Launcher",
        },
    });
    if (!response.ok) {
        throw new Error(`查询 release 列表失败：${UPDATE_RELEASE_API} ${response.status}`);
    }
    const payload = await response.json();
    const releases = Array.isArray(payload) ? payload : [payload];
    const candidates = releases.filter((release) => {
        if (!release?.tag_name || release.draft || !Array.isArray(release.assets)) {
            return false;
        }
        return Boolean(assetMaybe(release, WINDOWS_ZIP_NAME) && assetMaybe(release, SHA256SUMS_NAME));
    });
    if (candidates.length === 0) {
        throw new Error("没有找到带 Windows portable zip 和 SHA256SUMS 的可更新 release。");
    }
    return candidates;
}

/**
 * 让用户选择更新目标；自动化模式默认选列表第一项。
 */
async function selectUpdateRelease(releases, currentRelease) {
    if (process.env.NEURO_BOOK_UPDATE_ASSUME_YES === "1") {
        return releases[0];
    }

    const currentTag = currentRelease?.releaseTag ?? "unknown";
    const selected = await p.select({
        message: `当前版本 ${currentTag}，请选择要更新到的版本`,
        options: releases.map((release) => ({
            label: releaseLabel(release),
            value: release.tag_name,
            hint: releaseHint(release),
        })),
        initialValue: releases[0].tag_name,
    });
    if (p.isCancel(selected)) {
        p.cancel("已取消更新。");
        process.exit(0);
    }
    return releases.find((release) => release.tag_name === selected) ?? releases[0];
}

/**
 * 从 release assets 中找到指定文件。
 */
function releaseAsset(release, name) {
    const asset = assetMaybe(release, name);
    if (!asset?.browser_download_url) {
        throw new Error(`所选 release ${release.tag_name} 缺少 asset：${name}`);
    }
    return asset;
}

function assetMaybe(release, name) {
    return release.assets.find((item) => item.name === name);
}

function releaseLabel(release) {
    return `${release.tag_name} (${releaseKind(release)})`;
}

function releaseHint(release) {
    return release.published_at ? new Date(release.published_at).toLocaleString() : undefined;
}

function releaseKind(release) {
    if (!release.prerelease) {
        return "stable";
    }
    const match = /-(canary|alpha|beta|rc)(?:[.+-]|$)/u.exec(release.tag_name);
    return match?.[1] ?? "prerelease";
}

/**
 * 下载、校验并解压新版 Windows portable zip。
 */
async function downloadAndStageUpdate(release, zipAsset, sumsAsset) {
    const safeTag = release.tag_name.replace(/[^a-zA-Z0-9._-]/gu, "_");
    const updateRoot = join(DEPLOY_DIR, "updates", `${safeTag}-${Date.now()}`);
    const downloadRoot = join(updateRoot, "downloads");
    const extractRoot = join(updateRoot, "extract");
    await rm(updateRoot, {recursive: true, force: true});
    await mkdir(downloadRoot, {recursive: true});
    await mkdir(extractRoot, {recursive: true});

    p.log.info(`下载 ${zipAsset.name}`);
    const [zipBuffer, sumsText] = await Promise.all([
        downloadBuffer(zipAsset.browser_download_url),
        downloadText(sumsAsset.browser_download_url),
    ]);
    const expectedHash = checksumFromSums(sumsText, zipAsset.name);
    const actualHash = sha256(zipBuffer);
    if (expectedHash !== actualHash) {
        throw new Error(`更新包 SHA256 校验失败：expected ${expectedHash} actual ${actualHash}`);
    }
    await writeFile(join(downloadRoot, zipAsset.name), zipBuffer);
    await writeFile(join(downloadRoot, sumsAsset.name), sumsText, "utf8");

    p.log.info("解压更新包");
    const entries = unzipSync(new Uint8Array(zipBuffer));
    for (const [name, data] of Object.entries(entries)) {
        if (name.endsWith("/")) {
            continue;
        }
        const parts = name.split("/").filter(Boolean);
        if (parts.length === 0 || parts.some((part) => part === "..")) {
            continue;
        }
        const filePath = join(extractRoot, ...parts);
        await mkdir(dirname(filePath), {recursive: true});
        await writeFile(filePath, data);
    }

    const stagedRoot = await findStagedPortableRoot(extractRoot);
    await assertStagedPortableRoot(stagedRoot);
    await writeState({
        stage: "update-staged",
        updateTag: release.tag_name,
        updateRoot,
    });
    return stagedRoot;
}

/**
 * 定位 zip 解压后的 portable root。
 */
async function findStagedPortableRoot(extractRoot) {
    const direct = join(extractRoot, PACKAGE_ROOT_NAME);
    if (existsSync(join(direct, "portable-release.json"))) {
        return direct;
    }
    const entries = await readdir(extractRoot, {withFileTypes: true});
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const candidate = join(extractRoot, entry.name);
        if (existsSync(join(candidate, "portable-release.json"))) {
            return candidate;
        }
    }
    throw new Error("更新包中未找到 portable-release.json。");
}

/**
 * 校验 staged portable zip 结构。
 */
async function assertStagedPortableRoot(stagedRoot) {
    const requiredFiles = [
        join(stagedRoot, "app", ".output", "server", "index.mjs"),
        join(stagedRoot, "app", "package.json"),
        join(stagedRoot, "launcher", "launcher.mjs"),
        join(stagedRoot, "portable-release.json"),
        join(stagedRoot, "runtime", "bun", "bun.exe"),
        ...LAUNCHER_ROOT_FILES.map((file) => join(stagedRoot, file)),
    ];
    for (const file of requiredFiles) {
        if (!existsSync(file)) {
            throw new Error(`更新包缺少文件：${file}`);
        }
    }
}

/**
 * 切换到 staged Product Payload，并保留 data/。
 */
async function applyPortableUpdate(stagedRoot, releaseTag) {
    const backupRoot = join(DEPLOY_DIR, "backups", `before-${releaseTag.replace(/[^a-zA-Z0-9._-]/gu, "_")}-${Date.now()}`);
    const backups = [];
    await mkdir(backupRoot, {recursive: true});

    try {
        await backupExisting(APP_DIR, join(backupRoot, "app"), backups);
        await backupExisting(join(PORTABLE_ROOT, "launcher"), join(backupRoot, "launcher"), backups);
        await backupExisting(PORTABLE_RELEASE, join(backupRoot, "portable-release.json"), backups);
        for (const file of LAUNCHER_ROOT_FILES) {
            await backupExisting(join(PORTABLE_ROOT, file), join(backupRoot, file), backups);
        }

        await rename(join(stagedRoot, "app"), APP_DIR);
        await rename(join(stagedRoot, "launcher"), join(PORTABLE_ROOT, "launcher"));
        for (const file of LAUNCHER_ROOT_FILES) {
            await cp(join(stagedRoot, file), join(PORTABLE_ROOT, file));
        }
        await writeUpdatedPortableRelease(stagedRoot);
        await writeState({
            stage: "updated",
            updateTag: releaseTag,
            backupRoot,
            runtimeUpdate: "preserved-running-runtime",
        });
    } catch (error) {
        await rollbackUpdate(backups);
        throw error;
    }
}

/**
 * 备份现有文件或目录。
 */
async function backupExisting(source, target, backups) {
    if (!existsSync(source)) {
        return;
    }
    await mkdir(dirname(target), {recursive: true});
    await rename(source, target);
    backups.push({source, target});
}

/**
 * 更新 portable metadata。Bun runtime 在进程内更新时保留旧版本。
 */
async function writeUpdatedPortableRelease(stagedRoot) {
    const release = JSON.parse(await readFile(join(stagedRoot, "portable-release.json"), "utf8"));
    const packagedBunVersion = release.bunVersion ?? null;
    await writeFile(PORTABLE_RELEASE, `${JSON.stringify({
        ...release,
        packagedBunVersion,
        runtimeKind: "bun",
        bunVersion: currentBunVersion(),
        runtimePath: "runtime/bun/bun.exe",
        runtimeUpdate: {
            mode: "preserved-running-runtime",
            note: "Windows Launcher update keeps the currently running runtime/bun directory.",
        },
    }, null, 4)}\n`, "utf8");
}

/**
 * 更新失败时恢复旧文件。
 */
async function rollbackUpdate(backups) {
    for (const item of backups.toReversed()) {
        await rm(item.source, {recursive: true, force: true});
        if (existsSync(item.target)) {
            await rename(item.target, item.source);
        }
    }
    await writeState({stage: "update-rolled-back"});
}

/**
 * 创建或重置管理员。创建成功后自动开启密码保护。
 */
async function createAdmin() {
    await assertProductPayload();
    await ensurePortableConfig();
    await migrate();
    await runProductTsScript("cli/create-admin.ts", {stdio: "inherit"});
    if (!await readAuthEnabled()) {
        await writeAuthEnabled(true);
        p.note("已自动开启密码保护；下次访问需要用刚创建的管理员账号登录。", "密码保护");
    }
}

/**
 * 确认 app/ 是已经打包好的 Product Payload。
 */
async function assertProductPayload() {
    if (!existsSync(SERVER_ENTRY)) {
        throw new Error(`缺少 Product Payload 入口：${SERVER_ENTRY}`);
    }
    if (!existsSync(APP_PACKAGE)) {
        throw new Error(`缺少 Product package manifest：${APP_PACKAGE}`);
    }
}

/**
 * 生成 data/.env、data/config.yaml、data/workspace，并把 app/workspace 映射到 data/workspace。
 */
async function ensurePortableConfig() {
    await mkdir(join(DATA_WORKSPACE_DIR, ".nbook"), {recursive: true});
    await ensureLauncherLogDirectory();
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
    await run(BUN_EXE, [join(APP_DIR, ".output", "server", "scripts", "db", "prisma-migrate.mjs"), "--deploy"], {
        cwd: APP_DIR,
        env: await productEnv(),
    });
    await writeState({stage: "migrated"});
}

/**
 * 启动前准备系统 assets，并同步到 portable data/workspace。
 */
async function prepareSystemAssets() {
    await runProductTsScript("build/prepare-system-assets.ts", {
        args: ["--sync-user-assets"],
        stdio: "inherit",
    });
    await writeState({stage: "system-assets-prepared"});
}

/**
 * 首次启动按鉴权开关引导。portable 默认关闭密码保护；开启且无用户时才强制创建管理员。
 */
async function ensureAdminUser() {
    if (!await readAuthEnabled()) {
        p.note([
            "当前未开启密码保护，浏览器打开即可使用。",
            "如需设置密码：运行 Create Admin.cmd 创建管理员账号，",
            "创建成功后会自动开启密码保护。",
        ].join("\n"), "密码保护");
        return;
    }

    const result = await runProductTsScript("cli/has-users.ts", {stdio: "pipe"});
    if (result.trim() === "yes") {
        return;
    }

    p.note("密码保护已开启，但还没有用户。请先创建管理员账号。", "首次启动");
    await runProductTsScript("cli/create-admin.ts", {stdio: "inherit"});
}

/**
 * 读取 Global Config 鉴权开关。
 * 文件缺失或损坏时按服务端默认值 true 处理，避免误把已上锁部署当成未开启。
 */
async function readAuthEnabled() {
    try {
        const config = JSON.parse(await readFile(join(DATA_WORKSPACE_DIR, ".nbook", "config.json"), "utf8"));
        return config?.auth?.enabled ?? true;
    } catch {
        return true;
    }
}

/**
 * 写回 Global Config 鉴权开关，保留其他配置字段。
 */
async function writeAuthEnabled(enabled) {
    const configPath = join(DATA_WORKSPACE_DIR, ".nbook", "config.json");
    const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, "utf8")) : {};
    config.auth = {...config.auth, enabled};
    await writeFile(configPath, `${JSON.stringify(config, null, 4)}\n`, "utf8");
}

/**
 * 使用内置 Bun 运行产品脚本，不依赖根 node_modules。
 */
async function runProductTsScript(relativeScript, options) {
    const scriptPath = join(APP_DIR, ".output", "server", "scripts", relativeScript);
    return run(BUN_EXE, [scriptPath, ...(options.args ?? [])], {
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
    const logSink = await createLauncherLogSink();
    const stdoutFormatter = createProcessLogFormatter("server.stdout");
    const stderrFormatter = createProcessLogFormatter("server.stderr");
    const child = spawn(BUN_EXE, [SERVER_ENTRY], {
        cwd: APP_DIR,
        env,
        stdio: ["inherit", "pipe", "pipe"],
        windowsHide: false,
    });
    child.stdout?.on("data", (chunk) => {
        process.stdout.write(chunk);
        logSink.write(stdoutFormatter.write(chunk));
    });
    child.stderr?.on("data", (chunk) => {
        process.stderr.write(chunk);
        logSink.write(stderrFormatter.write(chunk));
    });

    if (process.env.NEURO_BOOK_NO_OPEN_BROWSER !== "1") {
        setTimeout(() => {
            void openBrowser(url);
        }, 1500);
    }

    await new Promise((resolvePromise, rejectPromise) => {
        child.on("error", async (error) => {
            logSink.write(stdoutFormatter.flush());
            logSink.write(stderrFormatter.flush());
            await logSink.close();
            rejectPromise(error);
        });
        child.on("exit", async (code, signal) => {
            logSink.write(stdoutFormatter.flush());
            logSink.write(stderrFormatter.flush());
            await logSink.close();
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
        NEURO_BOOK_LOG_DIR: env.NEURO_BOOK_LOG_DIR ?? DATA_LOG_DIR,
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
 * 下载二进制内容。
 */
async function downloadBuffer(url) {
    const response = await fetch(url, {
        headers: {
            "User-Agent": "NeuroBook-Windows-Launcher",
        },
    });
    if (!response.ok) {
        throw new Error(`下载失败：${url} ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * 下载文本内容。
 */
async function downloadText(url) {
    return (await downloadBuffer(url)).toString("utf8");
}

/**
 * 从 SHA256SUMS 中读取指定 asset 的 hash。
 */
function checksumFromSums(text, assetName) {
    for (const line of text.split(/\r?\n/u)) {
        const parts = line.trim().split(/\s+/u);
        if (parts.length >= 2 && basename(parts.at(-1)) === assetName) {
            return parts[0].toLowerCase();
        }
    }
    throw new Error(`SHA256SUMS 中缺少 ${assetName}`);
}

function sha256(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

/**
 * 打开浏览器。
 */
async function openBrowser(url) {
    if (process.platform === "win32") {
        await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Start-Process '${url.replaceAll("'", "''")}'`], {stdio: "ignore"});
        return;
    }
    await run(BUN_EXE, ["-e", `import('node:child_process').then(({spawn})=>spawn(${JSON.stringify(process.platform === "darwin" ? "open" : "xdg-open")},[${JSON.stringify(url)}],{stdio:'ignore',detached:true}).unref())`], {stdio: "ignore"});
}

function currentBunVersion() {
    return globalThis.Bun?.version ?? "unknown";
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
        "NEURO_BOOK_LOG_DIR=../data/logs",
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
        // Windows portable 是本机单人场景，默认不上锁；Create Admin 会把它翻回 true。
        auth: {enabled: false},
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
    void writeLauncherLog("error", error instanceof Error ? error.stack ?? error.message : String(error));
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

function launcherLogPath() {
    return join(DATA_LOG_DIR, `launcher-${new Date().toISOString().slice(0, 10)}.log`);
}

async function ensureLauncherLogDirectory() {
    try {
        await mkdir(DATA_LOG_DIR, {recursive: true});
    } catch (error) {
        process.stderr.write(`[launcher-log] mkdir failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
}

async function writeLauncherLog(level, message) {
    try {
        await mkdir(DATA_LOG_DIR, {recursive: true});
        await rotateLauncherLogIfNeeded(Buffer.byteLength(message, "utf8"));
        await writeFile(launcherLogPath(), `[${new Date().toISOString()}] [${level}] ${redactSensitiveText(message)}\n`, {encoding: "utf8", flag: "a"});
        await pruneLauncherLogFiles();
    } catch (error) {
        process.stderr.write(`[launcher-log] write failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
}

function createProcessLogFormatter(source) {
    let pending = "";
    return {
        write(chunk) {
            pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
            const lines = pending.split(/\r?\n/u);
            pending = lines.pop() ?? "";
            return lines.map((line) => formatProcessLine(source, line)).join("");
        },
        flush() {
            if (!pending) {
                return "";
            }
            const line = pending;
            pending = "";
            return formatProcessLine(source, line);
        },
    };
}

function formatProcessLine(source, line) {
    if (!line) {
        return "";
    }
    return `[${new Date().toISOString()}] [${source}] ${redactSensitiveText(line)}\n`;
}

function redactSensitiveText(input) {
    return [
        [/\b(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;"']+/giu, "$1$2[REDACTED]"],
        [/\b(cookie|set-cookie)\s*[:=]\s*[^\r\n]+/giu, "$1=[REDACTED]"],
        [/\b(api[-_]?key|apikey|password|token|secret|credential)\s*[:=]\s*([^\s,;"']+)/giu, "$1=[REDACTED]"],
        [/\b(sk-[A-Za-z0-9_-]{12,})\b/gu, "[REDACTED]"],
    ].reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}

async function createLauncherLogSink() {
    try {
        return await createFileLauncherLogSink();
    } catch (error) {
        process.stderr.write(`[launcher-log] init failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return {
            write() {},
            async close() {},
        };
    }
}

async function createFileLauncherLogSink() {
    await mkdir(DATA_LOG_DIR, {recursive: true});
    await rotateLauncherLogIfNeeded(0);
    await pruneLauncherLogFiles();
    let bytes = await launcherLogSize();
    let stream = createWriteStream(launcherLogPath(), {flags: "a"});
    let failed = false;
    let closed = false;
    let queue = Promise.resolve();

    const markFailed = (error) => {
        failed = true;
        process.stderr.write(`[launcher-log] write failed: ${error instanceof Error ? error.message : String(error)}\n`);
    };
    stream.on("error", markFailed);

    return {
        write(text) {
            if (!text || closed || failed) {
                return;
            }
            queue = queue.then(async () => {
                if (failed) {
                    return;
                }
                const textBytes = Buffer.byteLength(text, "utf8");
                if (bytes + textBytes > LAUNCHER_LOG_MAX_BYTES) {
                    await closeLogStream(stream);
                    await rotateLauncherLogFile();
                    await pruneLauncherLogFiles();
                    bytes = 0;
                    stream = createWriteStream(launcherLogPath(), {flags: "a"});
                    stream.on("error", markFailed);
                }
                if (failed) {
                    return;
                }
                stream.write(text);
                bytes += textBytes;
            }).catch(markFailed);
        },
        async close() {
            closed = true;
            await queue.catch(() => undefined);
            await closeLogStream(stream);
        },
    };
}

function closeLogStream(logStream) {
    return new Promise((resolvePromise) => {
        if (logStream.closed || logStream.destroyed) {
            resolvePromise();
            return;
        }
        logStream.once("finish", resolvePromise);
        logStream.once("error", resolvePromise);
        logStream.end();
    });
}

async function rotateLauncherLogIfNeeded(nextBytes) {
    if (await launcherLogSize() + nextBytes <= LAUNCHER_LOG_MAX_BYTES) {
        return;
    }
    await rotateLauncherLogFile();
}

async function launcherLogSize() {
    try {
        const stat = await lstat(launcherLogPath());
        return stat.size;
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return 0;
        }
        throw error;
    }
}

async function rotateLauncherLogFile() {
    const source = launcherLogPath();
    if (!existsSync(source)) {
        return;
    }
    const target = join(DATA_LOG_DIR, `launcher-${formatLauncherRotatedTimestamp(new Date())}-${process.pid}-${randomBytes(4).toString("hex")}.log`);
    await rename(source, target);
}

async function pruneLauncherLogFiles() {
    const entries = await readdir(DATA_LOG_DIR, {withFileTypes: true}).catch((error) => {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    });
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || !/^launcher-\d{4}-\d{2}-\d{2}(?:-\d{6}-\d+-[a-f0-9]+)?\.log$/iu.test(entry.name)) {
            continue;
        }
        const filePath = join(DATA_LOG_DIR, entry.name);
        const stat = await lstat(filePath);
        files.push({path: filePath, mtimeMs: stat.mtimeMs, name: entry.name});
    }
    files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    for (const file of files.slice(LAUNCHER_LOG_RETENTION)) {
        await rm(file.path, {force: true});
    }
}

function formatLauncherRotatedTimestamp(date) {
    const day = date.toISOString().slice(0, 10);
    const time = date.toISOString().slice(11, 19).replace(/:/g, "");
    return `${day}-${time}`;
}
