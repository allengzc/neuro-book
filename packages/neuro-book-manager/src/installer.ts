import {randomUUID} from "node:crypto";
import {copyFile, readFile, readdir, rename} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";

import {migrateApplication} from "#manager/app-commands";
import {
    stageReleaseProduct,
    stageReleaseSource,
    switchProduct,
    switchReleaseSource,
    type StagedProduct,
    type StagedReleaseSource,
} from "#manager/component";
import {ensureStateFiles} from "#manager/config";
import {buildSourceDockerImage, startDocker, stopDocker, verifyDockerApplication, writeDockerCompose} from "#manager/docker";
import {ensureDirectory, pathExists, removePath} from "#manager/files";
import {assertCleanWorktree, createStagedWorktree, materializeRepository, removeStagedWorktree, repositoryRevision} from "#manager/git";
import {assertNativeProductStopped, backupApplicationDatabase, statePort, verifyNativeProduct} from "#manager/health";
import {withInstallLock} from "#manager/lock";
import {readInstallationManifest, resolveReleaseManifest, writeInstallationManifest} from "#manager/manifest-store";
import {backupRuntimeWrappers, commitOperation, createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {assertManagerPlatform, currentProductPlatform} from "#manager/platform";
import {installationPaths} from "#manager/paths";
import {writePortableLaunchers} from "#manager/portable-launchers";
import {buildSourceProduct, installSourceDependencies} from "#manager/product";
import {profileDefinition} from "#manager/profiles";
import {commandAvailable, runCapture} from "#manager/process";
import {installManagerExecutable, resolveManagerRuntime, runtimeExecutable, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {activateManagedTools, installManagedTool, writeManagedToolWrappers} from "#manager/tools";
import type {
    ApplicationRuntimeComponent,
    InstallProfile,
    InstallationComponents,
    InstallationManifest,
    ManagerRuntimeComponent,
    OperationJournal,
    OperationPlan,
    ReleaseChannel,
    SourceComponent,
    SystemToolComponent,
    ToolComponents,
} from "#manager/types";
import {lt} from "semver";

import {MANAGER_VERSION} from "#manager/version-info";

export type InstallOptions = {
    root: string;
    profile: InstallProfile;
    channel: ReleaseChannel;
    version?: string;
    port: number;
    authEnabled: boolean;
    dryRun: boolean;
    managerExecutable: string;
};

export type AdoptSourceOptions = Omit<InstallOptions, "profile"> & {profile: "source-dev" | "source-product" | "source-docker"};

/** 构造安装计划，预检和物化 Source 均早于 State Root 创建。 */
export function installPlan(options: InstallOptions): OperationPlan {
    const definition = profileDefinition(options.profile);
    const steps = [
        `预检 Installation Root：${options.root}`,
        `准备 Manager Host Runtime：${options.profile === "windows-portable" ? "managed" : "system/stage0"}`,
        `准备 Source：${definition.source}`,
    ];
    if (definition.product !== "none") steps.push(`准备 Product：${definition.product}`);
    steps.push(`初始化 State Root：${options.profile === "windows-portable" ? "data" : "."}`);
    if (definition.docker) steps.push("生成 Docker Compose");
    steps.push("迁移与健康检查", "提交 installation.json 与稳定 wrapper");
    return {action: "install", root: options.root, profile: options.profile, steps};
}

/** 执行 Fresh Install；失败只回滚本次创建的 Manager-owned 路径。 */
export async function install(options: InstallOptions): Promise<InstallationManifest> {
    return installInternal(options, "fresh");
}

/** 接管已验证Git checkout；Source准备始终先在detached worktree完成。 */
export async function installSourceAdoption(options: AdoptSourceOptions): Promise<InstallationManifest> {
    return installInternal(options, "adopt");
}

async function installInternal(options: InstallOptions, mode: "fresh" | "adopt"): Promise<InstallationManifest> {
    if (options.dryRun) throw new Error("dry-run 应通过 installPlan 输出，不应调用 install。" );
    assertManagerPlatform();
    const portable = options.profile === "windows-portable";
    const paths = installationPaths(options.root, portable);
    await ensureDirectory(paths.root);
    await preflightInstallRoot(paths.root, options.profile, mode);
    await ensureDirectory(paths.deploy);
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        await recoverInterruptedOperations(paths.root);
        if (await readInstallationManifest(paths.manifest)) {
            throw new Error("Installation Root 已由 NeuroBook Manager 管理，请使用 neuro-book update。" );
        }
        const id = randomUUID();
        const staging = join(paths.staging, id);
        const backup = join(paths.backups, id);
        await ensureDirectory(staging);
        let journal = await createOperation({
            id,
            action: "install",
            root: paths.root,
            createdPaths: [relative(paths.root, staging)],
            backupRoot: backup,
            previousManifest: null,
            nextManifest: null,
        });
        const createdComponents: string[] = [];
        let stagedWorktree: string | null = null;
        try {
            if (mode === "adopt" && (options.profile === "source-product" || options.profile === "source-docker")) {
                await assertNativeProductStopped(paths.state);
                const database = await backupApplicationDatabase(paths.state, backup);
                if (database) journal = await updateOperation(journal, "planned", {databasePath: database.databasePath, databaseBackup: database.backupPath});
            }
            const result = await prepareInstallation(options, journal, staging, backup, createdComponents, mode);
            stagedWorktree = result.stagedWorktree;
            journal = result.journal;
            const wrapperBackup = await backupRuntimeWrappers(paths.root, backup);
            journal = await updateOperation(journal, journal.phase, {wrapperBackup, wrappersChanged: true});
            if (result.manifest.components.managerRuntime.provider === "managed") {
                await writeRuntimeWrapper(paths.root, result.manifest.components.managerRuntime);
            }
            await writeManagedToolWrappers(paths.root, result.manifest.components.tools);
            await writeManagerWrapper(paths.root, result.manifest.components.manager, result.manifest.components.managerRuntime);
            await writeInstallationManifest(paths.manifest, result.manifest);
            await commitOperation(journal);
            if (stagedWorktree) await removeStagedWorktree(paths.root, stagedWorktree);
            await removePath(staging);
            return result.manifest;
        } catch (error) {
            if (stagedWorktree || mode === "adopt") await removeStagedWorktree(paths.root, stagedWorktree ?? join(tmpdir(), `nbook-adopt-worktree-${id}`)).catch(() => undefined);
            await recoverInterruptedOperations(paths.root).catch(() => undefined);
            throw error;
        }
    });
}

