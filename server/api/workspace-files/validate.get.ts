import {validateWorkspaceContentNodes} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

/**
 * 校验工作区文件树。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const targets = parseTargets(query.target);
    const recursive = parseBoolean(query.recursive);
    const result = await validateWorkspaceContentNodes({
        root: await resolveWorkspaceRootInput({projectPath, workspaceKind}),
        targets: targets.length > 0 ? targets : ["."],
        recursive,
    });
    return result;
});

/**
 * 解析 target 查询参数。
 */
function parseTargets(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
    if (typeof value === "string" && value.trim()) {
        return [value.trim()];
    }
    return [];
}

/**
 * 解析布尔查询参数。API 保持只读，不提供 fix 开关。
 */
function parseBoolean(value: unknown): boolean {
    if (value === true) {
        return true;
    }
    if (typeof value !== "string") {
        return false;
    }
    return value === "true" || value === "1";
}
