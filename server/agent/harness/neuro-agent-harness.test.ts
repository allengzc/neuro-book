import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderRegistration} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {Value} from "typebox/value";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import simulatorActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile";
import {createAssistantTextMessage, createTextToolResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {HistorySet, Message, ModelContext, ProfilePrompt, Reminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {AgentMessage, Message as RuntimeMessage} from "nbook/server/agent/messages/types";
import {AGENT_PLAN_MODE_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {defineSessionVariable} from "nbook/server/agent/variables/registry";

function visibleMessageText(messages: AgentMessage[]): string {
    return messages
        .filter((message): message is RuntimeMessage => message.role !== "custom")
        .map(messageText)
        .join("\n");
}

async function waitForSessionText(harness: NeuroAgentHarness, sessionId: number, text: string): Promise<ReturnType<JsonlSessionRepository["reduce"]>> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        if (visibleMessageText(context.messages).includes(text)) {
            return context;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return harness.repo.reduce(await harness.repo.readSession(sessionId));
}

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
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.drainBackgroundTasks();
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
            data: {
                paths: ["lorebook/foo/index.md"],
            },
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
    });

    it("report_result 校验失败后会继续下一轮让模型修正", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reporter-retry",
                name: "Reporter Retry",
            },
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "invalid data",
                    data: {
                        title: {},
                    },
                }, {id: "bad-report"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                expect(visibleMessageText(context.messages)).toContain("Validation failed for tool \"report_result\"");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "fixed",
                        data: {
                            title: "Fixed",
                        },
                    }, {id: "fixed-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.reporter-retry",
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
            result: "fixed",
            data: {
                title: "Fixed",
            },
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
    });

    it("新建 session snapshot 会展示 profile system prompt 且不触发动态提醒", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.snapshot-system",
                name: "Snapshot System",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        System({children: "# Snapshot System\n\n只读展示。"}),
                        ModelContext({
                            children: Reminder({
                                id: "should-not-render",
                                children: Message({children: "DYNAMIC_REMINDER"}),
                            }),
                        }),
                    ],
                });
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.snapshot-system",
            input: {},
            workspaceRoot: root,
        });

        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        const session = await harness.repo.readSession(created.sessionId);

        expect(snapshot.systemPrompt).toBe("# Snapshot System\n\n只读展示。");
        expect(session.entries.some((entry) => {
            return entry.type === "custom_message" && messageText(entry.message as never) === "DYNAMIC_REMINDER";
        })).toBe(false);
    });

    it("新建 Project session 的 agent cwd 使用 Workspace Root 并保留 projectPath", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.workspace-container",
                name: "Workspace Container",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);

        const created = await harness.createAgent({
            profileKey: "test.workspace-container",
            input: {},
            workspaceRoot: "workspace/novel-7",
            workspaceKey: "workspace/novel-7",
            projectPath: "workspace/novel-7",
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(context.workspaceRoot).toBe("workspace");
        expect(context.projectPath).toBe("workspace/novel-7");
    });

    it("/new 创建的新 session 保留 Workspace Root 和 projectPath", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace/novel-7",
            workspaceKey: "workspace/novel-7",
            projectPath: "workspace/novel-7",
        });

        const result = await harness.runCommand(created.sessionId, {
            command: "new",
        });
        const context = harness.repo.reduce(await harness.repo.readSession(result.sessionId));

        expect(context.workspaceRoot).toBe("workspace");
        expect(context.projectPath).toBe("workspace/novel-7");
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

    it("新 harness 能从 session active path 恢复 waiting 并复用 invocationId continue", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-reload",
                name: "Approval Reload",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-reload"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done after reload",
                }, {id: "report-reload"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-reload",
            input: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const reloadedSnapshot = await restored.getSessionSnapshot(created.sessionId);
        const reloadedSessions = await restored.listSessions({workspaceKey: "global"});
        const waitingSessions = await restored.listSessions({workspaceKey: "global", status: "waiting"});
        const idleSessions = await restored.listSessions({workspaceKey: "global", status: "idle"});
        const continued = await restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-reload",
                answers: [{questionIndex: 0, text: "Alice"}],
            },
        });
        await restored.drainBackgroundTasks();

        expect(waiting.status).toBe("waiting");
        expect(reloadedSnapshot.summary.status).toBe("waiting");
        expect(reloadedSessions).toContainEqual(expect.objectContaining({
            sessionId: created.sessionId,
            status: "waiting",
        }));
        expect(waitingSessions.map((session) => session.sessionId)).toContain(created.sessionId);
        expect(idleSessions.map((session) => session.sessionId)).not.toContain(created.sessionId);
        expect(reloadedSnapshot.activeInvocation).toEqual(expect.objectContaining({
            invocationId: waiting.invocationId,
            status: "waiting",
            mode: "continue",
        }));
        expect(continued.invocationId).toBe(waiting.invocationId);
        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("done after reload");
    });

    it("后端恢复 waiting 后并发 resolution 只能有一个 claim 成功", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-concurrent-reload",
                name: "Approval Concurrent Reload",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-concurrent-reload"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done after concurrent reload",
                }, {id: "report-concurrent-reload"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-concurrent-reload",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const resolution = {
            kind: "user_input" as const,
            toolCallId: "ask-concurrent-reload",
            answers: [{questionIndex: 0, text: "Alice"}],
        };
        const results = await Promise.allSettled([
            restored.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution,
            }),
            restored.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution,
            }),
        ]);
        await restored.drainBackgroundTasks();

        const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<NeuroAgentHarness["invokeAgent"]>>> => result.status === "fulfilled");
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        const snapshot = await restored.repo.readSession(created.sessionId);
        const context = restored.repo.reduce(snapshot);
        const resolutionMessages = context.messages.filter((message) => message.role === "toolResult" && messageText(message as never).includes("Alice"));
        const resumedLifecycles = snapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.invocationId === waiting.invocationId && entry.status === "resumed");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(String(rejected[0]?.reason instanceof Error ? rejected[0].reason.message : rejected[0]?.reason)).toContain("waiting_invocation_not_recoverable");
        expect(fulfilled[0]?.value.invocationId).toBe(waiting.invocationId);
        expect(resolutionMessages).toHaveLength(1);
        expect(resumedLifecycles).toHaveLength(1);
    });

    it("pending approval 没有可靠 waiting lifecycle 时拒绝 resolution", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-unrecoverable",
                name: "Approval Unrecoverable",
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
                    questions: [{question: "继续？"}],
                }, {id: "ask-unrecoverable"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-unrecoverable",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: waiting.invocationId,
            status: "resumed",
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });

        await expect(restored.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-unrecoverable",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        })).rejects.toThrow("waiting_invocation_not_recoverable");
        await restored.drainBackgroundTasks();
    });

    it("新 harness 恢复出的 waiting 可以 abort", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-reload-abort",
                name: "Approval Reload Abort",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Wait?"}],
                }, {id: "ask-reload-abort"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-reload-abort",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const aborted = await restored.abortInvocation(created.sessionId, {reason: "stop after reload"});
        const snapshot = await restored.getSessionSnapshot(created.sessionId);
        await restored.drainBackgroundTasks();

        expect(waiting.status).toBe("waiting");
        expect(aborted.status).toBe("aborted");
        expect(snapshot.activeInvocation).toBeNull();
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            invocationId: waiting.invocationId,
            status: "aborted",
        }));
    });

    it("后端恢复 waiting 后 abort 和 resolution 并发只能有一个 claim 成功", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.approval-abort-resolution-race",
                name: "Approval Abort Resolution Race",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input", "report_result"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "给一个名字"}],
                }, {id: "ask-abort-resolution-race"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxText("received"),
                fauxToolCall("report_result", {
                    result: "done after abort resolution race",
                }, {id: "report-abort-resolution-race"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-abort-resolution-race",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);

        const results = await Promise.allSettled([
            restored.abortInvocation(created.sessionId, {reason: "stop while answering"}),
            restored.invokeAgent({
                sessionId: created.sessionId,
                mode: "continue",
                resolution: {
                    kind: "user_input",
                    toolCallId: "ask-abort-resolution-race",
                    answers: [{questionIndex: 0, text: "Alice"}],
                },
            }),
        ]);
        await restored.drainBackgroundTasks();

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        const snapshot = await restored.repo.readSession(created.sessionId);
        const context = restored.repo.reduce(snapshot);
        const resolutionMessages = context.messages.filter((message) => {
            return message.role === "toolResult" && message.toolCallId === "ask-abort-resolution-race";
        });
        const terminalLifecycles = snapshot.entries.filter((entry) => {
            return entry.type === "invocation_lifecycle"
                && entry.invocationId === waiting.invocationId
                && (entry.status === "resumed" || entry.status === "aborted");
        });

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(resolutionMessages).toHaveLength(1);
        expect(terminalLifecycles).toHaveLength(1);
    });

    it("新 harness 对未完成普通 running snapshot 投影为 interrupted", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendEntry(created.sessionId, {
            type: "invocation_lifecycle",
            invocationId: "lost-running",
            status: "start",
        });
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });

        const snapshot = await restored.getSessionSnapshot(created.sessionId);

        expect(snapshot.summary.status).toBe("interrupted");
        expect(snapshot.activeInvocation).toBeNull();
    });

    it("approval 后面的普通 tool call 会被显式跳过并保留 pending approval", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-batch-barrier",
                name: "Approval Batch Barrier",
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
                    questions: [{question: "继续？"}],
                }, {id: "ask-barrier"}),
                fauxToolCall("report_result", {
                    result: "should wait",
                }, {id: "report-after-approval"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "done after approval",
                }, {id: "report-after-resolution"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-batch-barrier",
            input: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const streamedToolResults: string[] = [];
        const collect = (async () => {
            for await (const event of subscription) {
                if (event.kind === "runtime" && event.event.type === "message_start" && event.event.message.role === "toolResult") {
                    streamedToolResults.push(messageText(event.event.message));
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    break;
                }
            }
        })();

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "need input"},
        });
        await collect;

        expect(waiting.status).toBe("waiting");
        const waitingContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(waitingContext.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(messageText(waitingContext.messages[2] as never)).toContain("waiting for user approval");
        expect(streamedToolResults).toHaveLength(1);
        expect(streamedToolResults[0]).toContain("waiting for user approval");
        expect(await harness.getSessionSnapshot(created.sessionId)).toEqual(expect.objectContaining({
            pendingApproval: expect.objectContaining({
                toolCallId: "ask-barrier",
                toolName: "request_user_input",
            }),
        }));

        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-barrier",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });

        expect(continued.status).toBe("completed");
        expect(continued.reportResult?.result).toBe("done after approval");
    });

    it("拒绝把旧的未闭合普通 tool call 发送给 provider", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.interrupted-tool",
                name: "Interrupted Tool",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([fauxAssistantMessage(fauxText("should not run"))]);
        const created = await harness.createAgent({
            profileKey: "test.interrupted-tool",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old prompt"}));
        await harness.repo.appendMessage(created.sessionId, fauxAssistantMessage([
            fauxToolCall("read", {
                path: "novel-7/AGENTS.md",
            }, {id: "stale-read"}),
        ], {stopReason: "toolUse"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "continue"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("未闭合普通 tool call");
        const persisted = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(persisted.messages.some((message) => message.role === "toolResult" && message.toolCallId === "stale-read")).toBe(false);
    });

    it("普通 tool turn 到 turn_end 才成组写入 session", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.turn-commit",
                name: "Turn Commit",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["get_session"],
            prepare() {
                return {};
            },
        }), false);
        const snapshotsByEvent: Array<{event: string; roles: string[]}> = [];
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("get_session", {}, {id: "get-session-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.turn-commit",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
            onEvent: async (event) => {
                if (event.type !== "message_end" && event.type !== "turn_end") {
                    return;
                }
                const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
                const eventLabel = event.type === "message_end"
                    ? `${event.type}:${event.message.role}:${event.message.role === "assistant" && event.message.content.some((block) => block.type === "toolCall") ? "toolCall" : "plain"}`
                    : event.type;
                snapshotsByEvent.push({
                    event: eventLabel,
                    roles: context.messages.map((message) => message.role),
                });
            },
        });

        expect(result.status).toBe("completed");
        expect(snapshotsByEvent).toEqual([
            {event: "message_end:assistant:toolCall", roles: ["user"]},
            {event: "message_end:toolResult:plain", roles: ["user"]},
            {event: "turn_end", roles: ["user", "assistant", "toolResult"]},
            {event: "message_end:assistant:plain", roles: ["user", "assistant", "toolResult"]},
            {event: "turn_end", roles: ["user", "assistant", "toolResult", "assistant"]},
        ]);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; message?: {role?: string}}>});
        const turnBatches = records
            .filter((record) => record.kind === "batch")
            .map((record) => record.entries?.filter((entry) => entry.type === "message").map((entry) => entry.message?.role));
        expect(turnBatches).toEqual([
            ["assistant", "toolResult"],
            ["assistant"],
        ]);
    });

    it("tool savePoint writes 会在 transcript 后 flush，不插入 assistant/toolResult 中间", async () => {
        harness.tools.register({
            key: "save_point_state",
            name: "save_point_state",
            label: "Save Point State",
            description: "Writes custom state at turn save point.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "missing context"}],
                    details: {},
                    terminate: true,
                };
            },
            async executeWithContext(context) {
                context.sessionWrites?.savePointCustomState("test.savePointState", "test.tool.savePoint", "queued");
                return {
                    content: [{type: "text", text: "queued"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.tool-save-point",
                name: "Tool Save Point",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["save_point_state"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("save_point_state", {}, {id: "save-point-state-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.tool-save-point",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(snapshot);

        expect(result.status).toBe("completed");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(context.customState["test.tool.savePoint"]).toBe("queued");

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; key?: string; message?: {role?: string}}>});
        const batchEntries = records
            .filter((record) => record.kind === "batch")
            .flatMap((record) => record.entries ?? [])
            .filter((entry) => entry.type !== "leaf");
        expect(batchEntries.map((entry) => entry.type === "message" ? entry.message?.role : entry.key)).toEqual([
            "assistant",
            "toolResult",
            "test.tool.savePoint",
        ]);
    });

    it("parallel 工具会并发执行，但 toolResult 和 savePoint writes 按 tool call 顺序落盘", async () => {
        const releases = new Map<string, () => void>();
        const started: string[] = [];
        harness.tools.register({
            key: "parallel_save_point",
            name: "parallel_save_point",
            label: "Parallel Save Point",
            description: "Parallel test tool.",
            executionMode: "parallel",
            parameters: Type.Object({
                name: Type.String(),
            }),
            async executeWithContext(context, _toolCallId, params: unknown) {
                const input = params as {name: string};
                started.push(input.name);
                await new Promise<void>((resolve) => releases.set(input.name, resolve));
                context.sessionWrites?.savePointCustomState(`test.parallel.${input.name}`, `test.parallel.${input.name}`, input.name);
                return {
                    content: [{type: "text", text: input.name}],
                    details: {},
                    terminate: true,
                };
            },
            async execute() {
                throw new Error("parallel_save_point 需要 context。");
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.parallel-tools",
                name: "Parallel Tools",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["parallel_save_point"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("parallel_save_point", {name: "first"}, {id: "parallel-first"}),
                fauxToolCall("parallel_save_point", {name: "second"}, {id: "parallel-second"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.parallel-tools",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        let result: Awaited<ReturnType<NeuroAgentHarness["invokeAgent"]>>;
        try {
            await waitFor(() => expect(started).toHaveLength(2));
            releases.get("second")?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
            releases.get("first")?.();
            result = await running;
        } catch (error) {
            releases.get("first")?.();
            releases.get("second")?.();
            await running.catch(() => undefined);
            throw error;
        }

        expect(result.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.messages.filter((message) => message.role === "toolResult").map(messageText)).toEqual(["first", "second"]);

        const sessionPath = join(root, ".nbook", "agent", "sessions", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; key?: string; message?: {role?: string}}>});
        const batchEntries = records
            .filter((record) => record.kind === "batch")
            .flatMap((record) => record.entries ?? [])
            .filter((entry) => entry.type !== "leaf");
        expect(batchEntries.map((entry) => entry.type === "message" ? entry.message?.role : entry.key)).toEqual([
            "assistant",
            "toolResult",
            "toolResult",
            "test.parallel.first",
            "test.parallel.second",
        ]);
    });

    it("同一 segment 混入 sequential 工具时整段串行", async () => {
        const started: string[] = [];
        harness.tools.register({
            key: "parallel_marker",
            name: "parallel_marker",
            label: "Parallel Marker",
            description: "Parallel marker.",
            executionMode: "parallel",
            parameters: Type.Object({
                name: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                started.push((params as {name: string}).name);
                return {
                    content: [{type: "text", text: (params as {name: string}).name}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.tools.register({
            key: "sequential_gate",
            name: "sequential_gate",
            label: "Sequential Gate",
            description: "Sequential gate.",
            executionMode: "sequential",
            parameters: Type.Object({}),
            async execute() {
                started.push("gate");
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    content: [{type: "text", text: "gate"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sequential-segment",
                name: "Sequential Segment",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["parallel_marker", "sequential_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("parallel_marker", {name: "first"}, {id: "marker-first"}),
                fauxToolCall("sequential_gate", {}, {id: "gate"}),
                fauxToolCall("parallel_marker", {name: "second"}, {id: "marker-second"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sequential-segment",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(started).toEqual(["first", "gate", "second"]);
    });

    it("harness toolExecution=sequential 会强制 parallel 工具串行执行", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
            toolExecution: "sequential",
        });
        const releases = new Map<string, () => void>();
        const started: string[] = [];
        harness.tools.register({
            key: "parallel_gate",
            name: "parallel_gate",
            label: "Parallel Gate",
            description: "Parallel gate.",
            executionMode: "parallel",
            parameters: Type.Object({
                name: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                const name = (params as {name: string}).name;
                started.push(name);
                await new Promise<void>((resolve) => releases.set(name, resolve));
                return {
                    content: [{type: "text", text: name}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.global-sequential-tools",
                name: "Global Sequential Tools",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["parallel_gate"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("parallel_gate", {name: "first"}, {id: "global-first"}),
                fauxToolCall("parallel_gate", {name: "second"}, {id: "global-second"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.global-sequential-tools",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        try {
            await waitFor(() => expect(started).toEqual(["first"]));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(started).toEqual(["first"]);
            releases.get("first")?.();
            await waitFor(() => expect(started).toEqual(["first", "second"]));
            releases.get("second")?.();
            const result = await running;
            expect(result.status).toBe("completed");
        } catch (error) {
            releases.get("first")?.();
            releases.get("second")?.();
            await running.catch(() => undefined);
            throw error;
        }
    });

    it("自动 compaction 在下一轮 turn 前执行，并影响下一轮 provider context", async () => {
        const providerPrompts: string[] = [];
        harness.tools.register({
            key: "force_continue",
            name: "force_continue",
            label: "Force Continue",
            description: "Forces another turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.compact-before-next-turn",
                name: "Compact Before Next Turn",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["force_continue"],
            compaction: {
                triggerTokens: 1,
                keepRecentTokens: 1,
            },
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Message({children: "HISTORY AFTER AUTO COMPACT"})}),
                    ],
                });
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("force_continue", {}, {id: "force-continue-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage(fauxText("COMPACT SUMMARY")),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.compact-before-next-turn",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "OLD CONTEXT"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("OLD CONTEXT");
        expect(providerPrompts[1]).toContain("COMPACT SUMMARY");
        expect(providerPrompts[1]).toContain("HISTORY AFTER AUTO COMPACT");
        expect(providerPrompts[1]).not.toContain("OLD CONTEXT");
        expect(context.messages[0] && messageText(context.messages[0] as never)).toContain("COMPACT SUMMARY");
    });

    it("自定义 runtime 有 profile compaction 配置时仍会自动 compaction", async () => {
        const providerPrompts: string[] = [];
        harness.tools.register({
            key: "force_continue_no_compact",
            name: "force_continue_no_compact",
            label: "Force Continue No Compact",
            description: "Forces another turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-compact-runtime",
                name: "No Compact Runtime",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["force_continue_no_compact"],
            compaction: {
                triggerTokens: 1,
                keepRecentTokens: 1,
            },
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            context() {
                return (
                    ProfilePrompt({
                        children: [
                            HistorySet({children: Message({children: "HISTORY AFTER COMPACT"})}),
                        ],
                    })
                );
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("force_continue_no_compact", {}, {id: "force-continue-no-compact-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage(fauxText("CUSTOM RUNTIME SUMMARY")),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done with compact");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-compact-runtime",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "OLD CONTEXT"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(result.status).toBe("completed");
        expect(providerPrompts).toHaveLength(2);
        expect(providerPrompts[1]).toContain("CUSTOM RUNTIME SUMMARY");
        expect(providerPrompts[1]).not.toContain("HISTORY AFTER COMPACT");
        expect(providerPrompts[1]).not.toContain("OLD CONTEXT");
        expect(snapshot.entries.some((entry) => entry.type === "compaction")).toBe(true);
        expect(snapshot.entries.filter((entry) => entry.type === "custom_message" && messageText(entry.message as RuntimeMessage).includes("HISTORY AFTER COMPACT"))).toHaveLength(0);
        expect(faux.getPendingResponseCount()).toBe(0);
    });

    it("没有 compaction 配置且上下文超出模型窗口时 run 失败", async () => {
        const smallWindowHarness = new NeuroAgentHarness({
            repo: harness.repo,
            modelResolver: () => ({
                ...faux.getModel(),
                contextWindow: 1,
            }),
            enableSessionSummarizer: false,
        });
        harness = smallWindowHarness;
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-compaction-overflow",
                name: "No Compaction Overflow",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.no-compaction-overflow",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "this will exceed the tiny window"},
        });

        expect(result.status).toBe("error");
        expect(result.errorInfo?.message).toContain("未声明 compaction 配置");
        expect(result.errorInfo?.message).toContain("超过模型");
    });

    it("profile reasoningEffort 会传给支持 reasoning 的模型", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            agent: {
                profiles: {
                    "test.reasoning": {
                        model: {
                            reasoningEffort: "high",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.reasoning",
                name: "Reasoning",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        let observedReasoning: unknown;
        faux.setResponses([
            (_context, options) => {
                observedReasoning = (options as {reasoning?: unknown} | undefined)?.reasoning;
                return fauxAssistantMessage(fauxText("done"));
            },
        ]);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => ({
                ...faux.getModel(),
                reasoning: true,
            }),
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.reasoning",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedReasoning).toBe("high");
    });

    it("session thinking 覆盖能显式关闭并回到 profile 默认", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            agent: {
                profiles: {
                    "test.session-thinking": {
                        model: {
                            reasoningEffort: "high",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.session-thinking",
                name: "Session Thinking",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const observedReasoning: unknown[] = [];
        faux.setResponses([
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("profile default"));
            },
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("off override"));
            },
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("minimal override"));
            },
            (_context, options) => {
                observedReasoning.push((options as {reasoning?: unknown} | undefined)?.reasoning);
                return fauxAssistantMessage(fauxText("back to profile"));
            },
        ]);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => ({
                ...faux.getModel(),
                reasoning: true,
            }),
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.session-thinking",
            input: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "profile"},
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "off",
        });
        expect(await harness.getSessionSnapshot(created.sessionId)).toMatchObject({
            thinkingLevel: "off",
            effectiveThinkingLevel: "off",
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "off"},
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "minimal",
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "minimal"},
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: null,
        });
        expect(await harness.getSessionSnapshot(created.sessionId)).toMatchObject({
            thinkingLevel: null,
            effectiveThinkingLevel: "high",
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "profile again"},
        });

        expect(observedReasoning).toEqual(["high", undefined, "minimal", "high"]);
    });

    it("snapshot 会暴露模型能力裁剪后的 effective thinking", async () => {
        await mkdir(join(root, ".nbook"), {recursive: true});
        await writeFile(join(root, ".nbook", "config.json"), JSON.stringify({
            agent: {
                profiles: {
                    "test.snapshot-thinking": {
                        model: {
                            reasoningEffort: "high",
                        },
                    },
                },
            },
        }, null, 4), "utf8");
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.snapshot-thinking",
                name: "Snapshot Thinking",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => ({
                ...faux.getModel(),
                reasoning: false,
            }),
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.snapshot-thinking",
            input: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "thinking",
            thinkingLevel: "xhigh",
        });

        expect(await harness.getSessionSnapshot(created.sessionId)).toMatchObject({
            thinkingLevel: "xhigh",
            effectiveThinkingLevel: "off",
        });
    });

    it("snapshot 没有可解析模型时 effective thinking 回落为 off", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-model",
                name: "No Model",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: () => {
                throw new Error("配置未设置 models.default");
            },
            enableSessionSummarizer: false,
        });
        const created = await harness.createAgent({
            profileKey: "test.no-model",
            input: {},
            workspaceRoot: root,
        });

        expect(await harness.getSessionSnapshot(created.sessionId)).toMatchObject({
            thinkingLevel: null,
            effectiveThinkingLevel: "off",
        });
    });

    it("profile runtime hook 可以写 session、保存运行态并 patch 每轮 TurnSnapshot", async () => {
        const observedRequestOptions: unknown[] = [];
        const observedToolNames: string[][] = [];
        harness.tools.register({
            key: "runtime_extra",
            name: "runtime_extra",
            label: "Runtime Extra",
            description: "Only available after runtime hook patches toolKeys.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "extra"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-hooks",
                name: "Runtime Hooks",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "tracker",
                        stage: "prepareRun",
                        run(ctx) {
                            return {
                                runtimeState: {
                                    started: ctx.session.messages.length,
                                },
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.prepareRun",
                                    ops: [{
                                        kind: "append",
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.prepareRun",
                                            value: "ok",
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                    {
                        name: "tracker",
                        stage: "prepareTurn",
                        run(ctx) {
                            const state = typeof ctx.runtimeState === "object" && ctx.runtimeState && !Array.isArray(ctx.runtimeState)
                                ? ctx.runtimeState as {started?: number}
                                : {};
                            return {
                                runtimeState: {
                                    preparedTurn: ctx.turnIndex ?? 0,
                                    started: state.started ?? 0,
                                },
                                turnSnapshotPatch: {
                                    toolKeys: ["runtime_extra"],
                                    requestOptions: {
                                        metadata: {
                                            runtimeHookMarker: `turn-${ctx.turnIndex ?? 0}`,
                                        },
                                    },
                                },
                            };
                        },
                    },
                    {
                        name: "tracker",
                        stage: "ingestTurn",
                        run(ctx) {
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.ingestTurn",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.ingestTurn",
                                            value: ctx.runtimeState ?? null,
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context, options) => {
                observedRequestOptions.push(options);
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                return fauxAssistantMessage([
                    fauxToolCall("runtime_extra", {}, {id: "runtime-extra-1"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-hooks",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(observedRequestOptions[0]).toEqual(expect.objectContaining({
            metadata: {
                runtimeHookMarker: "turn-1",
            },
        }));
        expect(observedToolNames[0]).toEqual(["runtime_extra"]);
        expect(context.customState["test.runtime.prepareRun"]).toBe("ok");
        expect(context.customState["test.runtime.ingestTurn"]).toEqual({
            preparedTurn: 1,
            started: 0,
        });
    });

    it("自定义 runtime 不组合 transcriptPersistence 时不会隐式持久化 assistant transcript", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.custom-runtime-no-default-transcript",
                name: "Custom Runtime No Default Transcript",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "observe",
                        stage: "prepareRun",
                        run() {
                            return {};
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("not persisted"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.custom-runtime-no-default-transcript",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("not persisted");
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
    });

    it("prepareNextTurn hook 会在同一个 run 的下一轮请求前执行", async () => {
        const observedRequestOptions: unknown[] = [];
        const providerPrompts: string[] = [];
        let toolRuns = 0;
        harness.tools.register({
            key: "runtime_continue",
            name: "runtime_continue",
            label: "Runtime Continue",
            description: "Forces one more turn.",
            parameters: Type.Object({}),
            async execute() {
                toolRuns++;
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.prepare-next-turn",
                name: "Prepare Next Turn",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["runtime_continue"],
            runtime: defineAgentRuntime({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "next",
                        stage: "prepareNextTurn",
                        run(ctx) {
                            return {
                                runtimeMessages: [
                                    createUserMessage({text: "NEXT_TURN_RUNTIME_CONTEXT"}),
                                ],
                                runtimeState: {
                                    preparedAfterTurn: ctx.turnIndex ?? 0,
                                },
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.prepareNextTurn",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.prepareNextTurn",
                                            value: {
                                                turnIndex: ctx.turnIndex ?? 0,
                                                messageCount: ctx.session.messages.length,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                    {
                        name: "next",
                        stage: "prepareTurn",
                        run(ctx) {
                            const state = typeof ctx.runtimeState === "object" && ctx.runtimeState && !Array.isArray(ctx.runtimeState)
                                ? ctx.runtimeState as {preparedAfterTurn?: number}
                                : {};
                            return {
                                turnSnapshotPatch: state.preparedAfterTurn
                                    ? {
                                        requestOptions: {
                                            metadata: {
                                                preparedAfterTurn: state.preparedAfterTurn,
                                            },
                                        },
                                    }
                                    : undefined,
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context, options) => {
                observedRequestOptions.push(options);
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("runtime_continue", {}, {id: "continue-1"}),
                ], {stopReason: "toolUse"});
            },
            (context, options) => {
                observedRequestOptions.push(options);
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.prepare-next-turn",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(toolRuns).toBe(1);
        expect(providerPrompts[0]).not.toContain("NEXT_TURN_RUNTIME_CONTEXT");
        expect(providerPrompts[1]).toContain("NEXT_TURN_RUNTIME_CONTEXT");
        expect(observedRequestOptions[0]).not.toEqual(expect.objectContaining({
            metadata: {
                preparedAfterTurn: 1,
            },
        }));
        expect(observedRequestOptions[1]).toEqual(expect.objectContaining({
            metadata: {
                preparedAfterTurn: 1,
            },
        }));
        expect(context.customState["test.runtime.prepareNextTurn"]).toEqual({
            turnIndex: 1,
            messageCount: 3,
        });
        expect(context.messages
            .filter((message): message is RuntimeMessage => message.role === "user" || message.role === "assistant" || message.role === "toolResult")
            .map((message) => messageText(message))).not.toContain("NEXT_TURN_RUNTIME_CONTEXT");
    });

    it("同名 runtime hook 的对象 runtimeState 会按 namespace 浅合并", async () => {
        const observedRuntimeStates: unknown[] = [];
        harness.tools.register({
            key: "continue_once",
            name: "continue_once",
            label: "Continue Once",
            description: "Forces one more turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-state-merge",
                name: "Runtime State Merge",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["continue_once"],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "state",
                        stage: "prepareRun",
                        run() {
                            return {
                                runtimeState: {
                                    first: true,
                                },
                            };
                        },
                    },
                    {
                        name: "state",
                        stage: "prepareNextTurn",
                        run(ctx) {
                            observedRuntimeStates.push(ctx.runtimeState);
                            return {
                                runtimeState: {
                                    second: true,
                                },
                            };
                        },
                    },
                    {
                        name: "state",
                        stage: "prepareTurn",
                        run(ctx) {
                            observedRuntimeStates.push(ctx.runtimeState);
                            return {};
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("continue_once", {}, {id: "continue-once"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-state-merge",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedRuntimeStates).toEqual([
            {first: true},
            {first: true},
            {first: true, second: true},
        ]);
    });

    it("settleRun hook 可以读取 report_result 并写最终 projection", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.settle-run",
                name: "Settle Run",
            },
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "settle",
                        stage: "settleRun",
                        run(ctx) {
                            const data = ctx.runResult?.reportResult?.data as {title?: string} | undefined;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.settleRun",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.settleRun",
                                            value: {
                                                status: ctx.runResult?.status ?? "completed",
                                                title: data?.title ?? null,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "ok",
                    data: {
                        title: "Settled",
                    },
                }, {id: "report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.settle-run",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult?.data).toEqual({
            title: "Settled",
        });
        expect(context.customState["test.runtime.settleRun"]).toEqual({
            status: "completed",
            title: "Settled",
        });
    });

    it("prepareRun sidecar 可以注入主 run runtime context，且旁路 transcript 不落 session", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-context-load",
                name: "Sidecar Context Load",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "检索并整理本轮 actor 可知设定。",
                merge(_ctx, result) {
                    const sidecarData = result.sidecarData as {context: string};
                    return {
                        runtimeMessages: [
                            createUserMessage({text: `ACTOR_SAFE_CONTEXT:${sidecarData.context}`}),
                        ],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "loaded",
                        sidecar_data: {
                            context: "SAFE_LORE",
                        },
                    }, {id: "sidecar-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxText("main done"),
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-context-load",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result).toEqual(expect.objectContaining({status: "completed"}));
        expect(result.reportResult).toEqual({result: "main"});
        expect(providerPrompts[0]).toContain("sidecar: actor.context-load");
        expect(providerPrompts[1]).toContain("ACTOR_SAFE_CONTEXT:SAFE_LORE");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(visibleMessageText(context.messages)).not.toContain("SAFE_LORE");
        expect(visibleMessageText(context.messages)).not.toContain("loaded");
    });

    it("settleRun sidecar 可以在主 run 后执行并写入 merge writePlans", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-memory-save",
                name: "Sidecar Memory Save",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.memory-save",
                stage: "settleRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    summary: Type.String(),
                }),
                enterPrompt: (ctx) => `保存本轮 actor 记忆。主结果：${ctx.runResult?.reportResult?.result ?? ""}`,
                merge(ctx, result) {
                    return {
                        writePlans: [{
                            target: {sessionId: ctx.sessionId},
                            cause: "test.sidecar.memory-save",
                            ops: [{
                                kind: "append",
                                projection: true,
                                entry: {
                                    type: "custom",
                                    key: "test.sidecar.memory",
                                    value: result.sidecarData,
                                },
                            }],
                        }],
                    };
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("main done"),
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                expect(visibleMessageText(context.messages as AgentMessage[])).toContain("主结果：main");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "saved",
                        sidecar_data: {
                            summary: "memory saved",
                        },
                    }, {id: "memory-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-memory-save",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(context.customState["test.sidecar.memory"]).toEqual({
            summary: "memory saved",
        });
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(visibleMessageText(context.messages)).not.toContain("saved");
    });

    it("simulator.actor 会通过 context-load 注入 actor-safe 设定，并通过 memory-save 更新 knowledge/mind", async () => {
        const profiles = new AgentProfileCatalog(
            join(root, "missing-system-profiles"),
            join(root, "missing-user-profiles"),
        );
        profiles.register(simulatorActorProfile, false);
        const rpHarness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles,
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        const projectSlug = `rp-project-${randomUUID()}`;
        const actorRoot = join(root, projectSlug, "simulation", "subjects", "heroine");
        await mkdir(actorRoot, {recursive: true});
        await mkdir(join(root, projectSlug, "lorebook", "world"), {recursive: true});
        await writeFile(join(actorRoot, "subject.md"), "保持礼貌但警惕，遇到未知物品会先询问来源。", "utf-8");
        await writeFile(join(actorRoot, "events.md"), "她刚抵达学院区广场。\n", "utf-8");
        await writeFile(join(actorRoot, "knowledge.md"), "## 世界观\n\n### 已知物品\n\n她不知道世界之心的真名。\n", "utf-8");
        await writeFile(join(actorRoot, "mind.md"), "她正在判断主角的用意。\n", "utf-8");
        await writeFile(join(actorRoot, "state.md"), "她位于学院区广场边缘，状态正常。\n", "utf-8");
        await writeFile(join(root, projectSlug, "lorebook", "world", "world-heart.md"), "世界之心公开表现为五彩石，隐藏真相是旧神核心。", "utf-8");
        const providerPrompts: string[] = [];

        faux.setResponses([
            (context) => {
                const promptText = visibleMessageText(context.messages as AgentMessage[]);
                providerPrompts.push(promptText);
                expect(promptText).toContain("sidecar: actor.context-load");
                expect(promptText).toContain("世界之心");
                return fauxAssistantMessage([
                    fauxToolCall("read", {
                        path: `${projectSlug}/lorebook/world/world-heart.md`,
                    }, {id: "context-read"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                const promptText = visibleMessageText(context.messages as AgentMessage[]);
                providerPrompts.push(promptText);
                expect(promptText).toContain("旧神核心");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "loaded actor-safe lore",
                        sidecar_data: {
                            actor_safe_context: "你知道这块五彩石被一些传闻称为世界之心，但不知道它的隐藏真相。",
                            sources: [`${projectSlug}/lorebook/world/world-heart.md`],
                            withheld: ["旧神核心隐藏真相"],
                            confidence: "medium",
                        },
                    }, {id: "context-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                const promptText = visibleMessageText(context.messages as AgentMessage[]);
                providerPrompts.push(promptText);
                expect(promptText).toContain("<actor_sidecar_context source=\"actor.context-load\">");
                expect(promptText).toContain("被一些传闻称为世界之心");
                expect(promptText).not.toContain("旧神核心隐藏真相");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "actor responded",
                        data: {
                            visible_action: "她垂眸看向掌心的五彩石，指尖微微收紧。",
                            spoken_dialogue: "这是什么？你从哪里得到它的？",
                            private_intent: "她想先确认石头来源，再决定是否交还。",
                            emotional_state: "警惕且好奇。",
                            assumptions: ["这块石头不像普通矿物。"],
                            questions_to_gm: [],
                            event_update: "主角把一块疑似被称为世界之心的五彩石交给了她。",
                            knowledge_update: "主角把一块疑似被称为世界之心的五彩石交给了她。",
                            mind_update: "她开始怀疑主角知道更多内情，但暂时不追问过深。",
                            state_update: "她暂时持有这块五彩石。",
                        },
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                const promptText = visibleMessageText(context.messages as AgentMessage[]);
                providerPrompts.push(promptText);
                expect(promptText).toContain("sidecar: actor.memory-save");
                expect(promptText).toContain("主角把一块疑似被称为世界之心的五彩石交给了她");
                expect(promptText).toContain("不要修改 statePath");
                return fauxAssistantMessage([
                    fauxToolCall("edit", {
                        path: `${projectSlug}/simulation/subjects/heroine/knowledge.md`,
                        edits: [{
                            oldText: "她不知道世界之心的真名。\n",
                            newText: "她不知道世界之心的真名。\n\n### 五彩石\n\n主角把一块疑似被称为世界之心的五彩石交给了她。\n",
                        }],
                    }, {id: "memory-edit-knowledge"}),
                    fauxToolCall("edit", {
                        path: `${projectSlug}/simulation/subjects/heroine/mind.md`,
                        edits: [{
                            oldText: "她正在判断主角的用意。\n",
                            newText: "她正在判断主角的用意。\n她开始怀疑主角知道更多内情，但暂时不追问过深。\n",
                        }],
                    }, {id: "memory-edit-mind"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "memory saved",
                    sidecar_data: {
                        changed_files: [
                            `${projectSlug}/simulation/subjects/heroine/knowledge.md`,
                            `${projectSlug}/simulation/subjects/heroine/mind.md`,
                        ],
                        events_summary: "记录主角交给她疑似世界之心的五彩石。",
                        knowledge_summary: "记录主角交给她疑似世界之心的五彩石。",
                        mind_summary: "记录她对主角隐瞒信息的怀疑。",
                        skipped: ["state_update 交给 GM / 后续状态系统处理。"],
                        needs_gm_review: [],
                    },
                }, {id: "memory-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await rpHarness.createAgent({
            profileKey: "simulator.actor",
            input: {
                actorId: "heroine",
                actorName: "绘璃奈",
                kind: "npc",
                instructionPath: `${projectSlug}/simulation/subjects/heroine/subject.md`,
                eventsPath: `${projectSlug}/simulation/subjects/heroine/events.md`,
                knowledgePath: `${projectSlug}/simulation/subjects/heroine/knowledge.md`,
                mindPath: `${projectSlug}/simulation/subjects/heroine/mind.md`,
                statePath: `${projectSlug}/simulation/subjects/heroine/state.md`,
            },
            workspaceRoot: root,
        });

        const result = await rpHarness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "主角把一块五彩缤纷的石头交到你手里。石头隐约有异常力量感。"},
        });
        const context = rpHarness.repo.reduce(await rpHarness.repo.readSession(created.sessionId));
        const knowledge = await readFile(join(actorRoot, "knowledge.md"), "utf-8");
        const mind = await readFile(join(actorRoot, "mind.md"), "utf-8");
        const state = await readFile(join(actorRoot, "state.md"), "utf-8");
        const visibleText = visibleMessageText(context.messages);

        expect(result.status).toBe("completed");
        expect(result.reportResult?.data).toEqual(expect.objectContaining({
            spoken_dialogue: "这是什么？你从哪里得到它的？",
        }));
        expect(providerPrompts).toHaveLength(4);
        expect(knowledge).toContain("疑似被称为世界之心的五彩石");
        expect(mind).toContain("怀疑主角知道更多内情");
        expect(state).toBe("她位于学院区广场边缘，状态正常。\n");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "user", "assistant", "toolResult"]);
        expect(visibleText).not.toContain("loaded actor-safe lore");
        expect(visibleText).not.toContain("memory saved");
        expect(visibleText).not.toContain("旧神核心");
        expect(visibleText).not.toContain("<actor_sidecar_context");
    });

    it("sidecar_data 不符合 schema 时父 run 失败", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-schema-failure",
                name: "Sidecar Schema Failure",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "bad",
                    sidecar_data: {
                        context: 1,
                    },
                }, {id: "bad-sidecar-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-schema-failure",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("actor.context-load");
        expect(result.error).toContain("sidecar_data");
    });

    it("sidecar 保持 profile 最大工具 schema 可见，但执行权限使用旁路子集", async () => {
        const observedToolNames: string[][] = [];
        harness.tools.register({
            key: "sidecar_extra",
            name: "sidecar_extra",
            label: "Sidecar Extra",
            description: "Should be visible but not executable in sidecar.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "extra"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-tool-policy",
                name: "Sidecar Tool Policy",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "sidecar_extra"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedToolNames.push((context.tools ?? []).map((tool) => tool.name));
                return fauxAssistantMessage([
                    fauxToolCall("sidecar_extra", {}, {id: "forbidden-extra"}),
                ], {stopReason: "toolUse"});
            },
            (context) => {
                expect(visibleMessageText(context.messages as AgentMessage[])).toContain("Tool sidecar_extra is not allowed by this profile");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "loaded",
                        sidecar_data: {
                            context: "ok",
                        },
                    }, {id: "sidecar-report"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "main",
                }, {id: "main-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-tool-policy",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(observedToolNames[0]).toEqual(expect.arrayContaining(["report_result", "sidecar_extra"]));
    });

    it("prepareRun sidecar 不会关闭父 run 的 steer 窗口", async () => {
        let releaseMainTool: (() => void) | undefined;
        const mainToolStarted = new Promise<void>((resolve) => {
            harness.tools.register({
                key: "sidecar_steer_gate",
                name: "sidecar_steer_gate",
                label: "Sidecar Steer Gate",
                description: "等待测试注入 steer。",
                parameters: Type.Object({}),
                async execute() {
                    resolve();
                    await new Promise<void>((done) => {
                        releaseMainTool = done;
                    });
                    return {
                        content: [{type: "text", text: "gate done"}],
                        details: {},
                        terminate: true,
                    };
                },
            });
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.sidecar-keeps-steerable",
                name: "Sidecar Keeps Steerable",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result", "sidecar_steer_gate"],
            sidecars: [{
                name: "actor.context-load",
                stage: "prepareRun",
                allowedToolKeys: ["report_result"],
                sidecarDataSchema: Type.Object({
                    context: Type.String(),
                }),
                enterPrompt: "加载上下文。",
                merge() {
                    return {};
                },
            }],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "loaded",
                    sidecar_data: {
                        context: "ok",
                    },
                }, {id: "sidecar-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("sidecar_steer_gate", {}, {id: "main-gate"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                expect(visibleMessageText(context.messages as AgentMessage[])).toContain("after sidecar steer");
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "main",
                    }, {id: "main-report"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.sidecar-keeps-steerable",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        await mainToolStarted;
        const steered = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "after sidecar steer"},
        });
        releaseMainTool?.();
        const result = await running;
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(steered.status).toBe("waiting");
        expect(result.status).toBe("completed");
        expect(snapshot.steerQueue).toEqual([]);
    });

    it("prepareRun hook 可以注入 runtime-only 首轮上下文且不落 session", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.prepare-run-runtime-message",
                name: "Prepare Run Runtime Message",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "context",
                        stage: "prepareRun",
                        run() {
                            return {
                                runtimeMessages: [
                                    createUserMessage({text: "RUNTIME_ONLY_CONTEXT"}),
                                ],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.prepare-run-runtime-message",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("RUNTIME_ONLY_CONTEXT");
        expect(context.messages
            .filter((message): message is RuntimeMessage => message.role === "user" || message.role === "assistant" || message.role === "toolResult")
            .map((message) => messageText(message))).not.toContain("RUNTIME_ONLY_CONTEXT");
    });

    it("runtime hook 可以通过 session facade 读取 source session 并注入 Agent Dialogue Content", async () => {
        const providerPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.source",
                name: "Source",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const source = await harness.createAgent({
            profileKey: "test.source",
            input: {},
            workspaceRoot: root,
        });
        faux.setResponses([
            fauxAssistantMessage("source answer"),
        ]);
        await harness.invokeAgent({
            sessionId: source.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.session-facade",
                name: "Session Facade",
            },
            inputSchema: Type.Object({
                sourceSessionId: Type.Number(),
            }),
            allowedToolKeys: [],
            runtime: {
                hooks: [
                    {
                        name: "sourceContext",
                        stage: "prepareRun",
                        async run(ctx) {
                            const sourceSession = await ctx.session.read(ctx.input.sourceSessionId);
                            const content = await ctx.session.agentDialogueContent({
                                snapshot: sourceSession.snapshot,
                                input: ctx.input,
                            });
                            return {
                                runtimeMessages: [
                                    createUserMessage({text: `SOURCE_CONTEXT\n${content.text}`}),
                                ],
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.sessionFacade",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.source",
                                            value: {
                                                sourceSessionId: sourceSession.snapshot.metadata.sessionId,
                                                sourceMessageCount: sourceSession.context.messages.length,
                                                entryIds: content.entryIds,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("reader done");
            },
        ]);
        const reader = await harness.createAgent({
            profileKey: "test.session-facade",
            input: {
                sourceSessionId: source.sessionId,
            },
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: reader.sessionId,
            mode: "prompt",
            message: {text: "read source"},
        });
        const readerContext = harness.repo.reduce(await harness.repo.readSession(reader.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[0]).toContain("SOURCE_CONTEXT");
        expect(providerPrompts[0]).toContain("source question");
        expect(providerPrompts[0]).toContain("source answer");
        expect(readerContext.customState["test.runtime.source"]).toEqual({
            sourceSessionId: source.sessionId,
            sourceMessageCount: 2,
            entryIds: expect.any(Array),
        });
        expect(readerContext.messages
            .filter((message): message is RuntimeMessage => message.role === "user" || message.role === "assistant" || message.role === "toolResult")
            .map((message) => messageText(message))).not.toContain("SOURCE_CONTEXT");
    });

    it("ingestTurn hook 可以让本轮 transcript 只保留在 RunFrame，settleRun 仍能读取 report_result", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-only-transcript",
                name: "Runtime Only Transcript",
            },
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run(ctx) {
                            return {
                                transcript: "runtime_only",
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.runtimeOnlyTranscript",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.transcript",
                                            value: {
                                                assistantText: messageText(ctx.turn?.assistant ?? createAssistantTextMessage({text: ""})),
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                    {
                        name: "write-report",
                        stage: "settleRun",
                        run(ctx) {
                            const data = ctx.runResult?.reportResult?.data as {title?: string} | undefined;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.runtimeOnlySettle",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.settleTransient",
                                            value: {
                                                title: data?.title ?? null,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("hidden transcript"),
                fauxToolCall("report_result", {
                    result: "ok",
                    data: {
                        title: "Transient Summary",
                    },
                }, {id: "transient-report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-only-transcript",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toContain("hidden transcript");
        expect(result.reportResult?.data).toEqual({
            title: "Transient Summary",
        });
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
        expect(context.customState["test.runtime.transcript"]).toMatchObject({
            assistantText: expect.stringContaining("hidden transcript"),
        });
        expect(context.customState["test.runtime.settleTransient"]).toEqual({
            title: "Transient Summary",
        });
    });

    it("waiting turn 拒绝 runtime_only transcript，避免 resolution 无法恢复", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-only-waiting",
                name: "Runtime Only Waiting",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "runtime_only",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    question: "Continue?",
                }, {id: "wait-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-only-waiting",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("error");
        expect(result.error).toContain("waiting turn 必须显式使用 persist transcript");
        expect(result.errorPhase).toBe("ingest");
        expect(result.errorInfo).toEqual(expect.objectContaining({
            phase: "ingest",
        }));
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
    });

    it("runtime_only transcript 下 report_result reminder 只进入 RunFrame 不写 session", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.runtime-only-report-reminder",
                name: "Runtime Only Report Reminder",
            },
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime({
                hooks: [
                    agentRuntimeBuiltins.sessionRuntime(),
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "runtime_only",
                            };
                        },
                    },
                    {
                        name: "settle",
                        stage: "settleRun",
                        run(ctx) {
                            const data = ctx.runResult?.reportResult?.data as {title?: string} | undefined;
                            return {
                                writePlans: [{
                                    target: {sessionId: ctx.sessionId},
                                    cause: "test.runtimeOnlyReportReminder",
                                    ops: [{
                                        kind: "append",
                                        projection: true,
                                        entry: {
                                            type: "custom",
                                            key: "test.runtime.reportReminder",
                                            value: {
                                                title: data?.title ?? null,
                                            },
                                        },
                                    }],
                                }],
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        const providerPrompts: string[] = [];
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("missing report");
            },
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "ok",
                        data: {
                            title: "Runtime Reminder",
                        },
                    }, {id: "runtime-reminder-report-1"}),
                ], {stopReason: "toolUse"});
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.runtime-only-report-reminder",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(providerPrompts[1]).toContain("必须使用 report_result");
        expect(context.messages.map((message) => message.role)).toEqual(["user"]);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("必须使用 report_result"))).toBe(false);
        expect(context.customState["test.runtime.reportReminder"]).toEqual({
            title: "Runtime Reminder",
        });
    });

    it("source profile completed 后会后台运行 summarizer 并写回 active leaf title/summary", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarized-source",
                name: "Summarized Source",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                    maxDialogueContentTokens: 80_000,
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary ok",
                    data: {
                        title: "Source Title",
                        summary: "Source summary.",
                    },
                }, {id: "summarizer-report-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarized-source",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        expect(result.status).toBe("completed");
        await waitFor(async () => {
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(context.title).toBe("Source Title");
            expect(context.summary).toBe("Source summary.");
            expect(context.customState["summarizer.state"]).toMatchObject({
                running: false,
                dirty: false,
                profileKey: "summarizer",
                lastDialogueContentTokens: expect.any(Number),
                lastDialogueContentFingerprint: expect.any(String),
                lastRunAt: expect.any(Number),
            });
        });

        const sourceContext = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const state = sourceContext.customState["summarizer.state"] as {sessionId?: number};
        expect(state.sessionId).toEqual(expect.any(Number));
        const summarizerSnapshot = await harness.repo.readSession(state.sessionId!);
        const summarizerContext = harness.repo.reduce(summarizerSnapshot);
        expect(summarizerSnapshot.metadata).toMatchObject({
            profileKey: "summarizer",
            systemRole: "summarizer",
        });
        expect(summarizerContext.messages).toHaveLength(0);
        expect((await harness.listSessions({workspaceKey: "global"})).map((session) => session.sessionId)).toEqual([created.sessionId]);
        expect((await harness.listSessions({workspaceKey: "global", includeSystem: true})).map((session) => session.sessionId).sort((left, right) => left - right)).toEqual([
            created.sessionId,
            state.sessionId,
        ]);
        await waitFor(async () => {
            const settled = await harness.repo.readSession(state.sessionId!);
            expect(settled.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "end",
            }));
        });
    });

    it("summarizer 写回前 source leaf 变化时只标 dirty 不覆盖当前 title/summary", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-stale",
                name: "Summarizer Stale",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-stale",
            input: {},
            workspaceRoot: root,
        });
        faux.setResponses([
            fauxAssistantMessage("source answer"),
            async () => {
                await harness.repo.moveLeaf(created.sessionId, null);
                return fauxAssistantMessage([
                    fauxToolCall("report_result", {
                        result: "stale summary",
                        data: {
                            title: "Stale Title",
                            summary: "Stale summary.",
                        },
                    }, {id: "summarizer-report-stale"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "fresh summary",
                    data: {
                        title: "Fresh Title",
                        summary: "Fresh summary.",
                    },
                }, {id: "summarizer-report-fresh"}),
            ], {stopReason: "toolUse"}),
        ]);

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });

        expect(result.status).toBe("completed");
        await waitFor(async () => {
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(context.customState["summarizer.state"]).toMatchObject({
                running: false,
                dirty: false,
            });
            expect(context.title).toBe("Fresh Title");
            expect(context.summary).toBe("Fresh summary.");
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const updates = snapshot.entries.filter((entry) => entry.type === "session_update");
        expect(updates.some((entry) => entry.updates.title === "Stale Title")).toBe(false);
        const state = harness.repo.reduce(snapshot).customState["summarizer.state"] as {sessionId?: number};
        await waitFor(async () => {
            const settled = await harness.repo.readSession(state.sessionId!);
            expect(settled.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(2);
        });
    });

    it("summarizer preflight 超过 Agent Dialogue Content token 上限时只写状态不启动 hidden run", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-too-large",
                name: "Summarizer Too Large",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                    maxDialogueContentTokens: 1,
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer with enough text to exceed token limit"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "must not run",
                    data: {
                        title: "Unexpected",
                        summary: "Unexpected.",
                    },
                }, {id: "summarizer-too-large-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-too-large",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question that exceeds"},
        });
        await harness.drainSessionSummarizer(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(context.title).toBe("Summarizer Too Large");
        expect(context.summary).toBeUndefined();
        expect(context.customState["summarizer.state"]).toMatchObject({
            running: false,
            dirty: false,
            profileKey: "summarizer",
            lastDialogueContentTokens: expect.any(Number),
            lastError: expect.stringContaining("超过 summarizer 上限"),
        });
        expect((await harness.listSessions({workspaceKey: "global", includeSystem: true})).map((session) => session.sessionId)).toEqual([created.sessionId]);
    });

    it("summarizer sourceInvocation interval 会按 source prompt turn 间隔触发", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-interval",
                name: "Summarizer Interval",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 2,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer 1"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary one",
                    data: {
                        title: "Interval One",
                        summary: "First summary.",
                    },
                }, {id: "summarizer-interval-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("source answer 2"),
            fauxAssistantMessage("source answer 3"),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary two",
                    data: {
                        title: "Interval Two",
                        summary: "Second summary.",
                    },
                }, {id: "summarizer-interval-2"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-interval",
            input: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "one"}});
        await waitFor(async () => {
            expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).title).toBe("Interval One");
        });
        const firstState = harness.repo.reduce(await harness.repo.readSession(created.sessionId)).customState["summarizer.state"] as {sessionId?: number};
        const summarizerSessionId = firstState.sessionId!;
        await waitFor(async () => {
            const summarizerSnapshot = await harness.repo.readSession(summarizerSessionId);
            expect(summarizerSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(1);
        });

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "two"}});
        await harness.drainSessionSummarizer(created.sessionId);
        let summarizerSnapshot = await harness.repo.readSession(summarizerSessionId);
        expect(summarizerSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(1);

        await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "three"}});
        await waitFor(async () => {
            expect(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).title).toBe("Interval Two");
        });
        await waitFor(async () => {
            summarizerSnapshot = await harness.repo.readSession(summarizerSessionId);
            expect(summarizerSnapshot.entries.filter((entry) => entry.type === "invocation_lifecycle" && entry.status === "end")).toHaveLength(2);
        });
    });

    it("summarizer 运行失败后同一份 Agent Dialogue Content 可以重试", async () => {
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: true,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.summarizer-retry",
                name: "Summarizer Retry",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                },
            },
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("source answer"),
            async () => {
                throw new Error("temporary provider error");
            },
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "summary retry",
                    data: {
                        title: "Retry Title",
                        summary: "Retry summary.",
                    },
                }, {id: "summarizer-retry-report"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.summarizer-retry",
            input: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "source question"},
        });
        await harness.drainSessionSummarizer(created.sessionId);
        let context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("Summarizer Retry");
        expect(context.customState["summarizer.state"]).toMatchObject({
            running: false,
            dirty: false,
            lastError: expect.stringContaining("temporary provider error"),
        });

        await (harness as unknown as {scheduleSessionSummarizer(sessionId: number): Promise<void>}).scheduleSessionSummarizer(created.sessionId);
        await harness.drainSessionSummarizer(created.sessionId);
        context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        expect(context.title).toBe("Retry Title");
        expect(context.summary).toBe("Retry summary.");
        expect(context.customState["summarizer.state"]).toMatchObject({
            running: false,
            dirty: false,
            lastDialogueContentFingerprint: expect.any(String),
        });
        expect((context.customState["summarizer.state"] as {lastError?: string}).lastError).toBeUndefined();
    });

    it("自定义 runtime 不组合 reportResult built-in 时不会自动注入 report_result reminder", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.custom-runtime-no-report-reminder",
                name: "Custom Runtime No Report Reminder",
            },
            inputSchema: Type.Object({}),
            outputSchema: Type.Object({
                title: Type.String(),
            }),
            allowedToolKeys: ["report_result"],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "transient",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "runtime_only",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage("missing report"),
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.custom-runtime-no-report-reminder",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.reportResult).toBeUndefined();
        expect(faux.getPendingResponseCount()).toBe(1);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("必须使用 report_result"))).toBe(false);
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

    it("continue resolution 不会发布带旧 pending approval 的启动 snapshot", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.approval-state",
                name: "Approval State",
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
                    questions: [{question: "继续？"}],
                }, {id: "ask-state"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-state",
            input: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: harness.eventHub.eventEpoch,
            after: harness.eventHub.lastSeq(created.sessionId),
        });
        const pendingAfterContinue: Array<string | null> = [];
        const collect = (async () => {
            for await (const event of subscription) {
                if (event.kind === "session" && event.event.type === "session_state_changed") {
                    pendingAfterContinue.push(event.event.state.pendingApproval?.toolCallId ?? null);
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    break;
                }
            }
        })();

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-state",
                answers: [{questionIndex: 0, text: "继续"}],
            },
        });
        await collect;

        expect(pendingAfterContinue).not.toContain("ask-state");
        expect(pendingAfterContinue).toContain(null);
    });

    it("Plan Mode 使用 Project Workspace .agent/plan 并支持 exit preview", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-mode-preview",
                name: "Plan Mode Preview",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["exit_plan_mode"],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.plan-mode-preview",
            input: {},
            workspaceRoot: root,
        });
        await harness.runCommand(created.sessionId, {
            command: "plan",
            active: true,
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const planModeState = context.customState[AGENT_PLAN_MODE_STATE_KEY] as Record<string, unknown>;

        expect(planModeState.workDirectory).toBe(`${root.replace(/\\/g, "/")}/.agent/plan`);

        await mkdir(join(root, ".agent", "plan"), {recursive: true});
        await writeFile(join(root, ".agent", "plan", "preview.md"), "# Preview Plan\n\n- one\n", "utf-8");
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("exit_plan_mode", {
                    reason: "ready",
                    planFilePath: ".agent/plan/preview.md",
                }, {id: "exit-preview"}),
            ], {stopReason: "toolUse"}),
        ]);

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "approve plan"},
        });
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(snapshot.pendingApproval).toEqual(expect.objectContaining({
            toolCallId: "exit-preview",
            toolName: "exit_plan_mode",
            planFilePath: ".agent/plan/preview.md",
            planContent: "# Preview Plan\n\n- one\n",
        }));
    });

    it("exit_plan_mode preview 拒绝 .agent/plan 外的计划路径", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.plan-mode-bad-preview",
                name: "Plan Mode Bad Preview",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["exit_plan_mode"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("exit_plan_mode", {
                    planFilePath: "README.md",
                }, {id: "exit-bad-preview"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("plan path rejected")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.plan-mode-bad-preview",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "bad plan"},
        });

        expect(result.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult");
        expect(toolResult ? messageText(toolResult) : "").toContain(".agent/plan");
        expect(result.finalMessage).toBe("plan path rejected");
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

    it("repeatEveryTurns 只计算真实 prompt 用户消息", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.prompt-turns",
                name: "Prompt Turns",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare({runtime}) {
                return {
                    appendingMessages: runtime?.promptUserTurnCount === 0
                        ? [createUserMessage({text: "APPENDING_BEFORE_FIRST_PROMPT"})]
                        : [],
                };
            },
        }));
        faux.setResponses([
            (context) => {
                return fauxAssistantMessage(fauxText(`count=${context.messages.filter((message) => message.role === "user").length}`));
            },
            fauxAssistantMessage(fauxText("second")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.prompt-turns",
            input: {},
            workspaceRoot: root,
        });

        const first = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT_ONE"},
        });
        const second = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
        });
        const entries = (await harness.repo.readSession(created.sessionId)).entries;

        expect(first.finalMessage).toBe("count=2");
        expect(second.status).toBe("completed");
        expect(entries.filter((entry) => entry.type === "message" && entry.origin === "prompt")).toHaveLength(1);
        expect(entries.filter((entry) => entry.type === "custom_message" && messageText(entry.message as never) === "APPENDING_BEFORE_FIRST_PROMPT")).toHaveLength(1);
    });

    it("prepare 能读取尚未写入 session 的本轮 prompt 消息", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.pending-prompt",
                name: "Pending Prompt",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare({runtime}) {
                return {
                    appendingMessages: runtime?.pendingUserMessage
                        ? [createUserMessage({text: `PENDING=${messageText(runtime.pendingUserMessage)}`})]
                        : [],
                };
            },
        }));
        faux.setResponses([
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.pending-prompt",
            input: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "$skill run"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(context.messages.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
        expect(messageText(context.messages[0] as never)).toBe("PENDING=$skill run");
        expect(messageText(context.messages[1] as never)).toBe("$skill run");
    });

    it("ModelContext 内 Reminder 会按 AppendingSet 语义提前写入并推送 session_entry", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.model-reminder-visible",
                name: "Model Reminder Visible",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {
                    systemPrompt: "SYSTEM",
                    modelContextAppendingMessages: [createUserMessage({text: "MODEL_REMINDER"})],
                    modelContextMessages: [createUserMessage({text: "MODEL_ONLY"})],
                };
            },
        }));
        const entryTexts: string[] = [];
        harness.eventHub.subscribe(1);
        faux.setResponses([
            (context) => {
                return fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|")));
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.model-reminder-visible",
            input: {},
            workspaceRoot: root,
        });
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const collect = (async () => {
            for await (const event of subscription) {
                if (event.kind === "session" && event.event.type === "session_entry") {
                    const entry = event.event.entry;
                    if (entry.type === "custom_message" || entry.type === "message") {
                        entryTexts.push(messageText(entry.message as never));
                    }
                }
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    break;
                }
            }
        })();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        await collect;

        expect(result.finalMessage).toBe("MODEL_REMINDER|PROMPT|MODEL_ONLY");
        expect(entryTexts).toContain("MODEL_REMINDER");
    });

    it("自定义 runtime 不组合 sessionContext built-in 时不注入 prepare modelContextMessages", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-session-context-runtime",
                name: "No Session Context Runtime",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    modelContextMessages: [createUserMessage({text: "MODEL_ONLY"})],
                };
            },
        }), false);
        faux.setResponses([
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-session-context-runtime",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("PROMPT");
        expect(context.messages.map((message) => messageText(message as never))).toEqual(["PROMPT", "PROMPT"]);
    });

    it("自定义 runtime 不组合 sessionContext built-in 时不写入 prepare context messages", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-session-context-writes",
                name: "No Session Context Writes",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    historyInitMessages: [createUserMessage({text: "HISTORY_INIT"})],
                    modelContextAppendingMessages: [createUserMessage({text: "MODEL_APPENDING"})],
                    appendingMessages: [createUserMessage({text: "APPENDING"})],
                };
            },
        }), false);
        faux.setResponses([
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-session-context-writes",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("completed");
        expect(result.finalMessage).toBe("PROMPT");
        expect(context.messages.map((message) => messageText(message as never))).toEqual(["PROMPT", "PROMPT"]);
    });

    it("自定义 runtime 不组合 sessionContext built-in 时 compact 后不重新注入 HistorySet", async () => {
        const providerPrompts: string[] = [];
        harness.tools.register({
            key: "force_continue_without_session_context",
            name: "force_continue_without_session_context",
            label: "Force Continue Without Session Context",
            description: "Forces another turn.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                    terminate: false,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-session-context-compact",
                name: "No Session Context Compact",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["force_continue_without_session_context"],
            compaction: {
                triggerTokens: 1,
                keepRecentTokens: 1,
            },
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    historyInitMessages: [createUserMessage({text: "HISTORY_INIT"})],
                };
            },
        }), false);
        faux.setResponses([
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage([
                    fauxToolCall("force_continue_without_session_context", {}, {id: "force-continue-without-session-context-1"}),
                ], {stopReason: "toolUse"});
            },
            fauxAssistantMessage(fauxText("COMPACT SUMMARY")),
            (context) => {
                providerPrompts.push(context.messages.map((message) => messageText(message as RuntimeMessage)).join("\n"));
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-session-context-compact",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "OLD CONTEXT"}));

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("completed");
        expect(providerPrompts).toHaveLength(2);
        expect(providerPrompts[1]).toContain("COMPACT SUMMARY");
        expect(providerPrompts[1]).not.toContain("HISTORY_INIT");
    });

    it("自定义 runtime 不组合 profilePrompt built-in 时不注入 prepare systemPrompt", async () => {
        const observedSystemPrompts: string[] = [];
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.no-profile-prompt-runtime",
                name: "No Profile Prompt Runtime",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "persist",
                        stage: "ingestTurn",
                        run() {
                            return {
                                transcript: "persist",
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {
                    systemPrompt: "PROFILE_SYSTEM_PROMPT",
                };
            },
        }), false);
        faux.setResponses([
            (context) => {
                observedSystemPrompts.push(context.systemPrompt ?? "");
                return fauxAssistantMessage("done");
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.no-profile-prompt-runtime",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "PROMPT"},
        });
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(result.status).toBe("completed");
        expect(observedSystemPrompts).toEqual([""]);
        expect(snapshot.systemPrompt).toBeUndefined();
    });

    it("非内置 hook 不能伪造 builtinBehavior", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.fake-builtin-behavior",
                name: "Fake Builtin Behavior",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            runtime: defineAgentRuntime({
                hooks: [
                    {
                        name: "builtin.fake",
                        stage: "prepareRun",
                        run() {
                            return {
                                builtinBehavior: {
                                    profilePrompt: true,
                                },
                            };
                        },
                    },
                ],
            }),
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.fake-builtin-behavior",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });

        expect(result.status).toBe("error");
        expect(result.error ?? "").toContain("runtime hook builtin.fake 不能返回 builtinBehavior");
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

    it("create_agent 子 session 首次运行使用父 session workspaceRoot 的 effective 默认模型", async () => {
        const childWorkspaceRoot = join(root, "child-workspace").replaceAll("\\", "/");
        await mkdir(join(childWorkspaceRoot, ".nbook"), {recursive: true});
        await writeFile(join(childWorkspaceRoot, ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "project-provider/project-model",
            },
        }, null, 4), "utf8");

        const observedDefaultModelKeys: Array<string | null> = [];
        harness = new NeuroAgentHarness({
            repo: harness.repo,
            profiles: harness.profiles,
            modelResolver: (config, profileKey, override) => {
                expect(profileKey).toBe("leader.default");
                expect(override).toBeUndefined();
                observedDefaultModelKeys.push(config.models.defaultModelKey);
                return faux.getModel();
            },
        });
        faux.setResponses([fauxAssistantMessage(fauxText("child done"))]);
        const parent = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: childWorkspaceRoot,
            workspaceKey: "novel-one",
        });
        const child = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: childWorkspaceRoot,
            workspaceKey: "novel-one",
            parentSessionId: parent.sessionId,
        });

        await harness.invokeAgent({
            sessionId: child.sessionId,
            mode: "prompt",
            message: {text: "use default"},
        });

        expect(observedDefaultModelKeys).toContain("project-provider/project-model");
    });

    it("invoke_agent 完成后父 agent 继续进入下一轮 ReAct", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-parent",
                name: "Invoke Parent",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["invoke_agent"],
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-child",
                name: "Invoke Child",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("invoke_agent", {
                    sessionId: 2,
                    mode: "prompt",
                    message: "child work",
                }, {id: "invoke-child"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    result: "child done",
                    data: {
                        answer: "structured child data",
                    },
                }, {id: "child-report"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("parent after child")),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.invoke-parent",
            input: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "test.invoke-child",
            input: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });

        const result = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "delegate"},
        });

        expect(child.sessionId).toBe(2);
        expect(result.finalMessage).toBe("parent after child");
        const context = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        const toolResult = context.messages.find((message): message is RuntimeMessage & {role: "toolResult"} => {
            return message.role === "toolResult" && message.toolName === "invoke_agent";
        });
        expect(toolResult).toEqual(expect.objectContaining({
            role: "toolResult",
            details: expect.objectContaining({
                sessionId: child.sessionId,
                status: "completed",
                reportResult: expect.objectContaining({
                    result: "child done",
                    data: {
                        answer: "structured child data",
                    },
                }),
            }),
        }));
        expect(JSON.parse(messageText(toolResult!))).toEqual(expect.objectContaining({
            sessionId: child.sessionId,
            status: "completed",
            reportResult: expect.objectContaining({
                data: {
                    answer: "structured child data",
                },
            }),
        }));
        expect(toolResult?.details).not.toHaveProperty("events");
        expect(context.messages.some((message) => message.role === "toolResult" && Boolean((message.details as {events?: unknown} | undefined)?.events))).toBe(false);
    });

    it("invoke_agent 拒绝调用当前 session 自己，避免自递归 active invocation", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.invoke-self",
                name: "Invoke Self",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["invoke_agent"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("invoke_agent", {
                    sessionId: 1,
                    mode: "prompt",
                    message: "call myself",
                }, {id: "invoke-self"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("handled self error")),
        ]);
        const session = await harness.createAgent({
            profileKey: "test.invoke-self",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: session.sessionId,
            mode: "prompt",
            message: {text: "delegate"},
        });

        expect(result.finalMessage).toBe("handled self error");
        const context = harness.repo.reduce(await harness.repo.readSession(session.sessionId));
        const toolResult = context.messages.find((message) => message.role === "toolResult");
        expect(toolResult ? messageText(toolResult) : "").toContain("不能调用当前 session 自己");
    });

    it("create_agent 工具 schema 要求 input 是 object，不再引导模型传 JSON string", () => {
        const tool = harness.tools.get("create_agent");
        expect(tool).toBeDefined();
        expect(tool?.description).toContain("not a JSON string");
        expect(tool?.description).not.toContain("JSON-stringified");
        expect(Value.Check(tool!.parameters, {
            profileKey: "writer",
            input: {
                prompt: "write",
                chapterPaths: ["manuscript/001/"],
            },
        })).toBe(true);
        expect(Value.Check(tool!.parameters, {
            profileKey: "writer",
            input: "{\"prompt\":\"write\"}",
        })).toBe(false);
        expect(Value.Check(tool!.parameters, {
            profileKey: "writer",
            input: null,
        })).toBe(false);
    });

    it("create_agent 工具兼容 legacy input fallback，并拒绝非 object input", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.create-agent-parent",
                name: "Create Agent Parent",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["create_agent"],
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.create-agent-child",
                name: "Create Agent Child",
            },
            inputSchema: Type.Object({
                role: Type.String(),
            }),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    input: "{\"role\":\"draft\"}",
                }, {id: "create-json"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("created"),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.create-agent-parent",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "create"},
        });

        expect(result.status).toBe("completed");
        expect(await harness.getAgent(undefined, parent.sessionId)).toEqual([
            expect.objectContaining({
                profileKey: "test.create-agent-child",
            }),
        ]);

        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    input: null,
                }, {id: "create-null"} as never),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("created from null"),
        ]);

        await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "create with null"},
        });
        expect(await harness.getAgent(undefined, parent.sessionId)).toEqual(expect.arrayContaining([
            expect.objectContaining({
                profileKey: "test.create-agent-child",
            }),
        ]));

        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("create_agent", {
                    profileKey: "test.create-agent-child",
                    input: "role=draft",
                }, {id: "create-kv"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("after error"),
        ]);

        await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "bad create"},
        });
        const context = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        expect(visibleMessageText(context.messages)).toContain("create_agent.input 必须是 JSON object");
    });

    it("get_agent_profile 返回 profile schema 摘要和 allowed tools", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.profile-parent",
                name: "Profile Parent",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["get_agent_profile"],
            prepare() {
                return {};
            },
        }), false);
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.profile-detail",
                name: "Profile Detail",
                description: "Detail target.",
            },
            inputSchema: Type.Object({
                prompt: Type.String({description: "Task prompt."}),
            }),
            outputSchema: Type.Object({
                summary: Type.String({description: "Result summary."}),
            }),
            allowedToolKeys: ["read", "report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("get_agent_profile", {
                    profileKey: "test.profile-detail",
                }, {id: "profile-detail"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("profile read"),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.profile-parent",
            input: {},
            workspaceRoot: root,
        });

        await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "read profile"},
        });

        const context = harness.repo.reduce(await harness.repo.readSession(parent.sessionId));
        const text = visibleMessageText(context.messages);
        expect(text).toContain("test.profile-detail");
        expect(text).toContain("allowedToolKeys");
        expect(text).toContain("Task prompt.");
        expect(text).toContain("reportResultSchema");
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
        const steered = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "steer",
            message: {text: "adjust"},
        });

        const snapshot = await harness.getSessionSnapshot(parent.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(queued.status).toBe("waiting");
        expect(steered.status).toBe("waiting");
        expect(steered.queuedItem).toEqual(expect.objectContaining({
            kind: "steer",
            message: {text: "adjust"},
        }));
        expect(snapshot.pendingApproval).toEqual({
            toolCallId: "ask-snapshot",
            toolName: "request_user_input",
            args: {
                questions: [{question: "Name?"}],
            },
        });
        expect(snapshot.followUpQueue.items).toEqual([
            expect.objectContaining({
                kind: "followup",
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
        expect(snapshot.steerQueue).toEqual([
            expect.objectContaining({
                kind: "steer",
                message: {text: "adjust"},
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

    it("steer 在 safe point 一次性 drain，followUp 等 loop 结束后逐条开启新 loop", async () => {
        harness.tools.register({
            key: "continue_once",
            name: "continue_once",
            label: "Continue Once",
            description: "让当前 loop 继续一次。",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continued"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.steer-loop",
                name: "Steer Loop",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["continue_once"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("continue_once", {}, {id: "continue-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("after steer"),
            fauxAssistantMessage("after followup"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.steer-loop",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "first steer"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "second steer"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });

        const result = await running;

        expect(result.status).toBe("completed");
        const context = await waitForSessionText(harness, created.sessionId, "queued followup");
        const text = visibleMessageText(context.messages);
        expect(text).toContain("first steer");
        expect(text).toContain("second steer");
        expect(text).toContain("queued followup");
        expect(text.indexOf("first steer")).toBeLessThan(text.indexOf("after steer"));
        expect(text.indexOf("queued followup")).toBeGreaterThan(text.indexOf("after steer"));
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.steerQueue).toEqual([]);
        expect(snapshot.followUpQueue.items).toEqual([]);
    });

    it("waiting_user 期间入队的 steer 会在 resolution 后下一次模型调用前注入", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.waiting-steer",
                name: "Waiting Steer",
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
                    questions: [{question: "Continue?"}],
                }, {id: "ask-waiting-steer"}),
            ], {stopReason: "toolUse"}),
            (context) => {
                return fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|")));
            },
        ]);
        const created = await harness.createAgent({
            profileKey: "test.waiting-steer",
            input: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "adjust while waiting"},
        });
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-waiting-steer",
                answers: [{questionIndex: 0, text: "go"}],
            },
        });

        expect(waiting.status).toBe("waiting");
        expect(continued.status).toBe("completed");
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const assistantText = [...context.messages].reverse().find((message) => message.role === "assistant");
        expect(assistantText ? messageText(assistantText as never) : "").toContain("adjust while waiting");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user", "assistant"]);
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.steerQueue).toEqual([]);
    });

    it("idle session 拒绝显式 steer 和 followUp，避免生成无法消费的队列", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "late"},
        })).rejects.toThrow("active_invocation_required");
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "later"},
        })).rejects.toThrow("active_invocation_required");

        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.steerQueue).toEqual([]);
        expect(snapshot.followUpQueue.items).toEqual([]);
    });

    it("loop 已经越过最后可引导点时拒绝 steer", async () => {
        faux.setResponses([
            fauxAssistantMessage("done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        let steerError = "";

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
            async onEvent(event) {
                if (event.type !== "agent_end") {
                    return;
                }
                try {
                    await harness.invokeAgent({
                        sessionId: created.sessionId,
                        mode: "steer",
                        message: {text: "too late"},
                    });
                } catch (error) {
                    steerError = error instanceof Error ? error.message : String(error);
                }
            },
        });

        expect(result.status).toBe("completed");
        expect(steerError).toBe("steer_not_available");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.steerQueue).toEqual([]);
    });

    it("waiting 状态 abort 会写 aborted lifecycle 并释放 active invocation", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-queue",
                name: "Abort Queue",
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
                    questions: [{question: "Wait?"}],
                }, {id: "abort-queue"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.abort-queue",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });

        await harness.abortInvocation(created.sessionId, {reason: "stop"});
        faux.setResponses([fauxAssistantMessage("after abort")]);
        const next = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "after abort prompt"},
        });
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(next.status).toBe("completed");
        expect(snapshot.activeInvocation).toBeNull();
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            invocationId: waiting.invocationId,
            status: "aborted",
        }));
    });

    it("abort clearQueue 会清空已持久化的 followUp queue projection", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-persisted-queue",
                name: "Abort Persisted Queue",
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
                    questions: [{question: "Wait?"}],
                }, {id: "abort-persisted-queue"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.abort-persisted-queue",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });

        await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: true});
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        restored.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.abort-persisted-queue",
                name: "Abort Persisted Queue",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        }), false);
        const snapshot = await restored.getSessionSnapshot(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(snapshot.followUpQueue).toEqual({
            status: "ready",
            items: [],
        });
    });

    it("模型错误结束时清理已入队但无法再消费的 steer", async () => {
        faux.setResponses([
            fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "will be cleared"},
        });
        const result = await running;

        expect(result.status).toBe("error");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.steerQueue).toEqual([]);
    });

    it("模型错误后暂停 followUp queue，不自动消费", async () => {
        faux.setResponses([
            fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"}),
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        const result = await running;

        expect(result.status).toBe("error");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "error",
            },
            items: [expect.objectContaining({
                kind: "followup",
                message: {text: "queued followup"},
            })],
        });
        expect(faux.getPendingResponseCount()).toBe(1);
    });

    it("running 状态 abort 会写 aborted lifecycle 并按 aborted 暂停 followUp queue", async () => {
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("stopped", {stopReason: "aborted", errorMessage: "user stopped"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: false});
        const result = await running;
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(result.status).toBe("error");
        expect(snapshot.activeInvocation).toBeNull();
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            invocationId: result.invocationId,
            status: "aborted",
        }));
        expect(snapshot.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "aborted",
            },
            items: [expect.objectContaining({
                kind: "followup",
                message: {text: "queued followup"},
            })],
        });
        expect(faux.getPendingResponseCount()).toBe(1);
    });

    it("followUp queue 状态会作为 projection 持久化并能被新 harness snapshot 恢复", async () => {
        faux.setResponses([
            fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        const result = await running;
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });

        const snapshot = await restored.getSessionSnapshot(created.sessionId);

        expect(result.status).toBe("error");
        expect(snapshot.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "error",
            },
            items: [expect.objectContaining({
                kind: "followup",
                message: {text: "queued followup"},
            })],
        });
    });

    it("模型 partial error 只保存文本并剥离 tool call", async () => {
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("half answer"),
                fauxToolCall("read", {path: "x"}, {id: "partial-tool"}),
            ], {stopReason: "error", errorMessage: "stream dropped"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const assistantEntry = snapshot.entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");

        expect(result.status).toBe("error");
        expect(result.errorInfo).toEqual(expect.objectContaining({
            message: "stream dropped",
            phase: "model",
        }));
        expect(assistantEntry).toEqual(expect.objectContaining({
            type: "message",
            status: "partial",
        }));
        expect(assistantEntry && assistantEntry.type === "message" ? messageText(assistantEntry.message) : "").toBe("half answer");
        expect(assistantEntry && assistantEntry.type === "message" && assistantEntry.message.role === "assistant"
            ? assistantEntry.message.content.some((block) => block.type === "toolCall")
            : true).toBe(false);
    });

    it("safe point drain 期间拒绝新的 steer，避免成功入队后被清理", async () => {
        harness.tools.register({
            key: "finish_once",
            name: "finish_once",
            label: "Finish Once",
            description: "执行后让当前 loop 结束。",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "finished"}],
                    details: {},
                    terminate: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.drain-window",
                name: "Drain Window",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["finish_once"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("finish_once", {}, {id: "finish-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("after steer"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.drain-window",
            input: {},
            workspaceRoot: root,
        });
        let lateSteerError = "";
        let triedLateSteer = false;

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
            async onEvent(event) {
                if (triedLateSteer || event.type !== "turn_end") {
                    return;
                }
                triedLateSteer = true;
                try {
                    await harness.invokeAgent({
                        sessionId: created.sessionId,
                        mode: "steer",
                        message: {text: "too late during drain"},
                    });
                } catch (error) {
                    lateSteerError = error instanceof Error ? error.message : String(error);
                }
            },
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "first steer"},
        });

        const result = await running;

        expect(result.status).toBe("completed");
        expect(lateSteerError).toBe("steer_not_available");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        expect(snapshot.steerQueue).toEqual([]);
        const contextText = visibleMessageText(harness.repo.reduce(await harness.repo.readSession(created.sessionId)).messages);
        expect(contextText).toContain("first steer");
        expect(contextText).not.toContain("too late during drain");
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
        expect(await harness.listSessions({workspaceKey: "global"})).toEqual([]);
        expect(await harness.listSessions({workspaceKey: "global", includeArchived: true})).toHaveLength(1);
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
        const activeText = afterRetry.messages.map((message) => messageText(message as never));
        expect(activeText).toContain("run");
        expect(activeText.at(-1)).toContain("retry after user");
    });

    it("tree empty 会清空当前 active leaf 但保留旧 entries，并让下一轮从空历史分支开始", async () => {
        faux.setResponses([
            fauxAssistantMessage(fauxText("first")),
            fauxAssistantMessage(fauxText("after clear")),
        ]);
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "first user"},
        });
        const beforeClear = await harness.getSessionSnapshot(created.sessionId);

        const cleared = await harness.moveTree(created.sessionId, {
            position: "empty",
        });

        expect(cleared.snapshot.activeLeafId).toBeNull();
        expect(cleared.snapshot.messages).toEqual([]);
        expect((await harness.repo.readSession(created.sessionId)).entries.length).toBeGreaterThan(beforeClear.entries.length);
        expect(cleared.snapshot.tree.some((node) => node.type === "message" && !node.active)).toBe(true);

        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "second user"},
        });
        const afterPrompt = await harness.getSessionSnapshot(created.sessionId);
        const llmMessages = afterPrompt.messages.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult");
        expect(llmMessages.map((message) => messageText(message))).toEqual(expect.arrayContaining(["second user", "after clear"]));
        expect(messageText(llmMessages.at(-1) as never)).toBe("after clear");
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
            enableSessionSummarizer: false,
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

    it("session snapshot 返回当前 session 被哪些 agent 绑定", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.linked-by",
                name: "Linked By",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["request_user_input"],
            prepare() {
                return {};
            },
        });
        harness.profiles.register(profile, false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("request_user_input", {
                    questions: [{question: "Continue?"}],
                }, {id: "linked-by-wait"}),
            ], {stopReason: "toolUse"}),
        ]);
        const parent = await harness.createAgent({
            profileKey: "test.linked-by",
            input: {},
            workspaceRoot: root,
        });
        const child = await harness.createAgent({
            profileKey: "test.linked-by",
            input: {},
            workspaceRoot: root,
            parentSessionId: parent.sessionId,
        });
        const waiting = await harness.invokeAgent({
            sessionId: parent.sessionId,
            mode: "prompt",
            message: {text: "wait"},
        });

        const childSnapshot = await harness.getSessionSnapshot(child.sessionId);
        const restored = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(root),
            modelResolver: () => faux.getModel(),
            enableSessionSummarizer: false,
        });
        restored.profiles.register(profile, false);
        const restoredChildSnapshot = await restored.getSessionSnapshot(child.sessionId);
        expect(waiting.status).toBe("waiting");
        expect(childSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                profileKey: "test.linked-by",
                status: "waiting",
                detached: false,
            }),
        ]);
        expect(restoredChildSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                profileKey: "test.linked-by",
                status: "waiting",
                detached: false,
            }),
        ]);

        await harness.detachAgent(child.sessionId, parent.sessionId);
        const detachedSnapshot = await harness.getSessionSnapshot(child.sessionId);
        expect(detachedSnapshot.linkedByAgents).toEqual([
            expect.objectContaining({
                sessionId: parent.sessionId,
                status: "waiting",
                detached: true,
            }),
        ]);
    });

    it("get_session 默认不返回 tree 和历史消息，显式请求时只返回 active path 最近消息", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "hello session"}));

        const session = await harness.getSession(created.sessionId);

        expect(session.metadata.sessionId).toBe(created.sessionId);
        expect(session.activeLeafId).toEqual(expect.any(String));
        expect("tree" in session).toBe(false);
        expect(session.summary).toBe("hello session");
        expect(session.recentMessages).toBeUndefined();

        await harness.repo.appendMessage(created.sessionId, createAssistantTextMessage({text: "assistant reply"}));
        await harness.repo.appendMessage(created.sessionId, createTextToolResult({
            toolCallId: "read-1",
            toolName: "read",
            text: "tool output",
        }));

        const withMessages = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
            recentMessageLimit: 3,
            tokenBudget: 1200,
        });
        expect(withMessages.recentMessages).toEqual([
            expect.objectContaining({
                role: "user",
                text: "hello session",
            }),
            expect.objectContaining({
                role: "assistant",
                text: "assistant reply",
            }),
            expect.objectContaining({
                role: "toolResult",
                text: "tool output",
            }),
        ]);

        const onlyAssistant = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
            recentMessageRoles: ["assistant"],
            recentMessageLimit: 1,
            tokenBudget: 1200,
        });
        expect(onlyAssistant.recentMessages).toEqual([
            expect.objectContaining({
                role: "assistant",
                text: "assistant reply",
            }),
        ]);
    });

    it("provider error 会作为 invoke error 返回且不触发 report_result reminder", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.report-error",
                name: "Report Error",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["report_result"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([], {
                stopReason: "error",
                errorMessage: "Provider rejected image payload",
            }),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.report-error",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "read image"},
        });

        expect(result).toEqual(expect.objectContaining({
            status: "error",
            error: "Provider rejected image payload",
            errorPhase: "model",
            errorInfo: expect.objectContaining({
                message: "Provider rejected image payload",
                phase: "model",
            }),
        }));
        expect(faux.getPendingResponseCount()).toBe(0);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(context.messages.filter((message) => message.role === "assistant")).toHaveLength(0);
        expect(context.messages.some((message) => message.role === "user" && messageText(message).includes("report_result"))).toBe(false);
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            status: "error",
            errorInfo: expect.objectContaining({
                message: "Provider rejected image payload",
                phase: "model",
            }),
        }));
    });

    it("模型前 harness 错误会写 lifecycle error 且不写 assistant message", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.pre-loop-error",
                name: "Pre Loop Error",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                throw new Error("prepare exploded");
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.pre-loop-error",
            input: {},
            workspaceRoot: root,
        });

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        });
        const snapshot = await harness.repo.readSession(created.sessionId);
        const context = harness.repo.reduce(snapshot);

        expect(result).toEqual(expect.objectContaining({
            status: "error",
            error: "prepare exploded",
            errorPhase: "pre_loop",
        }));
        expect(context.messages.filter((message) => message.role === "assistant")).toHaveLength(0);
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "invocation_lifecycle",
            status: "error",
            error: "prepare exploded",
            errorInfo: expect.objectContaining({
                message: "prepare exploded",
                phase: "pre_loop",
            }),
        }));
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
            const snapshot = await harness.getSessionSnapshot(created.sessionId);
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(snapshot.entries).toContainEqual(expect.objectContaining({
                type: "compaction",
                summary: expect.stringContaining("COMPACTED"),
            }));
            expect(snapshot.activeInvocation).toBeNull();
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("started");
        expect(context.messages.some((message) => messageText(message as never).includes("COMPACTED"))).toBe(true);
        expect(context.messages.every((message) => !messageText(message as never).includes("/compact"))).toBe(true);
    });

    it("compact command 失败时写 lifecycle errorInfo", async () => {
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
            const dto = await harness.getSessionSnapshot(created.sessionId);
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(snapshot.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "error",
                errorInfo: expect.objectContaining({
                    phase: "compaction",
                }),
            }));
            expect(dto.activeInvocation).toBeNull();
        });

        expect(result.status).toBe("started");
    });

    it("没有 compaction 配置的 profile 执行 compact command 会写 lifecycle error", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.manual-compact-without-policy",
                name: "Manual Compact Without Policy",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            prepare() {
                return {};
            },
        }), false);
        const created = await harness.createAgent({
            profileKey: "test.manual-compact-without-policy",
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "old context"}));

        const result = await harness.runCommand(created.sessionId, {
            command: "compact",
        });
        await waitFor(async () => {
            const dto = await harness.getSessionSnapshot(created.sessionId);
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(snapshot.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "error",
                errorInfo: expect.objectContaining({
                    phase: "compaction",
                    message: expect.stringContaining("未声明 compaction 配置"),
                }),
            }));
            expect(snapshot.entries.some((entry) => entry.type === "compaction")).toBe(false);
            expect(dto.activeInvocation).toBeNull();
        });

        expect(result.status).toBe("started");
    });

    it("profile 内 session variable definition 会进入工具 registry", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.session-vars",
                name: "Session Vars",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["variable_read", "variable_patch"],
            variableDefinitions: [
                defineSessionVariable({
                    key: "affections",
                    schema: Type.Record(Type.String(), Type.Number()),
                    writableBy: ["agent"],
                }),
            ],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("variable_read", {
                    namespace: "session",
                    path: "affections",
                }, {id: "vars-read-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("variable_patch", {
                    namespace: "session",
                    path: "affections",
                    patch: [{
                        op: "replace",
                        path: "",
                        value: {
                            alice: 3,
                        },
                    }],
                }, {id: "vars-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage(fauxText("done")),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.session-vars",
            input: {},
            workspaceRoot: root,
        });
        const events: string[] = [];
        const subscription = harness.subscribeSessionEvents(created.sessionId);
        const iterator = subscription[Symbol.asyncIterator]();
        const reader = (async () => {
            for (;;) {
                const next = await iterator.next();
                if (next.done) {
                    return;
                }
                const event = next.value;
                if (event.kind === "runtime" && event.event.type === "agent_end") {
                    return;
                }
                if (event.kind === "session") {
                    if (event.event.type === "session_entry" && event.event.entry.type === "variable_patch") {
                        events.push("variable_patch_entry");
                    }
                    if (event.event.type === "session_state_changed" && event.event.state.summary.sessionId === created.sessionId) {
                        events.push("variable_patch_state");
                    }
                    if (events.includes("variable_patch_entry") && events.includes("variable_patch_state")) {
                        return;
                    }
                }
            }
        })();

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "update vars"},
            block: true,
        });
        await reader;
        await iterator.return?.();
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(result.status).toBe("completed");
        expect(events).toEqual(expect.arrayContaining(["variable_patch_entry", "variable_patch_state"]));
        expect(snapshot.entries).toContainEqual(expect.objectContaining({
            type: "variable_patch",
            namespace: "session",
            path: "affections",
        }));
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
