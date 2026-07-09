/** local-git 模式：宿主机构建，不使用 Docker。 */

import * as p from '@clack/prompts';
import {DEPLOY_DIRNAME, LOCAL_GIT_DEPLOY_MODE} from './constants.mjs';
import {LOCAL_GIT_SERVER_COMMAND, LOCAL_GIT_SYSTEM_ASSETS_COMMAND, localGitStartCommand, renderNativeScript, nativeStartScriptName, nativeAdminScriptName, nativeStartHelp, dryRunCommand} from './scripts-gen.mjs';
import {ensureNativeCommands} from './native-deps.mjs';
import {run} from '../utils/process.mjs';

export const modeName = LOCAL_GIT_DEPLOY_MODE;

/** 宿主机依赖探测与安装。 */
export async function preBuild(config) {
    await ensureNativeCommands(config);
}

/** 宿主机执行 bun install → nuxt:prepare → generate → nuxt:build → migrate:deploy。 */
export async function build(config, env) {
    const commands = [
        {command: 'bun', args: ['install', '--frozen-lockfile']},
        {command: 'bun', args: ['run', 'nuxt:prepare']},
        {command: 'bun', args: ['run', 'generate']},
        {command: 'bun', args: ['run', 'nuxt:build']},
        {command: 'bun', args: ['run', 'migrate:deploy']},
    ];

    if (config.dryRun) {
        for (const command of commands) {
            dryRunCommand(command.command, command.args, {cwd: config.deployDir});
        }
        return;
    }

    p.log.info('Preparing local-git deployment on host.');
    for (const command of commands) {
        await run(command.command, command.args, {cwd: config.deployDir, env});
    }
}

/** 输出下一步启动命令。 */
export async function postBuild(config) {
    p.note(
        `启动服务：
${DEPLOY_DIRNAME}/${nativeStartScriptName()}

创建或重置管理员：
${DEPLOY_DIRNAME}/${nativeAdminScriptName()}

手动启动命令：
${nativeStartHelp(localGitStartCommand())}`,
        'local-git 启动命令',
    );
}

/** local-git 不使用 Docker Compose。 */
export function renderCompose() {
    return '';
}

/** 返回启动脚本内容。 */
export function renderStartScript(config) {
    return {
        startPath: `${DEPLOY_DIRNAME}/${nativeStartScriptName()}`,
        startContent: renderNativeScript(localGitStartCommand()),
        adminPath: `${DEPLOY_DIRNAME}/${nativeAdminScriptName()}`,
        adminContent: renderNativeScript('bun run auth:create-admin'),
    };
}

/** 返回更新命令提示。 */
export function updateCommands() {
    return [
        'git pull --ff-only',
        'bun install --frozen-lockfile',
        'set -a',
        '. ./.env',
        'set +a',
        'bun run nuxt:prepare',
        'bun run generate',
        'bun run nuxt:build',
        'bun run migrate:deploy',
        LOCAL_GIT_SYSTEM_ASSETS_COMMAND,
        LOCAL_GIT_SERVER_COMMAND,
    ];
}

/** 模式说明文本。 */
export function notes() {
    return `local-git 模式不使用 Docker，也不生成 systemd/pm2 服务。宿主机需要安装 Git、Bun、ripgrep，并在启动前完成：
${updateCommands().map((line) => `- ${line}`).join('\n')}

Windows PowerShell 启动前请按 .env 内容设置当前进程环境变量，然后运行：
- ${LOCAL_GIT_SYSTEM_ASSETS_COMMAND}
- ${LOCAL_GIT_SERVER_COMMAND}`;
}
