import type {Message} from "nbook/server/agent/messages/types";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {advanceAgentCursor, readUnseenForAgent} from "nbook/server/workspace-history/project-history";
import {
    readAgentChangeDiffDetails,
    type AgentChangeDiffDetail,
} from "nbook/server/workspace-history/agent-change-diff";
import {isSensitiveHistoryDiffPath} from "nbook/server/workspace-history/history-diff";
import {
    DEFAULT_AGENT_DIFF_MAX_CHARS,
    MAX_AGENT_CHANGE_LISTED_FILES,
    MAX_AGENT_CHANGE_NOTICE_CHARS,
} from "nbook/shared/agent/file-change-policy";
import type {OperationActor, UnseenGroup} from "nbook/server/vendor/nb-history/index";

export type FileChangeAwareness = "off" | "minimal" | "full";

export type ProfileTurnContextPlan = {
    kind: "file-change-notice";
    mode: "minimal" | "full";
    /** 小型 unified diff 的字符预算；0 = 只给引用与位置摘要。 */
    diffMaxChars: number;
    /** 在 AppendingSet 静态消息中的插入位置。 */
    appendingIndex: number;
};

export type ProfileTurnContextSettlement = {
    kind: "file-change-notice";
    projectPath: string;
    sessionId: number;
    /** nb-history last_seen_entry_id，成功 ingest 后原样推进。 */
    entryId: number;
};

export type MaterializedProfileTurnContext = {
    insertions: Array<{
        appendingIndex: number;
        message: Message;
    }>;
    settlements: ProfileTurnContextSettlement[];
};

/**
 * Profile Workbench dry-run 占位：展示节点位置与模式，但不读取真实 Project history。
 */
export function previewProfileTurnContexts(plans: ProfileTurnContextPlan[]): MaterializedProfileTurnContext["insertions"] {
    return plans.map((plan) => ({
        appendingIndex: plan.appendingIndex,
        message: createUserMessage({
            text: `<file-change-notice runtime-data="preview" mode="${plan.mode}" diff-max-chars="${plan.diffMaxChars}">\nGenerated at runtime from project file changes not yet seen by this session.\n</file-change-notice>`,
        }),
    }));
}

/**
 * 读取本轮 Profile 声明的动态上下文数据并渲染消息。
 *
 * Harness 只消费这一通用结果，不再知道 file-change notice 的查询、正文或游标语义。
 */
export async function materializeProfileTurnContexts(input: {
    plans: ProfileTurnContextPlan[];
    projectPath?: string;
    sessionId: number;
}): Promise<MaterializedProfileTurnContext> {
    if (!input.projectPath || input.plans.length === 0) {
        return {insertions: [], settlements: []};
    }
    const insertions: MaterializedProfileTurnContext["insertions"] = [];
    const settlements: ProfileTurnContextSettlement[] = [];
    for (const plan of input.plans) {
        const groups = await readUnseenForAgent(input.projectPath, input.sessionId);
        if (groups.length === 0) {
            continue;
        }
        const diffDetails = await readAgentChangeDiffDetails({
            projectPath: input.projectPath,
            groups,
            maxChars: plan.diffMaxChars,
        });
        insertions.push({
            appendingIndex: plan.appendingIndex,
            message: createUserMessage({text: buildFileChangeReminder(groups, plan.mode, diffDetails, plan.diffMaxChars)}),
        });
        settlements.push({
            kind: "file-change-notice",
            projectPath: input.projectPath,
            sessionId: input.sessionId,
            entryId: Math.max(...groups.map((group) => group.maxEntryId)),
        });
    }
    return {insertions, settlements};
}

/**
 * 把动态 AppendingSet 消息插回 profile 声明的位置。
 */
export function mergeProfileTurnContextMessages(
    messages: Message[],
    insertions: MaterializedProfileTurnContext["insertions"],
): Message[] {
    const sorted = [...insertions].sort((left, right) => left.appendingIndex - right.appendingIndex);
    const result: Message[] = [];
    let insertionIndex = 0;
    for (let messageIndex = 0; messageIndex <= messages.length; messageIndex += 1) {
        while (sorted[insertionIndex]?.appendingIndex === messageIndex) {
            result.push(sorted[insertionIndex]!.message);
            insertionIndex += 1;
        }
        if (messageIndex < messages.length) {
            result.push(messages[messageIndex]!);
        }
    }
    if (insertionIndex !== sorted.length) {
        throw new Error(`Profile turn context 插入位置越界：index=${sorted[insertionIndex]!.appendingIndex}, messages=${messages.length}`);
    }
    return result;
}

/**
 * provider turn 成功 ingest 后结算动态上下文交付。
 */
export async function settleProfileTurnContexts(settlements: ProfileTurnContextSettlement[]): Promise<void> {
    for (const settlement of settlements) {
        await advanceAgentCursor(settlement.projectPath, settlement.sessionId, settlement.entryId);
    }
}

/**
 * 构造 `<file-change-notice>` 提醒正文。
 * 安全小 diff 直接内联；超限时只给 workspace 引用、hunk 位置和主动 read 提示。
 */
