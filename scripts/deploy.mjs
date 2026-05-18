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
const COMPOSE_FILES = "-f docker-compose.yml -f .deploy/docker-compose.generated.yml";

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
    printf '%s\\n' "$SUDO_PASSWORD" | sudo -S -p '' "$@"
}

cd ${shellQuote(remoteDir)}

step "检查远端工作区"
if [ ! -d .git ]; then
    echo "远端目录不是 Git checkout：$(pwd)" >&2
    exit 1
fi

if [ ! -f .deploy/.env.docker ] || [ ! -f .deploy/docker-compose.generated.yml ]; then
    echo "缺少 .deploy 部署文件。请先运行 neuro-book-deploy --deploy-mode source 初始化部署。" >&2
    exit 1
fi

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

step "加载部署环境"
set -a
. .deploy/.env.docker
set +a

step "Nuxt prepare"
bun run nuxt:prepare

step "Prisma generate"
bun run generate

step "Nuxt build"
bun run nuxt:build

step "重启 app 容器"
run_sudo docker compose --env-file .deploy/.env.docker ${COMPOSE_FILES} up -d --force-recreate app

step "Compose 状态"
run_sudo docker compose --env-file .deploy/.env.docker ${COMPOSE_FILES} ps

step "App 最近日志"
run_sudo docker compose --env-file .deploy/.env.docker ${COMPOSE_FILES} logs --tail=80 app
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
        const child = spawn("ssh", [host, `sh ${shellQuote(remoteScriptPath)}; status=$?; rm -f ${shellQuote(remoteScriptPath)}; exit $status`], {
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