async function prepareInstallation(
    options: InstallOptions,
    initialJournal: OperationJournal,
    staging: string,
    backup: string,
    createdComponents: string[],
    mode: "fresh" | "adopt",
): Promise<{manifest: InstallationManifest; journal: OperationJournal; stagedWorktree: string | null}> {
    const portable = options.profile === "windows-portable";
    const paths = installationPaths(options.root, portable);
    const definition = profileDefinition(options.profile);
    const managerRuntime = await resolveManagerRuntime(paths.root, portable, createdComponents);
    const manager = await installManagerExecutable(paths.root, MANAGER_VERSION, options.managerExecutable, createdComponents);
    let journal = await updateOperation(initialJournal, "planned", {
        createdPaths: [...new Set([...initialJournal.createdPaths, ...createdComponents])],
    });
    const preparedTools = await prepareTools(paths.root, options.profile, createdComponents, journal);
    const tools = preparedTools.tools;
    journal = preparedTools.journal;
    activateManagedTools(paths.root, tools);
    let appVersion = options.version?.replace(/^v/u, "") ?? "0.0.0";
    let sourceRevision = "";
    let source: SourceComponent;
    let stagedSource: StagedReleaseSource | null = null;
    let stagedProduct: StagedProduct | null = null;
    let stagedWorktree: string | null = null;
    const release = definition.source === "release" || definition.source === "container"
        ? await resolveReleaseManifest(options.channel, options.version)
        : null;
    if (release) {
        assertManagerVersion(release.minManagerVersion, paths.root, options.channel);
        appVersion = release.version;
        sourceRevision = release.sourceRevision;
    }
    if (definition.source === "git") {
        await materializeRepository(paths.root);
        sourceRevision = await repositoryRevision(paths.root);
        appVersion = await sourcePackageVersion(paths.root);
        source = {
            provider: "git",
            version: appVersion,
            revision: sourceRevision,
            path: ".",
            repository: "https://github.com/notnotype/neuro-book.git",
            branch: "master",
        };
        if (mode === "adopt") {
            stagedWorktree = join(tmpdir(), `nbook-adopt-worktree-${initialJournal.id}`);
            await createStagedWorktree(paths.root, stagedWorktree, sourceRevision);
        }
    } else if (definition.source === "release" && release) {
        stagedSource = await stageReleaseSource({
            root: paths.root,
            staging,
            asset: release.source,
            version: release.version,
            revision: release.sourceRevision,
        });
        source = stagedSource.component;
    } else if (release) {
        source = {provider: "container", version: release.version, revision: release.sourceRevision, path: "/app"};
    } else {
        throw new Error(`Profile ${options.profile} 无法解析 Source。`);
    }
    const applicationRuntime: ApplicationRuntimeComponent = definition.applicationRuntime === "container"
        ? {provider: "container", version: appVersion}
        : managerRuntime;
    const bun = applicationRuntime.provider === "container" ? null : runtimeExecutable(paths.root, applicationRuntime);
    let product: InstallationComponents["product"];
    if (options.profile === "source-dev") {
        if (!bun) throw new Error("Source Dev 缺少 Application Runtime。" );
        if (stagedWorktree) await installSourceDependencies(stagedWorktree, bun);
        const createsNodeModules = !await pathExists(join(paths.root, "node_modules"));
        await installSourceDependencies(paths.root, bun);
        if (createsNodeModules) journal = await updateOperation(journal, journal.phase, {createdPaths: [...journal.createdPaths, "node_modules"]});
    } else if (options.profile === "source-product") {
        if (!bun) throw new Error("Source Product 缺少 Application Runtime。" );
        await installSourceDependencies(stagedWorktree ?? paths.root, bun);
        stagedProduct = await buildSourceProduct({
            root: paths.root,
            sourceRoot: stagedWorktree ?? undefined,
            staging: join(staging, "build"),
            version: appVersion,
            revision: sourceRevision,
            stateRoot: paths.state,
            bun,
        });
        product = stagedProduct.component;
    } else if ((options.profile === "product-bun" || options.profile === "windows-portable") && release) {
        const platform = currentProductPlatform();
        const asset = release.products.find((item) => item.platform === platform);
        if (!asset) throw new Error(`Release ${release.version} 缺少 ${platform} Product。`);
        stagedProduct = await stageReleaseProduct({
            staging,
            asset,
            version: release.version,
            revision: release.sourceRevision,
        });
        product = stagedProduct.component;
    } else if (options.profile === "source-docker") {
        product = {provider: "container", version: appVersion, revision: sourceRevision, image: `neuro-book-source:${sourceRevision.slice(0, 12)}`};
        await buildSourceDockerImage(stagedWorktree ?? paths.root, product.image);
        journal = await updateOperation(journal, journal.phase, {dockerImageCreated: product.image});
    } else if (options.profile === "ghcr" && release) {
        product = {
            provider: "container",
            version: release.version,
            revision: release.sourceRevision,
            image: release.ghcr.ref,
            digest: release.ghcr.digest,
        };
    }
    journal = await updateOperation(journal, "staged", {
        createdPaths: [...new Set([...journal.createdPaths, ...createdComponents])],
    });
    const components: InstallationComponents = {source, product, manager, managerRuntime, applicationRuntime, tools};
    const now = new Date().toISOString();
    const manifest: InstallationManifest = {
        schemaVersion: 3,
        profile: options.profile,
        managerVersion: MANAGER_VERSION,
        appVersion,
        channel: options.channel,
        sourceRevision,
        stateRoot: portable ? "data" : ".",
        components,
        installedAt: now,
        updatedAt: now,
    };
    journal = await updateOperation(journal, "validated", {nextManifest: manifest});
    if (stagedSource) {
        await switchReleaseSource({root: paths.root, staged: stagedSource, backup: join(backup, "source"), previousFiles: []});
    }
    if (stagedProduct) await switchProduct(paths.root, stagedProduct.outputRoot, join(backup, "product"));
    if (options.profile === "source-docker" && product?.provider === "container"
        || options.profile === "ghcr" && product?.provider === "container" && product.digest) {
        const finalCompose = join(paths.deploy, "docker-compose.generated.yml");
        const composeCreated = !await pathExists(finalCompose);
        let previousCompose: string | undefined;
        if (!composeCreated) {
            previousCompose = join(backup, "docker-compose.generated.yml");
            await ensureDirectory(backup);
            await copyFile(finalCompose, previousCompose);
        }
        const stagedCompose = await writeDockerCompose({
            root: paths.root,
            stateRoot: paths.state,
            profile: options.profile,
            image: options.profile === "ghcr" ? `${product.image}@${product.digest}` : product.image,
            port: options.port,
            output: join(staging, "docker-compose.generated.yml"),
            layoutPath: finalCompose,
        });
        journal = await updateOperation(journal, journal.phase, {
            composeChanged: true,
            composeCreated,
            previousCompose,
        });
        if (!composeCreated) await stopDocker(paths.root, paths.state);
        await removePath(finalCompose);
        await rename(stagedCompose, finalCompose);
    }
    journal = await updateOperation(journal, "switched");
    const createdState = await ensureStateFiles(paths.state, options.port, options.authEnabled);
    journal = await updateOperation(journal, "switched", {
        createdPaths: [...journal.createdPaths, ...createdState.map((path) => relative(paths.root, path))],
    });
    await migrateApplication(paths.root, manifest);
    journal = await updateOperation(journal, "migrated");
    if (options.profile === "source-product" || options.profile === "product-bun" || options.profile === "windows-portable") {
        await assertNativeProductStopped(paths.state);
        if (!bun) throw new Error("原生 Product 健康检查缺少 Application Runtime。" );
        await verifyNativeProduct(paths.root, paths.state, bun, appVersion);
    } else if (options.profile === "ghcr" || options.profile === "source-docker") {
        await startDocker(paths.root, paths.state, options.profile);
        await verifyDockerApplication(await statePort(paths.state), appVersion);
    }
    if (portable) await writePortableLaunchers(paths.root);
    journal = await updateOperation(journal, "healthy");
    if (mode === "adopt") {
        await assertCleanWorktree(paths.root, [".deploy", ".runtime", ".output", "workspace", "config.yaml", ".env", "logs", "node_modules"]);
        if (await repositoryRevision(paths.root) !== sourceRevision) throw new Error("接管期间Git HEAD发生变化，停止提交Manifest。" );
    }
    return {manifest, journal, stagedWorktree};
}

