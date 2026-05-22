import {createError, getRouterParam} from "h3";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {InvokeAgentInput} from "nbook/server/agent/harness/types";
import {
    AgentSessionIdSchema,
    type AgentAbortRequestDto,
    type AgentCommandRequestDto,
    type AgentCreateSessionRequestDto,
    type AgentInvokeRequestDto,
    type AgentSessionEventDto,
    type AgentSessionListQueryDto,
    type AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";

type GlobalAgentHttp = {
    agentHarness?: NeuroAgentHarness;
};

const globalForAgentHttp = globalThis as typeof globalThis & GlobalAgentHttp;

/**
 * 获取 Agent Harness 单例。session 真相在 JSONL，单例只持有运行期事件中心和依赖。
 */
export function useAgentHarness(): NeuroAgentHarness {
    if (!globalForAgentHttp.agentHarness) {
        globalForAgentHttp.agentHarness = new NeuroAgentHarness();
    }
    return globalForAgentHttp.agentHarness;
}

/**
 * 读取数字 sessionId 路由参数。
 */
export function requireAgentSessionId(event: Parameters<typeof getRouterParam>[0]): number {
    const raw = getRouterParam(event, "sessionId");
    const parsed = AgentSessionIdSchema.safeParse(Number(raw));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }
    return parsed.data;
}

/**
 * 将 session event envelope 推送为 SSE 帧。
 */
export async function pushAgentSessionEvent(
    eventStream: {push(input: {event: string; data: string}): Promise<void>},
    payload: AgentSessionEventDto,
): Promise<void> {
    await eventStream.push({
        event: payload.event.type,
        data: JSON.stringify(payload),
    });
}

/**
 * 创建 Agent session。
 */
export async function createAgentSession(body: AgentCreateSessionRequestDto, harness = useAgentHarness()) {
    return harness.createAgent({
        profileKey: body.profileKey,
        input: body.input,
        workspaceRoot: body.workspaceRoot,
        workspaceKey: body.workspaceKey,
        parentSessionId: body.parentSessionId,
    });
}

/**
 * 列出 Agent session 摘要。
 */
export async function listAgentSessions(query: AgentSessionListQueryDto, harness = useAgentHarness()) {
    return harness.listSessions(query.workspaceKey, query.includeArchived);
}

/**
 * 返回前端恢复用 session snapshot。
 */
export async function getAgentSessionSnapshot(sessionId: number, harness = useAgentHarness()) {
    return harness.getSessionSnapshot(sessionId);
}

/**
 * 阻塞调用 Agent session。
 */
export async function invokeAgentSession(sessionId: number, body: AgentInvokeRequestDto, harness = useAgentHarness()) {
    return harness.invokeAgent(toInvokeInput(sessionId, body));
}

/**
 * 执行 session command。slash command 在前端识别后进入这里。
 */
export async function runAgentSessionCommand(sessionId: number, body: AgentCommandRequestDto, harness = useAgentHarness()) {
    return harness.runCommand(sessionId, body);
}

/**
 * 原子切换 session tree，并可在切换后立即 invoke。
 */
export async function moveAgentSessionTree(sessionId: number, body: AgentTreeRequestDto, harness = useAgentHarness()) {
    return harness.moveTree(sessionId, body);
}

/**
 * 请求中断当前 invocation。
 */
export async function abortAgentSession(sessionId: number, body: AgentAbortRequestDto, harness = useAgentHarness()) {
    return harness.abortInvocation(sessionId, body);
}

/**
 * 订阅 session 事件。
 */
export function subscribeAgentSessionEvents(sessionId: number, after?: number, harness = useAgentHarness()) {
    return harness.subscribeSessionEvents(sessionId, after);
}

/**
 * 将 HTTP DTO 转成 harness invoke 输入。
 */
export function toInvokeInput(
    sessionId: number,
    body: AgentInvokeRequestDto,
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
