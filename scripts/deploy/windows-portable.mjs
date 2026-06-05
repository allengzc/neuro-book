#!/usr/bin/env node
import {createHash} from "node:crypto";
import {createWriteStream, existsSync, readFileSync} from "node:fs";
import {cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {unzipSync} from "fflate";
import yazl from "yazl";

import {runCapture} from "../utils/process.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCHER_SOURCE = join(REPO_ROOT, "scripts", "deploy", "windows-portable", "launcher");
const PRODUCT_ROOT = join(REPO_ROOT, "product");
const DIST_DIR = join(REPO_ROOT, "dist");
const PACKAGE_ROOT_NAME = "neuro-book-windows-x64";
const DEFAULT_OUTPUT = join(DIST_DIR, `${PACKAGE_ROOT_NAME}.zip`);
const DEFAULT_NODE_VERSION = process.env.NEURO_BOOK_WINDOWS_NODE_VERSION ?? "24.11.1";
const ZIP_SCHEMA_VERSION = 2;
const LAUNCHER_ROOT_FILES = [
    "Start Neuro Book.cmd",
    "Start Neuro Book.ps1",
    "Update Neuro Book.cmd",
    "Update Neuro Book.ps1",
    "Create Admin.cmd",
    "Create Admin.ps1",
    "README-Windows.md",
];

const options = parseArgs(process.argv.slice(2));

/**
 * Windows release zip 打包入口。
 */
async function main() {
    process.chdir(REPO_ROOT);
    if (!options.skipGitCheck) {
        await assertCleanTrackedWorktree();
    }
    await assertProductPayload();
    await assertLauncherSources();

    const stageRoot = join(REPO_ROOT, ".agent", "workspace", "windows-portable-package");
    const portableRoot = join(stageRoot, PACKAGE_ROOT_NAME);
    await rm(stageRoot, {recursive: true, force: true});
    await mkdir(join(portableRoot, "launcher"), {recursive: true});

    await stageProductPayload(portableRoot);
    await copyLauncherShell(portableRoot);
    await bundleLauncher(portableRoot);
    await stageNodeRuntime(portableRoot);
    await writePortableRelease(portableRoot);

    const outputPath = resolve(options.output ?? DEFAULT_OUTPUT);
    await mkdir(dirname(outputPath), {recursive: true});
    await createZip(portableRoot, outputPath);
    await writeSha256Sums(outputPath);
    console.log(`Windows portable zip: ${relative(REPO_ROOT, outputPath).replaceAll("\\", "/")}`);
}

/**
 * 解析 CLI 参数。
 */
function parseArgs(args) {
    const parsed = {
        output: null,
        nodeRuntime: null,
        skipGitCheck: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--output") {
            parsed.output = requireValue(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--node-runtime") {
            parsed.nodeRuntime = requireValue(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--skip-git-check") {
            parsed.skipGitCheck = true;
            continue;
        }
        throw new Error(`未知参数：${arg}`);
    }
    return parsed;
}

function requireValue(args, index, arg) {
    const value = args[index + 1];
    if (!value) {
        throw new Error(`${arg} 需要参数值`);
    }
    return value;
}

/**
 * release 打包默认要求 tracked worktree 干净。
 */
async function assertCleanTrackedWorktree() {
    const status = await runCapture("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: REPO_ROOT});
    if (status.trim()) {
        throw new Error(`tracked worktree 不干净，停止打包：\n${status.trim()}`);
    }
}

/**
 * 校验 Product Payload 已经生成。
 */
async function assertProductPayload() {
    const requiredFiles = [
        join(PRODUCT_ROOT, ".output", "server", "index.mjs"),
        join(PRODUCT_ROOT, "release-meta.json"),
        join(PRODUCT_ROOT, ".output", "server", "node_modules"),
    ];
    for (const path of requiredFiles) {
        if (!existsSync(path)) {
            throw new Error(`缺少 Product Payload 文件：${path}\n请先运行 bun run nuxt:build && bun run product:stage。`);
        }
    }
}

/**
 * 校验 launcher 必需文件存在。
 */
async function assertLauncherSources() {
    const files = [
        ...LAUNCHER_ROOT_FILES,
        "launcher.mjs",
    ];
    for (const file of files) {
        const path = join(LAUNCHER_SOURCE, file);
        if (!existsSync(path)) {
            throw new Error(`缺少 Windows Launcher 文件：${path}`);
        }
    }
}

/**
 * 复制 Product Payload 到 zip app/，并移除打包验证根中的本机 .env。
 */
async function stageProductPayload(portableRoot) {
    const appRoot = join(portableRoot, "app");
    await cp(PRODUCT_ROOT, appRoot, {recursive: true});
    await rm(join(appRoot, ".env"), {force: true});
    await rm(join(appRoot, "workspace"), {recursive: true, force: true});
}

/**
 * 复制用户可点击的 PowerShell 入口。
 */
async function copyLauncherShell(portableRoot) {
    for (const file of LAUNCHER_ROOT_FILES) {
        await cp(join(LAUNCHER_SOURCE, file), join(portableRoot, file));
    }
}

/**
 * 把 clack 等依赖 bundle 进 launcher.mjs，保证初始 zip 只依赖内置 Node。
 */
async function bundleLauncher(portableRoot) {
    await build({
        entryPoints: [join(LAUNCHER_SOURCE, "launcher.mjs")],
        outfile: join(portableRoot, "launcher", "launcher.mjs"),
        bundle: true,
        platform: "node",
        format: "esm",
        external: ["node:*"],
        banner: {
            js: "",
        },
    });
}

/**
 * 放入 Node.js Windows x64 runtime。
 */
async function stageNodeRuntime(portableRoot) {
    const target = join(portableRoot, "runtime", "node");
    if (options.nodeRuntime) {
        await cp(await realpath(resolve(options.nodeRuntime)), target, {recursive: true});
        return;
    }

    const zipName = `node-v${DEFAULT_NODE_VERSION}-win-x64.zip`;
    const baseUrl = `https://nodejs.org/dist/v${DEFAULT_NODE_VERSION}`;
    const [archive, shasums] = await Promise.all([
        downloadBuffer(`${baseUrl}/${zipName}`),
        downloadText(`${baseUrl}/SHASUMS256.txt`),
    ]);
    const expected = shasums.split(/\r?\n/u)
        .map((line) => line.trim().split(/\s+/u))
        .find((parts) => parts[1] === zipName)?.[0];
    const actual = sha256(archive);
    if (!expected || expected !== actual) {
        throw new Error(`Node.js runtime checksum mismatch: expected ${expected ?? "<missing>"} actual ${actual}`);
    }

    const entries = unzipSync(new Uint8Array(archive));
    const prefix = `node-v${DEFAULT_NODE_VERSION}-win-x64/`;
    for (const [name, data] of Object.entries(entries)) {
        if (!name.startsWith(prefix) || name.endsWith("/")) {
            continue;
        }
        const relativePath = name.slice(prefix.length);
        if (!relativePath) {
            continue;
        }
        const filePath = join(target, ...relativePath.split("/"));
        await mkdir(dirname(filePath), {recursive: true});
        await writeFile(filePath, data);
    }
}

async function downloadBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`下载失败：${url} ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function downloadText(url) {
    return (await downloadBuffer(url)).toString("utf8");
}

/**
 * 写入 release 元数据。
 */
async function writePortableRelease(portableRoot) {
    const releaseTag = process.env.GITHUB_REF_NAME ?? `v${JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")).version}`;
    const buildCommit = await runCapture("git", ["rev-parse", "HEAD"], {cwd: REPO_ROOT}).then((value) => value.trim());
    await writeFile(join(portableRoot, "portable-release.json"), `${JSON.stringify({
        releaseTag,
        buildCommit,
        nodeVersion: DEFAULT_NODE_VERSION,
        payload: readReleaseMeta(),
        createdAt: new Date().toISOString(),
        zipSchemaVersion: ZIP_SCHEMA_VERSION,
    }, null, 4)}\n`, "utf8");
}

function readReleaseMeta() {
    return JSON.parse(readFileSyncUtf8(join(PRODUCT_ROOT, "release-meta.json")));
}

function readFileSyncUtf8(path) {
    return new TextDecoder().decode(readFileSync(path));
}

/**
 * 创建 zip。
 */
async function createZip(sourceRoot, outputPath) {
    await rm(outputPath, {force: true});
    const zipFile = new yazl.ZipFile();
    await addDirectoryToZip(zipFile, sourceRoot, dirname(sourceRoot));
    zipFile.end();
    await new Promise((resolvePromise, rejectPromise) => {
        zipFile.outputStream
            .pipe(createWriteStreamLazy(outputPath))
            .on("close", resolvePromise)
            .on("error", rejectPromise);
    });
}

/**
 * yazl 需要一个 write stream。
 */
function createWriteStreamLazy(path) {
    return createWriteStream(path);
}

async function addDirectoryToZip(zipFile, directory, baseDirectory) {
    const entries = await readdir(directory, {withFileTypes: true});
    for (const entry of entries) {
        const absolutePath = join(directory, entry.name);
        const zipPath = relative(baseDirectory, absolutePath).replaceAll("\\", "/");
        if (entry.isDirectory()) {
            await addDirectoryToZip(zipFile, absolutePath, baseDirectory);
            continue;
        }
        if (entry.isFile()) {
            const info = await stat(absolutePath);
            zipFile.addFile(absolutePath, zipPath, {mtime: info.mtime});
        }
    }
}

/**
 * 写 SHA256SUMS。
 */
async function writeSha256Sums(outputPath) {
    const hash = sha256(await readFile(outputPath));
    const sumsPath = join(dirname(outputPath), "SHA256SUMS");
    await writeFile(sumsPath, `${hash}  ${basename(outputPath)}\n`, "utf8");
}

function sha256(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
