import type {TSchema} from "typebox";
import type {AgentProfile, AgentProfileManifest} from "nbook/server/agent/profiles/types";
import {compileProfileContext, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";

/**
 * 定义一个 v3 Agent Profile。用户自定义 profile 必须通过这个函数导出。
 */
export function defineAgentProfile<
    const TInputSchema extends TSchema,
    const TOutputSchema extends TSchema,
>(profile: AgentProfile<TInputSchema, TOutputSchema>): AgentProfile<TInputSchema, TOutputSchema> {
    assertProfileManifest(profile.manifest);
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
    return {
        ...profile,
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
