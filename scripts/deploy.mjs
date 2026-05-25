#!/usr/bin/env bun
/**
 * 开发服务器 source 模式快速同步脚本。
 *
 * 使用：
 *   bun scripts/deploy.mjs
 *   bun scripts/deploy.mjs --host arch --dir /home/notnotype/composes/neuro-book
 *   bun scripts/deploy.mjs --dry-run
 */

import {spawn} from "node:child_process";
import {Command} from "commander";
import * as p from "@clack/prompts";

const DEFAULT_HOST = "arch";
const DEFAULT_REMOTE_DIR = "/home/notnotype/composes/neuro-book";
const ENV_FILE = ".env";

const program = new Command()
    .name("neuro-book-dev-deploy")
    .description("Sync the arch source-mode deployment and restart the app container.")
    .option("--host <host>", "SSH host.", process.env.NEURO_BOOK_DEPLOY_HOST ?? DEFAULT_HOST)
    .option("--dir <path>", "Remote source deployment directory.", process.env.NEURO_BOOK_DEPLOY_DIR ?? DEFAULT_REMOTE_DIR)
    .option("--dry-run", "Print the remote script without connecting to the server.", false);

program.parse();

/** 把用户取消交互转成干净退出。 */
function unwrapPrompt(value) {
    if (p.isCancel(value)) {
        p.cancel("部署已取消。");
        process.exit(0);
    }

    return value;
}

/** 返回安全的 shell 单引号字符串。 */
function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** 生成远端 source 模式同步脚本。 */
function remoteScript(remoteDir) {
    return `#!/bin/sh
set -eu

read -r SUDO_PASSWORD

step() {
    printf '\\n==> %s\\n' "$1"
}

run_sudo() {
    sudo -n "$@"
}

cleanup() {
    if [ -n "\${SUDO_KEEPALIVE_PID:-}" ]; then
        kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

printf '%s\\n' "$SUDO_PASSWORD" | sudo -S -p '' -v
unset SUDO_PASSWORD
exec </dev/null

while true; do
    sudo -n -v
    sleep 60
done &
SUDO_KEEPALIVE_PID=$!

cd ${shellQuote(remoteDir)}

step "检查远端工作区"
if [ ! -d .git ]; then
    echo "远端目录不是 Git checkout：$(pwd)" >&2
    exit 1
fi

if [ ! -f .env ] && [ -f .deploy/.env.docker ]; then
    mv .deploy/.env.docker .env
    chmod 600 .env 2>/dev/null || true
fi

if [ ! -f .env ] || [ ! -f config.yaml ] || [ ! -f .deploy/docker-compose.generated.yml ]; then
    echo "缺少部署文件。请先运行 neuro-book-deploy --deploy-mode source 初始化部署。" >&2
    exit 1
fi

if [ -f .deploy/config.yaml ]; then
    echo "检测到旧 .deploy/config.yaml。请先在远端运行 bun run config:migrate 或 neuro-book-deploy --redeploy，让旧 Provider 配置进入 workspace/.nbook/config.json。" >&2
    exit 1
fi

step "刷新 source compose override"
cat > .deploy/docker-compose.generated.yml <<'YAML'
services:
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
YAML

step "恢复可再生成的 profile metadata"
git restore -- \
    assets/workspace/.nbook/agent/profiles/.compiled/manifest.json \
    assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json

dirty="$(git status --porcelain --untracked-files=no)"
if [ -n "$dirty" ]; then
    echo "远端 tracked worktree 不干净，已停止部署：" >&2
    echo "$dirty" >&2
    exit 1
fi

step "同步 Git"
git pull --ff-only

step "安装依赖"
bun install --frozen-lockfile

step "准备 profile artifact 临时目录"
run_sudo rm -rf .agent/workspace/profile-artifact-build
run_sudo mkdir -p .agent/workspace
run_sudo chown "$(id -u):$(id -g)" .agent .agent/workspace

step "准备 Prisma 生成目录"
run_sudo rm -rf server/generated/prisma
run_sudo mkdir -p server/generated
run_sudo chown "$(id -u):$(id -g)" server/generated

step "加载部署环境"
set -a
. ./${ENV_FILE}
set +a

case "\${DATABASE_URL:-}" in
    file:*) DATABASE_KIND=sqlite ;;
    "") DATABASE_KIND=sqlite ;;
    *) echo "DATABASE_URL must be a SQLite file: URL." >&2; exit 1 ;;
esac
export DATABASE_KIND

COMPOSE_FILES="-f docker-compose.yml"
if [ "\${DATABASE_KIND:-sqlite}" != "sqlite" ]; then
    echo "DATABASE_KIND must be sqlite." >&2
    exit 1
fi
COMPOSE_FILES="$COMPOSE_FILES -f .deploy/docker-compose.generated.yml"

step "Nuxt prepare"
bun run nuxt:prepare

step "Prisma generate"
bun run generate

step "Nuxt build"
bun run nuxt:build

step "重启 app 容器"
run_sudo docker compose --env-file ${ENV_FILE} $COMPOSE_FILES up -d --build --force-recreate app

step "Compose 状态"
run_sudo docker compose --env-file ${ENV_FILE} $COMPOSE_FILES ps

step "App 最近日志"
run_sudo docker compose --env-file ${ENV_FILE} $COMPOSE_FILES logs --tail=80 app
`;
}

