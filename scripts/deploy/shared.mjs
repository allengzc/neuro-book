/**
 * 三种部署模式共享的流程：
 * readConfig, ensureRepository, writeDeployFiles, runCompose 等。
 */

import {existsSync} from 'node:fs';
import {chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, relative, resolve} from 'node:path';
import * as p from '@clack/prompts';

import {
    REPO_URL,
    DEPLOY_DIRNAME,
    ENV_FILENAME,
    CONFIG_FILENAME,
    GLOBAL_CONFIG_FILENAME,
    LOCAL_GIT_DEPLOY_MODE,
    DEPLOY_MODES,
    DOCKER_DEPLOY_MODES,
    REGENERATED_SYSTEM_ARTIFACTS,
    PROVIDERS,
} from './constants.mjs';
import {run, runCapture, validatePort} from '../utils/process.mjs';
import {askText, askSelect} from './prompts.mjs';
import {localGitStartCommand, nativeStartScriptName, nativeAdminScriptName, renderNativeScript, dryRunCommand, nativeStartHelp} from './scripts-gen.mjs';
import {renderEnv, renderGlobalConfig, parseEnv, randomSecret, readBootConfigAuth, resolveDeployBootConfig} from './config-render.mjs';
import {
    defaultReleaseTag,
    fetchGhcrReleases,
    ghcrReleaseOptions,
    imageForReleaseTag,
    normalizeReleaseTag,
    readInstallerPackageVersion,
} from './ghcr-releases.mjs';