async function preflightInstallRoot(root: string, profile: InstallProfile, mode: "fresh" | "adopt"): Promise<void> {
    const entries = await readdir(root);
    if (entries.length === 0) return;
    if (entries.includes(".git")) {
        if (mode !== "adopt") throw new Error("目录是已有Git checkout；请使用neuro-book adopt显式接管。" );
        if (!profile.startsWith("source-")) throw new Error("已有Git checkout只支持Source Profile接管。" );
        return;
    }
    const allowed = new Set([".deploy", ".runtime"]);
    if (profile === "windows-portable") allowed.add("data");
    const unknown = entries.filter((entry) => !allowed.has(entry));
    if (unknown.length > 0) throw new Error(`Installation Root 包含未知文件：${unknown.join(", ")}`);
}

async function prepareTools(
    root: string,
    profile: InstallProfile,
    createdPaths: string[],
    initialJournal: OperationJournal,
): Promise<{tools: ToolComponents; journal: OperationJournal}> {
    let journal = initialJournal;
    const record = async (): Promise<void> => {
        journal = await updateOperation(journal, journal.phase, {
            createdPaths: [...new Set([...journal.createdPaths, ...createdPaths])],
        });
    };
    if (profile === "ghcr" || profile === "source-docker") {
        const version = profile;
        return {tools: {
            rg: {provider: "container", version},
            git: {provider: "container", version},
            python: {provider: "container", version},
        }, journal};
    }
    if (profile === "windows-portable") {
        const rg = await installManagedTool(root, "rg", createdPaths);
        await record();
        const git = await installManagedTool(root, "git", createdPaths);
        await record();
        return {tools: {rg, git}, journal};
    }
    if (profile === "source-dev" || profile === "source-product") {
        if (await commandAvailable("git")) return {tools: {git: await systemTool("git")}, journal};
        if (process.platform === "win32") {
            const git = await installManagedTool(root, "git", createdPaths);
            await record();
            return {tools: {git}, journal};
        }
        throw new Error("缺少 Git。Linux 请先通过系统包管理器安装 Git。" );
    }
    return {tools: {}, journal};
}

async function systemTool(command: string): Promise<SystemToolComponent> {
    const version = (await runCapture(command, ["--version"])).split(/\r?\n/u)[0]?.trim() || "unknown";
    return {provider: "system", version, executable: command};
}

async function sourcePackageVersion(root: string): Promise<string> {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {version?: string};
    return packageJson.version ?? "0.0.0";
}

function assertManagerVersion(minimum: string, root: string, channel: ReleaseChannel): void {
    if (!lt(MANAGER_VERSION, minimum)) return;
    const tag = channel === "stable" ? "latest" : "canary";
    throw new Error(`当前 Manager ${MANAGER_VERSION} 低于 Release 要求 ${minimum}。请执行：\ncd ${JSON.stringify(resolve(root))}\nbunx --bun @notnotype/neuro-book-manager@${tag} update`);
}
