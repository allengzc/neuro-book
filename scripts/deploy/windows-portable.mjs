#!/usr/bin/env bun
import {createHash} from "node:crypto";
import {createWriteStream, existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import yazl from "yazl";

import {runCapture} from "../utils/process.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCHER_SOURCE = join(REPO_ROOT, "scripts", "deploy", "windows-portable", "launcher");
const PRODUCT_ROOT = join(REPO_ROOT, "product");
const DIST_DIR = join(REPO_ROOT, "dist");
const PACKAGE_ROOT_NAME = "neuro-book-windows-x64";
const DEFAULT_OUTPUT = join(DIST_DIR, `${PACKAGE_ROOT_NAME}.zip`);
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
    await assertProductProfileArtifactsPortable();
    await assertLauncherSources();

    const stageRoot = join(REPO_ROOT, ".agent", "workspace", "windows-portable-package");
    const portableRoot = join(stageRoot, PACKAGE_ROOT_NAME);
    await rm(stageRoot, {recursive: true, force: true});
    await mkdir(join(portableRoot, "launcher"), {recursive: true});

    await stageProductPayload(portableRoot);
    await copyLauncherShell(portableRoot);
    await bundleLauncher(portableRoot);
    const bunRuntime = await stageBunRuntime(portableRoot);
    await writePortablePackageJson(portableRoot);
    await writePortableRelease(portableRoot, bunRuntime);

    const outputPath = resolve(options.output ?? DEFAULT_OUTPUT);
    await mkdir(dirname(outputPath), {recursive: true});
    await createZip(portableRoot, outputPath);
    await writeSha256Sums(outputPath);
    console.log(`Windows portable zip: ${relative(REPO_ROOT, outputPath).replaceAll("\\", "/")}`);
}

/**
 * release zip 构建前确认 staged Product profile artifacts 可迁移。
 */
async function assertProductProfileArtifactsPortable() {
    const compiledRoot = join(PRODUCT_ROOT, "assets", "workspace", ".nbook", "agent", "profiles", ".compiled");
    if (!existsSync(join(compiledRoot, "manifest.json"))) {
        throw new Error(`Product profile artifact 缺少 manifest：${join(compiledRoot, "manifest.json")}`);
    }
    const entries = await readdir(compiledRoot, {withFileTypes: true}).catch(() => []);
    const offenders = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".mjs")) {
            continue;
        }
        const head = (await readFile(join(compiledRoot, entry.name), "utf8")).slice(0, 2048).replaceAll("\\", "/");
        if (/__nbookCreateRequire\(["']file:\/\/\/[A-Za-z]:/u.test(head) || head.includes("D:/a/neuro-book/")) {
            offenders.push(entry.name);
        }
    }
    if (offenders.length > 0) {
        throw new Error(`Product profile artifact 写入了构建机绝对路径：${offenders.join(", ")}`);
    }
}

/**
 * 解析 CLI 参数。
 */
