import type {AssistantMessage} from "nbook/server/agent/messages/types";
import {createAssistantTextMessage} from "nbook/server/agent/messages/message-utils";
import type {FailedRunLoopResult, FailedTurnOutcome, RunFrame, TurnIngestResult} from "nbook/server/agent/harness/run-kernel-types";

export type FailedTurnIngestDraft = {
    assistant: AssistantMessage;
    toolResults: [];
    messageStatus?: "partial" | "interrupted" | "error";
};

export type AppliedFailedTurn = {
    finalAssistant: AssistantMessage;
    ingest?: TurnIngestResult;
};

/**
 * provider streaming 失败后，只保留可展示文本，剥离未闭合 tool calls。
 */
export function sanitizePartialAssistant(assistant: AssistantMessage): AssistantMessage | null {
    const content = assistant.content.filter((block) => block.type !== "toolCall");
    if (!content.some((block) => block.type === "text" && block.text.trim())) {
        return null;
    }
    return {
        ...assistant,
        content,
    };
}

/**
 * 构造 provider/request 失败时的内部 assistant 标记。
 *
 * 该 message 只用于 run result / SSE 终态，不应在没有 partial content 时写入 session。
 */
export function createRuntimeErrorAssistant(error: unknown): AssistantMessage {
    const message = error instanceof Error ? error.message : String(error);
    return {
        ...createAssistantTextMessage({
            text: "",
            stopReason: "error",
        }),
        errorMessage: message,
    };
}

/**
 * 将 failed outcome 转成可选的 partial assistant ingest 草案。
 */
export function createFailedTurnIngestDraft(outcome: FailedTurnOutcome): FailedTurnIngestDraft | undefined {
    if (!outcome.partialAssistant) {
        return undefined;
    }
    return {
        assistant: outcome.partialAssistant,
        toolResults: [],
        messageStatus: outcome.messageStatus,
    };
}

/**
 * 将失败 outcome 和可选 ingest 结果归并为 RunFrame 需要的失败状态。
 */
export function applyFailedTurnOutcome(outcome: FailedTurnOutcome, ingest?: TurnIngestResult): AppliedFailedTurn {
    return {
        finalAssistant: outcome.finalAssistant,
        ingest,
    };
}

/**
 * 将失败后的 RunFrame 归并成 Run Kernel 的 failed 结果。
 */
export function createFailedRunLoopResult(frame: RunFrame, outcome: FailedTurnOutcome): FailedRunLoopResult {
    return {
        status: "failed",
        finalAssistant: frame.finalAssistant,
        errorInfo: outcome.errorInfo,
        terminalStatus: outcome.messageStatus === "interrupted" ? "aborted" : "error",
    };
}
