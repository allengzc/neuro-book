import type {Message} from "nbook/server/agent/messages/types";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {advanceAgentCursor, readUnseenForAgent} from "nbook/server/workspace-history/project-history";
import {
    readAgentChangeDiffDetails,
    type AgentChangeDiffDetail,
} from "nbook/server/workspace-history/agent-change-diff";
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
            text: `<file-change-notice runtime-data="preview" mode="${plan.mode}" diff-max-chars="${plan.diffMaxChars}">\n运行时按当前 session 未见变更生成。\n</file-change-notice>`,
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
        `自你上次查看以来，以下 ${groups.length} 个项目文件发生了你未见过的变更：`,
    ];
    const hasReadablePath = groups.some((group) => group.endHash !== null);
    const footer = [
        hasReadablePath
            ? mode === "full"
                ? "这些文件的当前内容可能与你记忆中的不同。小型 diff 只覆盖变更片段；对仍存在且未内联的文件，任务需要完整上下文时使用 read 读取对应引用，不要依赖旧内容；已删除文件的当前路径不可 read。"
                : "小型 diff 只覆盖变更片段；对仍存在且未内联的文件，需要完整上下文时使用 read 读取对应引用；已删除文件的当前路径不可 read。"
            : "这些变更均指向已删除文件；当前路径不可 read，需要旧内容时请让用户通过文件变更收件箱审查或还原。",
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
        ? `${group.entries.length} 条变更`
        : `${group.entries.length} 条变更；${describeActors(group)}；${describeOperations(group)}`;
    const deleted = group.endHash === null;
    const target = deleted ? `已删除：${escapeMarkdownLabel(group.path)}` : workspaceReference(group.path);
    const lines = [`- ${target}（${metadata}）`];
    if (!detail) {
        return lines;
    }
    if (detail.kind === "inline") {
        lines.push(
            `  变更位置：${detail.locations.join("；")}`,
            `  小型 diff：${detail.charCount} 字符 / ${detail.changedLineCount} 条变更行。`,
            renderDiffFence(detail.diff),
        );
        return lines;
    }
    if (detail.kind === "reference") {
        lines.push(
            `  变更位置：${detail.locations.join("；")}`,
            deleted
                ? `  diff 为 ${detail.charCount} 字符 / ${detail.changedLineCount} 条变更行，超过当前 ${diffMaxChars} 字符 / ${detail.lineLimit} 行的内联门槛。文件已删除，当前路径不可 read；需要旧内容时请让用户通过文件变更收件箱审查或还原。`
                : `  diff 为 ${detail.charCount} 字符 / ${detail.changedLineCount} 条变更行，超过当前 ${diffMaxChars} 字符 / ${detail.lineLimit} 行的内联门槛。需要时使用 read 读取该引用文件，不要猜测未展示的正文。`,
        );
        return lines;
    }
    if (detail.kind === "blocked") {
        lines.push("  这是敏感路径；正文和 diff 均不进入 prompt，不要在回复中回显其内容。");
        return lines;
    }
    if (detail.kind === "unchanged") {
        lines.push("  文件内容未变化；本组可能只包含重命名或等价写入。");
        return lines;
    }
    lines.push(deleted
        ? `  diff 当前不可用（${detail.reason}）；文件已删除，当前路径不可 read。`
        : `  diff 当前不可用（${detail.reason}）；任务涉及该文件时使用 read 重新读取。`);
    return lines;
}

/** 判断追加一个文件后，连同遗漏摘要与 footer 是否仍在 notice 硬上限内。 */
function noticeFits(header: string[], current: string[], candidate: string[], omittedAfterCandidate: number, footer: string[]): boolean {
    const omitted = omittedAfterCandidate > 0 ? [omittedFileSummary(omittedAfterCandidate)] : [];
    return noticeCharCount([...header, ...current, ...candidate, ...omitted, ...footer].join("\n")) <= MAX_AGENT_CHANGE_NOTICE_CHARS;
}

/** 大批量变更只保留准确数量，避免 prompt 与预处理成本无界增长。 */
function omittedFileSummary(count: number): string {
    return `- 另有 ${count} 个文件发生变化，未逐项展开；本轮提醒已覆盖这些变更。`;
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
