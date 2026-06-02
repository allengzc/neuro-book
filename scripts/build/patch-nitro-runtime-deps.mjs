#!/usr/bin/env node
import {cp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";

const runtimePackages = [
    "@libsql/isomorphic-ws",
    "ws",
];
const runtimeContextPaths = [
    "AGENTS.md",
    "reference",
    "docs",
];
const serverRoot = resolve(".output", "server");
const illegalImportMetaFallback = "file:///_entry.js";
const importMetaFallbackShape = '{url:"file:///_entry.js",env:process.env}';

for (const packageName of runtimePackages) {
    const source = resolve("node_modules", ...packageName.split("/"));
    const target = resolve(".output", "server", "node_modules", ...packageName.split("/"));
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target, {recursive: true});
}

for (const runtimePath of runtimeContextPaths) {
    const source = resolve(runtimePath);
    const target = resolve(serverRoot, runtimePath);
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target, {recursive: true});
}

const patchedImportMetaFiles = await patchImportMetaFallbacks(resolve(serverRoot, "chunks"));
await assertNoIllegalImportMetaFallbacks(resolve(serverRoot, "chunks"));

console.log(`patched Nitro runtime dependencies: ${runtimePackages.join(", ")}`);
console.log(`copied profile import context: ${runtimeContextPaths.join(", ")}`);
console.log(`patched Nitro import.meta fallbacks: ${patchedImportMetaFiles}`);

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
