import {performance} from "node:perf_hooks";
import {withProfileSourceOverride} from "nbook/server/agent/profiles/profile-source-check";
import {readProfileSource} from "nbook/server/agent/profiles/workbench-service";
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
        const result = await withProfileSourceOverride(input, async (profiles, temporaryUserRoot) => {
            const detail = await readProfileSource(profiles, {fileName: input.fileName}, {
                userProfileRoot: temporaryUserRoot,
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
        });
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