/** 查询路径是否存在，并返回 stat 信息。 */
async function tryStat(path) {
    try {
        return await stat(path);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/** 从已有 generated compose 推断部署模式。 */
async function inferDeployMode(deployDir) {
    const generatedComposePath = resolve(deployDir, DEPLOY_DIRNAME, 'docker-compose.generated.yml');
    if (!existsSync(generatedComposePath)) {
        return null;
    }

    const content = await readFile(generatedComposePath, 'utf-8');
    if (content.includes('Dockerfile.source-runtime') || content.includes('neuro-book-source-runtime') || content.includes('oven/bun:1')) {
        return 'source';
    }
    if (content.includes('ghcr.io/')) {
        return 'ghcr';
    }
    return null;
}

/** 兼容旧部署模式命名，并拒绝已停用的 build 模式。 */
export function normalizeDeployMode(value) {
    if (!value) {
        return value;
    }
    const mode = String(value).toLowerCase();
    if (mode === 'native') {
        return LOCAL_GIT_DEPLOY_MODE;
    }
    if (mode === 'image') {
        return 'ghcr';
    }
    if (mode === 'build') {
        throw new Error('--deploy-mode build 已停用。请使用默认 local-git，或使用 --deploy-mode ghcr / source。');
    }
    return mode;
}

function normalizeDatabaseMode(value) {
    if (!value || value === 'sqlite') {
        return 'sqlite';
    }
    throw new Error(`数据库模式只支持 sqlite；PostgreSQL 部署入口已移除：${value}`);
}

/** 解析 ghcr 模式使用的镜像。 */
export async function resolveGhcrImageOption({interactive, image, release}) {
    if (image && release) {
        throw new Error('--image 和 --release 只能选择一个。--image 用于完整镜像覆盖，--release 用于选择 ghcr.io/notnotype/neuro-book:<tag>。');
    }
    if (image) {
        return image;
    }
    if (release) {
        return imageForReleaseTag(normalizeReleaseTag(release));
    }

    const packageVersion = await readInstallerPackageVersion();
    const fallbackTag = defaultReleaseTag(packageVersion);
    if (!interactive) {
        return imageForReleaseTag(fallbackTag);
    }

    const releases = await fetchGhcrReleases();
    const options = ghcrReleaseOptions(releases);
    const initialValue = options.some((option) => option.value === fallbackTag)
        ? fallbackTag
        : options[0]?.value;
    const selectedTag = await askSelect({
        interactive,
        value: null,
        message: 'GHCR 版本',
        initialValue,
        options,
    });
    return imageForReleaseTag(selectedTag);
}

/** 返回部署私有文件目录。 */
export function deployStateDir(config) {
    return resolve(config.deployDir, DEPLOY_DIRNAME);
}

/** 返回相对部署根目录的可读路径。 */
function displayPath(config, path) {
    return relative(config.deployDir, path).replaceAll('\\', '/');
}

/** 收集部署参数。 */
export async function readConfig(options) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.yes);
    const deployDir = resolve(await askText({
        interactive,
        value: options.dir,
        message: '部署目录',
        initialValue: resolve(homedir(), 'neuro-book'),
    }));
    const port = await askText({
        interactive,
        value: options.port,
        message: 'Web 端口',
        initialValue: '3000',
        validate: validatePort,
    });
    const provider = options.provider !== undefined && options.provider !== null
        ? String(options.provider).toLowerCase()
        : null;

    if (provider && !PROVIDERS[provider]) {
        throw new Error(`不支持的 Provider：${provider}`);
    }

    const apiKey = options.apiKey !== undefined && options.apiKey !== null ? String(options.apiKey) : '';
    if (apiKey && !provider) {
        throw new Error('使用 --api-key 时必须同时传入 --provider。部署交互不会主动询问 Provider，可部署后在前端设置页配置。');
    }
    const inferredDeployMode = options.redeploy && !options.deployMode
        ? await inferDeployMode(deployDir)
        : null;
    const rawDeployMode = await askSelect({
        interactive,
        value: options.deployMode ?? inferredDeployMode,
        message: '部署模式',
        initialValue: LOCAL_GIT_DEPLOY_MODE,
        options: [
            {value: LOCAL_GIT_DEPLOY_MODE, label: '本机 + Git', hint: '默认推荐，clone/pull 后宿主机构建'},
            {value: 'ghcr', label: '使用 GHCR 预构建镜像', hint: '高级选项，需要 Docker'},
            {value: 'source', label: '挂载宿主机源码', hint: '高级选项，需要 Docker + 宿主机 Bun'},
        ],
    });
    const deployMode = normalizeDeployMode(rawDeployMode);
    if (rawDeployMode === 'native') {
        p.log.info('--deploy-mode native 已兼容映射为 local-git。');
    }

    if (!DEPLOY_MODES.includes(deployMode)) {
        throw new Error(`部署模式必须是 local-git、ghcr 或 source：${deployMode}`);
    }
    const windowsPackageManager = (process.platform === 'win32' && deployMode === LOCAL_GIT_DEPLOY_MODE
        ? await askSelect({
            interactive,
            value: options.windowsPackageManager,
            message: 'Windows 包管理器',
            initialValue: 'auto',
            options: [
                {value: 'auto', label: '自动选择', hint: '优先 winget，其次 scoop'},
                {value: 'winget', label: 'winget', hint: 'Windows 官方入口'},
                {value: 'scoop', label: 'Scoop', hint: '开发者工具链常用'},
            ],
        })
        : 'auto').toLowerCase();
    if (!['auto', 'winget', 'scoop'].includes(windowsPackageManager)) {
        throw new Error(`Windows 包管理器必须是 auto、winget 或 scoop：${windowsPackageManager}`);
    }

    const databaseMode = normalizeDatabaseMode(options.database ?? 'sqlite');

    const existingAuthEnabled = await readExistingAuthEnabled(deployDir);
    const rawAuth = String(await askSelect({
        interactive,
        value: options.auth,
        message: '密码保护（全站登录）',
        initialValue: existingAuthEnabled === false ? 'disabled' : 'enabled',
        options: [
            {value: 'enabled', label: '开启', hint: '推荐；部署后需创建管理员账号登录'},
            {value: 'disabled', label: '关闭', hint: '免登录，仅限完全可信的本地环境'},
        ],
    })).toLowerCase();
    if (!['enabled', 'disabled'].includes(rawAuth)) {
        throw new Error(`--auth 只支持 enabled 或 disabled：${rawAuth}`);
    }

    const image = deployMode === 'ghcr'
        ? await resolveGhcrImageOption({
            interactive,
            image: options.image,
            release: options.release,
        })
        : options.image;

    return {
        apiKey,
        // 用户是否显式选择过鉴权开关：交互确认或 --auth 传参。redeploy 时只有显式选择才会改已有配置。
        authEnabled: rawAuth === 'enabled',
        authExplicit: Boolean(options.auth) || interactive,
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

/** 读取部署目录已有 Boot Config 鉴权开关；无配置或不可解析时返回 null。 */
async function readExistingAuthEnabled(deployDir) {
    const path = resolve(deployDir, CONFIG_FILENAME);
    if (!existsSync(path)) {
        return null;
    }
    return readBootConfigAuth(await readFile(path, 'utf-8'));
}

/** 拉取或更新应用仓库。 */
export async function ensureRepository(config) {
    if (config.dryRun) {
        if (!existsSync(resolve(config.deployDir, '.git'))) {
            dryRunCommand('git', ['clone', config.repo, config.deployDir]);
        } else {
            dryRunCommand('git', ['-C', config.deployDir, 'ls-files', '--', ...REGENERATED_SYSTEM_ARTIFACTS]);
            dryRunCommand('git', ['-C', config.deployDir, 'restore', '--', '<tracked generated artifacts>']);
            dryRunCommand('git', ['-C', config.deployDir, 'pull', '--ff-only']);
        }
        return;
    }

    await mkdir(dirname(config.deployDir), {recursive: true});
    if (!existsSync(resolve(config.deployDir, '.git'))) {
        const current = await tryStat(config.deployDir);
        if (current && !current.isDirectory()) {
            throw new Error(`部署路径已存在但不是目录：${config.deployDir}`);
        }
        if (current && (await readdir(config.deployDir)).length > 0) {
            throw new Error(`部署目录非空且不是 Git checkout：${config.deployDir}`);
        }
        await run('git', ['clone', config.repo, config.deployDir]);
        return;
    }

    await restoreRegeneratedSystemArtifacts(config.deployDir);
    await run('git', ['-C', config.deployDir, 'pull', '--ff-only']);
}

async function restoreRegeneratedSystemArtifacts(deployDir) {
    const tracked = await gitTrackedGeneratedArtifacts(deployDir);
    if (tracked.length === 0) {
        return;
    }
    await run('git', ['-C', deployDir, 'restore', '--', ...tracked]);
}

async function gitTrackedGeneratedArtifacts(deployDir) {
    const stdout = await runCapture('git', ['-C', deployDir, 'ls-files', '--', ...REGENERATED_SYSTEM_ARTIFACTS]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** 以仅当前用户可读写的权限写入敏感部署文件。 */
async function writePrivateFile(path, text) {
    await writeFile(path, text, {encoding: 'utf-8', mode: 0o600});
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

/** 生成管理员创建命令提示。 */
export function adminCommand(config) {
    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return nativeStartHelp('bun run auth:create-admin');
    }
    const files = ['-f', 'docker-compose.yml', '-f', `${DEPLOY_DIRNAME}/docker-compose.generated.yml`];
    if (config.deployMode === 'ghcr') {
        return `docker compose --env-file ${ENV_FILENAME} ${files.join(' ')} exec app bun .output/server/scripts/cli/create-admin.ts`;
    }
    return `docker compose --env-file ${ENV_FILENAME} ${files.join(' ')} exec app bun run auth:create-admin`;
}

/** 生成容器启动命令提示。 */
function upCommand(config, mode) {
    if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
        return nativeStartHelp(localGitStartCommand());
    }
    const files = ['-f', 'docker-compose.yml', '-f', `${DEPLOY_DIRNAME}/docker-compose.generated.yml`];
    if (config.deployMode === 'ghcr') {
        return [
            `docker compose --env-file ${ENV_FILENAME} ${files.join(' ')} pull app`,
            `docker compose --env-file ${ENV_FILENAME} ${files.join(' ')} up -d`,
        ].join('\n');
    }
    const upArgs = config.deployMode === 'source' ? 'up -d --build' : 'up -d';
    return `docker compose --env-file ${ENV_FILENAME} ${files.join(' ')} ${upArgs}`;
}

/** 生成部署私有说明文件。 */
function renderDeployReadme(config, mode) {
    const composeLine = config.deployMode === LOCAL_GIT_DEPLOY_MODE
        ? '- Compose override: not used in local-git mode'
        : `- Compose override: ${DEPLOY_DIRNAME}/docker-compose.generated.yml`;
    const commandLanguage = config.deployMode === LOCAL_GIT_DEPLOY_MODE && process.platform === 'win32' ? 'powershell' : 'bash';
    const nativeScriptLine = config.deployMode === LOCAL_GIT_DEPLOY_MODE
        ? `- Local Git start script: ${DEPLOY_DIRNAME}/${nativeStartScriptName()}`
        : '';

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
${upCommand(config, mode)}
\`\`\`

Create or reset admin:

\`\`\`${commandLanguage}
${adminCommand(config)}
\`\`\`

Do not pass admin passwords as command arguments. Use the interactive prompt, or set AUTH_ADMIN_PASSWORD only in a short-lived shell/secret environment.
Provider API keys are not requested during deployment. Configure them later in the frontend settings page or ${GLOBAL_CONFIG_FILENAME}.

${mode.notes(config)}
`;
}

/** 生成旧根目录部署文件清理提示。 */
export async function warnLegacyDeployFiles(config) {
    const legacyFiles = [
        resolve(deployStateDir(config), '.env.docker'),
        resolve(deployStateDir(config), 'config.yaml'),
        resolve(config.deployDir, '.env.docker'),
        resolve(config.deployDir, 'docker-compose.image.yml'),
    ];
    const existing = legacyFiles.filter((path) => existsSync(path));
    if (existing.length === 0) {
        return;
    }
    p.log.warn(`检测到旧部署文件：${existing.map((path) => displayPath(config, path)).join(', ')}。当前部署使用根目录 .env / config.yaml、${GLOBAL_CONFIG_FILENAME} 和 .deploy/docker-compose.generated.yml，可确认后手动删除旧文件。`);
}

/** 写入部署文件；redeploy 时保留已有敏感配置。mode 参数为部署模式模块。 */
export async function writeDeployFiles(config, mode) {
    const envPath = resolve(config.deployDir, ENV_FILENAME);
    const configPath = resolve(config.deployDir, CONFIG_FILENAME);
    const globalConfigPath = resolve(config.deployDir, GLOBAL_CONFIG_FILENAME);
    const legacyEnvPath = resolve(deployStateDir(config), '.env.docker');
    const legacyConfigPath = resolve(deployStateDir(config), 'config.yaml');
    const generatedComposePath = resolve(deployStateDir(config), 'docker-compose.generated.yml');
    const readmePath = resolve(deployStateDir(config), 'README.md');
    const staleNativeScriptPaths = [
        resolve(deployStateDir(config), 'start-native.sh'),
        resolve(deployStateDir(config), 'start-native.ps1'),
        resolve(deployStateDir(config), 'create-admin-native.sh'),
        resolve(deployStateDir(config), 'create-admin-native.ps1'),
    ];
    const localGitScriptPaths = [
        resolve(deployStateDir(config), 'start-local-git.sh'),
        resolve(deployStateDir(config), 'start-local-git.ps1'),
        resolve(deployStateDir(config), 'create-admin-local-git.sh'),
        resolve(deployStateDir(config), 'create-admin-local-git.ps1'),
    ];

    if (config.dryRun) {
        const envText = existsSync(envPath)
            ? await readFile(envPath, 'utf-8')
            : renderEnv(config, '<generated-session-password>');
        const legacyConfigText = existsSync(legacyConfigPath) ? await readFile(legacyConfigPath, 'utf-8') : null;
        p.log.info(`Dry run file: ${envPath}`);
        p.log.info(`Dry run file: ${configPath}`);
        p.log.info(`Dry run file: ${globalConfigPath}`);
        if (config.deployMode === LOCAL_GIT_DEPLOY_MODE) {
            if (existsSync(generatedComposePath)) {
                p.log.info(`Dry run cleanup: remove stale ${generatedComposePath}`);
            }
            const scripts = mode.renderStartScript(config);
            if (scripts) {
                p.log.info(`Dry run file: ${resolve(config.deployDir, scripts.startPath)}`);
                p.log.info(`Dry run file: ${resolve(config.deployDir, scripts.adminPath)}`);
            }
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

    let envText = '';
    if (existsSync(envPath)) {
        envText = await readFile(envPath, 'utf-8');
        p.log.info(`Preserved ${envPath}`);
    } else {
        envText = renderEnv(config, randomSecret());
        await writePrivateFile(envPath, envText);
        p.log.success(`Wrote ${envPath}`);
    }

    if (existsSync(configPath)) {
        const nextBootConfig = resolveDeployBootConfig(await readFile(configPath, 'utf-8'), config);
        if (nextBootConfig !== null) {
            await writePrivateFile(configPath, nextBootConfig);
            p.log.success(`Updated auth.enabled=${config.authEnabled} in ${configPath}`);
        } else {
            p.log.info(`Preserved ${configPath}`);
        }
    } else {
        await writePrivateFile(configPath, resolveDeployBootConfig(null, config));
        p.log.success(`Wrote ${configPath}`);
    }

    const legacyConfigText = existsSync(legacyConfigPath) ? await readFile(legacyConfigPath, 'utf-8') : null;
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
        const scripts = mode.renderStartScript(config);
        if (scripts) {
            const startPath = resolve(config.deployDir, scripts.startPath);
            const adminPath = resolve(config.deployDir, scripts.adminPath);
            await mkdir(dirname(startPath), {recursive: true});
            await mkdir(dirname(adminPath), {recursive: true});
            await writeFile(startPath, scripts.startContent, 'utf-8');
            await writeFile(adminPath, scripts.adminContent, 'utf-8');
            if (process.platform !== 'win32') {
                await chmod(startPath, 0o700);
                await chmod(adminPath, 0o700);
            }
            p.log.success(`Wrote ${startPath}`);
            p.log.success(`Wrote ${adminPath}`);
        }
    } else {
        const composeContent = mode.renderCompose(config);
        await writeFile(generatedComposePath, composeContent, 'utf-8');
        p.log.success(`Wrote ${generatedComposePath}`);
        for (const scriptPath of [...localGitScriptPaths, ...staleNativeScriptPaths]) {
            await rm(scriptPath, {force: true});
        }
    }
    await writeFile(readmePath, renderDeployReadme(config, mode), 'utf-8');

    return parseEnv(envText);
}

/** Docker 模式启动 Compose。 */
export async function runCompose(config, mode) {
    if (!DOCKER_DEPLOY_MODES.includes(config.deployMode)) {
        return;
    }

    const composeFiles = ['-f', 'docker-compose.yml', '-f', `${DEPLOY_DIRNAME}/docker-compose.generated.yml`];
    const upArgs = ['compose', ...composeFiles, '--env-file', ENV_FILENAME, 'up', '-d'];
    if (config.deployMode === 'source') {
        upArgs.push('--build');
    }

    if (config.dryRun) {
        if (config.deployMode === 'ghcr') {
            dryRunCommand('docker', ['compose', ...composeFiles, '--env-file', ENV_FILENAME, 'pull', 'app'], {cwd: config.deployDir});
        }
        dryRunCommand('docker', upArgs, {cwd: config.deployDir});
        return;
    }

    if (config.deployMode === 'ghcr') {
        await run('docker', ['compose', ...composeFiles, '--env-file', ENV_FILENAME, 'pull', 'app'], {cwd: config.deployDir});
    }
    await run('docker', upArgs, {cwd: config.deployDir});
}
