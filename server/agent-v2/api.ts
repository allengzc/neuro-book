import {createEventStream, createError, getHeader, getRouterParam} from "h3";
import type {ClientVariables} from "nbook/server/agent/types";
import type {AgentStreamEventDto} from "nbook/server/agent-v2/dto/agent-chat.dto";
import {AGENT_CLIENT_VARIABLES_HEADER, ClientVariablesDtoSchema} from "nbook/server/agent-v2/dto/agent-chat.dto";

/**
 * 读取 threadId。
 */
export function requireThreadId(event: Parameters<typeof getRouterParam>[0]): string {
    const threadId = getRouterParam(event, "threadId");
    if (!threadId) {
        throw createError({
            statusCode: 400,
            message: "threadId 不能为空",
        });
    }
    return threadId;
}

/**
 * 读取 messageId。
 */
export function requireMessageId(event: Parameters<typeof getRouterParam>[0]): string {
    const messageId = getRouterParam(event, "messageId");
    if (!messageId) {
        throw createError({
            statusCode: 400,
            message: "messageId 不能为空",
        });
    }
    return messageId;
}

/**
 * 读取请求头中的前端变量快照。
 */
export function readClientVariablesHeader(
    event: Parameters<typeof getRouterParam>[0],
): ClientVariables | null {
    const raw = getHeader(event, AGENT_CLIENT_VARIABLES_HEADER);
    if (!raw) {
        return null;
    }

    try {
        const decoded = Buffer.from(raw, "base64").toString("utf-8");
        return ClientVariablesDtoSchema.parse(JSON.parse(decoded)) as ClientVariables;
    } catch {
        throw createError({
            statusCode: 400,
            message: `${AGENT_CLIENT_VARIABLES_HEADER} 非法`,
        });
    }
}

/**
 * 推送一条 Agent SSE 事件。
 */
export async function pushAgentEvent(
    eventStream: ReturnType<typeof createEventStream>,
    payload: AgentStreamEventDto,
): Promise<void> {
    await eventStream.push({
        event: payload.type,
        data: JSON.stringify(payload),
    });
}
