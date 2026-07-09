import {readFile, readdir, stat} from "node:fs/promises";
import {basename, join, relative, resolve} from "node:path";
import {AgentProfileCatalog, type AgentProfileBuildCoordinatorPort, type AgentProfileBuildState} from "nbook/server/agent/profiles/catalog";
import {hashFile, readProfileArtifactManifest, validateProfileArtifact} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {ProfileCompilePublishOptions} from "nbook/server/agent/profiles/profile-compile-worker-types";
import {useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {resolveUserNbookRoot} from "nbook/server/workspace-files/workspace-assets-root";
import {appLogger} from "nbook/server/app-logs/logger";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
} from "nbook/shared/dto/agent-profile.dto";

const PROFILE_BUILD_DEBOUNCE_MS = 500;

type QueuedProfileBuild = {
    fileName?: string;
    profileKey: string;
    profileKeys: string[];
    reason: string;
};

export type ProfileBuildWorkerPort = {
    compile(input: AgentProfileCompileRequestDto, publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto>;
    compileAll(input: AgentProfileCompileAllRequestDto, publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto>;
};

/**
 * HTTP runtime 的 profile 构建编排器。它只负责排队、去抖、状态和 worker 调度；
 * artifact 由主线程 worker service 通过 in-process Publisher 发布并翻转 Registry。
 */
export class ProfileBuildCoordinator implements AgentProfileBuildCoordinatorPort {
    private readonly states = new Map<string, AgentProfileBuildState>();
    private readonly queue = new Map<string, QueuedProfileBuild>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;

    constructor(readonly input: {
        catalog: AgentProfileCatalog;
        userProfileRoot?: string;
        debounceMs?: number;
        worker?: ProfileBuildWorkerPort;
    }) {}

    /**
     * 读取 profile 当前构建状态。
     */
    stateFor(profileKey: string): AgentProfileBuildState {
        return this.states.get(profileKey) ?? idleProfileBuildState();
    }

    /**
     * 入队一次构建请求。多个请求在 500ms 单窗口内合并。
     */
    async enqueue(input: {fileName?: string; reason: string}): Promise<void> {
        const profileKey = input.fileName
            ? await this.profileKeyFromFile(input.fileName)
            : "*";
        const profileKeys = input.fileName ? [profileKey] : await this.profileKeysForFullBuild();
        const key = input.fileName ?? "*";
        this.queue.set(key, {
            fileName: input.fileName,
            profileKey,
            profileKeys,
            reason: input.reason,
        });
        const updatedAt = new Date().toISOString();
        for (const key of profileKeys) {
            this.states.set(key, {
                running: false,
                queued: true,
                reason: input.reason,
                updatedAt,
            });
        }
        this.schedule();
    }

    /**
     * 启动后对账源码集合与 manifest。这里只验源码 sha/bytes 与 compilerVersion gate，
     * 不做依赖全量 rehash；依赖变化由运行期 watcher 触发重编。
     */
    async bootSweep(): Promise<void> {
        const profileRoot = resolve(this.input.userProfileRoot ?? defaultUserProfileRoot());
        const [files, manifest] = await Promise.all([
            this.findProfileFiles(profileRoot),
            readProfileArtifactManifest(profileRoot),
        ]);
        for (const file of files) {
            const entry = manifest.entries.find((item) => item.fileName === file.fileName);
            if (!entry || entry.status === "compile_failed") {
                await this.enqueue({fileName: file.fileName, reason: "profile_boot_sweep"});
                continue;
            }
            const sourceHash = await hashFile(file.absolutePath).catch(() => null);
            if (!sourceHash || sourceHash.sha256 !== entry.sourceSha256 || sourceHash.bytes !== entry.sourceBytes) {
                await this.enqueue({fileName: file.fileName, reason: "profile_boot_sweep"});
            }
        }
    }

    /**
     * 清理待运行 timer。不会主动 terminate 全局 worker，避免影响其它手动编译调用。
     */
    async dispose(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.queue.clear();
        this.running = false;
    }

    private schedule(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.pump();
        }, this.input.debounceMs ?? PROFILE_BUILD_DEBOUNCE_MS);
    }

    private async pump(): Promise<void> {
        if (this.running || this.queue.size === 0) {
            return;
        }
        this.running = true;
        const batch = [...this.queue.values()];
        this.queue.clear();
        const runnableBatch: QueuedProfileBuild[] = [];
        const skippedAt = new Date().toISOString();
        for (const item of batch) {
            if (item.fileName && await this.profileEntryIsFresh(item.fileName)) {
                for (const profileKey of item.profileKeys) {
                    this.states.set(profileKey, {
                        running: false,
                        queued: false,
                        reason: null,
                        updatedAt: skippedAt,
                    });
                }
                continue;
            }
            runnableBatch.push(item);
        }
        if (runnableBatch.length === 0) {
            this.running = false;
            if (this.queue.size > 0) {
                this.schedule();
            }
            return;
        }
        const startedAt = new Date().toISOString();
        for (const item of runnableBatch) {
            for (const profileKey of item.profileKeys) {
                this.states.set(profileKey, {
                    running: true,
                    queued: false,
                    reason: item.reason,
                    updatedAt: startedAt,
                });
            }
        }
        try {
            const worker = this.input.worker ?? useProfileCompileWorker();
            const publish: ProfileCompilePublishOptions = {
                mode: "in_process",
                registry: this.input.catalog,
            };
            const result = runnableBatch.length === 1 && runnableBatch[0]?.fileName
                ? await worker.compile({fileName: runnableBatch[0].fileName, dryRun: false, preview: false}, publish)
                : await worker.compileAll({preview: false}, publish);
            if (result.stale) {
                await this.requeueStaleBatch(runnableBatch);
                return;
            }
            const finishedAt = new Date().toISOString();
            for (const item of runnableBatch) {
                for (const profileKey of item.profileKeys) {
                    this.states.set(profileKey, {
                        running: false,
                        queued: false,
                        reason: result.ok ? null : item.reason,
                        updatedAt: finishedAt,
                    });
                }
            }
            for (const profile of result.profiles ?? []) {
                this.states.set(profile.profileKey, {
                    running: false,
                    queued: false,
                    reason: profile.loadStatus === "loaded" ? null : "profile_build_finished",
                    updatedAt: finishedAt,
                });
            }
        } catch (error) {
            const failedAt = new Date().toISOString();
            for (const item of runnableBatch) {
                for (const profileKey of item.profileKeys) {
                    this.states.set(profileKey, {
                        running: false,
                        queued: false,
                        reason: "profile_build_failed",
                        updatedAt: failedAt,
                    });
                }
            }
            void appLogger.warn("agent.profileBuild.failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            await this.input.catalog.refreshRuntimeRegistry("profile_build_failed");
        } finally {
            this.running = false;
            if (this.queue.size > 0) {
                this.schedule();
            }
        }
    }

    private async requeueStaleBatch(batch: QueuedProfileBuild[]): Promise<void> {
        let fullBuildQueued = false;
        for (const item of batch) {
            if (item.fileName && !await this.profileSourceExists(item.fileName)) {
                if (!fullBuildQueued) {
                    fullBuildQueued = true;
                    await this.enqueue({
                        reason: "profile_build_stale_source_missing",
                    });
                }
                continue;
            }
            await this.enqueue({
                fileName: item.fileName,
                reason: "profile_build_stale",
            });
        }
    }

    private async profileKeyFromFile(fileName: string): Promise<string> {
        const sourcePath = resolve(this.input.userProfileRoot ?? defaultUserProfileRoot(), ...fileName.split("/"));
        const source = await readFile(sourcePath, "utf8").catch(() => "");
        const match = source.match(/\bkey\s*:\s*["'`]([^"'`]+)["'`]/u);
        return match?.[1] ?? basename(fileName).replace(/\.profile\.(tsx|ts|mjs|js)$/u, "");
    }

    private async profileSourceExists(fileName: string): Promise<boolean> {
        const sourcePath = resolve(this.input.userProfileRoot ?? defaultUserProfileRoot(), ...fileName.split("/"));
        return stat(sourcePath).then(() => true, () => false);
    }

    private async profileEntryIsFresh(fileName: string): Promise<boolean> {
        const profileRoot = resolve(this.input.userProfileRoot ?? defaultUserProfileRoot());
        const manifest = await readProfileArtifactManifest(profileRoot).catch(() => null);
        const entry = manifest?.entries.find((item) => item.fileName === fileName);
        if (!entry || entry.status === "compile_failed") {
            return false;
        }
        const validation = await validateProfileArtifact(profileRoot, entry, {
            requireTypeArtifact: true,
            checkDependencies: false,
        });
        return validation.fresh;
    }

    private async profileKeysForFullBuild(): Promise<string[]> {
        const snapshot = await this.input.catalog.snapshot({includeFileIssues: false}).catch(() => null);
        const keys = snapshot?.profiles
            .filter((profile) => profile.source === "user")
            .map((profile) => profile.key) ?? [];
        return keys.length > 0 ? keys : ["*"];
    }

    private async findProfileFiles(root: string, current = root): Promise<Array<{fileName: string; absolutePath: string}>> {
        const entries = await readdir(current, {withFileTypes: true}).catch(() => []);
        const files: Array<{fileName: string; absolutePath: string}> = [];
        for (const entry of entries) {
            const fullPath = join(current, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.findProfileFiles(root, fullPath));
                continue;
            }
            if (!entry.isFile() || !/\.profile\.(tsx|ts|mjs|js)$/u.test(entry.name)) {
                continue;
            }
            await stat(fullPath);
            files.push({
                absolutePath: fullPath,
                fileName: relative(root, fullPath).split(/[\\/]+/).join("/"),
            });
        }
        return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
    }
}

function idleProfileBuildState(): AgentProfileBuildState {
    return {
        running: false,
        queued: false,
        reason: null,
        updatedAt: null,
    };
}

function defaultUserProfileRoot(): string {
    return resolve(resolveUserNbookRoot(), "agent", "profiles");
}
