import type {BaseMessage} from "@langchain/core/messages";
import {tool, type DynamicStructuredTool} from "@langchain/core/tools";
import {z, type ZodError} from "zod";
import type {AgentToolGateway} from "nbook/server/agent/contracts";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {createToolMessage, createToolResultMessage, normalizeToolMessageContent} from "nbook/server/agent/tools/shared/tool-message";
import type {AgentVariableScope, JsonObject, JsonValue, ProfileKey, RunOptions, ThreadId, ToolKey} from "nbook/server/agent/types";

/**
 * tool 执行上下文。
 */
export type AgentToolContext = {
    agentGateway: AgentToolGateway;
    threadId: ThreadId;
    profileKey: ProfileKey;
    profile: AgentProfile<ProfileKey>;
    runOptions: RunOptions;
    /**
     * 向当前 tool 节点写入输出增量。
     * 当前调用若没有关联到活跃 tool 节点，则该调用会被静默忽略。
     */
    writeToolOutput(chunkText: string): void;
    /**
     * 读取当前线程历史。
     */
    getHistory(): Promise<BaseMessage[]>;
    getScope(): AgentVariableScope;
    setIde(patch: JsonObject): AgentVariableScope;
    setStudio(patch: JsonObject): AgentVariableScope;
};

/**
 * 由工具实现返回的标准化结果。
 * 包装层会基于真实 tool_call_id 构造 ToolMessage。
 */
export type AgentToolResult = {
    content: string;
    toolArgs?: string;
    status?: "success" | "error";
    rawResult?: JsonValue;
};

/**
 * Agent tool 定义。
 */
export type AgentTool<TSchema extends z.ZodType> = {
    key: ToolKey;
    description: string;
    schema: TSchema;
    /**
     * 按当前 run 的上下文动态生成参数 schema。
     * 例如 invoke_subagent 需要把可用 subagent profile 的 inputSchema 注入给模型。
     */
    resolveSchema?(context: AgentToolContext): Promise<z.ZodType> | z.ZodType;
    execute(input: z.infer<TSchema>, context: AgentToolContext): Promise<AgentToolResult>;
};

/**
 * 将工具参数序列化为可落盘的 JSON 文本。
 */
function stringifyToolArgs(input: unknown): string {
    try {
        return JSON.stringify(input ?? {});
    } catch {
        return "{}";
    }
}

/**
 * 将 Zod 参数错误渲染成模型可修正的短文本。
 */
function renderToolArgumentError(toolName: ToolKey, error: ZodError): string {
    const issues = error.issues.map((issue) => {
        const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `- ${fieldPath}: ${issue.message}`;
    });
    return [`Invalid ${toolName} arguments.`, ...issues].join("\n");
}

/**
 * 将内部 tool 定义转换为 LangChain tool。
 */
export function toLangChainTool<TSchema extends z.ZodType>(
    definition: AgentTool<TSchema>,
    context: AgentToolContext,
    schema: z.ZodType = definition.schema,
): DynamicStructuredTool<TSchema> {
    return tool(
        async (input, config) => {
            const toolCallId = config?.toolCall?.id;
            const invocationContext: AgentToolContext = {
                ...context,
                writeToolOutput: (chunkText: string) => {
                    if (!toolCallId || !chunkText) {
                        return;
                    }
                    context.agentGateway.publishToolOutputDelta(context.threadId, toolCallId, chunkText);
                },
            };
            const parsedInput = schema.safeParse(input);
            if (!parsedInput.success) {
                const result = createToolResultMessage(
                    renderToolArgumentError(definition.key, parsedInput.error),
                    stringifyToolArgs(input),
                    "error",
                );
                const normalizedContent = normalizeToolMessageContent(result.content, "error");

                if (!toolCallId) {
                    return normalizedContent;
                }

                return createToolMessage({
                    toolCallId,
                    toolName: definition.key,
                    result: {
                        ...result,
                        content: normalizedContent,
                    },
                });
            }

            let result;
            try {
                result = await definition.execute(parsedInput.data as z.infer<TSchema>, invocationContext);
            } catch (error) {
                result = createToolResultMessage(
                    error,
                    stringifyToolArgs(parsedInput.data),
                    "error",
                );
            }
            const normalizedContent = normalizeToolMessageContent(result.content, result.status ?? "success");

            if (!toolCallId) {
                return normalizedContent;
            }

            return createToolMessage({
                toolCallId,
                toolName: definition.key,
                result: {
                    ...result,
                    content: normalizedContent,
                },
            });
        },
        {
            name: definition.key,
            description: definition.description,
            schema: schema as TSchema,
        },
    );
}
