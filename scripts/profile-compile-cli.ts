import fs from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import process from "node:process";
import ts from "typescript";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {previewAgentProfilePrepare, readAgentProfileDetail} from "nbook/server/agent/profiles/profile-http-service";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {AgentProfileCompileResultDto, AgentProfileIssueDto} from "nbook/shared/dto/agent-profile.dto";

type ProfileCompileCommand = "compile-profile" | "check-profile";

type CliRunOptions = {
    command: ProfileCompileCommand;
};

type CliOptions = {
    profilePath: string;
    preview: boolean;
    typecheckOnly: boolean;
    sessionId?: string;
    input?: JsonValue;
};

type ProfileLocation = {
    absolutePath: string;
    fileName: string;
    rootKind: "system" | "user";
};

const SYSTEM_PROFILE_ROOT = path.resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "profiles");
const USER_PROFILE_ROOT = path.resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles");
const EMPTY_USER_PROFILE_ROOT = path.resolve(process.cwd(), ".agent", "workspace", "profile-compile-cli-empty-user");
const MODULE_CACHE_ROOT = path.resolve(process.cwd(), ".agent", "workspace", "profile-compile-cli-module-cache");

/**
 * 运行 profile 编译 CLI。`check-profile` 作为旧入口复用同一套实现。
 */
export async function runProfileCompileCli(argv: string[], runOptions: CliRunOptions): Promise<void> {
    const options = parseArgs(argv, runOptions.command);
    if (!options) {
        process.exitCode = 1;
        return;
    }
    if (options.profilePath === "__help__") {
        printUsage(runOptions.command);
        return;
    }
    if (runOptions.command === "check-profile") {
        console.warn("check-profile.ts 是旧别名；推荐使用 bun scripts/compile-profile.ts <profile-file>。");
    }

    const location = resolveProfileLocation(options.profilePath);
    if (!location) {
        process.exitCode = 1;
        return;
    }

    const typecheckOk = runTypecheck(location);
    if (!typecheckOk) {
        process.exitCode = 1;
        return;
    }
    if (options.typecheckOnly) {
        return;
    }

    const result = await runRuntimeCompile(location, options);
    printRuntimeResult(location, result);
    if (!result.ok || result.issues.some((issue) => issue.severity === "error")) {
        process.exitCode = 1;
    }
}

/**
 * 解析命令行参数。只保留用户能稳定理解的少量开关。
 */
