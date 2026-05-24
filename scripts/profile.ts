import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import {randomUUID} from "node:crypto";
import {compileProfileArtifacts, readProfileArtifactManifest, validateProfileArtifact} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {previewAgentProfilePrepare, readAgentProfileDetail} from "nbook/server/agent/profiles/profile-http-service";
import type {JsonValue} from "nbook/server/agent/messages/types";

type ProfileCommand = "status" | "check" | "compile" | "preview";

type CliOptions = {
    command: ProfileCommand;
    target?: string;
    all: boolean;
    system: boolean;
    input?: JsonValue;
    sessionId?: string;
};

const SYSTEM_PROFILE_ROOT = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const USER_PROFILE_ROOT = path.resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles");

await main();

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
        process.exitCode = 1;
        return;
    }
    try {
        switch (options.command) {
            case "status":
                await runStatus(options);
                return;
            case "check":
                await runCheck(options);
                return;
            case "compile":
                await runCompile(options);
                return;
            case "preview":
                await runPreview(options);
                return;
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

function parseArgs(args: string[]): CliOptions | null {
    const command = args.shift() as ProfileCommand | undefined;
    if (!command || !["status", "check", "compile", "preview"].includes(command)) {
        printUsage();
        return null;
    }
    const options: CliOptions = {
        command,
        all: false,
        system: false,
    };
    while (args.length > 0) {
        const arg = args.shift();
        if (!arg) {
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printUsage();
            return null;
        }
        if (arg === "--all") {
            options.all = true;
            continue;
        }
        if (arg === "--system") {
            options.system = true;
            continue;
        }
        if (arg === "--input-json") {
            const value = args.shift();
            if (!value) {
                throw new Error("--input-json 需要一个 JSON 字符串。");
            }
            options.input = JSON.parse(value) as JsonValue;
            continue;
        }
        if (arg === "--session-id") {
            const value = args.shift();
            if (!value) {
                throw new Error("--session-id 需要一个 session id。");
            }
            options.sessionId = value;
            continue;
        }
        if (arg.startsWith("--")) {
            throw new Error(`未知参数：${arg}`);
        }
        if (options.target) {
            throw new Error(`只能指定一个 profile 目标，多余参数：${arg}`);
        }
        options.target = arg;
    }
    if (!options.all && !options.target) {
        throw new Error(`${command} 需要指定 fileName/profileKey，或使用 --all。`);
    }
    return options;
}

async function runStatus(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    const manifest = await readProfileArtifactManifest(target.root);
    const items = options.all ? manifest.profiles : manifest.profiles.filter((item) => item.fileName === target.fileName || item.profileKey === target.profileKey);
    if (items.length === 0) {
        console.log("profile status: not_compiled");
        console.log(`profile root: ${target.rootKind}`);
        if (target.fileName) {
            console.log(`profile fileName: ${target.fileName}`);
        }
        return;
    }
    for (const item of items) {
        const validation = await validateProfileArtifact(target.root, item);
        console.log(`${item.profileKey}: ${validation.fresh ? "loaded" : "compile_stale"}`);
        console.log(`  fileName: ${item.fileName}`);
        console.log(`  artifact: ${item.artifactFileName}`);
        if (!validation.fresh) {
            console.log(`  reason: ${validation.reason}`);
        }
    }
}

async function runCheck(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    if (target.filePath && !runTypecheck(target.filePath)) {
        process.exitCode = 1;
        return;
    }
    const catalog = catalogForOptions(options);
    const snapshot = await catalog.snapshot();
    const issueTarget = target.profileKey ?? target.fileName;
    const issues = snapshot.issues.filter((issue) => issue.profileKey === issueTarget || relativeInside(target.root, issue.sourcePath ?? "") === target.fileName);
    for (const issue of issues) {
        console.log(`[${issue.code}] ${issue.message}`);
    }
    if (issues.some((issue) => issue.code !== "filename_mismatch" && issue.code !== "builtin_schema_locked" && issue.code !== "system_profile_shadowed" && issue.code !== "not_compiled" && issue.code !== "compile_stale")) {
        process.exitCode = 1;
        return;
    }
    console.log("profile check passed");
}

async function runCompile(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    const result = await compileProfileArtifacts({
        profileRoot: target.root,
        fileName: options.all ? undefined : target.fileName,
        rootLabel: target.rootKind === "system" ? "assets/workspace/.nbook/agent/profiles" : "workspace/.nbook/agent/profiles",
    });
    console.log(`profile compile wrote ${result.compiled.length} artifact(s)`);
    for (const item of result.compiled) {
        console.log(`- ${item.profileKey}: ${item.fileName} -> .compiled/${item.artifactFileName}`);
    }
}

async function runPreview(options: CliOptions): Promise<void> {
    const target = await resolveTarget(options);
    if (options.all) {
        throw new Error("profile preview 不支持 --all，请指定一个 fileName 或 profileKey。");
    }
    const {catalog, profileKey, cleanup} = await compilePreviewCatalog(options, target);
    const preview = await previewAgentProfilePrepare(
        new NeuroAgentHarness({profiles: catalog}),
        {
            profileKey,
            input: options.input,
            sessionId: options.sessionId,
        },
    ).finally(cleanup);
    console.log(`preview ok: ${preview.ok ? "yes" : "no"}`);
    for (const issue of preview.issues) {
        console.log(`[${issue.severity}] ${issue.code ?? "issue"}: ${issue.message}`);
    }
    for (const message of preview.messages) {
        console.log(`\n## ${message.source ?? message.role}`);
        console.log(message.text);
    }
}

async function compilePreviewCatalog(
    options: CliOptions,
    target: Awaited<ReturnType<typeof resolveTarget>>,
): Promise<{
    catalog: AgentProfileCatalog;
    profileKey: string;
    cleanup: () => Promise<void>;
}> {
    if (!target.fileName || !target.filePath) {
        throw new Error("profile preview 需要能定位到源码文件，请传 fileName 或可从源码定位的 profileKey。");
    }
    const temporaryRoot = path.resolve(".agent", "workspace", "profile-cli-preview", randomUUID());
    const systemRoot = options.system ? temporaryRoot : SYSTEM_PROFILE_ROOT;
    const userRoot = options.system ? path.resolve(".agent", "missing-user-profiles") : temporaryRoot;
    try {
        await fsp.cp(target.root, temporaryRoot, {recursive: true, force: true});
        await compileProfileArtifacts({
            profileRoot: temporaryRoot,
            fileName: target.fileName,
            rootLabel: "temporary-profile-cli-preview",
        });
        const manifest = await readProfileArtifactManifest(temporaryRoot);
        const item = manifest.profiles.find((profile) => profile.fileName === target.fileName);
        if (!item) {
            throw new Error(`profile preview 无法从源码读取 profile key：${target.fileName}`);
        }
        return {
            catalog: new AgentProfileCatalog(systemRoot, userRoot),
            profileKey: item.profileKey,
            cleanup: () => fsp.rm(temporaryRoot, {recursive: true, force: true}),
        };
    } catch (error) {
        await fsp.rm(temporaryRoot, {recursive: true, force: true});
        throw error;
    }
}

function catalogForOptions(options: CliOptions): AgentProfileCatalog {
    if (options.system) {
        return new AgentProfileCatalog(SYSTEM_PROFILE_ROOT, path.resolve(".agent", "missing-user-profiles"));
    }
    return new AgentProfileCatalog(SYSTEM_PROFILE_ROOT, USER_PROFILE_ROOT);
}

async function resolveTarget(options: CliOptions): Promise<{
    root: string;
    rootKind: "system" | "user";
    fileName?: string;
    filePath?: string;
    profileKey?: string;
    manifestProfileKey?: string;
}> {
    const root = options.system ? SYSTEM_PROFILE_ROOT : USER_PROFILE_ROOT;
    const rootKind = options.system ? "system" as const : "user" as const;
    if (options.all) {
        return {root, rootKind};
    }
    const target = options.target!;
    const fileName = await resolveFileName(root, target);
    if (fileName) {
        const manifest = await readProfileArtifactManifest(root);
        const manifestItem = manifest.profiles.find((item) => item.fileName === fileName);
        return {
            root,
            rootKind,
            fileName,
            filePath: path.join(root, ...fileName.split("/")),
            manifestProfileKey: manifestItem?.profileKey,
        };
    }
    return {
        root,
        rootKind,
        profileKey: target,
    };
}

async function resolveFileName(root: string, target: string): Promise<string | null> {
    const normalized = target.split(/[\\/]+/).filter(Boolean).join("/");
    const direct = path.join(root, ...normalized.split("/"));
    if (/\.profile\.(tsx|ts|mjs|js)$/.test(path.basename(normalized)) && fs.existsSync(direct)) {
        return normalized;
    }
    const manifest = await readProfileArtifactManifest(root);
    const manifestItem = manifest.profiles.find((item) => item.profileKey === target);
    if (manifestItem) {
        return manifestItem.fileName;
    }
    return findProfileByKey(root, target);
}

async function findProfileByKey(root: string, profileKey: string): Promise<string | null> {
    const direct = `${profileKey}.profile.tsx`;
    if (fs.existsSync(path.join(root, direct))) {
        return direct;
    }
    const files = await findProfileFiles(root);
    for (const fileName of files) {
        const source = await fsp.readFile(path.join(root, ...fileName.split("/")), "utf8").catch(() => "");
        if (source.includes(`key: ${JSON.stringify(profileKey)}`) || source.includes(`key:${JSON.stringify(profileKey)}`)) {
            return fileName;
        }
    }
    return null;
}

async function findProfileFiles(root: string, current: string = root): Promise<string[]> {
    const entries = await fsp.readdir(current, {withFileTypes: true}).catch(() => []);
    const result: string[] = [];
    for (const entry of entries) {
        if (entry.name === ".compiled") {
            continue;
        }
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
            result.push(...await findProfileFiles(root, fullPath));
            continue;
        }
        if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
            result.push(path.relative(root, fullPath).split(path.sep).join("/"));
        }
    }
    return result.sort((left, right) => left.localeCompare(right));
}

