#!/usr/bin/env node
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {delimiter, dirname, relative, resolve} from "node:path";
import {Command} from "commander";
import * as p from "@clack/prompts";
import * as yaml from "yaml";

const REPO_URL = "https://github.com/notnotype/neuro-book.git";
const DEFAULT_IMAGE = "ghcr.io/notnotype/neuro-book:latest";
const DEPLOY_DIRNAME = ".deploy";
const ENV_FILENAME = ".env";
const CONFIG_FILENAME = "config.yaml";
const GLOBAL_CONFIG_FILENAME = "workspace/.nbook/config.json";
const LOCAL_GIT_DEPLOY_MODE = "local-git";
const DEPLOY_MODES = [LOCAL_GIT_DEPLOY_MODE, "ghcr", "source"];
const DOCKER_DEPLOY_MODES = ["ghcr", "source"];
const NATIVE_REQUIRED_COMMANDS = [
    {command: "node", label: "Node.js", required: true},
    {command: "npm", label: "npm", required: true},
    {command: "git", label: "Git", required: true},
    {command: "bun", label: "Bun", required: true},
    {command: "rg", label: "ripgrep", required: true},
];
const NATIVE_UNIX_COMMANDS = [
    {command: "bash", label: "bash", required: true},
    {command: "env", label: "coreutils", required: true, args: []},
    {command: "find", label: "findutils", required: true, args: [".", "-type", "d", "-prune"]},
];
const NATIVE_RECOMMENDED_COMMANDS = [
    {command: "python3", label: "Python 3", required: false},
];
const PROVIDERS = {
    deepseek: {
        name: "DeepSeek",
        baseURL: "",
        modelId: "deepseek-v4-flash",
        modelName: "DeepSeek-V4-Flash",
        modelGroup: "deepseek",
        contextWindowTokens: 262144,
    },
    doubao: {
        name: "Doubao",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        modelId: "doubao-seed-2-0-pro",
        modelName: "Doubao Seed 2.0 Pro",
        modelGroup: "doubao",
        contextWindowTokens: 262144,
    },
    qwen: {
        name: "Qwen",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelId: "qwen3.6-plus",
        modelName: "Qwen 3.6 Plus",
        modelGroup: "qwen",
        contextWindowTokens: 262144,
    },
    siliconflow: {
        name: "SiliconFlow",
        baseURL: "https://api.siliconflow.cn/v1",
        modelId: "deepseek-ai/DeepSeek-V4-Flash",
        modelName: "DeepSeek-V4-Flash",
        modelGroup: "deepseek",
        contextWindowTokens: 262144,
    },
    gemini: {
        name: "Gemini",
        baseURL: "",
        modelId: "gemini-3-pro-preview-maxthinking",
        modelName: "Gemini 3 Pro Preview MaxThinking",
        modelGroup: "gemini",
        contextWindowTokens: null,
    },
};

const program = new Command()
    .name("neuro-book-deploy")
    .description("Interactive deployment for neuro-book.")
    .option("--repo <url>", "Git repository URL.", process.env.NEURO_BOOK_REPO_URL ?? REPO_URL)
    .option("--dir <path>", "Deployment directory.", process.env.NEURO_BOOK_DEPLOY_DIR ?? resolve(homedir(), "neuro-book"))
    .option("--port <port>", "HTTP port.", process.env.NEURO_BOOK_PORT ?? "3000")
    .option("--provider <provider>", "Model provider: deepseek, doubao, qwen, siliconflow, gemini.")
    .option("--api-key <key>", "Provider API key.")
    .option("--database <mode>", "Database mode. Only sqlite is supported.")
    .option("--deploy-mode <mode>", "Deploy mode: local-git, ghcr, or source. native is accepted as an alias.", process.env.NEURO_BOOK_DEPLOY_MODE)
    .option("--image <image>", "GHCR app image.", process.env.NEURO_BOOK_IMAGE ?? DEFAULT_IMAGE)
    .option("--windows-package-manager <manager>", "Windows local-git dependency installer: auto, winget, or scoop.", process.env.NEURO_BOOK_WINDOWS_PACKAGE_MANAGER)
    .option("--redeploy", "Regenerate .deploy compose files while preserving existing .env, config.yaml and workspace config.", false)
    .option("--yes", "Use defaults and skip interactive prompts.", false)
    .option("--dry-run", "Preview files and commands. local-git mode still probes local commands, but does not install, build, migrate, start services or write files.", process.env.NEURO_BOOK_DEPLOY_DRY_RUN === "1")
    .option("--internal-print-install-plans", "Print local-git install command mapping examples and exit.", false);

program.parse();

/** 把用户取消交互转成干净退出。 */
function unwrapPrompt(value) {
    if (p.isCancel(value)) {
        p.cancel("部署已取消。");
        process.exit(0);
    }

    return value;
}

/** 校验端口字符串是否是 Docker Compose 可用的 TCP 端口。 */
function validatePort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return "端口必须是 1 到 65535 之间的整数。";
    }

    return undefined;
}

/** 生成部署密钥，避免 URL 密码中出现需要转义的字符。 */
function randomSecret() {
    return randomBytes(32).toString("hex");
}

