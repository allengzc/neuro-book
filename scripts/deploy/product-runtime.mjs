#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync} from "node:fs";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRODUCT_ROOT = resolve(REPO_ROOT, "product");
const GITHUB_URL = "https://github.com/notnotype/neuro-book";
const RELEASE_META_FILE = "release-meta.json";

const command = process.argv[2] ?? "stage";

if (command === "stage") {
    await stageProduct();
} else if (command === "start") {
    await startProduct();
} else if (command === "create-admin") {
    await runProductScript([".output/server/scripts/cli/create-admin.ts", ...process.argv.slice(3)]);
} else {
    throw new Error(`未知 product runtime 命令：${command}`);
}

/**
 * 生成本地 product/ 成品验证根。
 */
async function stageProduct() {
    process.chdir(REPO_ROOT);
    await assertBuildOutput();
    await rm(PRODUCT_ROOT, {recursive: true, force: true});
    await mkdir(PRODUCT_ROOT, {recursive: true});

    await copyPath(".output", ".output");
    await copyPath("assets/workspace", "assets/workspace");
    await cleanupProductGeneratedSourceArtifacts();
    await copyPath("AGENTS.md", "AGENTS.md");
    await copyPath("reference", "reference");
    await copyPath("docs", "docs");
    await copyRuntimeSources();
    await copyRuntimeScripts();
    await writeProductWorkspaceScriptWrapper();
    await copyPrismaRuntimeFiles();
    await copyPath(".nuxt/tsconfig.json", ".nuxt/tsconfig.json");
    await copyPath(".nuxt/tsconfig.server.json", ".nuxt/tsconfig.server.json");
    await writeProductTsConfig();
    await writeProductPackageJson();
    await writeProductEnv();
    await writeReleaseMeta(PRODUCT_ROOT);
    await copyNbookRuntimePackage();
    await prepareProductSystemAssets();
    await assertProductTsxVendor();

    console.log(`Product runtime staged: ${relative(REPO_ROOT, PRODUCT_ROOT).replaceAll("\\", "/")}`);
}

/**
 * 从 product/ 根启动 Nitro 标准入口。
 */
async function startProduct() {
    await runProductScript([".output/server/scripts/deploy/product-start.mjs", ...process.argv.slice(3)], {
        command: process.execPath,
    });
}

/**
 * 在 product/ 根运行脚本，保证 process.cwd() 是 Product Root。
 */
async function runProductScript(args, options = {}) {
    if (!existsSync(PRODUCT_ROOT)) {
        throw new Error("product/ 不存在，请先运行 bun run product:stage。");
    }
    await run(options.command ?? "bun", args, {
        cwd: PRODUCT_ROOT,
        env: {
            ...process.env,
            ...options.env,
        },
    });
}

/**
 * 确认 Nuxt build 产物存在。
 */
async function assertBuildOutput() {
    const entry = resolve(REPO_ROOT, ".output", "server", "index.mjs");
    if (!existsSync(entry)) {
        throw new Error("缺少 .output/server/index.mjs，请先运行 bun run nuxt:build。");
    }
}

/**
 * 复制 product runtime 需要的 scripts allowlist。
 */
async function copyRuntimeScripts() {
    const files = [
        "scripts/cli/create-admin.ts",
        "scripts/cli/has-users.ts",
        "scripts/cli/sync-user-assets.ts",
        "scripts/deploy/product-start.mjs",
        "scripts/db",
        "scripts/build/prepare-system-assets.ts",
        "scripts/build/profile.ts",
        "scripts/build/variable.ts",
    ];
    for (const file of files) {
        await copyPath(file, file);
    }
    await copyPath("scripts/utils", "scripts/utils");
    await copyPath("scripts/cli/create-admin.ts", ".output/server/scripts/cli/create-admin.ts");
    await copyPath("scripts/cli/has-users.ts", ".output/server/scripts/cli/has-users.ts");
    await copyPath("scripts/cli/sync-user-assets.ts", ".output/server/scripts/cli/sync-user-assets.ts");
    await copyPath("scripts/deploy/product-start.mjs", ".output/server/scripts/deploy/product-start.mjs");
    await copyPath("scripts/db", ".output/server/scripts/db");
    await copyPath("scripts/build/prepare-system-assets.ts", ".output/server/scripts/build/prepare-system-assets.ts");
    await copyPath("scripts/build/profile.ts", ".output/server/scripts/build/profile.ts");
    await copyPath("scripts/build/variable.ts", ".output/server/scripts/build/variable.ts");
    await copyPath("scripts/utils", ".output/server/scripts/utils");
    await copyPath("assets/workspace/.nbook/agent/scripts/workspace.ts", ".output/server/scripts/agent/workspace.ts");
}

