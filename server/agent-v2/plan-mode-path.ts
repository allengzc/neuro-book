import type {AgentVariableScope, ThreadId} from "nbook/server/agent/types";

export const PLAN_MODE_THREAD_DIRECTORY_SUFFIX = ".agent";
export const FALLBACK_PLAN_MODE_WORKSPACE_PATH = "workspace";

/**
 * 读取当前 scope 中的小说 workspace 根目录。
 */
export function readCurrentNovelWorkspace(scope: Pick<AgentVariableScope, "studio"> | null | undefined): string {
    const workspace = scope?.studio?.workspace;
    return typeof workspace === "string" ? normalizeWorkspacePath(workspace) : "";
}

/**
 * 返回 Plan Mode 的当前线程工作目录展示路径。
 */
export function createPlanModePlanDirectoryPath(
    scope: Pick<AgentVariableScope, "studio"> | null | undefined,
    threadId: ThreadId,
): string {
    const workspace = readCurrentNovelWorkspace(scope);
    if (!workspace) {
        return `${FALLBACK_PLAN_MODE_WORKSPACE_PATH}/${PLAN_MODE_THREAD_DIRECTORY_SUFFIX}/${threadId}/`;
    }
    return `${workspace}/${PLAN_MODE_THREAD_DIRECTORY_SUFFIX}/${threadId}/`;
}

/**
 * 将路径统一成 `/` 分隔且无结尾斜杠。
 */
function normalizeWorkspacePath(input: string): string {
    return input.replace(/\\/g, "/").replace(/\/+$/, "");
}
