import {completeSimple} from "@earendil-works/pi-ai";
import {estimateContextTokens, estimateTokens, shouldCompact} from "@earendil-works/pi-agent-core";
import type {AgentMessage, Message, Model, ThinkingLevel} from "nbook/server/agent/messages/types";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {MessageSessionEntry, SessionEntry, SessionSnapshot} from "nbook/server/agent/session/types";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";

export const COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

export const COMPACTION_SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

export type CompactionOptions = {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
};

export const DEFAULT_NEURO_COMPACTION_OPTIONS: CompactionOptions = {
    enabled: true,
    reserveTokens: 8_000,
    keepRecentTokens: 24_000,
};

type CompactionPlan = {
    firstKeptEntry: MessageSessionEntry | null;
    messagesToSummarize: Message[];
    previousSummary?: string;
};

/**
 * 自动压缩：超过上下文预算时追加 compaction entry。
 */
export async function compactIfNeeded(input: {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    messages: AgentMessage[];
    model: Model<any>;
    apiKey?: string;
    thinkingLevel?: ThinkingLevel;
    options?: CompactionOptions;
}): Promise<boolean> {
    const options = input.options ?? DEFAULT_NEURO_COMPACTION_OPTIONS;
    if (!options.enabled) {
        return false;
    }

    const usage = estimateContextTokens(input.messages);
    if (!shouldCompact(usage.tokens, input.model.contextWindow, options)) {
        return false;
    }

    await appendCompaction({
        repo: input.repo,
        snapshot: input.snapshot,
        messages: input.messages,
        tokensBefore: usage.tokens,
        model: input.model,
        apiKey: input.apiKey,
        thinkingLevel: input.thinkingLevel,
        options,
    });
    return true;
}

/**
 * 追加 compaction entry。摘要由 LLM 生成，失败时不写入 session。
 */
export async function appendCompaction(input: {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    messages: AgentMessage[];
    model: Model<any>;
    apiKey?: string;
    thinkingLevel?: ThinkingLevel;
    tokensBefore?: number;
    instructions?: string;
    options?: CompactionOptions;
}): Promise<void> {
    const options = input.options ?? DEFAULT_NEURO_COMPACTION_OPTIONS;
    const path = input.repo.activePath(input.snapshot);
    const messageEntries = path.filter((entry): entry is MessageSessionEntry => entry.type === "message");
    assertNoPendingToolCall(messageEntries.map((entry) => entry.message));
    const plan = selectCompactionPlan(path, options);
    const generatedSummary = await generateCompactionSummary({
        messages: plan.messagesToSummarize,
        model: input.model,
        apiKey: input.apiKey,
        instructions: input.instructions,
        previousSummary: plan.previousSummary,
        thinkingLevel: input.thinkingLevel,
        reserveTokens: options.reserveTokens,
    });
    const summary = `${COMPACTION_SUMMARY_PREFIX}\n\n${generatedSummary}`;

    await input.repo.appendEntry(input.snapshot.metadata.sessionId, {
        type: "compaction",
        summary,
        firstKeptEntryId: plan.firstKeptEntry?.id ?? null,
        tokensBefore: input.tokensBefore ?? estimateContextTokens(input.messages).tokens,
        details: {
            instructions: input.instructions,
            reserveTokens: options.reserveTokens,
            keepRecentTokens: options.keepRecentTokens,
        },
    }, input.snapshot.metadata.workspaceKey);
}

/**
 * 构造真实 LLM 摘要。这里不做 fallback，避免失败时写入误导性摘要。
 */
async function generateCompactionSummary(input: {
    messages: Message[];
    model: Model<any>;
    apiKey?: string;
    instructions?: string;
    previousSummary?: string;
    thinkingLevel?: ThinkingLevel;
    reserveTokens: number;
}): Promise<string> {
    const conversation = input.messages.length
        ? input.messages.map((message) => `${message.role}: ${messageText(message)}`).join("\n\n")
        : "No prior history.";
    const prompt = [
        "Summarize the following conversation history for a future LLM resume point.",
        input.instructions ? `Additional instructions:\n${input.instructions}` : "",
        input.previousSummary ? `<previous-summary>\n${input.previousSummary}\n</previous-summary>` : "",
        `<conversation>\n${conversation}\n</conversation>`,
    ].filter(Boolean).join("\n\n");
    const response = await completeSimple(input.model, {
        systemPrompt: COMPACTION_PROMPT,
        messages: [createUserMessage({text: prompt})],
    }, {
        apiKey: input.apiKey,
        headers: input.model.headers,
        maxTokens: Math.min(Math.floor(input.reserveTokens * 0.8), input.model.maxTokens),
        reasoning: input.thinkingLevel && input.thinkingLevel !== "off" ? input.thinkingLevel as never : undefined,
    });

    if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(response.errorMessage || "compaction summary 生成失败");
    }

    const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
    if (!text) {
        throw new Error("compaction summary 为空");
    }
    return text;
}

