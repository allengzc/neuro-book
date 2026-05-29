/** source 模式：Docker 容器挂载宿主机源码。 */

import * as p from '@clack/prompts';
import {DEPLOY_DIRNAME, ENV_FILENAME} from './constants.mjs';
import {renderGeneratedCompose} from './config-render.mjs';
import {dryRunCommand} from './scripts-gen.mjs';
import {run} from '../utils/process.mjs';

export const modeName = 'source';

/** source 模式无需 preBuild。 */
export async function preBuild() {}

/** 宿主机执行 bun install → nuxt:prepare → generate → nuxt:build。 */
export async function build(config, env) {
    const commands = [
        {command: 'bun', args: ['install', '--frozen-lockfile']},
        {command: 'bun', args: ['run', 'nuxt:prepare']},
        {command: 'bun', args: ['run', 'generate']},
        {command: 'bun', args: ['run', 'nuxt:build']},
    ];

    if (config.dryRun) {
        for (const command of commands) {
            dryRunCommand(command.command, command.args, {cwd: config.deployDir});
        }
        return;
    }

    p.log.info('Preparing source deployment on host.');
    for (const command of commands) {
        await run(command.command, command.args, {cwd: config.deployDir, env});
    }
}

/** source 模式无需 postBuild。 */
export async function postBuild() {}

/** 返回 source-runtime override compose。 */
export function renderCompose(config) {
    return renderGeneratedCompose(config);
}

/** source 模式不生成本地启动脚本。 */
export function renderStartScript() {
    return null;
}

/** 返回更新命令提示。 */
export function updateCommands(config) {
    const upCommand = `docker compose --env-file ${ENV_FILENAME} -f docker-compose.yml -f ${DEPLOY_DIRNAME}/docker-compose.generated.yml up -d --build`;
    return [
        'git pull --ff-only',
        'bun install --frozen-lockfile',
        'set -a',
        '. ./.env',
        'set +a',
        'bun run nuxt:prepare',
        'bun run generate',
        'bun run nuxt:build',
        upCommand,
    ];
}

/** 模式说明文本。 */
export function notes(config) {
    return `source 模式使用宿主机源码挂载到容器 /app。宿主机需要安装 Bun，并在启动前完成：
${updateCommands(config).map((line) => `- ${line}`).join('\n')}`;
}
