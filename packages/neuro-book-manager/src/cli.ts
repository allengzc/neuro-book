import {homedir} from "node:os";
import {basename, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import * as p from "@clack/prompts";
import {Command} from "commander";

import {createAdmin, startApplication} from "#manager/app-commands";
import {runInstallGuide, recommendedProfile} from "#manager/install-guide";
import {install, installPlan} from "#manager/installer";
import {
    findManagerInstance,
    forgetManagerInstance,
    managerConfigPath,
    readManagerConfig,
    registerManagerInstance,
    setDefaultManagerInstance,
} from "#manager/manager-config";
import {doctor, installationStatus, maintainRuntime, maintainTool} from "#manager/maintenance";
import {readInstallationManifest} from "#manager/manifest-store";
import {discoverInstallationRoot, installationPaths} from "#manager/paths";
import {parseProfile, profileNames} from "#manager/profiles";
import {runManagerTui} from "#manager/tui";
import type {ComponentId, InstallProfile, InstallationManifest, ReleaseChannel} from "#manager/types";
import {updateInstallation} from "#manager/updater";
import {MANAGER_VERSION} from "#manager/version-info";

const managerExecutable = fileURLToPath(import.meta.url);
const program = new Command()
    .name("neuro-book")
    .version(MANAGER_VERSION)
    .description("NeuroBook installation, runtime, toolchain and instance manager.")
    .option("--root <path>", "指定命令操作的 NeuroBook Installation Root。")
    .option("--instance <name-or-id>", "指定用户级配置中注册的实例。")
    .showHelpAfterError();

program.command("install")
    .description("安装或接管 NeuroBook Installation Root；交互终端默认进入完整引导。")
    .option("--profile <profile>", `安装 Profile：${profileNames().join(", ")}`)
    .option("--dir <path>", "Installation Root。")
    .option("--version <version>", "指定 NeuroBook Release 版本。")
    .option("--channel <channel>", "Release channel：stable 或 canary。", parseChannel)
    .option("--port <port>", "Web 端口。", parsePort)
    .option("--auth <mode>", "密码保护：enabled 或 disabled。Windows Portable 默认 disabled，其他 Profile 默认 enabled。", parseAuth)
    .option("--yes", "使用默认值，不进入交互。", false)
    .option("--dry-run", "只打印操作计划。", false)
    .action(async (options: {
        profile?: string;
        dir?: string;
        version?: string;
        channel?: ReleaseChannel;
        port?: number;
        auth?: boolean;
        yes: boolean;
        dryRun: boolean;
    }) => {
        if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
            await runInstallGuide({
                profile: options.profile ? parseProfile(options.profile) : undefined,
                root: options.dir,
                version: options.version,
                channel: options.channel,
                port: options.port,
                authEnabled: options.auth,
                dryRun: options.dryRun,
                managerExecutable,
            });
            return;
        }
        const managerConfig = await readManagerConfig();
        const profile = options.profile ? parseProfile(options.profile) : recommendedProfile();
        const input = {
            root: resolve(options.dir ?? managerConfig.preferences.installDirectory ?? join(homedir(), "neuro-book")),
            profile,
            channel: options.channel ?? managerConfig.preferences.channel,
            version: options.version,
            port: options.port ?? 3000,
            authEnabled: options.auth ?? profile !== "windows-portable",
            dryRun: options.dryRun,
            managerExecutable,
        };
        if (input.dryRun) {
            printJson(installPlan(input));
            return;
        }
        p.intro("NeuroBook Manager");
        const manifest = await install(input);
        await registerManagerInstance({
            root: input.root,
            name: basename(input.root) || "NeuroBook",
            makeDefault: true,
            preferences: {channel: input.channel, installDirectory: input.root},
        });
        p.outro(`安装完成：${input.root}\nProfile: ${manifest.profile}\nVersion: ${manifest.appVersion}\n管理实例：neuro-book manage`);
    });

program.command("manage")
    .description("打开 blessed TUI，管理所有已注册 NeuroBook 实例。")
    .action(async () => runManagerTui(managerExecutable));

const instances = program.command("instances").description("管理用户级实例索引。配置默认位于 ~/.neuro-book-manager/config.json。");
instances.command("list")
    .description("列出已注册实例。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const config = await readManagerConfig();
        if (options.json) {
            printJson(config);
            return;
        }
        console.log(`配置：${managerConfigPath()}`);
        if (!config.instances.length) {
            console.log("尚未注册实例。运行 neuro-book 或 neuro-book install 开始安装。" );
            return;
        }
        for (const instance of config.instances) {
            const marker = instance.id === config.defaultInstanceId ? "*" : " ";
            console.log(`${marker} ${instance.name}\n  ${instance.root}\n  id: ${instance.id}`);
        }
    });
