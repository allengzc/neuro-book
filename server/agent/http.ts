import {createError, getRouterParam} from "h3";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {InvokeAgentInput} from "nbook/server/agent/harness/types";
import type {ServerTimingSink} from "nbook/server/utils/server-timing";
import {
    AgentSessionIdSchema,
    type AgentAbortRequestDto,
    type AgentCommandRequestDto,
    type AgentCreateSessionRequestDto,
    type ClientVariablePatchAckDto,
    type AgentInvokeRequestDto,
    type AgentSessionEventDto,
    type AgentSessionEventsQueryDto,
    type AgentSessionListPageDto,
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
        globalForAgentHttp.agentHarness = new NeuroAgentHarness({watchProfiles: true});
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
        initial: body.initial,
        workspaceRoot: body.workspaceRoot,
        workspaceKey: body.workspaceKey,
        projectPath: body.projectPath,
        parentSessionId: body.parentSessionId,
    });
}

/**
 * 列出 Agent session 摘要。
 */
export async function listAgentSessions(query: AgentSessionListQueryDto, harness = useAgentHarness()): Promise<AgentSessionListPageDto> {
    if ("listSessionPage" in harness && typeof harness.listSessionPage === "function") {
        return harness.listSessionPage(query);
    }
    const items = await harness.listSessions(query);
    return {
        items,
        total: items.length,
        offset: query.offset ?? 0,
        limit: query.limit ?? items.length,
        hasMore: false,
    };
}

/**
 * 返回前端恢复用 session snapshot。
 */
export async function getAgentSessionSnapshot(sessionId: number, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return timingSink
        ? harness.getSessionSnapshot(sessionId, timingSink)
        : harness.getSessionSnapshot(sessionId);
}

/**
 * 返回关联 Agent 面板使用的轻量关系投影。
 */
export async function getAgentSessionRelations(sessionId: number, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return timingSink
        ? harness.getSessionRelations(sessionId, timingSink)
        : harness.getSessionRelations(sessionId);
}

/**
 * 阻塞调用 Agent session。
 */
export async function invokeAgentSession(sessionId: number, body: AgentInvokeRequestDto, harness = useAgentHarness()) {
    try {
        return await harness.invokeAgent(toInvokeInput(sessionId, body));
    } catch (error) {
        throw normalizeInvokeAdmissionError(error);
    }
}

/**
 * 执行 session command。slash command 在前端识别后进入这里。
 */
export async function runAgentSessionCommand(sessionId: number, body: AgentCommandRequestDto, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return timingSink
        ? harness.runCommand(sessionId, body, timingSink)
        : harness.runCommand(sessionId, body);
}

/**
 * 切换 session tree，并可在切换后立即 invoke。
 *
 * 当前实现先移动 leaf 再 invoke；若 invoke 失败，leaf 不会自动回滚。
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
 * 前端确认 client.* variable patch 已应用。
 */
export async function acknowledgeClientVariablePatch(sessionId: number, body: ClientVariablePatchAckDto, harness = useAgentHarness()) {
    await harness.acknowledgeClientVariablePatch(sessionId, body);
    return {ok: true};
}

/**
 * 订阅 session 事件。
 */
export function subscribeAgentSessionEvents(sessionId: number, cursor: AgentSessionEventsQueryDto = {}, harness = useAgentHarness()) {
    return harness.subscribeSessionEvents(sessionId, cursor);
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
        payload: body.input,
        title: body.title,
        resolution: body.resolution as InvokeAgentInput["resolution"],
        clientState: body.clientState,
        caller: {kind: "user"},
        block: body.block,
        onEvent,
    };
}

/**
 * 将 invocation admission 的状态机拒绝转换为 HTTP 可恢复错误。
 */
function normalizeInvokeAdmissionError(error: unknown): unknown {
    if (!(error instanceof Error)) {
        return error;
    }
    const conflictMessages = new Set([
        "active_invocation_aborting",
        "active_invocation_exists",
        "steer_not_available",
        "waiting_invocation_not_recoverable",
    ]);
    if (conflictMessages.has(error.message)) {
        return createError({
            statusCode: 409,
            message: error.message,
        });
    }
    if (error.message === "active_invocation_required") {
        return createError({
            statusCode: 400,
            message: error.message,
        });
    }
    return error;
}
