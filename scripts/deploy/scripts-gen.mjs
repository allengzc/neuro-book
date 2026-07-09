/** local-git 模式启动脚本生成与命令格式化。 */

import * as p from '@clack/prompts';

export const LOCAL_GIT_SYSTEM_ASSETS_COMMAND = 'bun scripts/build/prepare-system-assets.ts --sync-user-assets';
export const LOCAL_GIT_SERVER_COMMAND = 'bun .output/server/index.mjs';

/** 返回 local-git 服务启动命令。启动前同步 user-assets，修复系统 profile 覆盖层 artifact。 */
export function localGitStartCommand() {
    return [
        LOCAL_GIT_SYSTEM_ASSETS_COMMAND,
        LOCAL_GIT_SERVER_COMMAND,
    ].join('\n');
}

/** 按平台返回 .env 加载方式说明。 */
export function nativeStartHelp(command) {
    if (process.platform === 'win32') {
        return [
            'Get-Content .env | ForEach-Object {',
            '    if ($_ -match \'^[^#][^=]+=\') {',
            '        $name, $value = $_ -split \'=\', 2',
            '        Set-Item -Path "Env:$name" -Value $value',
            '    }',
            '}',
            command,
        ].join('\n');
    }

    return `set -a && . ./.env && set +a && ${command}`;
}

/** 返回 local-git 启动脚本文件名。 */
export function nativeStartScriptName() {
    return process.platform === 'win32' ? 'start-local-git.ps1' : 'start-local-git.sh';
}

/** 返回 local-git 管理员创建脚本文件名。 */
export function nativeAdminScriptName() {
    return process.platform === 'win32' ? 'create-admin-local-git.ps1' : 'create-admin-local-git.sh';
}

/** 生成 local-git 启动脚本。 */
export function renderNativeScript(command) {
    if (process.platform === 'win32') {
        return [
            '$ErrorActionPreference = "Stop"',
            'Set-Location (Split-Path -Parent $PSScriptRoot)',
            'Get-Content .env | ForEach-Object {',
            '    if ($_ -match \'^[^#][^=]+=\') {',
            '        $name, $value = $_ -split \'=\', 2',
            '        Set-Item -Path "Env:$name" -Value $value',
            '    }',
            '}',
            command,
            '',
        ].join('\n');
    }

    return [
        '#!/usr/bin/env sh',
        'set -eu',
        'cd "$(dirname "$0")/.."',
        'set -a',
        '. ./.env',
        'set +a',
        command,
        '',
    ].join('\n');
}

/** 格式化即将执行的命令，供 dry-run 展示。 */
export function commandText(command, args = [], options = {}) {
    const prefix = options.cwd ? `(cd ${options.cwd}) ` : '';
    return `${prefix}${[command, ...args].map(shellArg).join(' ')}`;
}

/** 简单 shell 参数展示转义，仅用于说明文本。 */
function shellArg(value) {
    const text = String(value);
    if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) {
        return text;
    }
    return `"${text.replaceAll('"', '\\"')}"`;
}

/** dry-run 展示命令。 */
export function dryRunCommand(command, args = [], options = {}) {
    p.log.info(`Dry run command: ${commandText(command, args, options)}`);
}