export function buildFileChangeReminder(
    groups: UnseenGroup[],
    mode: "minimal" | "full",
    diffDetails: ReadonlyMap<string, AgentChangeDiffDetail> = new Map(),
    diffMaxChars = DEFAULT_AGENT_DIFF_MAX_CHARS,
): string {
    const header = [
        "<file-change-notice>",
        groups.length === 1
            ? "The following project file changed since you last viewed it:"
            : `The following ${groups.length} project files changed since you last viewed them:`,
    ];
    const hasSensitivePath = groups.some((group) => isSensitiveHistoryDiffPath(group.path));
    const hasReadableNonSensitivePath = groups.some((group) => group.endHash !== null && !isSensitiveHistoryDiffPath(group.path));
    const hasDeletedPath = groups.some((group) => group.endHash === null);
    const footer = [
        hasReadableNonSensitivePath
            ? mode === "full"
                ? `Non-sensitive files may no longer match versions you read earlier. Inline diffs show changed fragments only; use read only when the task needs complete current content from a non-sensitive path.${hasSensitivePath ? " Sensitive paths are excluded from the prompt and must be reviewed in the file change inbox." : ""}${hasDeletedPath ? " Deleted paths cannot be read." : ""}`
                : `Inline diffs show changed fragments only. Use read only for complete current content from a non-sensitive path when needed.${hasSensitivePath ? " Sensitive paths must be reviewed in the file change inbox." : ""}${hasDeletedPath ? " Deleted paths cannot be read." : ""}`
            : hasSensitivePath
                ? `Sensitive file contents and diffs are excluded from the prompt. Review sensitive paths in the file change inbox instead of reading them because of this notice.${hasDeletedPath ? " Deleted paths cannot be read." : ""}`
                : "All listed files were deleted. Their current paths cannot be read; ask the user to inspect or restore them from the file change inbox if earlier content is needed.",
        "</file-change-notice>",
    ];
    const lines: string[] = [];
    let listedCount = 0;
    for (const group of groups.slice(0, MAX_AGENT_CHANGE_LISTED_FILES)) {
        const detail = diffDetails.get(group.path);
        let rendered = renderFileChange(group, mode, detail, diffMaxChars);
        if (!noticeFits(header, lines, rendered, groups.length - listedCount - 1, footer) && detail?.kind === "inline") {
            const {diff: _discardedDiff, ...reference} = detail;
            rendered = renderFileChange(group, mode, {...reference, kind: "reference"}, diffMaxChars);
        }
        if (!noticeFits(header, lines, rendered, groups.length - listedCount - 1, footer)) {
            break;
        }
        lines.push(...rendered);
        listedCount += 1;
    }
    const omittedCount = groups.length - listedCount;
    if (omittedCount > 0) {
        lines.push(omittedFileSummary(omittedCount));
    }
    const notice = [...header, ...lines, ...footer].join("\n");
    if (noticeCharCount(notice) > MAX_AGENT_CHANGE_NOTICE_CHARS) {
        throw new Error(`file-change-notice 超过硬上限：${noticeCharCount(notice)} > ${MAX_AGENT_CHANGE_NOTICE_CHARS}`);
    }
    return notice;
}

/** 渲染单个文件的引用、摘要与可选小型 diff。 */
function renderFileChange(group: UnseenGroup, mode: "minimal" | "full", detail: AgentChangeDiffDetail | undefined, diffMaxChars: number): string[] {
    const metadata = mode === "minimal"
        ? changeCount(group.entries.length)
        : `${changeCount(group.entries.length)}; ${describeActors(group)}; ${describeOperations(group)}`;
    const deleted = group.endHash === null;
    const sensitive = isSensitiveHistoryDiffPath(group.path);
    const status = primaryOperationLabel(group);
    const target = deleted || sensitive ? escapeMarkdownLabel(group.path) : workspaceReference(group.path);
    const lines = [`- ${status}: ${target} — ${metadata}`];
    if (sensitive) {
        lines.push(deleted
            ? "  Sensitive path: file content and diff are excluded from the prompt. The file was deleted and its current path cannot be read; ask the user to inspect or restore it from the file change inbox if earlier content is needed."
            : "  Sensitive path: file content and diff are excluded from the prompt. Review it in the file change inbox; do not retrieve or reproduce its contents solely because of this notice.");
        return lines;
    }
    if (!detail) {
        return lines;
    }
    if (detail.kind === "inline") {
        lines.push(
            `  Location: ${detail.locations.map(translateLocation).join("; ")}`,
            `  Diff: ${detail.charCount} characters, ${detail.changedLineCount} changed lines.`,
            renderDiffFence(detail.diff),
        );
        return lines;
    }
    if (detail.kind === "reference") {
        lines.push(
            `  Location: ${detail.locations.map(translateLocation).join("; ")}`,
            deleted
                ? `  Diff size: ${detail.charCount} characters, ${detail.changedLineCount} changed lines; above the inline limit of ${diffMaxChars} characters / ${detail.lineLimit} lines. The file was deleted and its current path cannot be read; ask the user to inspect or restore it from the file change inbox if earlier content is needed.`
                : `  Diff size: ${detail.charCount} characters, ${detail.changedLineCount} changed lines; above the inline limit of ${diffMaxChars} characters / ${detail.lineLimit} lines. Use read for the complete current file instead of guessing unseen content.`,
        );
        return lines;
    }
    if (detail.kind === "blocked") {
        lines.push("  File content and diff are excluded from the prompt. Review the path in the file change inbox instead of reading it because of this notice.");
        return lines;
    }
    if (detail.kind === "unchanged") {
        lines.push("  File content is unchanged; this group may contain only a rename or an equivalent write.");
        return lines;
    }
    lines.push(deleted
        ? `  Diff unavailable (${detail.reason}); the file was deleted and its current path cannot be read.`
        : `  Diff unavailable (${detail.reason}); use read if the task depends on this file.`);
    return lines;
}

