import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxToolCall, registerFauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderRegistration} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentMessage, JsonValue, Message as RuntimeMessage} from "nbook/server/agent/messages/types";

describe("NeuroAgentHarness invocation payload", () => {
    let root: string;
    let faux: FauxProviderRegistration;
    let harness: NeuroAgentHarness;

    beforeEach(() => {
        root = resolve(".agent", "agent-harness-payload-test", randomUUID());
        faux = registerFauxProvider();
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("createAgent 按 InitialSchema 校验 initial", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.initial-required",
                name: "Initial Required",
            },
            initialSchema: Type.Object({
                topic: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);

        await expect(harness.createAgent({
            profileKey: "test.initial-required",
            initial: {},
            workspaceRoot: root,
        })).rejects.toThrow("initial 校验失败");
    }, 20_000);

    it("prompt 可以只传 payload，并按 PayloadSchema 校验后进入 ctx.invocation.payload", async () => {
        let observedMessage: string | undefined;
        let observedPayload: JsonValue | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.payload-aware",
                name: "Payload Aware",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare(ctx) {
                observedMessage = ctx.invocation?.message;
                observedPayload = ctx.invocation?.payload;
                return {
                    systemPrompt: `payload=${ctx.invocation?.payload?.plotId}; message=${ctx.invocation?.message}`,
                    appendingMessages: [createUserMessage({
                        text: `prepared payload=${ctx.invocation?.payload?.plotId}; message=${ctx.invocation?.message}`,
                    })],
                };
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({
            profileKey: "test.payload-aware",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            payload: {plotId: "plot-1"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedMessage).toBeUndefined();
        expect(observedPayload).toEqual({plotId: "plot-1"});
        expect(visibleText(context.messages)).toContain("prepared payload=plot-1");
        expect(visibleText(context.messages)).toContain("message=undefined");
        expect(visibleText(context.messages)).toContain("<payload>");
        expect(visibleText(context.messages)).toContain("\"plotId\": \"plot-1\"");
    }, 20_000);

    it("message + payload 时 ctx.invocation.message 保留原始自然语言", async () => {
        let observedMessage: string | undefined;
        let observedPayload: JsonValue | undefined;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.message-payload",
                name: "Message Payload",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare(ctx) {
                observedMessage = ctx.invocation?.message;
                observedPayload = ctx.invocation?.payload;
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage("ok")]);
        const created = await harness.createAgent({
            profileKey: "test.message-payload",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "请继续"},
            payload: {plotId: "plot-1"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedMessage).toBe("请继续");
        expect(observedPayload).toEqual({plotId: "plot-1"});
        expect(visibleText(context.messages)).toContain("请继续");
        expect(visibleText(context.messages)).toContain("<payload>");
        expect(visibleText(context.messages)).toContain("\"plotId\": \"plot-1\"");
    }, 20_000);

    it("没有 PayloadSchema 的 profile 收到 payload 时返回明确错误", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-payload",
                name: "No Payload",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.no-payload",
            initial: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            payload: {plotId: "plot-1"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("PayloadSchema");
    }, 20_000);

    it("payload 校验失败和 continue 携带 payload 都会拒绝", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.payload-contract",
                name: "Payload Contract",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.payload-contract",
            initial: {},
            workspaceRoot: root,
        });

        const invalidPayload = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            payload: {plotId: 1},
        });
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            payload: {plotId: "plot-1"},
        })).rejects.toThrow("continue 模式不能提供 message 或 input");

        expect(invalidPayload.status).toBe("error");
        expect(invalidPayload.error).toContain("payload 校验失败");
    }, 20_000);

    it("running followup 入队前会校验 payload，失败时不污染队列", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.followup-queued-payload",
                name: "Followup Queued Payload",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys(["request_user_input"]),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "ask-followup-payload"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.followup-queued-payload",
            initial: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            payload: {plotId: 1},
        })).rejects.toThrow("payload 校验失败");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(snapshot.followUpQueue.items).toEqual([]);
    }, 20_000);

    it("running steer 入队前会校验 payload，失败时不污染队列", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.steer-queued-payload",
                name: "Steer Queued Payload",
            },
            initialSchema: Type.Object({}),
            payloadSchema: Type.Object({
                plotId: Type.String(),
            }),
            tools: profileToolsFromKeys(["request_user_input"]),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "ask-steer-payload"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.steer-queued-payload",
            initial: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            payload: {plotId: 1},
        })).rejects.toThrow("payload 校验失败");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(snapshot.steerQueue).toEqual([]);
    }, 20_000);
});

function visibleText(messages: AgentMessage[]): string {
    return messages
        .filter((message): message is RuntimeMessage => message.role !== "custom")
        .map(messageText)
        .join("\n");
}
