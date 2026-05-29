import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import {compileVariableDefinitions, readVariableDefinitionManifest, validateVariableDefinitionArtifact} from "nbook/server/agent/variables/definition-artifact";
import {loadCompiledVariableDefinitions} from "nbook/server/agent/variables/definition-artifact";
import {resolveAgentNbookRoot} from "nbook/server/agent/variables/workspace-paths";
import type {VariableNamespace} from "nbook/server/agent/variables/types";

type DefinitionCommand = "status" | "check" | "compile";

type CliOptions = {
    command: DefinitionCommand;
    scope: "global" | "project";
    workspaceRoot?: string;
    projectWorkspace?: string;
};

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
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

function parseArgs(args: string[]): CliOptions | null {
    if (args.shift() !== "definition") {
        printUsage();
        return null;
    }
    const command = args.shift() as DefinitionCommand | undefined;
    if (!command || !["status", "check", "compile"].includes(command)) {
        printUsage();
        return null;
    }
    const options: CliOptions = {
        command,
        scope: "global",
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
        if (arg === "--global") {
            options.scope = "global";
            continue;
        }
        if (arg === "--workspace-root") {
            const value = args.shift();
            if (!value) {
                throw new Error("--workspace-root 需要 Workspace Root 路径。");
            }
            options.workspaceRoot = value;
            continue;
        }
        if (arg === "--project") {
            options.scope = "project";
            const value = args.shift();
            if (!value) {
                throw new Error("--project 需要 Project Workspace 相对路径。");
            }
            options.projectWorkspace = value;
            continue;
        }
        throw new Error(`未知参数：${arg}`);
    }
    if (options.scope === "project" && !options.projectWorkspace) {
        throw new Error("Project definition 需要 --project <projectWorkspace>。");
    }
    return options;
}

async function runStatus(options: CliOptions): Promise<void> {
    const target = definitionTarget(options);
    const files = await findDefinitionFiles(target.root);
    if (files.length === 0) {
        console.log("variable definition status: no source");
        console.log(`definition root: ${target.label}`);
        return;
    }
    const manifest = await readVariableDefinitionManifest(target.root);
    for (const fileName of files) {
        const item = manifest.definitions.find((entry) => entry.fileName === fileName);
        if (!item) {
            console.log(`${fileName}: not_compiled`);
            continue;
        }
        const validation = await validateVariableDefinitionArtifact(target.root, item);
        console.log(`${fileName}: ${validation.fresh ? "loaded" : "compile_stale"}`);
        console.log(`  artifact: ${item.artifactFileName}`);
        if (item.typeFileName) {
            console.log(`  types: ${item.typeFileName}`);
        } else {
            console.log("  types: missing");
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
        }
        if (!validation.fresh) {
            console.log(`  reason: ${validation.reason}`);
        }
    }
}

async function runCheck(options: CliOptions): Promise<void> {
    const target = definitionTarget(options);
    const files = await findDefinitionFiles(target.root);
    for (const fileName of files) {
        if (!runTypecheck(path.join(target.root, fileName))) {
            process.exitCode = 1;
            return;
        }
    }
    const loaded = await loadCompiledVariableDefinitions({
        definitionRoot: target.root,
        namespace: target.namespace,
    });
    for (const issue of loaded.issues) {
        console.log(`[${issue.code}] ${issue.message}`);
    }
    if (loaded.issues.some((issue) => issue.code === "not_compiled" || issue.code === "compile_stale" || issue.code === "compiled_load_failed")) {
        process.exitCode = 1;
        return;
    }
    console.log(`variable definition check passed: ${loaded.definitions.length} loaded`);
}

async function runCompile(options: CliOptions): Promise<void> {
    const target = definitionTarget(options);
    const manifest = await compileVariableDefinitions({
        definitionRoot: target.root,
        rootLabel: target.label,
    });
    console.log(`variable definition compile wrote ${manifest.definitions.length} artifact(s)`);
    for (const item of manifest.definitions) {
        console.log(`- ${item.fileName}: ${item.registeredPaths.join(", ") || "no registered variables"} -> .compiled/${item.artifactFileName}`);
        if (item.typeFileName) {
            console.log(`  types: .compiled/${item.typeFileName}`);
        }
        for (const diagnostic of item.typeDiagnostics ?? []) {
            console.log(`  [${diagnostic.severity}] ${diagnostic.message}`);
        }
    }
}

function definitionTarget(options: CliOptions): {root: string; label: string; namespace: Extract<VariableNamespace, "global" | "project">} {
    if (options.scope === "project") {
        const projectWorkspace = options.projectWorkspace!;
        return {
            root: path.resolve(process.cwd(), projectWorkspace, ".nbook", "agent", "variables"),
            label: `${projectWorkspace.replaceAll("\\", "/")}/.nbook/agent/variables`,
            namespace: "project",
        };
    }
    return {
        root: path.join(resolveAgentNbookRoot(resolveWorkspaceRoot(options.workspaceRoot)), "agent", "variables"),
        label: `${path.relative(process.cwd(), resolveWorkspaceRoot(options.workspaceRoot)).replaceAll("\\", "/") || "."}/.nbook/agent/variables`,
        namespace: "global",
    };
}

function resolveWorkspaceRoot(workspaceRoot?: string): string {
    if (workspaceRoot) {
        return path.resolve(process.cwd(), workspaceRoot);
    }
    const cwd = path.resolve(process.cwd());
    if (fs.existsSync(path.join(cwd, ".nbook"))) {
        return cwd;
    }
    return path.resolve(cwd, "workspace");
}

async function findDefinitionFiles(root: string): Promise<string[]> {
    const entries = await fsp.readdir(root, {withFileTypes: true}).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && /^definitions\.(tsx|ts|mjs|js)$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

function runTypecheck(filePath: string): boolean {
    if (!/\.(tsx|ts)$/.test(filePath) || !fs.existsSync(filePath)) {
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
        return !fileName || fileName === filePath || fileName.endsWith(".d.ts");
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

function printUsage(): void {
    console.error("用法：bun scripts/build/variable.ts definition <status|check|compile> [--global [--workspace-root <workspaceRoot>] | --project <projectWorkspace>]");
    console.error("示例：bun scripts/build/variable.ts definition compile --global --workspace-root workspace");
    console.error("示例：bun scripts/build/variable.ts definition status --project novels/demo");
}
