import {Worker} from "node:worker_threads";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type {
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
} from "nbook/shared/dto/agent-profile.dto";

type CompileTask = {
    id: number;
    input: AgentProfileCompileRequestDto;
    resolve: (result: AgentProfileCompileResultDto) => void;
    stale: boolean;
};

type WorkerResponse = {
    id: number;
    result: AgentProfileCompileResultDto;
};

let service: ProfileCompileWorkerService | undefined;
const WORKER_VERSION = "profile-compile-worker-v2";

/**
 * 获取 profile 编译 worker 单例。
 */
export function useProfileCompileWorker(): ProfileCompileWorkerService {
    if (!service || service.version !== WORKER_VERSION) {
        service?.dispose();
        service = new ProfileCompileWorkerService(WORKER_VERSION);
    }
    return service;
}

/**
 * 串行后台编译服务。真实 TSX loader 跑在 worker 内，避免阻塞 Nitro 主线程。
 */
export class ProfileCompileWorkerService {
    private worker: Worker | null = null;
    private running: CompileTask | null = null;
    private readonly queue: CompileTask[] = [];
    private nextId = 1;

    constructor(readonly version = WORKER_VERSION) {}

    /**
     * 提交编译任务。同一 fileName 的等待任务会被标记 stale，并只保留最新源码。
     */
    compile(input: AgentProfileCompileRequestDto): Promise<AgentProfileCompileResultDto> {
        const task: CompileTask = {
            id: this.nextId++,
            input,
            resolve: () => {},
            stale: false,
        };
        const promise = new Promise<AgentProfileCompileResultDto>((resolvePromise) => {
            task.resolve = resolvePromise;
        });
        this.markPendingStale(input.fileName);
        this.queue.push(task);
        this.pump();
        return promise;
    }

    private markPendingStale(fileName: string): void {
        for (const task of this.queue) {
            if (task.input.fileName === fileName) {
                task.stale = true;
            }
        }
    }

    private pump(): void {
        if (this.running) {
            return;
        }
        const task = this.queue.shift();
        if (!task) {
            return;
        }
        if (task.stale) {
            task.resolve({
                ok: false,
                stale: true,
                detail: null,
                preview: null,
                issues: [],
            });
            queueMicrotask(() => this.pump());
            return;
        }
        this.running = task;
        const worker = this.ensureWorker();
        worker.postMessage({
            id: task.id,
            input: task.input,
        });
    }

    private ensureWorker(): Worker {
        if (this.worker) {
            return this.worker;
        }
        this.worker = createCompileWorker();
        this.worker.on("message", (message: WorkerResponse) => this.handleMessage(message));
        this.worker.on("error", (error) => this.handleCrash(error instanceof Error ? error : new Error(String(error))));
        this.worker.on("exit", (code) => {
            if (code !== 0) {
                this.handleCrash(new Error(`profile compile worker exited: ${code}`));
            }
            this.worker = null;
        });
        return this.worker;
    }

    private handleMessage(message: WorkerResponse): void {
        const task = this.running;
        if (!task || task.id !== message.id) {
            return;
        }
        this.running = null;
        task.resolve(message.result);
        this.pump();
    }

    private handleCrash(error: Error): void {
        const task = this.running;
        this.running = null;
        this.worker = null;
        if (task) {
            task.resolve(workerFailedResult(task.input, error));
        }
        const pending = this.queue.splice(0);
        for (const queued of pending) {
            queued.resolve(workerFailedResult(queued.input, error));
        }
    }

    /**
     * HMR 或服务版本变更时关闭旧 worker，避免继续使用旧 loader 状态。
     */
    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        const error = new Error("profile compile worker disposed");
        if (this.running) {
            this.running.resolve(workerFailedResult(this.running.input, error));
        }
        this.running = null;
        for (const task of this.queue.splice(0)) {
            task.resolve(workerFailedResult(task.input, error));
        }
    }
}

function workerFailedResult(input: AgentProfileCompileRequestDto, error: Error): AgentProfileCompileResultDto {
    return {
        ok: false,
        stale: false,
        detail: null,
        preview: null,
        issues: [{
            severity: "error",
            message: error.message,
            code: "compile_worker_failed",
            fileName: input.fileName,
            stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
        }],
    };
}

function createCompileWorker(): Worker {
    if (process.versions.bun) {
        return new Worker(pathToFileURL(resolve(process.cwd(), "server", "agent", "profiles", "profile-compile-worker-entry.ts")), {
            execArgv: ["--import", "tsx"],
        });
    }
    return new Worker(NODE_WORKER_SOURCE, {
        eval: true,
    });
}

const NODE_WORKER_SOURCE = `
    import {parentPort} from "node:worker_threads";
    import {pathToFileURL} from "node:url";
    import {resolve} from "node:path";

    if (!parentPort) {
        throw new Error("profile compile worker parentPort missing");
    }

    const parentURL = pathToFileURL(resolve(process.cwd(), "server", "agent", "profiles", "profile-compile-worker-entry.ts")).href;
    const runtimeURL = pathToFileURL(resolve(process.cwd(), "server", "agent", "profiles", "profile-compile-worker-runtime.ts")).href;
    const tsconfig = resolve(process.cwd(), "tsconfig.json");
    const {tsImport} = await import("tsx/esm/api");
    const {runProfileCompile} = await tsImport(runtimeURL, {parentURL, tsconfig});

    parentPort.on("message", async (message) => {
        const result = await runProfileCompile(message.input);
        parentPort.postMessage({
            id: message.id,
            result,
        });
    });
`;
