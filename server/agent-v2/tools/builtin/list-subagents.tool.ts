import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const ListSubagentsInputSchema = z.object({});

/**
 * 列出 subagent 的内建工具。
 */
export const listSubagentsTool: AgentTool<typeof ListSubagentsInputSchema> = {
    key: "list_subagents",
    description: "List subagents attached to the current leader thread, including their summaries. This tool takes no arguments.",
    schema: ListSubagentsInputSchema,
    async execute(_input, context) {
        return createToolResultMessage(
            await context.agentGateway.listSubAgents(context.threadId),
            "{}",
        );
    },
};
