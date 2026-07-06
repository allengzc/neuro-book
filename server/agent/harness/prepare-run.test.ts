import {describe, expect, it} from "vitest";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import {compilePrepareRunWritePlan} from "nbook/server/agent/harness/prepare-run";

describe("prepare run reducer", () => {
    it("session context 启用时会编译 HistorySet 和 AppendingSet 写入", () => {
        const init = createUserMessage({text: "INIT"});
        const append = createUserMessage({text: "APPEND"});
        const modelAppend = createUserMessage({text: "MODEL_APPEND"});

        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: true,
            prepared: {
                historyInitMessages: [init],
                appendingMessages: [append],
                modelContextAppendingMessages: [modelAppend],
            },
        });

        expect(plan).toMatchObject({
            target: {sessionId: 7},
            cause: "profile.prepare",
            ops: [{
                kind: "appendMany",
                entries: [
                    {type: "custom_message", message: init, visibleToModel: true},
                    {type: "custom_message", message: modelAppend, visibleToModel: true},
                    {type: "custom_message", message: append, visibleToModel: true},
                ],
            }],
        });
    });

    it("session context 关闭时只保留 profile 私有 stateWrites", () => {
        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: false,
            prepared: {
                historyInitMessages: [createUserMessage({text: "INIT"})],
                appendingMessages: [createUserMessage({text: "APPEND"})],
                stateWrites: [{
                    type: "custom",
                    key: "profileState.test.profile",
                    value: {ok: true},
                }],
            },
        });

        expect(plan?.ops).toEqual([{
            kind: "appendMany",
            entries: [{
                type: "custom",
                key: "profileState.test.profile",
                value: {ok: true},
            }],
        }]);
    });

    it("已有消息时不会再次写入 history init messages", () => {
        const plan = compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 1}),
            sessionContextEnabled: true,
            prepared: {
                historyInitMessages: [createUserMessage({text: "INIT"})],
            },
        });

        expect(plan).toBeUndefined();
    });

    it("拒绝 profile 写入非自身 state key", () => {
        expect(() => compilePrepareRunWritePlan({
            sessionId: 7,
            profileKey: "test.profile",
            context: fakeContext({messageCount: 0}),
            sessionContextEnabled: true,
            prepared: {
                stateWrites: [{
                    type: "custom",
                    key: "other",
                    value: null,
                }],
            },
        })).toThrow("stateWrites 只允许写 profileState.test.profile");
    });
});

function fakeContext(input: {messageCount: number}): NeuroSessionContext {
    return {
        sessionId: 7,
        profileKey: "test.profile",
        workspaceRoot: "workspace",
        workspaceKey: "global",
        systemPrompt: "",
        model: null,
        thinkingLevel: null,
        messages: Array.from({length: input.messageCount}, (_, index) => createUserMessage({text: `message-${index}`})),
        customState: {},
        linkedAgents: [],
        agentMode: "normal",
        archived: false,
    } as NeuroSessionContext;
}