/** 运行外部命令，并把输出直接继承给当前终端。 */
function run(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ? {...process.env, ...options.env} : process.env,
            stdio: options.stdio ?? "inherit",
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

/** 运行外部命令并返回 stdout，错误时携带 stderr。 */
function runCapture(command, args, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ? {...process.env, ...options.env} : process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf-8");
        child.stderr.setEncoding("utf-8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
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
                rejectPromise(new Error(`命令执行失败：${command} ${args.join(" ")}，退出码 ${code}\n${stderr.trim()}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}

/** 检查命令是否可用。 */
async function needCommand(command, args = ["--version"]) {
    await run(command, args, {stdio: "ignore"});
}

/** 检查命令是否能启动；用于部署前置依赖探测。 */
async function commandAvailable(command, args = ["--version"]) {
    try {
        if (process.platform === "win32") {
            const psArgs = args.map((item) => psQuote(item)).join(", ");
            await run("powershell.exe", [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                `$command = Get-Command ${psQuote(command)} -ErrorAction Stop; & $command.Source ${psArgs} | Out-Null`,
            ], {stdio: "ignore"});
            return true;
        }

        await needCommand(command, args);
        return true;
    } catch {
        return false;
    }
}

/** PowerShell 单引号字符串转义。 */
function psQuote(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

/** 运行平台 shell 命令，主要用于系统包管理器安装命令。 */
async function runShell(commandLine, options = {}) {
    if (process.platform === "win32") {
        await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", commandLine], options);
        return;
    }

    await run("sh", ["-lc", commandLine], options);
}

/** 在交互模式下确认；非交互模式直接返回 false。 */
async function askConfirm({interactive, message, initialValue = true}) {
    if (!interactive) {
        return false;
    }

    return Boolean(unwrapPrompt(await p.confirm({
        message,
        initialValue,
    })));
}

/** 返回当前平台 local-git 模式要检查的可执行文件。 */
function nativeCommands() {
    return [
        ...NATIVE_REQUIRED_COMMANDS,
        ...(process.platform === "win32" ? [] : NATIVE_UNIX_COMMANDS),
        ...NATIVE_RECOMMENDED_COMMANDS,
    ];
}

/** 把脚本安装器常见落点加入当前进程 PATH，避免安装后需要重开终端。 */
function refreshInstallPath() {
    const candidates = process.platform === "win32"
        ? [
            resolve(process.env.LOCALAPPDATA ?? "", "Programs", "Bun", "bin"),
            resolve(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd"),
        ]
        : [
            resolve(homedir(), ".bun", "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ];
    const current = process.env.PATH ?? "";
    const parts = current.split(delimiter).filter(Boolean);
    for (const candidate of candidates) {
        if (candidate && existsSync(candidate) && !parts.includes(candidate)) {
            parts.unshift(candidate);
        }
    }
    process.env.PATH = parts.join(delimiter);
}

/** 生成指定平台的安装命令建议；纯函数，便于 dry-run 和内部映射检查复用。 */
function installPlanCandidates({platform, missingCommands, windowsPackageManager = "auto"}) {
    if (missingCommands.length === 0) {
        return [];
    }

    const missing = new Set(missingCommands);
    if (platform === "win32") {
        const wingetPackages = [
            missing.has("node") || missing.has("npm") ? "OpenJS.NodeJS" : null,
            missing.has("git") ? "Git.Git" : null,
            missing.has("rg") ? "BurntSushi.ripgrep.MSVC" : null,
            missing.has("bun") ? "Oven-sh.Bun" : null,
            missing.has("python3") ? "Python.Python.3.13" : null,
        ].filter(Boolean);
        const scoopPackages = [
            missing.has("node") || missing.has("npm") ? "nodejs-lts" : null,
            missing.has("git") ? "git" : null,
            missing.has("rg") ? "ripgrep" : null,
            missing.has("bun") ? "bun" : null,
            missing.has("python3") ? "python" : null,
        ].filter(Boolean);
        if (wingetPackages.length === 0 && scoopPackages.length === 0) {
            return [];
        }

        const plans = [];
        if (windowsPackageManager === "auto" || windowsPackageManager === "winget") {
            plans.push({
                manager: "winget",
                probeCommand: "winget",
                commandLine: wingetPackages.map((name) => `winget install --id ${name} --exact --source winget`).join("; "),
            });
        }
        if (windowsPackageManager === "auto" || windowsPackageManager === "scoop") {
            plans.push({
                manager: "scoop",
                probeCommand: "scoop",
                commandLine: `scoop install ${scoopPackages.join(" ")}`,
            });
        }
        return plans.filter((plan) => plan.commandLine.trim().length > 0);
    }

    if (platform === "darwin") {
        const packages = [
            missing.has("node") || missing.has("npm") ? "node" : null,
            missing.has("git") ? "git" : null,
            missing.has("rg") ? "ripgrep" : null,
            missing.has("bun") ? "oven-sh/bun/bun" : null,
            missing.has("python3") ? "python" : null,
            missing.has("bash") ? "bash" : null,
            missing.has("env") ? "coreutils" : null,
            missing.has("find") ? "findutils" : null,
        ].filter(Boolean);
        if (packages.length === 0) {
            return [];
        }

        return [{
            manager: "brew",
            probeCommand: "brew",
            commandLine: `brew install ${packages.join(" ")}`,
        }];
    }

    const bunInstall = "curl -fsSL https://bun.sh/install | bash";
    const linuxPackages = (packageNames) => Array.from(new Set([
        missing.has("node") || missing.has("npm") ? packageNames.node : null,
        missing.has("npm") ? packageNames.npm : null,
        missing.has("git") ? packageNames.git : null,
        missing.has("rg") ? packageNames.rg : null,
        missing.has("bash") ? packageNames.bash : null,
        missing.has("env") ? packageNames.coreutils : null,
        missing.has("find") ? packageNames.coreutils : null,
        missing.has("find") ? packageNames.findutils : null,
        missing.has("python3") ? packageNames.python3 : null,
        missing.has("bun") ? packageNames.curl : null,
        missing.has("bun") ? packageNames.unzip : null,
        missing.has("bun") ? packageNames.caCertificates : null,
    ].filter(Boolean)));
    const linuxInstall = ({prefix = "", installCommand, packageNames}) => {
        const packages = linuxPackages(packageNames);
        const packageCommand = packages.length > 0 ? `${prefix}${installCommand} ${packages.join(" ")}` : "";
        if (!missing.has("bun")) {
            return packageCommand;
        }
        return packageCommand ? `${packageCommand} && ${bunInstall}` : bunInstall;
    };

    return [
        {
            manager: "apt-get",
            probeCommand: "apt-get",
            commandLine: linuxInstall({
                prefix: "sudo apt-get update && ",
                installCommand: "sudo apt-get install -y",
                packageNames: {node: "nodejs", npm: "npm", git: "git", rg: "ripgrep", bash: "bash", coreutils: "coreutils", findutils: "findutils", python3: "python3", curl: "curl", unzip: "unzip", caCertificates: "ca-certificates"},
            }),
        },
        {
            manager: "dnf",
            probeCommand: "dnf",
            commandLine: linuxInstall({
                installCommand: "sudo dnf install -y",
                packageNames: {node: "nodejs", npm: "npm", git: "git", rg: "ripgrep", bash: "bash", coreutils: "coreutils", findutils: "findutils", python3: "python3", curl: "curl", unzip: "unzip", caCertificates: "ca-certificates"},
            }),
        },
        {
            manager: "yum",
            probeCommand: "yum",
            commandLine: linuxInstall({
                installCommand: "sudo yum install -y",
                packageNames: {node: "nodejs", npm: "npm", git: "git", rg: "ripgrep", bash: "bash", coreutils: "coreutils", findutils: "findutils", python3: "python3", curl: "curl", unzip: "unzip", caCertificates: "ca-certificates"},
            }),
        },
        {
            manager: "pacman",
            probeCommand: "pacman",
            commandLine: linuxInstall({
                installCommand: "sudo pacman -Sy --needed",
                packageNames: {node: "nodejs", npm: "npm", git: "git", rg: "ripgrep", bash: "bash", coreutils: "coreutils", findutils: "findutils", python3: "python", curl: "curl", unzip: "unzip", caCertificates: "ca-certificates"},
            }),
        },
        {
            manager: "zypper",
            probeCommand: "zypper",
            commandLine: linuxInstall({
                installCommand: "sudo zypper install -y",
                packageNames: {node: "nodejs", npm: "npm", git: "git", rg: "ripgrep", bash: "bash", coreutils: "coreutils", findutils: "findutils", python3: "python3", curl: "curl", unzip: "unzip", caCertificates: "ca-certificates"},
            }),
        },
        {
            manager: "apk",
            probeCommand: "apk",
            commandLine: linuxInstall({
                installCommand: "sudo apk add",
                packageNames: {node: "nodejs", npm: "npm", git: "git", rg: "ripgrep", bash: "bash", coreutils: "coreutils", findutils: "findutils", python3: "python3", curl: "curl", unzip: "unzip", caCertificates: "ca-certificates"},
            }),
        },
    ];
}

/** 打印固定平台/缺失工具样例，用于人工核对安装命令映射。 */
function printInternalInstallPlans() {
    const cases = [
        {name: "windows auto git rg bun", platform: "win32", windowsPackageManager: "auto", missingCommands: ["git", "rg", "bun"]},
        {name: "windows winget git rg bun", platform: "win32", windowsPackageManager: "winget", missingCommands: ["git", "rg", "bun"]},
        {name: "windows scoop git rg bun", platform: "win32", windowsPackageManager: "scoop", missingCommands: ["git", "rg", "bun"]},
        {name: "macos git rg bun", platform: "darwin", missingCommands: ["git", "rg", "bun"]},
        {name: "linux rg only", platform: "linux", missingCommands: ["rg"]},
        {name: "linux bun", platform: "linux", missingCommands: ["bun"]},
        {name: "linux python3", platform: "linux", missingCommands: ["python3"]},
        {name: "linux coreutils/findutils", platform: "linux", missingCommands: ["env", "find"]},
    ];

    for (const item of cases) {
        p.log.info(`[${item.name}]`);
        const plans = installPlanCandidates({
            platform: item.platform,
            missingCommands: item.missingCommands,
            windowsPackageManager: item.windowsPackageManager ?? "auto",
        });
        for (const plan of plans) {
            p.log.info(`${plan.manager}: ${plan.commandLine}`);
        }
    }
}

/** 给用户展示缺失工具和安装建议。 */
function formatMissingCommandHelp(missing, plan) {
    const missingText = missing.map((item) => `${item.label} (${item.command})`).join(", ");
    const installText = plan
        ? `可尝试安装命令：\n${plan.commandLine}`
        : "当前平台没有可自动执行的安装命令。请手动安装缺失工具后重试。";

    return `缺少 local-git 部署所需工具：${missingText}\n${installText}`;
}

/** 检查 local-git 宿主机依赖，并按用户确认执行安装命令。 */
async function ensureNativeCommands(config) {
    if (config.deployMode !== LOCAL_GIT_DEPLOY_MODE) {
        return;
    }

    const missing = [];
    for (const command of nativeCommands()) {
        const available = await commandAvailable(command.command, command.args ?? ["--version"]);
        if (!available) {
            missing.push(command);
        }
    }

    if (missing.length === 0) {
        return;
    }

    const missingRequired = missing.filter((item) => item.required);

    const plans = installPlanCandidates({
        platform: process.platform,
        missingCommands: missing.map((item) => item.command),
        windowsPackageManager: config.windowsPackageManager,
    });
    let plan = null;
    for (const candidate of plans) {
        if (await commandAvailable(candidate.probeCommand)) {
            plan = candidate;
            break;
        }
    }

    if (config.dryRun) {
        p.log.warn(formatMissingCommandHelp(missing, plan));
        if (plan) {
            p.log.info(`Dry run command: ${plan.commandLine}`);
        }
        return;
    }

    p.log.warn(formatMissingCommandHelp(missing, plan));
    if (!plan && missingRequired.length > 0) {
        throw new Error(formatMissingCommandHelp(missing, plan));
    }
    if (!plan) {
        return;
    }

    const shouldInstall = await askConfirm({
        interactive: config.interactive,
        message: `是否现在使用 ${plan.manager} 安装缺失工具？`,
        initialValue: true,
    });

    if (!shouldInstall) {
        if (missingRequired.length > 0) {
            throw new Error("local-git 部署缺少必要工具，已按用户选择停止。");
        }
        p.log.warn("local-git 部署建议工具未安装，继续执行。");
        return;
    }

    await runShell(plan.commandLine);
    refreshInstallPath();

    const stillMissing = [];
    for (const command of nativeCommands()) {
        const available = await commandAvailable(command.command);
        if (!available) {
            stillMissing.push(command);
        }
    }

    const stillMissingRequired = stillMissing.filter((item) => item.required);
    if (stillMissingRequired.length > 0) {
        throw new Error(formatMissingCommandHelp(stillMissingRequired, plan));
    }

    if (stillMissing.length > 0) {
        p.log.warn(formatMissingCommandHelp(stillMissing, plan));
    }
}

/** 按平台返回 .env 加载方式说明。 */
function nativeStartHelp(command) {
    if (process.platform === "win32") {
        return [
            "Get-Content .env | ForEach-Object {",
            "    if ($_ -match '^[^#][^=]+=') {",
            "        $name, $value = $_ -split '=', 2",
            "        Set-Item -Path \"Env:$name\" -Value $value",
            "    }",
            "}",
            command,
        ].join("\n");
    }

    return `set -a && . ./.env && set +a && ${command}`;
}

/** 返回 local-git 启动脚本文件名。 */
function nativeStartScriptName() {
    return process.platform === "win32" ? "start-local-git.ps1" : "start-local-git.sh";
}

/** 返回 local-git 管理员创建脚本文件名。 */
function nativeAdminScriptName() {
    return process.platform === "win32" ? "create-admin-local-git.ps1" : "create-admin-local-git.sh";
}

/** 生成 local-git 启动脚本。 */
function renderNativeScript(command) {
    if (process.platform === "win32") {
        return [
            "$ErrorActionPreference = \"Stop\"",
            "Set-Location (Split-Path -Parent $PSScriptRoot)",
            "Get-Content .env | ForEach-Object {",
            "    if ($_ -match '^[^#][^=]+=') {",
            "        $name, $value = $_ -split '=', 2",
            "        Set-Item -Path \"Env:$name\" -Value $value",
            "    }",
            "}",
            command,
            "",
        ].join("\n");
    }

    return [
        "#!/usr/bin/env sh",
        "set -eu",
        "cd \"$(dirname \"$0\")/..\"",
        "set -a",
        ". ./.env",
        "set +a",
        command,
        "",
    ].join("\n");
}

/** 格式化即将执行的命令，供 dry-run 展示。 */
function commandText(command, args = [], options = {}) {
    const prefix = options.cwd ? `(cd ${options.cwd}) ` : "";
    return `${prefix}${[command, ...args].map(shellArg).join(" ")}`;
}

/** 简单 shell 参数展示转义，仅用于说明文本。 */
function shellArg(value) {
    const text = String(value);
    if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) {
        return text;
    }
    return `"${text.replaceAll("\"", "\\\"")}"`;
}

/** dry-run 展示命令。 */
function dryRunCommand(command, args = [], options = {}) {
    p.log.info(`Dry run command: ${commandText(command, args, options)}`);
}

/** 查询路径是否存在，并返回 stat 信息。 */
async function tryStat(path) {
    try {
        return await stat(path);
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

/** 在交互模式下询问文本；非交互模式直接使用默认值。 */
async function askText({interactive, value, message, placeholder, initialValue, validate}) {
    if (value !== undefined && value !== null && value !== "") {
        return String(value);
    }

    if (!interactive) {
        return String(initialValue ?? "");
    }

    return String(unwrapPrompt(await p.text({
        message,
        placeholder,
        initialValue,
        validate,
    })));
}

/** 在交互模式下选择选项；非交互模式直接使用默认值。 */
async function askSelect({interactive, value, message, options, initialValue}) {
    if (value !== undefined && value !== null && value !== "") {
        return String(value).toLowerCase();
    }

    if (!interactive) {
        return String(initialValue);
    }

    return String(unwrapPrompt(await p.select({
        message,
        options,
        initialValue,
    })));
}

/** 从已有 generated compose 推断部署模式，支持旧 source override。 */
async function inferDeployMode(deployDir) {
    const generatedComposePath = resolve(deployDir, DEPLOY_DIRNAME, "docker-compose.generated.yml");
    if (!existsSync(generatedComposePath)) {
        return null;
    }

    const content = await readFile(generatedComposePath, "utf-8");
    if (content.includes("Dockerfile.source-runtime") || content.includes("neuro-book-source-runtime") || content.includes("oven/bun:1")) {
        return "source";
    }

    if (content.includes("ghcr.io/")) {
        return "ghcr";
    }

    return null;
}

/** 收集部署参数。 */
async function readConfig(options) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.yes);
    const deployDir = resolve(await askText({
        interactive,
        value: options.dir,
        message: "部署目录",
        initialValue: resolve(homedir(), "neuro-book"),
    }));
    const port = await askText({
        interactive,
        value: options.port,
        message: "Web 端口",
        initialValue: "3000",
        validate: validatePort,
    });
    const provider = options.provider !== undefined && options.provider !== null
        ? String(options.provider).toLowerCase()
        : null;

    if (provider && !PROVIDERS[provider]) {
        throw new Error(`不支持的 Provider：${provider}`);
    }

    const apiKey = options.apiKey !== undefined && options.apiKey !== null ? String(options.apiKey) : "";
    if (apiKey && !provider) {
        throw new Error("使用 --api-key 时必须同时传入 --provider。部署交互不会主动询问 Provider，可部署后在前端设置页配置。");
    }
    const inferredDeployMode = options.redeploy && !options.deployMode
        ? await inferDeployMode(deployDir)
        : null;
    const rawDeployMode = await askSelect({
        interactive,
        value: options.deployMode ?? inferredDeployMode,
        message: "部署模式",
        initialValue: LOCAL_GIT_DEPLOY_MODE,
        options: [
            {value: LOCAL_GIT_DEPLOY_MODE, label: "本机 + Git", hint: "默认推荐，clone/pull 后宿主机构建"},
            {value: "ghcr", label: "使用 GHCR 预构建镜像", hint: "高级选项，需要 Docker"},
            {value: "source", label: "挂载宿主机源码", hint: "高级选项，需要 Docker + 宿主机 Bun"},
        ],
    });
    const deployMode = normalizeDeployMode(rawDeployMode);
    if (rawDeployMode === "native") {
        p.log.info("--deploy-mode native 已兼容映射为 local-git。");
    }

    if (!DEPLOY_MODES.includes(deployMode)) {
        throw new Error(`部署模式必须是 local-git、ghcr 或 source：${deployMode}`);
    }
    const windowsPackageManager = process.platform === "win32" && deployMode === LOCAL_GIT_DEPLOY_MODE
        ? await askSelect({
            interactive,
            value: options.windowsPackageManager,
            message: "Windows 包管理器",
            initialValue: "auto",
            options: [
                {value: "auto", label: "自动选择", hint: "优先 winget，其次 scoop"},
                {value: "winget", label: "winget", hint: "Windows 官方入口"},
                {value: "scoop", label: "Scoop", hint: "开发者工具链常用"},
            ],
        })
        : "auto";
    if (!["auto", "winget", "scoop"].includes(windowsPackageManager)) {
        throw new Error(`Windows 包管理器必须是 auto、winget 或 scoop：${windowsPackageManager}`);
    }

    const databaseMode = normalizeDatabaseMode(options.database ?? "sqlite");

    const image = deployMode === "ghcr"
        ? await askText({
            interactive,
            value: options.image,
            message: "应用镜像",
            initialValue: DEFAULT_IMAGE,
        })
        : options.image;

    return {
        apiKey,
        databaseMode,
        deployDir,
        deployMode,
        dryRun: Boolean(options.dryRun),
        image,
        interactive,
        port,
        provider,
        redeploy: Boolean(options.redeploy),
        repo: options.repo,
        windowsPackageManager,
    };
}

/** 生成 Docker Compose 使用的环境变量文件。 */
function renderEnv(config, sessionPassword) {
    return [
        `NUXT_PORT=${config.port}`,
        `NUXT_SESSION_PASSWORD=${sessionPassword}`,
        "",
        "DATABASE_KIND=sqlite",
        "DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite",
        "",
    ].join("\n");
}

/** 生成启动/部署期 Boot Config。 */
function renderBootConfig(config, env) {
    return `# neuro-book Boot Config.
# This file is for startup/deployment settings only.
# Provider keys, model defaults and Agent profile settings live in ${GLOBAL_CONFIG_FILENAME}.
server:
  host: '0.0.0.0'
  port: ${config.port}
database:
  kind: \${DATABASE_KIND:-sqlite}
  url: \${DATABASE_URL:-file:./workspace/.nbook/neuro-book.sqlite}
`;
}

/** 生成 Workspace Root `.nbook/config.json` 业务配置。 */
function renderGlobalConfig(config, legacyText = null) {
    const legacy = legacyText ? parseLegacyGlobalConfig(legacyText) : null;
    const selectedProvider = config.provider ? createSelectedProvider(config) : null;
    const modelKey = selectedProvider
        ? `${selectedProvider.id}/${selectedProvider.models[0]?.id ?? ""}`
        : null;
    const providers = legacy?.models?.providers?.length && config.provider
        ? ensureSelectedProvider(legacy.models.providers, config)
        : legacy?.models?.providers?.length
        ? legacy.models.providers
        : selectedProvider
        ? [selectedProvider]
        : [];

    return `${JSON.stringify({
        auth: {
            enabled: legacy?.auth?.enabled ?? true,
        },
        models: {
            default: legacy?.models?.default ?? modelKey,
            providers,
        },
        agent: {
            defaultProfileKey: {
                novel: legacy?.agent?.defaultProfileKey?.novel ?? "leader.default",
                userAssets: legacy?.agent?.defaultProfileKey?.userAssets ?? "leader.assets",
            },
            profiles: legacy?.agent?.profiles ?? {},
        },
        ui: {
            theme: legacy?.ui?.theme ?? "sepia",
        },
        editor: legacy?.editor ?? {},
    }, null, 4)}\n`;
}

/** 确保本次交互选择的 Provider 也存在，但不丢弃旧配置中的其他 Provider。 */
function ensureSelectedProvider(providers, config) {
    if (providers.some((item) => item.id === config.provider)) {
        return providers;
    }
    return [...providers, createSelectedProvider(config)];
}

/** 根据交互输入创建默认 Provider 配置。 */
function createSelectedProvider(config) {
    const provider = PROVIDERS[config.provider];
    return {
        id: config.provider,
        name: provider.name,
        options: {
            apiKey: config.apiKey,
            baseURL: provider.baseURL,
            proxy: "",
            timeoutMs: 180000,
            requestOptions: {},
        },
        models: [
            {
                name: provider.modelName,
                id: provider.modelId,
                group: provider.modelGroup,
                enabled: true,
                contextWindowTokens: provider.contextWindowTokens,
            },
        ],
    };
}

/** 从旧 config.yaml 提取可迁移的 Global Config 字段。 */
function parseLegacyGlobalConfig(text) {
    const parsed = yaml.parse(text);
    if (!parsed || typeof parsed !== "object") {
        return null;
    }

    const providers = parsed.models?.providers && typeof parsed.models.providers === "object" && !Array.isArray(parsed.models.providers)
        ? Object.entries(parsed.models.providers).map(([providerId, provider]) => ({
            id: providerId,
            name: provider?.name ?? providerId,
            options: provider?.options ?? {},
            models: provider?.models && typeof provider.models === "object" && !Array.isArray(provider.models)
                ? Object.entries(provider.models).map(([modelId, model]) => ({
                    id: model?.id ?? modelId,
                    name: model?.name ?? modelId,
                    group: model?.group ?? null,
                    enabled: model?.enabled ?? true,
                    contextWindowTokens: model?.contextWindowTokens ?? null,
                }))
                : [],
        }))
        : Array.isArray(parsed.models?.providers) ? parsed.models.providers : [];

    return {
        auth: parsed.auth,
        models: {
            default: parsed.models?.default ?? null,
            providers,
        },
        agent: parsed.agent,
        ui: parsed.ui,
        editor: parsed.editor,
    };
}

/** 生成部署 override，避免把本地私有部署文件写进仓库根配置。 */
function renderGeneratedCompose(config) {
    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return "";
    }

    if (config.deployMode === "ghcr") {
        return `services:
    app:
        image: ${config.image}
        build: null
        volumes:
            - ./workspace:/app/workspace
            - ./${CONFIG_FILENAME}:/app/config.yaml
`;
    }

    return `services:
    app:
        image: neuro-book-source-runtime:latest
        build:
            context: .
            dockerfile: Dockerfile.source-runtime
        working_dir: /app
        command: ["sh", "./scripts/docker-entrypoint.sh"]
        volumes:
            - ./:/app
            - ./workspace:/app/workspace
`;
}

/** 解析当前脚本生成的 .env 文本，用于宿主机 source build。 */
function parseEnv(text) {
    const result = {};
    for (const line of text.split(/\r?\n/)) {
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

/** 返回部署私有文件目录。 */
function deployStateDir(config) {
    return resolve(config.deployDir, DEPLOY_DIRNAME);
}

/** 返回相对部署根目录的可读路径。 */
function displayPath(config, path) {
    return relative(config.deployDir, path).replaceAll("\\", "/");
}

/** 生成管理员创建命令提示。 */
function adminCommand(config) {
    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return nativeStartHelp("bun run auth:create-admin");
    }

    const files = ["-f", "docker-compose.yml", "-f", `${DEPLOY_DIRNAME}/docker-compose.generated.yml`];

    return `docker compose --env-file ${ENV_FILENAME} ${files.join(" ")} exec app bun run auth:create-admin`;
}

/** 生成容器启动命令提示。 */
function upCommand(config) {
    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return nativeStartHelp("node .output/server/index.mjs");
    }

    const files = ["-f", "docker-compose.yml", "-f", `${DEPLOY_DIRNAME}/docker-compose.generated.yml`];

    const upArgs = config.deployMode === "source" ? "up -d --build" : "up -d";
    return `docker compose --env-file ${ENV_FILENAME} ${files.join(" ")} ${upArgs}`;
}

/** 生成源码模式更新命令提示。 */
function sourceUpdateCommands(config) {
    return [
        "git pull --ff-only",
        "bun install --frozen-lockfile",
        "set -a",
        ". ./.env",
        "set +a",
        "bun run nuxt:prepare",
        "bun run generate",
        "bun run nuxt:build",
        upCommand(config),
    ];
}

/** 生成 local-git 模式更新命令提示。 */
function nativeUpdateCommands() {
    return [
        "git pull --ff-only",
        "bun install --frozen-lockfile",
        "set -a",
        ". ./.env",
        "set +a",
        "bun run nuxt:prepare",
        "bun run generate",
        "bun run nuxt:build",
        "bun run migrate:deploy",
        "node .output/server/index.mjs",
    ];
}

/** 生成镜像模式更新命令提示。 */
function ghcrUpdateCommands(config) {
    return [
        `docker compose --env-file ${ENV_FILENAME} -f docker-compose.yml -f ${DEPLOY_DIRNAME}/docker-compose.generated.yml pull app`,
        upCommand(config),
    ];
}

/** 生成模式说明。 */
function deployNotes(config) {
    const databaseNote = "数据库：SQLite-only。App SQLite 默认为 workspace/.nbook/neuro-book.sqlite；每个 Project Workspace 的结构化数据位于 workspace/<project>/.nbook/project.sqlite。";

    if (config.deployMode === "source") {
        return `${databaseNote}

source 模式使用宿主机源码挂载到容器 /app。宿主机需要安装 Bun，并在启动前完成：
${sourceUpdateCommands(config).map((line) => `- ${line}`).join("\n")}`;
    }

    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return `${databaseNote}

local-git 模式不使用 Docker，也不生成 systemd/pm2 服务。宿主机需要安装 Node.js、npm、Git、Bun、ripgrep，并在启动前完成：
${nativeUpdateCommands().map((line) => `- ${line}`).join("\n")}

Windows PowerShell 启动前请按 .env 内容设置当前进程环境变量，然后运行：
- node .output/server/index.mjs`;
    }

    return `${databaseNote}

ghcr 模式使用预构建镜像 ${config.image}，容器内包含完整项目源码。更新镜像后运行：
${ghcrUpdateCommands(config).map((line) => `- ${line}`).join("\n")}`;
}

