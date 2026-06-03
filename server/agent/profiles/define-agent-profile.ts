import type {TSchema} from "typebox";
import type {AgentProfile, AgentProfileManifest} from "nbook/server/agent/profiles/types";
import {compileProfileContext, validateCompactionPlan, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";

/**
 * 定义一个 v3 Agent Profile。用户自定义 profile 必须通过这个函数导出。
 */
export function defineAgentProfile<
    const TInputSchema extends TSchema,
    const TOutputSchema extends TSchema,
    const TSummarizerKey extends string = string,
>(profile: AgentProfile<TInputSchema, TOutputSchema, TSummarizerKey>): AgentProfile<TInputSchema, TOutputSchema, TSummarizerKey> {
    assertProfileManifest(profile.manifest);
    assertProfileSummarizer(profile.manifest.key, profile.summarizer);
    validateCompactionPlan(profile.manifest.key, profile.compaction);
    assertProfileSidecars(profile.manifest.key, profile.allowedToolKeys, profile.sidecars);
    if (profile.context && profile.prepare) {
        throw new Error(`profile ${profile.manifest.key} 不能同时定义 context 和 prepare。`);
    }
    if (!profile.context && !profile.prepare) {
        throw new Error(`profile ${profile.manifest.key} 必须定义 context 或 prepare。`);
    }
    const prepare = profile.prepare
        ? async (...args: Parameters<NonNullable<typeof profile.prepare>>) => {
            const plan = await profile.prepare!(...args);
            validateProfileTurnPlan(profile.manifest.key, plan);
            return plan;
        }
        : async (...args: Parameters<NonNullable<AgentProfile<TInputSchema, TOutputSchema>["prepare"]>>) => {
            const ctx = args[0];
            const tree = await profile.context!(ctx);
            return compileProfileContext(profile, ctx, tree);
        };
    const runtime = profile.runtime
        ? defineAgentRuntime(profile.runtime)
        : agentRuntimeBuiltins.defaultSessionRuntime();
    return {
        ...profile,
        runtime,
        prepare,
    };
}

/**
 * 校验 profile manifest 的最小运行时合同。
 */
export function assertProfileManifest(manifest: AgentProfileManifest): void {
    if (!manifest.key.trim()) {
        throw new Error("profile manifest.key 不能为空");
    }
    if (!manifest.name.trim()) {
        throw new Error(`profile ${manifest.key} manifest.name 不能为空`);
    }
}

/**
 * 校验 summarizer 静态声明的最小 shape。
 */
function assertProfileSummarizer(profileKey: string, summarizer: AgentProfile["summarizer"]): void {
    if (!summarizer) {
        return;
    }
    if (summarizer.enabled === false) {
        return;
    }
    if (!summarizer.profileKey || !summarizer.profileKey.trim()) {
        throw new Error(`profile ${profileKey} summarizer.profileKey 不能为空`);
    }
    if (summarizer.input !== undefined && (typeof summarizer.input !== "object" || summarizer.input === null || Array.isArray(summarizer.input))) {
        throw new Error(`profile ${profileKey} summarizer.input 必须是对象`);
    }
}

/**
 * 校验 profile 声明的 sidecar pass。V1 只支持当前 profile 内 prepareRun/settleRun 自动旁路。
 */
function assertProfileSidecars(profileKey: string, allowedToolKeys: readonly string[], sidecars: readonly {name: string; stage: string; allowedToolKeys?: readonly string[]; outputFallback?: string}[] | undefined): void {
    if (!sidecars) {
        return;
    }
    const seen = new Set<string>();
    const allowed = new Set(allowedToolKeys);
    for (const sidecar of sidecars) {
        if (!sidecar.name.trim()) {
            throw new Error(`profile ${profileKey} sidecar.name 不能为空`);
        }
        if (seen.has(sidecar.name)) {
            throw new Error(`profile ${profileKey} sidecar 重复：${sidecar.name}`);
        }
        seen.add(sidecar.name);
        if (sidecar.stage !== "prepareRun" && sidecar.stage !== "settleRun") {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} stage 只支持 prepareRun 或 settleRun`);
        }
        for (const toolKey of sidecar.allowedToolKeys ?? []) {
            if (!allowed.has(toolKey)) {
                throw new Error(`profile ${profileKey} sidecar ${sidecar.name} allowedToolKeys 必须是 profile allowedToolKeys 子集：${toolKey}`);
            }
        }
        const sidecarToolKeys = sidecar.allowedToolKeys ?? allowedToolKeys;
        if (!sidecarToolKeys.includes("report_result") && !sidecar.outputFallback) {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} 未允许 report_result 时必须声明 outputFallback。`);
        }
    }
}
