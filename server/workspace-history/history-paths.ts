import {managedProjectPath} from "nbook/server/workspace-files/project-data-plane-guard";

/**
 * 记账排除段（任意深度命中即排除，与 watcher 的忽略清单对齐）：
 * `.git` 版本库、`.nbook` 运行态（history.sqlite 自身也在其中）、`.agent` 运行态（plan 草稿等）。
 */
const EXCLUDED_ANY_SEGMENTS = new Set([".git", ".nbook", ".agent"]);

/**
 * 仅排除项目根第一层的 `agents/`（Profile Home：系统读时初始化会频繁写入，v1 不纳管，
 * 纳管时应接 system actor 而非放任 external 噪声）；深层同名目录是普通内容不受影响。
 */
const EXCLUDED_TOP_SEGMENTS = new Set(["agents"]);

/**
 * 从 workspace root 输入解析出受文件历史记账管理的项目路径（`workspace/<slug>` 归一形）。
 * user-assets（`workspace/.nbook`）、容器根、绝对路径与其它非 managed 形态由 managedProjectPath
 * 统一排除（单一权威）——非 managed 即不记账。
 */
export function historyProjectPathFromRoot(rootInput: string | undefined): string | null {
    return managedProjectPath(rootInput);
}

/**
 * 相对路径（相对项目根、正斜杠）是否属于记账范围。写入收口与 watcher 对账共用同一份谓词，
 * 保证「记了账的路径」与「对账会看的路径」永远一致。
 */
export function isHistoryTrackedRelativePath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
    if (!normalized) {
        return false;
    }
    const segments = normalized.split("/");
    if (segments.some((segment) => EXCLUDED_ANY_SEGMENTS.has(segment))) {
        return false;
    }
    return !EXCLUDED_TOP_SEGMENTS.has(segments[0]!);
}
