import {existsSync} from "node:fs";
import {chmod, copyFile, readdir, rename} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";

import {downloadVerified, extractArchive, githubReleaseAsset} from "#manager/download";
import {ensureDirectory, pathExists, removePath, sha256File, writeTextAtomic} from "#manager/files";
import {assertManagerPlatform, executableName} from "#manager/platform";
import type {ManagedRuntimeComponent, ManagerComponent, ManagerRuntimeComponent} from "#manager/types";

const STAGE0_PATH = "NEURO_BOOK_STAGE0_BUN_PATH";
const STAGE0_VERSION = "NEURO_BOOK_STAGE0_BUN_VERSION";
const STAGE0_SOURCE_URL = "NEURO_BOOK_STAGE0_BUN_SOURCE_URL";
const STAGE0_SHA256 = "NEURO_BOOK_STAGE0_BUN_SHA256";

/** 解析 Manager Host Runtime；Stage 0 优先复制为 managed，否则使用当前 Bun。 */
export async function resolveManagerRuntime(root: string, forceManaged = false): Promise<ManagerRuntimeComponent> {
    const stage0 = stage0Runtime();
    if (stage0) return installStage0Bun(root, stage0);
    if (forceManaged) return installManagedBun(root);
    return {
        provider: "system",
        version: process.versions.bun ?? "unknown",
        executable: process.execPath,
    };
}

/** 安装托管 Bun Runtime，使用 staging 后原子提交不可变版本目录。 */
export async function installManagedBun(root: string, requestedVersion?: string): Promise<ManagedRuntimeComponent> {
    assertManagerPlatform();
    const tag = requestedVersion
        ? requestedVersion.startsWith("bun-v") ? requestedVersion : `bun-v${requestedVersion.replace(/^v/u, "")}`
        : undefined;
    const archiveName = process.platform === "win32" ? "bun-windows-x64.zip" : "bun-linux-x64.zip";
    const release = await githubReleaseAsset("oven-sh/bun", tag, (name) => name === archiveName);
    const version = release.tag.replace(/^bun-v/u, "");
    const runtimeRoot = join(root, ".runtime", "bun", version);
    let executable = await findNamedFile(runtimeRoot, executableName("bun")).catch(() => null);
    if (!executable) {
        await removePath(runtimeRoot);
        const stageRoot = join(root, ".deploy", "staging", `bun-${version}`);
        const archivePath = join(stageRoot, archiveName);
        const extractedRoot = join(stageRoot, "extracted");
        await removePath(stageRoot);
        await downloadVerified(release.asset.url, archivePath, release.asset.sha256);
        await extractArchive(archivePath, extractedRoot);
        executable = await findNamedFile(extractedRoot, executableName("bun"));
        await ensureDirectory(dirname(runtimeRoot));
        await rename(extractedRoot, runtimeRoot);
        await removePath(stageRoot);
        executable = join(runtimeRoot, relative(extractedRoot, executable));
    }
    await writeRuntimeWrapper(root, executable);
    return {
        provider: "managed",
        version,
        path: relative(root, executable).replaceAll("\\", "/"),
        checksum: release.asset.sha256,
        sourceUrl: release.asset.url,
        license: "MIT",
        redistribution: "按 Bun 官方 Release 原样再分发，并保留上游许可证与版本信息。",
    };
}

/** 把当前 Manager bundle安装到版本目录，并返回严格组件状态。 */
export async function installManagerExecutable(root: string, version: string, source: string): Promise<ManagerComponent> {
    const managerRoot = join(root, ".runtime", "manager", version);
    await ensureDirectory(managerRoot);
    const target = join(managerRoot, "neuro-book.mjs");
    if (resolve(source) !== resolve(target)) await copyFile(source, target);
    return {
        provider: "managed",
        version,
        path: relative(root, target).replaceAll("\\", "/"),
        checksum: await sha256File(target),
    };
}

