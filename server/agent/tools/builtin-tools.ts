import {Type} from "typebox";
import type {Static} from "typebox";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import {createFileTools} from "nbook/server/agent/tools/file-tools";

const ReportResultSchema = Type.Object({
    result: Type.String(),
    success: Type.Optional(Type.Boolean()),
    data: Type.Optional(Type.Unknown()),
});

const RequestUserInputSchema = Type.Object({
    questions: Type.Array(Type.Object({
        question: Type.String(),
    })),
});

const PlanModeSchema = Type.Object({
    reason: Type.Optional(Type.String()),
});

const SkillSchema = Type.Object({
    skillKey: Type.String(),
    reason: Type.Optional(Type.String()),
});

const CreateAgentSchema = Type.Object({
    profileKey: Type.String(),
    input: Type.Optional(Type.Unknown()),
    workspaceRoot: Type.Optional(Type.String()),
});

const InvokeAgentSchema = Type.Object({
    sessionId: Type.Number(),
    message: Type.Optional(Type.String()),
    mode: Type.Optional(Type.Union([Type.Literal("prompt"), Type.Literal("continue")])),
});

const GetAgentSchema = Type.Object({
    sessionId: Type.Optional(Type.Number()),
});

const GetSessionSchema = Type.Object({
    sessionId: Type.Optional(Type.Number()),
});

const DetachAgentSchema = Type.Object({
    sessionId: Type.Number(),
});

/**
 * 构造 v3 第一批内置工具。
 */