function parseArgs(args) {
    const parsed = {
        output: null,
        bunRuntime: null,
        skipGitCheck: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--output") {
            parsed.output = requireValue(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--bun-runtime") {
            parsed.bunRuntime = requireValue(args, index, arg);
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
        join(PRODUCT_ROOT, "package.json"),
        join(PRODUCT_ROOT, ".output", "server", "package.json"),
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
    await writeDeprecatedReleaseMetaBridge(appRoot);
}

/**
 * 桥接旧 Windows Launcher：旧版更新校验仍要求 app/release-meta.json。
 */
async function writeDeprecatedReleaseMetaBridge(appRoot) {
    await writeFile(join(appRoot, "release-meta.json"), `${JSON.stringify({
        deprecated: true,
    }, null, 4)}\n`, "utf8");
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
 * 把 clack 等依赖 bundle 进 launcher.mjs，保证初始 zip 只依赖内置 Bun。
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
 * 放入 Bun Windows x64 runtime。
 */
async function stageBunRuntime(portableRoot) {
    const source = options.bunRuntime
        ? await resolveBunRuntimeOverride(options.bunRuntime)
        : await resolveBunFromPath();
    const target = join(portableRoot, "runtime", "bun", "bun.exe");
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target);
    const version = await runCapture(target, ["--version"]).then((value) => value.trim());
    return {
        version,
        path: "runtime/bun/bun.exe",
    };
}

/**
 * 解析 --bun-runtime，允许传入 bun.exe 文件或包含 bun.exe 的目录。
 */
async function resolveBunRuntimeOverride(value) {
    const input = await realpath(resolve(value));
    const info = await stat(input);
    if (info.isFile()) {
        return await resolveRealBunExecutable(input);
    }
    if (!info.isDirectory()) {
        throw new Error(`--bun-runtime 必须指向 bun.exe 文件或包含 bun.exe 的目录：${input}`);
    }
    const candidate = join(input, "bun.exe");
    if (!existsSync(candidate)) {
        throw new Error(`--bun-runtime 目录缺少 bun.exe：${candidate}`);
    }
    return await resolveRealBunExecutable(await realpath(candidate));
}

/**
 * 从当前 PATH 定位 Bun runtime。
 */
async function resolveBunFromPath() {
    const locator = process.platform === "win32" ? "where" : "which";
    const output = await runCapture(locator, ["bun"]);
    const first = output.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    if (!first) {
        throw new Error("未在 PATH 中找到 Bun。请先安装 Bun，或使用 --bun-runtime <bun.exe-or-dir> 指定。");
    }
    const real = await resolveRealBunExecutable(await realpath(first));
    if (process.platform === "win32" && basename(real).toLowerCase() !== "bun.exe") {
        throw new Error(`PATH 中的 bun 不是 bun.exe：${real}`);
    }
    return real;
}

/**
 * Scoop 的 bun.exe 是 shim，不能单独复制进 portable；这里解析到真实 runtime。
 */
async function resolveRealBunExecutable(path) {
    const scoopCandidate = await resolveScoopBun(path);
    if (scoopCandidate && await bunExecutableWorks(scoopCandidate)) {
        return scoopCandidate;
    }
    if (await bunExecutableWorks(path)) {
        return path;
    }
    throw new Error(`Bun runtime 无法独立执行：${path}\n请使用 --bun-runtime 指向真实 bun.exe 或包含 bun.exe 的目录。`);
}

async function bunExecutableWorks(path) {
    try {
        await runCapture(path, ["--version"]);
        return true;
    } catch {
        return false;
    }
}

async function resolveScoopBun(path) {
    if (process.platform !== "win32") {
        return null;
    }
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    const marker = "/scoop/shims/bun.exe";
    if (!normalized.endsWith(marker)) {
        return null;
    }
    const scoopRoot = path.slice(0, path.length - marker.length + "/scoop".length);
    const current = join(scoopRoot, "apps", "bun", "current", "bun.exe");
    if (existsSync(current)) {
        return await realpath(current);
    }
    const appsRoot = join(scoopRoot, "apps", "bun");
    if (!existsSync(appsRoot)) {
        return null;
    }
    const entries = await readdir(appsRoot, {withFileTypes: true});
    const candidates = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(appsRoot, entry.name, "bun.exe"))
        .filter((candidate) => existsSync(candidate));
    candidates.sort((left, right) => right.localeCompare(left, undefined, {numeric: true}));
    return candidates.length > 0 ? await realpath(candidates[0]) : null;
}

/**
 * 写入 release 元数据。
 */
async function writePortableRelease(portableRoot, bunRuntime) {
    const releaseTag = process.env.GITHUB_REF_NAME ?? `v${JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")).version}`;
    await writeFile(join(portableRoot, "portable-release.json"), `${JSON.stringify({
        releaseTag,
        runtimeKind: "bun",
        bunVersion: bunRuntime.version,
        runtimePath: bunRuntime.path,
        payload: await readProductPackageManifest(join(portableRoot, "app")),
        createdAt: new Date().toISOString(),
        zipSchemaVersion: ZIP_SCHEMA_VERSION,
    }, null, 4)}\n`, "utf8");
}

/**
 * 写入 portable 根 package.json，让用户可在 release 根目录直接执行 bun run 维护脚本。
 */
async function writePortablePackageJson(portableRoot) {
    const source = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8"));
    await writeFile(join(portableRoot, "package.json"), `${JSON.stringify({
        name: "neuro-book-windows-portable",
        version: source.version ?? "0.0.0",
        private: true,
        type: "module",
        scripts: {
            "migrate:agent-session-initial": "runtime/bun/bun.exe app/.output/server/scripts/db/migrate-agent-session-initial.ts --root data/workspace",
            "migrate:writer-session-initial": "runtime/bun/bun.exe app/.output/server/scripts/db/migrate-writer-session-initial.ts --root data/workspace",
        },
    }, null, 4)}\n`, "utf8");
}

async function readProductPackageManifest(root) {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    return {
        name: manifest.name ?? "unknown",
        version: manifest.version ?? "unknown",
        repository: manifest.repository ?? null,
    };
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
