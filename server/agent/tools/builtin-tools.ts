import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import {createFileTools} from "nbook/server/agent/tools/file-tools";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import {createSqlTool} from "nbook/server/agent/tools/sql-tool";
import {createTaskTools} from "nbook/server/agent/tools/task-tools";
import {createWebTools} from "nbook/server/agent/tools/web-tools";
import {renderSchemaSummary} from "nbook/server/agent/profiles/profile-dsl";
import {reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {createVariableTools} from "nbook/server/agent/variables/tools";
import type {InvokeAgentResult} from "nbook/server/agent/harness/types";

const ReportResultSchema = Type.Object({
    walkthrough: Type.String(),
});

const RequestUserInputQuestionOptionSchema = Type.Object({
    label: Type.String({description: "User-facing option label, preferably 1-5 words."}),
    description: Type.Optional(Type.String({description: "Optional short sentence explaining the impact or tradeoff of this option."})),
    recommended: Type.Optional(Type.Boolean({description: "Whether this option is visually marked as recommended."})),
    defaultSelected: Type.Optional(Type.Boolean({description: "Whether this option should be selected by default when the prompt opens."})),
});

const RequestUserInputQuestionSchema = Type.Object({
    header: Type.Optional(Type.String({description: "Short header shown above this question."})),
    question: Type.String({description: "Prompt shown to the user."}),
    options: Type.Optional(Type.Array(RequestUserInputQuestionOptionSchema, {description: "Options for this question. Omit or pass an empty array for open-ended questions."})),
    multiSelect: Type.Optional(Type.Boolean({description: "Whether the user may select multiple options. Ignored when options is empty."})),
    defaultOptionIndex: Type.Optional(Type.Integer({minimum: -1, description: "Default selected option index for single-select questions. -1 selects the alternative answer option."})),
    defaultOptionIndexes: Type.Optional(Type.Array(Type.Integer({minimum: -1}), {description: "Default selected option indexes for multi-select questions. -1 selects the alternative answer option."})),
});

const RequestUserInputSchema = Type.Object({
    questions: Type.Array(RequestUserInputQuestionSchema, {minItems: 1, description: "Questions to ask in one user-input request."}),
});

const PlanModeSchema = Type.Object({
    reason: Type.Optional(Type.String({description: "Short reason shown to the user for this Plan Mode transition."})),
    planFilePath: Type.Optional(Type.String({description: "For exit_plan_mode only. Optional Project Workspace relative Markdown file under .agent/plan/, for example .agent/plan/profile-migration.md."})),
});

const CreateAgentSchema = Type.Object({
    profileKey: Type.String({description: "Agent profile key from AgentCatalog, e.g. writer or retrieval."}),
    input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "JSON object matching the target profile InputSchema. Pass a real object, not a JSON string.",
    })),
    workspaceRoot: Type.Optional(Type.String({description: "Advanced override. Omit to inherit the current agent workspace root."})),
    projectPath: Type.Optional(Type.String({description: "Project Workspace path, for example workspace/<project>. Omit to inherit the current project."})),
});

const InvokeAgentSchema = Type.Object({
    sessionId: Type.Number({description: "Target agent session id."}),
    message: Type.Optional(Type.String({
        description: "User request to append to the target agent. Prefer the user's original wording or a minimal restatement; do not turn it into a long delegation prompt.",
    })),
    mode: Type.Optional(Type.Union([Type.Literal("prompt"), Type.Literal("continue")], {
        description: "Default is prompt when message is present, otherwise continue.",
    })),
});

const GetAgentSchema = Type.Object({
    sessionId: Type.Optional(Type.Number()),
});

const GetSessionSchema = Type.Object({
    sessionId: Type.Optional(Type.Number()),
    includeRecentMessages: Type.Optional(Type.Boolean({description: "Default false. Set true to include recent messages from the current active path only."})),
    recentMessageLimit: Type.Optional(Type.Integer({minimum: 1, maximum: 10, description: "Number of recent active-path message entries to return when includeRecentMessages is true. Default 3, max 10. By default this counts user, assistant, and toolResult messages; set recentMessageRoles to filter first."})),
    recentMessageRoles: Type.Optional(Type.Array(Type.Union([
        Type.Literal("user"),
        Type.Literal("assistant"),
        Type.Literal("toolResult"),
    ]), {
        minItems: 1,
        uniqueItems: true,
        description: "Optional role filter for recentMessages. Use [\"assistant\"] to inspect only AI messages and exclude tool results.",
    })),
    tokenBudget: Type.Optional(Type.Integer({minimum: 100, maximum: 3000, description: "Maximum estimated tokens for recentMessages. Default 1200, max 3000."})),
});

