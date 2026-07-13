#!/usr/bin/env bun
import {existsSync} from "node:fs";
import {mkdir, readFile, readdir, stat, writeFile} from "node:fs/promises";
import {basename, dirname, relative, resolve} from "node:path";
import {Command} from "commander";
import {unzipSync} from "fflate";

import {parseReleaseManifest} from "nbook/packages/neuro-book-manager/src/schema";
import {verifyReleaseChecksums, writeReleaseChecksums} from "nbook/scripts/release/release-checksums";
import {run, runCapture} from "nbook/scripts/utils/process.mjs";
import {writeZipArchive} from "nbook/scripts/utils/zip";

const ROOT = resolve(import.meta.dir, "..", "..");

const program = new Command().name("release-assets");

program.command("source")
    .requiredOption("--output <path>")
    .action((options: {output: string}) => buildSourceArchive(resolve(ROOT, options.output)));

program.command("product")
    .requiredOption("--platform <platform>")
    .requiredOption("--output <path>")
    .action((options: {platform: string; output: string}) => buildProductArchive(options.platform, resolve(ROOT, options.output)));

program.command("manifest")
    .requiredOption("--tag <tag>")
    .requiredOption("--revision <sha>")
    .requiredOption("--manager-version <version>")
    .requiredOption("--source <path>")
    .requiredOption("--windows-product <path>")
    .requiredOption("--linux-product <path>")
    .requiredOption("--portable <path>")
    .requiredOption("--stage0-windows <path>")
    .requiredOption("--stage0-windows-cmd <path>")
    .requiredOption("--stage0-linux <path>")
    .requiredOption("--ghcr-ref <ref>")
    .requiredOption("--ghcr-digest <digest>")
    .requiredOption("--output <path>")
    .action((options: ManifestOptions) => buildReleaseManifest(options));

program.command("verify")
    .requiredOption("--dir <path>")
    .requiredOption("--tag <tag>")
    .requiredOption("--revision <sha>")
    .action((options: {dir: string; tag: string; revision: string}) => verifyReleaseAssets(resolve(ROOT, options.dir), options.tag, options.revision));

await program.parseAsync(process.argv);

type ManifestOptions = {
    tag: string;
    revision: string;
    managerVersion: string;
    source: string;
    windowsProduct: string;
    linuxProduct: string;
    portable: string;
    stage0Windows: string;
    stage0WindowsCmd: string;
    stage0Linux: string;
    ghcrRef: string;
    ghcrDigest: string;
    output: string;
};

/** 把 Git tracked 源码打成平台无关 zip。 */
async function buildSourceArchive(output: string): Promise<void> {
    const files = await trackedFiles();
    await writeZipArchive(output, files.map((path) => ({kind: "file", source: resolve(ROOT, path), archivePath: path})));
    console.log(`Source archive: ${relative(ROOT, output)} (${files.length} files)`);
}

/** 把当前平台 `.output` 打成 Product overlay。 */
async function buildProductArchive(platform: string, output: string): Promise<void> {
    if (!existsSync(resolve(ROOT, ".output", "server", "index.mjs"))) {
        throw new Error("缺少 .output/server/index.mjs，请先执行 bun run nuxt:build。");
    }
    await mkdir(dirname(output), {recursive: true});
    if (platform === "windows-x64") {
        const files = await directoryFiles(resolve(ROOT, ".output"));
        await writeZipArchive(output, files.map((path) => ({
            kind: "file",
            source: resolve(ROOT, ".output", path),
            archivePath: `.output/${path}`,
        })));
        return;
    }
    if (platform === "linux-x64-glibc") {
        await run("tar", ["-czf", output, ".output"], {cwd: ROOT});
        return;
    }
    throw new Error(`不支持的 Product 平台：${platform}`);
}

/** 汇总平台产物、GHCR digest 和 checksum，生成正式 Release Manifest。 */
async function buildReleaseManifest(options: ManifestOptions): Promise<void> {
    const tag = options.tag.startsWith("v") ? options.tag : `v${options.tag}`;
    const version = tag.slice(1);
    const packageVersion = String((await Bun.file(resolve(ROOT, "package.json")).json() as {version: string}).version);
    if (version !== packageVersion) {
        throw new Error(`Release tag ${tag} 与 package.json version ${packageVersion} 不一致。`);
    }
    const baseUrl = `https://github.com/notnotype/neuro-book/releases/download/${encodeURIComponent(tag)}`;
    const source = await asset(resolve(ROOT, options.source), baseUrl);
    const windowsProduct = await asset(resolve(ROOT, options.windowsProduct), baseUrl);
    const linuxProduct = await asset(resolve(ROOT, options.linuxProduct), baseUrl);
    const portable = await asset(resolve(ROOT, options.portable), baseUrl);
    const manifest = {
        schemaVersion: 2,
        version,
        channel: version.includes("-") ? "canary" : "stable",
        sourceRevision: options.revision,
        minManagerVersion: options.managerVersion,
        source,
        products: [
            {...windowsProduct, platform: "windows-x64", sourceRevision: options.revision},
            {...linuxProduct, platform: "linux-x64-glibc", sourceRevision: options.revision},
        ],
        windowsPortable: portable,
        ghcr: {
            ref: options.ghcrRef,
            digest: options.ghcrDigest,
            sourceRevision: options.revision,
        },
    };
    parseReleaseManifest(manifest);
    const output = resolve(ROOT, options.output);
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
    const allFiles = [
        resolve(ROOT, options.source),
        resolve(ROOT, options.windowsProduct),
        resolve(ROOT, options.linuxProduct),
        resolve(ROOT, options.portable),
        output,
        resolve(ROOT, options.stage0Windows),
        resolve(ROOT, options.stage0WindowsCmd),
        resolve(ROOT, options.stage0Linux),
    ];
    await writeReleaseChecksums(allFiles, resolve(dirname(output), "SHA256SUMS"));
}

