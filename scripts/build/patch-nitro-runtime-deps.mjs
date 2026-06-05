#!/usr/bin/env node
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {dirname, relative, resolve} from "node:path";

const runtimePackageSeeds = [
    "@clack/core",
    "@clack/prompts",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@libsql/client",
    "@libsql/isomorphic-ws",
    "@vue/runtime-core",
    "@vue/runtime-dom",
    "@vue/server-renderer",
    "chokidar",
    "commander",
    "diff",
    "dotenv",
    "esbuild",
    "fflate",
    "get-tsconfig",
    "h3",
    "picocolors",
    "sisteransi",
    "typebox",
    "tsx",
    "typescript",
    "undici",
    "ws",
    "yaml",
    "yazl",
    "zod",
];
const windowsRuntimePackageSeeds = [
    "@esbuild/win32-x64",
];
const effectiveRuntimePackageSeeds = [
    ...runtimePackageSeeds,
    ...(process.platform === "win32" ? windowsRuntimePackageSeeds : []),
];
const runtimeContextPaths = [
    "AGENTS.md",
    "reference",
    "docs",
    "assets/workspace",
    "server",
    "shared",
    "prisma/migrations/sqlite",
    "prisma/schema.sqlite.prisma",
    "prisma.config.ts",
    "scripts/cli/create-admin.ts",
    "scripts/cli/has-users.ts",
    "scripts/cli/sync-user-assets.ts",
    "scripts/deploy/product-start.mjs",
    "scripts/db",
    "scripts/build/profile.ts",
    "scripts/build/variable.ts",
    "scripts/utils",
    "tsconfig.json",
    ".nuxt/tsconfig.json",
    ".nuxt/tsconfig.server.json",
];
const serverRoot = resolve(".output", "server");
const githubUrl = "https://github.com/notnotype/neuro-book";
const illegalImportMetaFallback = "file:///_entry.js";
const importMetaFallbackShape = '{url:"file:///_entry.js",env:process.env}';

const timings = [];
const packageCopyStats = {
    copied: 0,
    skipped: 0,
};

await measure("copy runtime package closure", async () => {
    await copyRuntimePackageClosure(effectiveRuntimePackageSeeds);
});

await measure("copy profile import context", async () => {
    for (const runtimePath of runtimeContextPaths) {
        const source = resolve(runtimePath);
        const target = resolve(serverRoot, runtimePath);
        if (!existsSync(source)) {
            throw new Error(`缺少 Nitro runtime 文件：${runtimePath}`);
        }
        await rm(target, {recursive: true, force: true});
        await mkdir(dirname(target), {recursive: true});
        await copyDirectory(source, target);
    }
});

await measure("copy workspace cli runtime script", async () => {
    await copyWorkspaceCliRuntimeScript();
});
await measure("write release metadata", async () => {
    await writeReleaseMeta();
});
await measure("copy nbook runtime package", async () => {
    await copyNbookRuntimePackage();
});
const patchedImportMetaFiles = await measure("patch import.meta fallbacks", async () => {
    return await patchImportMetaFallbacks(resolve(serverRoot, "chunks"));
});
await measure("assert import.meta fallbacks", async () => {
    await assertNoIllegalImportMetaFallbacks(resolve(serverRoot, "chunks"));
});

console.log(`patched Nitro runtime dependencies: ${effectiveRuntimePackageSeeds.join(", ")}`);
console.log(`copied profile import context: ${runtimeContextPaths.join(", ")}`);
console.log(`patched Nitro import.meta fallbacks: ${patchedImportMetaFiles}`);
console.log(`Nitro runtime package copy: copied=${packageCopyStats.copied}, skipped=${packageCopyStats.skipped}`);
console.log(`patch Nitro runtime deps timings: ${timings.map((item) => `${item.label}=${item.seconds.toFixed(2)}s`).join(", ")}`);

/**
 * 记录 Product Runtime 后处理阶段耗时，便于定位 Windows 大量小文件复制瓶颈。
 */
async function measure(label, action) {
    const startedAt = performance.now();
    try {
        return await action();
    } finally {
        timings.push({
            label,
            seconds: (performance.now() - startedAt) / 1000,
        });
    }
}

