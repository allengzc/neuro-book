import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderRegistration} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {createAssistantTextMessage, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";

describe("NeuroAgentHarness", () => {
    let root: string;
    let faux: FauxProviderRegistration;
    let harness: NeuroAgentHarness;

    beforeEach(() => {
        root = join(".agent", "agent-harness-test", randomUUID());
        faux = registerFauxProvider({
            models: [{
                id: `faux-${randomUUID()}`,
                contextWindow: 128_000,
                maxTokens: 8_000,
            }],
        });
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
        });
    });

    afterEach(async () => {
        faux.unregister();
        await rm(root, {recursive: true, force: true});
    });

    it("create -> prompt -> report_result 会落地消息和结构化结果", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reporter",
                name: "Reporter",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("done"),
                fauxToolCall("report_result", {
                    result: "ok",
                    success: true,
                    data: {
                        paths: ["lorebook/foo/index.md"],
                    },
                }, {id: "report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.reporter",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(result.reportResult).toEqual({
            result: "ok",
            success: true,
            data: {
                paths: ["lorebook/foo/index.md"],
            },
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
    });

    it("approval 工具调用会停在 assistant tool call，resolution 后继续", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-reporter",
                name: "Approval Reporter",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done",
                    success: true,
                }, {id: "report-2"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-reporter",
            input: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });

        expect(waiting.status).toBe("waiting");
        const waitingContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(waitingContext.messages.map((message) => message.role)).toEqual(["user", "assistant"]);

        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-1",
                answers: [{questionIndex: 0, text: "Alice"}],
            },
        });

        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("done");
    });

    it("approval resolution 会先写 toolResult，再写 continue prepare 的 appending messages", async () => {
        let prepareCount = 0;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-appending",
                name: "Approval Appending",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                prepareCount++;
                return prepareCount > 1
                    ? {
                        appendingMessages: [createUserMessage({text: "APPENDING_AFTER_RESOLUTION"})],
                    }
                    : {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "继续？"}],
                }, {id: "ask-appending"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "done",
                    success: true,
                }, {id: "report-appending"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-appending",
            input: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-appending",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(continued.status).toBe("completed");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user", "assistant", "toolResult"]);
        expect(messageText(context.messages[2] as never)).toContain("继续");
        expect(messageText(context.messages[3] as never)).toBe("APPENDING_AFTER_RESOLUTION");
    });

    it("缺少 report_result 时会自动提醒一次并收集第二轮 report", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.must-report",
                name: "Must Report",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage(fauxText("plain answer")),
            fauxAssistantMessage([
                fauxText("retrying"),
                fauxToolCall("report_result", {
                    result: "fixed",
                    success: true,
                }, {id: "report-after-reminder"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.must-report",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(result.reportResult?.result).toBe("fixed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.some((message) => {
            if (message.role !== "user" || typeof message.content === "string") {
                return false;
            }
            return message.content.some((block) => block.type === "text" && block.text.includes("必须使用 report_result"));
        })).toBe(true);
    });

    it("未允许 report_result 的 agent 普通结束时不触发缺失 report 提醒", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("plain answer")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("plain answer");
        expect(result.reportResult).toBeUndefined();
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.every((message) => !messageText(message as never).includes("必须使用 report_result"))).toBe(true);
    });

    it("AppendingSet 写入 session 后不会在本轮 provider context 里重复出现", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.appending",
                name: "Appending Test",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {
                    appendingMessages: [createUserMessage({text: "APPENDING"})],
                };
            },
        }));
        faux.setResponses([
            (context) => {
                const texts = context.messages.map((message) => {
                    if (message.role === "user") {
                        return typeof message.content === "string"
                            ? message.content
                            : message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
                    }
                    return message.role;
                });
                return fauxAssistantMessage(fauxText(texts.join("|")));
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.appending",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });

        expect(result.finalMessage).toBe("APPENDING|PROMPT");
    });

    it("create_agent 会自动 link 到父 session，get_agent 无参返回当前拥有的 agent", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const owned = await harness.getAgent(undefined, parent.sessionId);

        expect(Array.isArray(owned)).toBe(true);
        expect(owned).toEqual([
            expect.objectContaining({
                sessionId: child.sessionId,
                profileKey: "leader.default",
            }),
        ]);

        await harness.detachAgent(child.sessionId, parent.sessionId);

        expect(await harness.getAgent(undefined, parent.sessionId)).toEqual([]);
    });

    it("session snapshot 暴露 linked agents、pending approval、plan/model/followUp 状态", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.snapshot-approval",
                name: "Snapshot Approval",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Name?"}],
                }, {id: "ask-snapshot"}),
            ], {stopReason: "toolUse"}),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.snapshot-approval",
            input: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const queued = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {
                text: "queued",
                images: [{
                    type: "image",
                    mimeType: "image/png",
                    data: "data:image/png;base64,AA==",
                }],
            },
        });

        const snapshot = await harness.getSessionSnapshot(parent.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(queued.status).toBe("waiting");
        expect(snapshot.pendingApproval).toEqual({
            toolCallId: "ask-snapshot",
            toolName: "request_user_input",
            args: {
                questions: [{question: "Name?"}],
            },
        });
        expect(snapshot.followUpQueue).toEqual([
            expect.objectContaining({
                message: {
                    text: "queued",
                    images: [{
                        type: "image",
                        mimeType: "image/png",
                        data: "data:image/png;base64,AA==",
                    }],
                },
            }),
        ]);
        expect(snapshot.linkedAgents).toEqual([
            expect.objectContaining({
                sessionId: child.sessionId,
                detached: false,
            }),
        ]);

        await expect(harness.runCommand(parent.sessionId, {
            command: "model",
            modelKey: null,
        })).rejects.toThrow("active_invocation_exists");
    });

    it("session command 和 tree API 支持 plan、archive、retry、tree+invoke", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("retry")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const beforeRetry = await harness.getSessionSnapshot(created.sessionId);
        const assistantEntry = beforeRetry.entries.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");

        await harness.runCommand(created.sessionId, {
            command: "plan",
            active: true,
        });
        expect((await harness.getSessionSnapshot(created.sessionId)).planModeActive).toBe(true);

        const moved = await harness.moveTree(created.sessionId, {
            targetEntryId: assistantEntry!.id,
            position: "before",
            next: {
                type: "invoke",
                mode: "continue",
            },
        });
        expect(moved.status).toBe("invoked");
        expect(moved.invocation?.finalMessage).toBe("retry");

        await harness.runCommand(created.sessionId, {
            command: "archive",
            reason: "done",
        });
        expect((await harness.getSessionSnapshot(created.sessionId)).summary.archived).toBe(true);
        expect(await harness.listSessions("global")).toEqual([]);
        expect(await harness.listSessions("global", true)).toHaveLength(1);
    });

    it("从用户消息刷新时保留该用户消息，并从其后继续生成", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("retry after user")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const beforeRetry = await harness.getSessionSnapshot(created.sessionId);
        const userEntry = beforeRetry.entries.find((entry) => entry.type === "message" && entry.message.role === "user");

        const moved = await harness.moveTree(created.sessionId, {
            targetEntryId: userEntry!.id,
            position: "at",
            next: {
                type: "invoke",
                mode: "continue",
            },
        });
        expect(moved.status).toBe("invoked");

        const afterRetry = await harness.getSessionSnapshot(created.sessionId);
        expect(afterRetry.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
        const activeText = afterRetry.messages.map((message) => JSON.stringify(message));
        expect(activeText[0]).toContain("run");
        expect(activeText[1]).toContain("retry after user");
    });

    it("linked agents 状态来自 session entry，重建 harness 后仍能 reduce", async () => {
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        await harness.detachAgent(child.sessionId, parent.sessionId);

        const nextHarness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
        });
        const owned = await nextHarness.getAgent(undefined, parent.sessionId);
        const session = await nextHarness.getSession(parent.sessionId);

        expect(owned).toEqual([]);
        expect(session.linkedAgents).toEqual([
            expect.objectContaining({
                sessionId: child.sessionId,
                status: "detached",
            }),
        ]);
    });

    it("get_session 返回轻量 session 查询结果", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "hello session"}));

        const session = await harness.getSession(created.sessionId);

        expect(session.metadata.sessionId).toBe(created.sessionId);
        expect(session.activeLeafId).toEqual(expect.any(String));
        expect(session.tree.length).toBeGreaterThan(0);
        expect(session.recentMessages).toEqual([
            expect.objectContaining({
                role: "user",
                text: "hello session",
            }),
        ]);
    });

    it("profile ingest 可以追加消息和 title/summary", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.ingest",
                name: "Ingest Test",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
            ingest() {
                return {
                    messageWrites: [createAssistantTextMessage({text: "ingested"})],
                    sessionUpdates: {
                        title: "Ingested Title",
                        summary: "Ingested Summary",
                    },
                };
            },
        }));
        faux.setResponses([
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.ingest",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const session = await harness.getSession(created.sessionId);

        expect(result.status).toBe("completed");
        expect(session.title).toBe("Ingested Title");
        expect(session.summary).toBe("Ingested Summary");
        expect(session.recentMessages.map((message) => message.text)).toContain("ingested");
    });

    it("profile ingest 返回越权字段时 run 报错且不写部分结果", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.bad-ingest",
                name: "Bad Ingest",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
            ingest() {
                return {
                    messageWrites: [createAssistantTextMessage({text: "should not write"})],
                    profileKey: "other",
                } as never;
            },
        }));
        faux.setResponses([
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.bad-ingest",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const session = await harness.getSession(created.sessionId);

        expect(result.status).toBe("error");
        expect(result.error).toContain("profileKey");
        expect(session.recentMessages.every((message) => message.text !== "should not write")).toBe(true);
    });

    it("不可见 skill 返回工具错误，不进入 waiting", async () => {
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("skill", {
                    skillKey: "missing-skill",
                }, {id: "skill-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("after error")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "activate"},
        });

        expect(result.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.some((message) => message.role === "toolResult" && message.isError)).toBe(true);
    });

    it("compact command 使用真实 provider 摘要并且命令不写成普通 user message", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("COMPACTED")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old context"}));

        const result = await harness.runCommand(created.sessionId, {
            command: "compact",
            instructions: "prefer concise",
        });
        await waitFor(async () => {
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(context.messages[0] && messageText(context.messages[0] as never)).toContain("COMPACTED");
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("started");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "user"]);
        expect(context.messages[0] && messageText(context.messages[0] as never)).toContain("COMPACTED");
        expect(context.messages.every((message) => !messageText(message as never).includes("/compact"))).toBe(true);
    });
});

async function waitFor(assertion: () => Promise<void> | void, timeoutMs = 1_000): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error(String(lastError));
}
