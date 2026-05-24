import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join, resolve, win32} from "node:path";
import {applyPatch, createPatch} from "diff";
import {Type} from "typebox";
import type {Static} from "typebox";
import {detectImageMimeType, assertReadable, assertWritable, firstChangedLine, resolveWorkspacePath} from "nbook/server/agent/tools/file-tool-utils";
import {formatSize, DEFAULT_MAX_BYTES, truncateHead, type TruncationResult} from "nbook/server/agent/tools/truncate";
import {OutputAccumulator} from "nbook/server/agent/tools/output-accumulator";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";

const ReadSchema = Type.Object({
    path: Type.String({description: "Path to the file to read (relative or absolute)."}),
    offset: Type.Optional(Type.Number({description: "Line number to start reading from (1-indexed)."})),
    limit: Type.Optional(Type.Number({description: "Maximum number of lines to read."})),
}, {additionalProperties: false});

const WriteSchema = Type.Object({
    path: Type.String({description: "Path to the file to write (relative or absolute)."}),
    content: Type.String({description: "Content to write to the file."}),
}, {additionalProperties: false});

const EditSchema = Type.Object({
    path: Type.String({description: "Path to the file to edit (relative or absolute)."}),
    edits: Type.Array(Type.Object({
        oldText: Type.String({description: "Exact unique text to replace."}),
        newText: Type.String({description: "Replacement text."}),
    }, {additionalProperties: false}), {description: "One or more exact, non-overlapping replacements."}),
}, {additionalProperties: false});

const ApplyPatchSchema = Type.Object({
    path: Type.String({description: "Path to the file to patch (relative or absolute)."}),
    patch: Type.String({description: "Unified diff patch text."}),
    fuzzFactor: Type.Optional(Type.Number({description: "Context matching tolerance in lines. Default 0."})),
}, {additionalProperties: false});

const BashSchema = Type.Object({
    command: Type.String({description: "Bash command to execute."}),
    timeout: Type.Optional(Type.Number({description: "Timeout in seconds."})),
}, {additionalProperties: false});

type ReadInput = Static<typeof ReadSchema>;
type WriteInput = Static<typeof WriteSchema>;
type EditInput = Static<typeof EditSchema>;
type ApplyPatchInput = Static<typeof ApplyPatchSchema>;
type BashInput = Static<typeof BashSchema>;

type ReadDetails = {
    truncation?: TruncationResult;
    path: string;
};

type EditDetails = {
    diff: string;
    firstChangedLine?: number;
};

type BashDetails = {
    truncation?: TruncationResult;
    fullOutputPath?: string;
};

/**
 * 构造 Pi 风格基础文件与 bash 工具。
 */
export function createFileTools(): NeuroAgentTool[] {
    return [
        createReadTool(),
        createWriteTool(),
        createEditTool(),
        createApplyPatchTool(),
        createBashTool(),
    ];
}

