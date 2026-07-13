import {randomUUID} from "node:crypto";
import {copyFile, readFile, rename} from "node:fs/promises";
import {join, resolve} from "node:path";

import {migrateApplication} from "#manager/app-commands";
import {
    stageReleaseProduct,
    stageReleaseSource,
    switchProduct,
    switchReleaseSource,
    type StagedProduct,
    type StagedReleaseSource,
} from "#manager/component";
import {buildSourceDockerImage, startDocker, stopDocker, verifyDockerApplication, writeDockerCompose} from "#manager/docker";
import {ensureDirectory, pathExists, removePath} from "#manager/files";
import {assertNativeProductStopped, backupApplicationDatabase, statePort, verifyNativeProduct} from "#manager/health";
import {
    commitFastForward,
    createStagedWorktree,
    fetchUpdateTarget,
    removeStagedWorktree,
    type GitUpdateTarget,
} from "#manager/git";
import {withInstallLock} from "#manager/lock";
import {resolveReleaseManifest, writeInstallationManifest} from "#manager/manifest-store";
import {backupRuntimeWrappers, commitOperation, createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {currentProductPlatform} from "#manager/platform";
import {installationPaths} from "#manager/paths";
import {buildSourceProduct, installSourceDependencies} from "#manager/product";
import {installManagerExecutable, installManagedBun, runtimeExecutable, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {installManagedTool, writeManagedToolWrappers} from "#manager/tools";
import type {
    ComponentId,
    InstallationManifest,
    ProductComponent,
    ReleaseChannel,
    SourceComponent,
    ToolComponents,
} from "#manager/types";
import {lt} from "semver";

import {MANAGER_VERSION} from "#manager/version-info";

export type UpdateOptions = {
    root: string;
    manifest: InstallationManifest;
    components?: ComponentId[];
    version?: string;
    channel?: ReleaseChannel;
    managerExecutable: string;
};

/** 使用统一 journal 更新应用组件，Git commit point 永远位于健康检查之后。 */
export async function updateInstallation(options: UpdateOptions): Promise<InstallationManifest> {
    const paths = installationPaths(options.root, options.manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        await recoverInterruptedOperations(paths.root);
        const selected = new Set(options.components ?? defaultComponents(options.manifest.profile));
        const id = randomUUID();
        const staging = join(paths.staging, id);
        const backup = join(paths.backups, id);
        await ensureDirectory(staging);
        let journal = await createOperation({
            id,
            action: "update",
            root: paths.root,
            createdPaths: [],
            backupRoot: backup,
            previousManifest: options.manifest,
            nextManifest: null,
        });
        let stagedWorktree: string | null = null;
        let gitTarget: GitUpdateTarget | null = null;
        const createdComponents: string[] = [];
        try {
            const nativeProduct = isNativeProduct(options.manifest.profile) && selected.has("product");
            if (nativeProduct) {
                const stateRoot = resolve(paths.root, options.manifest.stateRoot);
                await assertNativeProductStopped(stateRoot);
                const database = await backupApplicationDatabase(stateRoot, backup);
                if (database) {
                    journal = await updateOperation(journal, "planned", {
                        databasePath: database.databasePath,
                        databaseBackup: database.backupPath,
                    });
                }
            }
            const result = await prepareUpdate(options, selected, staging, backup, createdComponents, journal);
            stagedWorktree = result.stagedWorktree;
            gitTarget = result.gitTarget;
            journal = await updateOperation(result.journal, "validated", {
                nextManifest: result.manifest,
                git: gitTarget ? {
                    previousRevision: gitTarget.previousRevision,
                    targetRevision: gitTarget.targetRevision,
                    committed: false,
                } : undefined,
            });
            if (result.stagedCompose) {
                const compose = join(paths.deploy, "docker-compose.generated.yml");
                const previousCompose = join(backup, "docker-compose.generated.yml");
                if (!await pathExists(compose)) throw new Error("Docker Profile缺少当前generated Compose，无法事务更新。" );
                await ensureDirectory(backup);
                await copyFile(compose, previousCompose);
                journal = await updateOperation(journal, "validated", {previousCompose, composeChanged: true, composeCreated: false});
                const stateRoot = resolve(paths.root, options.manifest.stateRoot);
                await stopDocker(paths.root, stateRoot);
                const database = await backupApplicationDatabase(stateRoot, backup);
                if (database) {
                    journal = await updateOperation(journal, "validated", {
                        databasePath: database.databasePath,
                        databaseBackup: database.backupPath,
                    });
                }
                await removePath(compose);
                await rename(result.stagedCompose, compose);
            }
            if (result.stagedSource) {
                const previous = options.manifest.components.source;
                await switchReleaseSource({
                    root: paths.root,
                    staged: result.stagedSource,
                    backup: join(backup, "source"),
                    previousFiles: previous.provider === "release" ? previous.files : [],
                });
            }
            if (result.stagedProduct) {
                await switchProduct(paths.root, result.stagedProduct.outputRoot, join(backup, "product"));
            }
            journal = await updateOperation(journal, "switched");
            await migrateApplication(paths.root, result.manifest);
            journal = await updateOperation(journal, "migrated");
            if (nativeProduct) {
                const runtime = result.manifest.components.applicationRuntime;
                if (runtime.provider === "container") throw new Error("原生 Product 健康检查不能使用 container Runtime。" );
                await verifyNativeProduct(
                    paths.root,
                    resolve(paths.root, result.manifest.stateRoot),
                    runtimeExecutable(paths.root, runtime),
                    result.manifest.appVersion,
                );
            } else if (result.manifest.profile === "ghcr" || result.manifest.profile === "source-docker") {
                const stateRoot = resolve(paths.root, result.manifest.stateRoot);
                await startDocker(paths.root, stateRoot, result.manifest.profile);
                await verifyDockerApplication(await statePort(stateRoot), result.manifest.appVersion);
            }
            journal = await updateOperation(journal, "healthy");
            if (gitTarget) {
                await commitFastForward(paths.root, gitTarget);
                journal = await updateOperation(journal, "healthy", {
                    git: {...journal.git!, committed: true},
                });
                if (options.manifest.profile === "source-dev") {
                    const runtime = result.manifest.components.applicationRuntime;
                    if (runtime.provider === "container") throw new Error("Source Dev 不能使用 container Application Runtime。" );
                    try {
                        await installSourceDependencies(paths.root, runtimeExecutable(paths.root, runtime));
                        journal = await updateOperation(journal, "healthy", {sourceDependenciesInstalled: true});
                    } catch (error) {
                        throw new Error(`Source Dev 已 fast-forward 到 ${gitTarget.targetRevision}，但依赖安装失败。Operation journal 已保留；修复网络或 lockfile 问题后重新执行 update。\n${String(error)}`);
                    }
                }
            }
            const wrapperBackup = await backupRuntimeWrappers(paths.root, backup);
            journal = await updateOperation(journal, "healthy", {createdPaths: createdComponents, wrapperBackup, wrappersChanged: true});
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
            if (stagedWorktree) await removeStagedWorktree(paths.root, stagedWorktree).catch(() => undefined);
            await recoverInterruptedOperations(paths.root).catch(() => undefined);
            throw error;
        }
    });
}

function isNativeProduct(profile: InstallationManifest["profile"]): boolean {
    return profile === "source-product" || profile === "product-bun" || profile === "windows-portable";
}

async function prepareUpdate(
    options: UpdateOptions,
    selected: Set<ComponentId>,
    staging: string,
    backup: string,
    createdComponents: string[],
    initialJournal: Awaited<ReturnType<typeof createOperation>>,
): Promise<{
    manifest: InstallationManifest;
    stagedWorktree: string | null;
    gitTarget: GitUpdateTarget | null;
    stagedSource: StagedReleaseSource | null;
    stagedProduct: StagedProduct | null;
    stagedCompose: string | null;
    journal: Awaited<ReturnType<typeof createOperation>>;
}> {
    const profile = options.manifest.profile;
    const paths = installationPaths(options.root, profile === "windows-portable");
    const releaseProfile = profile === "product-bun" || profile === "windows-portable" || profile === "ghcr";
    const channel = options.channel ?? options.manifest.channel;
    const release = releaseProfile ? await resolveReleaseManifest(channel, options.version) : null;
    if (release && lt(MANAGER_VERSION, release.minManagerVersion)) {
        const tag = channel === "stable" ? "latest" : "canary";
        throw new Error(`Manager ${MANAGER_VERSION} 低于 Release 要求 ${release.minManagerVersion}。请执行：\nbunx --bun @notnotype/neuro-book-manager@${tag} update`);
    }
    if (release && release.sourceRevision !== options.manifest.sourceRevision && profile !== "ghcr"
        && (!selected.has("source") || !selected.has("product"))) {
        throw new Error("Release Source 与 Product 必须同版本更新；请同时选择 source 和 product。" );
    }
    let source: SourceComponent = options.manifest.components.source;
    let product: ProductComponent | undefined = options.manifest.components.product;
    let appVersion = options.manifest.appVersion;
    let sourceRevision = options.manifest.sourceRevision;
    let gitTarget: GitUpdateTarget | null = null;
    let stagedWorktree: string | null = null;
    let stagedSource: StagedReleaseSource | null = null;
    let stagedProduct: StagedProduct | null = null;
    let stagedCompose: string | null = null;
    let journal = initialJournal;
    const bunRuntime = options.manifest.components.applicationRuntime;
    const bun = bunRuntime.provider === "container" ? null : runtimeExecutable(paths.root, bunRuntime);

    if ((profile === "source-product" || profile === "source-docker") && (selected.has("source") || selected.has("product"))) {
        gitTarget = await fetchUpdateTarget(paths.root);
        sourceRevision = gitTarget.targetRevision;
        stagedWorktree = join(staging, "source-worktree");
        await createStagedWorktree(paths.root, stagedWorktree, gitTarget.targetRevision);
        appVersion = await sourceVersion(stagedWorktree);
        source = {...source, version: appVersion, revision: sourceRevision};
        if (profile === "source-product" && selected.has("product")) {
            if (!bun) throw new Error("Source Product 缺少 Application Runtime。" );
            await installSourceDependencies(stagedWorktree, bun);
            stagedProduct = await buildSourceProduct({
                root: paths.root,
                sourceRoot: stagedWorktree,
                staging: join(staging, "build"),
                version: appVersion,
                revision: sourceRevision,
                stateRoot: resolve(paths.root, options.manifest.stateRoot),
                bun,
            });
            product = stagedProduct.component;
        } else if (profile === "source-docker") {
            product = {provider: "container", version: appVersion, revision: sourceRevision, image: `neuro-book-source:${sourceRevision.slice(0, 12)}`};
            await buildSourceDockerImage(stagedWorktree, product.image);
            journal = await updateOperation(journal, journal.phase, {dockerImageCreated: product.image});
        }
    } else if (profile === "source-dev" && selected.has("source")) {
        gitTarget = await fetchUpdateTarget(paths.root);
        sourceRevision = gitTarget.targetRevision;
        const sourceWorktree = join(staging, "source-worktree");
        await createStagedWorktree(paths.root, sourceWorktree, sourceRevision);
        stagedWorktree = sourceWorktree;
        appVersion = await sourceVersion(sourceWorktree);
        source = {...source, version: appVersion, revision: sourceRevision};
    }

    if (release) {
        appVersion = release.version;
        sourceRevision = release.sourceRevision;
        if (profile === "ghcr") {
            source = {provider: "container", version: release.version, revision: release.sourceRevision, path: "/app"};
            product = {provider: "container", version: release.version, revision: release.sourceRevision, image: release.ghcr.ref, digest: release.ghcr.digest};
        } else {
            if (selected.has("source") && source.provider === "release") {
                stagedSource = await stageReleaseSource({
                    root: paths.root,
                    staging,
                    asset: release.source,
                    version: release.version,
                    revision: release.sourceRevision,
                    previous: source,
                });
                source = stagedSource.component;
            }
            if (selected.has("product")) {
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
            }
        }
    }

    let managerRuntime = options.manifest.components.managerRuntime;
    let applicationRuntime = options.manifest.components.applicationRuntime;
    if (selected.has("runtime") && managerRuntime.provider === "managed") {
        managerRuntime = await installManagedBun(paths.root, undefined, createdComponents);
        if (applicationRuntime.provider !== "container") applicationRuntime = managerRuntime;
    }
    let tools: ToolComponents = options.manifest.components.tools;
    if (selected.has("tools")) {
        if (tools.rg?.provider === "managed") tools = {...tools, rg: await installManagedTool(paths.root, "rg", createdComponents)};
        if (tools.git?.provider === "managed") tools = {...tools, git: await installManagedTool(paths.root, "git", createdComponents)};
    }
    const manager = await installManagerExecutable(paths.root, MANAGER_VERSION, options.managerExecutable, createdComponents);
    const next: InstallationManifest = {
        ...options.manifest,
        managerVersion: MANAGER_VERSION,
        appVersion,
        channel,
        sourceRevision,
        components: {source, product, manager, managerRuntime, applicationRuntime, tools},
        updatedAt: new Date().toISOString(),
    };
    if (profile === "ghcr" && product?.provider === "container" && product.digest) {
        const finalCompose = join(paths.deploy, "docker-compose.generated.yml");
        stagedCompose = await writeDockerCompose({
            root: paths.root,
            stateRoot: resolve(paths.root, options.manifest.stateRoot),
            profile: "ghcr",
            image: `${product.image}@${product.digest}`,
            port: await statePort(resolve(paths.root, options.manifest.stateRoot)),
            output: join(staging, "docker-compose.generated.yml"),
            layoutPath: finalCompose,
        });
    } else if (profile === "source-docker" && product?.provider === "container") {
        const finalCompose = join(paths.deploy, "docker-compose.generated.yml");
        stagedCompose = await writeDockerCompose({
            root: paths.root,
            stateRoot: resolve(paths.root, options.manifest.stateRoot),
            profile: "source-docker",
            image: product.image,
            port: await statePort(resolve(paths.root, options.manifest.stateRoot)),
            output: join(staging, "docker-compose.generated.yml"),
            layoutPath: finalCompose,
        });
    }
    return {manifest: next, stagedWorktree, gitTarget, stagedSource, stagedProduct, stagedCompose, journal};
}

function defaultComponents(profile: InstallationManifest["profile"]): ComponentId[] {
    if (profile === "source-dev") return ["source"];
    if (profile === "ghcr") return ["source", "product"];
    return ["source", "product"];
}

async function sourceVersion(root: string): Promise<string> {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {version?: string};
    return packageJson.version ?? "0.0.0";
}