/**
 * Nitro 的部分 server chunks 会生成 `file:///_entry.js` 作为 import.meta fallback。
 * 这个 URL 在 Windows 下不是合法绝对 file URL。这里把它改成从当前 chunk
 * 指回 `.output/server/index.mjs` 的合法 URL，同时保留 server root 语义。
 */
async function patchImportMetaFallbacks(root) {
    let count = 0;
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (!text.includes(illegalImportMetaFallback)) {
            continue;
        }
        const entrySpecifier = relative(dirname(filePath), resolve(serverRoot, "index.mjs")).replaceAll("\\", "/");
        const normalizedSpecifier = entrySpecifier.startsWith(".") ? entrySpecifier : `./${entrySpecifier}`;
        const next = text.replaceAll(
            importMetaFallbackShape,
            `{url:new URL(${JSON.stringify(normalizedSpecifier)},import.meta.url).href,env:process.env}`,
        );
        if (next !== text) {
            await writeFile(filePath, next, "utf8");
            count += 1;
        }
    }
    return count;
}

/**
 * 把 Windows runtime 兼容修复变成构建门禁：如果 Nitro 改了产物格式，
 * 导致上面的精确替换失效，构建应直接失败，避免 release zip 带着已知坏产物。
 */
async function assertNoIllegalImportMetaFallbacks(root) {
    const offenders = [];
    for (const filePath of await listMjsFiles(root)) {
        const text = await readFile(filePath, "utf8");
        if (text.includes(illegalImportMetaFallback)) {
            offenders.push(relative(process.cwd(), filePath).replaceAll("\\", "/"));
        }
    }
    if (offenders.length > 0) {
        throw new Error([
            "Nitro build output still contains Windows-invalid import.meta fallback.",
            `Fallback: ${illegalImportMetaFallback}`,
            "Files:",
            ...offenders.map((filePath) => `- ${filePath}`),
        ].join("\n"));
    }
}

/**
 * 写入构建期版本元数据，生产版本接口优先读取这个文件。
 */
async function writeReleaseMeta() {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    const tag = await runCapture("git", ["describe", "--tags", "--exact-match", "HEAD"]).catch(() => "");
    const commit = await runCapture("git", ["rev-parse", "--short", "HEAD"]).catch(() => "");
    const buildCommit = await runCapture("git", ["rev-parse", "HEAD"]).catch(() => "");
    const versionLabel = tag.trim() || commit.trim() || packageJson.version || "unknown";
    const sourceKind = tag.trim() ? "tag" : commit.trim() ? "commit" : "package";
    await writeFile(resolve(serverRoot, "release-meta.json"), `${JSON.stringify({
        versionLabel,
        versionKind: "release",
        sourceKind,
        buildCommit: buildCommit.trim() || null,
        packageVersion: packageJson.version ?? null,
        createdAt: new Date().toISOString(),
        githubUrl,
    }, null, 4)}\n`, "utf8");
}

/**
 * 为 product 内源码脚本提供 `nbook/*` 解析入口。
 * 这里复制一个真实的本地包目录，并把应用源码根打包进去，
 * 这样 `.output/server/scripts/**`、worker 和 CLI 都不用回退到仓库根。
 */
