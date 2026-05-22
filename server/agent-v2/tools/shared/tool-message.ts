import {isToolMessage, ToolMessage, type BaseMessage} from "@langchain/core/messages";
import type {AgentToolContext, AgentToolResult} from "nbook/server/agent/tools/agent-tool";
import {resolveAgentFileResourceKey} from "nbook/server/agent/tools/file/workspace-file-target";
import type {JsonObject, JsonValue} from "nbook/server/agent/types";

const RECENT_READ_WINDOW_SIZE = 32;
export const REQUIRE_RECENT_READ_BEFORE_FILE_EDIT = false;
export const TOOL_RESULT_RAW_KEY = "toolResultRaw";
export const TOOL_NODE_ID_KEY = "toolNodeId";
export const INTERRUPTED_TOOL_RESULT_TEXT = "Tool call canceled by user before it returned.";
const EMPTY_TOOL_MESSAGE_FALLBACK = {
    success: "Tool completed successfully with no text output",
    error: "Tool failed with no error details",
} as const;

type ErrorLike = {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    path?: unknown;
};

/**
 * 读取错误对象上的短字段，避免把 stack 交给模型。
 */
function readErrorLike(value: unknown): ErrorLike | null {
    if (value instanceof Error) {
        return value as ErrorLike;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const hasMessage = typeof record.message === "string";
    const hasErrorField = typeof record.name === "string"
        || typeof record.code === "string"
        || typeof record.path === "string"
        || typeof record.stack === "string";
    return hasMessage && hasErrorField ? record : null;
}

/**
 * 把系统路径压成模型可行动的短路径。
 */
function summarizeErrorPath(value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }
    const normalizedPath = value.replace(/\\/g, "/");
    const workspaceIndex = normalizedPath.indexOf("/workspace/");
    if (workspaceIndex >= 0) {
        return normalizedPath.slice(workspaceIndex + 1);
    }
    const cwd = process.cwd().replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedPath === cwd) {
        return ".";
    }
    if (normalizedPath.startsWith(`${cwd}/`)) {
        return normalizedPath.slice(cwd.length + 1);
    }
    const parts = normalizedPath.split("/").filter(Boolean);
    return parts.length > 3 ? parts.slice(-3).join("/") : normalizedPath;
}

/**
 * 去掉错误文本里混入的框架堆栈行。
 */
function stripStackLines(value: string): string {
    const lines = value
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => !/^\s*at\s+/.test(line))
        .filter((line) => !line.includes(".nuxt/dev/index.mjs"))
        .filter((line) => !line.includes("node_modules"));

    if (lines.length >= 2 && lines[1] === `Error: ${lines[0]}`) {
        return [lines[0], ...lines.slice(2)].join("\n").trim();
    }
    return lines.join("\n").trim();
}

/**
 * 将错误压缩成模型需要的短文本。
 */
export function summarizeToolError(value: unknown): string {
    const error = readErrorLike(value);
    if (!error) {
        const text = stripStackLines(String(value ?? ""));
        return text.trim() ? text : EMPTY_TOOL_MESSAGE_FALLBACK.error;
    }

    const name = typeof error.name === "string" && error.name.trim() ? error.name : "Error";
    const message = typeof error.message === "string" && error.message.trim() ? error.message : EMPTY_TOOL_MESSAGE_FALLBACK.error;
    const code = typeof error.code === "string" && error.code.trim() ? error.code : null;
    const shortPath = summarizeErrorPath(error.path);

    if (code === "ENOENT" && shortPath) {
        return `File not found: ${shortPath}`;
    }
    if (code && shortPath) {
        return `${name} (${code}) at ${shortPath}: ${message}`;
    }
    if (code) {
        return `${name} (${code}): ${message}`;
    }
    return `${name}: ${message}`;
}

/**
 * 将任意工具输出规范化为稳定的非空文本。
 */
export function normalizeToolMessageContent(
    value: unknown,
    status: "success" | "error" = "success",
): string {
    if (status === "error") {
        return summarizeToolError(value);
    }

    if (typeof value === "string") {
        return value.trim() ? value : EMPTY_TOOL_MESSAGE_FALLBACK[status];
    }

    if (value === null || value === undefined) {
        return EMPTY_TOOL_MESSAGE_FALLBACK[status];
    }

    if (typeof value === "object") {
        try {
            const serialized = JSON.stringify(value, null, 4);
            if (serialized && serialized.trim()) {
                return serialized;
            }
        } catch {
            // 对象序列化失败时继续走通用字符串兜底。
        }
    }

    const text = String(value);
    return text.trim() ? text : EMPTY_TOOL_MESSAGE_FALLBACK[status];
}

/**
 * 将任意工具输出收敛为 JSON 兼容原始值。
 * 该值只在后端内部保留，不能重新发给模型。
 */
function normalizeToolRawResult(value: unknown, status: "success" | "error" = "success"): JsonValue | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (status === "error" && typeof value === "string") {
        return summarizeToolError(value);
    }

    const error = readErrorLike(value);
    if (error) {
        const rawError: JsonObject = {
            name: typeof error.name === "string" && error.name.trim() ? error.name : "Error",
            message: typeof error.message === "string" ? error.message : String(error.message ?? ""),
        };
        if (typeof error.code === "string" && error.code.trim()) {
            rawError.code = error.code;
        }
        const shortPath = summarizeErrorPath(error.path);
        if (shortPath) {
            rawError.path = shortPath;
        }
        return rawError;
    }

    if (typeof value === "number" && !Number.isFinite(value)) {
        return undefined;
    }

    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
        return undefined;
    }

    try {
        return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
        return undefined;
    }
}

