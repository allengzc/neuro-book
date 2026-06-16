import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {JsonValue} from "nbook/server/agent/messages/types";

const CreateAgentSchema = Type.Object({
    profileKey: Type.String({description: "Agent profile key from AgentCatalog, e.g. writer or retrieval."}),
    input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "JSON object matching the target profile InputSchema. Pass a real object, not a JSON string.",
    })),
    title: Type.Optional(Type.String({
        description: "Optional display title for the new agent session. Omit to use the target profile name.",
    })),
    workspaceRoot: Type.Optional(Type.String({description: "Advanced override. Omit to inherit the current agent workspace root."})),
    projectPath: Type.Optional(Type.String({description: "Project Workspace path, for example workspace/<project>. Omit to inherit the current project."})),
});

const InvokeAgentSchema = Type.Object({
    sessionId: Type.Number({description: "Target agent session id."}),
    message: Type.Optional(Type.String({
        description: "User request to append to the target agent. Prefer the user's original wording or a minimal restatement; do not turn it into a long delegation prompt.",
    })),
    title: Type.Optional(Type.String({
        description: "Optional display title to set on the target agent session when this invocation is accepted.",
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

type CreateAgentInput = Static<typeof CreateAgentSchema>;
type InvokeAgentInput = Static<typeof InvokeAgentSchema>;
type GetAgentInput = Static<typeof GetAgentSchema>;
type GetSessionInput = Static<typeof GetSessionSchema>;
type GetAgentProfileInput = Static<typeof GetAgentProfileSchema>;
type DetachAgentInput = Static<typeof DetachAgentSchema>;

export const agentCollaborationTools = {
    createAgent: defineAgentTool({
        key: "create_agent",
        name: "create_agent",
        label: "Create Agent",
        executionMode: "sequential",
        description: "Create a new agent session and link it to current agent. Before every create_agent call, call get_agent_profile({ profileKey }) to inspect the target InputSchema, OutputSchema, report_result schema, and profile root tools. Pass input as a real JSON object matching that InputSchema, not a JSON string. Arrays, strings, numbers, booleans, and key=value text are rejected. This tool don't invoke the agent, use invoke_agent instead",
        parameters: CreateAgentSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const agentInput = params as CreateAgentInput;
            const result = await context.harness.createAgent({
                profileKey: agentInput.profileKey,
                input: normalizeCreateAgentInput(agentInput.profileKey, agentInput.input) as never,
                title: agentInput.title,
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
    }),
    invokeAgent: defineAgentTool({
        key: "invoke_agent",
        name: "invoke_agent",
        label: "Invoke Agent",
        executionMode: "parallel",
        description: "Invoke an agent session.",
        parameters: InvokeAgentSchema,
        async executeWithContext(context, toolCallId, params: unknown) {
            const invocation = params as InvokeAgentInput;
            if (invocation.sessionId === context.sessionId) {
                throw new Error("invoke_agent 不能调用当前 session 自己；请直接继续当前对话，或 create_agent 后调用新 agent session。");
            }
            const result = await context.harness.invokeAgent({
                sessionId: invocation.sessionId,
                mode: invocation.mode ?? (invocation.message ? "prompt" : "continue"),
                message: invocation.message ? {text: invocation.message} : undefined,
                title: invocation.title,
                caller: {
                    kind: "agent",
                    sessionId: context.sessionId,
                    profileKey: context.profileKey,
                    toolCallId,
                },
            });
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: result,
            };
        },
    }),
    getAgent: defineAgentTool({
        key: "get_agent",
        name: "get_agent",
        label: "Get Agent",
        executionMode: "parallel",
        description: "Get owned agent list or a single agent summary.",
        parameters: GetAgentSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const query = params as GetAgentInput;
            const result = await context.harness.getAgent(query.sessionId, context.sessionId);
            return {
                content: [{type: "text", text: JSON.stringify(result)}],
                details: result,
            };
        },
    }),
    getAgentProfile: defineAgentTool({
        key: "get_agent_profile",
        name: "get_agent_profile",
        label: "Get Agent Profile",
        executionMode: "parallel",
        description: "Get one agent profile's schema summary, OutputSchema, report_result schema, and profile root tools. This is the required schema-discovery step before create_agent. This queries profile catalog, not created agent sessions.",
        parameters: GetAgentProfileSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const query = params as GetAgentProfileInput;
            const result = await getAgentProfileDetail(context.harness, query.profileKey);
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: result as unknown as JsonValue,
            };
        },
    }),
    getSession: defineAgentTool({
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
        async executeWithContext(context, _toolCallId, params: unknown) {
            const query = params as GetSessionInput;
            const result = await context.harness.getSession({...query, sessionId: query.sessionId ?? context.sessionId}, context.sessionId);
            return {
                content: [{type: "text", text: JSON.stringify(result)}],
                details: result,
            };
        },
    }),
    detachAgent: defineAgentTool({
        key: "detach_agent",
        name: "detach_agent",
        label: "Detach Agent",
        executionMode: "sequential",
        description: "Detach an owned agent without deleting its session.",
        parameters: DetachAgentSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const detach = params as DetachAgentInput;
            const result = await context.harness.detachAgent(detach.sessionId, context.sessionId);
            return {
                content: [{type: "text", text: result.detached ? `detached ${detach.sessionId}` : `agent ${detach.sessionId} was not linked`}],
                details: result,
            };
        },
    }),
} as const;

function normalizeCreateAgentInput(profileKey: string, value: unknown): JsonValue {
    if (value === undefined) {
        return {};
    }
    if (value === null) {
        throw new Error(`create_agent.input 必须是 JSON object。profile ${profileKey} 收到 null；请省略 input 或传入真实对象。`);
    }
    if (typeof value === "string") {
        throw new Error(`create_agent.input 必须是 JSON object。profile ${profileKey} 收到的是 JSON string；请先调用 get_agent_profile 查看 InputSchema，并把 input 作为真实对象传入。`);
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`create_agent.input 必须是 JSON object。profile ${profileKey} 不接受 array/string/number/boolean 或 key=value 文本；请先调用 get_agent_profile 查看 InputSchema。`);
    }
    return Value.Parse(Type.Record(Type.String(), Type.Unknown()), value) as JsonValue;
}

async function getAgentProfileDetail(harness: {profiles: {snapshot(): Promise<{profiles: Array<{key: string; name: string; description?: string; source: string; loadStatus: string; inputSchema?: unknown; outputSchema?: unknown}>}>; get(profileKey: string): Promise<{rootToolKeys: readonly string[]; inputSchema?: unknown; outputSchema?: unknown}>}}, profileKey: string): Promise<Record<string, JsonValue>> {
    const {renderSchemaSummary} = await import("nbook/server/agent/profiles/profile-dsl");
    const {reportResultSchemaForProfile, reportSidecarResultSchemaForProfile} = await import("nbook/server/agent/profiles/report-result-schema");
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
        toolKeys: [...profile.rootToolKeys],
        inputSchema: item.inputSchema ? renderSchemaSummary(item.inputSchema as never) : "none",
        outputSchema: item.outputSchema ? renderSchemaSummary(item.outputSchema as never) : "none",
        reportResultSchema: profile.rootToolKeys.includes("report_result")
            ? renderSchemaSummary(reportResultSchemaForProfile(profile as never))
            : "none",
        reportSidecarResultSchema: profile.rootToolKeys.includes("report_sidecar_result")
            ? renderSchemaSummary(reportSidecarResultSchemaForProfile(profile as never))
            : "none",
    };
}
