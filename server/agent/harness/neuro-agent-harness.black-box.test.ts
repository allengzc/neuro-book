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
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentMessage, Message as RuntimeMessage} from "nbook/server/agent/messages/types";
import type {AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";
import type {InvokeAgentResult} from "nbook/server/agent/harness/types";
import type {NeuroSessionContext, SessionEntry} from "nbook/server/agent/session/types";

type ObservedRun = {
    result: InvokeAgentResult;
    events: AgentSessionEventDto[];
    snapshot: AgentSessionSnapshotDto;
    context: NeuroSessionContext;
};

type EventTrace = Array<{
    kind: AgentSessionEventDto["kind"];
    type: string;
    seq: number;
    invocationId?: string;
    messageRole?: string;
    entryType?: string;
    toolName?: string;
    status?: string;
}>;

type EventObserver = {
    events: AgentSessionEventDto[];
    stop(): Promise<void>;
};

function registerPlainProfile(
    harness: NeuroAgentHarness,
    input: {
        key: string;
        allowedToolKeys?: readonly string[];
    },
): string {
    harness.profiles.register(defineAgentProfile({
        manifest: {
            key: input.key,
            name: input.key,
        },
        inputSchema: Type.Object({}),
        allowedToolKeys: input.allowedToolKeys ?? [],
        prepare() {
            return {};
        },
    }), false);
    return input.key;
}

function visibleText(messages: AgentMessage[]): string {
    return messages
        .filter((message): message is RuntimeMessage => message.role !== "custom")
        .map(messageText)
        .join("\n");
}

function eventType(event: AgentSessionEventDto): string {
    return event.event.type;
}

function trace(events: AgentSessionEventDto[]): EventTrace {
    return events.map((event) => {
        const payload = event.event;
        return {
            kind: event.kind,
            type: payload.type,
            seq: event.seq,
            invocationId: event.invocationId,
            messageRole: "message" in payload ? payload.message.role : undefined,
            entryType: "entry" in payload ? payload.entry.type : undefined,
            toolName: "toolName" in payload ? payload.toolName : undefined,
            status: "status" in payload ? String(payload.status) : undefined,
        };
    });
}

function eventTypes(events: AgentSessionEventDto[]): string[] {
    return events.map(eventType);
}

function sessionRoles(context: NeuroSessionContext): string[] {
    return context.messages.map((message) => message.role);
}

function lifecycleStatuses(snapshot: AgentSessionSnapshotDto): string[] {
    return snapshot.entries
        .filter((entry): entry is SessionEntry & {type: "invocation_lifecycle"} => entry.type === "invocation_lifecycle")
        .map((entry) => entry.status);
}

function firstIndex(events: AgentSessionEventDto[], type: string, predicate: (event: AgentSessionEventDto) => boolean = () => true): number {
    return events.findIndex((event) => event.event.type === type && predicate(event));
}

function expectOrdered(events: AgentSessionEventDto[], first: string, second: string): void {
    const firstAt = firstIndex(events, first);
    const secondAt = firstIndex(events, second);
    expect({first, firstAt, second, secondAt, trace: trace(events)}).toEqual(expect.objectContaining({
        firstAt: expect.any(Number),
        secondAt: expect.any(Number),
    }));
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(secondAt).toBeGreaterThan(firstAt);
}

async function observeSession(harness: NeuroAgentHarness, sessionId: number): Promise<EventObserver> {
    const subscription = harness.subscribeSessionEvents(sessionId, {
        eventEpoch: harness.eventHub.eventEpoch,
        after: harness.eventHub.lastSeq(sessionId),
    });
    const iterator = subscription[Symbol.asyncIterator]();
    const events: AgentSessionEventDto[] = [];
    const collector = (async () => {
        for (;;) {
            const next = await iterator.next();
            if (next.done) {
                return;
            }
            events.push(next.value);
        }
    })();
    return {
        events,
        async stop() {
            await iterator.return?.();
            await collector;
        },
    };
}

async function runAndObserve(
    harness: NeuroAgentHarness,
    sessionId: number,
    run: () => Promise<InvokeAgentResult>,
): Promise<ObservedRun> {
    const observer = await observeSession(harness, sessionId);
    try {
        const result = await run();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const snapshot = await harness.getSessionSnapshot(sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        return {
            result,
            events: [...observer.events],
            snapshot,
            context,
        };
    } finally {
        await observer.stop();
    }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`等待条件超时：${label}`);
}

describe("NeuroAgentHarness black-box contract", () => {
    let root: string;
    let faux: FauxProviderRegistration;
    let harness: NeuroAgentHarness;

    beforeEach(() => {
        root = join(".agent", "agent-harness-black-box-test", randomUUID());
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

    it("Idle + prompt 会产生 runtime events、session entries 和 completed response", async () => {
        harness.tools.register({
            key: "bb_echo",
            name: "bb_echo",
            label: "BlackBox Echo",
            description: "Echo for black-box tests.",
            parameters: Type.Object({
                text: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                const input = params as {text: string};
                return {
                    content: [{type: "text", text: `echo:${input.text}`}],
                    details: input,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.prompt",
                name: "BlackBox Prompt",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["bb_echo"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("I will call a tool."),
                fauxToolCall("bb_echo", {text: "hello"}, {id: "echo-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("done after tool"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.prompt",
            input: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));

        expect(observed.result.status).toBe("completed");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        expect(lifecycleStatuses(observed.snapshot)).toEqual(["start", "end"]);
        expect(eventTypes(observed.events)).toEqual(expect.arrayContaining([
            "agent_start",
            "turn_start",
            "message_start",
            "message_update",
            "message_end",
            "tool_execution_start",
            "tool_execution_end",
            "turn_end",
            "agent_end",
            "session_entry",
            "session_state_changed",
        ]));
        expectOrdered(observed.events, "agent_start", "turn_start");
        expectOrdered(observed.events, "tool_execution_start", "tool_execution_end");
        expectOrdered(observed.events, "turn_end", "agent_end");
    });

    it("Idle + continue 从现有 dialogue tail 继续且不新增 user message", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.continue",
        });
        faux.setResponses([fauxAssistantMessage("continued")]);
        const created = await harness.createAgent({
            profileKey,
            input: {},
            workspaceRoot: root,
        });
        await harness.repo.appendMessage(created.sessionId, createUserMessage({text: "existing prompt"}));

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
        }));

        expect(observed.result.status).toBe("completed");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant"]);
        expect(visibleText(observed.context.messages)).toContain("existing prompt");
        expect(visibleText(observed.context.messages)).toContain("continued");
    });

    it("Idle + steer/followup 会被 admission 拒绝且不写 session", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.reject",
        });
        const created = await harness.createAgent({
            profileKey,
            input: {},
            workspaceRoot: root,
        });
        const before = await harness.getSessionSnapshot(created.sessionId);

        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "steer"},
        })).rejects.toThrow("active_invocation_required");
        await expect(harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "follow"},
        })).rejects.toThrow("active_invocation_required");

        const after = await harness.getSessionSnapshot(created.sessionId);
        expect(after.entries).toEqual(before.entries);
        expect(after.steerQueue).toEqual([]);
        expect(after.followUpQueue.items).toEqual([]);
    });

    it("Running + steer 入队后只在 safe point drain 成模型可见消息", async () => {
        harness.tools.register({
            key: "bb_continue",
            name: "bb_continue",
            label: "BlackBox Continue",
            description: "Continues the current run.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.steer",
                name: "BlackBox Steer",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["bb_continue"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_continue", {}, {id: "continue-1"}),
            ], {stopReason: "toolUse"}),
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.steer",
            input: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "tool execution start before steer");
            const queued = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                message: {text: "adjust while running"},
            });
            const beforeDrain = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            const snapshot = await harness.getSessionSnapshot(created.sessionId);
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

            expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
            expect(visibleText(beforeDrain.messages)).not.toContain("adjust while running");
            expect(result.status).toBe("completed");
            expect(visibleText(context.messages)).toContain("adjust while running");
            expect(snapshot.steerQueue).toEqual([]);
            expect(eventTypes(observer.events)).toContain("steer_queued");
        } finally {
            await observer.stop();
        }
    });

    it("Running + followup 入队时不写历史，当前 run completed 后自动消费一条", async () => {
        harness.tools.register({
            key: "bb_continue_followup",
            name: "bb_continue_followup",
            label: "BlackBox Followup Continue",
            description: "Continues the current run.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "continue"}],
                    details: {},
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.followup",
                name: "BlackBox Followup",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["bb_continue_followup"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_continue_followup", {}, {id: "continue-followup"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("first run done"),
            fauxAssistantMessage("followup answered"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.followup",
            input: {},
            workspaceRoot: root,
        });

        const running = harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        await waitUntil(() => harness.eventHub.lastSeq(created.sessionId) > 0, "first events before followup");
        const queued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        const beforeDrain = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const result = await running;
        const context = await waitForSessionText(harness, created.sessionId, "queued followup");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(queued.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
        expect(visibleText(beforeDrain.messages)).not.toContain("queued followup");
        expect(result.status).toBe("completed");
        expect(visibleText(context.messages)).toContain("queued followup");
        expect(visibleText(context.messages)).toContain("followup answered");
        expect(snapshot.followUpQueue.items).toEqual([]);
    });

    it("WaitingUser + continue(resolution) 写 resolution toolResult 并复用 invocationId", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.waiting",
                name: "BlackBox Waiting",
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
                }, {id: "ask-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("resumed done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting",
            input: {},
            workspaceRoot: root,
        });

        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const waitingSnapshot = await harness.getSessionSnapshot(created.sessionId);
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-1",
                answers: [{questionIndex: 0, text: "go"}],
            },
        });
        const snapshot = await harness.getSessionSnapshot(created.sessionId);
        const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

        expect(waiting.status).toBe("waiting");
        expect(waitingSnapshot.pendingApproval).toEqual(expect.objectContaining({
            toolCallId: "ask-1",
            toolName: "request_user_input",
        }));
        expect(continued.status).toBe("completed");
        expect(continued.invocationId).toBe(waiting.invocationId);
        expect(lifecycleStatuses(snapshot)).toEqual(["start", "waiting", "resumed", "end"]);
        expect(sessionRoles(context)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    });

    it("WaitingUser 期间 prompt/followup/steer 入队但不写 durable history", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.waiting-queue",
                name: "BlackBox Waiting Queue",
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
                }, {id: "ask-queue"}),
            ], {stopReason: "toolUse"}),
            (context) => fauxAssistantMessage(fauxText(context.messages.map(messageText).join("|"))),
            fauxAssistantMessage("queued prompt answered"),
            fauxAssistantMessage("queued followup answered"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting-queue",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });

        const queuedPrompt = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "queued prompt"},
        });
        const queuedFollowup = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "queued followup"},
        });
        const queuedSteer = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "steer",
            message: {text: "queued steer"},
        });
        const beforeResume = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
        const continued = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "continue",
            resolution: {
                kind: "user_input",
                toolCallId: "ask-queue",
                answers: [{questionIndex: 0, text: "go"}],
            },
        });
        const context = await waitForSessionText(harness, created.sessionId, "queued followup");
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(waiting.status).toBe("waiting");
        expect(queuedPrompt.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
        expect(queuedFollowup.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
        expect(queuedSteer.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
        expect(visibleText(beforeResume.messages)).not.toContain("queued prompt");
        expect(visibleText(beforeResume.messages)).not.toContain("queued followup");
        expect(visibleText(beforeResume.messages)).not.toContain("queued steer");
        expect(continued.status).toBe("completed");
        expect(visibleText(context.messages)).toContain("queued steer");
        expect(visibleText(context.messages)).toContain("queued prompt");
        expect(visibleText(context.messages)).toContain("queued followup");
        expect(snapshot.steerQueue).toEqual([]);
        expect(snapshot.followUpQueue.items).toEqual([]);
    });

    it("provider error before stream 保留 user message、不写空 assistant，并写 error lifecycle", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.provider-error",
        });
        faux.setResponses([
            fauxAssistantMessage([], {stopReason: "error", errorMessage: "provider failed"}),
        ]);
        const created = await harness.createAgent({
            profileKey,
            input: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        }));

        expect(observed.result.status).toBe("error");
        expect(observed.result.errorInfo).toEqual(expect.objectContaining({
            message: "provider failed",
            phase: "model",
        }));
        expect(sessionRoles(observed.context)).toEqual(["user"]);
        expect(lifecycleStatuses(observed.snapshot)).toEqual(["start", "error"]);
        expect(eventTypes(observed.events)).toContain("agent_end");
    });

    it("provider partial error 保存文本并剥离未闭合 tool call", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.partial-error",
        });
        faux.setResponses([
            fauxAssistantMessage([
                fauxText("half answer"),
                fauxToolCall("read", {path: "x"}, {id: "partial-tool"}),
            ], {stopReason: "error", errorMessage: "stream dropped"}),
        ]);
        const created = await harness.createAgent({
            profileKey,
            input: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        }));
        const assistantEntry = observed.snapshot.entries.find((entry) => entry.type === "message" && entry.message.role === "assistant");

        expect(observed.result.status).toBe("error");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant"]);
        expect(assistantEntry).toEqual(expect.objectContaining({
            type: "message",
            status: "partial",
        }));
        expect(assistantEntry && assistantEntry.type === "message" ? messageText(assistantEntry.message) : "").toBe("half answer");
        expect(assistantEntry && assistantEntry.type === "message" && assistantEntry.message.role === "assistant"
            ? assistantEntry.message.content.some((block) => block.type === "toolCall")
            : true).toBe(false);
    });

    it("recoverable tool error 作为普通 toolResult 提交并允许模型继续", async () => {
        harness.tools.register({
            key: "bb_recoverable_error",
            name: "bb_recoverable_error",
            label: "BlackBox Recoverable Error",
            description: "Returns an error tool result.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "recoverable failed"}],
                    details: {},
                    isError: true,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.recoverable-tool",
                name: "BlackBox Recoverable Tool",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["bb_recoverable_error"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_recoverable_error", {}, {id: "recoverable-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("handled recoverable error"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.recoverable-tool",
            input: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));
        const toolResult = observed.context.messages.find((message) => message.role === "toolResult");

        expect(observed.result.status).toBe("completed");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        expect(toolResult).toEqual(expect.objectContaining({
            role: "toolResult",
            isError: false,
        }));
        expect(toolResult ? messageText(toolResult) : "").toBe("recoverable failed");
        expect(visibleText(observed.context.messages)).toContain("handled recoverable error");
    });

    it("fatal tool error 生成 error toolResult 闭合 tool call，并以 error terminal 结束", async () => {
        harness.tools.register({
            key: "bb_fatal",
            name: "bb_fatal",
            label: "BlackBox Fatal",
            description: "Throws.",
            parameters: Type.Object({}),
            async execute() {
                throw new Error("fatal tool failure");
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.fatal-tool",
                name: "BlackBox Fatal Tool",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["bb_fatal"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("bb_fatal", {}, {id: "fatal-1"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.fatal-tool",
            input: {},
            workspaceRoot: root,
        });

        const observed = await runAndObserve(harness, created.sessionId, () => harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "run"},
        }));
        const toolResult = observed.context.messages.find((message) => message.role === "toolResult");

        expect(observed.result.status).toBe("error");
        expect(observed.result.errorInfo?.phase).toBe("model");
        expect(sessionRoles(observed.context)).toEqual(["user", "assistant", "toolResult"]);
        expect(toolResult).toEqual(expect.objectContaining({
            role: "toolResult",
            isError: true,
        }));
        expect(lifecycleStatuses(observed.snapshot)).toEqual(["start", "error"]);
    });

    it("terminal error 后清理 steer 并暂停 followup queue", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.terminal-error-queue",
        });
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("failed", {stopReason: "error", errorMessage: "provider failed"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey,
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
        await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "followup",
            message: {text: "will be paused"},
        });
        const result = await running;
        const snapshot = await harness.getSessionSnapshot(created.sessionId);

        expect(result.status).toBe("error");
        expect(snapshot.steerQueue).toEqual([]);
        expect(snapshot.followUpQueue).toEqual({
            status: "paused",
            pausedBy: {
                invocationId: result.invocationId,
                reason: "error",
            },
            items: [expect.objectContaining({
                kind: "followup",
                message: {text: "will be paused"},
            })],
        });
        expect(faux.getPendingResponseCount()).toBe(1);
    });

    it("WaitingUser + abort 写 abort resolution、aborted lifecycle 并释放 active", async () => {
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.waiting-abort",
                name: "BlackBox Waiting Abort",
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
                }, {id: "abort-waiting"}),
            ], {stopReason: "toolUse"}),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.waiting-abort",
            input: {},
            workspaceRoot: root,
        });
        const waiting = await harness.invokeAgent({
            sessionId: created.sessionId,
            mode: "prompt",
            message: {text: "start"},
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const aborted = await harness.abortInvocation(created.sessionId, {reason: "user stop"});
            await new Promise((resolve) => setTimeout(resolve, 0));
            const snapshot = await harness.getSessionSnapshot(created.sessionId);
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));
            const abortToolResult = context.messages.find((message) => message.role === "toolResult");

            expect(waiting.status).toBe("waiting");
            expect(aborted).toEqual({
                status: "aborted",
                sessionId: created.sessionId,
            });
            expect(snapshot.activeInvocation).toBeNull();
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "waiting", "aborted"]);
            expect(sessionRoles(context)).toEqual(["user", "assistant", "toolResult"]);
            expect(abortToolResult).toEqual(expect.objectContaining({
                role: "toolResult",
                toolCallId: "abort-waiting",
                isError: true,
            }));
            expect(abortToolResult ? messageText(abortToolResult) : "").toContain("Aborted: user stop");
            expect(eventTypes(observer.events)).toEqual(expect.arrayContaining([
                "session_entry",
                "invocation_aborted",
                "session_state_changed",
            ]));
        } finally {
            await observer.stop();
        }
    });

    it("Running + abort 清理 steer，并按 aborted 暂停 followup queue", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.running-abort",
        });
        faux.setResponses([
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return fauxAssistantMessage("stopped", {stopReason: "aborted", errorMessage: "user stopped"});
            },
            fauxAssistantMessage("must not run"),
        ]);
        const created = await harness.createAgent({
            profileKey,
            input: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "start"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("agent_start"), "agent start before abort queue");
            const queuedSteer = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "steer",
                message: {text: "will be cleared"},
            });
            const queuedFollowup = await harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "followup",
                message: {text: "will be paused"},
            });
            const aborted = await harness.abortInvocation(created.sessionId, {reason: "stop", clearQueue: false});
            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            const snapshot = await harness.getSessionSnapshot(created.sessionId);
            const context = harness.repo.reduce(await harness.repo.readSession(created.sessionId));

            expect(queuedSteer.queuedItem).toEqual(expect.objectContaining({kind: "steer"}));
            expect(queuedFollowup.queuedItem).toEqual(expect.objectContaining({kind: "followup"}));
            expect(aborted).toEqual({
                status: "aborted",
                sessionId: created.sessionId,
            });
            expect(result.status).toBe("error");
            expect(snapshot.activeInvocation).toBeNull();
            expect(snapshot.steerQueue).toEqual([]);
            expect(snapshot.followUpQueue).toEqual({
                status: "paused",
                pausedBy: {
                    invocationId: result.invocationId,
                    reason: "aborted",
                },
                items: [expect.objectContaining({
                    kind: "followup",
                    message: {text: "will be paused"},
                })],
            });
            expect(visibleText(context.messages)).not.toContain("will be cleared");
            expect(visibleText(context.messages)).not.toContain("will be paused");
            expect(lifecycleStatuses(snapshot)).toEqual(["start", "aborted"]);
            expect(eventTypes(observer.events)).toEqual(expect.arrayContaining([
                "steer_queued",
                "follow_up_queued",
                "invocation_aborted",
                "session_state_changed",
                "agent_end",
            ]));
            expect(faux.getPendingResponseCount()).toBe(1);
        } finally {
            await observer.stop();
        }
    });

    it("SSE replay 和 snapshot_required 合同可从 Harness event hub 观察", async () => {
        const profileKey = registerPlainProfile(harness, {
            key: "test.blackbox.sse-replay",
        });
        const created = await harness.createAgent({
            profileKey,
            input: {},
            workspaceRoot: root,
        });
        const currentEpoch = harness.eventHub.eventEpoch;
        harness.eventHub.publish({
            sessionId: created.sessionId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "old",
            },
        });
        const replay = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: currentEpoch,
            after: 0,
        })[Symbol.asyncIterator]();
        const future = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: currentEpoch,
            after: 426,
        })[Symbol.asyncIterator]();
        const oldEpoch = harness.subscribeSessionEvents(created.sessionId, {
            eventEpoch: "old-epoch",
            after: 0,
        })[Symbol.asyncIterator]();
        const newEvent = harness.eventHub.publish({
            sessionId: created.sessionId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: "new",
            },
        });

        await expect(replay.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                eventEpoch: currentEpoch,
                seq: 1,
            }),
        });
        await expect(future.next()).resolves.toEqual({
            done: false,
            value: expect.objectContaining({
                eventEpoch: currentEpoch,
                event: expect.objectContaining({
                    type: "snapshot_required",
                    reason: "event cursor is ahead of server",
                }),
            }),
        });
        await expect(oldEpoch.next()).resolves.toEqual({
            done: false,
            value: newEvent,
        });

        await replay.return?.();
        await future.return?.();
        await oldEpoch.return?.();
    });

    it("slow tool 未完成前已经能观察到 tool 参数与 tool_execution_start", async () => {
        let releaseTool = () => {};
        const toolBlocker = new Promise<void>((resolve) => {
            releaseTool = resolve;
        });
        harness.tools.register({
            key: "slow_tool",
            name: "slow_tool",
            label: "Slow Tool",
            description: "Waits until released.",
            parameters: Type.Object({
                text: Type.String(),
            }),
            async execute(_toolCallId, params: unknown) {
                await toolBlocker;
                const input = params as {text: string};
                return {
                    content: [{type: "text", text: `slow:${input.text}`}],
                    details: input,
                };
            },
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {
                key: "test.blackbox.slow-tool",
                name: "BlackBox Slow Tool",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: ["slow_tool"],
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([
                fauxToolCall("slow_tool", {text: "payload"}, {id: "slow-1"}),
            ], {stopReason: "toolUse"}),
            fauxAssistantMessage("slow done"),
        ]);
        const created = await harness.createAgent({
            profileKey: "test.blackbox.slow-tool",
            input: {},
            workspaceRoot: root,
        });
        const observer = await observeSession(harness, created.sessionId);
        try {
            const running = harness.invokeAgent({
                sessionId: created.sessionId,
                mode: "prompt",
                message: {text: "run slow"},
            });
            await waitUntil(() => eventTypes(observer.events).includes("tool_execution_start"), "slow tool execution start");
            const messageUpdates = observer.events.filter((event) => event.event.type === "message_update");
            const hasToolDelta = messageUpdates.some((event) => {
                return event.event.type === "message_update" && event.event.assistantMessageEvent.type === "toolcall_delta";
            });
            const beforeReleaseTypes = eventTypes(observer.events);

            expect(hasToolDelta).toBe(true);
            expect(beforeReleaseTypes).toContain("tool_execution_start");
            expect(beforeReleaseTypes).not.toContain("tool_execution_end");

            releaseTool();
            const result = await running;
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(result.status).toBe("completed");
            expect(eventTypes(observer.events)).toContain("tool_execution_end");
        } finally {
            releaseTool();
            await observer.stop();
        }
    });
});

async function waitForSessionText(harness: NeuroAgentHarness, sessionId: number, text: string): Promise<NeuroSessionContext> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const context = harness.repo.reduce(await harness.repo.readSession(sessionId));
        if (visibleText(context.messages).includes(text)) {
            return context;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return harness.repo.reduce(await harness.repo.readSession(sessionId));
}
