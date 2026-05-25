import {scanWorkspaceTree} from "nbook/server/workspace-files/workspace-files";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

/**
 * 读取工作区文件树。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const type = typeof query.type === "string" && query.type.trim() ? query.type.trim() : null;
    const depth = typeof query.depth === "string" ? Number.parseInt(query.depth, 10) : null;
    const targets = parseTargets(query.target);

    return scanWorkspaceTree({
        root: await resolveWorkspaceRootInput({projectPath, workspaceKind}),
        targets,
        type,
        depth: Number.isSafeInteger(depth) ? depth : null,
    });
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