function runTypecheck(filePath: string): boolean {
    if (!/\.(tsx|ts)$/.test(filePath)) {
        return true;
    }
    const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, ".nuxt/tsconfig.server.json")
        ?? ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
        console.error("未找到 tsconfig.json");
        return false;
    }
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        printDiagnostics([configFile.error]);
        return false;
    }
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath);
    const program = ts.createProgram({
        rootNames: [filePath, ...config.fileNames.filter((item) => item.endsWith(".d.ts"))],
        options: {
            ...config.options,
            noEmit: true,
            skipLibCheck: true,
        },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
        const fileName = diagnostic.file?.fileName;
        return !fileName || Boolean(relativeInside(SYSTEM_PROFILE_ROOT, fileName) || relativeInside(USER_PROFILE_ROOT, fileName));
    });
    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics);
        return false;
    }
    return true;
}

function printDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
    const host: ts.FormatDiagnosticsHost = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => ts.sys.newLine,
    };
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}

function relativeInside(root: string, filePath: string): string | null {
    if (!filePath) {
        return null;
    }
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return null;
    }
    return relativePath.split(path.sep).join("/");
}

function printUsage(): void {
    console.error("用法：bun scripts/profile.ts <status|check|compile|preview> <fileName|profileKey> [--system] [--all]");
    console.error("示例：bun scripts/profile.ts compile builtin/leader.default.profile.tsx --system");
}