function createReadTool(): NeuroAgentTool {
    return {
        key: "read",
        name: "read",
        label: "read",
        description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. Use read to examine files instead of cat/head/tail/sed.`,
        parameters: ReadSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown) {
            const input = params as ReadInput;
            const absolutePath = resolveWorkspacePath(input.path, context.workspaceRoot);
            await assertReadable(absolutePath);
            const mimeType = detectImageMimeType(absolutePath);
            const buffer = await readFile(absolutePath);
            if (mimeType) {
                return {
                    content: [
                        {type: "text", text: `Read image file [${mimeType}]`},
                        {type: "image", data: buffer.toString("base64"), mimeType},
                    ],
                    details: {path: absolutePath},
                };
            }

            const text = buffer.toString("utf-8");
            const lines = text.split("\n");
            const startLine = input.offset ? Math.max(0, input.offset - 1) : 0;
            if (startLine >= lines.length) {
                throw new Error(`Offset ${input.offset} is beyond end of file (${lines.length} lines total)`);
            }
            const selected = input.limit !== undefined
                ? lines.slice(startLine, startLine + input.limit).join("\n")
                : lines.slice(startLine).join("\n");
            const truncation = truncateHead(selected);
            let outputText = truncation.content;
            if (truncation.firstLineExceedsLimit) {
                const firstLineSize = formatSize(Buffer.byteLength(lines[startLine] ?? "", "utf-8"));
                outputText = `[Line ${startLine + 1} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLine + 1}p' ${input.path} | head -c ${DEFAULT_MAX_BYTES}]`;
            } else if (truncation.truncated) {
                const endLine = startLine + truncation.outputLines;
                outputText += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${lines.length}. Use offset=${endLine + 1} to continue.]`;
            } else if (input.limit !== undefined && startLine + input.limit < lines.length) {
                outputText += `\n\n[${lines.length - startLine - input.limit} more lines in file. Use offset=${startLine + input.limit + 1} to continue.]`;
            }
            return {
                content: [{type: "text", text: outputText}],
                details: {
                    path: absolutePath,
                    truncation: truncation.truncated ? truncation : undefined,
                },
            };
        },
        async execute() {
            throw new Error("read 必须在 agent session workspace 内执行。");
        },
    };
}

function createWriteTool(): NeuroAgentTool {
    return {
        key: "write",
        name: "write",
        label: "write",
        description: "Create or overwrite a file. Automatically creates parent directories. Use write only for new files or complete rewrites, not targeted edits to existing files.",
        parameters: WriteSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown) {
            const input = params as WriteInput;
            const absolutePath = resolveWorkspacePath(input.path, context.workspaceRoot);
            await mkdir(dirname(absolutePath), {recursive: true});
            await writeFile(absolutePath, input.content, "utf-8");
            return {
                content: [{type: "text", text: `Successfully wrote ${Buffer.byteLength(input.content, "utf-8")} bytes to ${input.path}`}],
                details: undefined,
            };
        },
        async execute() {
            throw new Error("write 必须在 agent session workspace 内执行。");
        },
    };
}

function createEditTool(): NeuroAgentTool {
    return {
        key: "edit",
        name: "edit",
        label: "edit",
        description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. When changing multiple separate locations in one file, use one edit call with multiple entries in edits[]. Each oldText is matched against the original file, not incrementally. Merge nearby changes into one edit and keep oldText as small as possible while still unique.",
        parameters: EditSchema,
        prepareArguments(args: unknown) {
            if (!args || typeof args !== "object") {
                return args as EditInput;
            }
            const input = {...args as Record<string, unknown>};
            if (typeof input.edits === "string") {
                input.edits = JSON.parse(input.edits);
            }
            if (typeof input.oldText === "string" && typeof input.newText === "string") {
                input.edits = [...(Array.isArray(input.edits) ? input.edits : []), {
                    oldText: input.oldText,
                    newText: input.newText,
                }];
                delete input.oldText;
                delete input.newText;
            }
            return input as EditInput;
        },
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown) {
            const input = params as EditInput;
            if (!Array.isArray(input.edits) || input.edits.length === 0) {
                throw new Error("edits must contain at least one replacement.");
            }
            const absolutePath = resolveWorkspacePath(input.path, context.workspaceRoot);
            await assertWritable(absolutePath);
            const original = await readFile(absolutePath, "utf-8");
            const updated = applyExactEdits(original, input.edits, input.path);
            await writeFile(absolutePath, updated, "utf-8");
            const diff = createPatch(input.path, original, updated, undefined, undefined, {context: 4});
            return {
                content: [{type: "text", text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.`}],
                details: {
                    diff,
                    firstChangedLine: firstChangedLine(diff),
                },
            };
        },
        async execute() {
            throw new Error("edit 必须在 agent session workspace 内执行。");
        },
    };
}

