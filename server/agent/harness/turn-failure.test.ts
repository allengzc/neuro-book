import {describe, expect, it} from "vitest";
import type {AssistantMessage} from "nbook/server/agent/messages/types";
import {applyFailedTurnOutcome, createFailedRunLoopResult, createFailedTurnIngestDraft, createRuntimeErrorAssistant, sanitizePartialAssistant} from "nbook/server/agent/harness/turn-failure";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {FailedTurnOutcome, RunFrame} from "nbook/server/agent/harness/run-kernel-types";

describe("turn failure helpers", () => {
    it("partial assistant 会剥离未闭合 tool calls 并保留文本", () => {
        const assistant = fakeAssistant([
            {type: "text", text: "partial text"},
            {
                type: "toolCall",
                id: "call-1",
                name: "read",
                arguments: {},
            },
        ]);

        const sanitized = sanitizePartialAssistant(assistant);

        expect(sanitized?.content).toEqual([{type: "text", text: "partial text"}]);
        expect(sanitized && messageText(sanitized)).toBe("partial text");
    });

    it("没有可展示文本时不保存 partial assistant", () => {
        const assistant = fakeAssistant([
            {
                type: "toolCall",
                id: "call-1",
                name: "read",
                arguments: {},
            },
        ]);

        expect(sanitizePartialAssistant(assistant)).toBeNull();
    });

    it("runtime error assistant 记录 errorMessage 但不伪造正文", () => {
        const assistant = createRuntimeErrorAssistant(new Error("provider failed"));

        expect(assistant.stopReason).toBe("error");
        expect(assistant.errorMessage).toBe("provider failed");
        expect(messageText(assistant)).toBe("");
    });

    it("failed outcome 有 partial assistant 时会生成 ingest 草案", () => {
        const partialAssistant = fakeAssistant([{type: "text", text: "half"}]);
        const outcome: FailedTurnOutcome = {
            kind: "failed",
            phase: "provider",
            errorInfo: {
                message: "stream dropped",
                phase: "model",
            },
            finalAssistant: fakeAssistant([]),
            partialAssistant,
            messageStatus: "partial",
        };

        expect(createFailedTurnIngestDraft(outcome)).toEqual({
            assistant: partialAssistant,
            toolResults: [],
            messageStatus: "partial",
        });
    });

    it("failed outcome 没有 partial assistant 时不会生成 ingest 草案", () => {
        const outcome: FailedTurnOutcome = {
            kind: "failed",
            phase: "provider",
            errorInfo: {
                message: "provider failed",
                phase: "model",
            },
            finalAssistant: fakeAssistant([]),
        };

        expect(createFailedTurnIngestDraft(outcome)).toBeUndefined();
    });

    it("failed outcome 状态写回只保留 finalAssistant 和可选 ingest", () => {
        const finalAssistant = fakeAssistant([]);
        const outcome: FailedTurnOutcome = {
            kind: "failed",
            phase: "provider",
            errorInfo: {
                message: "provider failed",
                phase: "model",
            },
            finalAssistant,
        };

        expect(applyFailedTurnOutcome(outcome, {transcript: "persist"})).toEqual({
            finalAssistant,
            ingest: {transcript: "persist"},
        });
    });

    it("failed outcome 会归并成 failed run result 并保留结构化 errorInfo", () => {
        const finalAssistant = fakeAssistant([]);
        const outcome: FailedTurnOutcome = {
            kind: "failed",
            phase: "provider",
            errorInfo: {
                message: "provider failed",
                phase: "model",
            },
            finalAssistant,
        };
        const frame: RunFrame = {
            sessionId: 1,
            workspaceKey: "global",
            workspaceRoot: "workspace",
            systemPrompt: "",
            model: {} as RunFrame["model"],
            sessionContextEnabled: true,
            toolKeys: [],
            profileKey: "test",
            profile: {} as RunFrame["profile"],
            thinkingLevel: "off",
            runtimeState: new Map(),
            messages: [finalAssistant],
            finalAssistant,
            turnIndex: 1,
            reportResultReminderSent: false,
            reportResultReminderEnabled: false,
            pendingWritePlans: [],
        };

        expect(createFailedRunLoopResult(frame, outcome)).toEqual({
            status: "failed",
            finalAssistant,
            errorInfo: outcome.errorInfo,
            terminalStatus: "error",
        });
    });
});

function fakeAssistant(content: AssistantMessage["content"]): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: "test",
        provider: "test",
        model: "test",
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
            },
        },
        stopReason: "error",
        timestamp: 1,
    };
}
