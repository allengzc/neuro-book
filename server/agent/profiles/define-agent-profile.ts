import type {TSchema} from "typebox";
import type {AgentProfile, AgentProfileDefinition, AgentProfileManifest} from "nbook/server/agent/profiles/types";
import {compileProfileContext, validateCompactionPlan, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";

/**
 * 定义一个 v3 Agent Profile。用户自定义 profile 必须通过这个函数导出。
 */
export function defineAgentProfile<
    const TInputSchema extends TSchema,
    const TOutputSchema extends TSchema,
    const TSummarizerKey extends string = string,
    const TTools extends ProfileTools = ProfileTools,
>(profile: AgentProfileDefinition<TInputSchema, TOutputSchema, TSummarizerKey, TTools>): AgentProfile<TInputSchema, TOutputSchema, TSummarizerKey, TTools> {
    assertProfileManifest(profile.manifest);
    assertNoLegacyToolFields(profile.manifest.key, profile);
    const toolKeys = assertProfileTools(profile.manifest.key, profile.tools);
    assertProfileSummarizer(profile.manifest.key, profile.summarizer);
    validateCompactionPlan(profile.manifest.key, profile.compaction);
    assertMainRunToolKeys(profile.manifest.key, toolKeys, profile.mainRunToolKeys);
    assertProfileSidecars(profile.manifest.key, toolKeys, profile.sidecars);
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
        toolKeys,
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
 * 拒绝旧 profile 工具声明字段，避免 tools binding 硬切后出现双真相源。
 */
function assertNoLegacyToolFields(profileKey: string, profile: object): void {
    if ("allowedToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 allowedToolKeys，请改用 tools: defineProfileTools({...})。`);
    }
    if ("mainRunAllowedToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 mainRunAllowedToolKeys，请改用 mainRunToolKeys。`);
    }
}

/**
 * 校验 profile root tools 对象，并返回稳定工具 key 列表。
 */
function assertProfileTools<TTools extends ProfileTools>(profileKey: string, tools: TTools): readonly (keyof TTools & string)[] {
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
        throw new Error(`profile ${profileKey} 必须定义 tools 对象。`);
    }
    const toolKeys = Object.keys(tools) as (keyof TTools & string)[];
    const seen = new Set<string>();
    for (const toolKey of toolKeys) {
        if (!toolKey.trim()) {
            throw new Error(`profile ${profileKey} tools 不能包含空 key。`);
        }
        if (seen.has(toolKey)) {
            throw new Error(`profile ${profileKey} tools 重复：${toolKey}`);
        }
        seen.add(toolKey);
        const binding = tools[toolKey];
        if (!binding || typeof binding !== "object") {
            throw new Error(`profile ${profileKey} tools.${toolKey} 必须是 ToolBinding。`);
        }
        if (binding.key !== toolKey) {
            throw new Error(`profile ${profileKey} tools.${toolKey} 的 binding.key 必须等于对象 key，当前为 ${binding.key}`);
        }
    }
    return toolKeys;
}

/**
 * 校验主 run 的执行工具子集，允许 profile 为 sidecar 保留更大的 provider 可见工具集合。
 */
function assertMainRunToolKeys(profileKey: string, toolKeys: readonly string[], mainRunToolKeys: readonly string[] | undefined): void {
    if (!mainRunToolKeys) {
        return;
    }
    const allowed = new Set(toolKeys);
    for (const toolKey of mainRunToolKeys) {
        if (!allowed.has(toolKey)) {
            throw new Error(`profile ${profileKey} mainRunToolKeys 必须是 tools 子集：${toolKey}`);
        }
    }
}

/**
 * 校验 profile 声明的 sidecar pass。V1 只支持当前 profile 内 prepareRun/settleRun 自动旁路。
 */
function assertProfileSidecars(profileKey: string, toolKeys: readonly string[], sidecars: readonly {name: string; stage: string; toolKeys?: readonly string[]; allowedToolKeys?: readonly string[]; outputFallback?: string}[] | undefined): void {
    if (!sidecars) {
        return;
    }
    const seen = new Set<string>();
    const allowed = new Set(toolKeys);
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
        if ("allowedToolKeys" in sidecar) {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} 已移除 allowedToolKeys，请改用 toolKeys。`);
        }
        for (const toolKey of sidecar.toolKeys ?? []) {
            if (!allowed.has(toolKey)) {
                throw new Error(`profile ${profileKey} sidecar ${sidecar.name} toolKeys 必须是 profile tools 子集：${toolKey}`);
            }
        }
        const sidecarToolKeys = sidecar.toolKeys ?? toolKeys;
        if (!sidecarToolKeys.includes("report_result") && !sidecar.outputFallback) {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} 未允许 report_result 时必须声明 outputFallback。`);
        }
    }
}
