import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

export const SkillToolInputSchema = z.object({
    skill: z.string().trim().min(1, "skill is required").describe("The exact skill name from the skill catalog. Chinese names are allowed and must not be translated."),
});

/**
 * 请求启用一个 skill。
 */
export const skillTool: AgentTool<typeof SkillToolInputSchema> = {
    key: "skill",
    description: [
        "Request user approval to load a skill by its exact catalog name.",
        "Use this tool instead of read_file when you need to read a SKILL.md file.",
        "If you decide a skill is needed, call this tool directly instead of pausing the conversation to ask for permission; the approval flow will continue the run after the user approves.",
        "Chinese skill names are allowed. Pass the original catalog name exactly; do not translate or slug it.",
    ].join("\n"),
    schema: SkillToolInputSchema,
    async execute(input) {
        const rawResult = {
            kind: "pending_tool_approval",
            action: "skill",
            skill: input.skill,
            message: `Requesting user approval to load skill "${input.skill}".`,
        };
        return {
            ...createToolResultMessage(`Skill approval requested: ${input.skill}`, JSON.stringify(input)),
            rawResult,
        };
    },
};
