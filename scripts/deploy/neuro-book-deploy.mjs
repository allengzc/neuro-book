#!/usr/bin/env node
import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {Command} from 'commander';
import * as p from '@clack/prompts';

import {REPO_URL, DEFAULT_IMAGE, DOCKER_DEPLOY_MODES} from './constants.mjs';
import {needCommand} from '../utils/process.mjs';
import {printInternalInstallPlans} from './native-deps.mjs';
import {
    readConfig,
    ensureRepository,
    writeDeployFiles,
    warnLegacyDeployFiles,
    runCompose,
    deployStateDir,
} from './shared.mjs';

import * as localGit from './local-git.mjs';
import * as ghcr from './ghcr.mjs';
import * as source from './source.mjs';

const MODES = {
    'local-git': localGit,
    ghcr,
    source,
};

const program = new Command()
    .name('neuro-book-deploy')
    .description('Interactive deployment for neuro-book.')
    .option('--repo <url>', 'Git repository URL.', process.env.NEURO_BOOK_REPO_URL ?? REPO_URL)
    .option('--dir <path>', 'Deployment directory.', process.env.NEURO_BOOK_DEPLOY_DIR ?? resolve(homedir(), 'neuro-book'))
    .option('--port <port>', 'HTTP port.', process.env.NEURO_BOOK_PORT ?? '3000')
    .option('--provider <provider>', 'Model provider: deepseek, doubao, qwen, siliconflow, gemini.')
    .option('--api-key <key>', 'Provider API key.')
    .option('--database <mode>', 'Database mode. Only sqlite is supported.')
    .option('--deploy-mode <mode>', 'Deploy mode: local-git, ghcr, or source. native is accepted as an alias.', process.env.NEURO_BOOK_DEPLOY_MODE)
    .option('--image <image>', 'GHCR app image.', process.env.NEURO_BOOK_IMAGE ?? DEFAULT_IMAGE)
    .option('--windows-package-manager <manager>', 'Windows local-git dependency installer: auto, winget, or scoop.', process.env.NEURO_BOOK_WINDOWS_PACKAGE_MANAGER)
    .option('--redeploy', 'Regenerate .deploy compose files while preserving existing .env, config.yaml and workspace config.', false)
    .option('--yes', 'Use defaults and skip interactive prompts.', false)
    .option('--dry-run', 'Preview files and commands. local-git mode still probes local commands, but does not install, build, migrate, start services or write files.', process.env.NEURO_BOOK_DEPLOY_DRY_RUN === '1')
    .option('--internal-print-install-plans', 'Print local-git install command mapping examples and exit.', false);

program.parse();

/** CLI 主流程。 */
async function main() {
    const options = program.opts();
    if (options.internalPrintInstallPlans) {
        printInternalInstallPlans();
        return;
    }

    p.intro('neuro-book deployment');
    const config = await readConfig(options);
    p.log.info(`部署目录：${config.deployDir}`);
    const mode = MODES[config.deployMode];

    if (!config.dryRun) {
        if (DOCKER_DEPLOY_MODES.includes(config.deployMode)) {
            await needCommand('git');
            await needCommand('docker');
            await needCommand('docker', ['compose', 'version']);
            if (config.deployMode === 'source') {
                await needCommand('bun');
            }
        }
    }

    await mode.preBuild(config);
    await ensureRepository(config);

    if (!config.dryRun) {
        await mkdir(resolve(config.deployDir, 'workspace'), {recursive: true});
        await mkdir(deployStateDir(config), {recursive: true});
    }

    const env = await writeDeployFiles(config, mode);
    await warnLegacyDeployFiles(config);

    await mode.build(config, env);
    await runCompose(config);
    await mode.postBuild(config);

    p.outro(`Done. Open http://localhost:${config.port}`);
}

main().catch((error) => {
    p.log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