/**
 * 选择压缩边界，并保证保留下来的历史不会从 toolResult 半截开始。
 */
function selectCompactionPlan(path: SessionEntry[], options: CompactionOptions): CompactionPlan {
    const messageEntries = path.filter((entry): entry is MessageSessionEntry => entry.type === "message");
    if (messageEntries.length === 0) {
        return {
            firstKeptEntry: null,
            messagesToSummarize: [],
        };
    }

    const previousCompaction = [...path].reverse().find((entry) => entry.type === "compaction");
    const previousFirstKeptIndex = previousCompaction?.type === "compaction" && previousCompaction.firstKeptEntryId
        ? path.findIndex((entry) => entry.id === previousCompaction.firstKeptEntryId)
        : -1;
    const boundaryStart = previousFirstKeptIndex >= 0
        ? previousFirstKeptIndex
        : previousCompaction
            ? path.findIndex((entry) => entry.id === previousCompaction.id) + 1
            : 0;

    let tokens = 0;
    let selectedPathIndex = -1;
    for (let index = path.length - 1; index >= boundaryStart; index -= 1) {
        const entry = path[index];
        if (entry?.type !== "message") {
            continue;
        }
        tokens += estimateTokens(entry.message);
        selectedPathIndex = index;
        if (tokens >= options.keepRecentTokens) {
            break;
        }
    }

    if (selectedPathIndex < 0) {
        return {
            firstKeptEntry: null,
            messagesToSummarize: messageEntries.map((entry) => entry.message),
            previousSummary: previousCompaction?.type === "compaction" ? previousCompaction.summary : undefined,
        };
    }

    selectedPathIndex = moveCutBeforeToolResult(path, selectedPathIndex, boundaryStart);
    const selectedEntry = path[selectedPathIndex];
    const firstKeptEntry = selectedEntry?.type === "message" ? selectedEntry : null;
    const messagesToSummarize = path
        .slice(boundaryStart, selectedPathIndex)
        .filter((entry): entry is MessageSessionEntry => entry.type === "message")
        .map((entry) => entry.message);

    return {
        firstKeptEntry,
        messagesToSummarize,
        previousSummary: previousCompaction?.type === "compaction" ? previousCompaction.summary : undefined,
    };
}

/**
 * 如果保留区从 toolResult 开始，把 cut point 前移到对应 assistant toolCall。
 */
function moveCutBeforeToolResult(path: SessionEntry[], selectedPathIndex: number, boundaryStart: number): number {
    const selected = path[selectedPathIndex];
    if (selected?.type !== "message" || selected.message.role !== "toolResult") {
        return selectedPathIndex;
    }
    const toolResult = selected.message;

    for (let index = selectedPathIndex - 1; index >= boundaryStart; index -= 1) {
        const entry = path[index];
        if (entry?.type !== "message" || entry.message.role !== "assistant") {
            continue;
        }
        const hasMatchingToolCall = entry.message.content.some((block) => {
            return block.type === "toolCall" && block.id === toolResult.toolCallId;
        });
        if (hasMatchingToolCall) {
            return index;
        }
    }
    return selectedPathIndex;
}

/**
 * 未完成 tool call 会破坏 continue/approval 恢复语义，压缩前必须拒绝。
 */
function assertNoPendingToolCall(messages: Message[]): void {
    const completedToolCallIds = new Set(messages
        .filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId));
    const pendingToolCall = messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.content.filter((block) => block.type === "toolCall"))
        .find((toolCall) => !completedToolCallIds.has(toolCall.id));
    if (pendingToolCall) {
        throw new Error(`当前 session 存在未完成 tool call，无法压缩：${pendingToolCall.name}`);
    }
}
