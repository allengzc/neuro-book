import {z} from "zod";
import type {AgentTool} from "nbook/server/agent/tools/agent-tool";
import {createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";

const TaskStepStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const TaskCreateSchema = z.object({
    title: z.string().trim().optional().describe("Optional task list title shown to the user."),
    steps: z.array(z.object({
        id: z.string().trim().min(1).describe("Stable machine-readable step id."),
        text: z.string().trim().min(1).describe("User-facing step text."),
        status: TaskStepStatusSchema.describe("Initial status for this step."),
    })).min(1).describe("Initial task steps in display order."),
}).describe("Create or replace the current task list. At most one step may be in_progress.");

const TaskSetStatusSchema = z.object({
    id: z.string().trim().min(1).describe("Stable id of the task step to update."),
    status: TaskStepStatusSchema.describe("New status for the step."),
    note: z.string().trim().optional().describe("Optional short reason or progress note for this status change."),
}).describe("Update the status of one existing task step. If setting one step to in_progress, any previous in_progress step is moved back to pending unless already completed.");

/**
 * 初始化或整体重建当前线程任务列表。
 */
export const taskCreateTool: AgentTool<typeof TaskCreateSchema> = {
    key: "task_create",
    description: "Create or replace the current thread task list. Use it to track multi-step or cross-turn work.",
    schema: TaskCreateSchema,
    async execute(input, context) {
        const taskList = await context.agentGateway.createTaskList(context.threadId, input);
        return createToolResultMessage(taskList, JSON.stringify(input));
    },
};

/**
 * 更新当前线程任务步骤状态。
 */
export const taskSetStatusTool: AgentTool<typeof TaskSetStatusSchema> = {
    key: "task_set_status",
    description: "Update one task step status in the current thread task list and return the full task list.",
    schema: TaskSetStatusSchema,
    async execute(input, context) {
        const taskList = await context.agentGateway.setTaskStatus(context.threadId, input);
        return createToolResultMessage(taskList, JSON.stringify(input));
    },
};
