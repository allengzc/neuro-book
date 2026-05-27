import {createHash, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import type {AgentEvent, AgentToolResult} from "@earendil-works/pi-agent-core";
import {streamSimple, validateToolArguments} from "@earendil-works/pi-ai";
import type {AgentMessage, AgentToolCall, AgentUserMessageInput, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createTextToolResult, createToolResultFromResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {sessionSummarizerProfile} from "nbook/server/agent/profiles/session-summarizer-profile";
import {SessionSummarizerOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import type {AgentProfile, ProfileCompactionPlan, ProfileIngestResult, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {compileProfileSystemPrompt, profileStateKey, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AGENT_PLAN_MODE_STATE_KEY, SESSION_SUMMARIZER_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {InvocationErrorInfo, InvocationErrorPhase, ModelChangeEntry, NeuroSessionContext, SessionEntry, SessionEntryDraft, SessionEntryId, SessionSnapshot} from "nbook/server/agent/session/types";
import {buildAgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";
import {findPendingApprovalCall, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import {createBuiltinTools, createReportResultTool} from "nbook/server/agent/tools/builtin-tools";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {AgentResolution, NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {appendCompaction, compactIfNeeded} from "nbook/server/agent/harness/compaction";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {planModeDirectory, resolvePlanModeFile} from "nbook/server/agent/plan-mode-path";
import type {EffectiveConfig} from "nbook/server/config/types";
import {WORKSPACE_CONTAINER_ROOT, USER_ASSETS_WORKSPACE_ROOT} from "nbook/server/workspace-files/novel-workspace";
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
    SessionQueryInput,
} from "nbook/server/agent/harness/types";
import type {
    AgentAbortRequestDto,
    AgentActiveInvocationDto,
    AgentCommandRequestDto,
    AgentFollowUpQueueItemDto,
    AgentLinkedSessionDto,
    AgentPendingApprovalDto,
    AgentSessionEventDto,
    AgentSessionListQueryDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {isEmptyObjectSchema, reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {normalizeClientState} from "nbook/server/agent/variables/accessor";
import {createVariableRegistryForProfile, createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";
import type {ClientStateSnapshot, ProfileVariableAccessor, VariableInvocationState, VariableJsonPatchOperation, VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {Value} from "typebox/value";

type HarnessOptions = {
    repo?: JsonlSessionRepository;
    profiles?: AgentProfileCatalog;
    skills?: SkillCatalog;
    tools?: AgentToolRegistry;
    modelResolver?: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    eventHub?: AgentSessionEventHub;
    enableSessionSummarizer?: boolean;
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

type SessionSummarizerState = {
    sessionId?: number;
    profileKey?: string;
    summarizerInputFingerprint?: string;
    running?: boolean;
    dirty?: boolean;
    lastDialogueContentFingerprint?: string;
    lastDialogueContentTokens?: number;
    lastRunDialogueContentTokens?: number;
    lastRunAt?: number;
    lastError?: string;
    turnCount?: number;
    loopCount?: number;
};

const DEFAULT_SUMMARIZER_INPUT = {
    trigger: "after_invocation",
    interval: {
        kind: "turn",
        value: 1,
    },
    maxDialogueContentTokens: 80_000,
} satisfies JsonValue;

const SESSION_TITLE_MAX_LENGTH = 32;
const SESSION_SUMMARY_MAX_LENGTH = 240;

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
    private readonly enableSessionSummarizer: boolean;
    private readonly activeInvocations = new Map<number, AgentActiveInvocationDto>();
    private readonly steerableSessions = new Set<number>();
    private readonly steerQueues = new Map<number, AgentFollowUpQueueItemDto[]>();
    private readonly followUpQueues = new Map<number, AgentFollowUpQueueItemDto[]>();
    private readonly abortControllers = new Map<number, AbortController>();
    private readonly invocationClientStates = new Map<string, ClientStateSnapshot | undefined>();
    private readonly invocationVariableStates = new Map<string, VariableInvocationState>();
    private readonly pendingClientPatches = new Map<string, {
        request: VariablePatchRequest;
        resolve: (ack: VariablePatchAck) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    private readonly activeSummarizers = new Set<number>();

    constructor(options: HarnessOptions = {}) {
        this.repo = options.repo ?? new JsonlSessionRepository();
        this.profiles = options.profiles ?? new AgentProfileCatalog();
        this.skills = options.skills ?? new SkillCatalog();
        this.tools = options.tools ?? new AgentToolRegistry();
        this.eventHub = options.eventHub ?? new AgentSessionEventHub();
        this.modelResolver = options.modelResolver ?? resolvePiModelFromConfig;
        this.enableSessionSummarizer = options.enableSessionSummarizer ?? true;
        this.profiles.register(defaultAgentProfile);
        this.profiles.register(sessionSummarizerProfile);
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
            workspaceRoot: normalizeAgentWorkspaceRoot(input.workspaceRoot, input.projectPath),
            workspaceKey: input.workspaceKey ?? "global",
            projectPath: input.projectPath,
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
     * 由 harness 直接创建后台 system session，不写 linked-agent entry。
     */
    private async createSystemAgent(input: {
        profileKey: string;
        input: JsonValue;
        workspaceRoot: string;
        workspaceKey: string;
        projectPath?: string;
        systemRole: "summarizer";
    }): Promise<SessionSnapshot> {
        const profile = await this.profiles.get(input.profileKey);
        const parsedInput = this.profiles.parseInput(profile, input.input);
        const snapshot = await this.repo.createSession({
            profileKey: input.profileKey,
            input: parsedInput,
            workspaceRoot: input.workspaceRoot,
            workspaceKey: input.workspaceKey,
            projectPath: input.projectPath,
            systemRole: input.systemRole,
            title: profile.manifest.name,
        });
        await this.publishSessionState(snapshot.metadata.sessionId);
        return snapshot;
    }

    /**
     * 读取 session 当前 active path 的 reduce 结果，供工具读取 profile/session custom state。
     */
    async readSessionContext(sessionId: number, workspaceKey?: string): Promise<NeuroSessionContext> {
        return this.repo.reduce(await this.repo.readSession(sessionId, workspaceKey));
    }

    /**
     * 追加 session custom entry。工具写状态必须走这里，确保 SSE 与 session snapshot 同步。
     */
    async appendCustomState(sessionId: number, key: string, value: JsonValue, workspaceKey?: string, invocationId?: string): Promise<SessionEntry> {
        const entry = await this.repo.appendEntry(sessionId, {
            type: "custom",
            key,
            value,
        }, workspaceKey);
        this.publishSessionEntry(sessionId, invocationId, entry);
        await this.publishSessionState(sessionId, invocationId);
        return entry;
    }

    /**
     * 调用 agent。prompt 会写入用户消息；continue 只从当前 session 尾部继续。
     */
    async invokeAgent(input: InvokeAgentInput): Promise<InvokeAgentResult> {
        if (input.block === false) {
            throw new Error("block:false 第一版尚未实现");
        }
        const invocationId = randomUUID();
        if ((input.mode === "steer" || input.mode === "followup") && !input.message) {
            throw new Error(`${input.mode} 模式必须提供 message`);
        }
        const currentInvocation = this.activeInvocations.get(input.sessionId);
        if (currentInvocation && !input.resolution && !input.internalQueued) {
            if (currentInvocation.status === "aborting") {
                throw new Error("active_invocation_aborting");
            }
            if (input.mode === "steer" && input.message) {
                if (!this.steerableSessions.has(input.sessionId)) {
                    throw new Error("steer_not_available");
                }
                const item = this.enqueueSteer(input.sessionId, input.message);
                return {
                    sessionId: input.sessionId,
                    invocationId,
                    status: "waiting",
                    finalMessage: `steer queued: ${item.id}`,
                    queuedItem: item,
                    events: [],
                };
            }
            if ((input.mode === "prompt" || input.mode === "followup") && input.message) {
                const item = this.enqueueFollowUp(input.sessionId, input.message);
                return {
                    sessionId: input.sessionId,
                    invocationId,
                    status: "waiting",
                    finalMessage: `follow up queued: ${item.id}`,
                    queuedItem: item,
                    events: [],
                };
            }
            throw new Error("active_invocation_exists");
        }
        if (input.mode === "steer") {
            throw new Error("active_invocation_required");
        }
        if (input.mode === "followup") {
            throw new Error("active_invocation_required");
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
        this.steerableSessions.add(input.sessionId);
        this.abortControllers.set(input.sessionId, abortController);
        this.invocationClientStates.set(invocationId, input.clientState);
        this.invocationVariableStates.set(invocationId, {
            readFingerprints: new Map(),
            clientOverlay: normalizeClientState(input.clientState),
        });
        const lifecycleEntry = await this.repo.appendEntry(input.sessionId, {
            type: "invocation_lifecycle",
            invocationId,
            status: "start",
        });
        this.publishSessionEntry(input.sessionId, invocationId, lifecycleEntry);

        let snapshot = await this.repo.readSession(input.sessionId);
        let pendingUserMessage: Message | null = null;
        let pendingResolution: AgentResolution | null = null;
        let errorPhase: InvocationErrorPhase = "pre_loop";

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
                await this.appendResolution(snapshot, pendingResolution, invocationId);
                snapshot = await this.repo.readSession(input.sessionId);
            }
            await this.publishSessionState(input.sessionId, invocationId);
            const prepared = await this.prepare(snapshot, invocationId, pendingUserMessage ?? undefined, input.clientState);
            snapshot = await this.repo.readSession(input.sessionId);
            if (pendingUserMessage) {
                const entry = await this.repo.appendMessage(input.sessionId, pendingUserMessage, snapshot.metadata.workspaceKey, "prompt");
                this.publishSessionEntry(input.sessionId, invocationId, entry);
                snapshot = await this.repo.readSession(input.sessionId);
            }
            let context = this.repo.reduce(snapshot);
            const config = await loadEffectiveConfig(context);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            const providerOptions = this.providerOptions(config, model);
            const apiKey = resolvePiApiKeyForModelFromConfig(config, model);
            const runProfile = await this.profiles.get(context.profileKey);
            const toolKeys = [...runProfile.allowedToolKeys];
            const thinkingLevel = this.resolveThinkingLevel(context, config, model);
            const preparedModelContextMessages = prepared.modelContextMessages ?? [];
            const modelMessages = [
                ...context.messages,
                ...preparedModelContextMessages,
            ];
            this.assertNoUnclosedToolCallsForModel(modelMessages);
            errorPhase = "compaction";
            await compactIfNeeded({
                repo: this.repo,
                snapshot,
                messages: modelMessages,
                model,
                apiKey,
                thinkingLevel,
                timeoutMs: providerOptions.timeoutMs,
                requestOptions: providerOptions.requestOptions,
                compaction: prepared.compaction,
            });
            errorPhase = "model";
            snapshot = await this.repo.readSession(input.sessionId);
            context = this.repo.reduce(snapshot);

            const result = await this.runLoop({
                sessionId: input.sessionId,
                workspaceKey: snapshot.metadata.workspaceKey,
                workspaceRoot: context.workspaceRoot,
                projectPath: context.projectPath,
                systemPrompt: prepared.systemPrompt ?? context.systemPrompt,
                messages: [
                    ...context.messages,
                    ...preparedModelContextMessages,
                ],
                model,
                apiKey,
                timeoutMs: providerOptions.timeoutMs,
                requestOptions: providerOptions.requestOptions,
                toolKeys,
                profileKey: context.profileKey,
                thinkingLevel,
                abortSignal: abortController.signal,
                invocationId,
                onEvent: input.onEvent,
            });
            errorPhase = "ingest";
            const finalResult = await this.finalizeInvokeResult({
                input,
                invocationId,
                snapshot,
                context,
                prepared,
                toolKeys,
                model,
                apiKey,
                thinkingLevel,
                result,
            });
            const lifecycleEntry = await this.repo.appendEntry(input.sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: finalResult.status === "error" ? "error" : finalResult.status === "waiting" ? "start" : "end",
                error: finalResult.error,
                errorInfo: finalResult.error ? this.toInvocationErrorInfo(finalResult.error, finalResult.errorPhase ?? "unknown") : undefined,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(input.sessionId, invocationId, lifecycleEntry);
            if (finalResult.status !== "waiting") {
                await this.finishInvocation(input.sessionId, invocationId);
                void this.drainFollowUps(input.sessionId);
            }
            if (finalResult.status === "completed") {
                void this.triggerSessionSummarizer(input.sessionId, snapshot.metadata.workspaceKey);
            }
            return finalResult;
        } catch (error) {
            const errorInfo = this.toInvocationErrorInfo(error, abortController.signal.aborted ? "unknown" : errorPhase);
            const lifecycleEntry = await this.repo.appendEntry(input.sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: abortController.signal.aborted ? "aborted" : "error",
                error: errorInfo.message,
                errorInfo,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(input.sessionId, invocationId, lifecycleEntry);
            await this.finishInvocation(input.sessionId, invocationId);
            return {
                sessionId: input.sessionId,
                invocationId,
                status: "error",
                error: errorInfo.message,
                errorPhase: errorInfo.phase,
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
        toolKeys: string[];
        model: Model<any>;
        apiKey?: string;
        thinkingLevel: ThinkingLevel;
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
    }): Promise<InvokeAgentResult> {
        const {input: invokeInput, invocationId, snapshot, context, prepared, toolKeys, model, apiKey, thinkingLevel, result} = input;
        if (result.finalAssistant?.stopReason === "error" || result.finalAssistant?.stopReason === "aborted") {
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "error",
                error: result.finalAssistant.errorMessage || (result.finalAssistant.stopReason === "aborted" ? "生成已中断。" : "生成失败，provider 未返回错误详情。"),
                errorPhase: "model",
                finalMessage: messageText(result.finalAssistant),
                usage: result.finalAssistant.usage,
                events: result.events,
            };
        }

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

        if (!result.reportResult && toolKeys.includes("report_result")) {
            const config = await loadEffectiveConfig(context);
            const providerOptions = this.providerOptions(config, model);
            return this.remindReportResult(invokeInput, invocationId, result.events, result.finalAssistant, {
                workspaceKey: snapshot.metadata.workspaceKey,
                workspaceRoot: context.workspaceRoot,
                systemPrompt: prepared.systemPrompt ?? context.systemPrompt,
                model,
                apiKey,
                timeoutMs: providerOptions.timeoutMs,
                requestOptions: providerOptions.requestOptions,
                toolKeys,
                profileKey: context.profileKey,
                thinkingLevel,
            });
        }

        const ingestError = await this.applyIngest(invokeInput.sessionId);
        if (ingestError) {
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "error",
                error: ingestError,
                errorPhase: "ingest",
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
    async listSessions(query: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> {
        const repoQuery = {
            ...query,
            includeArchived: query.includeArchived || query.status === "archived",
            status: undefined,
            limit: undefined,
        };
        const summaries = (await this.repo.listSessions(repoQuery)).map((summary) => ({
            ...summary,
            status: this.resolveSessionStatus(summary.sessionId, summary.archived),
        }));
        const filtered = summaries.filter((summary) => this.matchesSessionStatusFilter(summary, query.status));
        return query.limit ? filtered.slice(0, query.limit) : filtered;
    }

    /**
     * 按前端 session 状态筛选运行期摘要。
     */
    private matchesSessionStatusFilter(summary: AgentSessionSummaryDto, status: AgentSessionListQueryDto["status"]): boolean {
        if (!status || status === "all") {
            return true;
        }
        if (status === "active") {
            return !summary.archived;
        }
        return summary.status === status;
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
            const linkedContext = this.repo.reduce(linkedSnapshot);
            linkedAgents.push({
                ...this.repo.summary(linkedSnapshot),
                status: this.resolveSessionStatus(linked.sessionId, linkedContext.archived),
                detached: linked.detached,
            });
        }
        const linkedByAgents = await this.linkedByAgents(snapshot.metadata.sessionId, snapshot.metadata.workspaceKey);
        const systemPrompt = await this.snapshotSystemPrompt(snapshot, context);
        const effectiveThinkingLevel = await this.snapshotThinkingLevel(snapshot, context);

        return {
            summary: {
                ...this.repo.summary(snapshot),
                status: this.resolveSessionStatus(sessionId, context.archived),
            },
            activeLeafId: snapshot.leafId,
            ...systemPrompt ? {systemPrompt} : {},
            messages: context.messages,
            tree: this.repo.tree(snapshot),
            entries: this.repo.activePath(snapshot),
            linkedAgents,
            linkedByAgents,
            pendingApproval: pendingApproval ? await this.pendingApprovalDto(snapshot, pendingApproval) : null,
            steerQueue: this.steerQueues.get(sessionId) ?? [],
            followUpQueue: this.followUpQueues.get(sessionId) ?? [],
            activeInvocation: this.activeInvocations.get(sessionId) ?? null,
            model: context.model,
            thinkingLevel: context.thinkingLevel,
            effectiveThinkingLevel,
            planModeActive: context.planModeActive,
            lastSeq: this.eventHub.lastSeq,
            usage: [...context.messages].reverse().find((message) => message.role === "assistant")?.usage,
        };
    }

    /**
     * 查找同 workspace 内哪些 session 仍记录了指向目标 session 的 agent link。
     */
    private async linkedByAgents(sessionId: number, workspaceKey: string): Promise<AgentLinkedSessionDto[]> {
        const summaries = await this.repo.listSessions({workspaceKey, includeArchived: true});
        const linkedByAgents: AgentLinkedSessionDto[] = [];
        for (const summary of summaries) {
            if (summary.sessionId === sessionId) {
                continue;
            }
            const ownerSnapshot = await this.repo.readSession(summary.sessionId, summary.workspaceKey);
            const ownerContext = this.repo.reduce(ownerSnapshot);
            const linked = ownerContext.linkedAgents.find((item) => item.sessionId === sessionId);
            if (!linked) {
                continue;
            }
            linkedByAgents.push({
                ...this.repo.summary(ownerSnapshot),
                status: this.resolveSessionStatus(summary.sessionId, ownerContext.archived),
                detached: linked.detached,
            });
        }
        return linkedByAgents.sort((left, right) => right.updatedAt - left.updatedAt);
    }

    /**
     * 解析当前 profile 的 provider system prompt，供前端只读展示。
     */
    private async snapshotSystemPrompt(snapshot: SessionSnapshot, context: NeuroSessionContext): Promise<string | undefined> {
        const profile = await this.profiles.get(context.profileKey);
        const input = this.profiles.parseInput(profile, snapshot.metadata.input);
        const prepareContext = {
            session: context,
            input: input as never,
            vars: await this.createProfileVariableAccessor(snapshot, profile, {dryRun: true}),
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
            },
        };
        if (profile.context) {
            return compileProfileSystemPrompt(profile, prepareContext, await profile.context(prepareContext));
        }
        return undefined;
    }

    private async pendingApprovalDto(
        snapshot: SessionSnapshot,
        pending: {toolCallId: string; toolName: string; args: Record<string, unknown>},
    ): Promise<AgentPendingApprovalDto> {
        const base: AgentPendingApprovalDto = {
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            args: pending.args as JsonValue,
        };
        if (pending.toolName !== "exit_plan_mode") {
            return base;
        }
        const planFilePath = typeof pending.args.planFilePath === "string" ? pending.args.planFilePath : "";
        if (!planFilePath.trim()) {
            return base;
        }
        const target = resolvePlanModeFile(snapshot.metadata.workspaceRoot, planFilePath);
        return {
            ...base,
            planFilePath: target.displayPath,
            planContent: await readFile(target.absolutePath, "utf-8"),
        };
    }

    /**
     * 解析 snapshot 显示用 thinking 状态，和下一次 run 使用同一套模型/profile 规则。
     */
    private async snapshotThinkingLevel(snapshot: SessionSnapshot, context: NeuroSessionContext): Promise<ThinkingLevel> {
        try {
            const config = await loadEffectiveConfig(snapshot.metadata);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            return this.resolveThinkingLevel(context, config, model);
        } catch {
            return "off";
        }
    }

    private planModeState(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        active: boolean,
        reminderKind: string,
        lastTransition: string,
        extra: {approved?: boolean; hasExited?: boolean; reason?: string} = {},
    ): JsonValue {
        const previous = context.customState[AGENT_PLAN_MODE_STATE_KEY];
        const previousRecord = previous && typeof previous === "object" && !Array.isArray(previous)
            ? previous as Record<string, JsonValue>
            : {};
        const hasExited = extra.hasExited ?? Boolean(previousRecord.hasExited);
        return {
            active,
            reminderKind,
            workDirectory: planModeDirectory(snapshot.metadata.workspaceRoot).replace(/\\/g, "/"),
            lastTransition,
            hasExited,
            updatedAt: new Date().toISOString(),
            ...(extra.approved !== undefined ? {approved: extra.approved} : {}),
            ...(extra.reason ? {reason: extra.reason} : {}),
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
                projectPath: snapshot.metadata.projectPath,
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
            const active = body.active;
            const context = this.repo.reduce(snapshot);
            const entry = await this.repo.appendEntry(sessionId, {
                type: "custom",
                key: "ui.planMode.active",
                value: active,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, undefined, entry);
            const stateEntry = await this.repo.appendEntry(sessionId, {
                type: "custom",
                key: AGENT_PLAN_MODE_STATE_KEY,
                value: this.planModeState(snapshot, context, active, active ? "full" : "sparse", "ui_plan_toggle"),
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, undefined, stateEntry);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "model") {
            const config = await loadEffectiveConfig(snapshot.metadata);
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
        if (body.command === "thinking") {
            const context = this.repo.reduce(snapshot);
            if (context.thinkingLevel === body.thinkingLevel) {
                return {
                    status: "completed",
                    sessionId,
                    snapshot: await this.getSessionSnapshot(sessionId),
                };
            }
            const written = await this.repo.appendEntry(sessionId, {
                type: "thinking_level_change",
                thinkingLevel: body.thinkingLevel,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, undefined, written);
            await this.publishSessionState(sessionId);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "summarize") {
            void this.triggerSessionSummarizer(sessionId, snapshot.metadata.workspaceKey, {force: true});
            return {
                status: "started",
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
            const updatedSnapshot = await this.getSessionSnapshot(sessionId);
            void this.triggerSessionSummarizer(sessionId, snapshot.metadata.workspaceKey);
            return {
                status: "completed",
                snapshot: updatedSnapshot,
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
                clientState: body.next.clientState,
                internalQueued: true,
            });
            return {
                status: "invoked",
                snapshot: await this.getSessionSnapshot(sessionId),
                invocation,
            };
        }
        const updatedSnapshot = await this.getSessionSnapshot(sessionId);
        void this.triggerSessionSummarizer(sessionId, snapshot.metadata.workspaceKey);
        return {
            status: "completed",
            snapshot: updatedSnapshot,
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
        this.steerableSessions.delete(sessionId);
        this.abortControllers.get(sessionId)?.abort(body.reason);
        if (body.clearQueue ?? true) {
            this.steerQueues.delete(sessionId);
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
     * 前端确认 client.* variable patch 已应用。
     */
    async acknowledgeClientVariablePatch(sessionId: number, ack: VariablePatchAck): Promise<void> {
        const key = clientPatchKey(ack.invocationId, ack.toolCallId, ack.path);
        const pending = this.pendingClientPatches.get(key);
        if (!pending) {
            throw new Error(`未找到等待中的 client variable patch：${ack.path}`);
        }
        if (pending.request.namespace !== ack.namespace || pending.request.path !== ack.path) {
            throw new Error(`client variable patch ack 不匹配：${ack.path}`);
        }
        clearTimeout(pending.timeout);
        this.pendingClientPatches.delete(key);
        const snapshot = await this.repo.readSession(sessionId);
        const entry = await this.repo.appendEntry(sessionId, {
            type: "client_variable_patch_ack",
            namespace: "client",
            path: ack.path,
            operations: ack.operations,
            appliedValue: ack.appliedValue,
            error: ack.error,
            invocationId: ack.invocationId,
            toolCallId: ack.toolCallId,
        }, snapshot.metadata.workspaceKey);
        this.publishSessionEntry(sessionId, ack.invocationId, entry);
        pending.resolve(ack);
    }

    /**
     * 查询轻量 session 信息，不返回完整历史原文。
     */
    async getSession(input: number | SessionQueryInput | undefined, requesterSessionId?: number): Promise<SessionQueryResult> {
        const query = typeof input === "number" ? {sessionId: input} : input ?? {};
        const targetSessionId = query.sessionId ?? requesterSessionId;
        if (typeof targetSessionId !== "number") {
            throw new Error("get_session 需要 sessionId，或在 agent session 内调用。");
        }
        const recentMessageLimit = query.recentMessageLimit ?? 3;
        const tokenBudget = query.tokenBudget ?? 1200;
        if (!Number.isInteger(recentMessageLimit) || recentMessageLimit < 1 || recentMessageLimit > 10) {
            throw new Error("get_session.recentMessageLimit 必须是 1 到 10 的整数。");
        }
        if (!Number.isInteger(tokenBudget) || tokenBudget < 100 || tokenBudget > 3000) {
            throw new Error("get_session.tokenBudget 必须是 100 到 3000 的整数。");
        }
        const snapshot = await this.repo.readSession(targetSessionId);
        const context = this.repo.reduce(snapshot);
        const linkedAgents: AgentSummary[] = [];
        for (const linked of context.linkedAgents) {
            linkedAgents.push(this.sessionSummary(await this.repo.readSession(linked.sessionId), linked.detached));
        }
        const result: SessionQueryResult = {
            metadata: snapshot.metadata,
            activeLeafId: snapshot.leafId,
            title: context.title,
            summary: context.summary ?? this.sessionFallbackSummary(context.messages),
            usage: [...context.messages].reverse().find((message) => message.role === "assistant")?.usage,
            linkedAgents,
        };
        if (!query.includeRecentMessages) {
            return result;
        }
        const recentMessages = this.repo.activePath(snapshot)
            .filter((entry) => entry.type === "message")
            .slice(-recentMessageLimit)
            .map((entry) => ({
                role: entry.message.role,
                text: messageText(entry.message).slice(0, 500),
                timestamp: entry.timestamp,
            }));
        const estimatedTokens = estimateTextTokens(JSON.stringify(recentMessages));
        if (estimatedTokens > tokenBudget) {
            throw new Error(`get_session recentMessages 超出 tokenBudget：估算 ${estimatedTokens} > ${tokenBudget}。复杂历史查询请到 session 文件目录使用 bash、jq、rg 自助查询。`);
        }
        return {
            ...result,
            recentMessages,
        };
    }

    private sessionFallbackSummary(messages: AgentMessage[]): string | undefined {
        const latest = [...messages].reverse()
            .map((message) => message.role === "custom" ? "" : messageText(message as Message))
            .find((text) => text.trim().length > 0);
        return latest?.replace(/\s+/g, " ").trim().slice(0, 360) || undefined;
    }

    private async prepare(snapshot: SessionSnapshot, invocationId?: string, pendingUserMessage?: Message, clientState?: ClientStateSnapshot): Promise<ProfileTurnPlan> {
        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const context = this.repo.reduce(snapshot);
        const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
        const vars = await this.createProfileVariableAccessor(snapshot, profile, {clientState, invocationId});
        const prepared = await profile.prepare!({
            session: context,
            input: parsedInput as never,
            invocation: {
                input: pendingUserMessage ? {message: messageText(pendingUserMessage)} : undefined,
                clientState,
            },
            vars,
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
                pendingUserMessage,
            },
        });
        validateProfileTurnPlan(profile.manifest.key, prepared);

        const appendingMessages = [
            ...prepared.modelContextAppendingMessages ?? [],
            ...prepared.appendingMessages ?? [],
        ];
        if (prepared.historyInitMessages?.length && context.messages.length === 0) {
            for (const message of prepared.historyInitMessages) {
                const entry = await this.repo.appendEntry(snapshot.metadata.sessionId, {
                    type: "custom_message",
                    message,
                    visibleToModel: true,
                }, snapshot.metadata.workspaceKey);
                this.publishSessionEntry(snapshot.metadata.sessionId, invocationId, entry);
            }
        }
        for (const message of appendingMessages) {
            const entry = await this.repo.appendEntry(snapshot.metadata.sessionId, {
                type: "custom_message",
                message,
                visibleToModel: true,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(snapshot.metadata.sessionId, invocationId, entry);
        }
        for (const write of prepared.stateWrites ?? []) {
            this.assertValidProfileStateWrite(profile.manifest.key, write);
            const entry = await this.repo.appendEntry(snapshot.metadata.sessionId, write, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(snapshot.metadata.sessionId, invocationId, entry);
        }
        if ((prepared.historyInitMessages?.length && context.messages.length === 0) || appendingMessages.length || prepared.stateWrites?.length) {
            await this.publishSessionState(snapshot.metadata.sessionId, invocationId);
        }

        return prepared;
    }

    private async prepareCompactionPolicy(profile: AgentProfile, snapshot: SessionSnapshot, context: ReturnType<JsonlSessionRepository["reduce"]>): Promise<ProfileCompactionPlan | undefined> {
        if (!profile.prepare) {
            return undefined;
        }
        const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
        const vars = await this.createProfileVariableAccessor(snapshot, profile, {dryRun: true});
        const prepared = await profile.prepare({
            session: context,
            input: parsedInput as never,
            vars,
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
            },
        });
        validateProfileTurnPlan(profile.manifest.key, prepared);
        return prepared.compaction;
    }

    private assertValidProfileStateWrite(profileKey: string, write: SessionEntryDraft): void {
        if (write.type !== "custom" || write.key !== profileStateKey(profileKey)) {
            throw new Error(`profile ${profileKey} stateWrites 只允许写 ${profileStateKey(profileKey)} custom entry。`);
        }
    }

    private countPromptUserTurns(snapshot: SessionSnapshot): number {
        return this.repo.activePath(snapshot).filter((entry) => {
            return entry.type === "message" && entry.origin === "prompt" && entry.message.role === "user";
        }).length;
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
            const vars = await this.createProfileVariableAccessor(snapshot, profile, {dryRun: true});
            const ingest = await profile.ingest({
                session: context,
                input: parsedInput as never,
                vars,
                catalog: await this.profiles.snapshot(),
                skills: await this.skills.list(),
            });
            this.assertValidIngest(profile, ingest);
            for (const message of ingest.messageWrites ?? []) {
                const entry = await this.repo.appendMessage(sessionId, message, snapshot.metadata.workspaceKey, "ingest");
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

    /**
     * 触发源 session 的后台展示标题/摘要维护。
     */
    private async triggerSessionSummarizer(sourceSessionId: number, workspaceKey?: string, options: {force?: boolean} = {}): Promise<void> {
        try {
            if (!this.enableSessionSummarizer) {
                return;
            }
            const sourceSnapshot = await this.repo.readSession(sourceSessionId, workspaceKey);
            if (sourceSnapshot.metadata.systemRole) {
                return;
            }
            const sourceContext = this.repo.reduce(sourceSnapshot);
            if (sourceContext.archived) {
                return;
            }
            if (!this.isLeaderProfile(sourceContext.profileKey)) {
                return;
            }
            const sourceProfile = await this.profiles.get(sourceContext.profileKey);
            const config = sourceProfile.summarizer;
            if (!config || config.enabled === false) {
                return;
            }
            if (this.activeSummarizers.has(sourceSessionId)) {
                await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                    ...this.readSummarizerState(sourceContext),
                    dirty: true,
                    running: true,
                });
                return;
            }
            this.activeSummarizers.add(sourceSessionId);
            try {
                let rerun = true;
                let forceCurrent = options.force ?? false;
                while (rerun) {
                    rerun = false;
                    await this.runSessionSummarizer(sourceSessionId, workspaceKey, {force: forceCurrent});
                    forceCurrent = false;
                    const latestSnapshot = await this.repo.readSession(sourceSessionId, workspaceKey);
                    const latestContext = this.repo.reduce(latestSnapshot);
                    const state = this.readSummarizerState(latestContext);
                    if (state.dirty) {
                        await this.writeSummarizerState(latestSnapshot, latestContext, {
                            ...state,
                            dirty: false,
                            running: true,
                        });
                        rerun = true;
                    }
                }
            } finally {
                this.activeSummarizers.delete(sourceSessionId);
                const latestSnapshot = await this.repo.readSession(sourceSessionId, workspaceKey);
                const latestContext = this.repo.reduce(latestSnapshot);
                const state = this.readSummarizerState(latestContext);
                await this.writeSummarizerState(latestSnapshot, latestContext, {
                    ...state,
                    running: false,
                });
            }
        } catch {
            // 不能让后台摘要污染 leader invocation；可诊断错误在 runSessionSummarizer 内写入 state。
        }
    }

    /**
     * 执行一次后台摘要。失败只写诊断状态，不抛给源 invocation。
     */
    private async runSessionSummarizer(sourceSessionId: number, workspaceKey: string | undefined, options: {force: boolean}): Promise<void> {
        const sourceSnapshot = await this.repo.readSession(sourceSessionId, workspaceKey);
        const sourceContext = this.repo.reduce(sourceSnapshot);
        const sourceProfile = await this.profiles.get(sourceContext.profileKey);
        const config = sourceProfile.summarizer;
        if (!config || config.enabled === false) {
            return;
        }
        const summarizerProfileKey = config.profileKey;
        const summarizerInput = {
            ...DEFAULT_SUMMARIZER_INPUT,
            ...(isRecord(config.input) ? config.input : {}),
            sourceSessionId,
        } satisfies JsonValue;
        const summarizerInputFingerprint = hashJsonValue(summarizerInput);
        const dialogueContent = buildAgentDialogueContent({
            repo: this.repo,
            snapshot: sourceSnapshot,
            summarizerProfileKey,
            summarizerInput,
        });
        const previousState = this.readSummarizerState(sourceContext);
        const nextTurnCount = (previousState.turnCount ?? 0) + 1;
        const nextLoopCount = (previousState.loopCount ?? 0) + 1;
        const interval = isRecord(summarizerInput.interval) ? summarizerInput.interval : DEFAULT_SUMMARIZER_INPUT.interval;
        const maxDialogueContentTokens = typeof summarizerInput.maxDialogueContentTokens === "number"
            ? summarizerInput.maxDialogueContentTokens
            : 80_000;
        const baseState = {
            ...previousState,
            profileKey: summarizerProfileKey,
            summarizerInputFingerprint,
            running: true,
            dirty: false,
            lastDialogueContentTokens: dialogueContent.tokens,
            turnCount: nextTurnCount,
            loopCount: nextLoopCount,
        } satisfies SessionSummarizerState;

        if (!dialogueContent.text.trim()) {
            await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                ...baseState,
                lastError: "Agent Dialogue Content 为空，跳过摘要。",
            });
            return;
        }
        if (dialogueContent.tokens > maxDialogueContentTokens) {
            await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                ...baseState,
                lastError: `Agent Dialogue Content 超过上限：${dialogueContent.tokens}/${maxDialogueContentTokens}`,
            });
            return;
        }
        if (!options.force && previousState.lastDialogueContentFingerprint === dialogueContent.fingerprint) {
            await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                ...baseState,
                lastError: undefined,
            });
            return;
        }
        if (!options.force && !this.shouldRunSummarizerInterval(interval, previousState, dialogueContent.tokens, nextTurnCount, nextLoopCount)) {
            await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                ...baseState,
                lastError: undefined,
            });
            return;
        }

        try {
            const summarizerSnapshot = await this.ensureSummarizerSession(sourceSnapshot, sourceContext, summarizerProfileKey, summarizerInput, summarizerInputFingerprint);
            const result = await this.invokeAgent({
                sessionId: summarizerSnapshot.metadata.sessionId,
                mode: "prompt",
                message: {
                    text: [
                        "请根据下面的 Agent Dialogue Content 生成源 session 的展示 title 和 summary。",
                        "",
                        "<agent-dialogue-content>",
                        dialogueContent.text,
                        "</agent-dialogue-content>",
                        "",
                        `title 不超过 ${SESSION_TITLE_MAX_LENGTH} 字，summary 不超过 ${SESSION_SUMMARY_MAX_LENGTH} 字。必须使用 report_result.data 返回 {title, summary}。`,
                    ].join("\n"),
                },
                internalQueued: true,
            });
            if (result.status !== "completed") {
                throw new Error(result.error ?? `summarizer status: ${result.status}`);
            }
            const output = this.parseSummarizerOutput(result.reportResult?.data);
            await this.writeSummarizerResult(sourceSnapshot, output);
            await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                ...baseState,
                sessionId: summarizerSnapshot.metadata.sessionId,
                lastDialogueContentFingerprint: dialogueContent.fingerprint,
                lastRunDialogueContentTokens: dialogueContent.tokens,
                lastRunAt: Date.now(),
                lastError: undefined,
            });
        } catch (error) {
            await this.writeSummarizerState(sourceSnapshot, sourceContext, {
                ...baseState,
                lastError: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private shouldRunSummarizerInterval(interval: Record<string, JsonValue>, previousState: SessionSummarizerState, currentTokens: number, turnCount: number, loopCount: number): boolean {
        const kind = typeof interval.kind === "string" ? interval.kind : "turn";
        const value = typeof interval.value === "number" && interval.value > 0 ? interval.value : 1;
        if (kind === "dialogueContentTokens") {
            const previousTokens = previousState.lastRunDialogueContentTokens ?? 0;
            return currentTokens - previousTokens >= value;
        }
        if (kind === "loop") {
            return loopCount % value === 0;
        }
        return turnCount % value === 0;
    }

    private async ensureSummarizerSession(sourceSnapshot: SessionSnapshot, sourceContext: NeuroSessionContext, profileKey: string, input: JsonValue, inputFingerprint: string): Promise<SessionSnapshot> {
        const state = this.readSummarizerState(sourceContext);
        if (state.sessionId && state.summarizerInputFingerprint === inputFingerprint) {
            try {
                const existing = await this.repo.readSession(state.sessionId, sourceSnapshot.metadata.workspaceKey);
                if (existing.metadata.systemRole === "summarizer" && existing.metadata.profileKey === profileKey && hashJsonValue(existing.metadata.input) === hashJsonValue(input)) {
                    return existing;
                }
            } catch {
                // 旧状态指向的 session 不存在时，重新创建后台 session。
            }
        }
        const created = await this.createSystemAgent({
            profileKey,
            input,
            workspaceRoot: sourceSnapshot.metadata.workspaceRoot,
            workspaceKey: sourceSnapshot.metadata.workspaceKey,
            projectPath: sourceSnapshot.metadata.projectPath,
            systemRole: "summarizer",
        });
        await this.writeSummarizerState(sourceSnapshot, sourceContext, {
            ...state,
            sessionId: created.metadata.sessionId,
            profileKey,
            running: true,
        });
        return created;
    }

    private parseSummarizerOutput(data: unknown): {title: string; summary: string} {
        const parsed = Value.Parse(SessionSummarizerOutputSchema, data) as {title: string; summary: string};
        const title = parsed.title.trim();
        const summary = parsed.summary.trim();
        if (!title) {
            throw new Error("summarizer title 为空");
        }
        if (!summary) {
            throw new Error("summarizer summary 为空");
        }
        if (title.length > SESSION_TITLE_MAX_LENGTH) {
            throw new Error(`summarizer title 超过 ${SESSION_TITLE_MAX_LENGTH} 字`);
        }
        if (summary.length > SESSION_SUMMARY_MAX_LENGTH) {
            throw new Error(`summarizer summary 超过 ${SESSION_SUMMARY_MAX_LENGTH} 字`);
        }
        return {title, summary};
    }

    private async writeSummarizerResult(sourceSnapshot: SessionSnapshot, output: {title: string; summary: string}): Promise<void> {
        const entry = await this.repo.appendProjectionEntry(sourceSnapshot.metadata.sessionId, {
            type: "session_update",
            updates: output,
        }, sourceSnapshot.metadata.workspaceKey);
        this.publishSessionEntry(sourceSnapshot.metadata.sessionId, undefined, entry);
        await this.publishSessionState(sourceSnapshot.metadata.sessionId);
    }

    private readSummarizerState(context: NeuroSessionContext): SessionSummarizerState {
        const value = context.customState[SESSION_SUMMARIZER_STATE_KEY];
        if (!isRecord(value)) {
            return {};
        }
        return {
            sessionId: typeof value.sessionId === "number" ? value.sessionId : undefined,
            profileKey: typeof value.profileKey === "string" ? value.profileKey : undefined,
            summarizerInputFingerprint: typeof value.summarizerInputFingerprint === "string" ? value.summarizerInputFingerprint : undefined,
            running: typeof value.running === "boolean" ? value.running : undefined,
            dirty: typeof value.dirty === "boolean" ? value.dirty : undefined,
            lastDialogueContentFingerprint: typeof value.lastDialogueContentFingerprint === "string" ? value.lastDialogueContentFingerprint : undefined,
            lastDialogueContentTokens: typeof value.lastDialogueContentTokens === "number" ? value.lastDialogueContentTokens : undefined,
            lastRunDialogueContentTokens: typeof value.lastRunDialogueContentTokens === "number" ? value.lastRunDialogueContentTokens : undefined,
            lastRunAt: typeof value.lastRunAt === "number" ? value.lastRunAt : undefined,
            lastError: typeof value.lastError === "string" ? value.lastError : undefined,
            turnCount: typeof value.turnCount === "number" ? value.turnCount : undefined,
            loopCount: typeof value.loopCount === "number" ? value.loopCount : undefined,
        };
    }

    private async writeSummarizerState(sourceSnapshot: SessionSnapshot, sourceContext: NeuroSessionContext, state: SessionSummarizerState): Promise<void> {
        const latestSnapshot = await this.repo.readSession(sourceSnapshot.metadata.sessionId, sourceSnapshot.metadata.workspaceKey);
        const previous = this.readSummarizerState(this.repo.reduce(latestSnapshot));
        const value: Record<string, JsonValue> = {};
        for (const [key, entryValue] of Object.entries({...previous, ...state})) {
            if (entryValue !== undefined) {
                value[key] = entryValue;
            }
        }
        const entry = await this.repo.appendProjectionEntry(sourceSnapshot.metadata.sessionId, {
            type: "custom",
            key: SESSION_SUMMARIZER_STATE_KEY,
            value,
        }, sourceSnapshot.metadata.workspaceKey);
        this.publishSessionEntry(sourceSnapshot.metadata.sessionId, undefined, entry);
        await this.publishSessionState(sourceSnapshot.metadata.sessionId);
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

    private async appendResolution(snapshot: SessionSnapshot, resolution: AgentResolution, invocationId?: string): Promise<void> {
        const context = this.repo.reduce(snapshot);
        const messages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pending = findPendingApprovalCall(messages, this.tools.approvalToolKeys());
        if (!pending) {
            throw new Error("当前 session 没有等待中的审批 tool call");
        }
        const entry = await this.repo.appendMessage(snapshot.metadata.sessionId, resolutionToToolResult(resolution, pending), snapshot.metadata.workspaceKey, "harness");
        this.publishSessionEntry(snapshot.metadata.sessionId, invocationId, entry);
        if (resolution.kind === "tool_approval" && (pending.toolName === "enter_plan_mode" || pending.toolName === "exit_plan_mode")) {
            await this.appendPlanModeResolution(snapshot, context, pending, resolution.approved, invocationId);
        }
        await this.publishSessionState(snapshot.metadata.sessionId, invocationId);
    }

    private async appendPlanModeResolution(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        pending: {toolName: string; args: Record<string, unknown>},
        approved: boolean,
        invocationId?: string,
    ): Promise<void> {
        const active = pending.toolName === "enter_plan_mode"
            ? approved
            : approved ? false : context.planModeActive;
        const previous = context.customState[AGENT_PLAN_MODE_STATE_KEY];
        const previousRecord = previous && typeof previous === "object" && !Array.isArray(previous)
            ? previous as Record<string, JsonValue>
            : {};
        const hasExited = Boolean(previousRecord.hasExited) || (pending.toolName === "exit_plan_mode" && approved);
        const reminderKind = pending.toolName === "enter_plan_mode" && approved
            ? previousRecord.hasExited ? "reentry_full" : "full"
            : pending.toolName === "exit_plan_mode" && approved ? "exit" : "sparse";
        const reason = typeof pending.args.reason === "string" ? pending.args.reason : undefined;
        await this.appendCustomState(snapshot.metadata.sessionId, "ui.planMode.active", active, snapshot.metadata.workspaceKey, invocationId);
        await this.appendCustomState(snapshot.metadata.sessionId, AGENT_PLAN_MODE_STATE_KEY, this.planModeState(
            snapshot,
            context,
            active,
            reminderKind,
            pending.toolName,
            {approved, hasExited, reason},
        ), snapshot.metadata.workspaceKey, invocationId);
    }

    private async runLoop(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        projectPath?: string;
        systemPrompt: string;
        messages: AgentMessage[];
        model: Model<any>;
        apiKey?: string;
        timeoutMs?: number | null;
        requestOptions?: Record<string, JsonValue>;
        toolKeys: string[];
        profileKey: string;
        thinkingLevel: ThinkingLevel;
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
        };
        const toolOverrides = await this.toolOverrides(input.toolKeys, input.profileKey);
        const visibleTools = this.tools.allowedWithOverrides(input.toolKeys, toolOverrides);
        this.assertNoUnclosedToolCallsForModel(input.messages);
        const messages = input.messages.slice();
        let reportResult: InvokeAgentResult["reportResult"] | undefined;
        let finalAssistant: AssistantMessage | undefined;

        await emit({type: "agent_start"});
        let shouldContinue = true;
        while (shouldContinue) {
            await emit({type: "turn_start"});
            const preModelSteers = await this.drainSteers({
                sessionId: input.sessionId,
                workspaceKey: input.workspaceKey,
                invocationId: input.invocationId,
            });
            for (const steeredMessage of preModelSteers) {
                messages.push(steeredMessage);
            }
            const assistant = await this.streamAssistant({
                systemPrompt: input.systemPrompt,
                messages,
                model: input.model,
                apiKey: input.apiKey,
                timeoutMs: input.timeoutMs,
                requestOptions: input.requestOptions,
                tools: visibleTools,
                sessionId: input.sessionId,
                thinkingLevel: input.thinkingLevel,
                abortSignal: input.abortSignal,
                emit,
            });
            messages.push(assistant);
            finalAssistant = assistant;
            if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
                this.steerableSessions.delete(input.sessionId);
                await this.commitTurn({
                    sessionId: input.sessionId,
                    workspaceKey: input.workspaceKey,
                    invocationId: input.invocationId,
                    assistant,
                    toolResults: [],
                });
                await emit({type: "turn_end", message: assistant, toolResults: []});
                break;
            }

            const toolCalls = assistant.content.filter((block): block is AgentToolCall => block.type === "toolCall");
            const toolBatch = await this.runToolBatch({
                sessionId: input.sessionId,
                workspaceKey: input.workspaceKey,
                workspaceRoot: input.workspaceRoot,
                projectPath: input.projectPath,
                invocationId: input.invocationId,
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
            await this.commitTurn({
                sessionId: input.sessionId,
                workspaceKey: input.workspaceKey,
                invocationId: input.invocationId,
                assistant,
                toolResults: toolBatch.toolResults,
                waiting: toolBatch.waiting,
            });
            if (!toolBatch.waiting) {
                this.steerableSessions.delete(input.sessionId);
            }
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
            const steeredMessages = await this.drainSteers({
                sessionId: input.sessionId,
                workspaceKey: input.workspaceKey,
                invocationId: input.invocationId,
            });
            for (const steeredMessage of steeredMessages) {
                messages.push(steeredMessage);
            }
            shouldContinue = toolBatch.shouldContinue || steeredMessages.length > 0;
            if (shouldContinue) {
                this.steerableSessions.add(input.sessionId);
            }
        }
        this.steerableSessions.delete(input.sessionId);
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
        timeoutMs?: number | null;
        requestOptions?: Record<string, JsonValue>;
        tools: ReturnType<AgentToolRegistry["allowed"]>;
        sessionId: number;
        thinkingLevel: ThinkingLevel;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
    }): Promise<AssistantMessage> {
        const llmMessages = input.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const context = {
            systemPrompt: input.systemPrompt,
            messages: llmMessages,
            tools: input.tools,
        };
        const options = {
            sessionId: String(input.sessionId),
            reasoning: input.thinkingLevel === "off" ? undefined : input.thinkingLevel,
            apiKey: input.apiKey,
            timeoutMs: input.timeoutMs ?? undefined,
            ...this.piStreamOptions(input.requestOptions),
            signal: input.abortSignal,
        };
        const stream = await streamSimple(input.model, context, options);

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
        projectPath?: string;
        invocationId?: string;
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
                const approvalError = await this.validateApprovalTool(input.allowedToolKeys, input.workspaceRoot, toolCall);
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
                    toolResults: [
                        ...toolResults,
                        ...this.skippedToolResultsAfterApproval(input.toolCalls, toolCall),
                    ],
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
                projectPath: input.projectPath,
                invocationId: input.invocationId,
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

    private skippedToolResultsAfterApproval(toolCalls: AgentToolCall[], waitingToolCall: AgentToolCall): ToolResultMessage[] {
        const waitingIndex = toolCalls.findIndex((toolCall) => toolCall.id === waitingToolCall.id);
        if (waitingIndex < 0) {
            return [];
        }
        return toolCalls.slice(waitingIndex + 1).map((toolCall) => createTextToolResult({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            text: `Skipped because ${waitingToolCall.name} is waiting for user approval. This tool was not executed in this turn.`,
            isError: true,
        }));
    }

    private async validateApprovalTool(allowedToolKeys: string[], workspaceRoot: string, toolCall: AgentToolCall): Promise<string | null> {
        const tool = this.tools.get(toolCall.name);
        if (!tool) {
            return `Tool ${toolCall.name} not found`;
        }
        if (!allowedToolKeys.includes(tool.key)) {
            return `Tool ${toolCall.name} is not allowed by this profile`;
        }
        if (toolCall.name === "exit_plan_mode" && typeof toolCall.arguments.planFilePath === "string" && toolCall.arguments.planFilePath.trim()) {
            try {
                await readFile(resolvePlanModeFile(workspaceRoot, toolCall.arguments.planFilePath).absolutePath, "utf-8");
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        }
        return null;
    }

    private async executeTool(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        projectPath?: string;
        invocationId?: string;
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
                projectPath: input.projectPath,
                invocationId: input.invocationId,
                vars: await this.createVariableAccessor(input.sessionId, input.invocationId),
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

    private assertSessionIdle(sessionId: number): void {
        if (this.activeInvocations.has(sessionId)) {
            throw new Error("active_invocation_exists");
        }
    }

    private enqueueSteer(sessionId: number, message: AgentUserMessageInput): AgentFollowUpQueueItemDto {
        const item: AgentFollowUpQueueItemDto = {
            id: randomUUID(),
            kind: "steer",
            message,
            createdAt: Date.now(),
        };
        const queue = this.steerQueues.get(sessionId) ?? [];
        queue.push(item);
        this.steerQueues.set(sessionId, queue);
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {
                type: "steer_queued",
                item,
            },
        });
        return item;
    }

    private enqueueFollowUp(sessionId: number, message: AgentUserMessageInput): AgentFollowUpQueueItemDto {
        const item: AgentFollowUpQueueItemDto = {
            id: randomUUID(),
            kind: "followup",
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

    private async drainSteers(input: {
        sessionId: number;
        workspaceKey: string;
        invocationId?: string;
    }): Promise<Message[]> {
        const queue = this.steerQueues.get(input.sessionId) ?? [];
        if (queue.length === 0) {
            this.steerQueues.delete(input.sessionId);
            return [];
        }
        this.steerQueues.delete(input.sessionId);
        const messages: Message[] = [];
        for (const item of queue) {
            const message = createUserMessage({
                ...item.message,
                text: this.steerText(item.message.text),
            });
            const entry = await this.repo.appendMessage(input.sessionId, message, input.workspaceKey, "harness");
            this.publishSessionEntry(input.sessionId, input.invocationId, entry);
            messages.push(message);
        }
        await this.publishSessionState(input.sessionId, input.invocationId);
        return messages;
    }

    private steerText(text: string): string {
        // TODO: 用户提供“测试 steer”样本后，替换为 Codex harness 的真实模型可见前缀。
        return `<user_steer>\n${text}\n</user_steer>`;
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
        this.steerableSessions.delete(sessionId);
        this.steerQueues.delete(sessionId);
        this.abortControllers.delete(sessionId);
        if (invocationId) {
            this.invocationClientStates.delete(invocationId);
            this.invocationVariableStates.delete(invocationId);
            this.rejectPendingClientPatches(invocationId);
        }
        await this.publishSessionState(sessionId, invocationId);
    }

    private async createVariableAccessor(sessionId: number, invocationId?: string): Promise<ProfileVariableAccessor> {
        const snapshot = await this.repo.readSession(sessionId);
        const profile = await this.profiles.get(this.repo.reduce(snapshot).profileKey);
        return this.createProfileVariableAccessor(snapshot, profile, {
            clientState: invocationId ? this.invocationClientStates.get(invocationId) : undefined,
            invocationId,
            onSessionEntry: (entry) => this.publishSessionEntry(sessionId, invocationId, entry),
        });
    }

    private async createProfileVariableAccessor(snapshot: SessionSnapshot, profile: AgentProfile, options: {
        clientState?: ClientStateSnapshot;
        dryRun?: boolean;
        invocationId?: string;
        onSessionEntry?: (entry: SessionEntry) => void | Promise<void>;
    } = {}): Promise<ProfileVariableAccessor> {
        const clientSnapshot = options.clientState;
        const registry = clientSnapshot
            ? await createVariableRegistryForSession({
                profile,
                workspaceRoot: snapshot.metadata.workspaceRoot,
                currentProjectWorkspace: typeof clientSnapshot.studio?.workspace === "string" ? clientSnapshot.studio.workspace : null,
            })
            : createVariableRegistryForProfile(profile);
        return createProfileVariableAccessor({
            repo: this.repo,
            snapshot,
            registry,
            clientState: options.clientState,
            dryRun: options.dryRun,
            invocationId: options.invocationId,
            variableState: options.invocationId ? this.invocationVariableStates.get(options.invocationId) : undefined,
            onSessionEntry: options.onSessionEntry,
            onClientPatch: options.invocationId
                ? (request) => this.requestClientVariablePatch(snapshot.metadata.sessionId, request)
                : undefined,
        });
    }

    private requestClientVariablePatch(sessionId: number, request: VariablePatchRequest): Promise<VariablePatchAck> {
        if (!request.invocationId || !request.toolCallId) {
            return Promise.reject(new Error("client.* patch 需要 invocationId 和 toolCallId。"));
        }
        const key = clientPatchKey(request.invocationId, request.toolCallId, request.path);
        if (this.pendingClientPatches.has(key)) {
            return Promise.reject(new Error(`client.* patch 已在等待 ack：${request.path}`));
        }
        const promise = new Promise<VariablePatchAck>((resolvePatch, rejectPatch) => {
            const timeout = setTimeout(() => {
                this.pendingClientPatches.delete(key);
                rejectPatch(new Error(`client.* patch 等待前端 ack 超时：${request.path}`));
            }, 10_000);
            this.pendingClientPatches.set(key, {
                request,
                resolve: resolvePatch,
                reject: rejectPatch,
                timeout,
            });
        });
        this.eventHub.publish({
            sessionId,
            invocationId: request.invocationId,
            kind: "session",
            event: {
                type: "client_variable_patch_requested",
                request,
            },
        });
        return promise;
    }

    private rejectPendingClientPatches(invocationId: string): void {
        for (const [key, pending] of [...this.pendingClientPatches.entries()]) {
            if (pending.request.invocationId !== invocationId) {
                continue;
            }
            clearTimeout(pending.timeout);
            this.pendingClientPatches.delete(key);
            pending.reject(new Error("invocation 已结束，client.* patch 未完成。"));
        }
    }

    private providerOptions(config: Pick<EffectiveConfig, "models">, model: Model<any>): {timeoutMs: number | null; requestOptions: Record<string, JsonValue>} {
        const providerConfigId = typeof (model as {providerConfigId?: unknown}).providerConfigId === "string"
            ? (model as unknown as {providerConfigId: string}).providerConfigId
            : model.provider;
        const options = config.models.providers[providerConfigId]?.options ?? config.models.providers[model.provider]?.options;
        return {
            timeoutMs: options?.timeoutMs ?? null,
            requestOptions: options?.requestOptions ?? {},
        };
    }

    /**
     * 合并 session 显式 thinking 设置与 profile 默认 reasoningEffort。
     */
    private resolveThinkingLevel(
        context: ReturnType<JsonlSessionRepository["reduce"]>,
        config: Pick<EffectiveConfig, "agent">,
        model: Model<any>,
    ): ThinkingLevel {
        if (!model.reasoning) {
            return "off";
        }
        if (context.thinkingLevel !== null) {
            return context.thinkingLevel;
        }
        return config.agent.profiles[context.profileKey]?.model.reasoningEffort ?? config.agent.profileModelDefaults.reasoningEffort ?? "off";
    }

    private piStreamOptions(requestOptions: Record<string, JsonValue> | undefined): Record<string, unknown> {
        if (!requestOptions) {
            return {};
        }
        const allowedKeys = new Set(["headers", "maxRetries", "maxRetryDelayMs", "metadata", "transport", "cacheRetention"]);
        return Object.fromEntries(
            Object.entries(requestOptions).filter(([key]) => allowedKeys.has(key)),
        );
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

    private isLeaderProfile(profileKey: string): boolean {
        return profileKey === "leader.default" || profileKey === "leader.assets" || profileKey.startsWith("leader.");
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
            const config = await loadEffectiveConfig(context);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            const providerOptions = this.providerOptions(config, model);
            const thinkingLevel = this.resolveThinkingLevel(context, config, model);
            const profile = await this.profiles.get(context.profileKey);
            const compaction = await this.prepareCompactionPolicy(profile, snapshot, context);
            await appendCompaction({
                repo: this.repo,
                snapshot,
                messages: context.messages,
                model,
                apiKey: resolvePiApiKeyForModelFromConfig(config, model),
                timeoutMs: providerOptions.timeoutMs,
                requestOptions: providerOptions.requestOptions,
                thinkingLevel,
                instructions,
                compaction,
            });
            const entry = await this.repo.appendEntry(sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: "end",
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, invocationId, entry);
        } catch (error) {
            const snapshot = await this.repo.readSession(sessionId);
            const errorInfo = this.toInvocationErrorInfo(error, "compaction");
            const entry = await this.repo.appendEntry(sessionId, {
                type: "invocation_lifecycle",
                invocationId,
                status: "error",
                error: errorInfo.message,
                errorInfo,
            }, snapshot.metadata.workspaceKey);
            this.publishSessionEntry(sessionId, invocationId, entry);
        } finally {
            await this.finishInvocation(sessionId, invocationId);
        }
    }

    private toInvocationErrorInfo(error: unknown, phase: InvocationErrorPhase): InvocationErrorInfo {
        return {
            message: error instanceof Error ? error.message : String(error),
            phase,
        };
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
            timeoutMs?: number | null;
            requestOptions?: Record<string, JsonValue>;
            toolKeys: string[];
            profileKey: string;
            thinkingLevel: ThinkingLevel;
        },
    ): Promise<InvokeAgentResult> {
        const reminder = createUserMessage({
            text: "你必须使用 report_result 工具返回最终结果。请不要只回复普通文本。",
        });
        const reminderEntry = await this.repo.appendMessage(input.sessionId, reminder, runInput?.workspaceKey, "harness");
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
                timeoutMs: runInput.timeoutMs,
                requestOptions: runInput.requestOptions,
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

    /**
     * 普通 ReAct turn 的持久化边界在 turn_end：assistant 和 toolResult 成组落盘。
     * approval 工具是合法 suspend point，允许只落 assistant toolCall 等待用户 resolution。
     */
    private async commitTurn(input: {
        sessionId: number;
        workspaceKey: string;
        invocationId?: string;
        assistant: AssistantMessage;
        toolResults: ToolResultMessage[];
        waiting?: RunToolBatchResult["waiting"];
    }): Promise<void> {
        const orderedToolResults = this.orderToolResults(input.assistant, input.toolResults);
        this.assertTurnClosed(input.assistant, orderedToolResults, input.waiting);
        const entries = await this.repo.appendEntries(input.sessionId, [
            {
                type: "message",
                message: input.assistant,
                origin: "harness",
            },
            ...orderedToolResults.map((toolResult) => ({
                type: "message" as const,
                message: toolResult,
                origin: "harness" as const,
            })),
        ], input.workspaceKey);
        for (const entry of entries) {
            this.publishSessionEntry(input.sessionId, input.invocationId, entry);
        }
    }

    private orderToolResults(assistant: AssistantMessage, toolResults: ToolResultMessage[]): ToolResultMessage[] {
        const order = new Map(assistant.content
            .filter((block): block is AgentToolCall => block.type === "toolCall")
            .map((toolCall, index) => [toolCall.id, index]));
        return [...toolResults].sort((left, right) => (order.get(left.toolCallId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.toolCallId) ?? Number.MAX_SAFE_INTEGER));
    }

    private assertTurnClosed(assistant: AssistantMessage, toolResults: ToolResultMessage[], waiting?: RunToolBatchResult["waiting"]): void {
        const completedToolCallIds = new Set(toolResults.map((toolResult) => toolResult.toolCallId));
        const toolCalls = assistant.content.filter((block): block is AgentToolCall => block.type === "toolCall");
        const missing = toolCalls.filter((toolCall) => !completedToolCallIds.has(toolCall.id));
        if (missing.length === 0) {
            return;
        }
        if (waiting && missing.length === 1 && missing[0]?.id === waiting.toolCallId && missing[0].name === waiting.toolName && this.tools.approvalToolKeys().includes(missing[0].name)) {
            return;
        }
        throw new Error(`turn 存在未闭合 tool call，拒绝写入 session：${missing.map((toolCall) => toolCall.name).join(", ")}`);
    }

    private assertNoUnclosedToolCallsForModel(messages: AgentMessage[]): void {
        const completedToolCallIds = new Set(messages
            .filter((message) => message.role === "toolResult")
            .map((message) => message.toolCallId));
        const pendingToolCalls = messages
            .filter((message) => message.role === "assistant")
            .flatMap((message) => message.content.filter((block): block is AgentToolCall => block.type === "toolCall"))
            .filter((toolCall) => !completedToolCallIds.has(toolCall.id));
        if (pendingToolCalls.length === 0) {
            return;
        }
        const approvalToolKeys = new Set(this.tools.approvalToolKeys());
        const ordinaryToolCalls = pendingToolCalls.filter((toolCall) => !approvalToolKeys.has(toolCall.name));
        if (ordinaryToolCalls.length > 0) {
            throw new Error(`当前 session 存在未闭合普通 tool call，不能继续发送给模型：${ordinaryToolCalls.map((toolCall) => toolCall.name).join(", ")}。请切换到干净分支或运行显式 session repair。`);
        }
        throw new Error("当前 session 正在等待用户审批或回答，请先完成 pending approval resolution。");
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

function estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hashJsonValue(value: JsonValue): string {
    return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function stableJsonStringify(value: JsonValue): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key] ?? null)}`).join(",")}}`;
}

async function loadEffectiveConfig(input: {workspaceRoot?: string; projectPath?: string}): Promise<EffectiveConfig> {
    const {
        loadEffectiveConfig: loadEffectiveConfigByQuery,
        loadEffectiveConfigForWorkspaceRoot,
    } = await import("nbook/server/config/config-service");
    if (input.projectPath) {
        return loadEffectiveConfigByQuery({workspaceKind: "novel", projectPath: input.projectPath});
    }
    return loadEffectiveConfigForWorkspaceRoot(input.workspaceRoot);
}

/**
 * Agent 工具的工作目录始终是 Workspace Root；Project Workspace 只通过 projectPath 表达。
 */
function normalizeAgentWorkspaceRoot(workspaceRoot: string | undefined, projectPath?: string): string {
    const normalized = workspaceRoot?.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    const normalizedProjectPath = projectPath?.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    if (!normalized) {
        return WORKSPACE_CONTAINER_ROOT;
    }
    if (normalized === USER_ASSETS_WORKSPACE_ROOT) {
        return USER_ASSETS_WORKSPACE_ROOT;
    }
    if (normalized === WORKSPACE_CONTAINER_ROOT) {
        return WORKSPACE_CONTAINER_ROOT;
    }
    if (normalizedProjectPath && normalized === normalizedProjectPath) {
        return WORKSPACE_CONTAINER_ROOT;
    }
    return normalized;
}

function clientPatchKey(invocationId: string | undefined, toolCallId: string | undefined, path: string): string {
    return `${invocationId ?? ""}\n${toolCallId ?? ""}\n${path}`;
}
