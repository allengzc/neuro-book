import type {TSchema} from "typebox";
import type {AgentProfile, AgentProfileDefinition, AgentProfileManifest, ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {compileProfileContext, validateCompactionPlan, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";
import {parseLowCodeFormValue, type LowCodeFormDefinition} from "nbook/server/low-code-form";

/**
 * 定义一个 v3 Agent Profile。用户自定义 profile 必须通过这个函数导出。
 */
export function defineAgentProfile<
    const TInitialSchema extends TSchema,
    const TPayloadSchema extends TSchema = TSchema,
    const TOutputSchema extends TSchema = TSchema,
    const TSettingsSchema extends TSchema | undefined = undefined,
    const TSummarizerKey extends string = string,
    const TTools extends ProfileTools = ProfileTools,
>(profile: AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools>): AgentProfile<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools> {
    assertProfileManifest(profile.manifest);
    assertNoLegacyToolFields(profile.manifest.key, profile);
    const rootToolKeys = assertProfileTools(profile.manifest.key, profile.tools);
    assertProfileSummarizer(profile.manifest.key, profile.summarizer);
    assertProfileSkills(profile.manifest.key, profile.skills);
    validateCompactionPlan(profile.manifest.key, profile.compaction);
    assertProfileToolKeys(profile.manifest.key, rootToolKeys, profile.toolKeys);
    assertProfileSidecars(profile.manifest.key, rootToolKeys, profile.sidecars);
    if (profile.context && profile.prepare) {
        throw new Error(`profile ${profile.manifest.key} 不能同时定义 context 和 prepare。`);
    }
    if (!profile.context && !profile.prepare) {
        throw new Error(`profile ${profile.manifest.key} 必须定义 context 或 prepare。`);
    }
    const prepare = profile.prepare
        ? async (...args: Parameters<NonNullable<typeof profile.prepare>>) => {
            const ctx = withSkillInclude(profile, withDefaultSettings(profile, args[0]));
            const plan = await profile.prepare!(ctx as never);
            validateProfileTurnPlan(profile.manifest.key, plan);
            return plan;
        }
        : async (...args: Parameters<NonNullable<AgentProfile<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema>["prepare"]>>) => {
            const ctx = withSkillInclude(profile, withDefaultSettings(profile, args[0]));
            const tree = await profile.context!(ctx);
            return compileProfileContext(profile, ctx, tree);
        };
    const runtime = profile.runtime
        ? defineAgentRuntime(profile.runtime)
        : agentRuntimeBuiltins.defaultSessionRuntime();
    return {
        ...profile,
        rootToolKeys,
        runtime,
        prepare,
    };
}

/**
 * 为手工调用 profile.prepare 的旧测试和预览路径补齐默认 settings。
 */
function withDefaultSettings<TContext extends ProfilePrepareContext>(
    profile: {settingsForm?: LowCodeFormDefinition},
    ctx: TContext,
): TContext {
    if (ctx.settings !== undefined) {
        return ctx;
    }
    return {
        ...ctx,
        settings: profile.settingsForm ? parseLowCodeFormValue(profile.settingsForm, undefined) : {},
    } as TContext;
}

/**
 * 按 profile 声明的 skill 白名单过滤 prepare ctx 的可见 skill 快照。
 * 在 prepare 包装层统一过滤，SkillCatalog 与自定义 text 函数等所有消费者拿到的都是同一份过滤结果。
 * 白名单外的 key 静默丢弃；未声明 skills 时保持全量。
 */
function withSkillInclude<TContext extends ProfilePrepareContext>(
    profile: {skills?: {include: readonly string[]}},
    ctx: TContext,
): TContext {
    if (!profile.skills) {
        return ctx;
    }
    const include = new Set(profile.skills.include);
    return {
        ...ctx,
        skills: ctx.skills.filter((skill) => include.has(skill.key)),
    } as TContext;
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
    if (manifest.version !== undefined && (!Number.isInteger(manifest.version) || manifest.version < 1)) {
        throw new Error(`profile ${manifest.key} manifest.version 必须是正整数。`);
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
 * 校验 profile skill 白名单声明：include 必须是非空、去重的 skill key 数组。
 */
function assertProfileSkills(profileKey: string, skills: AgentProfileDefinition["skills"]): void {
    if (!skills) {
        return;
    }
    if (!Array.isArray(skills.include)) {
        throw new Error(`profile ${profileKey} skills.include 必须是 skill key 数组。`);
    }
    const seen = new Set<string>();
    for (const skillKey of skills.include) {
        if (typeof skillKey !== "string" || !skillKey.trim()) {
            throw new Error(`profile ${profileKey} skills.include 不能包含空 key。`);
        }
        if (seen.has(skillKey)) {
            throw new Error(`profile ${profileKey} skills.include 重复：${skillKey}`);
        }
        seen.add(skillKey);
    }
}

/**
 * 拒绝旧 profile 工具声明字段，避免 tools binding 硬切后出现双真相源。
 */
function assertNoLegacyToolFields(profileKey: string, profile: object): void {
    if ("allowedToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 allowedToolKeys，请改用 tools: toolset(...)。`);
    }
    if ("mainRunAllowedToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 mainRunAllowedToolKeys，请改用 toolKeys。`);
    }
    if ("mainRunToolKeys" in profile) {
        throw new Error(`profile ${profileKey} 已移除 mainRunToolKeys，请改用 toolKeys。`);
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
function assertProfileToolKeys(profileKey: string, rootToolKeys: readonly string[], toolKeys: readonly string[] | undefined): void {
    if (!toolKeys) {
        return;
    }
    const allowed = new Set(rootToolKeys);
    for (const toolKey of toolKeys) {
        if (!allowed.has(toolKey)) {
            throw new Error(`profile ${profileKey} toolKeys 必须是 tools 子集：${toolKey}`);
        }
    }
}

/**
 * 校验 profile 声明的 sidecar pass。V1 只支持当前 profile 内 prepareRun/settleRun 自动旁路。
 */
function assertProfileSidecars(profileKey: string, toolKeys: readonly string[], sidecars: readonly {name: string; stage: string; toolKeys?: readonly string[]; allowedToolKeys?: readonly string[]; outputFallback?: string; sidecarDataSchema?: TSchema}[] | undefined): void {
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
        if (sidecarToolKeys.includes("report_result")) {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} 不能使用 report_result；旁路结果请改用 report_sidecar_result。`);
        }
        if (!sidecarToolKeys.includes("report_sidecar_result") && !sidecar.outputFallback) {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} 未允许 report_sidecar_result 时必须声明 outputFallback。`);
        }
        if (sidecarToolKeys.includes("report_sidecar_result") && !sidecar.sidecarDataSchema) {
            throw new Error(`profile ${profileKey} sidecar ${sidecar.name} 使用 report_sidecar_result 时必须声明 sidecarDataSchema。`);
        }
        if (sidecar.outputFallback === "final_message_as_result") {
            if (sidecar.sidecarDataSchema && sidecarDataSchemaType(sidecar.sidecarDataSchema) !== "string") {
                throw new Error(`profile ${profileKey} sidecar ${sidecar.name} outputFallback=final_message_as_result 只能搭配 string sidecarDataSchema；结构化旁路结果请使用 parse_final_message_json 或 report_sidecar_result。`);
            }
        }
    }
}

function sidecarDataSchemaType(schema: TSchema | undefined): string | undefined {
    if (!schema || typeof schema !== "object" || !("type" in schema)) {
        return undefined;
    }
    return typeof schema.type === "string" ? schema.type : undefined;
}
