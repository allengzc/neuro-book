/** 宿主机依赖探测与安装。 */

import * as p from '@clack/prompts';
import {
    NATIVE_REQUIRED_COMMANDS,
    NATIVE_UNIX_COMMANDS,
    NATIVE_RECOMMENDED_COMMANDS,
    LOCAL_GIT_DEPLOY_MODE,
} from './constants.mjs';
import {commandAvailable, refreshInstallPath, runShell} from '../utils/process.mjs';
import {askConfirm} from './prompts.mjs';

/** 返回当前平台 local-git 模式要检查的可执行文件。 */
export function nativeCommands() {
    return [
        ...NATIVE_REQUIRED_COMMANDS,
        ...(process.platform === 'win32' ? [] : NATIVE_UNIX_COMMANDS),
        ...NATIVE_RECOMMENDED_COMMANDS,
    ];
}

/** 生成指定平台的安装命令建议；纯函数，便于 dry-run 和内部映射检查复用。 */
export function installPlanCandidates({platform, missingCommands, windowsPackageManager = 'auto'}) {
    if (missingCommands.length === 0) {
        return [];
    }

    const missing = new Set(missingCommands);
    if (platform === 'win32') {
        const wingetPackages = [
            missing.has('node') || missing.has('npm') ? 'OpenJS.NodeJS' : null,
            missing.has('git') ? 'Git.Git' : null,
            missing.has('rg') ? 'BurntSushi.ripgrep.MSVC' : null,
            missing.has('bun') ? 'Oven-sh.Bun' : null,
            missing.has('python3') ? 'Python.Python.3.13' : null,
        ].filter(Boolean);
        const scoopPackages = [
            missing.has('node') || missing.has('npm') ? 'nodejs-lts' : null,
            missing.has('git') ? 'git' : null,
            missing.has('rg') ? 'ripgrep' : null,
            missing.has('bun') ? 'bun' : null,
            missing.has('python3') ? 'python' : null,
        ].filter(Boolean);
        if (wingetPackages.length === 0 && scoopPackages.length === 0) {
            return [];
        }

        const plans = [];
        if (windowsPackageManager === 'auto' || windowsPackageManager === 'winget') {
            plans.push({
                manager: 'winget',
                probeCommand: 'winget',
                commandLine: wingetPackages.map((name) => `winget install --id ${name} --exact --source winget`).join('; '),
            });
        }
        if (windowsPackageManager === 'auto' || windowsPackageManager === 'scoop') {
            plans.push({
                manager: 'scoop',
                probeCommand: 'scoop',
                commandLine: `scoop install ${scoopPackages.join(' ')}`,
            });
        }
        return plans.filter((plan) => plan.commandLine.trim().length > 0);
    }

    if (platform === 'darwin') {
        const packages = [
            missing.has('node') || missing.has('npm') ? 'node' : null,
            missing.has('git') ? 'git' : null,
            missing.has('rg') ? 'ripgrep' : null,
            missing.has('bun') ? 'oven-sh/bun/bun' : null,
            missing.has('python3') ? 'python' : null,
            missing.has('bash') ? 'bash' : null,
            missing.has('env') ? 'coreutils' : null,
            missing.has('find') ? 'findutils' : null,
        ].filter(Boolean);
        if (packages.length === 0) {
            return [];
        }

        return [{
            manager: 'brew',
            probeCommand: 'brew',
            commandLine: `brew install ${packages.join(' ')}`,
        }];
    }

    const bunInstall = 'curl -fsSL https://bun.sh/install | bash';
    const linuxPackages = (packageNames) => Array.from(new Set([
        missing.has('node') || missing.has('npm') ? packageNames.node : null,
        missing.has('npm') ? packageNames.npm : null,
        missing.has('git') ? packageNames.git : null,
        missing.has('rg') ? packageNames.rg : null,
        missing.has('bash') ? packageNames.bash : null,
        missing.has('env') ? packageNames.coreutils : null,
        missing.has('find') ? packageNames.coreutils : null,
        missing.has('find') ? packageNames.findutils : null,
        missing.has('python3') ? packageNames.python3 : null,
        missing.has('bun') ? packageNames.curl : null,
        missing.has('bun') ? packageNames.unzip : null,
        missing.has('bun') ? packageNames.caCertificates : null,
    ].filter(Boolean)));
    const linuxInstall = ({prefix = '', installCommand, packageNames}) => {
        const packages = linuxPackages(packageNames);
        const packageCommand = packages.length > 0 ? `${prefix}${installCommand} ${packages.join(' ')}` : '';
        if (!missing.has('bun')) {
            return packageCommand;
        }
        return packageCommand ? `${packageCommand} && ${bunInstall}` : bunInstall;
    };

    return [
        {
            manager: 'apt-get',
            probeCommand: 'apt-get',
            commandLine: linuxInstall({
                prefix: 'sudo apt-get update && ',
                installCommand: 'sudo apt-get install -y',
                packageNames: {node: 'nodejs', npm: 'npm', git: 'git', rg: 'ripgrep', bash: 'bash', coreutils: 'coreutils', findutils: 'findutils', python3: 'python3', curl: 'curl', unzip: 'unzip', caCertificates: 'ca-certificates'},
            }),
        },
        {
            manager: 'dnf',
            probeCommand: 'dnf',
            commandLine: linuxInstall({
                installCommand: 'sudo dnf install -y',
                packageNames: {node: 'nodejs', npm: 'npm', git: 'git', rg: 'ripgrep', bash: 'bash', coreutils: 'coreutils', findutils: 'findutils', python3: 'python3', curl: 'curl', unzip: 'unzip', caCertificates: 'ca-certificates'},
            }),
        },
        {
            manager: 'yum',
            probeCommand: 'yum',
            commandLine: linuxInstall({
                installCommand: 'sudo yum install -y',
                packageNames: {node: 'nodejs', npm: 'npm', git: 'git', rg: 'ripgrep', bash: 'bash', coreutils: 'coreutils', findutils: 'findutils', python3: 'python3', curl: 'curl', unzip: 'unzip', caCertificates: 'ca-certificates'},
            }),
        },
        {
            manager: 'pacman',
            probeCommand: 'pacman',
            commandLine: linuxInstall({
                installCommand: 'sudo pacman -Sy --needed',
                packageNames: {node: 'nodejs', npm: 'npm', git: 'git', rg: 'ripgrep', bash: 'bash', coreutils: 'coreutils', findutils: 'findutils', python3: 'python', curl: 'curl', unzip: 'unzip', caCertificates: 'ca-certificates'},
            }),
        },
        {
            manager: 'zypper',
            probeCommand: 'zypper',
            commandLine: linuxInstall({
                installCommand: 'sudo zypper install -y',
                packageNames: {node: 'nodejs', npm: 'npm', git: 'git', rg: 'ripgrep', bash: 'bash', coreutils: 'coreutils', findutils: 'findutils', python3: 'python3', curl: 'curl', unzip: 'unzip', caCertificates: 'ca-certificates'},
            }),
        },
        {
            manager: 'apk',
            probeCommand: 'apk',
            commandLine: linuxInstall({
                installCommand: 'sudo apk add',
                packageNames: {node: 'nodejs', npm: 'npm', git: 'git', rg: 'ripgrep', bash: 'bash', coreutils: 'coreutils', findutils: 'findutils', python3: 'python3', curl: 'curl', unzip: 'unzip', caCertificates: 'ca-certificates'},
            }),
        },
    ];
}