/** 生成部署私有说明文件。 */
function renderDeployReadme(config) {
    const composeLine = config.deployMode === LOCAL_GIT_DEPLOY_MODE
        ? "- Compose override: not used in local-git mode"
        : `- Compose override: ${DEPLOY_DIRNAME}/docker-compose.generated.yml`;
    const commandLanguage = config.deployMode === LOCAL_GIT_DEPLOY_MODE && process.platform === "win32" ? "powershell" : "bash";
    const nativeScriptLine = config.deployMode === LOCAL_GIT_DEPLOY_MODE
        ? `- Local Git start script: ${DEPLOY_DIRNAME}/${nativeStartScriptName()}`
        : "";

    return `# neuro-book deployment

This directory is generated by neuro-book-deploy and should stay local.

- Deploy mode: ${config.deployMode}
- Database mode: ${config.databaseMode}
- App URL: http://localhost:${config.port}
- Env file: ${ENV_FILENAME}
- Boot config: ${CONFIG_FILENAME}
- Global config: ${GLOBAL_CONFIG_FILENAME}
${composeLine}
${nativeScriptLine}

Start or update:

\`\`\`${commandLanguage}
${upCommand(config)}
\`\`\`

Create or reset admin:

\`\`\`${commandLanguage}
${adminCommand(config)}
\`\`\`

Do not pass admin passwords as command arguments. Use the interactive prompt, or set AUTH_ADMIN_PASSWORD only in a short-lived shell/secret environment.
Provider API keys are not requested during deployment. Configure them later in the frontend settings page or ${GLOBAL_CONFIG_FILENAME}.

${deployNotes(config)}
`;
}

