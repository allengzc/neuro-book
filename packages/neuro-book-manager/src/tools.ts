import {dirname, join, relative, resolve} from "node:path";
import {chmod as chmodFile, rename} from "node:fs/promises";

import {downloadVerified, extractArchive, githubReleaseAsset} from "#manager/download";
import {ensureDirectory, removePath, writeTextAtomic} from "#manager/files";
import {run} from "#manager/process";
import {assertManagerPlatform} from "#manager/platform";
import {findNamedFile, prependExecutablePath} from "#manager/runtime";
import type {ManagedGitToolComponent, ManagedToolComponent, ToolComponents} from "#manager/types";

export type ManagedToolName = "rg" | "git";

/** 安装 Manager 支持的托管工具。 */
export async function installManagedTool(root: string, tool: "rg"): Promise<ManagedToolComponent>;
export async function installManagedTool(root: string, tool: "git"): Promise<ManagedGitToolComponent>;
export async function installManagedTool(root: string, tool: ManagedToolName): Promise<ManagedToolComponent | ManagedGitToolComponent> {
    assertManagerPlatform();
    return tool === "git" ? installPortableGit(root) : installRipgrep(root);
}

/** 安装最新 ripgrep，部分版本目录会自动重建。 */
async function installRipgrep(root: string): Promise<ManagedToolComponent> {
    const suffix = process.platform === "win32" ? "x86_64-pc-windows-msvc.zip" : "x86_64-unknown-linux-gnu.tar.gz";
    const release = await githubReleaseAsset("BurntSushi/ripgrep", undefined, (name) => name.endsWith(suffix));
    const version = release.tag.replace(/^v/u, "");
    const targetRoot = join(root, ".runtime", "tools", "rg", version);
    let executable = await findNamedFile(targetRoot, process.platform === "win32" ? "rg.exe" : "rg").catch(() => null);
    if (!executable) {
        await removePath(targetRoot);
        const stageRoot = join(root, ".deploy", "staging", `rg-${version}`);
        const archivePath = join(stageRoot, release.asset.name);
        const extractedRoot = join(stageRoot, "extracted");
        await removePath(stageRoot);
        await downloadVerified(release.asset.url, archivePath, release.asset.sha256);
        await extractArchive(archivePath, extractedRoot);
        executable = await findNamedFile(extractedRoot, process.platform === "win32" ? "rg.exe" : "rg");
        await ensureDirectory(dirname(targetRoot));
        await rename(extractedRoot, targetRoot);
        executable = join(targetRoot, relative(extractedRoot, executable));
        await removePath(stageRoot);
    }
    await writeToolWrapper(root, "rg", executable);
    prependExecutablePath(executable);
    return {
        provider: "managed",
        version,
        path: relative(root, executable).replaceAll("\\", "/"),
        checksum: release.asset.sha256,
        sourceUrl: release.asset.url,
        license: "MIT OR Unlicense",
        redistribution: "按 ripgrep 官方 Release 原样再分发，并保留上游许可证文件。",
    };
}

/** Windows 安装 PortableGit，确保 Git 与真正 bash 同属一个受审计发行包。 */
async function installPortableGit(root: string): Promise<ManagedGitToolComponent> {
    if (process.platform !== "win32") throw new Error("PortableGit managed provider 只支持 Windows x64。" );
    const release = await githubReleaseAsset(
        "git-for-windows/git",
        undefined,
        (name) => /^PortableGit-.*-64-bit\.7z\.exe$/u.test(name),
    );
    const version = release.tag.replace(/^v/u, "");
    const targetRoot = join(root, ".runtime", "tools", "git", version);
    let git = await findNamedFile(targetRoot, "git.exe").catch(() => null);
    let bash = await findNamedFile(targetRoot, "bash.exe").catch(() => null);
    if (!git || !bash) {
        await removePath(targetRoot);
        const stageRoot = join(root, ".deploy", "staging", `portable-git-${version}`);
        const archivePath = join(stageRoot, release.asset.name);
        const extractedRoot = join(stageRoot, "extracted");
        await removePath(stageRoot);
        await ensureDirectory(stageRoot);
        await downloadVerified(release.asset.url, archivePath, release.asset.sha256);
        await ensureDirectory(extractedRoot);
        await run(archivePath, ["-y", `-o${extractedRoot}`]);
        git = await findNamedFile(extractedRoot, "git.exe");
        bash = await findNamedFile(extractedRoot, "bash.exe");
        await ensureDirectory(dirname(targetRoot));
        await rename(extractedRoot, targetRoot);
        git = join(targetRoot, relative(extractedRoot, git));
        bash = join(targetRoot, relative(extractedRoot, bash));
        await removePath(stageRoot);
    }
    await writeToolWrapper(root, "git", git);
    await writeToolWrapper(root, "bash", bash);
    activatePortableGit(git, bash);
    return {
        provider: "managed",
        distribution: "PortableGit",
        version,
        path: relative(root, git).replaceAll("\\", "/"),
        bashPath: relative(root, bash).replaceAll("\\", "/"),
        checksum: release.asset.sha256,
        sourceUrl: release.asset.url,
        license: "GPL-2.0-only",
        redistribution: "按 Git for Windows PortableGit 官方 Release 原样再分发；第三方组件许可证以包内文件为准。",
    };
}

/** 激活 installation manifest 中的 managed executable。 */
export function activateManagedTools(root: string, tools: ToolComponents): void {
    if (tools.rg?.provider === "managed") prependExecutablePath(resolve(root, tools.rg.path));
    if (tools.git?.provider === "managed") activatePortableGit(resolve(root, tools.git.path), resolve(root, tools.git.bashPath));
}

async function writeToolWrapper(root: string, tool: "rg" | "git" | "bash", executable: string): Promise<void> {
    const binRoot = join(root, ".runtime", "bin");
    await ensureDirectory(binRoot);
    const executableRelative = relative(root, executable);
    if (process.platform === "win32") {
        await writeTextAtomic(join(binRoot, `${tool}.cmd`), `@echo off\r\nset "ROOT=%~dp0..\\.."\r\n"%ROOT%\\${executableRelative}" %*\r\n`);
        return;
    }
    const wrapper = join(binRoot, tool);
    await writeTextAtomic(wrapper, `#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"\nexec "$ROOT/${executableRelative}" "$@"\n`);
    await chmodFile(wrapper, 0o755);
}

function activatePortableGit(git: string, bash: string): void {
    prependExecutablePath(git);
    prependExecutablePath(bash);
    process.env.NEURO_BOOK_BASH = bash;
    process.env.GIT_BASH = bash;
}
