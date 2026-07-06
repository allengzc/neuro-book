import {tracedCompleteSimple} from "nbook/server/agent/observability/traced-provider";
import type {PiTraceBinding} from "nbook/server/agent/observability/traced-provider";
import {estimateContextTokens, estimateTokens} from "@earendil-works/pi-agent-core";
import type {AgentMessage, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import type {ProfileCompactionPlan} from "nbook/server/agent/profiles/types";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {CompactionSessionEntry, CustomMessageSessionEntry, MessageSessionEntry, SessionEntry, SessionSnapshot} from "nbook/server/agent/session/types";
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
    triggerPercent?: number;
    triggerTokens?: number;
    prompt: string;
    summaryPrefix: string;
    promptSource: "default" | "profile";
    summaryPrefixSource: "default" | "profile";
};

export const DEFAULT_NEURO_COMPACTION_OPTIONS: Omit<CompactionOptions, "enabled"> = {
    reserveTokens: 25_600,
    keepRecentTokens: 24_000,
    prompt: COMPACTION_PROMPT,
    summaryPrefix: COMPACTION_SUMMARY_PREFIX,
    promptSource: "default",
    summaryPrefixSource: "default",
};

type CompactionPlan = {
    firstKeptEntry: ModelVisibleSessionEntry | null;
    messagesToSummarize: Message[];
    previousSummary?: string;
    metrics: {
        recentTokens: number;
        summarizedTokens: number;
        firstKeptEntryType?: ModelVisibleSessionEntry["type"];
        visibleEntryCountBefore: number;
        recentEntryCount: number;
        summarizedEntryCount: number;
    };
};

type ModelVisibleSessionEntry = MessageSessionEntry | CustomMessageSessionEntry;

/**
 * 自动压缩：超过上下文预算时追加 compaction entry。
 */