/** 兼容旧部署模式命名，并拒绝已停用的 build 模式。 */
function normalizeDeployMode(value) {
    if (!value) {
        return value;
    }

    const mode = String(value).toLowerCase();
    if (mode === "native") {
        return LOCAL_GIT_DEPLOY_MODE;
    }

    if (mode === "image") {
        return "ghcr";
    }

    if (mode === "build") {
        throw new Error("--deploy-mode build 已停用。请使用默认 local-git，或使用 --deploy-mode ghcr / source。");
    }

    return mode;
}

function normalizeDatabaseMode(value) {
    if (!value || value === "sqlite") {
        return "sqlite";
    }
    throw new Error(`数据库模式只支持 sqlite；PostgreSQL 部署入口已移除：${value}`);
}

/** 生成旧根目录部署文件清理提示。 */
async function warnLegacyDeployFiles(config) {
    const legacyFiles = [
        resolve(deployStateDir(config), ".env.docker"),
        resolve(deployStateDir(config), "config.yaml"),
        resolve(config.deployDir, ".env.docker"),
        resolve(config.deployDir, "docker-compose.image.yml"),
    ];
    const existing = legacyFiles.filter((path) => existsSync(path));
    if (existing.length === 0) {
        return;
    }

    p.log.warn(`检测到旧部署文件：${existing.map((path) => displayPath(config, path)).join(", ")}。当前部署使用根目录 .env / config.yaml、${GLOBAL_CONFIG_FILENAME} 和 .deploy/docker-compose.generated.yml，可确认后手动删除旧文件。`);
}

