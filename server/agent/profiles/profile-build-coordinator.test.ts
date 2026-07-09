import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {PROFILE_ARTIFACT_COMPILER_VERSION} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {ProfileBuildCoordinator, type ProfileBuildWorkerPort} from "nbook/server/agent/profiles/profile-build-coordinator";
import type {AgentProfileCompileResultDto} from "nbook/shared/dto/agent-profile.dto";

describe("ProfileBuildCoordinator", () => {
    let root: string;
    let userRoot: string;

    beforeEach(async () => {
        root = resolve(".agent", "workspace", "profile-build-coordinator-test", randomUUID());
        userRoot = join(root, "workspace", ".nbook", "agent", "profiles");
        await mkdir(userRoot, {recursive: true});
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("源码保存入队后立即暴露 queued，并在 debounce 后清理状态", async () => {
        await writeProfile("custom.auto.profile.tsx", `export const profileManifest = { key: "custom.auto", name: "Auto" } as const;`);
        const calls: string[] = [];
        const worker = fakeWorker({
            compile: async (input) => {
                calls.push(input.fileName);
                return compileResult(true, [{
                    profileKey: "custom.auto",
                    fileName: input.fileName,
                    loadStatus: "loaded",
                }]);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await catalog.enqueueBuild({fileName: "custom.auto.profile.tsx", reason: "profile_source_saved"});

        expect(catalog.buildStateFor("custom.auto")).toEqual(expect.objectContaining({
            queued: true,
            running: false,
            reason: "profile_source_saved",
        }));
        await sleep(20);
        expect(calls).toEqual(["custom.auto.profile.tsx"]);
        expect(catalog.buildStateFor("custom.auto")).toEqual(expect.objectContaining({
            queued: false,
            running: false,
            reason: null,
        }));
    });

    it("同一窗口多个文件合并为 compileAll", async () => {
        await writeProfile("custom.one.profile.tsx", `export const profileManifest = { key: "custom.one", name: "One" } as const;`);
        await writeProfile("custom.two.profile.tsx", `export const profileManifest = { key: "custom.two", name: "Two" } as const;`);
        let compileAllCount = 0;
        const worker = fakeWorker({
            compileAll: async () => {
                compileAllCount += 1;
                return compileResult(true, [
                    {profileKey: "custom.one", fileName: "custom.one.profile.tsx", loadStatus: "loaded"},
                    {profileKey: "custom.two", fileName: "custom.two.profile.tsx", loadStatus: "loaded"},
                ]);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await catalog.enqueueBuild({fileName: "custom.one.profile.tsx", reason: "watch:change"});
        await catalog.enqueueBuild({fileName: "custom.two.profile.tsx", reason: "watch:change"});
        await waitFor(() => {
            expect(compileAllCount).toBe(1);
        }, 3_000);

        expect(compileAllCount).toBe(1);
        expect(catalog.buildStateFor("custom.one").reason).toBeNull();
        expect(catalog.buildStateFor("custom.two").reason).toBeNull();
    });

    it("watcher 事件发现源码已被当前 manifest 覆盖时不重复编译", async () => {
        const fileName = "custom.synced.profile.tsx";
        const source = `export const profileManifest = { key: "custom.synced", name: "Synced" } as const;`;
        await writeProfile(fileName, source);
        await writeFreshManifest(fileName, "custom.synced", source);
        const calls: string[] = [];
        const worker = fakeWorker({
            compile: async (input) => {
                calls.push(input.fileName);
                return compileResult(true, []);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await catalog.enqueueBuild({fileName, reason: "watch:change"});
        await sleep(20);

        expect(calls).toEqual([]);
        expect(catalog.buildStateFor("custom.synced")).toEqual(expect.objectContaining({
            queued: false,
            running: false,
            reason: null,
        }));
    });

    it("watcher 事件发现 artifact 缺失时仍会启动编译", async () => {
        const fileName = "custom.missing-artifact.profile.tsx";
        const source = `export const profileManifest = { key: "custom.missingArtifact", name: "Missing Artifact" } as const;`;
        await writeProfile(fileName, source);
        await writeFreshManifest(fileName, "custom.missingArtifact", source, {createArtifacts: false});
        const calls: string[] = [];
        const worker = fakeWorker({
            compile: async (input) => {
                calls.push(input.fileName);
                return compileResult(true, [{
                    profileKey: "custom.missingArtifact",
                    fileName: input.fileName,
                    loadStatus: "loaded",
                }]);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await catalog.enqueueBuild({fileName, reason: "watch:change"});
        await sleep(20);

        expect(calls).toEqual([fileName]);
    });

    it("boot sweep 会把缺少 manifest entry 的用户 profile 入队自愈", async () => {
        await writeProfile("custom.boot.profile.tsx", `export const profileManifest = { key: "custom.boot", name: "Boot" } as const;`);
        const calls: string[] = [];
        const worker = fakeWorker({
            compile: async (input) => {
                calls.push(input.fileName);
                return compileResult(true, [{
                    profileKey: "custom.boot",
                    fileName: input.fileName,
                    loadStatus: "loaded",
                }]);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await coordinator.bootSweep();

        expect(catalog.buildStateFor("custom.boot")).toEqual(expect.objectContaining({
            queued: true,
            reason: "profile_boot_sweep",
        }));
        await sleep(20);
        expect(calls).toEqual(["custom.boot.profile.tsx"]);
    });

    it("boot sweep 遇到旧 compilerVersion manifest 时保留用户源码并入队重编", async () => {
        const fileName = "custom.bump.profile.tsx";
        const source = `export const profileManifest = { key: "custom.bump", name: "Bump" } as const;`;
        await writeProfile(fileName, source);
        await mkdir(join(userRoot, ".compiled"), {recursive: true});
        await writeFile(join(userRoot, ".compiled", "manifest.json"), JSON.stringify({
            compilerVersion: 5,
            generatedAt: "2026-01-01T00:00:00.000Z",
            profilesRoot: "workspace/.nbook/agent/profiles",
            profiles: {
                "custom.bump": {
                    status: "loaded",
                    fileName,
                    profileKey: "custom.bump",
                    sourceSha256: "stale",
                    sourceBytes: 0,
                    dependencyHash: "stale",
                    artifactSha: "stale",
                    artifactBytes: 0,
                    dependencies: [],
                },
            },
        }, null, 2), "utf8");
        const calls: string[] = [];
        const worker = fakeWorker({
            compile: async (input) => {
                calls.push(input.fileName);
                return compileResult(true, [{
                    profileKey: "custom.bump",
                    fileName: input.fileName,
                    loadStatus: "loaded",
                }]);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 50, worker});
        catalog.attachBuildCoordinator(coordinator);

        await coordinator.bootSweep();

        await expect(readFile(join(userRoot, fileName), "utf8")).resolves.toBe(source);
        expect(catalog.buildStateFor("custom.bump")).toEqual(expect.objectContaining({
            queued: true,
            reason: "profile_boot_sweep",
        }));
        await sleep(80);
        expect(calls).toEqual([fileName]);
    });

    it("worker 返回 stale 时丢弃旧结果并重新入队", async () => {
        await writeProfile("custom.stale.profile.tsx", `export const profileManifest = { key: "custom.stale", name: "Stale" } as const;`);
        const calls: string[] = [];
        const worker = fakeWorker({
            compile: async (input) => {
                calls.push(input.fileName);
                if (calls.length === 1) {
                    return {
                        ...compileResult(false, []),
                        stale: true,
                    };
                }
                return compileResult(true, [{
                    profileKey: "custom.stale",
                    fileName: input.fileName,
                    loadStatus: "loaded",
                }]);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await catalog.enqueueBuild({fileName: "custom.stale.profile.tsx", reason: "profile_source_saved"});
        await sleep(50);

        expect(calls).toEqual(["custom.stale.profile.tsx", "custom.stale.profile.tsx"]);
        expect(catalog.buildStateFor("custom.stale")).toEqual(expect.objectContaining({
            queued: false,
            running: false,
            reason: null,
        }));
    });

    it("worker 返回 stale 且源码已删除时升格为 full build", async () => {
        const fileName = "custom.deleted-stale.profile.tsx";
        await writeProfile(fileName, `export const profileManifest = { key: "custom.deletedStale", name: "Deleted Stale" } as const;`);
        const compileCalls: string[] = [];
        let compileAllCount = 0;
        const worker = fakeWorker({
            compile: async (input) => {
                compileCalls.push(input.fileName);
                await rm(join(userRoot, input.fileName), {force: true});
                return {
                    ...compileResult(false, []),
                    stale: true,
                };
            },
            compileAll: async () => {
                compileAllCount += 1;
                return compileResult(true, []);
            },
        });
        const catalog = new AgentProfileCatalog("__missing_system__", userRoot);
        const coordinator = new ProfileBuildCoordinator({catalog, userProfileRoot: userRoot, debounceMs: 1, worker});
        catalog.attachBuildCoordinator(coordinator);

        await catalog.enqueueBuild({fileName, reason: "profile_source_saved"});
        await sleep(80);

        expect(compileCalls).toEqual([fileName]);
        expect(compileAllCount).toBe(1);
    });

    async function writeProfile(fileName: string, source: string): Promise<void> {
        await writeFile(join(userRoot, fileName), source, "utf8");
    }

    async function writeFreshManifest(fileName: string, profileKey: string, source: string, options: {createArtifacts?: boolean} = {}): Promise<void> {
        const sourceHash = createHash("sha256").update(source).digest("hex");
        const artifactSource = "test";
        const artifactSha = createHash("sha256").update(artifactSource).digest("hex");
        const artifactFileName = `artifacts/${artifactSha}.mjs`;
        const typeFileName = `artifacts/${artifactSha}.types.d.ts`;
        await mkdir(join(userRoot, ".compiled"), {recursive: true});
        if (options.createArtifacts !== false) {
            await mkdir(join(userRoot, ".compiled", "artifacts"), {recursive: true});
            await writeFile(join(userRoot, ".compiled", artifactFileName), artifactSource, "utf8");
            await writeFile(join(userRoot, ".compiled", typeFileName), artifactSource, "utf8");
        }
        await writeFile(join(userRoot, ".compiled", "manifest.json"), JSON.stringify({
            compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
            generatedAt: "2026-01-01T00:00:00.000Z",
            profilesRoot: "workspace/.nbook/agent/profiles",
            entries: [{
                status: "loaded",
                fileName,
                profileKey,
                sourceSha256: sourceHash,
                sourceBytes: Buffer.byteLength(source),
                dependencyHash: "test",
                artifactFileName,
                artifactSha256: artifactSha,
                artifactBytes: Buffer.byteLength(artifactSource),
                typeFileName,
                typeSha256: artifactSha,
                typeBytes: Buffer.byteLength(artifactSource),
                dependencies: [],
            }],
            profiles: [{
                status: "loaded",
                fileName,
                profileKey,
                sourceSha256: sourceHash,
                sourceBytes: Buffer.byteLength(source),
                dependencyHash: "test",
                artifactFileName,
                artifactSha256: artifactSha,
                artifactBytes: Buffer.byteLength(artifactSource),
                typeFileName,
                typeSha256: artifactSha,
                typeBytes: Buffer.byteLength(artifactSource),
                dependencies: [],
            }],
        }, null, 2), "utf8");
    }
});

function fakeWorker(overrides: {
    compile?: ProfileBuildWorkerPort["compile"];
    compileAll?: ProfileBuildWorkerPort["compileAll"];
}): ProfileBuildWorkerPort {
    return {
        async compile(input) {
            return overrides.compile?.(input) ?? compileResult(false, []);
        },
        async compileAll(input) {
            return overrides.compileAll?.(input) ?? compileResult(false, []);
        },
    };
}

function compileResult(ok: boolean, profiles: NonNullable<AgentProfileCompileResultDto["profiles"]>): AgentProfileCompileResultDto {
    return {
        ok,
        stale: false,
        detail: null,
        preview: null,
        issues: [],
        profiles,
    };
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, ms);
    });
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await sleep(10);
        }
    }
    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error(String(lastError));
}