/**
 * 产品包内的 Agent workspace CLI 脚本只做 launcher，真实实现放在
 * `.output/server/scripts/agent/workspace.ts`，以便使用 Nitro vendor。
 */
async function writeProductWorkspaceScriptWrapper() {
    await writeFile(resolve(PRODUCT_ROOT, "assets", "workspace", ".nbook", "agent", "scripts", "workspace.ts"), [
        'import {pathToFileURL} from "node:url";',
        'import path from "node:path";',
        'import fs from "node:fs/promises";',
        "",
        "const workspaceEntry = await resolveWorkspaceEntry(import.meta.dirname);",
        "await import(pathToFileURL(workspaceEntry).href);",
        "",
        "async function resolveWorkspaceEntry(startDirectory) {",
        "    let currentDirectory = path.resolve(startDirectory);",
        "    while (true) {",
        '        const productEntry = path.join(currentDirectory, ".output", "server", "scripts", "agent", "workspace.ts");',
        "        if (await pathExists(productEntry)) {",
        "            return productEntry;",
        "        }",
        "        const parentDirectory = path.dirname(currentDirectory);",
        "        if (parentDirectory === currentDirectory) {",
        '            throw new Error("Cannot locate NeuroBook product workspace CLI entry.");',
        "        }",
        "        currentDirectory = parentDirectory;",
        "    }",
        "}",
        "",
        "async function pathExists(filePath) {",
        "    try {",
        "        await fs.access(filePath);",
        "        return true;",
        "    } catch {",
        "        return false;",
        "    }",
        "}",
        "",
    ].join("\n"), "utf8");
}

/**
 * 复制产品脚本和 TSX profile compiler 需要的运行源码子集。
 */
async function copyRuntimeSources() {
    await copyPath("server", "server");
    await copyPath("shared", "shared");
    await rm(resolve(PRODUCT_ROOT, "server", "agent", "variables", "generated-profile-variable-types.d.ts"), {force: true});
}

async function cleanupProductGeneratedSourceArtifacts() {
    await rm(resolve(PRODUCT_ROOT, "assets", "workspace", ".nbook", "agent", "profiles", ".system-profile-metadata.json"), {force: true});
}

/**
 * 复制 SQLite migration 和产品脚本需要的 Prisma 文件。
 */
async function copyPrismaRuntimeFiles() {
    await copyPath("prisma/migrations/sqlite", "prisma/migrations/sqlite");
    await copyPath("prisma/schema.sqlite.prisma", "prisma/schema.sqlite.prisma");
    await copyPath("prisma.config.ts", "prisma.config.ts");
}

/**
 * 写入 Product Root 专用 TS 配置。
 *
 * 成品脚本通过 `tsx` 执行时必须把 `nbook/*` 解析到 Nitro vendor 里的
 * runtime package，避免从 Product Root 的 `server/` 源码子集向上寻找依赖。
 */
async function writeProductTsConfig() {
    const source = JSON.parse(await readFile(resolve(REPO_ROOT, "tsconfig.json"), "utf8"));
    source.compilerOptions = {
        ...source.compilerOptions,
        baseUrl: ".",
        paths: {
            ...source.compilerOptions?.paths,
            "nbook/*": [
                ".output/server/node_modules/nbook/*",
            ],
            "neuro_book/*": [
                ".output/server/node_modules/nbook/*",
            ],
        },
    };
    await writeJson(resolve(PRODUCT_ROOT, "tsconfig.json"), source);
}

/**
 * 写入 product 根 package.json，只保留产品脚本和 metadata。
 */
async function writeProductPackageJson() {
    const source = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8"));
    const manifest = {
        name: "neuro-book-product",
        version: source.version ?? "0.0.0",
        private: true,
        type: "module",
        scripts: {
            start: "bun .output/server/scripts/deploy/product-start.mjs",
            "auth:create-admin": "bun .output/server/scripts/cli/create-admin.ts",
            "migrate:deploy": "bun .output/server/scripts/db/prisma-migrate.mjs --deploy",
            "system-assets:prepare": "bun .output/server/scripts/build/prepare-system-assets.ts",
            "profile:check": "bun .output/server/scripts/build/profile.ts check",
            "profile:compile": "bun .output/server/scripts/build/profile.ts compile",
        },
    };
    await writeJson(resolve(PRODUCT_ROOT, "package.json"), manifest);
}

/**
 * 写入产品本地 `.env`。裸 Nitro 入口不会自动读取该文件；产品启动脚本会加载它，
 * 直接运行时优先使用 `bun .output/server/scripts/deploy/product-start.mjs`。
 */
async function writeProductEnv() {
    await writeFile(resolve(PRODUCT_ROOT, ".env"), [
        `NUXT_SESSION_PASSWORD=${randomBytes(32).toString("hex")}`,
        "DATABASE_KIND=sqlite",
        "DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite",
        "",
    ].join("\n"), "utf8");
}