/** 以仅当前用户可读写的权限写入敏感部署文件。 */
async function writePrivateFile(path, text) {
    await writeFile(path, text, {encoding: "utf-8", mode: 0o600});
    try {
        await chmod(path, 0o600);
    } catch {
        // Windows 文件系统不总是支持 POSIX mode；写入成功即可。
    }
}

/** 迁移旧 .deploy 私有配置到新位置；不覆盖已有文件。 */
async function migrateLegacyPrivateFile({from, to, label}) {
    if (existsSync(to) || !existsSync(from)) {
        return;
    }

    await rename(from, to);
    try {
        await chmod(to, 0o600);
    } catch {
        // Windows 文件系统不总是支持 POSIX mode；迁移成功即可。
    }
    p.log.info(`Migrated ${label} to ${to}`);
}

/** 拉取或更新应用仓库。 */
async function ensureRepository(config) {
    if (config.dryRun) {
        if (!existsSync(resolve(config.deployDir, ".git"))) {
            dryRunCommand("git", ["clone", config.repo, config.deployDir]);
        } else {
            dryRunCommand("git", ["-C", config.deployDir, "ls-files", "--", ...REGENERATED_SYSTEM_ARTIFACTS]);
            dryRunCommand("git", ["-C", config.deployDir, "restore", "--", "<tracked generated artifacts>"]);
            dryRunCommand("git", ["-C", config.deployDir, "pull", "--ff-only"]);
        }
        return;
    }

    await mkdir(dirname(config.deployDir), {recursive: true});
    if (!existsSync(resolve(config.deployDir, ".git"))) {
        const current = await tryStat(config.deployDir);
        if (current && !current.isDirectory()) {
            throw new Error(`部署路径已存在但不是目录：${config.deployDir}`);
        }

        if (current && (await readdir(config.deployDir)).length > 0) {
            throw new Error(`部署目录非空且不是 Git checkout：${config.deployDir}`);
        }

        await run("git", ["clone", config.repo, config.deployDir]);
        return;
    }

    await restoreRegeneratedSystemArtifacts(config.deployDir);
    await run("git", ["-C", config.deployDir, "pull", "--ff-only"]);
}

