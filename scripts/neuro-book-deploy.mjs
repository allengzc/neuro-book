#!/usr/bin/env node
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {chmod, mkdir, readFile, readdir, rename, stat, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, relative, resolve} from "node:path";
import {Command} from "commander";
import * as p from "@clack/prompts";

const REPO_URL = "https://github.com/notnotype/neuro-book.git";
const DEFAULT_IMAGE = "ghcr.io/notnotype/neuro-book:latest";
const DEPLOY_DIRNAME = ".deploy";
const ENV_FILENAME = ".env";
const CONFIG_FILENAME = "config.yaml";
const PROVIDERS = {
    deepseek: {
        name: "DeepSeek",
        adapter: "deepseek-official",
        baseURL: "https://api.deepseek.com/v1",
        modelId: "deepseek-v4-flash",
        modelName: "DeepSeek-V4-Flash",
        modelGroup: "deepseek",
        contextWindowTokens: 262144,
    },
    doubao: {
        name: "Doubao",
        adapter: "openai-compatible",
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        modelId: "doubao-seed-2-0-pro",
        modelName: "Doubao Seed 2.0 Pro",
        modelGroup: "doubao",
        contextWindowTokens: 262144,
    },
    qwen: {
        name: "Qwen",
        adapter: "openai-compatible",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelId: "qwen3.6-plus",
        modelName: "Qwen 3.6 Plus",
        modelGroup: "qwen",
        contextWindowTokens: 262144,
    },
    siliconflow: {
        name: "SiliconFlow",
        adapter: "openai-compatible",
        baseURL: "https://api.siliconflow.cn/v1",
        modelId: "deepseek-ai/DeepSeek-V4-Flash",
        modelName: "DeepSeek-V4-Flash",
        modelGroup: "deepseek",
        contextWindowTokens: 262144,
    },
    gemini: {
        name: "Gemini",
        adapter: "gemini-compatible",
        baseURL: "",
        modelId: "gemini-3-pro-preview-maxthinking",
        modelName: "Gemini 3 Pro Preview MaxThinking",
        modelGroup: "gemini",
        contextWindowTokens: null,
    },
};

const program = new Command()
    .name("neuro-book-deploy")
    .description("Interactive Docker Compose deployment for neuro-book.")
    .option("--repo <url>", "Git repository URL.", process.env.NEURO_BOOK_REPO_URL ?? REPO_URL)
    .option("--dir <path>", "Deployment directory.", process.env.NEURO_BOOK_DEPLOY_DIR ?? resolve(homedir(), "neuro-book"))
    .option("--port <port>", "HTTP port.", process.env.NEURO_BOOK_PORT ?? "3000")
    .option("--provider <provider>", "Model provider: deepseek, doubao, qwen, siliconflow, gemini.")
    .option("--api-key <key>", "Provider API key.")
    .option("--database <mode>", "Database mode: local or external.")
    .option("--database-url <url>", "External PostgreSQL DATABASE_URL.")
    .option("--deploy-mode <mode>", "Deploy mode: ghcr or source.", process.env.NEURO_BOOK_DEPLOY_MODE)
    .option("--image <image>", "GHCR app image.", process.env.NEURO_BOOK_IMAGE ?? DEFAULT_IMAGE)
    .option("--redeploy", "Regenerate .deploy compose files while preserving existing .env and config.yaml.", false)
    .option("--yes", "Use defaults and skip interactive prompts.", false)
    .option("--dry-run", "Generate files but skip git and docker commands.", process.env.NEURO_BOOK_DEPLOY_DRY_RUN === "1");

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