/** 判断追加一个文件后，连同遗漏摘要与 footer 是否仍在 notice 硬上限内。 */
function noticeFits(header: string[], current: string[], candidate: string[], omittedAfterCandidate: number, footer: string[]): boolean {
    const omitted = omittedAfterCandidate > 0 ? [omittedFileSummary(omittedAfterCandidate)] : [];
    return noticeCharCount([...header, ...current, ...candidate, ...omitted, ...footer].join("\n")) <= MAX_AGENT_CHANGE_NOTICE_CHARS;
}

/** 大批量变更只保留准确数量，避免 prompt 与预处理成本无界增长。 */
function omittedFileSummary(count: number): string {
    return `- ${count} additional changed file${count === 1 ? " was" : "s were"} not expanded; this notice still accounts for them.`;
}

/** Agent 字符预算按 Unicode code point 计数，与单文件 diff 策略保持一致。 */
function noticeCharCount(value: string): number {
    return Array.from(value).length;
}

/** 生成 Agent UI 可点击、模型也能直接看到的 Project Workspace 相对引用。 */
function workspaceReference(path: string): string {
    const label = escapeMarkdownLabel(path);
    const target = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `[${label}](${target})`;
}

/** 转义 Markdown link label 与删除路径提示中的结构字符。 */
function escapeMarkdownLabel(path: string): string {
    return path.replace(/([\\\[\]])/gu, "\\$1");
}

/** 选择不会被 diff 正文中的反引号提前闭合的 Markdown fence。 */
function renderDiffFence(diff: string): string {
    const longestRun = Math.max(0, ...[...diff.matchAll(/`+/gu)].map((match) => match[0].length));
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `${fence}diff\n${diff}\n${fence}`;
}

/** 归因摘要：组内出现过的操作者去重列举。 */
function describeActors(group: UnseenGroup): string {
    const labels = new Set<string>();
    for (const entry of group.entries) {
        labels.add(actorLabel(entry.actor));
    }
    return `by ${[...labels].join(", ")}`;
}

function actorLabel(actor: OperationActor): string {
    switch (actor.kind) {
        case "user":
            return "the user";
        case "external":
            return "an external tool";
        case "agent":
            return `agent#${actor.sessionId}`;
        case "system":
            return `the system (${actor.source})`;
    }
}

/** 操作类型计数摘要，如「修改×2、删除×1」。 */
function describeOperations(group: UnseenGroup): string {
    const counts = new Map<string, number>();
    for (const entry of group.entries) {
        const label = operationLabel(entry.operation.type);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => count > 1 ? `${label} x${count}` : label).join(", ");
}

function operationLabel(type: string): string {
    switch (type) {
        case "file.create":
            return "added";
        case "file.edit":
            return "modified";
        case "file.delete":
            return "deleted";
        case "file.rename":
            return "renamed";
        case "file.revert":
            return "reverted";
        case "file.restore":
            return "restored";
        default:
            return type;
    }
}

/**
 * 按文件的净状态和本组操作历史选择 Git 风格主状态。
 * 后续 edit 不应抹掉 create / rename / restore / revert 的用户可见语义。
 */
function primaryOperationLabel(group: UnseenGroup): string {
    const operations = new Set(group.entries.map((entry) => entry.operation.type));
    if (group.endHash === null) {
        return "deleted";
    }
    if (group.baseHash === null) {
        if (operations.has("file.restore")) {
            return "restored";
        }
        if (operations.has("file.revert")) {
            return "reverted";
        }
        return "added";
    }
    if (operations.has("file.rename")) {
        return "renamed";
    }
    if (operations.has("file.revert")) {
        return "reverted";
    }
    if (operations.has("file.restore")) {
        return "restored";
    }
    return "modified";
}

/** 英文变化计数。 */
function changeCount(count: number): string {
    return `${count} change${count === 1 ? "" : "s"}`;
}

/** nb-history hunk 位置当前使用中文标记，在提示层转换为英文。 */
function translateLocation(location: string): string {
    return location
        .replace(/^新 /u, "new ")
        .replace(/ \/ 旧 /u, " / old ")
        .replace(/^旧 /u, "old ");
}