/**
 * 写入 release metadata，供产品版本 API 读取。
 */
async function writeReleaseMeta(root) {
    const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8"));
    const tag = await runCapture("git", ["describe", "--tags", "--exact-match", "HEAD"], {cwd: REPO_ROOT}).catch(() => "");
    const commit = await runCapture("git", ["rev-parse", "--short", "HEAD"], {cwd: REPO_ROOT}).catch(() => "");
    const buildCommit = await runCapture("git", ["rev-parse", "HEAD"], {cwd: REPO_ROOT}).catch(() => "");
    const versionLabel = tag.trim() || commit.trim() || packageJson.version || "unknown";
    const sourceKind = tag.trim() ? "tag" : commit.trim() ? "commit" : "package";
    await writeJson(resolve(root, RELEASE_META_FILE), {
        versionLabel,
        versionKind: "release",
        sourceKind,
        buildCommit: buildCommit.trim() || null,
        packageVersion: packageJson.version ?? null,
        createdAt: new Date().toISOString(),
        githubUrl: GITHUB_URL,
    });
}

/**
 * 为 staged product 补齐 `nbook/*` 包解析，避免产品脚本回退到开发机根依赖。
 */
async function copyNbookRuntimePackage() {
    const packageRoot = resolve(PRODUCT_ROOT, ".output", "server", "node_modules", "nbook");
    await rm(packageRoot, {recursive: true, force: true});
    await mkdir(packageRoot, {recursive: true});
    await writeJson(resolve(packageRoot, "package.json"), {
        name: "nbook",
        version: JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8")).version ?? "0.0.0",
        private: true,
        type: "module",
    });
    await cp(resolve(PRODUCT_ROOT, ".output", "server", "server"), resolve(packageRoot, "server"), {recursive: true});
    await cp(resolve(PRODUCT_ROOT, ".output", "server", "shared"), resolve(packageRoot, "shared"), {recursive: true});
    await cp(resolve(REPO_ROOT, "app"), resolve(packageRoot, "app"), {recursive: true});
    const profileDslRoot = resolve(packageRoot, "server", "agent", "profiles", "profile-dsl");
    await writeFile(resolve(profileDslRoot, "index.jsx"), 'export * from "../profile-dsl.ts";\n', "utf8");
    await writeFile(resolve(profileDslRoot, "index.js"), 'export * from "../profile-dsl.ts";\n', "utf8");
}

/**
 * 在 Product Root 内准备系统 assets，确保 artifact 依赖绑定 Product Runtime。
 */
async function prepareProductSystemAssets() {
    await run("bun", [".output/server/scripts/build/prepare-system-assets.ts", "--force"], {
        cwd: PRODUCT_ROOT,
    });
}

/**
 * 确认 Profile Workbench worker 依赖从 Product Root 的 Nitro vendor 解析。
 */
async function assertProductTsxVendor() {
    const requireFromProductOutput = createRequire(pathToFileURL(resolve(PRODUCT_ROOT, ".output", "server", "index.mjs")));
    const resolvedApi = requireFromProductOutput.resolve("tsx/esm/api");
    const normalized = resolvedApi.replaceAll("\\", "/");
    if (!normalized.includes("/.output/server/node_modules/tsx/")) {
        throw new Error(`Product runtime tsx vendor 解析错误：${resolvedApi}`);
    }
    const api = await import(pathToFileURL(resolvedApi).href);
    if (typeof api.tsImport !== "function") {
        throw new Error("Product runtime tsx vendor 缺少 tsImport，请确认 .output/server/node_modules/tsx 完整复制。");
    }
}

/**
 * 复制文件或目录到 product/。
 */
async function copyPath(sourceRelative, targetRelative) {
    const source = resolve(REPO_ROOT, sourceRelative);
    const target = resolve(PRODUCT_ROOT, targetRelative);
    if (!existsSync(source)) {
        throw new Error(`缺少 product runtime 文件：${sourceRelative}`);
    }
    await mkdir(dirname(target), {recursive: true});
    await rm(target, {recursive: true, force: true});
    await cp(source, target, {recursive: true});
}

/**
 * 写格式化 JSON。
 */
async function writeJson(path, value) {
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

/**
 * 执行命令并继承 stdio。
 */
async function run(command, args, options = {}) {
    await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: "inherit",
            shell: false,
            windowsHide: false,
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`${command} 退出码：${code ?? 1}`));
                return;
            }
            resolvePromise();
        });
    });
}

/**
 * 执行命令并返回 stdout。
 */
async function runCapture(command, args, options = {}) {
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
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
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(stderr.trim() || `${command} 退出码：${code ?? 1}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}
