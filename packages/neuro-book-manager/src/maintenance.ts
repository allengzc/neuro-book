import {randomUUID} from "node:crypto";
import {readFile, readdir} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";

import {commandStatus} from "#manager/app-commands";
import {pathExists, sha256File} from "#manager/files";
import {statePort} from "#manager/health";
import {withInstallLock} from "#manager/lock";
import {writeInstallationManifest} from "#manager/manifest-store";
import {backupRuntimeWrappers, commitOperation, createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import {installManagerExecutable, installManagedBun, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {installManagedTool, type ManagedToolName, writeManagedToolWrappers} from "#manager/tools";
import type {InstallationManifest, ManagedGitToolComponent, ManagedToolComponent} from "#manager/types";
import {MANAGER_VERSION} from "#manager/version-info";

/** 安装或更新托管 Bun，同时刷新 Manager/Application Runtime 与稳定 wrapper。 */
export async function maintainRuntime(root: string, manifest: InstallationManifest, managerExecutable: string, version?: string): Promise<InstallationManifest> {
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        await recoverInterruptedOperations(root);
        const createdPaths: string[] = [];
        let journal = await createOperation({id: randomUUID(), action: "update", root, createdPaths, backupRoot: join(paths.backups, randomUUID()), previousManifest: manifest, nextManifest: null});
        try {
            const runtime = await installManagedBun(root, version, createdPaths);
            const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable, createdPaths);
            const next: InstallationManifest = {...manifest, managerVersion: MANAGER_VERSION, components: {...manifest.components, manager, managerRuntime: runtime, applicationRuntime: manifest.components.applicationRuntime.provider === "container" ? manifest.components.applicationRuntime : runtime}, updatedAt: new Date().toISOString()};
            journal = await updateOperation(journal, "validated", {createdPaths, nextManifest: next});
            const wrapperBackup = await backupRuntimeWrappers(root, journal.backupRoot);
            journal = await updateOperation(journal, "healthy", {wrapperBackup, wrappersChanged: true});
            await writeRuntimeWrapper(root, runtime);
            await writeManagedToolWrappers(root, next.components.tools);
            await writeManagerWrapper(root, manager, runtime);
            await writeInstallationManifest(paths.manifest, next);
            await commitOperation(journal);
            return next;
        } catch (error) {
            await recoverInterruptedOperations(root).catch(() => undefined);
            throw error;
        }
    });
}

/** 安装或更新托管工具，并更新固定 tools 组件。 */
export async function maintainTool(root: string, manifest: InstallationManifest, tool: ManagedToolName, managerExecutable: string): Promise<InstallationManifest> {
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
            throw new Error("GHCR/Source Docker 的应用工具由容器提供，不在宿主管理。");
        }
        await recoverInterruptedOperations(root);
        const createdPaths: string[] = [];
        let journal = await createOperation({id: randomUUID(), action: "update", root, createdPaths, backupRoot: join(paths.backups, randomUUID()), previousManifest: manifest, nextManifest: null});
        try {
            let installed: ManagedToolComponent | ManagedGitToolComponent;
            if (tool === "git") installed = await installManagedTool(root, "git", createdPaths);
            else installed = await installManagedTool(root, "rg", createdPaths);
            const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable, createdPaths);
            const next: InstallationManifest = {...manifest, managerVersion: MANAGER_VERSION, components: {...manifest.components, manager, tools: {...manifest.components.tools, [tool]: installed}}, updatedAt: new Date().toISOString()};
            journal = await updateOperation(journal, "validated", {createdPaths, nextManifest: next});
            const wrapperBackup = await backupRuntimeWrappers(root, journal.backupRoot);
            journal = await updateOperation(journal, "healthy", {wrapperBackup, wrappersChanged: true});
            if (next.components.managerRuntime.provider === "managed") await writeRuntimeWrapper(root, next.components.managerRuntime);
            await writeManagedToolWrappers(root, next.components.tools);
            await writeManagerWrapper(root, manager, next.components.managerRuntime);
            await writeInstallationManifest(paths.manifest, next);
            await commitOperation(journal);
            return next;
        } catch (error) {
            await recoverInterruptedOperations(root).catch(() => undefined);
            throw error;
        }
    });
}

/** 汇总安装状态，不把外部命令存在等同于安装健康。 */
export async function installationStatus(root: string, manifest: InstallationManifest): Promise<object> {
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    const operations = await unfinishedOperations(paths.operations);
    return {
        root,
        profile: manifest.profile,
        managerVersion: manifest.managerVersion,
        executingManagerVersion: MANAGER_VERSION,
        appVersion: manifest.appVersion,
        channel: manifest.channel,
        sourceRevision: manifest.sourceRevision,
        stateRoot: resolve(root, manifest.stateRoot),
        port: await statePort(resolve(root, manifest.stateRoot)),
        productReady: !manifest.components.product || manifest.components.product.provider === "container"
            ? true
            : await pathExists(join(root, ".output", "server", "index.mjs")),
        unfinishedOperations: operations,
        nextActions: operations.length > 0 ? ["运行 neuro-book doctor 查看恢复状态"] : ["运行 neuro-book start", "运行 neuro-book doctor"],
        components: manifest.components,
    };
}

