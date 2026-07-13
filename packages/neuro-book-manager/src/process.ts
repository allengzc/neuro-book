import {spawn} from "node:child_process";

export type RunOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "ignore" | "pipe";
};

/** 执行外部命令，非零退出码抛出异常。 */
export async function run(command: string, args: string[], options: RunOptions = {}): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: options.stdio ?? "inherit",
            windowsHide: true,
        });
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal) {
                rejectPromise(new Error(`${command} 被信号中断：${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`${command} 执行失败，退出码 ${code ?? "unknown"}`));
                return;
            }
            resolvePromise();
        });
    });
}

/** 执行外部命令并读取 stdout。 */
export async function runCapture(command: string, args: string[], options: Omit<RunOptions, "stdio"> = {}): Promise<string> {
    return new Promise<string>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => stdout += chunk);
        child.stderr.on("data", (chunk: string) => stderr += chunk);
        child.on("error", rejectPromise);
        child.on("exit", (code, signal) => {
            if (signal || code !== 0) {
                rejectPromise(new Error(stderr.trim() || `${command} 执行失败，退出码 ${code ?? signal ?? "unknown"}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}

/** 检查命令是否可执行。 */
export async function commandAvailable(command: string, args = ["--version"]): Promise<boolean> {
    try {
        await run(command, args, {stdio: "ignore"});
        return true;
    } catch {
        return false;
    }
}