const REGENERATED_SYSTEM_ARTIFACTS = [
    "assets/workspace/.nbook/agent/profiles/.compiled/manifest.json",
    "assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json",
    "assets/workspace/.nbook/agent/variables/.compiled/manifest.json",
    "server/agent/variables/generated-profile-variable-types.d.ts",
];

/** 恢复 build/dev 会重写的 tracked 系统产物，避免部署 checkout 因 generated diff 阻塞 git pull。 */
async function restoreRegeneratedSystemArtifacts(deployDir) {
    const tracked = await gitTrackedGeneratedArtifacts(deployDir);
    if (tracked.length === 0) {
        return;
    }
    await run("git", ["-C", deployDir, "restore", "--", ...tracked]);
}

/** 返回当前 checkout 已跟踪的可再生成系统产物；旧版本部署目录可能还没有全部路径。 */
async function gitTrackedGeneratedArtifacts(deployDir) {
    const stdout = await runCapture("git", ["-C", deployDir, "ls-files", "--", ...REGENERATED_SYSTEM_ARTIFACTS]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** 根据数据库模式启动 Docker Compose。 */
async function runCompose(config) {
    if (!DOCKER_DEPLOY_MODES.includes(config.deployMode)) {
        return;
    }

    const composeFiles = ["-f", "docker-compose.yml", "-f", `${DEPLOY_DIRNAME}/docker-compose.generated.yml`];

    const args = ["compose", ...composeFiles, "--env-file", ENV_FILENAME, "up", "-d"];
    if (config.deployMode === "source") {
        args.push("--build");
    }

    if (config.dryRun) {
        dryRunCommand("docker", args, {cwd: config.deployDir});
        return;
    }

    await run("docker", args, {cwd: config.deployDir});
}

/** 写入部署文件；redeploy 时保留已有敏感配置。 */
async function writeDeployFiles(config) {
    const envPath = resolve(config.deployDir, ENV_FILENAME);
    const configPath = resolve(config.deployDir, CONFIG_FILENAME);
    const globalConfigPath = resolve(config.deployDir, GLOBAL_CONFIG_FILENAME);
    const legacyEnvPath = resolve(deployStateDir(config), ".env.docker");
    const legacyConfigPath = resolve(deployStateDir(config), "config.yaml");
    const generatedComposePath = resolve(deployStateDir(config), "docker-compose.generated.yml");
    const readmePath = resolve(deployStateDir(config), "README.md");
    const nativeStartScriptPath = resolve(deployStateDir(config), nativeStartScriptName());
    const nativeAdminScriptPath = resolve(deployStateDir(config), nativeAdminScriptName());
    const staleNativeScriptPaths = [
        resolve(deployStateDir(config), "start-native.sh"),
        resolve(deployStateDir(config), "start-native.ps1"),
        resolve(deployStateDir(config), "create-admin-native.sh"),
        resolve(deployStateDir(config), "create-admin-native.ps1"),
    ];
    const localGitScriptPaths = [
        resolve(deployStateDir(config), "start-local-git.sh"),
        resolve(deployStateDir(config), "start-local-git.ps1"),
        resolve(deployStateDir(config), "create-admin-local-git.sh"),
        resolve(deployStateDir(config), "create-admin-local-git.ps1"),
    ];

    if (config.dryRun) {
        const envText = existsSync(envPath)
            ? await readFile(envPath, "utf-8")
            : renderEnv(config, "<generated-session-password>");
        const legacyConfigText = existsSync(legacyConfigPath) ? await readFile(legacyConfigPath, "utf-8") : null;
        p.log.info(`Dry run file: ${envPath}`);
        p.log.info(`Dry run file: ${configPath}`);
        p.log.info(`Dry run file: ${globalConfigPath}`);
        if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
            if (existsSync(generatedComposePath)) {
                p.log.info(`Dry run cleanup: remove stale ${generatedComposePath}`);
            }
            p.log.info(`Dry run file: ${nativeStartScriptPath}`);
            p.log.info(`Dry run file: ${nativeAdminScriptPath}`);
            for (const scriptPath of staleNativeScriptPaths) {
                if (existsSync(scriptPath)) {
                    p.log.info(`Dry run cleanup: remove stale ${scriptPath}`);
                }
            }
        } else {
            p.log.info(`Dry run file: ${generatedComposePath}`);
            for (const scriptPath of [...localGitScriptPaths, ...staleNativeScriptPaths]) {
                if (existsSync(scriptPath)) {
                    p.log.info(`Dry run cleanup: remove stale ${scriptPath}`);
                }
            }
        }
        p.log.info(`Dry run file: ${readmePath}`);
        if (legacyConfigText) {
            p.log.info(`Dry run migration source: ${legacyConfigPath}`);
        }
        return parseEnv(envText);
    }

    await migrateLegacyPrivateFile({from: legacyEnvPath, to: envPath, label: ENV_FILENAME});

    let envText = "";
    if (existsSync(envPath)) {
        envText = await readFile(envPath, "utf-8");
        p.log.info(`Preserved ${envPath}`);
    } else {
        envText = renderEnv(config, randomSecret());
        await writePrivateFile(envPath, envText);
        p.log.success(`Wrote ${envPath}`);
    }

    if (existsSync(configPath)) {
        p.log.info(`Preserved ${configPath}`);
    } else {
        await writePrivateFile(configPath, renderBootConfig(config, parseEnv(envText)));
        p.log.success(`Wrote ${configPath}`);
    }

    const legacyConfigText = existsSync(legacyConfigPath) ? await readFile(legacyConfigPath, "utf-8") : null;
    if (existsSync(globalConfigPath)) {
        p.log.info(`Preserved ${globalConfigPath}`);
    } else {
        await mkdir(dirname(globalConfigPath), {recursive: true});
        await writePrivateFile(globalConfigPath, renderGlobalConfig(config, legacyConfigText));
        p.log.success(`Wrote ${globalConfigPath}`);
    }

    if (legacyConfigText) {
        p.log.warn(`检测到旧 Provider 配置 ${legacyConfigPath}，已用于初始化 ${GLOBAL_CONFIG_FILENAME}。确认无误后可手动删除旧文件。`);
    }

    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        if (existsSync(generatedComposePath)) {
            await rm(generatedComposePath, {force: true});
            p.log.info(`Removed stale ${generatedComposePath}; local-git mode does not use Docker Compose.`);
        }
        for (const scriptPath of staleNativeScriptPaths) {
            await rm(scriptPath, {force: true});
        }
        await writeFile(nativeStartScriptPath, renderNativeScript("node .output/server/index.mjs"), "utf-8");
        await writeFile(nativeAdminScriptPath, renderNativeScript("bun run auth:create-admin"), "utf-8");
        if (process.platform !== "win32") {
            await chmod(nativeStartScriptPath, 0o700);
            await chmod(nativeAdminScriptPath, 0o700);
        }
        p.log.success(`Wrote ${nativeStartScriptPath}`);
        p.log.success(`Wrote ${nativeAdminScriptPath}`);
    } else {
        await writeFile(generatedComposePath, renderGeneratedCompose(config), "utf-8");
        p.log.success(`Wrote ${generatedComposePath}`);
        for (const scriptPath of [...localGitScriptPaths, ...staleNativeScriptPaths]) {
            await rm(scriptPath, {force: true});
        }
    }
    await writeFile(readmePath, renderDeployReadme(config), "utf-8");

    return parseEnv(envText);
}

