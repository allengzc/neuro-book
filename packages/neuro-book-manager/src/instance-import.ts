import {readdir, readFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {pathExists, sha256File} from "#manager/files";
import {inspectInstance} from "#manager/instance-discovery";
import {registerManagerInstance} from "#manager/manager-config";
import {installationPaths} from "#manager/paths";
import {runCapture} from "#manager/process";
import type {ImportInspection, InspectionIssue, ManagerInstance} from "#manager/types";

/** 对已有Manifest实例执行离线完整性门禁；不要求服务或容器正在运行。 */
export async function inspectImport(root: string): Promise<ImportInspection> {
    const inspection = await inspectInstance(root);
    const blockers = [...inspection.blockers];
    const warnings = [...inspection.warnings];
    if (inspection.kind !== "managed-installation" || !inspection.manifest) {
        blockers.push({code: "import.not-managed", message: "目录不是有效的Manifest v3实例。"});
        return {...inspection, blockers, warnings, importable: false};
    }
    const manifest = inspection.manifest;
    await verifyChecksum(resolve(inspection.root, manifest.components.manager.path), manifest.components.manager.bundleSha256, "manager.bundle", blockers);
    for (const [name, component] of [["manager", manifest.components.managerRuntime], ["application", manifest.components.applicationRuntime]] as const) {
        if (component.provider === "managed") {
            const path = resolve(inspection.root, component.path);
            await verifyChecksum(path, component.executableSha256, `runtime.${name}`, blockers);
            await verifyVersion(path, component.version, `runtime.${name}`, blockers);
        } else if (component.provider === "system") await verifyExecutable(component.executable, `runtime.${name}`, blockers);
    }
    for (const [name, tool] of Object.entries(manifest.components.tools)) {
        if (tool?.provider === "system") {
            const output = await runCapture(tool.executable, ["--version"]).then((value) => value.trim()).catch(() => "");
            if (!output) warnings.push({code: `tool.${name}.missing`, message: `可选system tool当前不可执行：${tool.executable}`});
            continue;
        }
        if (tool?.provider !== "managed") continue;
        const checksum = name === "git" && "gitSha256" in tool ? tool.gitSha256 : "executableSha256" in tool ? tool.executableSha256 : "";
        const toolPath = resolve(inspection.root, tool.path);
        await verifyChecksum(toolPath, checksum, `tool.${name}`, blockers);
        await verifyVersion(toolPath, tool.version, `tool.${name}`, blockers);
        if (name === "git" && "bashPath" in tool) {
            const bashPath = resolve(inspection.root, tool.bashPath);
            await verifyChecksum(bashPath, tool.bashSha256, "tool.bash", blockers);
            await verifyExecutable(bashPath, "tool.bash", blockers);
        }
    }
    const wrapper = join(inspection.root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book");
    if (!await pathExists(wrapper)) blockers.push({code: "wrapper.manager", message: `稳定Manager wrapper缺失：${wrapper}`, remediation: "使用当前Manager重新安装该实例。"});
    else {
        const wrapperContent = await readFile(wrapper, "utf8");
        if (!wrapperContent.includes(manifest.components.manager.path.replaceAll("/", process.platform === "win32" ? "\\" : "/"))) blockers.push({code: "wrapper.manager-target", message: "稳定Manager wrapper没有指向Manifest当前Manager。"});
        if (manifest.components.managerRuntime.provider === "managed" && !wrapperContent.includes(manifest.components.managerRuntime.path.replaceAll("/", process.platform === "win32" ? "\\" : "/"))) blockers.push({code: "wrapper.runtime-target", message: "稳定Manager wrapper没有指向Manifest当前Runtime。"});
    }
    if (manifest.components.product && manifest.components.product.provider !== "container" && !await pathExists(join(inspection.root, ".output", "server", "index.mjs"))) blockers.push({code: "product.entry", message: "原生Product入口缺失。"});
    if (manifest.components.product && manifest.components.product.revision !== manifest.sourceRevision) blockers.push({code: "product.revision", message: "Source/Product revision不一致。"});
    if ((manifest.profile === "ghcr" || manifest.profile === "source-docker") && !await pathExists(join(inspection.root, ".deploy", "docker-compose.generated.yml"))) blockers.push({code: "compose.missing", message: "Docker Profile缺少generated Compose。"});
    if (!inspection.state.configExists) blockers.push({code: "state.config", message: "State Root缺少config.yaml。"});
    if (!inspection.state.workspaceExists) blockers.push({code: "state.workspace", message: "State Root缺少workspace目录。"});
    const unfinished = await unfinishedOperations(installationPaths(inspection.root).operations);
    if (unfinished.length) blockers.push({code: "operation.unfinished", message: `存在未完成Operation：${unfinished.join(", ")}`});
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") warnings.push({code: "service.offline-unchecked", message: "导入不要求容器正在运行；导入后请执行start和doctor。"});
    else warnings.push({code: "service.offline-unchecked", message: "导入不要求服务正在运行；导入后请执行start和doctor。"});
    return {...inspection, blockers, warnings, importable: blockers.length === 0};
}

/** 通过离线门禁后只写用户级索引。 */
export async function importInstallation(options: {root: string; name?: string; makeDefault?: boolean; acceptWarnings?: boolean; configPath?: string}): Promise<{instance: ManagerInstance; inspection: ImportInspection}> {
    const inspection = await inspectImport(options.root);
    if (!inspection.importable) throw new Error(inspection.blockers.map((issue) => issue.message).join("\n"));
    if (inspection.warnings.length && !options.acceptWarnings) throw new Error(`导入检查包含warning；确认后使用--yes：\n${inspection.warnings.map((issue) => issue.message).join("\n")}`);
    const instance = await registerManagerInstance({root: inspection.root, name: options.name, makeDefault: options.makeDefault, configPath: options.configPath});
    return {instance, inspection};
}

async function verifyChecksum(path: string, expected: string, code: string, blockers: InspectionIssue[]): Promise<void> {
    if (!await pathExists(path)) { blockers.push({code, message: `组件缺失：${path}`}); return; }
    if (await sha256File(path) !== expected) blockers.push({code, message: `组件checksum不匹配：${path}`});
}

async function verifyVersion(path: string, expected: string, code: string, blockers: InspectionIssue[]): Promise<void> {
    const output = await runCapture(path, ["--version"]).then((value) => value.trim()).catch(() => "");
    if (!output.includes(expected)) blockers.push({code: `${code}.version`, message: `组件版本不匹配：${path}，期望${expected}，实际${output || "无法执行"}`});
}

async function verifyExecutable(path: string, code: string, blockers: InspectionIssue[]): Promise<void> {
    const output = await runCapture(path, ["--version"]).then((value) => value.trim()).catch(() => "");
    if (!output) blockers.push({code: `${code}.version`, message: `组件无法执行版本检查：${path}`});
}

async function unfinishedOperations(root: string): Promise<string[]> {
    if (!await pathExists(root)) return [];
    const result: string[] = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const content = await readFile(join(root, entry.name), "utf8");
        if (!content.includes('"phase": "committed"')) result.push(entry.name);
    }
    return result;
}