export function createBuiltinTools(harness: NeuroAgentHarness): NeuroAgentTool[] {
    return [
        ...createFileTools(),
        {
            key: "report_result",
            name: "report_result",
            label: "Report Result",
            description: "Report final agent result to the caller.",
            parameters: ReportResultSchema,
            async execute(_toolCallId, params: unknown) {
                const report = params as Static<typeof ReportResultSchema>;
                return {
                    content: [{type: "text", text: report.result}],
                    details: report,
                    terminate: true,
                };
            },
        },
        {
            key: "request_user_input",
            name: "request_user_input",
            label: "Request User Input",
            description: "Ask the user for input and wait for continue resolution.",
            parameters: RequestUserInputSchema,
            approvalRequired: true,
            async execute() {
                return {
                    content: [{type: "text", text: "等待用户输入。"}],
                    details: {
                        pending: true,
                    },
                    terminate: true,
                };
            },
        },
        {
            key: "enter_plan_mode",
            name: "enter_plan_mode",
            label: "Enter Plan Mode",
            description: "Request entering plan mode.",
            parameters: PlanModeSchema,
            approvalRequired: true,
            async execute(_toolCallId, params: unknown) {
                const plan = params as Static<typeof PlanModeSchema>;
                return {
                    content: [{type: "text", text: plan.reason ? `请求进入计划模式：${plan.reason}` : "请求进入计划模式。"}],
                    details: {
                        pending: true,
                    },
                    terminate: true,
                };
            },
        },
        {
            key: "exit_plan_mode",
            name: "exit_plan_mode",
            label: "Exit Plan Mode",
            description: "Request exiting plan mode.",
            parameters: PlanModeSchema,
            approvalRequired: true,
            async execute(_toolCallId, params: unknown) {
                const plan = params as Static<typeof PlanModeSchema>;
                return {
                    content: [{type: "text", text: plan.reason ? `请求退出计划模式：${plan.reason}` : "请求退出计划模式。"}],
                    details: {
                        pending: true,
                    },
                    terminate: true,
                };
            },
        },
        {
            key: "skill",
            name: "skill",
            label: "Skill",
            description: "Request activating a skill.",
            parameters: SkillSchema,
            approvalRequired: true,
            async execute(_toolCallId, params: unknown) {
                const skill = params as Static<typeof SkillSchema>;
                return {
                    content: [{type: "text", text: `请求激活 skill：${skill.skillKey}`}],
                    details: {
                        pending: true,
                        skillKey: skill.skillKey,
                    },
                    terminate: true,
                };
            },
        },
        {
            key: "create_agent",
            name: "create_agent",
            label: "Create Agent",
            description: "Create a new agent session and link it to current agent.",
            parameters: CreateAgentSchema,
            async execute(_toolCallId, params: unknown) {
                const agentInput = params as Static<typeof CreateAgentSchema>;
                const result = await harness.createAgent({
                    profileKey: agentInput.profileKey,
                    input: (agentInput.input ?? {}) as never,
                    workspaceRoot: agentInput.workspaceRoot,
                });
                return {
                    content: [{type: "text", text: `created agent session ${result.sessionId}`}],
                    details: result,
                };
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const agentInput = params as Static<typeof CreateAgentSchema>;
                const result = await harness.createAgent({
                    profileKey: agentInput.profileKey,
                    input: (agentInput.input ?? {}) as never,
                    workspaceRoot: agentInput.workspaceRoot ?? context.workspaceRoot,
                    workspaceKey: context.workspaceKey,
                    parentSessionId: context.sessionId,
                });
                return {
                    content: [{type: "text", text: `created agent session ${result.sessionId}`}],
                    details: result,
                };
            },
        },
        {
            key: "invoke_agent",
            name: "invoke_agent",
            label: "Invoke Agent",
            description: "Invoke an agent session.",
            parameters: InvokeAgentSchema,
            async execute(_toolCallId, params: unknown) {
                const invocation = params as Static<typeof InvokeAgentSchema>;
                const result = await harness.invokeAgent({
                    sessionId: invocation.sessionId,
                    mode: invocation.mode ?? (invocation.message ? "prompt" : "continue"),
                    message: invocation.message ? {text: invocation.message} : undefined,
                });
                return {
                    content: [{type: "text", text: result.reportResult?.result ?? result.finalMessage ?? result.status}],
                    details: result,
                    terminate: result.status === "completed",
                };
            },
        },
        {
            key: "get_agent",
            name: "get_agent",
            label: "Get Agent",
            description: "Get owned agent list or a single agent summary.",
            parameters: GetAgentSchema,
            async execute(_toolCallId, params: unknown) {
                const query = params as Static<typeof GetAgentSchema>;
                const result = await harness.getAgent(query.sessionId);
                return {
                    content: [{type: "text", text: JSON.stringify(result)}],
                    details: result,
                };
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const query = params as Static<typeof GetAgentSchema>;
                const result = await harness.getAgent(query.sessionId, context.sessionId);
                return {
                    content: [{type: "text", text: JSON.stringify(result)}],
                    details: result,
                };
            },
        },
        {
            key: "get_session",
            name: "get_session",
            label: "Get Session",
            description: "Get lightweight session metadata, tree, linked agents, usage, and recent message summary.",
            parameters: GetSessionSchema,
            async execute(_toolCallId, params: unknown) {
                const query = params as Static<typeof GetSessionSchema>;
                const result = await harness.getSession(query.sessionId);
                return {
                    content: [{type: "text", text: JSON.stringify(result)}],
                    details: result,
                };
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const query = params as Static<typeof GetSessionSchema>;
                const result = await harness.getSession(query.sessionId ?? context.sessionId, context.sessionId);
                return {
                    content: [{type: "text", text: JSON.stringify(result)}],
                    details: result,
                };
            },
        },
        {
            key: "detach_agent",
            name: "detach_agent",
            label: "Detach Agent",
            description: "Detach an owned agent without deleting its session.",
            parameters: DetachAgentSchema,
            async execute(_toolCallId, params: unknown) {
                const detach = params as Static<typeof DetachAgentSchema>;
                const result = await harness.detachAgent(detach.sessionId);
                return {
                    content: [{type: "text", text: result.detached ? `detached ${detach.sessionId}` : `agent ${detach.sessionId} was not linked`}],
                    details: result,
                };
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const detach = params as Static<typeof DetachAgentSchema>;
                const result = await harness.detachAgent(detach.sessionId, context.sessionId);
                return {
                    content: [{type: "text", text: result.detached ? `detached ${detach.sessionId}` : `agent ${detach.sessionId} was not linked`}],
                    details: result,
                };
            },
        },
    ];
}