function createApplyPatchTool(): NeuroAgentTool {
    return {
        key: "apply_patch",
        name: "apply_patch",
        label: "apply_patch",
        description: "Apply a unified diff patch to a single local text file. Use this when the change is naturally cohesive in one verified patch. For multiple separate locations in one file, prefer one edit call with multiple entries in edits[].",
        parameters: ApplyPatchSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown) {
            const input = params as ApplyPatchInput;
            const absolutePath = resolveWorkspacePath(input.path, context.workspaceRoot);
            await assertWritable(absolutePath);
            const original = await readFile(absolutePath, "utf-8");
            const patched = applyPatch(original, input.patch, {fuzzFactor: input.fuzzFactor ?? 0});
            if (patched === false) {
                throw new Error("Patch application failed; verify the patch matches the current file content.");
            }
            await writeFile(absolutePath, patched, "utf-8");
            const diff = createPatch(input.path, original, patched, undefined, undefined, {context: 4});
            return {
                content: [{type: "text", text: `Patch applied to ${input.path}.`}],
                details: {
                    diff,
                    firstChangedLine: firstChangedLine(diff),
                },
            };
        },
        async execute() {
            throw new Error("apply_patch 必须在 agent session workspace 内执行。");
        },
    };
}

function createBashTool(): NeuroAgentTool {
    return {
        key: "bash",
        name: "bash",
        label: "bash",
        description: "Execute a bash command in the agent workspace root. The agent bin directories are prepended to PATH, with user assets before system assets, so use workspace node ... for content-node CLI tasks. Returns stdout and stderr merged. Output is truncated to the last 2000 lines or 50KB (whichever is hit first). If truncated, the full output is saved to a temp file and the result includes its path. Use bash for rg/find/ls/git/tests/build/workspace CLI, not for file reading or editing when a dedicated tool exists.",
        parameters: BashSchema,
        async executeWithContext(
            context: ToolExecutionContext,
            _toolCallId: string,
            params: unknown,
            signal?: AbortSignal,
            onUpdate?: Parameters<NeuroAgentTool["execute"]>[3],
        ) {
            const input = params as BashInput;
            const bash = resolveBashPath();
            const output = new OutputAccumulator();
            const result = await runBash({
                bash,
                command: input.command,
                cwd: context.workspaceRoot,
                env: createBashEnvironment(),
                timeout: input.timeout,
                signal,
                onData(data) {
                    output.append(data);
                    const snapshot = output.snapshot(true);
                    onUpdate?.({
                        content: [{type: "text", text: snapshot.content}],
                        details: snapshot.truncation.truncated ? {
                            truncation: snapshot.truncation,
                            fullOutputPath: snapshot.fullOutputPath,
                        } : undefined,
                    });
                },
            }).finally(async () => {
                output.finish();
            });
            const snapshot = output.snapshot(true);
            await output.closeTempFile();
            const formatted = formatBashOutput(snapshot, result.exitCode);
            if (result.exitCode !== 0) {
                throw new Error(formatted);
            }
            return {
                content: [{type: "text", text: formatted}],
                details: snapshot.truncation.truncated ? {
                    truncation: snapshot.truncation,
                    fullOutputPath: snapshot.fullOutputPath,
                } : undefined,
            };
        },
        async execute() {
            throw new Error("bash 必须在 agent session workspace 内执行。");
        },
    };
}

