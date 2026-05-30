import {describe, expect, it} from "vitest";
import {createAssistantTextMessage, createTextToolResult} from "nbook/server/agent/messages/message-utils";
import type {RunFrame, RuntimeTurn, TurnSnapshot} from "nbook/server/agent/harness/run-kernel-types";
import {applyFailedTurn, applySuccessfulTurn, createRunFrame} from "nbook/server/agent/harness/run-frame-state";

describe("run frame state", () => {
    it("创建 RunFrame 时会固定默认运行态，并浅拷贝初始 messages", () => {
        const message = createAssistantTextMessage({text: "seed"});
        const messages = [message];
        const runtimeState = new Map();
        const onEvent = () => undefined;

        const frame = createRunFrame({
            invocationId: "invoke-1",
            sessionId: 1,
            workspaceKey: "global",
            workspaceRoot: "workspace",
            projectPath: "project",
            systemPrompt: "system",
            messages,
            model: {} as RunFrame["model"],
            apiKey: "key",
            timeoutMs: 1000,
            requestOptions: {temperature: 0},
            toolKeys: ["report_result"],
            profileKey: "test",
            profile: {} as RunFrame["profile"],
            thinkingLevel: "off",
            runtimeState,
            reportResultReminderEnabled: true,
            onEvent,
        });

        expect(frame).toMatchObject({
            invocationId: "invoke-1",
            sessionId: 1,
            workspaceKey: "global",
            workspaceRoot: "workspace",
            projectPath: "project",
            systemPrompt: "system",
            apiKey: "key",
            timeoutMs: 1000,
            requestOptions: {temperature: 0},
            toolKeys: ["report_result"],
            profileKey: "test",
            thinkingLevel: "off",
            turnIndex: 0,
            reportResultReminderSent: false,
            reportResultReminderEnabled: true,
            automaticCompactionEnabled: false,
            pendingWritePlans: [],
        });
        expect(frame.messages).toEqual([message]);
        expect(frame.messages).not.toBe(messages);
        expect(frame.runtimeState).toBe(runtimeState);
        expect(frame.onEvent).toBe(onEvent);
    });

    it("成功 turn 会写回 assistant、tool results、report_result 和 ingest 状态", () => {
        const frame = fakeFrame();
        const assistant = createAssistantTextMessage({text: "done"});
        const toolResult = createTextToolResult({
            toolCallId: "tool-1",
            toolName: "report_result",
            text: "ok",
        });
        const turn: RuntimeTurn = {
            index: 1,
            snapshot: {} as TurnSnapshot,
            assistant,
            toolCalls: [],
            toolResults: [toolResult],
            reportResult: {
                result: "walkthrough",
            },
            shouldContinue: false,
        };

        applySuccessfulTurn(frame, turn, {transcript: "persist"});

        expect(frame.finalAssistant).toBe(assistant);
        expect(frame.messages).toEqual([assistant, toolResult]);
        expect(frame.reportResult).toEqual({result: "walkthrough"});
        expect(frame.lastTurnIngest).toEqual({transcript: "persist"});
    });

    it("没有新 report_result 时保留已有 report_result", () => {
        const frame = fakeFrame();
        frame.reportResult = {result: "existing"};
        const assistant = createAssistantTextMessage({text: "done"});

        applySuccessfulTurn(frame, {
            index: 1,
            snapshot: {} as TurnSnapshot,
            assistant,
            toolCalls: [],
            toolResults: [],
            shouldContinue: false,
        }, {transcript: "runtime_only"});

        expect(frame.reportResult).toEqual({result: "existing"});
        expect(frame.lastTurnIngest).toEqual({transcript: "runtime_only"});
    });

    it("失败 outcome 会写回 finalAssistant，并可记录 partial ingest 状态", () => {
        const frame = fakeFrame();
        const finalAssistant = createAssistantTextMessage({
            text: "",
            stopReason: "error",
        });
        const turn = {
            finalAssistant,
        };

        applyFailedTurn(frame, {
            ...turn,
            ingest: {transcript: "persist"},
        });

        expect(frame.finalAssistant).toBe(finalAssistant);
        expect(frame.messages).toEqual([finalAssistant]);
        expect(frame.lastTurnIngest).toEqual({transcript: "persist"});
    });
});

function fakeFrame(): RunFrame {
    return {
        sessionId: 1,
        workspaceKey: "global",
        workspaceRoot: "workspace",
        systemPrompt: "",
        model: {} as RunFrame["model"],
        toolKeys: [],
        profileKey: "test",
        profile: {} as RunFrame["profile"],
        thinkingLevel: "off",
        runtimeState: new Map(),
        messages: [],
        turnIndex: 0,
        reportResultReminderSent: false,
        reportResultReminderEnabled: false,
        automaticCompactionEnabled: false,
        pendingWritePlans: [],
    };
}