/** 打印固定平台/缺失工具样例，用于人工核对安装命令映射。 */
export function printInternalInstallPlans() {
    const cases = [
        {name: 'windows auto git rg bun', platform: 'win32', windowsPackageManager: 'auto', missingCommands: ['git', 'rg', 'bun']},
        {name: 'windows winget git rg bun', platform: 'win32', windowsPackageManager: 'winget', missingCommands: ['git', 'rg', 'bun']},
        {name: 'windows scoop git rg bun', platform: 'win32', windowsPackageManager: 'scoop', missingCommands: ['git', 'rg', 'bun']},
        {name: 'macos git rg bun', platform: 'darwin', missingCommands: ['git', 'rg', 'bun']},
        {name: 'linux rg only', platform: 'linux', missingCommands: ['rg']},
        {name: 'linux bun', platform: 'linux', missingCommands: ['bun']},
        {name: 'linux python3', platform: 'linux', missingCommands: ['python3']},
        {name: 'linux coreutils/findutils', platform: 'linux', missingCommands: ['env', 'find']},
    ];

    for (const item of cases) {
        p.log.info(`[${item.name}]`);
        const plans = installPlanCandidates({
            platform: item.platform,
            missingCommands: item.missingCommands,
            windowsPackageManager: item.windowsPackageManager ?? 'auto',
        });
        for (const plan of plans) {
            p.log.info(`${plan.manager}: ${plan.commandLine}`);
        }
    }
}

/** 给用户展示缺失工具和安装建议。 */
function formatMissingCommandHelp(missing, plan) {
    const missingText = missing.map((item) => `${item.label} (${item.command})`).join(', ');
    const installText = plan
        ? `可尝试安装命令：\n${plan.commandLine}`
        : '当前平台没有可自动执行的安装命令。请手动安装缺失工具后重试。';

    return `缺少 local-git 部署所需工具：${missingText}\n${installText}`;
}

/** 检查 local-git 宿主机依赖，并按用户确认执行安装命令。 */
export async function ensureNativeCommands(config) {
    if (config.deployMode !== LOCAL_GIT_DEPLOY_MODE) {
        return;
    }

    const missing = [];
    for (const command of nativeCommands()) {
        const available = await commandAvailable(command.command, command.args ?? ['--version']);
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
            throw new Error('local-git 部署缺少必要工具，已按用户选择停止。');
        }
        p.log.warn('local-git 部署建议工具未安装，继续执行。');
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