/** source 模式在宿主机完成依赖安装、Prisma generate 和 Nuxt build。 */
async function buildSource(config, env) {
    if (config.deployMode !== "source") {
        return;
    }

    if (config.dryRun) {
        for (const command of sourceBuildCommands()) {
            dryRunCommand(command.command, command.args, {cwd: config.deployDir});
        }
        return;
    }

    p.log.info("Preparing source deployment on host.");
    for (const command of sourceBuildCommands()) {
        await run(command.command, command.args, {cwd: config.deployDir, env});
    }
}

/** local-git 模式在宿主机完成依赖安装、构建和部署迁移。 */
async function buildNative(config, env) {
    if (config.deployMode !== LOCAL_GIT_DEPLOY_MODE) {
        return;
    }

    if (config.dryRun) {
        for (const command of nativeBuildCommands()) {
            dryRunCommand(command.command, command.args, {cwd: config.deployDir});
        }
        return;
    }

    p.log.info("Preparing local-git deployment on host.");
    for (const command of nativeBuildCommands()) {
        await run(command.command, command.args, {cwd: config.deployDir, env});
    }
}

/** source 模式需要在宿主机执行的 build 命令。 */
function sourceBuildCommands() {
    return [
        {command: "bun", args: ["install", "--frozen-lockfile"]},
        {command: "bun", args: ["run", "nuxt:prepare"]},
        {command: "bun", args: ["run", "generate"]},
        {command: "bun", args: ["run", "nuxt:build"]},
    ];
}

