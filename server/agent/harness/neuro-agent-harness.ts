import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import type {AgentEvent, AgentToolResult} from "@earendil-works/pi-agent-core";
import {streamSimple, validateToolArguments} from "@earendil-works/pi-ai";
import type {AgentMessage, AgentToolCall, AgentUserMessageInput, AssistantMessage, JsonValue, Message, Model, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createTextToolResult, createToolResultFromResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import type {AgentProfile, PreparedTurn, ProfileIngestResult} from "nbook/server/agent/profiles/types";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {ModelChangeEntry, SessionEntry, SessionEntryId, SessionSnapshot} from "nbook/server/agent/session/types";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";
import {findPendingApprovalCall, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import {createBuiltinTools, createReportResultTool} from "nbook/server/agent/tools/builtin-tools";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {AgentResolution, NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {appendCompaction, compactIfNeeded} from "nbook/server/agent/harness/compaction";
import {resolvePiApiKeyFromConfig, resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {loadEffectiveConfigForWorkspaceRoot} from "nbook/server/config/config-service";
import type {EffectiveConfig} from "nbook/server/config/types";
import type {
    AgentAbortResult,
    AgentCommandResult,
    AgentSummary,
    AgentTreeResult,
    CreateAgentInput,
    CreateAgentResult,
    InvokeAgentInput,
    InvokeAgentResult,
    SessionQueryResult,
} from "nbook/server/agent/harness/types";
import type {
    AgentAbortRequestDto,
    AgentActiveInvocationDto,
    AgentCommandRequestDto,
    AgentFollowUpQueueItemDto,
    AgentLinkedSessionDto,
    AgentSessionEventDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {isEmptyObjectSchema, reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";

type HarnessOptions = {
    repo?: JsonlSessionRepository;
    profiles?: AgentProfileCatalog;
    skills?: SkillCatalog;
    tools?: AgentToolRegistry;
    modelResolver?: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    eventHub?: AgentSessionEventHub;
};

type RunToolBatchResult = {
    toolResults: ToolResultMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    toolOverrides?: Record<string, NeuroAgentTool>;
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
    readonly eventHub: AgentSessionEventHub;
    private readonly modelResolver: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    private readonly activeInvocations = new Map<number, AgentActiveInvocationDto>();
    private readonly followUpQueues = new Map<number, AgentFollowUpQueueItemDto[]>();
    private readonly abortControllers = new Map<number, AbortController>();

    constructor(options: HarnessOptions = {}) {
        this.repo = options.repo ?? new JsonlSessionRepository();
        this.profiles = options.profiles ?? new AgentProfileCatalog();
        this.skills = options.skills ?? new SkillCatalog();
        this.tools = options.tools ?? new AgentToolRegistry();
        this.eventHub = options.eventHub ?? new AgentSessionEventHub();
        this.modelResolver = options.modelResolver ?? resolvePiModelFromConfig;
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
            novelId: input.novelId,
            parentSessionId: input.parentSessionId,
            title: profile.manifest.name,
        });
        if (input.parentSessionId) {
            const entry = await this.repo.appendEntry(input.parentSessionId, {
                type: "custom",
                key: `agent.link.${snapshot.metadata.sessionId}`,
                value: {
                    sessionId: snapshot.metadata.sessionId,
                    profileKey: input.profileKey,
                },
            });
            this.publishSessionEntry(input.parentSessionId, undefined, entry);
            await this.publishSessionState(input.parentSessionId);
        }
        await this.publishSessionState(snapshot.metadata.sessionId);
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
        if (this.activeInvocations.has(input.sessionId) && !input.resolution && !input.internalQueued) {
            if (input.mode === "prompt" && input.message) {
                const item = this.enqueueFollowUp(input.sessionId, input.message);
                return {
                    sessionId: input.sessionId,
                    invocationId,
                    status: "waiting",
                    finalMessage: `follow up queued: ${item.id}`,
                    events: [],
                };
            }
            throw new Error("active_invocation_exists");
        }

        const activeInvocation: AgentActiveInvocationDto = {
            invocationId,
            sessionId: input.sessionId,
            status: "running",
            mode: input.mode,
            startedAt: Date.now(),
        };
        const abortController = new AbortController();
        this.activeInvocations.set(input.sessionId, activeInvocation);
        this.abortControllers.set(input.sessionId, abortController);
        const lifecycleEntry = await this.repo.appendEntry(input.sessionId, {
            type: "invocation_lifecycle",
            invocationId,
            status: "start",
        });
        this.publishSessionEntry(input.sessionId, invocationId, lifecycleEntry);
        await this.publishSessionState(input.sessionId, invocationId);

        let snapshot = await this.repo.readSession(input.sessionId);
        let pendingUserMessage: Message | null = null;
        let pendingResolution: AgentResolution | null = null;

        try {
            if (input.mode === "prompt") {
                if (!input.message) {
                    throw new Error("prompt 模式必须提供 message");
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
                const entry = await this.repo.appendMessage(input.sessionId, pendingUserMessage, snapshot.metadata.workspaceKey);
                this.publishSessionEntry(input.sessionId, invocationId, entry);
                snapshot = await this.repo.readSession(input.sessionId);
            }
            let context = this.repo.reduce(snapshot);
            const config = await loadEffectiveConfigForWorkspaceRoot(context.workspaceRoot);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            const apiKey = resolvePiApiKeyFromConfig(config, model.provider);
            await compactIfNeeded({
                repo: this.repo,
                snapshot,
                messages: [...context.messages, ...(prepared.dynamicMessages ?? [])],
                model,
                apiKey,
                thinkingLevel: context.thinkingLevel,
            });
            snapshot = await this.repo.readSession(input.sessionId);
            context = this.repo.reduce(snapshot);

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
                apiKey,
                toolKeys: prepared.toolKeys ?? [],
                profileKey: context.profileKey,
                thinkingLevel: context.thinkingLevel,
                abortSignal: abortController.signal,
                invocationId,
                onEvent: input.onEvent,
            });
            const finalResult = await this.finalizeInvokeResult({
                input,
                invocationId,
                snapshot,
                context,
                prepared,
                model,
                apiKey,
                result,
            });
            const lifecycleEntry = await this.repo.appendEntry(input.sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: finalResult.status === "error" ? "error" : finalResult.status === "waiting" ? "start" : "end",
                error: finalResult.error,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(input.sessionId, invocationId, lifecycleEntry);
            if (finalResult.status !== "waiting") {
                await this.finishInvocation(input.sessionId, invocationId);
                void this.drainFollowUps(input.sessionId);
            }
            return finalResult;
        } catch (error) {
            const lifecycleEntry = await this.repo.appendEntry(input.sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: abortController.signal.aborted ? "aborted" : "error",
                error: error instanceof Error ? error.message : String(error),
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(input.sessionId, invocationId, lifecycleEntry);
            await this.finishInvocation(input.sessionId, invocationId);
            return {
                sessionId: input.sessionId,
                invocationId,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                events: [],
            };
        }
    }

    private async finalizeInvokeResult(input: {
        input: InvokeAgentInput;
        invocationId: string;
        snapshot: SessionSnapshot;
        context: ReturnType<JsonlSessionRepository["reduce"]>;
        prepared: Awaited<ReturnType<NeuroAgentHarness["prepare"]>>;
        model: Model<any>;
        apiKey?: string;
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
    }): Promise<InvokeAgentResult> {
        const {input: invokeInput, invocationId, snapshot, context, prepared, model, apiKey, result} = input;
        if (result.waiting) {
            const active = this.activeInvocations.get(invokeInput.sessionId);
            if (active) {
                active.status = "waiting";
            }
            await this.publishSessionState(invokeInput.sessionId, invocationId);
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "waiting",
                finalMessage: `waiting for ${result.waiting.toolName}`,
                usage: result.finalAssistant?.usage,
                events: result.events,
            };
        }

        if (!result.reportResult && (prepared.toolKeys ?? []).includes("report_result")) {
            return this.remindReportResult(invokeInput, invocationId, result.events, result.finalAssistant, {
                workspaceKey: snapshot.metadata.workspaceKey,
                workspaceRoot: context.workspaceRoot,
                systemPrompt: prepared.systemPrompt ?? context.systemPrompt,
                model,
                apiKey,
                toolKeys: prepared.toolKeys ?? [],
                profileKey: context.profileKey,
                thinkingLevel: context.thinkingLevel,
            });
        }

        const ingestError = await this.applyIngest(invokeInput.sessionId);
        if (ingestError) {
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "error",
                error: ingestError,
                events: result.events,
            };
        }

        return {
            sessionId: invokeInput.sessionId,
            invocationId,
            status: "completed",
            finalMessage: result.finalAssistant ? messageText(result.finalAssistant) : undefined,
            reportResult: result.reportResult,
            usage: result.finalAssistant?.usage,
            events: result.events,
        };
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
            await this.publishSessionState(ownerSessionId);
        }
        return {
            sessionId,
            detached: true,
        };
    }

    /**
     * 列出前端可打开的顶层 session。
     */
    async listSessions(workspaceKey?: string, includeArchived = false): Promise<AgentSessionSummaryDto[]> {
        return this.repo.listSessions({workspaceKey, includeArchived});
    }

    /**
     * 返回完整前端 snapshot，作为 UI 恢复真相。
     */
    async getSessionSnapshot(sessionId: number): Promise<AgentSessionSnapshotDto> {
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const pendingMessages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pendingApproval = findPendingApprovalCall(pendingMessages, this.tools.approvalToolKeys());
        const linkedAgents: AgentLinkedSessionDto[] = [];
        for (const linked of context.linkedAgents) {
            const linkedSnapshot = await this.repo.readSession(linked.sessionId);
            linkedAgents.push({
                ...this.repo.summary(linkedSnapshot),
                detached: linked.detached,
            });
        }

        return {
            summary: {
                ...this.repo.summary(snapshot),
                status: this.resolveSessionStatus(sessionId, context.archived),
            },
            activeLeafId: snapshot.leafId,
            messages: context.messages,
            tree: this.repo.tree(snapshot),
            entries: this.repo.activePath(snapshot),
            linkedAgents,
            pendingApproval: pendingApproval
                ? {
                    toolCallId: pendingApproval.toolCallId,
                    toolName: pendingApproval.toolName,
                    args: pendingApproval.args as never,
                }
                : null,
            followUpQueue: this.followUpQueues.get(sessionId) ?? [],
            activeInvocation: this.activeInvocations.get(sessionId) ?? null,
            model: context.model,
            planModeActive: context.planModeActive,
            lastSeq: this.eventHub.lastSeq,
            usage: [...context.messages].reverse().find((message) => message.role === "assistant")?.usage,
        };
    }

    /**
     * 执行 session 控制命令。命令不作为普通用户消息进入模型。
     */
    async runCommand(sessionId: number, body: AgentCommandRequestDto): Promise<AgentCommandResult> {
        if (body.command !== "compact") {
            this.assertSessionIdle(sessionId);
        }
        const snapshot = await this.repo.readSession(sessionId);
        if (body.command === "new") {
            const created = await this.createAgent({
                profileKey: snapshot.metadata.profileKey,
                input: snapshot.metadata.input,
                workspaceRoot: snapshot.metadata.workspaceRoot,
                workspaceKey: snapshot.metadata.workspaceKey,
            });
            return {
                status: "completed",
                sessionId: created.sessionId,
                createdSession: this.repo.summary(await this.repo.readSession(created.sessionId)),
            };
        }
        if (body.command === "fork") {
            const forked = await this.repo.forkSession(sessionId, body.entryId ?? snapshot.leafId ?? undefined);
            await this.publishSessionState(forked.metadata.sessionId);
            return {
                status: "completed",
                sessionId: forked.metadata.sessionId,
                createdSession: this.repo.summary(forked),
            };
        }
        if (body.command === "retry") {
            const targetId = body.entryId ?? snapshot.leafId;
            if (targetId) {
                await this.moveLeafForPosition(sessionId, targetId, "before", snapshot.metadata.workspaceKey);
            }
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "tree") {
            await this.moveLeafForPosition(sessionId, body.targetEntryId, body.position, snapshot.metadata.workspaceKey);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "plan") {
            const entry = await this.repo.appendEntry(sessionId, {
                type: "custom",
                key: "ui.planMode.active",
                value: body.active,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, undefined, entry);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "model") {
            const config = await loadEffectiveConfigForWorkspaceRoot(snapshot.metadata.workspaceRoot);
            const entry: Omit<ModelChangeEntry, "id" | "parentId" | "timestamp"> = {
                type: "model_change",
                model: body.modelKey ? this.modelResolver(config, snapshot.metadata.profileKey, {modelKey: body.modelKey}) : null,
            };
            const written = await this.repo.appendEntry(sessionId, entry, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, undefined, written);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "archive") {
            const entry = await this.repo.appendEntry(sessionId, {
                type: "session_archived",
                reason: body.reason,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, undefined, entry);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "compact") {
            this.assertSessionIdle(sessionId);
            void this.runCompactCommand(sessionId, body.instructions);
            return {
                status: "started",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        return {
            status: "completed",
            sessionId,
            snapshot: await this.getSessionSnapshot(sessionId),
        };
    }

    /**
     * 移动树分支，并可在移动后立即发起下一次 invoke。
     */
    async moveTree(sessionId: number, body: AgentTreeRequestDto): Promise<AgentTreeResult> {
        this.assertSessionIdle(sessionId);
        const snapshot = await this.repo.readSession(sessionId);
        if (body.position === "empty") {
            await this.repo.moveLeaf(sessionId, null, snapshot.metadata.workspaceKey);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        // TODO: 当前 next.invoke 失败时不会回滚 leaf；后续需要改成真正的原子 tree + invoke。
        await this.moveLeafForPosition(sessionId, body.targetEntryId, body.position, snapshot.metadata.workspaceKey);
        await this.publishSessionState(sessionId);
        if (body.next?.type === "invoke") {
            const invocation = await this.invokeAgent({
                sessionId,
                mode: body.next.mode,
                message: body.next.message,
                internalQueued: true,
            });
            return {
                status: "invoked",
                snapshot: await this.getSessionSnapshot(sessionId),
                invocation,
            };
        }
        return {
            status: "completed",
            snapshot: await this.getSessionSnapshot(sessionId),
        };
    }

    /**
     * 请求中断当前 invocation。底层 provider/tool 会通过 AbortSignal 尽量停止。
     */
    async abortInvocation(sessionId: number, body: AgentAbortRequestDto = {}): Promise<AgentAbortResult> {
        const active = this.activeInvocations.get(sessionId);
        if (!active) {
            return {
                status: "idle",
                sessionId,
            };
        }
        active.status = "aborting";
        this.abortControllers.get(sessionId)?.abort(body.reason);
        if (body.clearQueue ?? true) {
            this.followUpQueues.delete(sessionId);
        }
        this.eventHub.publish({
            sessionId,
            invocationId: active.invocationId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: body.reason,
            },
        });
        await this.publishSessionState(sessionId, active.invocationId);
        return {
            status: "aborted",
            sessionId,
        };
    }

    /**
     * 订阅 session 级事件流。
     */
    subscribeSessionEvents(sessionId: number, after?: number): AsyncIterable<AgentSessionEventDto> {
        return this.eventHub.subscribe(sessionId, after);
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
                const entry = await this.repo.appendMessage(snapshot.metadata.sessionId, message, snapshot.metadata.workspaceKey);
                this.publishSessionEntry(snapshot.metadata.sessionId, undefined, entry);
            }
            const entry = await this.repo.appendEntry(snapshot.metadata.sessionId, {
                type: "custom",
                key: "profile.history.injected",
                value: true,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(snapshot.metadata.sessionId, undefined, entry);
        }
        for (const message of prepared.appendingMessages ?? []) {
            const entry = await this.repo.appendMessage(snapshot.metadata.sessionId, message, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(snapshot.metadata.sessionId, undefined, entry);
        }
        for (const write of prepared.sessionWrites ?? []) {
            const entry = await this.repo.appendEntry(snapshot.metadata.sessionId, write, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(snapshot.metadata.sessionId, undefined, entry);
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
                const entry = await this.repo.appendMessage(sessionId, message, snapshot.metadata.workspaceKey);
                this.publishSessionEntry(sessionId, undefined, entry);
            }
            if (ingest.sessionUpdates?.title || ingest.sessionUpdates?.summary) {
                const entry = await this.repo.appendEntry(sessionId, {
                    type: "session_update",
                    updates: ingest.sessionUpdates,
                }, snapshot.metadata.workspaceKey);
                this.publishSessionEntry(sessionId, undefined, entry);
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
        const entry = await this.repo.appendMessage(snapshot.metadata.sessionId, resolutionToToolResult(resolution, pending), snapshot.metadata.workspaceKey);
        this.publishSessionEntry(snapshot.metadata.sessionId, undefined, entry);
    }

    private async runLoop(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        systemPrompt: string;
        messages: AgentMessage[];
        model: Model<any>;
        apiKey?: string;
        toolKeys: string[];
        profileKey: string;
        thinkingLevel: string;
        abortSignal?: AbortSignal;
        invocationId?: string;
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
            this.publishPiEvent(input.sessionId, input.invocationId, event);
            await this.persistEvent(input.sessionId, input.workspaceKey, event);
        };
        const toolOverrides = await this.toolOverrides(input.toolKeys, input.profileKey);
        const visibleTools = this.tools.allowedWithOverrides(input.toolKeys, toolOverrides);
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
                apiKey: input.apiKey,
                tools: visibleTools,
                sessionId: input.sessionId,
                thinkingLevel: input.thinkingLevel,
                abortSignal: input.abortSignal,
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
                toolOverrides,
                abortSignal: input.abortSignal,
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
        apiKey?: string;
        tools: ReturnType<AgentToolRegistry["allowed"]>;
        sessionId: number;
        thinkingLevel: string;
        abortSignal?: AbortSignal;
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
            apiKey: input.apiKey,
            signal: input.abortSignal,
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
        toolOverrides: Record<string, NeuroAgentTool>;
        abortSignal?: AbortSignal;
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
                toolOverrides: input.toolOverrides,
                abortSignal: input.abortSignal,
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
                return `Skill ${skillKey} is not visible in the skill catalog`;
            }
        }
        return null;
    }

    private async executeTool(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        allowedToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        abortSignal?: AbortSignal;
        toolCall: AgentToolCall;
    }): Promise<{
        result: AgentToolResult<unknown>;
        isError: boolean;
    }> {
        const tool = input.toolOverrides[input.toolCall.name] ?? this.tools.get(input.toolCall.name);
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
                ? await tool.executeWithContext(context, input.toolCall.id, args, input.abortSignal)
                : await tool.execute(input.toolCall.id, args, input.abortSignal);
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
                const entry = await this.repo.appendMessage(sessionId, message, workspaceKey);
                this.publishSessionEntry(sessionId, undefined, entry);
            }
        }
    }

    private assertSessionIdle(sessionId: number): void {
        if (this.activeInvocations.has(sessionId)) {
            throw new Error("active_invocation_exists");
        }
    }

    private enqueueFollowUp(sessionId: number, message: AgentUserMessageInput): AgentFollowUpQueueItemDto {
        const item: AgentFollowUpQueueItemDto = {
            id: randomUUID(),
            message,
            createdAt: Date.now(),
        };
        const queue = this.followUpQueues.get(sessionId) ?? [];
        queue.push(item);
        this.followUpQueues.set(sessionId, queue);
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {
                type: "follow_up_queued",
                item,
            },
        });
        return item;
    }

    private async drainFollowUps(sessionId: number): Promise<void> {
        if (this.activeInvocations.has(sessionId)) {
            return;
        }
        const queue = this.followUpQueues.get(sessionId) ?? [];
        const next = queue.shift();
        if (!next) {
            this.followUpQueues.delete(sessionId);
            return;
        }
        if (queue.length === 0) {
            this.followUpQueues.delete(sessionId);
        } else {
            this.followUpQueues.set(sessionId, queue);
        }
        await this.invokeAgent({
            sessionId,
            mode: "prompt",
            message: next.message,
            internalQueued: true,
        });
    }

    private async finishInvocation(sessionId: number, invocationId?: string): Promise<void> {
        this.activeInvocations.delete(sessionId);
        this.abortControllers.delete(sessionId);
        await this.publishSessionState(sessionId, invocationId);
    }

    private publishPiEvent(sessionId: number, invocationId: string | undefined, event: AgentEvent): void {
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "pi",
            event,
        });
    }

    private publishSessionEntry(sessionId: number, invocationId: string | undefined, entry: SessionEntry): void {
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_entry",
                entry,
            },
        });
    }

    private async publishSessionState(sessionId: number, invocationId?: string): Promise<void> {
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_state_changed",
                snapshot: await this.getSessionSnapshot(sessionId),
            },
        });
    }

    private resolveSessionStatus(sessionId: number, archived: boolean): AgentSessionSummaryDto["status"] {
        if (archived) {
            return "archived";
        }
        const active = this.activeInvocations.get(sessionId);
        if (active?.status === "waiting") {
            return "waiting";
        }
        if (active) {
            return "running";
        }
        return "idle";
    }

    private async moveLeafForPosition(
        sessionId: number,
        targetEntryId: SessionEntryId,
        position: "at" | "before",
        workspaceKey?: string,
    ): Promise<void> {
        const snapshot = await this.repo.readSession(sessionId, workspaceKey);
        const target = snapshot.entries.find((entry) => entry.id === targetEntryId);
        if (!target || target.type === "leaf") {
            throw new Error(`未找到目标 entry：${targetEntryId}`);
        }
        await this.repo.moveLeaf(sessionId, position === "before" ? target.parentId : target.id, snapshot.metadata.workspaceKey);
    }

    private async runCompactCommand(sessionId: number, instructions?: string): Promise<void> {
        const invocationId = randomUUID();
        const activeInvocation: AgentActiveInvocationDto = {
            invocationId,
            sessionId,
            status: "running",
            mode: "compact",
            startedAt: Date.now(),
        };
        this.activeInvocations.set(sessionId, activeInvocation);
        const startSnapshot = await this.repo.readSession(sessionId);
        const startEntry = await this.repo.appendEntry(sessionId, {
            type: "invocation_lifecycle",
            invocationId,
            status: "start",
        }, startSnapshot.metadata.workspaceKey);
        this.publishSessionEntry(sessionId, invocationId, startEntry);
        await this.publishSessionState(sessionId, invocationId);
        try {
            const snapshot = await this.repo.readSession(sessionId);
            const context = this.repo.reduce(snapshot);
            const config = await loadEffectiveConfigForWorkspaceRoot(context.workspaceRoot);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            await appendCompaction({
                repo: this.repo,
                snapshot,
                messages: context.messages,
                model,
                apiKey: resolvePiApiKeyFromConfig(config, model.provider),
                thinkingLevel: context.thinkingLevel,
                instructions,
            });
            const entry = await this.repo.appendEntry(sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: "end",
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, invocationId, entry);
        } catch (error) {
            const snapshot = await this.repo.readSession(sessionId);
            const entry = await this.repo.appendEntry(sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, invocationId, entry);
        } finally {
            await this.finishInvocation(sessionId, invocationId);
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
            apiKey?: string;
            toolKeys: string[];
            profileKey: string;
            thinkingLevel: string;
        },
    ): Promise<InvokeAgentResult> {
        const reminder = createUserMessage({
            text: "你必须使用 report_result 工具返回最终结果。请不要只回复普通文本。",
        });
        const reminderEntry = await this.repo.appendMessage(input.sessionId, reminder, runInput?.workspaceKey);
        this.publishSessionEntry(input.sessionId, invocationId, reminderEntry);
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
                apiKey: runInput.apiKey,
                toolKeys: runInput.toolKeys,
                profileKey: runInput.profileKey,
                thinkingLevel: runInput.thinkingLevel,
                invocationId,
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

    private errorToolResult(message: string): AgentToolResult<Record<string, never>> {
        return {
            content: [{type: "text", text: message}],
            details: {},
        };
    }

    private readReportResult(details: unknown): InvokeAgentResult["reportResult"] | undefined {
        if (!details || typeof details !== "object" || !("walkthrough" in details) || typeof (details as {walkthrough?: unknown}).walkthrough !== "string") {
            return undefined;
        }
        return {
            result: (details as {walkthrough: string}).walkthrough,
            data: (details as {data?: unknown}).data,
        };
    }

    /**
     * 根据当前 profile 派生模型可见工具 schema 与执行校验。
     */
    private async toolOverrides(toolKeys: readonly string[], profileKey: string): Promise<Record<string, NeuroAgentTool>> {
        if (!toolKeys.includes("report_result")) {
            return {};
        }
        const profile = await this.profiles.get(profileKey);
        const reportTool = createReportResultTool(
            reportResultSchemaForProfile(profile),
            isEmptyObjectSchema(profile.outputSchema) ? undefined : profile.outputSchema,
        );
        return {
            report_result: reportTool,
        };
    }

}
