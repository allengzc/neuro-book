import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import type {AgentEvent, AgentToolResult} from "@earendil-works/pi-agent-core";
import {streamSimple, validateToolArguments} from "@earendil-works/pi-ai";
import type {AgentMessage, AgentToolCall, AssistantMessage, JsonValue, Message, Model, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createTextToolResult, createToolResultFromResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import type {AgentProfile, PreparedTurn, ProfileIngestResult} from "nbook/server/agent/profiles/types";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionSnapshot} from "nbook/server/agent/session/types";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";
import {handleSlashCommand} from "nbook/server/agent/session/slash-commands";
import {findPendingApprovalCall, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import {createBuiltinTools} from "nbook/server/agent/tools/builtin-tools";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {AgentResolution, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {appendCompaction, compactIfNeeded} from "nbook/server/agent/harness/compaction";
import {resolvePiApiKey, resolvePiModel} from "nbook/server/agent/harness/model-resolver";
import type {AgentSummary, CreateAgentInput, CreateAgentResult, InvokeAgentInput, InvokeAgentResult, SessionQueryResult} from "nbook/server/agent/harness/types";

type HarnessOptions = {
    repo?: JsonlSessionRepository;
    profiles?: AgentProfileCatalog;
    skills?: SkillCatalog;
    tools?: AgentToolRegistry;
    modelResolver?: (profileKey: string) => Model<any>;
};

type RunToolBatchResult = {
    toolResults: ToolResultMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    waiting?: {
        toolCallId: string;
        toolName: string;
    };
    shouldContinue: boolean;
};

/**
 * Neuro Book 自有 Agent Harness。它拥有 session/profile/tool 语义，底层使用 Pi Agent loop。
 */
export class NeuroAgentHarness {
    readonly repo: JsonlSessionRepository;
    readonly profiles: AgentProfileCatalog;
    readonly skills: SkillCatalog;
    readonly tools: AgentToolRegistry;
    private readonly modelResolver: (profileKey: string) => Model<any>;

    constructor(options: HarnessOptions = {}) {
        this.repo = options.repo ?? new JsonlSessionRepository();
        this.profiles = options.profiles ?? new AgentProfileCatalog();
        this.skills = options.skills ?? new SkillCatalog();
        this.tools = options.tools ?? new AgentToolRegistry();
        this.modelResolver = options.modelResolver ?? resolvePiModel;
        this.profiles.register(defaultAgentProfile);
        for (const tool of createBuiltinTools(this)) {
            this.tools.register(tool);
        }
    }

    /**
     * 创建空 agent session。HistorySet 首次 invoke 时再注入。
     */
    async createAgent(input: CreateAgentInput): Promise<CreateAgentResult> {
        const profile = await this.profiles.get(input.profileKey);
        const parsedInput = this.profiles.parseInput(profile, (input.input ?? {}) as JsonValue);
        const snapshot = await this.repo.createSession({
            profileKey: input.profileKey,
            input: parsedInput,
            workspaceRoot: input.workspaceRoot ?? resolve(process.cwd(), "workspace"),
            workspaceKey: input.workspaceKey ?? "global",
            parentSessionId: input.parentSessionId,
            title: profile.manifest.name,
        });
        if (input.parentSessionId) {
            await this.repo.appendEntry(input.parentSessionId, {
                type: "custom",
                key: `agent.link.${snapshot.metadata.sessionId}`,
                value: {
                    sessionId: snapshot.metadata.sessionId,
                    profileKey: input.profileKey,
                },
            });
        }
        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: input.profileKey,
            title: profile.manifest.name,
        };
    }

    /**
     * 调用 agent。prompt 会写入用户消息；continue 只从当前 session 尾部继续。
     */
    async invokeAgent(input: InvokeAgentInput): Promise<InvokeAgentResult> {
        if (input.block === false) {
            throw new Error("block:false 第一版尚未实现");
        }
        const invocationId = randomUUID();
        let snapshot = await this.repo.readSession(input.sessionId);
        let pendingUserMessage: Message | null = null;
        let pendingResolution: AgentResolution | null = null;

        if (input.mode === "prompt") {
            if (!input.message) {
                throw new Error("prompt 模式必须提供 message");
            }
            const slashResult = await handleSlashCommand({
                repo: this.repo,
                sessionId: input.sessionId,
                text: input.message.text,
            });
            if (slashResult.kind === "new" || slashResult.kind === "fork" || slashResult.kind === "tree" || slashResult.kind === "retry") {
                return {
                    sessionId: slashResult.session.metadata.sessionId,
                    invocationId,
                    status: "completed",
                    finalMessage: slashResult.kind,
                    events: [],
                };
            }
            if (slashResult.kind === "compact") {
                try {
                    const context = this.repo.reduce(snapshot);
                    const model = context.model ?? this.modelResolver(context.profileKey);
                    await appendCompaction({
                        repo: this.repo,
                        snapshot,
                        messages: context.messages,
                        model,
                        apiKey: await resolvePiApiKey(model.provider),
                        thinkingLevel: context.thinkingLevel,
                        instructions: slashResult.instructions,
                    });
                    return {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "completed",
                        finalMessage: "compact completed",
                        events: [],
                    };
                } catch (error) {
                    return {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "error",
                        error: error instanceof Error ? error.message : String(error),
                        events: [],
                    };
                }
            }
            pendingUserMessage = createUserMessage(input.message);
        }

        if (input.mode === "continue" && input.resolution) {
            pendingResolution = input.resolution;
        }

        if (pendingResolution) {
            await this.appendResolution(snapshot, pendingResolution);
            snapshot = await this.repo.readSession(input.sessionId);
        }
        const prepared = await this.prepare(snapshot);
        snapshot = await this.repo.readSession(input.sessionId);
        if (pendingUserMessage) {
            await this.repo.appendMessage(input.sessionId, pendingUserMessage, snapshot.metadata.workspaceKey);
            snapshot = await this.repo.readSession(input.sessionId);
        }
        let context = this.repo.reduce(snapshot);
        const model = context.model ?? this.modelResolver(context.profileKey);
        await compactIfNeeded({
            repo: this.repo,
            snapshot,
            messages: [...context.messages, ...(prepared.dynamicMessages ?? [])],
            model,
            apiKey: await resolvePiApiKey(model.provider),
            thinkingLevel: context.thinkingLevel,
        });
        snapshot = await this.repo.readSession(input.sessionId);
        context = this.repo.reduce(snapshot);

        try {
            const result = await this.runLoop({
                sessionId: input.sessionId,
                workspaceKey: snapshot.metadata.workspaceKey,
                workspaceRoot: context.workspaceRoot,
                systemPrompt: prepared.systemPrompt ?? context.systemPrompt,
                messages: [
                    ...context.messages,
                    ...(prepared.dynamicMessages ?? []),
                ],
                model,
                toolKeys: prepared.toolKeys ?? [],
                thinkingLevel: context.thinkingLevel,
                onEvent: input.onEvent,
            });
            if (result.waiting) {
                return {
                    sessionId: input.sessionId,
                    invocationId,
                    status: "waiting",
                    finalMessage: `waiting for ${result.waiting.toolName}`,
                    usage: result.finalAssistant?.usage,
                    events: result.events,
                };
            }

            if (!result.reportResult && (prepared.toolKeys ?? []).includes("report_result")) {
                return this.remindReportResult(input, invocationId, result.events, result.finalAssistant, {
                    workspaceKey: snapshot.metadata.workspaceKey,
                    workspaceRoot: context.workspaceRoot,
                    systemPrompt: prepared.systemPrompt ?? context.systemPrompt,
                    model,
                    toolKeys: prepared.toolKeys ?? [],
                    thinkingLevel: context.thinkingLevel,
                });
            }

            const ingestError = await this.applyIngest(input.sessionId);
            if (ingestError) {
                return {
                    sessionId: input.sessionId,
                    invocationId,
                    status: "error",
                    error: ingestError,
                    events: result.events,
                };
            }

            return {
                sessionId: input.sessionId,
                invocationId,
                status: "completed",
                finalMessage: result.finalAssistant ? messageText(result.finalAssistant) : undefined,
                reportResult: result.reportResult,
                usage: result.finalAssistant?.usage,
                events: result.events,
            };
        } catch (error) {
            return {
                sessionId: input.sessionId,
                invocationId,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                events: [],
            };
        }
    }

    /**
     * 查询 agent 摘要。无参返回当前未 detach 的 agent。
     */
    async getAgent(sessionId?: number, ownerSessionId?: number): Promise<AgentSummary | AgentSummary[]> {
        if (typeof sessionId === "number") {
            return this.sessionSummary(await this.repo.readSession(sessionId));
        }
        if (typeof ownerSessionId !== "number") {
            return [];
        }
        const ownerSnapshot = await this.repo.readSession(ownerSessionId);
        const context = this.repo.reduce(ownerSnapshot);
        const summaries: AgentSummary[] = [];
        for (const linked of context.linkedAgents) {
            if (linked.detached) {
                continue;
            }
            summaries.push(this.sessionSummary(await this.repo.readSession(linked.sessionId), linked.detached));
        }
        return summaries.sort((left, right) => left.sessionId - right.sessionId);
    }

    /**
     * 解除 link。session 不删除，只写 append-only link 状态。
     */
    async detachAgent(sessionId: number, ownerSessionId?: number): Promise<{sessionId: number; detached: boolean}> {
        if (typeof ownerSessionId === "number") {
            await this.repo.appendEntry(ownerSessionId, {
                type: "custom",
                key: `agent.detach.${sessionId}`,
                value: {
                    sessionId,
                },
            });
        }
        return {
            sessionId,
            detached: true,
        };
    }

    /**
     * 查询轻量 session 信息，不返回完整历史原文。
     */
    async getSession(sessionId?: number, requesterSessionId?: number): Promise<SessionQueryResult> {
        const targetSessionId = sessionId ?? requesterSessionId;
        if (typeof targetSessionId !== "number") {
            throw new Error("get_session 需要 sessionId，或在 agent session 内调用。");
        }
        const snapshot = await this.repo.readSession(targetSessionId);
        const context = this.repo.reduce(snapshot);
        const linkedAgents: AgentSummary[] = [];
        for (const linked of context.linkedAgents) {
            linkedAgents.push(this.sessionSummary(await this.repo.readSession(linked.sessionId), linked.detached));
        }
        const messageEntries = this.repo.activePath(snapshot)
            .filter((entry) => entry.type === "message")
            .slice(-8);
        return {
            metadata: snapshot.metadata,
            activeLeafId: snapshot.leafId,
            tree: this.repo.tree(snapshot),
            title: context.title,
            summary: context.summary,
            usage: [...context.messages].reverse().find((message) => message.role === "assistant")?.usage,
            linkedAgents,
            recentMessages: messageEntries.map((entry) => ({
                role: entry.message.role,
                text: messageText(entry.message).slice(0, 500),
                timestamp: entry.timestamp,
            })),
        };
    }

    private async prepare(snapshot: SessionSnapshot): Promise<PreparedTurn> {
        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const context = this.repo.reduce(snapshot);
        const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
        const prepared = await profile.prepare({
            session: context,
            input: parsedInput as never,
            catalog: await this.profiles.snapshot(),
        });
        const toolKeys = prepared.toolKeys ?? [...profile.allowedToolKeys];

        if (prepared.historyMessages?.length && !context.customState["profile.history.injected"]) {
            for (const message of prepared.historyMessages) {
                await this.repo.appendMessage(snapshot.metadata.sessionId, message, snapshot.metadata.workspaceKey);
            }
            await this.repo.appendEntry(snapshot.metadata.sessionId, {
                type: "custom",
                key: "profile.history.injected",
                value: true,
            }, snapshot.metadata.workspaceKey);
        }
        for (const message of prepared.appendingMessages ?? []) {
            await this.repo.appendMessage(snapshot.metadata.sessionId, message, snapshot.metadata.workspaceKey);
        }
        for (const write of prepared.sessionWrites ?? []) {
            await this.repo.appendEntry(snapshot.metadata.sessionId, write, snapshot.metadata.workspaceKey);
        }

        return {
            ...prepared,
            toolKeys,
        };
    }

    private async applyIngest(sessionId: number): Promise<string | null> {
        try {
            const snapshot = await this.repo.readSession(sessionId);
            const profile = await this.profiles.get(snapshot.metadata.profileKey);
            if (!profile.ingest) {
                return null;
            }
            const context = this.repo.reduce(snapshot);
            const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
            const ingest = await profile.ingest({
                session: context,
                input: parsedInput as never,
                catalog: await this.profiles.snapshot(),
            });
            this.assertValidIngest(profile, ingest);
            for (const message of ingest.messageWrites ?? []) {
                await this.repo.appendMessage(sessionId, message, snapshot.metadata.workspaceKey);
            }
            if (ingest.sessionUpdates?.title || ingest.sessionUpdates?.summary) {
                await this.repo.appendEntry(sessionId, {
                    type: "session_update",
                    updates: ingest.sessionUpdates,
                }, snapshot.metadata.workspaceKey);
            }
            return null;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    private assertValidIngest(profile: AgentProfile, ingest: ProfileIngestResult | undefined): asserts ingest is ProfileIngestResult {
        if (!ingest || typeof ingest !== "object") {
            throw new Error(`profile ${profile.manifest.key} ingest 必须返回对象。`);
        }
        const keys = Object.keys(ingest);
        const allowedKeys = new Set(["messageWrites", "sessionUpdates"]);
        const illegalKey = keys.find((key) => !allowedKeys.has(key));
        if (illegalKey) {
            throw new Error(`profile ${profile.manifest.key} ingest 不允许返回 ${illegalKey}。`);
        }
        const updates = ingest.sessionUpdates;
        if (updates) {
            const updateKeys = Object.keys(updates);
            const allowedUpdateKeys = new Set(["title", "summary"]);
            const illegalUpdateKey = updateKeys.find((key) => !allowedUpdateKeys.has(key));
            if (illegalUpdateKey) {
                throw new Error(`profile ${profile.manifest.key} ingest 不允许更新 ${illegalUpdateKey}。`);
            }
        }
    }

    private async appendResolution(snapshot: SessionSnapshot, resolution: AgentResolution): Promise<void> {
        const context = this.repo.reduce(snapshot);
        const messages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pending = findPendingApprovalCall(messages, this.tools.approvalToolKeys());
        if (!pending) {
            throw new Error("当前 session 没有等待中的审批 tool call");
        }
        await this.repo.appendMessage(snapshot.metadata.sessionId, resolutionToToolResult(resolution, pending), snapshot.metadata.workspaceKey);
    }

    private async runLoop(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        systemPrompt: string;
        messages: AgentMessage[];
        model: Model<any>;
        toolKeys: string[];
        thinkingLevel: string;
        onEvent?: (event: AgentEvent) => void | Promise<void>;
    }): Promise<{
        events: AgentEvent[];
        finalAssistant?: AssistantMessage;
        reportResult?: InvokeAgentResult["reportResult"];
        waiting?: RunToolBatchResult["waiting"];
    }> {
        const events: AgentEvent[] = [];
        const emit = async (event: AgentEvent) => {
            events.push(event);
            await input.onEvent?.(event);
            await this.persistEvent(input.sessionId, input.workspaceKey, event);
        };
        const visibleTools = this.tools.allowed(input.toolKeys);
        const messages = input.messages.slice();
        let reportResult: InvokeAgentResult["reportResult"] | undefined;
        let finalAssistant: AssistantMessage | undefined;

        await emit({type: "agent_start"});
        let shouldContinue = true;
        while (shouldContinue) {
            await emit({type: "turn_start"});
            const assistant = await this.streamAssistant({
                systemPrompt: input.systemPrompt,
                messages,
                model: input.model,
                tools: visibleTools,
                sessionId: input.sessionId,
                thinkingLevel: input.thinkingLevel,
                emit,
            });
            messages.push(assistant);
            finalAssistant = assistant;
            if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
                await emit({type: "turn_end", message: assistant, toolResults: []});
                break;
            }

            const toolCalls = assistant.content.filter((block): block is AgentToolCall => block.type === "toolCall");
            const toolBatch = await this.runToolBatch({
                sessionId: input.sessionId,
                workspaceKey: input.workspaceKey,
                workspaceRoot: input.workspaceRoot,
                assistant,
                toolCalls,
                allowedToolKeys: input.toolKeys,
                emit,
            });
            for (const toolResult of toolBatch.toolResults) {
                messages.push(toolResult);
            }
            reportResult = toolBatch.reportResult ?? reportResult;
            await emit({type: "turn_end", message: assistant, toolResults: toolBatch.toolResults});
            if (toolBatch.waiting) {
                await emit({type: "agent_end", messages});
                return {
                    events,
                    finalAssistant,
                    reportResult,
                    waiting: toolBatch.waiting,
                };
            }
            shouldContinue = toolBatch.shouldContinue;
        }
        await emit({type: "agent_end", messages});
        return {
            events,
            finalAssistant,
            reportResult,
        };
    }

    private async streamAssistant(input: {
        systemPrompt: string;
        messages: AgentMessage[];
        model: Model<any>;
        tools: ReturnType<AgentToolRegistry["allowed"]>;
        sessionId: number;
        thinkingLevel: string;
        emit: (event: AgentEvent) => Promise<void>;
    }): Promise<AssistantMessage> {
        const llmMessages = input.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const stream = await streamSimple(input.model, {
            systemPrompt: input.systemPrompt,
            messages: llmMessages,
            tools: input.tools,
        }, {
            sessionId: String(input.sessionId),
            reasoning: input.thinkingLevel === "off" ? undefined : input.thinkingLevel as never,
            apiKey: await resolvePiApiKey(input.model.provider),
        });

        let started = false;
        for await (const event of stream) {
            const message = "partial" in event ? event.partial : "message" in event ? event.message : "error" in event ? event.error : null;
            if (event.type === "start" && message) {
                started = true;
                await input.emit({type: "message_start", message});
                continue;
            }
            if (event.type === "done" || event.type === "error") {
                const finalMessage = await stream.result();
                if (!started) {
                    await input.emit({type: "message_start", message: finalMessage});
                }
                await input.emit({type: "message_end", message: finalMessage});
                return finalMessage;
            }
            if (message) {
                await input.emit({
                    type: "message_update",
                    message,
                    assistantMessageEvent: event,
                });
            }
        }

        const finalMessage = await stream.result();
        if (!started) {
            await input.emit({type: "message_start", message: finalMessage});
        }
        await input.emit({type: "message_end", message: finalMessage});
        return finalMessage;
    }

    private async runToolBatch(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        assistant: AssistantMessage;
        toolCalls: AgentToolCall[];
        allowedToolKeys: string[];
        emit: (event: AgentEvent) => Promise<void>;
    }): Promise<RunToolBatchResult> {
        if (input.toolCalls.length === 0) {
            return {
                toolResults: [],
                shouldContinue: false,
            };
        }

        const toolResults: ToolResultMessage[] = [];
        let reportResult: InvokeAgentResult["reportResult"] | undefined;
        let allTerminate = true;
        for (const toolCall of input.toolCalls) {
            if (this.tools.approvalToolKeys().includes(toolCall.name)) {
                const approvalError = await this.validateApprovalTool(input.allowedToolKeys, toolCall);
                if (approvalError) {
                    const toolResult = createTextToolResult({
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        text: approvalError,
                        isError: true,
                    });
                    toolResults.push(toolResult);
                    await input.emit({type: "message_start", message: toolResult});
                    await input.emit({type: "message_end", message: toolResult});
                    allTerminate = false;
                    continue;
                }
                return {
                    toolResults,
                    reportResult,
                    waiting: {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                    },
                    shouldContinue: false,
                };
            }

            await input.emit({
                type: "tool_execution_start",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                args: toolCall.arguments,
            });
            const executed = await this.executeTool({
                sessionId: input.sessionId,
                workspaceKey: input.workspaceKey,
                workspaceRoot: input.workspaceRoot,
                allowedToolKeys: input.allowedToolKeys,
                toolCall,
            });
            await input.emit({
                type: "tool_execution_end",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: executed.result,
                isError: executed.isError,
            });
            const toolResult = createToolResultFromResult({
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: executed.result,
                isError: executed.isError,
            });
            toolResults.push(toolResult);
            await input.emit({type: "message_start", message: toolResult});
            await input.emit({type: "message_end", message: toolResult});
            allTerminate = allTerminate && executed.result.terminate === true;
            if (toolCall.name === "report_result" && !executed.isError) {
                reportResult = this.readReportResult(executed.result.details);
            }
        }
        return {
            toolResults,
            reportResult,
            shouldContinue: !allTerminate,
        };
    }

    private async validateApprovalTool(allowedToolKeys: string[], toolCall: AgentToolCall): Promise<string | null> {
        const tool = this.tools.get(toolCall.name);
        if (!tool) {
            return `Tool ${toolCall.name} not found`;
        }
        if (!allowedToolKeys.includes(tool.key)) {
            return `Tool ${toolCall.name} is not allowed by this profile`;
        }
        if (tool.key === "skill") {
            const skillKey = typeof toolCall.arguments.skillKey === "string" ? toolCall.arguments.skillKey : "";
            if (!skillKey) {
                return "skill 工具需要 skillKey。";
            }
            const skill = await this.skills.get(skillKey);
            if (!skill) {
                return `Skill ${skillKey} is not visible in v3 skill catalog`;
            }
        }
        return null;
    }

    private async executeTool(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        allowedToolKeys: string[];
        toolCall: AgentToolCall;
    }): Promise<{
        result: AgentToolResult<unknown>;
        isError: boolean;
    }> {
        const tool = this.tools.get(input.toolCall.name);
        if (!tool) {
            return {
                result: this.errorToolResult(`Tool ${input.toolCall.name} not found`),
                isError: true,
            };
        }
        if (!input.allowedToolKeys.includes(tool.key)) {
            return {
                result: this.errorToolResult(`Tool ${input.toolCall.name} is not allowed by this profile`),
                isError: true,
            };
        }

        try {
            const preparedToolCall = tool.prepareArguments
                ? {
                    ...input.toolCall,
                    arguments: tool.prepareArguments(input.toolCall.arguments) as Record<string, any>,
                }
                : input.toolCall;
            const args = validateToolArguments(tool, preparedToolCall);
            const context: ToolExecutionContext = {
                harness: this,
                sessionId: input.sessionId,
                workspaceRoot: input.workspaceRoot,
                workspaceKey: input.workspaceKey,
            };
            const result = tool.executeWithContext
                ? await tool.executeWithContext(context, input.toolCall.id, args)
                : await tool.execute(input.toolCall.id, args);
            return {
                result,
                isError: false,
            };
        } catch (error) {
            return {
                result: this.errorToolResult(error instanceof Error ? error.message : String(error)),
                isError: true,
            };
        }
    }

    private async persistEvent(sessionId: number, workspaceKey: string, event: AgentEvent): Promise<void> {
        if (event.type === "message_end") {
            const message = event.message;
            if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
                await this.repo.appendMessage(sessionId, message, workspaceKey);
            }
        }
    }

    private async remindReportResult(
        input: InvokeAgentInput,
        invocationId: string,
        events: AgentEvent[],
        finalAssistant?: AssistantMessage,
        runInput?: {
            workspaceKey: string;
            workspaceRoot: string;
            systemPrompt: string;
            model: Model<any>;
            toolKeys: string[];
            thinkingLevel: string;
        },
    ): Promise<InvokeAgentResult> {
        const reminder = createUserMessage({
            text: "你必须使用 report_result 工具返回最终结果。请不要只回复普通文本。",
        });
        await this.repo.appendMessage(input.sessionId, reminder, runInput?.workspaceKey);
        if (runInput) {
            const snapshot = await this.repo.readSession(input.sessionId);
            const context = this.repo.reduce(snapshot);
            const reminded = await this.runLoop({
                sessionId: input.sessionId,
                workspaceKey: runInput.workspaceKey,
                workspaceRoot: runInput.workspaceRoot,
                systemPrompt: runInput.systemPrompt,
                messages: context.messages,
                model: runInput.model,
                toolKeys: runInput.toolKeys,
                thinkingLevel: runInput.thinkingLevel,
                onEvent: input.onEvent,
            });
            if (reminded.reportResult) {
                const ingestError = await this.applyIngest(input.sessionId);
                if (ingestError) {
                    return {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "error",
                        error: ingestError,
                        events: [...events, ...reminded.events],
                    };
                }
                return {
                    sessionId: input.sessionId,
                    invocationId,
                    status: "completed",
                    finalMessage: reminded.finalAssistant ? messageText(reminded.finalAssistant) : undefined,
                    reportResult: reminded.reportResult,
                    usage: reminded.finalAssistant?.usage,
                    events: [...events, ...reminded.events],
                };
            }
            finalAssistant = reminded.finalAssistant ?? finalAssistant;
            events = [...events, ...reminded.events];
        }
        const ingestError = await this.applyIngest(input.sessionId);
        if (ingestError) {
            return {
                sessionId: input.sessionId,
                invocationId,
                status: "error",
                error: ingestError,
                events,
            };
        }
        return {
            sessionId: input.sessionId,
            invocationId,
            status: "completed",
            finalMessage: [
                finalAssistant ? messageText(finalAssistant) : "",
                "目标 agent 没有正确 report_result。",
            ].filter(Boolean).join("\n\n"),
            events,
        };
    }

    private sessionSummary(snapshot: SessionSnapshot, detached = false): AgentSummary {
        const context = this.repo.reduce(snapshot);
        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: context.profileKey,
            workspaceRoot: context.workspaceRoot,
            title: context.title,
            summary: context.summary,
            status: detached ? "detached" : "idle",
        };
    }

    private toolResultText(result: AgentToolResult<unknown>): string {
        return result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    }

    private errorToolResult(message: string): AgentToolResult<Record<string, never>> {
        return {
            content: [{type: "text", text: message}],
            details: {},
        };
    }

    private readReportResult(details: unknown): InvokeAgentResult["reportResult"] | undefined {
        if (!details || typeof details !== "object" || !("result" in details) || typeof (details as {result?: unknown}).result !== "string") {
            return undefined;
        }
        return {
            result: (details as {result: string}).result,
            success: typeof (details as {success?: unknown}).success === "boolean" ? (details as unknown as {success: boolean}).success : undefined,
            data: (details as {data?: unknown}).data,
        };
    }

}
