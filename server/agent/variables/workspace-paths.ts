import {resolve} from "node:path";
import {resolveStateRoot} from "nbook/server/runtime/installation-paths";

/**
 * 返回 Workspace Root 对应的 Agent `.nbook` 目录。
 *
 * 普通小说运行时传入 `workspace`，目录是 `workspace/.nbook`；user-assets
 * 运行时传入的 root 本身就是 `workspace/.nbook`，不能再追加一层 `.nbook`。
 */
export function resolveAgentNbookRoot(workspaceRoot: string): string {
    const normalized = workspaceRoot.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    return normalized.endsWith("/.nbook") || normalized === ".nbook"
        ? resolve(resolveStateRoot(), workspaceRoot)
        : resolve(resolveStateRoot(), workspaceRoot, ".nbook");
}
