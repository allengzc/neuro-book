import {spawn} from "node:child_process";
import {join, resolve} from "node:path";

import {enableAuthentication, ensureStateFiles, loadStateEnv} from "#manager/config";
import {startDocker} from "#manager/docker";
import {pathExists} from "#manager/files";
import {commandAvailable, run, runCapture} from "#manager/process";
import {activateManagedTools} from "#manager/tools";
import type {InstallationManifest} from "#manager/types";

/** 启动当前安装。原生模式前台运行，Docker 模式后台运行。 */
export async function startApplication(root: string, manifest: InstallationManifest): Promise<void> {
    const stateRoot = resolve(root, manifest.stateRoot);
    await ensureStateFiles(stateRoot, 3000, manifest.profile !== "windows-portable");
    activateManagedTools(root, manifest.components.tools);
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
        await startDocker(root, stateRoot, manifest.profile);
        return;
    }
    const env = await applicationEnvironment(root, stateRoot, manifest.profile === "source-dev");
    if (manifest.profile === "source-dev") {
        await run(resolveBun(root, manifest), ["run", "dev"], {cwd: root, env});
        return;
    }
    const entry = join(root, ".output", "server", "scripts", "deploy", "product-start.mjs");
    if (!await pathExists(entry)) {
        throw new Error("当前安装缺少 Product 启动入口，请先执行 neuro-book update --component product。");
    }
    await migrateApplication(root, manifest);
    const bun = resolveBun(root, manifest);
    if (manifest.profile === "windows-portable") {
        await runPortableForeground(bun, entry, root, env, Number(env.NUXT_PORT ?? env.PORT ?? "3000"));
        return;
    }
    await run(bun, [entry], {cwd: root, env});
}

/** 执行数据库迁移。 */
export async function migrateApplication(root: string, manifest: InstallationManifest): Promise<void> {
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker" || manifest.profile === "source-dev") {
        return;
    }
    const script = join(root, ".output", "server", "scripts", "db", "prisma-migrate.mjs");
    if (!await pathExists(script)) {
        throw new Error("Product 缺少数据库迁移脚本。");
    }
    const stateRoot = resolve(root, manifest.stateRoot);
    await run(resolveBun(root, manifest), [script, "--deploy"], {
        cwd: root,
        env: await applicationEnvironment(root, stateRoot, false),
    });
}

/** 创建或重置管理员。 */
export async function createAdmin(root: string, manifest: InstallationManifest, username?: string): Promise<void> {
    activateManagedTools(root, manifest.components.tools);
    const stateRoot = resolve(root, manifest.stateRoot);
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const composeArgs = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
        const running = (await runCapture("docker", [...composeArgs, "ps", "--status", "running", "--services", "app"], {cwd: root})).trim();
        if (running !== "app") throw new Error("容器 app 尚未运行，请先执行 neuro-book start。" );
        await run("docker", [...composeArgs, "exec", "app", "bun", ".output/server/scripts/cli/create-admin.ts", ...(username ? [username] : [])], {cwd: root});
        return;
    }
    const productScript = join(root, ".output", "server", "scripts", "cli", "create-admin.ts");
    const args = username ? [productScript, username] : [productScript];
    if (await pathExists(productScript)) {
        await run(resolveBun(root, manifest), args, {cwd: root, env: await applicationEnvironment(root, stateRoot, false)});
        if (manifest.profile === "windows-portable") {
            await enableAuthentication(stateRoot);
            console.log("管理员创建成功，Windows Portable 鉴权已启用；请重启 NeuroBook。" );
        }
        return;
    }
    await run("bun", username ? ["run", "auth:create-admin", username] : ["run", "auth:create-admin"], {
        cwd: root,
        env: await applicationEnvironment(root, stateRoot, false),
    });
}

/** 生成状态/doctor 所需的命令版本。 */
export async function commandStatus(command: string): Promise<{available: boolean; version: string | null}> {
    const available = await commandAvailable(command);
    if (!available) {
        return {available: false, version: null};
    }
    const version = (await runCapture(command, ["--version"])).split(/\r?\n/u)[0]?.trim() ?? null;
    return {available: true, version};
}

async function applicationEnvironment(root: string, stateRoot: string, development: boolean): Promise<NodeJS.ProcessEnv> {
    return {
        ...process.env,
        ...await loadStateEnv(stateRoot),
        NODE_ENV: development ? "development" : "production",
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_APPLICATION_ROOT: root,
    };
}

function resolveBun(root: string, manifest: InstallationManifest): string {
    const runtime = manifest.components.applicationRuntime;
    if (runtime.provider === "managed") return resolve(root, runtime.path);
    if (runtime.provider === "system") return runtime.executable;
    throw new Error("Container Application Runtime 不能执行宿主 Product 命令。" );
}

async function runPortableForeground(bun: string, entry: string, root: string, env: NodeJS.ProcessEnv, port: number): Promise<void> {
    const child = spawn(bun, [entry], {cwd: root, env, stdio: "inherit", windowsHide: false});
    const exited = new Promise<void>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("exit", (code, signal) => {
            if (signal || code !== 0) rejectPromise(new Error(`NeuroBook 服务退出：${signal ?? code}`));
            else resolvePromise();
        });
    });
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    let opened = false;
    while (Date.now() < deadline && child.exitCode === null) {
        try {
            const response = await fetch(`${url}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
            if (response.ok) {
                await run("cmd.exe", ["/c", "start", "", url], {cwd: root, stdio: "ignore"});
                opened = true;
                break;
            }
        } catch {
            // 服务启动期间连接失败属于预期状态。
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (!opened && child.exitCode === null) {
        child.kill();
        await exited.catch(() => undefined);
        throw new Error(`Windows Portable 启动后 30 秒内未通过健康检查：${url}`);
    }
    await exited;
}