/** local-git 模式需要在宿主机执行的 build / migrate 命令。 */
function nativeBuildCommands() {
    return [
        ...sourceBuildCommands(),
        {command: "bun", args: ["run", "migrate:deploy"]},
    ];
}

/** local-git 模式不接管进程管理，只输出下一步启动命令。 */
function printNativeNextSteps(config) {
    if (config.deployMode !== LOCAL_GIT_DEPLOY_MODE) {
        return;
    }

    p.note(`启动服务：
${DEPLOY_DIRNAME}/${nativeStartScriptName()}

创建或重置管理员：
${DEPLOY_DIRNAME}/${nativeAdminScriptName()}

手动启动命令：
${nativeStartHelp("node .output/server/index.mjs")}`, "local-git 启动命令");
}

/** CLI 主流程。 */
async function main() {
    const options = program.opts();
    if (options.internalPrintInstallPlans) {
        printInternalInstallPlans();
        return;
    }

    p.intro("neuro-book deployment");
    const config = await readConfig(options);

    if (!config.dryRun) {
        if (DOCKER_DEPLOY_MODES.includes(config.deployMode)) {
            await needCommand("git");
            await needCommand("docker");
            await needCommand("docker", ["compose", "version"]);
            if (config.deployMode === "source") {
                await needCommand("bun");
            }
        }
    }
    await ensureNativeCommands(config);

    await ensureRepository(config);
    if (!config.dryRun) {
        await mkdir(resolve(config.deployDir, "workspace"), {recursive: true});
        await mkdir(deployStateDir(config), {recursive: true});
    }

    const hostBuildEnv = await writeDeployFiles(config);
    await warnLegacyDeployFiles(config);

    await buildSource(config, hostBuildEnv);
    await buildNative(config, hostBuildEnv);
    await runCompose(config);
    printNativeNextSteps(config);
    p.outro(`Done. Open http://localhost:${config.port}`);
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