/** 返回适合直接写入单引号 YAML 字符串的文本。 */
function yamlQuote(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
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

/** 检查命令是否可用。 */
async function needCommand(command, args = ["--version"]) {
    await run(command, args, {stdio: "ignore"});
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

/** 在交互模式下询问密钥；非交互模式允许留空后续配置。 */
async function askPassword({interactive, value, message}) {
    if (value !== undefined && value !== null) {
        return String(value);
    }

    if (!interactive) {
        return "";
    }

    return String(unwrapPrompt(await p.password({
        message,
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
    const provider = await askSelect({
        interactive,
        value: options.provider,
        message: "模型 Provider",
        initialValue: "deepseek",
        options: [
            {value: "deepseek", label: "DeepSeek"},
            {value: "doubao", label: "Doubao"},
            {value: "qwen", label: "Qwen"},
            {value: "siliconflow", label: "SiliconFlow"},
            {value: "gemini", label: "Gemini"},
        ],
    });

    if (!PROVIDERS[provider]) {
        throw new Error(`不支持的 Provider：${provider}`);
    }

    const apiKey = await askPassword({
        interactive,
        value: options.apiKey,
        message: "Provider API Key（可留空，稍后在 config.yaml 配置）",
    });
    const databaseMode = await askSelect({
        interactive,
        value: options.database,
        message: "数据库模式",
        initialValue: "local",
        options: [
            {value: "local", label: "内置 Postgres"},
            {value: "external", label: "外部 Postgres"},
        ],
    });

    if (databaseMode !== "local" && databaseMode !== "external") {
        throw new Error(`数据库模式必须是 local 或 external：${databaseMode}`);
    }

    const databaseUrl = databaseMode === "external"
        ? await askText({
            interactive,
            value: options.databaseUrl,
            message: "外部 DATABASE_URL",
            initialValue: "postgresql://user:password@host:5432/neuro_book",
        })
        : "";
    const inferredDeployMode = options.redeploy && !options.deployMode
        ? await inferDeployMode(deployDir)
        : null;
    const deployMode = normalizeDeployMode(await askSelect({
        interactive,
        value: options.deployMode ?? inferredDeployMode,
        message: "部署模式",
        initialValue: "ghcr",
        options: [
            {value: "ghcr", label: "使用 GHCR 预构建镜像", hint: "默认推荐"},
            {value: "source", label: "挂载宿主机源码", hint: "宿主机自行 install/build"},
        ],
    }));

    if (deployMode !== "ghcr" && deployMode !== "source") {
        throw new Error(`部署模式必须是 ghcr 或 source：${deployMode}`);
    }

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
        databaseUrl,
        deployDir,
        deployMode,
        dryRun: Boolean(options.dryRun),
        image,
        port,
        provider,
        redeploy: Boolean(options.redeploy),
        repo: options.repo,
    };
}

/** 生成 Docker Compose 使用的环境变量文件。 */
function renderEnv(config, postgresPassword, sessionPassword) {
    const databaseUrl = config.databaseMode === "local"
        ? `postgresql://neuro_book:${postgresPassword}@postgres:5432/neuro_book`
        : config.databaseUrl;

    return [
        `NUXT_PORT=${config.port}`,
        `NUXT_SESSION_PASSWORD=${sessionPassword}`,
        "",
        "POSTGRES_USER=neuro_book",
        `POSTGRES_PASSWORD=${postgresPassword}`,
        "POSTGRES_DB=neuro_book",
        `DATABASE_URL=${databaseUrl}`,
        "",
    ].join("\n");
}

/** 生成应用运行时配置文件。 */
function renderConfig(config) {
    const provider = PROVIDERS[config.provider];
    const modelKey = `${config.provider}/${provider.modelId}`;
    const context = provider.contextWindowTokens === null ? "null" : String(provider.contextWindowTokens);

    return `# neuro-book runtime config.
# This file is used as the runtime config and can be updated by the settings UI.
# Put real model provider keys here in deployment; do not commit the generated config.yaml back to Git.
agent:
  tools:
    # Tool names allowed or denied for agent runs. Empty arrays mean no extra allow/deny override.
    allow: []
    deny: []
  profiles:
    # null means the profile uses models.default. Set modelKey to "provider/model" to override one profile.
    leader.default:
      model:
        modelKey: null
        temperature: null
        topK: null
        stream: true
    subagent.writer:
      model:
        modelKey: null
        temperature: null
        topK: null
        stream: true
    subagent.loreRetriever:
      model:
        modelKey: null
        temperature: null
        topK: null
        stream: true
    subagent.retrieval:
      model:
        modelKey: ${yamlQuote(modelKey)}
        temperature: null
        topK: null
        stream: true
models:
  # Default chat model, formatted as "provider/model".
  default: ${yamlQuote(modelKey)}
  providers:
    ${config.provider}:
      name: ${yamlQuote(provider.name)}
      # adapter selects the runtime protocol: openai-official, openai-compatible, deepseek-official, or gemini-compatible.
      adapter: ${yamlQuote(provider.adapter)}
      options:
        apiKey: ${yamlQuote(config.apiKey)}
        baseURL: ${yamlQuote(provider.baseURL)}
        proxy: ''
      models:
        ${yamlQuote(provider.modelId)}:
          name: ${yamlQuote(provider.modelName)}
          id: ${yamlQuote(provider.modelId)}
          group: ${yamlQuote(provider.modelGroup)}
          enabled: true
          # Use null when the provider does not publish a stable context window.
          contextWindowTokens: ${context}
`;
}

/** 生成部署 override，避免把本地私有部署文件写进仓库根配置。 */
function renderGeneratedCompose(config) {
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
    const files = ["-f", "docker-compose.yml"];
    if (config.databaseMode === "external") {
        files.push("-f", "docker-compose.external-db.yml");
    }
    files.push("-f", `${DEPLOY_DIRNAME}/docker-compose.generated.yml`);

    return `docker compose --env-file ${ENV_FILENAME} ${files.join(" ")} exec app bun run auth:create-admin`;
}

/** 生成容器启动命令提示。 */
function upCommand(config) {
    const files = ["-f", "docker-compose.yml"];
    if (config.databaseMode === "external") {
        files.push("-f", "docker-compose.external-db.yml");
    }
    files.push("-f", `${DEPLOY_DIRNAME}/docker-compose.generated.yml`);

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

/** 生成镜像模式更新命令提示。 */
function ghcrUpdateCommands(config) {
    return [
        `docker compose --env-file ${ENV_FILENAME} -f docker-compose.yml -f ${DEPLOY_DIRNAME}/docker-compose.generated.yml pull app`,
        upCommand(config),
    ];
}

/** 生成模式说明。 */
function deployNotes(config) {
    if (config.deployMode === "source") {
        return `source 模式使用宿主机源码挂载到容器 /app。宿主机需要安装 Bun，并在启动前完成：
${sourceUpdateCommands(config).map((line) => `- ${line}`).join("\n")}`;
    }

    return `ghcr 模式使用预构建镜像 ${config.image}，容器内包含完整项目源码。更新镜像后运行：
${ghcrUpdateCommands(config).map((line) => `- ${line}`).join("\n")}`;
}

/** 生成部署私有说明文件。 */
function renderDeployReadme(config) {
    return `# neuro-book deployment

This directory is generated by neuro-book-deploy and should stay local.

- Deploy mode: ${config.deployMode}
- App URL: http://localhost:${config.port}
- Env file: ${ENV_FILENAME}
- Runtime config: ${CONFIG_FILENAME}
- Compose override: ${DEPLOY_DIRNAME}/docker-compose.generated.yml

Start or update:

\`\`\`bash
${upCommand(config)}
\`\`\`

Create or reset admin:

\`\`\`bash
${adminCommand(config)}
\`\`\`

Do not pass admin passwords as command arguments. Use the interactive prompt, or set AUTH_ADMIN_PASSWORD only in a short-lived shell/secret environment.

${deployNotes(config)}
`;
}

/** 兼容旧部署模式命名，并拒绝已停用的 build 模式。 */
function normalizeDeployMode(value) {
    if (!value) {
        return value;
    }

    if (value === "image") {
        return "ghcr";
    }

    if (value === "build") {
        throw new Error("--deploy-mode build 已停用。请使用默认 ghcr，或使用 --deploy-mode source 挂载宿主机源码。");
    }

    return value;
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

    p.log.warn(`检测到旧部署文件：${existing.map((path) => displayPath(config, path)).join(", ")}。当前部署只使用根目录 .env / config.yaml 和 .deploy/docker-compose.generated.yml，可确认后手动删除旧文件。`);
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

/** 迁移旧 .deploy 私有配置到根目录 .env / config.yaml；不覆盖已有文件。 */
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
        await mkdir(config.deployDir, {recursive: true});
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

    await run("git", ["-C", config.deployDir, "pull", "--ff-only"]);
}

/** 根据数据库模式启动 Docker Compose。 */
async function runCompose(config) {
    if (config.dryRun) {
        p.log.info("Dry run enabled; skipped docker compose.");
        return;
    }

    const composeFiles = ["-f", "docker-compose.yml"];
    if (config.databaseMode === "external") {
        composeFiles.push("-f", "docker-compose.external-db.yml");
    }
    composeFiles.push("-f", `${DEPLOY_DIRNAME}/docker-compose.generated.yml`);

    const args = ["compose", ...composeFiles, "--env-file", ENV_FILENAME, "up", "-d"];
    if (config.deployMode === "source") {
        args.push("--build");
    }

    await run("docker", args, {cwd: config.deployDir});
}

/** 写入部署文件；redeploy 时保留已有敏感配置。 */
async function writeDeployFiles(config) {
    const envPath = resolve(config.deployDir, ENV_FILENAME);
    const configPath = resolve(config.deployDir, CONFIG_FILENAME);
    const legacyEnvPath = resolve(deployStateDir(config), ".env.docker");
    const legacyConfigPath = resolve(deployStateDir(config), "config.yaml");
    const generatedComposePath = resolve(deployStateDir(config), "docker-compose.generated.yml");
    const readmePath = resolve(deployStateDir(config), "README.md");

    await migrateLegacyPrivateFile({from: legacyEnvPath, to: envPath, label: ENV_FILENAME});
    await migrateLegacyPrivateFile({from: legacyConfigPath, to: configPath, label: CONFIG_FILENAME});

    let envText = "";
    if (existsSync(envPath)) {
        envText = await readFile(envPath, "utf-8");
        p.log.info(`Preserved ${envPath}`);
    } else {
        envText = renderEnv(config, randomSecret(), randomSecret());
        await writePrivateFile(envPath, envText);
        p.log.success(`Wrote ${envPath}`);
    }

    if (existsSync(configPath)) {
        p.log.info(`Preserved ${configPath}`);
    } else {
        await writePrivateFile(configPath, renderConfig(config));
        p.log.success(`Wrote ${configPath}`);
    }

    await writeFile(generatedComposePath, renderGeneratedCompose(config), "utf-8");
    await writeFile(readmePath, renderDeployReadme(config), "utf-8");
    p.log.success(`Wrote ${generatedComposePath}`);

    return parseEnv(envText);
}

/** source 模式在宿主机完成依赖安装、Prisma generate 和 Nuxt build。 */
async function buildSource(config, env) {
    if (config.deployMode !== "source") {
        return;
    }

    if (config.dryRun) {
        p.log.info("Dry run enabled; skipped source build steps.");
        return;
    }

    p.log.info("Preparing source deployment on host.");
    await run("bun", ["install", "--frozen-lockfile"], {cwd: config.deployDir, env});
    await run("bun", ["run", "nuxt:prepare"], {cwd: config.deployDir, env});
    await run("bun", ["run", "generate"], {cwd: config.deployDir, env});
    await run("bun", ["run", "nuxt:build"], {cwd: config.deployDir, env});
}

/** CLI 主流程。 */
async function main() {
    const options = program.opts();
    p.intro("neuro-book Docker Compose deployment");
    const config = await readConfig(options);

    if (!config.dryRun) {
        await needCommand("git");
        await needCommand("docker");
        await needCommand("docker", ["compose", "version"]);
        if (config.deployMode === "source") {
            await needCommand("bun");
        }
    }

    await ensureRepository(config);
    await mkdir(resolve(config.deployDir, "workspace"), {recursive: true});
    await mkdir(deployStateDir(config), {recursive: true});

    const hostBuildEnv = await writeDeployFiles(config);
    await warnLegacyDeployFiles(config);

    await buildSource(config, hostBuildEnv);
    await runCompose(config);
    p.outro(`Done. Open http://localhost:${config.port}`);
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
