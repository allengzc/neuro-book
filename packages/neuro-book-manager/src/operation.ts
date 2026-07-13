import {copyFile, readdir, rm} from "node:fs/promises";
import {join, resolve} from "node:path";

import {rollbackProduct, rollbackReleaseSource} from "#manager/component";
import {ensureDirectory, pathExists, readJson, removePath, safeTarget, writeJsonAtomic} from "#manager/files";
import {writeInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import {installSourceDependencies} from "#manager/product";
import {runtimeExecutable, writeManagerWrapper} from "#manager/runtime";
import {parseOperationJournal} from "#manager/schema";
import type {InstallationManifest, OperationJournal, OperationPhase} from "#manager/types";

/** 创建持久化 operation journal。 */
export async function createOperation(input: Omit<OperationJournal, "schemaVersion" | "phase" | "createdAt" | "updatedAt">): Promise<OperationJournal> {
    const now = new Date().toISOString();
    const journal: OperationJournal = {...input, schemaVersion: 1, phase: "planned", createdAt: now, updatedAt: now};
    await writeOperation(journal);
    return journal;
}

/** 原子更新 operation phase 与恢复信息。 */
export async function updateOperation(journal: OperationJournal, phase: OperationPhase, patch: Partial<OperationJournal> = {}): Promise<OperationJournal> {
    const next = {...journal, ...patch, phase, updatedAt: new Date().toISOString()};
    await writeOperation(next);
    return next;
}

/** 标记操作成功提交。 */
export async function commitOperation(journal: OperationJournal): Promise<OperationJournal> {
    return updateOperation(journal, "committed", {outcome: "success"});
}

/** 在 mutating command 开始前恢复上次未完成操作。 */
export async function recoverInterruptedOperations(root: string): Promise<void> {
    const paths = installationPaths(root);
    if (!await pathExists(paths.operations)) return;
    for (const entry of await readdir(paths.operations, {withFileTypes: true})) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(paths.operations, entry.name);
        const value = await readJson(path);
        if (!value || typeof value !== "object") throw new Error(`Operation journal 损坏：${path}`);
        const journal = parseOperationJournal(value, path);
        if (journal.root !== resolve(root)) throw new Error(`Operation journal 的 Installation Root 不匹配：${path}`);
        if (journal.phase === "committed") continue;
        if (journal.git?.committed && journal.nextManifest) {
            if (journal.nextManifest.profile === "source-dev" && !journal.sourceDependenciesInstalled) {
                const runtime = journal.nextManifest.components.applicationRuntime;
                if (runtime.provider === "container") throw new Error("Source Dev 不能使用 container Application Runtime。" );
                await installSourceDependencies(root, runtimeExecutable(root, runtime));
                await updateOperation(journal, journal.phase, {sourceDependenciesInstalled: true});
            }
            await writeManagerWrapper(root, journal.nextManifest.components.manager, journal.nextManifest.components.managerRuntime);
            await writeInstallationManifest(paths.manifest, journal.nextManifest);
            await commitOperation(journal);
            continue;
        }
        await rollbackOperation(journal);
    }
}

/** 按 journal 恢复当前操作；不会 reset Git。 */
export async function rollbackOperation(journal: OperationJournal): Promise<void> {
    const root = journal.root;
    const previousProduct = journal.previousManifest?.components.product;
    const nextProduct = journal.nextManifest?.components.product;
    if (nextProduct && JSON.stringify(nextProduct) !== JSON.stringify(previousProduct)) {
        await rollbackProduct(root, join(journal.backupRoot, "product"));
    }
    const previousSource = journal.previousManifest?.components.source;
    const nextSource = journal.nextManifest?.components.source;
    if (nextSource?.provider === "release" && previousSource?.provider !== "git") {
        await rollbackReleaseSource(
            root,
            join(journal.backupRoot, "source"),
            previousSource?.provider === "release" ? previousSource.files : [],
            nextSource.files,
        );
    }
    if (journal.databaseBackup && journal.databasePath && await pathExists(journal.databaseBackup)) {
        await ensureDirectory(resolve(journal.databasePath, ".."));
        await rm(`${journal.databasePath}-wal`, {force: true});
        await rm(`${journal.databasePath}-shm`, {force: true});
        await copyFile(journal.databaseBackup, journal.databasePath);
    }
    if (journal.previousCompose && await pathExists(journal.previousCompose)) {
        await copyFile(journal.previousCompose, join(root, ".deploy", "docker-compose.generated.yml"));
    }
    for (const path of [...journal.createdPaths].reverse()) await removePath(safeTarget(root, path));
    if (journal.previousManifest) await writeInstallationManifest(join(root, ".deploy", "installation.json"), journal.previousManifest);
    await updateOperation(journal, "committed", {outcome: "rolled-back"});
}

async function writeOperation(journal: OperationJournal): Promise<void> {
    const path = join(journal.root, ".deploy", "operations", `${journal.id}.json`);
    await writeJsonAtomic(path, journal);
}
