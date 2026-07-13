import {readFile, readdir} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";

import {commandStatus} from "#manager/app-commands";
import {pathExists} from "#manager/files";
import {withInstallLock} from "#manager/lock";
import {writeInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import {installManagerExecutable, installManagedBun, writeManagerWrapper} from "#manager/runtime";
import {installManagedTool, type ManagedToolName} from "#manager/tools";
import type {InstallationManifest, ManagedGitToolComponent, ManagedToolComponent} from "#manager/types";
import {MANAGER_VERSION} from "#manager/version-info";

/** 安装或更新托管 Bun，同时刷新 Manager/Application Runtime 与稳定 wrapper。 */
export async function maintainRuntime(root: string, manifest: InstallationManifest, managerExecutable: string, version?: string): Promise<InstallationManifest> {
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        const runtime = await installManagedBun(root, version);
        const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable);
        const next: InstallationManifest = {
            ...manifest,
            managerVersion: MANAGER_VERSION,
            components: {
                ...manifest.components,
                manager,
                managerRuntime: runtime,
                applicationRuntime: manifest.components.applicationRuntime.provider === "container"
                    ? manifest.components.applicationRuntime
                    : runtime,
            },
            updatedAt: new Date().toISOString(),
        };
        await writeManagerWrapper(root, next.components.manager, runtime);
        await writeInstallationManifest(paths.manifest, next);
        return next;
    });
}

/** 安装或更新托管工具，并更新固定 tools 组件。 */
export async function maintainTool(root: string, manifest: InstallationManifest, tool: ManagedToolName, managerExecutable: string): Promise<InstallationManifest> {
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    return withInstallLock(join(paths.deploy, "install.lock"), async () => {
        let installed: ManagedToolComponent | ManagedGitToolComponent;
        if (tool === "git") installed = await installManagedTool(root, "git");
        else installed = await installManagedTool(root, "rg");
        const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable);
        const next: InstallationManifest = {
            ...manifest,
            managerVersion: MANAGER_VERSION,
            components: {
                ...manifest.components,
                manager,
                tools: {...manifest.components.tools, [tool]: installed},
            },
            updatedAt: new Date().toISOString(),
        };
        await writeManagerWrapper(root, manager, next.components.managerRuntime);
        await writeInstallationManifest(paths.manifest, next);
        return next;
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
        productReady: !manifest.components.product || manifest.components.product.provider === "container"
            ? true
            : await pathExists(join(root, ".output", "server", "index.mjs")),
        unfinishedOperations: operations,
        components: manifest.components,
    };
}

/** 逐项诊断 Manifest v2、真实组件路径、状态目录和外部命令。 */
export async function doctor(root: string, manifest: InstallationManifest): Promise<object> {
    const stateRoot = resolve(root, manifest.stateRoot);
    const checks: Array<{name: string; healthy: boolean; detail: string}> = [];
    const addPath = async (name: string, path: string): Promise<void> => {
        checks.push({name, healthy: await pathExists(path), detail: path});
    };
    await addPath("manager", resolve(root, manifest.components.manager.path));
    if (manifest.components.managerRuntime.provider === "managed") {
        await addPath("managerRuntime", resolve(root, manifest.components.managerRuntime.path));
    }
    if (manifest.components.applicationRuntime.provider === "managed") {
        await addPath("applicationRuntime", resolve(root, manifest.components.applicationRuntime.path));
    }
    if (manifest.components.product && manifest.components.product.provider !== "container") {
        await addPath("product", join(root, ".output", "server", "index.mjs"));
    }
    await addPath("stateRoot", stateRoot);
    await addPath("workspaceRoot", join(stateRoot, "workspace"));
    await addPath("bootConfig", join(stateRoot, "config.yaml"));
    await addPath("logs", join(stateRoot, "logs"));
    for (const [name, tool] of Object.entries(manifest.components.tools)) {
        if (tool?.provider === "managed") await addPath(`tool:${name}`, resolve(root, tool.path));
        if (name === "git" && tool?.provider === "managed" && "bashPath" in tool) {
            await addPath("tool:bash", resolve(root, tool.bashPath));
        }
    }
    const operations = await unfinishedOperations(join(root, ".deploy", "operations"));
    checks.push({name: "operationJournal", healthy: operations.length === 0, detail: operations.join(", ") || "none"});
    const commands = {
        bun: await commandStatus("bun"),
        git: await commandStatus("git"),
        rg: await commandStatus("rg"),
        docker: await commandStatus("docker"),
    };
    return {
        healthy: checks.every((check) => check.healthy),
        checks,
        paths: {root, stateRoot, workspace: join(stateRoot, "workspace"), bootConfig: join(stateRoot, "config.yaml")},
        commands,
        python: {
            python3: await commandStatus("python3"),
            python: await commandStatus("python"),
            note: "Manager v1 只检测 Python，不托管下载。",
        },
    };
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
