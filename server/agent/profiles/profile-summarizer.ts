import type {AgentProfile, AgentProfileSummarizerConfig} from "nbook/server/agent/profiles/types";

/** 未声明专用策略的 Profile 被用户开启摘要时使用的系统默认策略。 */
export const DEFAULT_PROFILE_SUMMARIZER: AgentProfileSummarizerConfig<"summarizer"> = {
    profileKey: "summarizer",
    input: {
        trigger: "afterInvocation",
        interval: {kind: "sourceInvocation", value: 16},
        maxDialogueContentTokens: 80_000,
    },
};

/** Profile 源码声明 summarizer 策略时默认开启，否则默认关闭。 */
export function profileSummarizerDefaultEnabled(profile: AgentProfile): boolean {
    return Boolean(profile.summarizer);
}

/** 用户配置控制开关，Profile 声明只控制执行策略。 */
export function resolveProfileSummarizer(
    profile: AgentProfile,
    configuredEnabled: boolean | undefined,
    force = false,
): AgentProfileSummarizerConfig | null {
    const enabled = force || (configuredEnabled ?? profileSummarizerDefaultEnabled(profile));
    if (!enabled) {
        return null;
    }
    return profile.summarizer ?? DEFAULT_PROFILE_SUMMARIZER;
}