/** 根据当前 Manager 与 Manager Runtime 原子刷新稳定 wrapper。 */
export async function writeManagerWrapper(root: string, manager: ManagerComponent, runtime: ManagerRuntimeComponent): Promise<void> {
    const binRoot = join(root, ".runtime", "bin");
    await ensureDirectory(binRoot);
    const managerPath = manager.path.replaceAll("/", process.platform === "win32" ? "\\" : "/");
    if (process.platform === "win32") {
        const runtimeCommand = runtime.provider === "managed"
            ? `"%ROOT%\\${runtime.path.replaceAll("/", "\\")}"`
            : `"${runtime.executable}"`;
        await writeTextAtomic(
            join(binRoot, "neuro-book.cmd"),
            `@echo off\r\nset "ROOT=%~dp0..\\.."\r\n${runtimeCommand} "%ROOT%\\${managerPath}" %*\r\n`,
        );
        return;
    }
    const wrapper = join(binRoot, "neuro-book");
    const runtimeCommand = runtime.provider === "managed"
        ? `"$ROOT/${runtime.path}"`
        : JSON.stringify(runtime.executable);
    await writeTextAtomic(wrapper, `#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"\nexec ${runtimeCommand} "$ROOT/${manager.path}" "$@"\n`);
    await chmod(wrapper, 0o755);
}

/** 返回 Runtime 真实可执行文件。 */
export function runtimeExecutable(root: string, runtime: ManagerRuntimeComponent): string {
    return runtime.provider === "managed" ? resolve(root, runtime.path) : runtime.executable;
}

/** 将托管 Runtime/Tool 的真实目录加入当前子进程 PATH。 */
export function prependExecutablePath(executable: string): void {
    const directory = dirname(executable);
    const separator = process.platform === "win32" ? ";" : ":";
    const current = process.env.PATH ?? "";
    if (!current.split(separator).includes(directory)) process.env.PATH = `${directory}${separator}${current}`;
}

async function installStage0Bun(root: string, stage0: Stage0Runtime): Promise<ManagedRuntimeComponent> {
    const actualChecksum = await sha256File(stage0.path);
    if (actualChecksum.toLowerCase() !== stage0.sha256.toLowerCase()) {
        throw new Error(`Stage 0 Bun checksum 不匹配：${stage0.path}`);
    }
    const targetRoot = join(root, ".runtime", "bun", stage0.version);
    const target = join(targetRoot, basename(stage0.path));
    await ensureDirectory(targetRoot);
    if (!await pathExists(target)) await copyFile(stage0.path, target);
    await writeRuntimeWrapper(root, target);
    return {
        provider: "managed",
        version: stage0.version,
        path: relative(root, target).replaceAll("\\", "/"),
        checksum: stage0.sha256,
        sourceUrl: stage0.sourceUrl,
        license: "MIT",
        redistribution: "由 NeuroBook Stage 0 校验 Bun 官方 Release 后复制到 Installation Root。",
    };
}

async function writeRuntimeWrapper(root: string, executable: string): Promise<void> {
    const binRoot = join(root, ".runtime", "bin");
    await ensureDirectory(binRoot);
    const executableRelative = relative(root, executable);
    if (process.platform === "win32") {
        await writeTextAtomic(join(binRoot, "bun.cmd"), `@echo off\r\nset "ROOT=%~dp0..\\.."\r\n"%ROOT%\\${executableRelative}" %*\r\n`);
        return;
    }
    const wrapper = join(binRoot, "bun");
    await writeTextAtomic(wrapper, `#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"\nexec "$ROOT/${executableRelative}" "$@"\n`);
    await chmod(wrapper, 0o755);
}

/** 在解压目录中递归寻找指定文件。 */
export async function findNamedFile(root: string, filename: string): Promise<string> {
    if (!await pathExists(root)) throw new Error(`目录不存在：${root}`);
    const entries = await readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return path;
        if (entry.isDirectory()) {
            const nested = await findNamedFile(path, filename).catch(() => null);
            if (nested) return nested;
        }
    }
    throw new Error(`解压目录缺少 ${filename}：${root}`);
}

type Stage0Runtime = {path: string; version: string; sourceUrl: string; sha256: string};

function stage0Runtime(): Stage0Runtime | null {
    const path = process.env[STAGE0_PATH]?.trim();
    const version = process.env[STAGE0_VERSION]?.trim();
    const sourceUrl = process.env[STAGE0_SOURCE_URL]?.trim();
    const sha256 = process.env[STAGE0_SHA256]?.trim();
    if (!path && !version && !sourceUrl && !sha256) return null;
    if (!path || !version || !sourceUrl || !sha256 || !/^[a-fA-F0-9]{64}$/u.test(sha256)) {
        throw new Error("Stage 0 Bun metadata 不完整，拒绝安装未验证 Runtime。" );
    }
    if (!pathExistsSync(path)) throw new Error(`Stage 0 Bun 不存在：${path}`);
    return {path: resolve(path), version, sourceUrl, sha256};
}

function pathExistsSync(path: string): boolean {
    return existsSync(path);
}
