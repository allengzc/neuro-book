import {Worker} from "node:worker_threads";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {existsSync} from "node:fs";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
} from "nbook/shared/dto/agent-profile.dto";

type CompileTask = {
    id: number;
    input: AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto;
    mode: "single" | "all";
    resolve: (result: AgentProfileCompileResultDto) => void;
    stale: boolean;
};

type WorkerResponse = {
    id: number;
    result: AgentProfileCompileResultDto;
};

type CompileWorkerPaths = {
    entry: string;
    runtime: string;
    tsconfig: string;
    tsxApiUrl: string;
    tsxLoaderUrl: string;
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
     * 提交单文件编译任务。同一 fileName 的等待任务会被标记 stale，并只保留最新源码。
     */
    compile(input: AgentProfileCompileRequestDto): Promise<AgentProfileCompileResultDto> {
        return this.enqueue("single", input);
    }

    /**
     * 提交全量编译任务。等待中的单文件任务都会标记 stale，避免旧 manifest 覆盖全量结果。
     */
    compileAll(input: AgentProfileCompileAllRequestDto = {preview: false}): Promise<AgentProfileCompileResultDto> {
        return this.enqueue("all", input);
    }

    private enqueue(mode: CompileTask["mode"], input: CompileTask["input"]): Promise<AgentProfileCompileResultDto> {
        const task: CompileTask = {
            id: this.nextId++,
            input,
            mode,
            resolve: () => {},
            stale: false,
        };
        const promise = new Promise<AgentProfileCompileResultDto>((resolvePromise) => {
            task.resolve = resolvePromise;
        });
        if (mode === "all") {
            this.markAllPendingStale();
        } else {
            this.markPendingStale((input as AgentProfileCompileRequestDto).fileName);
        }
        this.queue.push(task);
        this.pump();
        return promise;
    }

    private markPendingStale(fileName: string): void {
        for (const task of this.queue) {
            if (task.mode === "single" && "fileName" in task.input && task.input.fileName === fileName) {
                task.stale = true;
            }
        }
    }

    private markAllPendingStale(): void {
        for (const task of this.queue) {
            task.stale = true;
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
            mode: task.mode,
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

function workerFailedResult(input: AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto, error: Error): AgentProfileCompileResultDto {
    const fileName = "fileName" in input ? input.fileName : "*";
    return {
        ok: false,
        stale: false,
        detail: null,
        preview: null,
        issues: [{
            severity: "error",
            message: error.message,
            code: "compile_worker_failed",
            fileName,
            stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
        }],
    };
}

function createCompileWorker(): Worker {
    const workerPaths = resolveCompileWorkerPaths();
    if (process.versions.bun) {
        return new Worker(pathToFileURL(workerPaths.entry), {
            execArgv: ["--import", workerPaths.tsxLoaderUrl],
        });
    }
    return new Worker(renderNodeWorkerSource(workerPaths), {
        eval: true,
    });
}

/**
 * 解析 profile 编译 worker 的源码入口。Product Root 也必须带这些运行源码，
 * 但服务启动仍使用 `.output/server/index.mjs`，不是源码 dev server。
 */
function resolveCompileWorkerPaths(root = process.cwd()): CompileWorkerPaths {
    return resolveProfileCompileWorkerPathsForRoot(root);
}

/**
 * 按指定 Product/source root 解析 worker 入口和 TSX loader 依赖。
 */
export function resolveProfileCompileWorkerPathsForRoot(root: string): CompileWorkerPaths {
    const outputRoot = resolve(root, ".output", "server");
    const outputEntry = resolve(outputRoot, "server", "agent", "profiles", "profile-compile-worker-entry.ts");
    const outputRuntime = resolve(outputRoot, "server", "agent", "profiles", "profile-compile-worker-runtime.ts");
    if (existsSync(resolve(root, "release-meta.json")) && existsSync(outputEntry) && existsSync(outputRuntime)) {
        const tsxUrls = resolveTsxPackageUrls(resolve(outputRoot, "index.mjs"), true);
        return {
            entry: outputEntry,
            runtime: outputRuntime,
            tsconfig: resolvePreferredTsconfig(outputRoot),
            ...tsxUrls,
        };
    }

    const entry = resolve(root, "server", "agent", "profiles", "profile-compile-worker-entry.ts");
    const runtime = resolve(root, "server", "agent", "profiles", "profile-compile-worker-runtime.ts");
    if (!existsSync(entry) || !existsSync(runtime)) {
        throw new Error("Product runtime 缺少 profile compile worker 运行源码，请确认 server/ 已打入 product 根。");
    }
    return {
        entry,
        runtime,
        tsconfig: resolvePreferredTsconfig(root),
        ...resolveTsxPackageUrls(existsSync(resolve(root, "package.json")) ? resolve(root, "package.json") : entry, false),
    };
}

/**
 * 从指定上下文解析 TSX worker 依赖，避免 worker 使用 cwd 裸包名解析。
 */
function resolveTsxPackageUrls(requireRoot: string, productRuntime: boolean): {tsxApiUrl: string; tsxLoaderUrl: string} {
    return {
        tsxApiUrl: resolvePackageUrl(requireRoot, "tsx/esm/api", productRuntime),
        tsxLoaderUrl: resolvePackageUrl(requireRoot, "tsx", productRuntime),
    };
}

/**
 * 将 package specifier 解析为可动态 import 的绝对 file URL。
 */
function resolvePackageUrl(requireRoot: string, specifier: string, productRuntime: boolean): string {
    try {
        const requireFromRoot = createRequire(pathToFileURL(requireRoot));
        return pathToFileURL(requireFromRoot.resolve(specifier)).href;
    } catch (error) {
        if (productRuntime) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Product runtime 缺少 tsx vendor：无法从 .output/server/node_modules 解析 ${specifier}。请确认 product:stage 已复制 tsx。原始错误：${message}`);
        }
        throw error;
    }
}

/**
 * 优先使用 Nuxt server tsconfig，缺失时回退根 tsconfig。
 */
function resolvePreferredTsconfig(root: string): string {
    const serverTsconfig = resolve(root, ".nuxt", "tsconfig.server.json");
    if (existsSync(serverTsconfig)) {
        return serverTsconfig;
    }
    return resolve(root, "tsconfig.json");
}

function renderNodeWorkerSource(paths: CompileWorkerPaths): string {
    return `
    import {parentPort} from "node:worker_threads";
    import {pathToFileURL} from "node:url";

    if (!parentPort) {
        throw new Error("profile compile worker parentPort missing");
    }

    const parentURL = pathToFileURL(${JSON.stringify(paths.entry)}).href;
    const runtimeURL = pathToFileURL(${JSON.stringify(paths.runtime)}).href;
    const tsconfig = ${JSON.stringify(paths.tsconfig)};
    const {tsImport} = await import(${JSON.stringify(paths.tsxApiUrl)});
    const {runProfileCompile, runProfileCompileAll} = await tsImport(runtimeURL, {parentURL, tsconfig});

    parentPort.on("message", async (message) => {
        const result = message.mode === "all"
            ? await runProfileCompileAll(message.input)
            : await runProfileCompile(message.input);
        parentPort.postMessage({
            id: message.id,
            result,
        });
    });
`;
}
