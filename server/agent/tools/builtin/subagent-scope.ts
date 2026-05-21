import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import type {JsonObject} from "nbook/server/agent/types";

/**
 * 在服务端 subagent 工具链路中显式刷新 leader 的 studio 关键作用域。
 */
export function syncSubagentStudioScope(context: AgentToolContext): void {
    const scope = context.getScope();
    const patch: JsonObject = {
        novelId: scope.studio.novelId,
        workspace: scope.studio.workspace,
        workspaceKind: scope.studio.workspaceKind,
    };
    context.setStudio(patch);
}

/**
 * writer 依赖 novelId 解析 plotPoints，提前给出更靠近调用点的错误。
 */
export async function assertWriterScopeForInput(context: AgentToolContext, subagentThreadId: string, input: unknown): Promise<void> {
    if (!hasPlotPoints(input) || !await isWriterSubagent(context, subagentThreadId)) {
        return;
    }
    const scope = context.getScope();
    if (!scope.studio.novelId?.trim()) {
        throw new Error("invoke_subagent 调用 writer 失败：当前 leader thread 没有 studio.novelId，无法解析 plotPoints");
    }
}

/**
 * 判断 subagent 输入是否携带 writer plotPoints。
 */
function hasPlotPoints(input: unknown): boolean {
    return Boolean(
        input
        && typeof input === "object"
        && !Array.isArray(input)
        && "plotPoints" in input
        && Array.isArray((input as {plotPoints?: unknown}).plotPoints)
        && (input as {plotPoints: unknown[]}).plotPoints.length > 0,
    );
}

/**
 * 根据当前 leader 附属 subagent 列表确认目标 profile，避免用输入形状误判非 writer。
 */
async function isWriterSubagent(context: AgentToolContext, subagentThreadId: string): Promise<boolean> {
    const subagents = await context.agentGateway.listSubAgents(context.threadId);
    return subagents.some((subagent) => String(subagent.id) === subagentThreadId && subagent.profileKey === "subagent.writer");
}