/** 对最终公开资产重新计算 checksum，并检查 Product/Portable 平台内容。 */
async function verifyReleaseAssets(directory: string, tagInput: string, revision: string): Promise<void> {
    const tag = tagInput.startsWith("v") ? tagInput : `v${tagInput}`;
    const manifest = parseReleaseManifest(JSON.parse(await readFile(resolve(directory, "release-manifest.json"), "utf8")));
    if (`v${manifest.version}` !== tag || manifest.sourceRevision !== revision) {
        throw new Error("Release tag、revision 与 release-manifest.json 不一致。" );
    }
    await verifyReleaseChecksums(directory, [
        "neuro-book-source.zip",
        "neuro-book-product-windows-x64.zip",
        "neuro-book-product-linux-x64-glibc.tar.gz",
        "neuro-book-windows-x64.zip",
        "release-manifest.json",
        "install.ps1",
        "install.cmd",
        "install.sh",
    ]);
    const expectedAssets = [manifest.source, ...manifest.products, manifest.windowsPortable];
    for (const expected of expectedAssets) {
        const path = resolve(directory, basename(new URL(expected.url).pathname));
        const bytes = await readFile(path);
        const checksum = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
        if (checksum !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error(`Release 资产 checksum/bytes 不匹配：${basename(path)}`);
    }
    const sourceEntries = Object.keys(unzipSync(await readFile(resolve(directory, "neuro-book-source.zip"))));
    if (sourceEntries.some((entry) => entry.startsWith(".git/") || entry.startsWith("node_modules/") || entry.startsWith(".output/"))) {
        throw new Error("Source archive 包含禁止目录。" );
    }
    const windowsEntries = Object.keys(unzipSync(await readFile(resolve(directory, "neuro-book-product-windows-x64.zip"))));
    assertEntries(windowsEntries, [
        ".output/server/index.mjs",
        ".output/server/node_modules/@libsql/win32-x64-msvc/",
        ".output/server/node_modules/sqlite-vec-windows-x64/",
    ], "Windows Product");
    const linuxEntries = (await runCapture("tar", ["-tzf", resolve(directory, "neuro-book-product-linux-x64-glibc.tar.gz")], {cwd: directory})).split(/\r?\n/u);
    assertEntries(linuxEntries, [
        ".output/server/index.mjs",
        ".output/server/node_modules/@libsql/linux-x64-gnu/",
        ".output/server/node_modules/sqlite-vec-linux-x64/",
    ], "Linux Product");
    const portableEntries = Object.keys(unzipSync(await readFile(resolve(directory, "neuro-book-windows-x64.zip"))));
    assertEntries(portableEntries, [
        ".deploy/installation.json",
        ".runtime/bin/neuro-book.cmd",
        "data/config.yaml",
        "data/logs/",
        "Start Neuro Book.cmd",
        "Create Admin.cmd",
    ], "Windows Portable");
}

function assertEntries(entries: string[], required: string[], label: string): void {
    const normalized = entries.map((entry) => entry.replace(/^\.\//u, ""));
    for (const prefix of required) {
        if (!normalized.some((entry) => entry === prefix || entry.startsWith(prefix))) throw new Error(`${label} 缺少：${prefix}`);
    }
}

async function asset(path: string, baseUrl: string): Promise<{url: string; sha256: string; bytes: number}> {
    const file = Bun.file(path);
    const bytes = await file.arrayBuffer();
    return {
        url: `${baseUrl}/${encodeURIComponent(basename(path))}`,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        bytes: (await stat(path)).size,
    };
}

async function trackedFiles(): Promise<string[]> {
    return (await runCapture("git", ["ls-files", "-z"], {cwd: ROOT}))
        .split("\0")
        .filter(Boolean)
        .filter((path) => existsSync(resolve(ROOT, path)))
        .sort();
}

async function directoryFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const absolute = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolute);
            } else if (entry.isFile()) {
                result.push(relative(root, absolute).replaceAll("\\", "/"));
            }
        }
    };
    await visit(root);
    return result.sort();
}