instances.command("add")
    .description("注册已有 Installation Root，不修改实例文件。")
    .argument("<path>")
    .option("--name <name>", "实例显示名称。")
    .option("--default", "设为默认实例。", false)
    .action(async (path: string, options: {name?: string; default: boolean}) => {
        const instance = await registerManagerInstance({root: path, name: options.name, makeDefault: options.default});
        console.log(`已注册：${instance.name} (${instance.root})`);
    });
instances.command("forget")
    .description("从用户级索引忘记实例，不删除 Installation Root。")
    .argument("<name-or-id>")
    .action(async (reference: string) => {
        await forgetManagerInstance(reference);
        console.log(`已忘记实例：${reference}`);
    });
instances.command("default")
    .description("设置默认实例。")
    .argument("<name-or-id>")
    .action(async (reference: string) => {
        const instance = await setDefaultManagerInstance(reference);
        console.log(`默认实例：${instance.name} (${instance.root})`);
    });
instances.command("config")
    .description("显示用户级 Manager 配置路径。")
    .action(() => console.log(managerConfigPath()));

program.command("update")
    .description("事务更新当前或指定安装。")
    .option("--component <components...>", "更新组件：source product runtime tools。", collectComponent, [])
    .option("--version <version>", "指定 NeuroBook Release 版本。")
    .option("--channel <channel>", "切换 Release channel。", parseChannel)
    .option("--dry-run", "只打印更新目标。", false)
    .action(async (options: {component?: ComponentId[]; version?: string; channel?: ReleaseChannel; dryRun: boolean}) => {
        const {root, manifest} = await currentInstallation();
        if (options.dryRun) {
            printJson({action: "update", root, profile: manifest.profile, components: options.component ?? "profile-default", version: options.version ?? "latest"});
            return;
        }
        const next = await updateInstallation({
            root,
            manifest,
            components: options.component?.length ? options.component : undefined,
            version: options.version,
            channel: options.channel,
            managerExecutable,
        });
        p.outro(`更新完成：${next.appVersion}`);
    });

program.command("start")
    .description("启动当前或指定安装。")
    .action(async () => {
        const {root, manifest} = await currentInstallation();
        await startApplication(root, manifest);
    });

program.command("status")
    .description("查看安装状态。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const status = await installationStatus(root, manifest);
        options.json ? printJson(status) : printObject(status);
    });

program.command("doctor")
    .description("诊断安装目录、Product 与外部命令。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const result = await doctor(root, manifest);
        options.json ? printJson(result) : printObject(result);
    });

const runtime = program.command("runtime").description("管理 Bun Runtime。");
runtime.command("list").action(async () => {
    const {manifest} = await currentInstallation();
    printJson({
        managerRuntime: manifest.components.managerRuntime,
        applicationRuntime: manifest.components.applicationRuntime,
    });
});
runtime.command("install")
    .argument("<runtime>", "当前只支持 bun。")
    .option("--version <version>")
    .action(async (runtimeName: string, options: {version?: string}) => {
        if (runtimeName !== "bun") throw new Error(`不支持的 Runtime：${runtimeName}`);
        const {root, manifest} = await currentInstallation();
        await maintainRuntime(root, manifest, managerExecutable, options.version);
    });
runtime.command("update")
    .argument("<runtime>", "当前只支持 bun。")
    .action(async (runtimeName: string) => {
        if (runtimeName !== "bun") throw new Error(`不支持的 Runtime：${runtimeName}`);
        const {root, manifest} = await currentInstallation();
        await maintainRuntime(root, manifest, managerExecutable);
    });

const tools = program.command("tools").description("管理 Agent 工具链。");
tools.command("list").action(async () => {
    const {manifest} = await currentInstallation();
    printJson(manifest.components.tools);
});
tools.command("install")
    .argument("<tool>", "rg 或 git。")
    .action(async (tool: string) => {
        assertTool(tool);
        const {root, manifest} = await currentInstallation();
        await maintainTool(root, manifest, tool, managerExecutable);
    });
