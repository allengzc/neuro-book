import {spawn} from "node:child_process";
import path from "node:path";
import {z} from "zod";
import type {AgentTool, AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const ExecuteShellInputSchema = z.object({
    command: z.string().trim().min(1, "command is required").describe("Shell command to execute. On Windows it runs through PowerShell; on Unix it runs through bash."),
    description: z.string().trim().min(1, "description must not be empty when provided").optional().describe("Optional human-readable purpose for this command. It is shown in the result and does not affect execution."),
    workdir: z.string().trim().min(1, "workdir is required when provided").optional().describe("Working directory for the command. Must be within the project root. Defaults to the active workspace when available, otherwise the project root."),
    timeoutMs: z.number().int().min(1_000).max(600_000).optional().default(120_000).describe("Timeout in milliseconds (1000–600000). Defaults to 120000 (2 minutes)."),
});

const OUTPUT_LIMIT = 60_000;

type ShellExecutionResult = {
    command: string;
    description?: string;
    cwd: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
};

/**
 * 根据当前平台构造真实 shell 启动参数。
 */
function createShellCommand(command: string): {file: string; args: string[]} {
    if (process.platform === "win32") {
        const utf8Command = [
            "chcp 65001 > $null",
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
            "$OutputEncoding = [System.Text.Encoding]::UTF8",
            command,
        ].join("; ");
        return {
            file: "powershell.exe",
            args: ["-NoProfile", "-NonInteractive", "-Command", utf8Command],
        };
    }

    return {
        file: "bash",
        args: ["-lc", command],
    };
}

/**
 * 判断目标路径是否仍在项目根目录内。
 */
function isInsideProject(rootPath: string, targetPath: string): boolean {
    const relativePath = path.relative(rootPath, targetPath);
    return relativePath === "" || Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

/**
 * 读取当前 Agent 的默认 shell 工作目录。
 */
function readDefaultShellWorkdir(context: AgentToolContext): string | undefined {
    const workspace = typeof context.getScope === "function"
        ? context.getScope().studio.workspace
        : null;
    return typeof workspace === "string" && workspace.trim() ? "workspace" : undefined;
}

/**
 * 解析 shell 命令的工作目录。
 */
function resolveShellWorkdir(workdir: string | undefined, context: AgentToolContext): string {
    const projectRoot = process.cwd();
    const resolvedWorkdir = path.resolve(projectRoot, workdir ?? readDefaultShellWorkdir(context) ?? ".");

    if (!isInsideProject(projectRoot, resolvedWorkdir)) {
        throw new Error(`workdir must be within the project root: ${projectRoot}`);
    }

    return resolvedWorkdir;
}

/**
 * 截断超长输出，避免单次工具结果压垮模型上下文。
 */
function truncateOutput(value: string): {text: string; truncated: boolean} {
    if (value.length <= OUTPUT_LIMIT) {
        return {
            text: value,
            truncated: false,
        };
    }

    return {
        text: `${value.slice(0, OUTPUT_LIMIT)}\n[Output truncated; original length ${String(value.length)} characters]`,
        truncated: true,
    };
}

/**
 * 给 Agent shell 注入项目内的轻量命令 shim，例如 workspace。
 */
function createShellEnvironment(): NodeJS.ProcessEnv {
    const agentBinPath = path.join(process.cwd(), "assets", "agent", "bin");
    const currentPath = process.env.PATH ?? process.env.Path ?? "";
    const nextPath = [agentBinPath, currentPath].filter(Boolean).join(path.delimiter);
    return {
        ...process.env,
        PATH: nextPath,
        Path: nextPath,
    };
}

/**
 * 执行 shell 命令并收集完整结果。
 */
async function executeShellCommand(input: z.infer<typeof ExecuteShellInputSchema>, context: AgentToolContext): Promise<ShellExecutionResult> {
    const cwd = resolveShellWorkdir(input.workdir, context);
    const startedAt = Date.now();
    const shellCommand = createShellCommand(input.command);

    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;

        const childProcess = spawn(shellCommand.file, shellCommand.args, {
            cwd,
            env: createShellEnvironment(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const timeout = setTimeout(() => {
            timedOut = true;
            childProcess.kill();
        }, input.timeoutMs);

        childProcess.stdout.setEncoding("utf8");
        childProcess.stderr.setEncoding("utf8");
        childProcess.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        childProcess.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        childProcess.on("error", (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        childProcess.on("close", (exitCode, signal) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);

            const normalizedStdout = truncateOutput(stdout);
            const normalizedStderr = truncateOutput(stderr);
            resolve({
                command: input.command,
                description: input.description,
                cwd,
                exitCode,
                signal,
                timedOut,
                durationMs: Date.now() - startedAt,
                stdout: normalizedStdout.text,
                stderr: normalizedStderr.text,
                stdoutTruncated: normalizedStdout.truncated,
                stderrTruncated: normalizedStderr.truncated,
            });
        });
    });
}

/**
 * 将 shell 执行结果渲染为模型可直接阅读的文本。
 */
function renderShellResult(result: ShellExecutionResult): string {
    const lines = [
        `Exit code: ${result.exitCode === null ? "null" : String(result.exitCode)}`,
        `Signal: ${result.signal ?? "null"}`,
        `Timed out: ${result.timedOut ? "true" : "false"}`,
        `Duration: ${String(result.durationMs)}ms`,
        `Working directory: ${result.cwd}`,
    ];

    if (result.stdoutTruncated || result.stderrTruncated) {
        lines.push(`Truncated: stdout=${result.stdoutTruncated ? "true" : "false"}, stderr=${result.stderrTruncated ? "true" : "false"}`);
    }

    lines.push("", "STDOUT:", result.stdout.trimEnd() || "(empty)", "", "STDERR:", result.stderr.trimEnd() || "(empty)");
    return lines.join("\n");
}

/**
 * 将 shell 启动失败渲染成模型可行动的短错误。
 */
function renderShellStartupError(error: unknown, input: z.infer<typeof ExecuteShellInputSchema>): string {
    const message = error instanceof Error ? error.message : String(error);
    const executable = process.platform === "win32" ? "powershell.exe" : "bash";
    return [
        `Command: ${input.command}`,
        `Failed to start shell: ${executable} was not found or could not be executed.`,
        `Cause: ${message}`,
    ].join("\n");
}

/**
 * 执行本地 shell 命令。
 */
export const executeShellTool: AgentTool<typeof ExecuteShellInputSchema> = {
    key: "execute_shell",
    description: [
        "Execute a local shell command and return the command text, working directory, exit code, timeout status, stdout, and stderr as plain text.",
        "Pass a single command string in the command field. Do not pass argv arrays.",
        process.platform === "win32"
            ? "Windows commands run through PowerShell. Example: {\"command\":\"Get-ChildItem -Force\"}."
            : "Unix commands run through bash. Example: {\"command\":\"rg --files\"}.",
        "The working directory defaults to the active workspace when available, otherwise the project root; workdir must be within the project root.",
        "timeoutMs defaults to 120000 (2 min), range 1000 to 600000.",
        "stdout/stderr are returned as raw text blocks, not JSON-wrapped strings.",
        "Avoid broad recursive workspace listing. Prefer targeted file discovery such as rg --files with path filters, and avoid large FullName/Mode-style directory dumps.",
        "Prefer read_file, edit_file, apply_patch, and write_file for file modifications. Use this tool only for running scripts, checking the environment, or when a shell command is explicitly required.",
    ].join("\n"),
    schema: ExecuteShellInputSchema,
    async execute(input, context) {
        try {
            const result = await executeShellCommand(input, context);
            return createToolResultMessage(renderShellResult(result), JSON.stringify(input));
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("workdir must be within the project root")) {
                throw error;
            }
            return createToolResultMessage(renderShellStartupError(error, input), JSON.stringify(input), "error");
        }
    },
};
