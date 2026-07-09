import type {JsonValue} from "nbook/server/agent/messages/types";
import type {OperationActor, UnseenGroup} from "nbook/server/vendor/nb-history/index";

/**
 * 文件变更感知（Task 95 S6）：每轮 pre-model 向 agent 注入「上轮之后其他人改了哪些项目文件」。
 * off = 不注入；minimal = 路径 + 条数；full = 含归因与操作类型 + 重读指引。
 */
export type FileChangeAwareness = "off" | "minimal" | "full";

/**
 * 从 profile resolved settings 读取感知模式。
 * 未声明该设置的 profile（含校验失败/类型不符）按 D12 默认 "minimal"。
 */
export function resolveFileChangeAwareness(settings: Record<string, JsonValue> | undefined): FileChangeAwareness {
    const value = settings?.["fileChangeAwareness"];
    return value === "off" || value === "minimal" || value === "full" ? value : "minimal";
}

/**
 * 构造 `<file-change-notice>` 提醒正文（纯函数，不触 IO）。
 * 只描述路径、归因与操作类型，不含 diff 正文——细节由 agent 自己 read 获取。
 */
export function buildFileChangeReminder(groups: UnseenGroup[], mode: "minimal" | "full"): string {
    const lines = mode === "minimal"
        ? groups.map((group) => `- ${group.path}（${group.entries.length} 条变更）`)
        : groups.map((group) => `- ${group.path}（${group.entries.length} 条变更；${describeActors(group)}；${describeOperations(group)}）`);
    return [
        "<file-change-notice>",
        `自你上次查看以来，以下 ${groups.length} 个项目文件发生了你未见过的变更：`,
        ...lines,
        mode === "full"
            ? "这些文件的当前内容可能与你记忆中的不同。继续处理涉及这些文件的任务前，先用 read 重新读取相关文件，不要依赖旧内容。"
            : "如需使用这些文件，先用 read 重新读取。",
        "</file-change-notice>",
    ].join("\n");
}

/** 归因摘要：组内出现过的操作者去重列举。 */
function describeActors(group: UnseenGroup): string {
    const labels = new Set<string>();
    for (const entry of group.entries) {
        labels.add(actorLabel(entry.actor));
    }
    return `来自 ${[...labels].join("、")}`;
}

function actorLabel(actor: OperationActor): string {
    switch (actor.kind) {
        case "user":
            return "用户";
        case "external":
            return "外部工具";
        case "agent":
            return `agent#${actor.sessionId}`;
        case "system":
            return `系统(${actor.source})`;
    }
}

/** 操作类型计数摘要，如「修改×2、删除×1」。 */
function describeOperations(group: UnseenGroup): string {
    const counts = new Map<string, number>();
    for (const entry of group.entries) {
        const label = operationLabel(entry.operation.type);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => count > 1 ? `${label}×${count}` : label).join("、");
}

function operationLabel(type: string): string {
    switch (type) {
        case "file.create":
            return "新建";
        case "file.edit":
            return "修改";
        case "file.delete":
            return "删除";
        case "file.rename":
            return "改名";
        case "file.revert":
            return "还原";
        case "file.restore":
            return "恢复";
        default:
            return type;
    }
}