function parseArgs(argv: string[], command: ProfileCompileCommand): CliOptions | null {
    const args = [...argv];
    const options: CliOptions = {
        profilePath: "",
        preview: false,
        typecheckOnly: false,
    };
    while (args.length > 0) {
        const arg = args.shift();
        if (!arg) {
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            return {...options, profilePath: "__help__"};
        }
        if (arg === "--preview") {
            options.preview = true;
            continue;
        }
        if (arg === "--typecheck-only") {
            options.typecheckOnly = true;
            continue;
        }
        if (arg === "--session-id") {
            const value = args.shift()?.trim();
            if (!value) {
                console.error("--session-id 需要一个 session id。");
                return null;
            }
            options.sessionId = value;
            continue;
        }
        if (arg === "--input-json") {
            const value = args.shift();
            if (!value) {
                console.error("--input-json 需要一个 JSON 字符串。");
                return null;
            }
            try {
                options.input = JSON.parse(value) as JsonValue;
            } catch (error) {
                console.error(`--input-json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
                return null;
            }
            continue;
        }
        if (arg.startsWith("--")) {
            console.error(`未知参数：${arg}`);
            printUsage(command);
            return null;
        }
        if (options.profilePath) {
            console.error(`只能指定一个 profile 文件，多余参数：${arg}`);
            printUsage(command);
            return null;
        }
        options.profilePath = arg;
    }
    if (!options.profilePath) {
        printUsage(command);
        return null;
    }
    return options;
}

/**
 * 解析目标 profile，并限制只能检查系统或用户 profile root 下的文件。
 */
function resolveProfileLocation(profilePath: string): ProfileLocation | null {
    const absolutePath = path.resolve(process.cwd(), profilePath);
    if (!/\.profile\.(tsx|ts|mjs|js)$/.test(path.basename(absolutePath))) {
        console.error("profile 文件名必须使用 .profile.tsx/.profile.ts/.profile.mjs/.profile.js。");
        return null;
    }
    if (!fs.existsSync(absolutePath)) {
        console.error(`profile 文件不存在：${absolutePath}`);
        return null;
    }
    const systemFileName = relativeInside(SYSTEM_PROFILE_ROOT, absolutePath);
    if (systemFileName) {
        return {
            absolutePath,
            fileName: systemFileName,
            rootKind: "system",
        };
    }
    const userFileName = relativeInside(USER_PROFILE_ROOT, absolutePath);
    if (userFileName) {
        return {
            absolutePath,
            fileName: userFileName,
            rootKind: "user",
        };
    }
    console.error("profile 只能位于 assets/workspace/.nbook/agent/profiles 或 workspace/.nbook/agent/profiles。");
    return null;
}

/**
 * 如果文件位于 root 内，返回用 `/` 分隔的相对路径。
 */
function relativeInside(root: string, filePath: string): string | null {
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return null;
    }
    return relativePath.split(path.sep).join("/");
}

/**
 * 直接从磁盘 profile root 执行 runtime compile。系统 profile 编译时不应用用户覆盖。
 */
async function runRuntimeCompile(location: ProfileLocation, options: CliOptions): Promise<AgentProfileCompileResultDto> {
    const startedAt = performance.now();
    try {
        const profiles = createCatalog(location);
        const detail = await readAgentProfileDetail(profiles, {fileName: location.fileName});
        const issues = detail.issues;
        if (issues.some((issue) => issue.severity === "error") || !detail.manifest?.key) {
            return {
                ok: false,
                stale: false,
                detail,
                preview: null,
                issues,
                elapsedMs: elapsedMs(startedAt),
            };
        }
        if (!options.preview) {
            return {
                ok: true,
                stale: false,
                detail,
                preview: null,
                issues,
                elapsedMs: elapsedMs(startedAt),
            };
        }
        const {NeuroAgentHarness} = await import("nbook/server/agent/harness/neuro-agent-harness");
        const preview = await previewAgentProfilePrepare(new NeuroAgentHarness({
            profiles,
        }), {
            profileKey: detail.manifest.key,
            sessionId: options.sessionId,
            input: options.input,
        });
        return {
            ok: preview.ok && issues.every((issue) => issue.severity !== "error"),
            stale: false,
            detail,
            preview,
            issues: [...issues, ...preview.issues],
            elapsedMs: elapsedMs(startedAt),
        };
    } catch (error) {
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [issueFromError(error, location.fileName)],
            elapsedMs: elapsedMs(startedAt),
        };
    }
}

/**
 * 为目标文件创建 catalog。
 */
function createCatalog(location: ProfileLocation): AgentProfileCatalog {
    return new AgentProfileCatalog(
        SYSTEM_PROFILE_ROOT,
        location.rootKind === "system" ? EMPTY_USER_PROFILE_ROOT : USER_PROFILE_ROOT,
        path.resolve(MODULE_CACHE_ROOT, location.rootKind),
    );
}

/**
 * 将异常转换为 CLI compile issue。
 */
function issueFromError(error: unknown, fileName: string): AgentProfileIssueDto {
    return {
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        code: "compile_failed",
        fileName,
        stack: process.env.NODE_ENV === "production" ? undefined : error instanceof Error ? error.stack : undefined,
    };
}

/**
 * 计算耗时。
 */
function elapsedMs(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 100) / 100;
}

/**
 * 对 TS/TSX profile 做单文件 TypeScript 检查，JS/MJS 只走 runtime compile。
 */
function runTypecheck(location: ProfileLocation): boolean {
    if (!/\.(tsx|ts)$/.test(location.absolutePath)) {
        console.log(`profile typecheck skipped: ${path.relative(process.cwd(), location.absolutePath)}`);
        return true;
    }
    const config = readTsConfig();
    if (config.errors.length > 0) {
        printDiagnostics(config.errors);
        return false;
    }

    const options: ts.CompilerOptions = {
        ...config.options,
        noEmit: true,
        skipLibCheck: true,
    };
    const rootNames = [...new Set([
        location.absolutePath,
        ...listRootDeclarationFiles(),
        ...config.fileNames.filter((fileName) => fileName.endsWith(".d.ts")),
    ])];
    const program = ts.createProgram({
        rootNames,
        options,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const profileDiagnostics = diagnostics.filter((diagnostic) => isProfileSourceDiagnostic(diagnostic));
    if (profileDiagnostics.length > 0) {
        printDiagnostics(profileDiagnostics);
        return false;
    }
    const externalDiagnostics = diagnostics.length - profileDiagnostics.length;

    console.log(`profile typecheck passed: ${path.relative(process.cwd(), location.absolutePath)}`);
    if (externalDiagnostics > 0) {
        console.warn(`profile typecheck ignored ${externalDiagnostics} external diagnostic(s) outside profile roots; runtime compile will still load this profile.`);
    }
    return true;
}

/**
 * profile CLI 只把 profile root 内的源码诊断作为目标失败。
 */
function isProfileSourceDiagnostic(diagnostic: ts.Diagnostic): boolean {
    const fileName = diagnostic.file?.fileName;
    if (!fileName) {
        return true;
    }
    return Boolean(relativeInside(SYSTEM_PROFILE_ROOT, fileName) || relativeInside(USER_PROFILE_ROOT, fileName));
}

/**
 * 读取仓库根目录的声明文件，例如 yazl.d.ts。
 */
function listRootDeclarationFiles(): string[] {
    return fs.readdirSync(process.cwd(), {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
        .map((entry) => path.resolve(process.cwd(), entry.name));
}

/**
 * 读取服务端 tsconfig，并保留 path alias、Nuxt auto-import、JSX 和 strict 等规则。
 */
function readTsConfig(): ts.ParsedCommandLine {
    const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, ".nuxt/tsconfig.server.json")
        ?? ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
        return {
            options: {},
            fileNames: [],
            errors: [createSyntheticDiagnostic("未找到 tsconfig.json")],
        };
    }
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        return {
            options: {},
            fileNames: [],
            errors: [configFile.error],
        };
    }
    return ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath),
        undefined,
        configPath,
    );
}

/**
 * 打印 TypeScript diagnostics。
 */
function printDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
    const host: ts.FormatDiagnosticsHost = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => ts.sys.newLine,
    };
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}

/**
 * 构造脚本自身的错误。
 */
function createSyntheticDiagnostic(message: string): ts.Diagnostic {
    return {
        category: ts.DiagnosticCategory.Error,
        code: 0,
        file: undefined,
        start: undefined,
        length: undefined,
        messageText: message,
    };
}

/**
 * 输出 runtime compile 结果摘要。
 */
function printRuntimeResult(location: ProfileLocation, result: AgentProfileCompileResultDto): void {
    for (const issue of result.issues) {
        printIssue(issue);
    }
    if (result.ok) {
        console.log(`profile runtime compile passed: ${path.relative(process.cwd(), location.absolutePath)}`);
    } else {
        console.error(`profile runtime compile failed: ${path.relative(process.cwd(), location.absolutePath)}`);
    }
    console.log(`profile fileName: ${location.fileName}`);
    console.log(`profile source root: ${location.rootKind}`);
    if (result.detail?.manifest) {
        console.log(`profile key: ${result.detail.manifest.key}`);
        console.log(`profile name: ${result.detail.manifest.name}`);
        console.log(`allowed tools: ${result.detail.allowedToolKeys.length > 0 ? result.detail.allowedToolKeys.join(", ") : "(none)"}`);
        console.log(`input schema: ${result.detail.inputSchema.jsonSchema ? "present" : "empty"}`);
        console.log(`output schema: ${result.detail.outputSchema.jsonSchema ? "present" : "empty"}`);
        console.log(`report_result schema: ${result.detail.reportResultSchema ? "present" : "empty"}`);
    }
    if (result.preview) {
        console.log(`preview ok: ${result.preview.ok ? "yes" : "no"}`);
        console.log(`preview messages: ${result.preview.messages.length}`);
        console.log(`preview persisted messages: ${result.preview.persistedMessageCount}`);
    }
    if (result.elapsedMs !== undefined) {
        console.log(`elapsed: ${result.elapsedMs}ms`);
    }
}

/**
 * 打印 profile runtime issue。
 */
function printIssue(issue: AgentProfileIssueDto): void {
    const text = [
        `[${issue.severity}]`,
        issue.code ? `${issue.code}:` : "",
        issue.message,
        issue.fileName ? `(fileName: ${issue.fileName})` : "",
        issue.profileKey ? `(profile: ${issue.profileKey})` : "",
    ].filter(Boolean).join(" ");
    if (issue.severity === "warning") {
        console.warn(text);
        return;
    }
    console.error(text);
}

/**
 * 输出用法。
 */
function printUsage(command: ProfileCompileCommand): void {
    const scriptName = command === "compile-profile" ? "compile-profile.ts" : "check-profile.ts";
    console.error(`用法：bun scripts/${scriptName} <profile-file> [--preview] [--input-json <json>] [--session-id <id>] [--typecheck-only]`);
    console.error("示例：bun scripts/compile-profile.ts workspace/.nbook/agent/profiles/custom.profile.tsx");
}
