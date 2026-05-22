import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

/**
 * 单文件检查动态 TSX profile。
 *
 * 用法：
 *   bun scripts/check-profile.ts assets/.nbook/agent/profiles/builtin/leader.default.profile.tsx
 *   bun scripts/check-profile.ts workspace/.nbook/agent/profiles/custom.profile.tsx
 *   bun scripts/check-profile.ts --v3 assets/.nbook/agent/profiles/custom.profile.tsx
 */
function main(): void {
    const v3 = process.argv.includes("--v3");
    const profilePath = process.argv.find((argument, index) => index > 1 && argument !== "--v3")?.trim();
    if (!profilePath) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const absoluteProfilePath = path.resolve(process.cwd(), profilePath);
    if (!absoluteProfilePath.endsWith(".profile.tsx")) {
        console.error("profile 文件必须以 .profile.tsx 结尾。");
        process.exitCode = 1;
        return;
    }
    if (v3 && !isV3ProfilePath(absoluteProfilePath)) {
        console.error("v3 profile 只能位于 assets/.nbook/agent/profiles 或 workspace/.nbook/agent/profiles。");
        process.exitCode = 1;
        return;
    }
    if (!fs.existsSync(absoluteProfilePath)) {
        console.error(`profile 文件不存在：${absoluteProfilePath}`);
        process.exitCode = 1;
        return;
    }

    const config = readTsConfig();
    if (config.errors.length > 0) {
        printDiagnostics(config.errors);
        process.exitCode = 1;
        return;
    }

    const options: ts.CompilerOptions = {
        ...config.options,
        noEmit: true,
        skipLibCheck: true,
    };
    const rootNames = [...new Set([
        absoluteProfilePath,
        ...listRootDeclarationFiles(),
        ...config.fileNames.filter((fileName) => fileName.endsWith(".d.ts")),
    ])];
    const program = ts.createProgram({
        rootNames,
        options,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
        printDiagnostics(diagnostics);
        process.exitCode = 1;
        return;
    }

    console.log(`profile typecheck passed: ${path.relative(process.cwd(), absoluteProfilePath)}`);
}

/**
 * v3 模式只允许检查新 .nbook profile root。
 */
function isV3ProfilePath(absoluteProfilePath: string): boolean {
    const normalized = absoluteProfilePath.replace(/\\/g, "/");
    const cwd = process.cwd().replace(/\\/g, "/");
    return normalized.startsWith(`${cwd}/assets/.nbook/agent/profiles/`)
        || normalized.startsWith(`${cwd}/workspace/.nbook/agent/profiles/`);
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
 * 输出用法。
 */
function printUsage(): void {
    console.error("用法：bun scripts/check-profile.ts [--v3] <profile-file>");
}

main();