/** 把远端脚本上传到临时文件。 */
function uploadRemoteScript({host, script, remoteScriptPath}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("ssh", [host, `cat > ${shellQuote(remoteScriptPath)} && chmod 700 ${shellQuote(remoteScriptPath)}`], {
            stdio: ["pipe", "inherit", "inherit"],
        });

        child.on("error", (error) => {
            rejectPromise(new Error(`SSH 启动失败：${error.message}`));
        });

        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`上传远端脚本被信号中断：${signal}`));
                return;
            }

            if (code !== 0) {
                rejectPromise(new Error(`上传远端脚本失败，退出码 ${code}`));
                return;
            }

            resolvePromise();
        });

        child.stdin.end(script);
    });
}

/** 执行远端临时脚本，并通过 stdin 向远端脚本传递 sudo 密码。 */
function runRemoteScript({host, remoteScriptPath, sudoPassword}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("ssh", [host, `sh ${shellQuote(remoteScriptPath)}; deploy_exit_code=$?; rm -f ${shellQuote(remoteScriptPath)}; exit $deploy_exit_code`], {
            stdio: ["pipe", "inherit", "inherit"],
        });

        child.on("error", (error) => {
            rejectPromise(new Error(`SSH 启动失败：${error.message}`));
        });

        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`远程部署被信号中断：${signal}`));
                return;
            }

            if (code !== 0) {
                rejectPromise(new Error(`远程部署失败，退出码 ${code}`));
                return;
            }

            resolvePromise();
        });

        child.stdin.end(`${sudoPassword}\n`);
    });
}

/** CLI 主流程。 */
async function main() {
    const options = program.opts();
    const script = remoteScript(options.dir);

    p.intro("neuro-book arch source deployment");

    if (options.dryRun) {
        p.log.info(`ssh ${options.host} 'sh -s'`);
        p.log.info(script);
        p.outro("Dry run complete; no password was requested.");
        return;
    }

    const sudoPassword = String(unwrapPrompt(await p.password({
        message: `请输入 ${options.host} 的 sudo 密码`,
        validate: (value) => value ? undefined : "sudo 密码不能为空",
    })));
    const remoteScriptPath = `/tmp/neuro-book-deploy-${Date.now()}.sh`;

    await uploadRemoteScript({
        host: options.host,
        script,
        remoteScriptPath,
    });
    await runRemoteScript({
        host: options.host,
        remoteScriptPath,
        sudoPassword,
    });

    p.outro(`Done. Remote deployment updated on ${options.host}:${options.dir}`);
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