const GetAgentProfileSchema = Type.Object({
    profileKey: Type.String({description: "Agent profile key from AgentCatalog, e.g. writer or retrieval."}),
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
        ...createTaskTools(),
        ...createPlotTools(),
        ...createVariableTools(),
        ...createWebTools(),
        createSqlTool(),
        {
            key: "report_result",
            name: "report_result",
            label: "Report Result",
            executionMode: "sequential",
            description: "Report final agent result to the caller.",
            parameters: ReportResultSchema,
            async execute(_toolCallId, params: unknown) {
                const report = params as Static<typeof ReportResultSchema>;
                return {
                    content: [{type: "text", text: report.walkthrough}],
                    details: report,
                    terminate: true,
                };
            },
        },
        {
            key: "request_user_input",
            name: "request_user_input",
            label: "Request User Input",
            executionMode: "sequential",
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
            executionMode: "sequential",
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
            executionMode: "sequential",
            description: "Request exiting plan mode. Optionally pass planFilePath for a Project Workspace relative Markdown file under .agent/plan/ so the approval UI can preview it.",
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
            key: "create_agent",
            name: "create_agent",
            label: "Create Agent",
            executionMode: "sequential",
            description: "Create a new agent session and link it to current agent. Before every create_agent call, call get_agent_profile({ profileKey }) to inspect the target InputSchema, OutputSchema, report_result schema, and allowed tools. Pass input as a real JSON object matching that InputSchema, not a JSON string. Arrays, strings, numbers, booleans, and key=value text are rejected.",
            parameters: CreateAgentSchema,
            prepareArguments(args: unknown) {
                return prepareCreateAgentArguments(args) as Static<typeof CreateAgentSchema>;
            },
            async execute(_toolCallId, params: unknown) {
                const agentInput = params as Static<typeof CreateAgentSchema>;
                const result = await harness.createAgent({
                    profileKey: agentInput.profileKey,
                    input: normalizeCreateAgentInput(agentInput.profileKey, agentInput.input) as never,
                    workspaceRoot: agentInput.workspaceRoot,
                    projectPath: agentInput.projectPath,
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
                    input: normalizeCreateAgentInput(agentInput.profileKey, agentInput.input) as never,
                    workspaceRoot: agentInput.workspaceRoot ?? context.workspaceRoot,
                    workspaceKey: context.workspaceKey,
                    projectPath: agentInput.projectPath ?? context.projectPath,
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
            executionMode: "parallel",
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
                    content: [{type: "text", text: JSON.stringify(toInvokeAgentToolDetails(result), null, 2)}],
                    details: toInvokeAgentToolDetails(result),
                };
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const invocation = params as Static<typeof InvokeAgentSchema>;
                if (invocation.sessionId === context.sessionId) {
                    throw new Error("invoke_agent 不能调用当前 session 自己；请直接继续当前对话，或 create_agent 后调用新 agent session。");
                }
                const result = await harness.invokeAgent({
                    sessionId: invocation.sessionId,
                    mode: invocation.mode ?? (invocation.message ? "prompt" : "continue"),
                    message: invocation.message ? {text: invocation.message} : undefined,
                });
                return {
                    content: [{type: "text", text: JSON.stringify(toInvokeAgentToolDetails(result), null, 2)}],
                    details: toInvokeAgentToolDetails(result),
                };
            },
        },
        {
            key: "get_agent",
            name: "get_agent",
            label: "Get Agent",
            executionMode: "parallel",
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
            key: "get_agent_profile",
            name: "get_agent_profile",
            label: "Get Agent Profile",
            executionMode: "parallel",
            description: "Get one agent profile's schema summary, OutputSchema, report_result schema, and allowed tools. This is the required schema-discovery step before create_agent. This queries profile catalog, not created agent sessions.",
            parameters: GetAgentProfileSchema,
            async execute(_toolCallId, params: unknown) {
                const query = params as Static<typeof GetAgentProfileSchema>;
                const result = await getAgentProfileDetail(harness, query.profileKey);
                return {
                    content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                    details: result as unknown as JsonValue,
                };
            },
        },
        {
            key: "get_session",
            name: "get_session",
            label: "Get Session",
            executionMode: "parallel",
            description: [
                "Get lightweight session metadata, title, summary, usage, and linked agents.",
                "Default does not return history messages and never returns tree.",
                "Set includeRecentMessages=true for a small active-path-only recent message query.",
                "recentMessageLimit counts user, assistant, and toolResult messages by default; set recentMessageRoles to filter, for example [\"assistant\"].",
                "Use recentMessageLimit 1-10 and tokenBudget 100-3000; oversized output errors.",
                "For complex history, branch, or tree queries, inspect the session file directory yourself with bash/jq/rg instead of this tool.",
            ].join("\n"),
            parameters: GetSessionSchema,
            async execute(_toolCallId, params: unknown) {
                const query = params as Static<typeof GetSessionSchema>;
                const result = await harness.getSession(query);
                return {
                    content: [{type: "text", text: JSON.stringify(result)}],
                    details: result,
                };
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const query = params as Static<typeof GetSessionSchema>;
                const result = await harness.getSession({...query, sessionId: query.sessionId ?? context.sessionId}, context.sessionId);
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
            executionMode: "sequential",
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

/**
 * 创建带当前 profile OutputSchema 的 report_result 工具。
 */
export function createReportResultTool(parameters: TSchema, outputSchema?: TSchema): NeuroAgentTool {
    return {
        key: "report_result",
        name: "report_result",
        label: "Report Result",
        executionMode: "sequential",
        description: "Report final agent result to the caller.",
        parameters,
        async execute(_toolCallId, params: unknown) {
            const report = params as {walkthrough: string; data?: unknown};
            if (outputSchema && !("data" in report)) {
                throw new Error("report_result.data 是当前 profile OutputSchema 要求的必填字段。");
            }
            if (outputSchema) {
                try {
                    Value.Parse(outputSchema, report.data);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`report_result.data 校验失败：${message}`);
                }
            }
            return {
                content: [{type: "text", text: report.walkthrough}],
                details: report,
                terminate: true,
            };
        },
    };
}

function normalizeCreateAgentInput(profileKey: string, value: unknown): JsonValue {
    if (value === null || value === undefined) {
        return {};
    }
    let resolved = value;
    if (typeof resolved === "string") {
        try {
            resolved = JSON.parse(resolved);
        } catch {
            throw new Error(`create_agent.input 必须是 JSON object。profile ${profileKey} 收到的是字符串且不是合法 JSON object；请先调用 get_agent_profile 查看 InputSchema。`);
        }
    }
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
        throw new Error(`create_agent.input 必须是 JSON object。profile ${profileKey} 不接受 array/string/number/boolean 或 key=value 文本；请先调用 get_agent_profile 查看 InputSchema。`);
    }
    return Value.Parse(Type.Record(Type.String(), Type.Unknown()), resolved) as JsonValue;
}

function prepareCreateAgentArguments(args: unknown): unknown {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        return args;
    }
    const record = args as Record<string, unknown>;
    if (record.input === null) {
        return {
            ...record,
            input: {},
        };
    }
    if (typeof record.input !== "string") {
        return args;
    }
    try {
        const parsed = JSON.parse(record.input);
        return {
            ...record,
            input: parsed,
        };
    } catch {
        throw new Error(`create_agent.input 必须是 JSON object。收到的是字符串且不是合法 JSON object；请先调用 get_agent_profile 查看 InputSchema。`);
    }
}

/**
 * invoke_agent 的 toolResult 会持久化到父 session，只保留可长期保存的调用摘要。
 */
function toInvokeAgentToolDetails(result: InvokeAgentResult): InvokeAgentResult {
    return result;
}

async function getAgentProfileDetail(harness: NeuroAgentHarness, profileKey: string): Promise<Record<string, JsonValue>> {
    const snapshot = await harness.profiles.snapshot();
    const item = snapshot.profiles.find((profile) => profile.key === profileKey);
    if (!item || item.loadStatus !== "loaded") {
        throw new Error(`未找到可用 agent profile: ${profileKey}`);
    }
    const profile = await harness.profiles.get(profileKey);
    return {
        profileKey,
        name: item.name,
        description: item.description ?? "",
        source: item.source,
        allowedToolKeys: [...profile.allowedToolKeys],
        inputSchema: item.inputSchema ? renderSchemaSummary(item.inputSchema) : "none",
        outputSchema: item.outputSchema ? renderSchemaSummary(item.outputSchema) : "none",
        reportResultSchema: profile.allowedToolKeys.includes("report_result")
            ? renderSchemaSummary(reportResultSchemaForProfile(profile))
            : "none",
    };
}