async function copyNbookRuntimePackage() {
    const packageRoot = resolve(serverRoot, "node_modules", "nbook");
    await rm(packageRoot, {recursive: true, force: true});
    await mkdir(packageRoot, {recursive: true});
    await writeFile(resolve(packageRoot, "package.json"), `${JSON.stringify({
        name: "nbook",
        version: JSON.parse(await readFile(resolve("package.json"), "utf8")).version ?? "0.0.0",
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
    await copyDirectory(resolve("server"), resolve(packageRoot, "server"));
    await copyDirectory(resolve("shared"), resolve(packageRoot, "shared"));
    await copyDirectory(resolve("app"), resolve(packageRoot, "app"));
}

/**
 * 把 Agent-facing workspace CLI 复制到 `.output/server` 内，方便产品包
 * 从 `.output/server/node_modules` 解析 runtime vendor。
 */
async function copyWorkspaceCliRuntimeScript() {
    const source = resolve("assets", "workspace", ".nbook", "agent", "scripts", "workspace.ts");
    const target = resolve(serverRoot, "scripts", "agent", "workspace.ts");
    if (!existsSync(source)) {
        throw new Error("缺少 Agent workspace CLI: assets/workspace/.nbook/agent/scripts/workspace.ts");
    }
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    await copyDirectory(source, target);
}

/**
 * 复制一组 runtime 入口包及其 runtime dependencies 闭包。
 */
async function copyRuntimePackageClosure(seedPackages) {
    const queue = [...seedPackages];
    const seen = new Set();
    while (queue.length > 0) {
        const packageName = queue.shift();
        if (!packageName || seen.has(packageName)) {
            continue;
        }
        seen.add(packageName);
        const source = resolve("node_modules", ...packageName.split("/"));
        const target = resolve(".output", "server", "node_modules", ...packageName.split("/"));
        if (!existsSync(source)) {
            throw new Error(`缺少 Nitro runtime package: ${packageName}`);
        }
        if (await isRuntimePackageCurrent(source, target)) {
            packageCopyStats.skipped += 1;
        } else {
            await rm(target, {recursive: true, force: true});
            await mkdir(dirname(target), {recursive: true});
            await copyDirectory(source, target);
            packageCopyStats.copied += 1;
        }

        const packageJsonPath = resolve(source, "package.json");
        if (!existsSync(packageJsonPath)) {
            continue;
        }
        const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
        const dependencies = packageJson.dependencies ?? {};
        for (const dependencyName of Object.keys(dependencies)) {
            if (!seen.has(dependencyName)) {
                queue.push(dependencyName);
            }
        }
        const optionalDependencies = packageJson.optionalDependencies ?? {};
        for (const dependencyName of Object.keys(optionalDependencies)) {
            const dependencyPath = resolve("node_modules", ...dependencyName.split("/"));
            if (!seen.has(dependencyName) && existsSync(dependencyPath)) {
                queue.push(dependencyName);
            }
        }
    }
}

/**
 * 已复制过且 package manifest 完全一致时跳过整包复制。
 * Product vendor 主要来自已安装依赖；包升级或重装会改变 package.json，
 * 从而触发重新复制。
 */
async function isRuntimePackageCurrent(source, target) {
    const sourcePackageJsonPath = resolve(source, "package.json");
    const targetPackageJsonPath = resolve(target, "package.json");
    if (!existsSync(sourcePackageJsonPath) || !existsSync(targetPackageJsonPath)) {
        return false;
    }
    const [sourcePackageJson, targetPackageJson] = await Promise.all([
        readFile(sourcePackageJsonPath, "utf8"),
        readFile(targetPackageJsonPath, "utf8"),
    ]);
    return sourcePackageJson === targetPackageJson;
}

/**
 * Windows 下大量小文件目录复制用 robocopy 通常快于 Node `fs.cp`。
 * 其他平台保持 Node 原生复制，避免引入额外系统依赖。
 */
async function copyDirectory(source, target) {
    const sourceStat = await stat(source);
    if (!sourceStat.isDirectory() || process.platform !== "win32") {
        await cp(source, target, {recursive: true});
        return;
    }
    await mkdir(target, {recursive: true});
    await runRobocopy(source, target);
}

/**
 * 运行 robocopy。robocopy 的 0-7 都表示成功或完成复制，8+ 才是失败。
 */
async function runRobocopy(source, target) {
    await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("robocopy", [
            source,
            target,
            "/MIR",
            "/NFL",
            "/NDL",
            "/NJH",
            "/NJS",
            "/NP",
        ], {
            stdio: ["ignore", "ignore", "pipe"],
            shell: false,
            windowsHide: true,
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", rejectPromise);
        child.on("close", (code) => {
            if (code !== null && code <= 7) {
                resolvePromise();
                return;
            }
            rejectPromise(new Error(`robocopy failed with exit code ${code}: ${stderr.trim()}`));
        });
    });
}

async function listMjsFiles(root) {
    const result = [];
    for (const entry of await readdir(root, {withFileTypes: true})) {
        const filePath = resolve(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...await listMjsFiles(filePath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".mjs")) {
            result.push(filePath);
        }
    }
    return result;
}

async function runCapture(command, args) {
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} interrupted: ${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(stderr.trim() || `${command} exit code ${code ?? 1}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}
