import {createError, getRouterParam} from "h3";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {InvokeAgentInput} from "nbook/server/agent/harness/types";
import {AgentV3SessionIdSchema} from "nbook/shared/dto/agent-v3.dto";
import type {
    AgentV3CreateSessionRequestDto,
    AgentV3DetachRequestDto,
    AgentV3InvokeRequestDto,
    AgentV3OwnerQueryDto,
} from "nbook/shared/dto/agent-v3.dto";

type GlobalAgentV3Http = {
    agentV3Harness?: NeuroAgentHarness;
};

const globalForAgentV3Http = globalThis as typeof globalThis & GlobalAgentV3Http;

/**
 * 获取 v3 Harness 单例。session 真相仍在 JSONL，单例只保存运行期依赖。
 */
export function useAgentV3Harness(): NeuroAgentHarness {
    if (!globalForAgentV3Http.agentV3Harness) {
        globalForAgentV3Http.agentV3Harness = new NeuroAgentHarness();
    }
    return globalForAgentV3Http.agentV3Harness;
}

/**
 * 读取数字 sessionId 路由参数。
 */
export function requireAgentV3SessionId(event: Parameters<typeof getRouterParam>[0]): number {
    const raw = getRouterParam(event, "sessionId");
    const parsed = AgentV3SessionIdSchema.safeParse(Number(raw));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }
    return parsed.data;
}

/**
 * 将 v3 事件推送为 SSE 帧。
 */
export async function pushAgentV3Event(
    eventStream: {push(input: {event: string; data: string}): Promise<void>},
    payload: AgentEvent | {type: "result"; result: unknown},
): Promise<void> {
    await eventStream.push({
        event: payload.type,
        data: JSON.stringify(payload),
    });
}

/**
 * 创建 v3 session 的 HTTP service 入口。
 */
export async function createAgentV3Session(body: AgentV3CreateSessionRequestDto, harness = useAgentV3Harness()) {
    return harness.createAgent({
        profileKey: body.profileKey,
        input: body.input,
        workspaceRoot: body.workspaceRoot,
        workspaceKey: body.workspaceKey,
        parentSessionId: body.parentSessionId,
    });
}

/**
 * 阻塞调用 v3 session 的 HTTP service 入口。
 */
export async function invokeAgentV3Session(sessionId: number, body: AgentV3InvokeRequestDto, harness = useAgentV3Harness()) {
    return harness.invokeAgent(toInvokeInput(sessionId, body));
}

/**
 * 查询 v3 session 轻量摘要。
 */
export async function getAgentV3Session(sessionId: number, harness = useAgentV3Harness()) {
    return harness.getSession(sessionId);
}

/**
 * 查询 v3 agent 摘要或 owner 列表。
 */
export async function getAgentV3Agent(sessionId: number | undefined, query: AgentV3OwnerQueryDto, harness = useAgentV3Harness()) {
    return harness.getAgent(sessionId, query.ownerSessionId);
}

/**
 * 解除 v3 agent link。
 */
export async function detachAgentV3Agent(sessionId: number, body: AgentV3DetachRequestDto, harness = useAgentV3Harness()) {
    return harness.detachAgent(sessionId, body.ownerSessionId);
}

/**
 * 将 HTTP DTO 转成 harness invoke 输入。
 */
export function toInvokeInput(
    sessionId: number,
    body: AgentV3InvokeRequestDto,
    onEvent?: InvokeAgentInput["onEvent"],
): InvokeAgentInput {
    return {
        sessionId,
        mode: body.mode,
        message: body.message,
        resolution: body.resolution,
        block: body.block,
        onEvent,
    };
}