function applyExactEdits(content: string, edits: EditInput["edits"], filePath: string): string {
    const matches = edits.map((edit, index) => {
        if (!edit.oldText) {
            throw new Error(`edits[${index}].oldText must not be empty in ${filePath}.`);
        }
        const first = content.indexOf(edit.oldText);
        if (first === -1) {
            throw new Error(`Could not find edits[${index}] in ${filePath}. The oldText must match exactly.`);
        }
        if (content.indexOf(edit.oldText, first + edit.oldText.length) !== -1) {
            throw new Error(`Found multiple occurrences of edits[${index}] in ${filePath}. oldText must be unique.`);
        }
        return {
            index,
            start: first,
            end: first + edit.oldText.length,
            newText: edit.newText,
        };
    }).sort((left, right) => left.start - right.start);

    for (let index = 1; index < matches.length; index++) {
            const previous = matches[index - 1];
            const current = matches[index];
            if (!previous || !current) {
                continue;
            }
        if (previous.end > current.start) {
            throw new Error(`edits[${previous.index}] and edits[${current.index}] overlap in ${filePath}.`);
        }
    }

    let updated = content;
    for (const match of [...matches].reverse()) {
        updated = updated.slice(0, match.start) + match.newText + updated.slice(match.end);
    }
    if (updated === content) {
        throw new Error(`No changes made to ${filePath}.`);
    }
    return updated;
}

function resolveBashPath(): string {
    const found = resolveBashPathForPlatform({
        platform: process.platform,
        env: process.env,
        pathExists: existsSync,
    });
    if (!found) {
        throw new Error("未找到 bash。请安装 Git Bash 或把 bash 加入 PATH。");
    }
    return found;
}

/**
 * 注入 Agent assets 的 bin 目录。用户覆盖优先于系统内置。
 */
function createBashEnvironment(): NodeJS.ProcessEnv {
    const userAgentBin = resolve(process.cwd(), "workspace", ".nbook", "agent", "bin");
    const systemAgentBin = resolve(process.cwd(), "assets", "workspace", ".nbook", "agent", "bin");
    const currentPath = process.env.PATH ?? process.env.Path ?? "";
    return {
        ...process.env,
        NEURO_BOOK_AGENT_BIN: userAgentBin,
        NEURO_BOOK_SYSTEM_AGENT_BIN: systemAgentBin,
        PATH: currentPath,
        Path: currentPath,
    };
}

/**
 * 按平台解析 bash 路径。Windows 优先使用真实存在的 Git Bash 路径，再查 PATH。
 */
export function resolveBashPathForPlatform(input: {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    pathExists(path: string): boolean;
}): string | undefined {
    return input.platform === "win32"
        ? firstExistingPath(windowsBashCandidates(input.env), input.pathExists) ?? firstCommandOnPath(["bash.exe", "bash"], input.env.PATH, input.platform, input.pathExists)
        : firstExistingPath([input.env.BASH, "/bin/bash", "/usr/bin/bash"], input.pathExists) ?? firstCommandOnPath(["bash"], input.env.PATH, input.platform, input.pathExists);
}

