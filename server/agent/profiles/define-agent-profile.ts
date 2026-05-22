import type {TSchema} from "typebox";
import type {AgentProfile, AgentProfileManifest} from "nbook/server/agent/profiles/types";

/**
 * 定义一个 v3 Agent Profile。用户自定义 profile 必须通过这个函数导出。
 */
export function defineAgentProfile<
    const TInputSchema extends TSchema,
    const TOutputSchema extends TSchema,
>(profile: AgentProfile<TInputSchema, TOutputSchema>): AgentProfile<TInputSchema, TOutputSchema> {
    assertProfileManifest(profile.manifest);
    return profile;
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

