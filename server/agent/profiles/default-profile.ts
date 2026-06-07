import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {LeaderDefaultInputSchema, LeaderDefaultOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";

/**
 * 最小内置 profile。真实 builtin profile 从 assets/workspace/.nbook 迁移。
 */
export const defaultAgentProfile = defineAgentProfile({
    manifest: {
        key: "leader.default",
        name: "Default Leader",
        description: "最小 leader profile，用于 harness 闭环和测试。",
    },
    inputSchema: LeaderDefaultInputSchema,
    outputSchema: LeaderDefaultOutputSchema,
    allowedToolKeys: [
        "read",
        "write",
        "edit",
        "apply_patch",
        "bash",
        "request_user_input",
        "enter_plan_mode",
        "exit_plan_mode",
        "create_agent",
        "invoke_agent",
        "get_agent",
        "get_agent_profile",
        "get_session",
        "detach_agent",
    ],
    compaction: {},
    prepare(ctx) {
        return {
            systemPrompt: [
                "You are Neuro Book Agent.",
                ctx.input.role ? `Role: ${ctx.input.role}` : "",
            ].filter(Boolean).join("\n"),
        };
    },
});