tools.command("update")
    .argument("[tool]", "rg 或 git；省略时更新全部 managed tools。")
    .action(async (tool?: string) => {
        const {root, manifest} = await currentInstallation();
        if (tool) {
            assertTool(tool);
            await maintainTool(root, manifest, tool, managerExecutable);
            return;
        }
        let next = await maintainTool(root, manifest, "rg", managerExecutable);
        if (process.platform === "win32") next = await maintainTool(root, next, "git", managerExecutable);
    });
tools.command("path")
    .argument("<tool>", "rg 或 git。")
    .action(async (tool: string) => {
        assertTool(tool);
        const {root, manifest} = await currentInstallation();
        const component = manifest.components.tools[tool];
        if (!component || component.provider !== "managed") throw new Error(`${tool} 不是 managed tool。`);
        console.log(resolve(root, component.path));
    });

const admin = program.command("admin").description("管理员操作。");
admin.command("create")
    .argument("[username]")
    .action(async (username?: string) => {
        const {root, manifest} = await currentInstallation();
        await createAdmin(root, manifest, username);
    });

await main();

/** 处理无参数向导与 Commander 命令入口。 */
async function main(): Promise<void> {
    try {
        if (process.argv.slice(2).length === 0) {
            await runInstallGuide({managerExecutable});
            return;
        }
        await program.parseAsync(process.argv);
    } catch (error) {
        p.log.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

/** 按显式 root、显式实例、当前目录、默认实例的顺序定位安装。 */
async function currentInstallation(): Promise<{root: string; manifest: InstallationManifest}> {
    const selection = program.opts<{root?: string; instance?: string}>();
    if (selection.root && selection.instance) throw new Error("--root 与 --instance 不能同时使用。" );
    if (selection.root) return readInstallation(resolve(selection.root));
    if (selection.instance) {
        const config = await readManagerConfig();
        const instance = findManagerInstance(config, selection.instance);
        if (!instance) throw new Error(`找不到已注册实例：${selection.instance}`);
        return readInstallation(instance.root);
    }

    const discoveredRoot = discoverInstallationRoot();
    const localManifest = await readInstallationManifest(installationPaths(discoveredRoot).manifest);
    if (localManifest) return {root: discoveredRoot, manifest: localManifest};

    const config = await readManagerConfig();
    const defaultInstance = config.defaultInstanceId ? findManagerInstance(config, config.defaultInstanceId) : null;
    if (defaultInstance) return readInstallation(defaultInstance.root);
    throw new Error(`当前目录不属于 NeuroBook 实例，且没有默认实例。运行 neuro-book manage 或 neuro-book instances add <path>。`);
}

/** 读取指定 Installation Root 的严格 manifest。 */
async function readInstallation(root: string): Promise<{root: string; manifest: InstallationManifest}> {
    const absoluteRoot = resolve(root);
    const manifest = await readInstallationManifest(installationPaths(absoluteRoot).manifest);
    if (!manifest) throw new Error(`目录不属于 NeuroBook Manager 安装：${absoluteRoot}`);
    return {root: absoluteRoot, manifest};
}

/** 解析 Release channel 参数。 */
function parseChannel(value: string): ReleaseChannel {
    if (value === "stable" || value === "canary") return value;
    throw new Error(`channel 只支持 stable 或 canary：${value}`);
}

/** 解析并限制 Web 端口。 */
function parsePort(value: string): number {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`端口必须是 1-65535：${value}`);
    return port;
}

/** 解析鉴权开关参数。 */
function parseAuth(value: string): boolean {
    if (value === "enabled") return true;
    if (value === "disabled") return false;
    throw new Error(`auth 只支持 enabled 或 disabled：${value}`);
}

/** 累积并校验 update 组件参数。 */
function collectComponent(value: string, previous: ComponentId[]): ComponentId[] {
    const allowed: ComponentId[] = ["source", "product", "runtime", "tools"];
    if (!allowed.includes(value as ComponentId)) throw new Error(`不支持的组件：${value}`);
    return [...previous, value as ComponentId];
}

/** 限制 v1 可维护工具集合。 */
function assertTool(value: string): asserts value is "rg" | "git" {
    if (value !== "rg" && value !== "git") throw new Error(`不支持的工具：${value}`);
}

/** 输出机器可读 JSON。 */
function printJson(value: object): void {
    console.log(JSON.stringify(value, null, 4));
}

/** 输出适合终端快速查看的顶层键值。 */
function printObject(value: object): void {
    for (const [key, item] of Object.entries(value)) {
        console.log(`${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
    }
}