export async function compactIfNeeded(input: {
    repo: JsonlSessionRepository;
    snapshot: SessionSnapshot;
    messages: AgentMessage[];
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    thinkingLevel?: ThinkingLevel;
    compaction?: ProfileCompactionPlan;
    trace?: PiTraceBinding;
    writeCompactionEntry: (entry: Omit<CompactionSessionEntry, "id" | "parentId" | "timestamp">) => Promise<void>;
}): Promise<boolean> {
    if (!input.compaction) {
        return false;
    }
    const options = resolveCompactionOptions(input.compaction, input.model);
    if (!options.enabled) {
        return false;
    }

    const usage = estimateContextTokens(input.messages);
    if (!shouldCompactWithOptions(usage.tokens, input.model.contextWindow, options)) {
        return false;
    }
    await appendCompaction({
        repo: input.repo,
        snapshot: input.snapshot,
        messages: input.messages,
        tokensBefore: usage.tokens,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        requestOptions: input.requestOptions,
        thinkingLevel: input.thinkingLevel,
        options,
        trace: input.trace,
        writeCompactionEntry: input.writeCompactionEntry,
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
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    thinkingLevel?: ThinkingLevel;
    tokensBefore?: number;
    instructions?: string;
    compaction?: ProfileCompactionPlan;
    options?: CompactionOptions;
    trace?: PiTraceBinding;
    writeCompactionEntry: (entry: Omit<CompactionSessionEntry, "id" | "parentId" | "timestamp">) => Promise<void>;
}): Promise<void> {
    if (!input.options && !input.compaction) {
        throw new Error("缺少 profile compaction 配置，无法执行压缩。");
    }
    const options = input.options ?? resolveCompactionOptions(input.compaction!, input.model);
    const path = input.repo.activePath(input.snapshot);
    const visibleEntries = path.filter(isModelVisibleEntry);
    assertNoPendingToolCall(visibleEntries.map(entryMessage));
    const plan = selectCompactionPlan(path, options);
    const generatedSummary = await generateCompactionSummary({
        messages: plan.messagesToSummarize,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        requestOptions: input.requestOptions,
        instructions: input.instructions,
        previousSummary: plan.previousSummary,
        thinkingLevel: input.thinkingLevel,
        reserveTokens: options.reserveTokens,
        prompt: options.prompt,
        trace: input.trace,
    });
    const summary = `${options.summaryPrefix}\n\n${generatedSummary}`;
    const tokensBefore = input.tokensBefore ?? estimateContextTokens(input.messages).tokens;

    const entry = {
        type: "compaction",
        summary,
        firstKeptEntryId: plan.firstKeptEntry?.id ?? null,
        tokensBefore,
        details: {
            instructions: input.instructions,
            reserveTokens: options.reserveTokens,
            keepRecentTokens: options.keepRecentTokens,
            triggerPercent: options.triggerPercent,
            triggerTokens: options.triggerTokens,
            promptSource: options.promptSource,
            summaryPrefixSource: options.summaryPrefixSource,
            recentTokens: plan.metrics.recentTokens,
            summarizedTokens: plan.metrics.summarizedTokens,
            visibleTokensBefore: tokensBefore,
            firstKeptEntryType: plan.metrics.firstKeptEntryType,
            visibleEntryCountBefore: plan.metrics.visibleEntryCountBefore,
            recentEntryCount: plan.metrics.recentEntryCount,
            summarizedEntryCount: plan.metrics.summarizedEntryCount,
        },
    } satisfies Omit<CompactionSessionEntry, "id" | "parentId" | "timestamp">;

    await input.writeCompactionEntry(entry);
}

/**
 * 将 profile compaction plan 解析成当前模型下的执行策略。
 */
export function resolveCompactionOptions(plan: ProfileCompactionPlan, model: Model<any>): CompactionOptions {
    const keepRecentTokens = typeof plan.keepRecentPercent === "number"
        ? Math.max(1, Math.floor(model.contextWindow * plan.keepRecentPercent))
        : plan.keepRecentTokens ?? DEFAULT_NEURO_COMPACTION_OPTIONS.keepRecentTokens;
    return {
        enabled: plan.enabled ?? true,
        reserveTokens: plan.reserveTokens ?? DEFAULT_NEURO_COMPACTION_OPTIONS.reserveTokens,
        keepRecentTokens,
        triggerPercent: plan.triggerPercent,
        triggerTokens: plan.triggerTokens,
        prompt: plan.prompt ?? COMPACTION_PROMPT,
        summaryPrefix: plan.summaryPrefix ?? COMPACTION_SUMMARY_PREFIX,
        promptSource: plan.prompt ? "profile" : "default",
        summaryPrefixSource: plan.summaryPrefix ? "profile" : "default",
    };
}

/**
 * 根据 profile/harness 策略判断是否需要自动压缩。
 */
export function shouldCompactWithOptions(contextTokens: number, contextWindow: number, options: CompactionOptions): boolean {
    if (!options.enabled) {
        return false;
    }
    if (typeof options.triggerTokens === "number") {
        return contextTokens >= options.triggerTokens;
    }
    if (typeof options.triggerPercent === "number") {
        return contextTokens / contextWindow >= options.triggerPercent;
    }
    return contextTokens > contextWindow - options.reserveTokens;
}

/**
 * 构造真实 LLM 摘要。这里不做 fallback，避免失败时写入误导性摘要。
 */
async function generateCompactionSummary(input: {
    messages: Message[];
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    instructions?: string;
    previousSummary?: string;
    thinkingLevel?: ThinkingLevel;
    reserveTokens: number;
    prompt: string;
    trace?: PiTraceBinding;
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
    const requestOptions = piStreamOptions(input.requestOptions);
    const completeContext = {
        systemPrompt: input.prompt,
        messages: [createUserMessage({text: prompt})],
    };
    const completeOptions = {
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs ?? undefined,
        ...requestOptions,
        headers: mergeHeaders(readHeaders(requestOptions.headers), input.model.headers),
        maxTokens: Math.min(Math.floor(input.reserveTokens * 0.8), input.model.maxTokens),
        reasoning: input.thinkingLevel && input.thinkingLevel !== "off" ? input.thinkingLevel as never : undefined,
    };
    // 统一入口：trace 缺省时 tracedCompleteSimple 等同裸 completeSimple（不落记录、零开销）。
    const response = await tracedCompleteSimple(input.model, completeContext, completeOptions, input.trace);

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
    const visibleEntries = path.filter(isModelVisibleEntry);
    if (visibleEntries.length === 0) {
        return {
            firstKeptEntry: null,
            messagesToSummarize: [],
            metrics: {
                recentTokens: 0,
                summarizedTokens: 0,
                visibleEntryCountBefore: 0,
                recentEntryCount: 0,
                summarizedEntryCount: 0,
            },
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
        if (!entry || !isModelVisibleEntry(entry)) {
            continue;
        }
        tokens += estimateTokens(entryMessage(entry));
        selectedPathIndex = index;
        if (tokens >= options.keepRecentTokens) {
            break;
        }
    }

    if (selectedPathIndex < 0) {
        const summarizableMessages = path
            .slice(boundaryStart)
            .filter((entry): entry is MessageSessionEntry => entry.type === "message")
            .map((entry) => entry.message);
        return {
            firstKeptEntry: null,
            messagesToSummarize: summarizableMessages,
            previousSummary: previousCompaction?.type === "compaction" ? previousCompaction.summary : undefined,
            metrics: {
                recentTokens: 0,
                summarizedTokens: sumMessageTokens(summarizableMessages),
                visibleEntryCountBefore: countVisibleEntries(path.slice(boundaryStart)),
                recentEntryCount: 0,
                summarizedEntryCount: summarizableMessages.length,
            },
        };
    }

    selectedPathIndex = moveCutBeforeToolResult(path, selectedPathIndex, boundaryStart);
    const selectedEntry = path[selectedPathIndex];
    const firstKeptEntry = selectedEntry && isModelVisibleEntry(selectedEntry) ? selectedEntry : null;
    const messagesToSummarize = path
        .slice(boundaryStart, selectedPathIndex)
        .filter((entry): entry is MessageSessionEntry => entry.type === "message")
        .map((entry) => entry.message);
    const recentEntries = path.slice(selectedPathIndex).filter(isModelVisibleEntry);

    return {
        firstKeptEntry,
        messagesToSummarize,
        previousSummary: previousCompaction?.type === "compaction" ? previousCompaction.summary : undefined,
        metrics: {
            recentTokens: sumVisibleEntryTokens(path.slice(selectedPathIndex)),
            summarizedTokens: sumMessageTokens(messagesToSummarize),
            firstKeptEntryType: firstKeptEntry?.type,
            visibleEntryCountBefore: countVisibleEntries(path.slice(boundaryStart)),
            recentEntryCount: recentEntries.length,
            summarizedEntryCount: messagesToSummarize.length,
        },
    };
}

/**
 * 如果保留区从 toolResult 开始，把 cut point 前移到对应 assistant toolCall。
 */
function moveCutBeforeToolResult(path: SessionEntry[], selectedPathIndex: number, boundaryStart: number): number {
    const selected = path[selectedPathIndex];
    if (!selected || !isModelVisibleEntry(selected)) {
        return selectedPathIndex;
    }
    const toolResult = entryMessage(selected);
    if (!isToolResultMessage(toolResult)) {
        return selectedPathIndex;
    }

    for (let index = selectedPathIndex - 1; index >= boundaryStart; index -= 1) {
        const entry = path[index];
        if (!entry || !isModelVisibleEntry(entry)) {
            continue;
        }
        const message = entryMessage(entry);
        if (!isAssistantMessage(message)) {
            continue;
        }
        const hasMatchingToolCall = message.content.some((block) => {
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
function assertNoPendingToolCall(messages: AgentMessage[]): void {
    const completedToolCallIds = new Set(messages
        .filter(isToolResultMessage)
        .map((message) => message.toolCallId));
    const pendingToolCall = messages
        .filter(isAssistantMessage)
        .flatMap((message) => message.content.filter((block) => block.type === "toolCall"))
        .find((toolCall) => !completedToolCallIds.has(toolCall.id));
    if (pendingToolCall) {
        throw new Error(`当前 session 存在未完成 tool call，无法压缩：${pendingToolCall.name}`);
    }
}

function isModelVisibleEntry(entry: SessionEntry): entry is ModelVisibleSessionEntry {
    return entry.type === "message" || (entry.type === "custom_message" && entry.visibleToModel);
}

function entryMessage(entry: ModelVisibleSessionEntry): AgentMessage {
    return entry.message;
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
    return message.role === "assistant";
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
    return message.role === "toolResult";
}

function countVisibleEntries(entries: SessionEntry[]): number {
    return entries.filter(isModelVisibleEntry).length;
}

function sumVisibleEntryTokens(entries: SessionEntry[]): number {
    return entries.reduce((total, entry) => {
        return isModelVisibleEntry(entry) ? total + estimateTokens(entryMessage(entry)) : total;
    }, 0);
}

function sumMessageTokens(messages: Message[]): number {
    return messages.reduce((total, message) => total + estimateTokens(message), 0);
}

function piStreamOptions(requestOptions: Record<string, JsonValue> | undefined): Record<string, unknown> {
    if (!requestOptions) {
        return {};
    }
    const allowedKeys = new Set(["headers", "maxRetries", "maxRetryDelayMs", "metadata", "transport", "cacheRetention"]);
    return Object.fromEntries(
        Object.entries(requestOptions).filter(([key]) => allowedKeys.has(key)),
    );
}

function readHeaders(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
}

function mergeHeaders(left: Record<string, string> | undefined, right: Record<string, string> | undefined): Record<string, string> | undefined {
    const headers = {
        ...left,
        ...right,
    };
    return Object.keys(headers).length ? headers : undefined;
}
