import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderRegistration} from "@earendil-works/pi-ai";
import {Type} from "typebox";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {createAssistantTextMessage, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {Message, ModelContext, ProfilePrompt, Reminder, System} from "nbook/server/agent/profiles/profile-dsl";
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
                    walkthrough: "ok",
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

    it("新建 Project session 的 agent cwd 使用 Project Workspace 并保留 projectPath", async () => {
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

        expect(context.workspaceRoot).toBe("workspace/novel-7");
        expect(context.projectPath).toBe("workspace/novel-7");
    });

    it("/new 创建的新 session 保留 Project Workspace 和 projectPath", async () => {
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

        expect(context.workspaceRoot).toBe("workspace/novel-7");
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
                    walkthrough: "done",
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
                    walkthrough: "should wait",
                }, {id: "report-after-approval"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage([
                fauxToolCall("report_result", {
                    walkthrough: "done after approval",
                }, {id: "report-after-resolution"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.approval-batch-barrier",
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
        expect(waitingContext.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
        expect(messageText(waitingContext.messages[2] as never)).toContain("waiting for user approval");
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

        const sessionPath = join(root, ".nbook", "agent", "sessions", "global", `${String(created.sessionId)}.jsonl`);
        const records = (await readFile(sessionPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {kind: string; entries?: Array<{type: string; message?: {role?: string}}>});
        const turnBatches = records
            .filter((record) => record.kind === "batch")
            .map((record) => record.entries?.filter((entry) => entry.type === "message").map((entry) => entry.message?.role));
        expect(turnBatches).toEqual([
            ["assistant", "toolResult"],
            ["assistant"],
        ]);
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
                    walkthrough: "done",
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
        const subscription = harness.subscribeSessionEvents(created.sessionId, harness.eventHub.lastSeq);
        const pendingAfterContinue: Array<string | null> = [];
        const collect = (async () => {
            for await (const event of subscription) {
                if (event.kind === "session" && event.event.type === "session_state_changed" && event.event.snapshot) {
                    pendingAfterContinue.push(event.event.snapshot.pendingApproval?.toolCallId ?? null);
                }
                if (event.kind === "pi" && event.event.type === "agent_end") {
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
                    walkthrough: "fixed",
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

    it("ModelContext 内 Reminder 会按 AppendingSet 语义提前写入并推送 snapshot", async () => {
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
        const sessionStates: string[][] = [];
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
                if (event.kind === "session" && event.event.type === "session_state_changed" && event.event.snapshot) {
                    sessionStates.push(event.event.snapshot.entries
                        .filter((entry) => entry.type === "custom_message" || entry.type === "message")
                        .map((entry) => entry.type === "custom_message"
                            ? messageText(entry.message as never)
                            : messageText(entry.message as never)));
                }
                if (event.kind === "pi" && event.event.type === "agent_end") {
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
        expect(sessionStates.some((texts) => texts.includes("MODEL_REMINDER") && !texts.includes("PROMPT"))).toBe(true);
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
            allowedToolKeys: [],
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
            fauxAssistantMessage(fauxText("child done")),
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
                finalMessage: "child done",
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

    it("create_agent 工具接受 JSON string object input，并拒绝非 object input", async () => {
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
        expect(snapshot.followUpQueue).toEqual([
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
        expect(snapshot.followUpQueue).toEqual([]);
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
        expect(snapshot.followUpQueue).toEqual([]);
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

    it("aborting 状态拒绝新的 steer 和 followUp queue", async () => {
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

        expect(waiting.status).toBe("waiting");
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "no"},
        })).rejects.toThrow("active_invocation_aborting");
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "no later"},
        })).rejects.toThrow("active_invocation_aborting");
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
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.linked-by",
                name: "Linked By",
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
        expect(waiting.status).toBe("waiting");
        expect(childSnapshot.linkedByAgents).toEqual([
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

        const withMessages = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
            recentMessageLimit: 1,
            tokenBudget: 1200,
        });
        expect(withMessages.recentMessages).toEqual([
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
        const session = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
        });

        expect(result.status).toBe("completed");
        expect(session.title).toBe("Ingested Title");
        expect(session.summary).toBe("Ingested Summary");
        expect(session.recentMessages?.map((message) => message.text)).toContain("ingested");
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
        const session = await harness.getSession({
            sessionId: created.sessionId,
            includeRecentMessages: true,
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("profileKey");
        expect(session.recentMessages?.every((message) => message.text !== "should not write")).toBe(true);
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
        }));
        expect(faux.getPendingResponseCount()).toBe(0);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const snapshot = await harness.repo.readSession(created.sessionId);
        expect(context.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
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
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            expect(context.messages[0] && messageText(context.messages[0] as never)).toContain("COMPACTED");
        });

        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(result.status).toBe("started");
        expect(context.messages.map((message) => message.role)).toEqual(["user", "user"]);
        expect(context.messages[0] && messageText(context.messages[0] as never)).toContain("COMPACTED");
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
            const snapshot = await harness.repo.readSession(created.sessionId);
            expect(snapshot.entries).toContainEqual(expect.objectContaining({
                type: "invocation_lifecycle",
                status: "error",
                errorInfo: expect.objectContaining({
                    phase: "compaction",
                }),
            }));
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
            allowedToolKeys: ["variable_patch"],
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

        const result = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "update vars"},
            block: true,
        });
        const snapshot = await harness.repo.readSession(created.sessionId);

        expect(result.status).toBe("completed");
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