/**
 * 将工具执行结果包装为标准化返回值。
 */
export function createToolResultMessage(
    result: unknown,
    toolArgs?: string,
    status: "success" | "error" = "success",
): AgentToolResult {
    return {
        content: normalizeToolMessageContent(result, status),
        ...(toolArgs !== undefined ? {toolArgs} : {}),
        status,
        rawResult: normalizeToolRawResult(result, status),
    };
}

/**
 * 从 ToolMessage metadata 中提取原始 toolArgs。
 */
export function readToolArgsText(message: ToolMessage): string {
    if ("metadata" in message && message.metadata && typeof message.metadata === "object" && "toolArgs" in message.metadata) {
        const toolArgs = message.metadata.toolArgs;
        if (typeof toolArgs === "string") {
            return toolArgs;
        }
    }
    return "";
}

/**
 * 从 ToolMessage additional_kwargs 中提取内部保留的原始结果。
 */
export function readToolRawResult(value: unknown): JsonValue | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value) || !(TOOL_RESULT_RAW_KEY in value)) {
        return undefined;
    }
    return normalizeToolRawResult((value as Record<string, unknown>)[TOOL_RESULT_RAW_KEY]);
}

type CreateToolMessageInput = {
    toolCallId: string;
    toolName: string;
    toolNodeId?: string;
    assistantMessageId?: string;
    result: AgentToolResult;
    id?: string;
    metadata?: unknown;
    additionalKwargs?: unknown;
};

/**
 * 根据统一的工具结果构造 ToolMessage。
 */
export function createToolMessage(input: CreateToolMessageInput): ToolMessage {
    const additionalKwargs = normalizeJsonObject(input.additionalKwargs);
    const metadata = normalizeJsonObject(input.metadata);
    const messageCreatedAt = typeof additionalKwargs.messageCreatedAt === "string"
        ? additionalKwargs.messageCreatedAt
        : new Date().toISOString();
    const messageId = typeof additionalKwargs.messageId === "string"
        ? additionalKwargs.messageId
        : input.toolCallId;
    const nextAdditionalKwargs: JsonObject = {
        ...additionalKwargs,
        messageCreatedAt,
        messageStatus: "done",
        messageId,
    };
    if (input.toolNodeId) {
        nextAdditionalKwargs[TOOL_NODE_ID_KEY] = input.toolNodeId;
    }
    if (input.assistantMessageId) {
        nextAdditionalKwargs.assistantMessageId = input.assistantMessageId;
    }

    if (input.result.rawResult !== undefined) {
        nextAdditionalKwargs[TOOL_RESULT_RAW_KEY] = input.result.rawResult;
    }

    return new ToolMessage({
        id: input.id ?? input.toolCallId,
        name: input.toolName,
        content: normalizeToolMessageContent(input.result.content, input.result.status ?? "success"),
        status: input.result.status ?? "success",
        tool_call_id: input.toolCallId,
        metadata: {
            ...metadata,
            ...(input.result.toolArgs !== undefined ? {toolArgs: input.result.toolArgs} : {}),
        },
        additional_kwargs: nextAdditionalKwargs,
    });
}

/**
 * 根据当前策略判断文件是否允许编辑。
 */
export async function assertFileEditKnowledge(
    context: AgentToolContext,
    filePath: string,
): Promise<void> {
    if (!REQUIRE_RECENT_READ_BEFORE_FILE_EDIT) {
        return;
    }
    await assertRecentlyReadResource(context, filePath);
}

/**
 * 判断最近一段可见消息内是否读取过相同资源。
 */
export async function assertRecentlyReadResource(
    context: AgentToolContext,
    filePath: string,
): Promise<void> {
    const targetResourceKey = await resolveAgentFileResourceKey(context, filePath);
    const messages = await context.getHistory();
    const recentVisibleMessages = listVisibleMessages(messages).slice(-RECENT_READ_WINDOW_SIZE);

    for (let index = recentVisibleMessages.length - 1; index >= 0; index -= 1) {
        const message = recentVisibleMessages[index];
        if (!message || !ToolMessage.isInstance(message) || message.name !== "read_file") {
            continue;
        }

        const toolArgsText = readToolArgsText(message);
        if (!toolArgsText) {
            continue;
        }

        try {
            const parsedArgs = JSON.parse(toolArgsText) as {filePath?: string};
            if (typeof parsedArgs.filePath !== "string" || !parsedArgs.filePath.trim()) {
                continue;
            }

            const recentResourceKey = await resolveAgentFileResourceKey(context, parsedArgs.filePath);
            if (recentResourceKey === targetResourceKey) {
                return;
            }
        } catch {
            continue;
        }
    }

    throw new Error(`File "${filePath}" must be read before editing so the current content is understood`);
}

/**
 * 过滤出当前线程中前端可见的消息。
 * 新架构暂不区分隐藏消息，这里只做简单投影。
 */
function listVisibleMessages(messages: BaseMessage[]): BaseMessage[] {
    return messages.filter((message) => {
        const messageType = message._getType();
        if (messageType === "ai") {
            return Boolean(message.text.trim());
        }
        return true;
    });
}

/**
 * 将附加参数收敛为 JSON 对象。
 */
function normalizeJsonObject(value: unknown): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(value)) as JsonObject;
    } catch {
        return {};
    }
}
