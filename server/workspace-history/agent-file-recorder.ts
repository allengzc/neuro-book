import {isAbsolute, relative, resolve} from "node:path";
import {managedProjectPath} from "nbook/server/workspace-files/project-data-plane-guard";
import {recordProjectDelete, recordProjectWrite} from "nbook/server/workspace-history/project-history";

/**
 * Agent 文件工具（write / edit / apply_patch）的文件历史归因记账（Task 95 S5）。
 *
 * 项目归属从**绝对路径**反推而非 context.projectPath：agent 以 Workspace Root 为 cwd，
 * 可用 `<其他slug>/...` 别名跨项目写文件，归账必须跟着实际落盘位置走。
 * 反推失败（越界、容器根散文件、user-assets、非 managed 形态）与未 open 项目一律静默跳过；
 * 记账本身 fail-open（record* 内部保证），绝不影响工具主流程。
 */

/** 归一 before/after 入参：string 按 UTF-8 编码为字节。 */
function toRecordBytes(content: string | Uint8Array | null): Uint8Array | null {
    if (content === null) {
        return null;
    }
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/**
 * 从 agent 写盘的绝对路径反推项目归属。
 * 返回 null 表示不属于任何受管项目（不记账）。
 */
export function resolveAgentWritePath(workspaceRoot: string, absolutePath: string): {projectPath: string; relativePath: string} | null {
    const rel = relative(resolve(workspaceRoot), absolutePath).replaceAll("\\", "/");
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
        return null;
    }
    const segments = rel.split("/");
    const slug = segments[0];
    // 根下散文件（segments.length === 1）不属于任何项目
    if (!slug || segments.length < 2) {
        return null;
    }
    const projectPath = managedProjectPath(`workspace/${slug}`);
    if (!projectPath) {
        return null;
    }
    return {projectPath, relativePath: segments.slice(1).join("/")};
}

/**
 * 记一次 agent 工具写入。after = null 表示删除（此时 before 必须有内容才有账可记）。
 * before = null 表示写前文件不存在（file.create 语义）。
 */
export async function recordAgentWorkspaceWrite(input: {
    sessionId: number;
    workspaceRoot: string;
    absolutePath: string;
    before: string | Uint8Array | null;
    after: string | Uint8Array | null;
}): Promise<void> {
    const target = resolveAgentWritePath(input.workspaceRoot, input.absolutePath);
    if (target === null) {
        return;
    }
    // N5：sessionId number→string 集中在此转换，模块侧 actor 恒为 string
    const actor = {kind: "agent" as const, sessionId: String(input.sessionId)};
    const after = toRecordBytes(input.after);
    if (after === null) {
        const before = toRecordBytes(input.before);
        if (before === null) {
            return;
        }
        await recordProjectDelete({
            projectPath: target.projectPath,
            relativePath: target.relativePath,
            actor,
            before,
        });
        return;
    }
    await recordProjectWrite({
        projectPath: target.projectPath,
        relativePath: target.relativePath,
        actor,
        before: toRecordBytes(input.before),
        after,
    });
}