function windowsBashCandidates(env: NodeJS.ProcessEnv): Array<string | undefined> {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA;
    const userProfile = env.USERPROFILE;
    const programData = env.ProgramData ?? "C:\\ProgramData";
    const chocolateyInstall = env.ChocolateyInstall;

    return [
        env.GIT_BASH,
        win32.join(programFiles, "Git", "bin", "bash.exe"),
        win32.join(programFiles, "Git", "usr", "bin", "bash.exe"),
        win32.join(programFilesX86, "Git", "bin", "bash.exe"),
        win32.join(programFilesX86, "Git", "usr", "bin", "bash.exe"),
        localAppData ? win32.join(localAppData, "Programs", "Git", "bin", "bash.exe") : undefined,
        localAppData ? win32.join(localAppData, "Programs", "Git", "usr", "bin", "bash.exe") : undefined,
        userProfile ? win32.join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe") : undefined,
        userProfile ? win32.join(userProfile, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe") : undefined,
        win32.join(programData, "scoop", "apps", "git", "current", "bin", "bash.exe"),
        win32.join(programData, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe"),
        chocolateyInstall ? win32.join(chocolateyInstall, "lib", "git.install", "tools", "bin", "bash.exe") : undefined,
        chocolateyInstall ? win32.join(chocolateyInstall, "lib", "git.install", "tools", "usr", "bin", "bash.exe") : undefined,
    ];
}

/**
 * 返回第一个真实存在的绝对路径候选。
 */
function firstExistingPath(candidates: Array<string | undefined>, pathExists: (path: string) => boolean): string | undefined {
    return candidates.find((candidate) => Boolean(candidate && pathExists(candidate)));
}

/**
 * 在 PATH 中查找可执行命令名，返回模型工具实际传给 spawn 的命令名。
 */
function firstCommandOnPath(commands: string[], pathValue: string | undefined, platform: NodeJS.Platform, pathExists: (path: string) => boolean): string | undefined {
    const pathEntries = (pathValue ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
    return commands.find((command) => {
        return pathEntries.some((entry) => pathExists(platform === "win32" ? win32.join(entry, command) : join(entry, command)));
    });
}

async function runBash(input: {
    bash: string;
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout?: number;
    signal?: AbortSignal;
    onData(data: Buffer): void;
}): Promise<{exitCode: number | null}> {
    if (!existsSync(input.cwd)) {
        throw new Error(`Working directory does not exist: ${input.cwd}`);
    }
    const command = withAgentPathPrefix(input.command);
    return new Promise((resolve, reject) => {
        const child = spawn(input.bash, ["-lc", command], {
            cwd: input.cwd,
            env: input.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let timeoutHandle: NodeJS.Timeout | undefined;
        let timedOut = false;
        if (input.timeout !== undefined && input.timeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
            }, input.timeout * 1000);
        }
        const onAbort = () => {
            child.kill("SIGTERM");
        };
        input.signal?.addEventListener("abort", onAbort, {once: true});
        child.stdout?.on("data", input.onData);
        child.stderr?.on("data", input.onData);
        child.once("error", reject);
        child.once("close", (exitCode) => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            input.signal?.removeEventListener("abort", onAbort);
            if (input.signal?.aborted) {
                reject(new Error("Command aborted"));
                return;
            }
            if (timedOut) {
                reject(new Error(`Command timed out after ${input.timeout} seconds`));
                return;
            }
            resolve({exitCode});
        });
    });
}

/**
 * Git Bash 会在启动时重排 Windows PATH。这里在 shell 内重新前置 Agent bin，
 * 确保 user-assets 覆盖目录比系统目录和宿主 PATH 更早命中。
 */
function withAgentPathPrefix(command: string): string {
    return [
        "NEURO_BOOK_AGENT_BIN_POSIX=\"$NEURO_BOOK_AGENT_BIN\"",
        "NEURO_BOOK_SYSTEM_AGENT_BIN_POSIX=\"$NEURO_BOOK_SYSTEM_AGENT_BIN\"",
        "if command -v cygpath >/dev/null 2>&1; then",
        "  NEURO_BOOK_AGENT_BIN_POSIX=$(cygpath -u \"$NEURO_BOOK_AGENT_BIN\" 2>/dev/null || printf '%s' \"$NEURO_BOOK_AGENT_BIN\")",
        "  NEURO_BOOK_SYSTEM_AGENT_BIN_POSIX=$(cygpath -u \"$NEURO_BOOK_SYSTEM_AGENT_BIN\" 2>/dev/null || printf '%s' \"$NEURO_BOOK_SYSTEM_AGENT_BIN\")",
        "fi",
        "export PATH=\"$NEURO_BOOK_AGENT_BIN_POSIX:$NEURO_BOOK_SYSTEM_AGENT_BIN_POSIX:$PATH\"",
        command,
    ].join("\n");
}

function formatBashOutput(snapshot: ReturnType<OutputAccumulator["snapshot"]>, exitCode: number | null): string {
    let text = snapshot.content || "(no output)";
    if (snapshot.truncation.truncated) {
        const startLine = snapshot.truncation.totalLines - snapshot.truncation.outputLines + 1;
        const endLine = snapshot.truncation.totalLines;
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${snapshot.truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
    }
    if (exitCode !== 0) {
        text += `\n\nCommand exited with code ${exitCode}`;
    }
    return text;
}
