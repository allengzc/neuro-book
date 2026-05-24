import {performance} from "node:perf_hooks";
import {randomUUID} from "node:crypto";
import {cp, rm} from "node:fs/promises";
import {resolve} from "node:path";
import {compileProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {readProfileSource, saveProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import type {
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
    AgentProfileIssueDto,
} from "nbook/shared/dto/agent-profile.dto";

/**
 * Worker 内执行真实 profile 编译。这里允许走完整 runtime loader，
 * 因为它运行在 worker 线程中，不阻塞 Nitro 主事件循环。
 */
export async function runProfileCompile(input: AgentProfileCompileRequestDto): Promise<AgentProfileCompileResultDto> {
    const startedAt = performance.now();
    try {
        const userProfileRoot = resolve(process.cwd(), "workspace", ".nbook", "agent", "profiles");
        if (input.dryRun) {
            const result = await runDryRunProfilePreview(input, userProfileRoot);
            return {
                ...result,
                elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
            };
        }
        await compileProfileArtifacts({
            profileRoot: userProfileRoot,
            fileName: input.fileName,
            rootLabel: "workspace/.nbook/agent/profiles",
        });
        const profiles = new AgentProfileCatalog(undefined, userProfileRoot);
        const result = await (async () => {
            const detail = await readProfileSource(profiles, {fileName: input.fileName}, {
                userProfileRoot,
            });
            const issues = detail.issues;
            if (issues.some((issue) => issue.severity === "error") || !detail.manifest?.key) {
                return {
                    ok: false,
                    stale: false,
                    detail,
                    preview: null,
                    issues,
                } satisfies AgentProfileCompileResultDto;
            }
            if (!input.preview) {
                return {
                    ok: true,
                    stale: false,
                    detail,
                    preview: null,
                    issues,
                } satisfies AgentProfileCompileResultDto;
            }
            const [{NeuroAgentHarness}, {previewAgentProfilePrepare}] = await Promise.all([
                import("nbook/server/agent/harness/neuro-agent-harness"),
                import("nbook/server/agent/profiles/profile-http-service"),
            ]);
            const preview = await previewAgentProfilePrepare(new NeuroAgentHarness({
                profiles,
            }), {
                profileKey: detail.manifest.key,
                sessionId: input.sessionId,
                input: input.input,
                inputOverrides: input.inputOverrides,
            });
            return {
                ok: preview.ok && issues.every((issue) => issue.severity !== "error"),
                stale: false,
                detail,
                preview,
                issues: [...issues, ...preview.issues],
            } satisfies AgentProfileCompileResultDto;
        })();
        return {
            ...result,
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    } catch (error) {
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [issueFromError(error, input.fileName)],
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    }
}

/**
 * 在后台 worker 内用临时 profile root 预览当前源码，不污染真实用户 `.compiled`。
 */
async function runDryRunProfilePreview(input: AgentProfileCompileRequestDto, userProfileRoot: string): Promise<AgentProfileCompileResultDto> {
    const temporaryRoot = resolve(process.cwd(), ".agent", "workspace", "profile-source-check", randomUUID());
    try {
        await cp(userProfileRoot, temporaryRoot, {recursive: true, force: true}).catch(() => undefined);
        if (input.source !== undefined) {
            await saveProfileSourceDraft({
                fileName: input.fileName,
                source: input.source,
            }, {
                userProfileRoot: temporaryRoot,
            });
        }
        await compileProfileArtifacts({
            profileRoot: temporaryRoot,
            fileName: input.fileName,
            rootLabel: "temporary-profile-source-check",
        });
        const profiles = new AgentProfileCatalog(undefined, temporaryRoot);
        const detail = await readProfileSource(profiles, {fileName: input.fileName}, {
            userProfileRoot: temporaryRoot,
        });
        const issues = detail.issues;
        if (issues.some((issue) => issue.severity === "error") || !detail.manifest?.key) {
            return {
                ok: false,
                stale: false,
                detail,
                preview: null,
                issues,
            };
        }
        if (!input.preview) {
            return {
                ok: true,
                stale: false,
                detail,
                preview: null,
                issues,
            };
        }
        const [{NeuroAgentHarness}, {previewAgentProfilePrepare}] = await Promise.all([
            import("nbook/server/agent/harness/neuro-agent-harness"),
            import("nbook/server/agent/profiles/profile-http-service"),
        ]);
        const preview = await previewAgentProfilePrepare(new NeuroAgentHarness({
            profiles,
        }), {
            profileKey: detail.manifest.key,
            sessionId: input.sessionId,
            input: input.input,
            inputOverrides: input.inputOverrides,
        });
        return {
            ok: preview.ok && issues.every((issue) => issue.severity !== "error"),
            stale: false,
            detail,
            preview,
            issues: [...issues, ...preview.issues],
        };
    } finally {
        await rm(temporaryRoot, {recursive: true, force: true});
    }
}

/**
 * 将 worker 内异常收敛为 DTO issue，避免跨线程 Error 对象序列化差异。
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
