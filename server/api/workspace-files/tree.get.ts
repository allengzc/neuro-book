import {
    assertFullTreeSnapshotQuery,
    readPlainWorkspaceTreeSnapshot,
    readProjectWorkspaceTreeSnapshot,
} from "nbook/server/workspace-files/project-workspace-index";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import {createServerTiming} from "nbook/server/utils/server-timing";

/**
 * 读取工作区文件树。
 */
export default defineEventHandler(async (event) => {
    const timing = createServerTiming(event);
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
    const type = typeof query.type === "string" && query.type.trim() ? query.type.trim() : null;
    const depth = typeof query.depth === "string" ? Number.parseInt(query.depth, 10) : null;
    const targets = parseTargets(query.target);
    const parsedDepth = Number.isSafeInteger(depth) ? depth : null;
    assertFullTreeSnapshotQuery({
        targets,
        type,
        depth: parsedDepth,
    });

    try {
        const root = await timing.measure("workspace.resolve", () => resolveWorkspaceRootInput({projectPath, workspaceKind}));
        if (workspaceKind === "user-assets") {
            return await timing.measure("workspace.tree", () => readPlainWorkspaceTreeSnapshot({
                root,
                targets,
                type,
                depth: parsedDepth,
            }));
        }

        return await timing.measure("workspace.index", () => readProjectWorkspaceTreeSnapshot({
            root,
            targets,
            type,
            depth: parsedDepth,
        }));
    } finally {
        timing.commit();
    }
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