/** 逐项诊断 Manifest v3、组件完整性、稳定 wrapper、状态目录和外部命令。 */
export async function doctor(root: string, manifest: InstallationManifest): Promise<object> {
    const stateRoot = resolve(root, manifest.stateRoot);
    type Check = {id: string; category: "manifest" | "manager" | "runtime" | "tool" | "source" | "product" | "state" | "service" | "operation"; status: "pass" | "warn" | "fail"; message: string; remediation?: string};
    const checks: Check[] = [];
    const addPath = async (id: string, category: Check["category"], path: string): Promise<void> => {
        const exists = await pathExists(path);
        checks.push({id, category, status: exists ? "pass" : "fail", message: exists ? `路径存在：${path}` : `路径缺失：${path}`, remediation: exists ? undefined : "重新安装或更新对应组件。"});
    };
    checks.push({id: "manifest.schema", category: "manifest", status: manifest.schemaVersion === 3 ? "pass" : "fail", message: `Installation Manifest schema v${manifest.schemaVersion}`});
    const managerPath = resolve(root, manifest.components.manager.path);
    await addChecksum("manager.bundle", "manager", managerPath, manifest.components.manager.bundleSha256, checks);
    if (manifest.components.managerRuntime.provider === "managed") {
        await addChecksum("runtime.manager", "runtime", resolve(root, manifest.components.managerRuntime.path), manifest.components.managerRuntime.executableSha256, checks);
    }
    if (manifest.components.applicationRuntime.provider === "managed") {
        await addChecksum("runtime.application", "runtime", resolve(root, manifest.components.applicationRuntime.path), manifest.components.applicationRuntime.executableSha256, checks);
    }
    if (manifest.components.product && manifest.components.product.provider !== "container") {
        await addPath("product.entry", "product", join(root, ".output", "server", "index.mjs"));
    }
    checks.push({id: "revision.product", category: "product", status: !manifest.components.product || manifest.components.product.revision === manifest.sourceRevision ? "pass" : "fail", message: "Source/Product revision 一致性"});
    await addPath("state.root", "state", stateRoot);
    await addPath("state.workspace", "state", join(stateRoot, "workspace"));
    await addPath("state.config", "state", join(stateRoot, "config.yaml"));
    await addPath("state.logs", "state", join(stateRoot, "logs"));
    for (const [name, tool] of Object.entries(manifest.components.tools)) {
        if (tool?.provider === "managed") {
            const checksum = name === "git" && "gitSha256" in tool ? tool.gitSha256 : "executableSha256" in tool ? tool.executableSha256 : "";
            await addChecksum(`tool.${name}`, "tool", resolve(root, tool.path), checksum, checks);
        }
        if (name === "git" && tool?.provider === "managed" && "bashPath" in tool) {
            await addChecksum("tool.bash", "tool", resolve(root, tool.bashPath), tool.bashSha256, checks);
        }
    }
    const wrapper = join(root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book");
    await addPath("manager.wrapper", "manager", wrapper);
    const operations = await unfinishedOperations(join(root, ".deploy", "operations"));
    checks.push({id: "operation.unfinished", category: "operation", status: operations.length === 0 ? "pass" : "fail", message: operations.length === 0 ? "没有未完成操作" : `存在未完成操作：${operations.join(", ")}`, remediation: operations.length === 0 ? undefined : "再次运行 mutating command 触发恢复，或检查对应 journal。"});
    const commands = {
        bun: await commandStatus("bun"),
        git: await commandStatus("git"),
        rg: await commandStatus("rg"),
        docker: await commandStatus("docker"),
    };
    return {
        healthy: checks.every((check) => check.status !== "fail"),
        checks,
        paths: {root, stateRoot, workspace: join(stateRoot, "workspace"), bootConfig: join(stateRoot, "config.yaml")},
        service: {port: await statePort(stateRoot), commands},
        components: manifest.components,
        operations,
        python: {
            python3: await commandStatus("python3"),
            python: await commandStatus("python"),
            note: "Manager v1 只检测 Python，不托管下载。",
        },
    };
}

async function addChecksum(id: string, category: "manager" | "runtime" | "tool", path: string, expected: string, checks: Array<{id: string; category: "manifest" | "manager" | "runtime" | "tool" | "source" | "product" | "state" | "service" | "operation"; status: "pass" | "warn" | "fail"; message: string; remediation?: string}>): Promise<void> {
    if (!await pathExists(path)) {
        checks.push({id, category, status: "fail", message: `组件缺失：${path}`, remediation: "重新安装或更新对应组件。"});
        return;
    }
    const actual = await sha256File(path);
    checks.push({id, category, status: actual === expected ? "pass" : "fail", message: actual === expected ? `checksum 通过：${path}` : `checksum 不匹配：${path}`, remediation: actual === expected ? undefined : "组件可能损坏，请重新安装或更新。"});
}

async function unfinishedOperations(root: string): Promise<string[]> {
    if (!await pathExists(root)) return [];
    const entries = await readdir(root, {withFileTypes: true});
    const result: string[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(root, entry.name);
        const content = await readFile(path, "utf8");
        if (!content.includes('"phase": "committed"')) result.push(join(dirname(path), entry.name));
    }
    return result;
}
