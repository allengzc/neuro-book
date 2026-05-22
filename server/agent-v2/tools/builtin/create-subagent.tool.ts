import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {syncSubagentStudioScope} from "nbook/server/agent/tools/builtin/subagent-scope";

const CreateSubagentInputSchema = z.object({
    profileKey: z.string().trim().min(1, "profileKey 不能为空").describe("The subagent profile key to use. It must be one of the currently available subagent profiles."),
    title: z.string().trim().min(1, "title 不能为空").optional().describe("Optional display title for the subagent thread."),
});

/**
 * 创建 subagent 的内建工具。
 */
export const createSubagentTool: AgentTool<typeof CreateSubagentInputSchema> = {
    key: "create_subagent",
    description: "Create a new subagent thread and attach it to the current leader. The profileKey must reference an available subagent profile from the current profile catalog. The subagent must be invoked separately via invoke_subagent to run.",
    schema: CreateSubagentInputSchema,
    async resolveSchema(context) {
        const subagentProfiles = await context.agentGateway.listProfiles("subagent");
        const profileKeys = subagentProfiles.map((profile) => profile.key);
        const profileKeySchema = profileKeys.length > 0
            ? z.enum(profileKeys as [string, ...string[]])
            : z.string().trim().min(1, "profileKey 不能为空");

        return z.object({
            profileKey: profileKeySchema.describe(`The subagent profile key to use. Available subagent profiles: ${profileKeys.join(", ") || "none"}.`),
            title: z.string().trim().min(1, "title 不能为空").optional().describe("Optional display title for the subagent thread."),
        });
    },
    async execute(input, context) {
        syncSubagentStudioScope(context);
        await context.agentGateway.assertSubAgentProfile(input.profileKey);
        const created = await context.agentGateway.createSubAgentThread({
            leaderThreadId: context.threadId,
            profileKey: input.profileKey,
            title: input.title,
        });

        const rawResult = {
            subagentThreadId: created.id,
            profileKey: created.profileKey,
            title: created.title,
        };
        return {
            ...createToolResultMessage(`Subagent created: ${created.id}`, JSON.stringify(input)),
            rawResult,
        };
    },
};
