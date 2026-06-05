#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const productRoot = resolveProductRoot();
const entry = resolve(productRoot, ".output", "server", "index.mjs");
const productEnv = ensureProductEnv(productRoot);

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: productRoot,
    env: {
        ...productEnv,
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
    },
    stdio: "inherit",
    windowsHide: false,
});

child.on("error", (error) => {
    console.error(error);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});

/**
 * 从 product 根或 `.output/server/scripts/deploy` 副本启动时，都回推到 Product Root。
 */
function resolveProductRoot() {
    let current = dirname(fileURLToPath(import.meta.url));
    while (true) {
        const candidateEntry = resolve(current, ".output", "server", "index.mjs");
        if (existsSync(candidateEntry)) {
            return current;
        }
        const parent = resolve(current, "..");
        if (parent === current) {
            throw new Error("无法定位 Product Root：缺少 .output/server/index.mjs。");
        }
        current = parent;
    }
}

/**
 * 加载 Product Root `.env`，缺少 session password 时生成并持久化。
 */
function ensureProductEnv(root) {
    const envPath = resolve(root, ".env");
    const parsed = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
    if (!process.env.NUXT_SESSION_PASSWORD && !parsed.NUXT_SESSION_PASSWORD) {
        parsed.NUXT_SESSION_PASSWORD = randomBytes(32).toString("hex");
        writeEnv(envPath, parsed);
    }
    return parsed;
}

/**
 * 解析简单 KEY=VALUE `.env` 文件。
 */
function parseEnv(text) {
    const result = {};
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const separator = line.indexOf("=");
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        result[key] = value.replace(/^['"]|['"]$/gu, "");
    }
    return result;
}

/**
 * 写回 Product Root `.env`。
 */
function writeEnv(path, values) {
    const lines = Object.entries(values)
        .map(([key, value]) => `${key}=${value}`);
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}
