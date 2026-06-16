import {createHash, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import type {AgentEvent, AgentToolResult} from "@earendil-works/pi-agent-core";
import {estimateContextTokens} from "@earendil-works/pi-agent-core";
import {streamSimple, validateToolArguments} from "@earendil-works/pi-ai";
import {Value} from "typebox/value";
import type {AgentMessage, AgentToolCall, AgentUserMessageInput, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createTextToolResult, createToolResultFromResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {summarizerProfile} from "nbook/server/agent/profiles/summarizer-profile";
import type {AgentProfile, ProfileCompactionPlan, ProfileTurnPlan, SidecarContext, SidecarMergePlan, SidecarProfilePass, SidecarProfilePassStage, SidecarResult} from "nbook/server/agent/profiles/types";
import {compileProfileSystemPrompt, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {buildAgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {SessionWriteExecutor} from "nbook/server/agent/session/write-plan";
import type {AppendManySessionEntryDraft, SessionWritePlan} from "nbook/server/agent/session/write-plan";
import {ToolSessionWriteSink} from "nbook/server/agent/session/tool-session-write-sink";
import {AGENT_FOLLOW_UP_QUEUE_STATE_KEY, AGENT_PLAN_MODE_STATE_KEY, SESSION_SUMMARIZER_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {InvocationErrorInfo, InvocationErrorPhase, ModelChangeEntry, NeuroSessionContext, SessionEntry, SessionEntryDraft, SessionEntryId, SessionSnapshot} from "nbook/server/agent/session/types";
import type {AgentRuntimeHook, AgentRuntimeHookResult, RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";
import {findPendingApprovalCall, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import {createBuiltinTools, createReportResultTool, createReportSidecarResultTool} from "nbook/server/agent";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {isAgentToolDefinition} from "nbook/server/agent/tools/types";
import type {AgentResolution, NeuroAgentTool, ProfileToolBinding, ReportResultToolBinding, ToolExecutionContext, ToolExecutionMode} from "nbook/server/agent/tools/types";
import {projectRuntimeEvent} from "nbook/server/agent/events/public-event-projection";
import {appendCompaction, compactIfNeeded} from "nbook/server/agent/harness/compaction";
import type {
    ActiveSidecarRun,
    PendingSessionWritePlan,
    RunFrame,
    RunLoopResult,
    RunRuntimeState,
    RunToolBatchResult,
    RunTurnTransactionResult,
    RuntimeHookExecutionInput,
    RuntimeHookExecutionResult,
    RuntimeTurn,
    TurnContinuationDecision,
    TurnIngestResult,
    TurnOutcome,
    TurnSnapshot,
} from "nbook/server/agent/harness/run-kernel-types";
import {resolveTurnContinuation} from "nbook/server/agent/harness/turn-continuation";
import {createFailedTurnIngestDraft, createRuntimeErrorAssistant, sanitizePartialAssistant} from "nbook/server/agent/harness/turn-failure";
import {applyFailedTurnTransaction, applySuccessfulTurnTransaction} from "nbook/server/agent/harness/turn-transaction";
import {applyNextTurnPreparation} from "nbook/server/agent/harness/prepare-next-turn";
import {assertValidProfileStateWrite, compilePrepareRunWritePlan} from "nbook/server/agent/harness/prepare-run";
import {toRunKernelErrorInfo, withRunKernelPhase} from "nbook/server/agent/harness/run-kernel-error";
import {consumeNextTurnModelMessages, createRunFrame} from "nbook/server/agent/harness/run-frame-state";
import {isEmptyObjectSchema, reportResultSchemaForProfile, reportSidecarResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
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
    AgentInvokeCaller,
    InvokeAgentInput,
    InvokeAgentResult,
    SessionQueryResult,
    SessionQueryInput,
    SessionRecentMessageRole,
} from "nbook/server/agent/harness/types";
import type {
    AgentAbortRequestDto,
    AgentActiveInvocationDto,
    AgentCommandRequestDto,
    AgentFollowUpQueueStateDto,
    AgentFollowUpQueueItemDto,
    AgentLinkedSessionDto,
    AgentPendingApprovalDto,
    AgentRuntimeStreamEventDto,
    AgentSessionContextUsageDto,
    AgentSessionEventDto,
    AgentSessionEventsQueryDto,
    AgentSessionListQueryDto,
    AgentSessionLiveStateDto,
    AgentSessionProfileAvailability,
    AgentSessionRelationsDto,
    AgentSessionSummarizerStateDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";
import {AgentSessionEventHub} from "nbook/server/agent/events/session-event-hub";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {normalizeClientState} from "nbook/server/agent/variables/accessor";
import {createVariableRegistryForProfile, createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";
import type {ClientStateSnapshot, ProfileVariableAccessor, VariableInvocationState, VariableJsonPatchOperation, VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";

type HarnessOptions = {
    repo?: JsonlSessionRepository;
    profiles?: AgentProfileCatalog;
    skills?: SkillCatalog;
    tools?: AgentToolRegistry;
    modelResolver?: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    eventHub?: AgentSessionEventHub;
    /** 调试和测试时可强制 turn 内工具全串行；默认按 tool.executionMode 调度。 */
    toolExecution?: ToolExecutionMode;
    /** 测试可关闭后台 summarizer，避免 fire-and-forget 消耗 faux provider 响应；生产默认开启。 */
    enableSessionSummarizer?: boolean;
};

const REPORT_RESULT_ERROR_LIMIT = 3;

type SessionSummarizerState = {
    sessionId?: number;
    profileKey?: string;
    summarizerInputFingerprint?: string;
    running?: boolean;
    dirty?: boolean;
    sourceLeafId?: SessionEntryId | null;
    sourcePromptUserTurnCount?: number;
    lastDialogueContentFingerprint?: string;
    lastDialogueContentTokens?: number;
    runningDialogueContentFingerprint?: string;
    runningDialogueContentTokens?: number;
    runningSourcePromptUserTurnCount?: number;
    lastRunAt?: number;
    lastError?: string;
};

type SessionSummarizerJob = {
    promise: Promise<void>;
    rerunRequested: boolean;
};

type PendingApprovalLookup = ReturnType<typeof findPendingApprovalCall>;

type PreparedRunProfile = {
    plan: ProfileTurnPlan;
    writePlan?: SessionWritePlan;
};

type PreparedRun = {
    snapshot: SessionSnapshot;
    context: NeuroSessionContext;
    profile: AgentProfile;
    prepared: ProfileTurnPlan;
    systemPrompt: string;
    messages: AgentMessage[];
    model: Model<any>;
    apiKey?: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
    compaction?: ProfileCompactionPlan;
    sessionContextEnabled: boolean;
    toolKeys: string[];
    executionToolKeys?: string[];
    thinkingLevel: ThinkingLevel;
    reportResultReminderEnabled: boolean;
};

type SidecarRunContext = {
    sessionId: number;
    invocationId: string;
    snapshot: SessionSnapshot;
    context: NeuroSessionContext;
    profile: AgentProfile;
    systemPrompt: string;
    messages: AgentMessage[];
    model: Model<any>;
    apiKey?: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
    compaction?: ProfileCompactionPlan;
    sessionContextEnabled: boolean;
    toolKeys: string[];
    thinkingLevel: ThinkingLevel;
    runtimeState: RunRuntimeState;
    caller: AgentInvokeCaller;
    abortSignal?: AbortSignal;
    runResult?: RunLoopResult;
    finalResult?: InvokeAgentResult;
};

type AppliedSidecarMerge = {
    persistedMessagesWritten: boolean;
    runtimeMessagesInjected: boolean;
};

type InvocationAdmission = {
    snapshot: SessionSnapshot | null;
    pendingUserMessage: Message | null;
    pendingResolution: AgentResolution | null;
    currentInvocation: AgentActiveInvocationDto | null;
    invocationId: string;
    abortController: AbortController;
    runtimeState: RunRuntimeState;
    isResume: boolean;
} | {
    queued: InvokeAgentResult;
};

type SessionRuntimeProjection = {
    snapshot: SessionSnapshot;
    context: NeuroSessionContext;
    profile: AgentProfile | null;
    profileAvailability: AgentSessionProfileAvailability;
    profileIssueMessage?: string;
    baseSummary: AgentSessionSummaryDto;
    summary: AgentSessionSummaryDto;
    pendingApproval: PendingApprovalLookup;
    activeInvocation: AgentActiveInvocationDto | null;
};

type TranscriptReplayAnchor = {
    invocationId?: string;
    turnIndex: number;
    after: number;
    firstSeq: number;
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
    private readonly writeExecutor: SessionWriteExecutor;
    private readonly modelResolver: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    private readonly toolExecution: ToolExecutionMode;
    private readonly enableSessionSummarizer: boolean;
    private readonly activeInvocations = new Map<number, AgentActiveInvocationDto>();
    private readonly steerableSessions = new Set<number>();
    private readonly steerQueues = new Map<number, AgentFollowUpQueueItemDto[]>();
    private readonly followUpQueues = new Map<number, AgentFollowUpQueueStateDto>();
    private readonly abortControllers = new Map<number, AbortController>();
    private readonly invocationClientStates = new Map<string, ClientStateSnapshot | undefined>();
    private readonly invocationVariableStates = new Map<string, VariableInvocationState>();
    private readonly invocationRuntimeStates = new Map<string, RunRuntimeState>();
    private readonly admissionQueues = new Map<number, Promise<void>>();
    private readonly summarizerRuns = new Map<number, SessionSummarizerJob>();
    private readonly transcriptReplayAnchors = new Map<number, TranscriptReplayAnchor>();
    private readonly pendingClientPatches = new Map<string, {
        request: VariablePatchRequest;
        resolve: (ack: VariablePatchAck) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();

    constructor(options: HarnessOptions = {}) {
        this.repo = options.repo ?? new JsonlSessionRepository();
        this.profiles = options.profiles ?? new AgentProfileCatalog();
        this.skills = options.skills ?? new SkillCatalog();
        this.tools = options.tools ?? new AgentToolRegistry();
        this.eventHub = options.eventHub ?? new AgentSessionEventHub();
        this.writeExecutor = new SessionWriteExecutor({
            repo: this.repo,
            eventHub: this.eventHub,
            liveStateProvider: (sessionId) => this.getSessionLiveState(sessionId),
        });
        this.modelResolver = options.modelResolver ?? resolvePiModelFromConfig;
        this.toolExecution = options.toolExecution ?? "parallel";
        this.enableSessionSummarizer = options.enableSessionSummarizer ?? true;
        this.profiles.register(defaultAgentProfile);
        this.profiles.register(summarizerProfile);
        for (const tool of createBuiltinTools()) {
            this.tools.register(tool);
        }
    }

    /**
     * 等待 harness 内部后台任务安静下来。测试和服务关闭时使用，普通 invocation 不等待它。
     */
    async drainBackgroundTasks(): Promise<void> {
        while (this.summarizerRuns.size > 0) {
            await Promise.all([...this.summarizerRuns.values()].map((job) => job.promise));
        }
    }

    /**
     * 创建空 agent session。HistorySet 首次 invoke 时再注入。
     */
    async createAgent(input: CreateAgentInput): Promise<CreateAgentResult> {
        const profile = await this.profiles.get(input.profileKey);
        const parsedInput = this.profiles.parseInput(profile, (input.input ?? {}) as JsonValue);
        const title = this.normalizeCreateTitle(input.title) ?? profile.manifest.name;
        const parentSnapshot = input.parentSessionId
            ? await this.repo.readSession(input.parentSessionId)
            : null;
        const projectPath = input.projectPath ?? parentSnapshot?.metadata.projectPath;
        const snapshot = await this.repo.createSession({
            profileKey: input.profileKey,
            input: parsedInput,
            workspaceRoot: normalizeAgentWorkspaceRoot(input.workspaceRoot ?? parentSnapshot?.metadata.workspaceRoot, projectPath),
            workspaceKey: input.workspaceKey ?? parentSnapshot?.metadata.workspaceKey ?? "global",
            projectPath,
            parentSessionId: input.parentSessionId,
            title,
        });
        if (input.parentSessionId) {
            await new ToolSessionWriteSink({
                executor: this.writeExecutor,
                sessionId: input.parentSessionId,
            }).append("agent.link", {
                type: "custom",
                key: `agent.link.${snapshot.metadata.sessionId}`,
                value: {
                    sessionId: snapshot.metadata.sessionId,
                    profileKey: input.profileKey,
                },
            });
            this.publishLinkedAgentSnapshotRequired(snapshot.metadata.sessionId);
        }
        await this.publishSessionState(snapshot.metadata.sessionId);
        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: input.profileKey,
            title,
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
        return new ToolSessionWriteSink({
            executor: this.writeExecutor,
            sessionId,
            invocationId,
        }).customState("tool.custom_state", key, value);
    }

    /**
     * 调用 agent。prompt 会写入用户消息；continue 只从当前 session 尾部继续。
     */
    async invokeAgent(input: InvokeAgentInput): Promise<InvokeAgentResult> {
        if (input.block === false) {
            throw new Error("block:false 第一版尚未实现");
        }
        if (!input.resolution) {
            const preflightSnapshot = await this.repo.readSession(input.sessionId);
            const preflightProfile = await this.resolveProfileRuntime(preflightSnapshot.metadata.profileKey);
            if (!preflightProfile.profile) {
                return this.profileUnavailableInvokeResult(input.sessionId, preflightSnapshot.metadata.profileKey);
            }
        }
        const invokeTitle = this.normalizeInvokeTitle(input.title);
        const caller = this.normalizeInvokeCaller(input.caller);
        const admission = await this.withSessionAdmission(input.sessionId, () => this.admitInvocation(input));
        if ("queued" in admission) {
            if (invokeTitle) {
                await this.writeInvokeTitle(input.sessionId, invokeTitle, admission.queued.invocationId);
            }
            return admission.queued;
        }
        let snapshot = admission.snapshot;
        const pendingUserMessage = admission.pendingUserMessage;
        const pendingResolution = admission.pendingResolution;
        const invocationId = admission.invocationId;
        const abortController = admission.abortController;
        const runtimeState = admission.runtimeState;
        let errorPhase: InvocationErrorPhase = "pre_loop";
        try {
            if (input.resolution) {
                snapshot = snapshot ?? await this.repo.readSession(input.sessionId);
                const profileRuntime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
                if (!profileRuntime.profile) {
                    this.finishInvocationState(input.sessionId, invocationId);
                    return this.profileUnavailableInvokeResult(input.sessionId, snapshot.metadata.profileKey, invocationId);
                }
            }
            if (invokeTitle) {
                await this.writeInvokeTitle(input.sessionId, invokeTitle, invocationId);
            }
            snapshot = snapshot ?? await this.repo.readSession(input.sessionId);
            const preparedRun = await this.prepareRun({
                sessionId: input.sessionId,
                invocationId,
                snapshot,
                pendingResolution,
                pendingUserMessage,
                clientState: input.clientState,
                runtimeState,
                caller,
            });
            const runtimeOnlySidecarMessages: AgentMessage[] = [];
            await this.runSidecarPasses({
                stage: "prepareRun",
                sidecarRun: {
                    sessionId: input.sessionId,
                    invocationId,
                    snapshot: preparedRun.snapshot,
                    context: preparedRun.context,
                    profile: preparedRun.profile,
                    systemPrompt: preparedRun.systemPrompt,
                    messages: preparedRun.messages,
                    model: preparedRun.model,
                    apiKey: preparedRun.apiKey,
                    timeoutMs: preparedRun.timeoutMs,
                    requestOptions: preparedRun.requestOptions,
                    compaction: preparedRun.compaction,
                    sessionContextEnabled: preparedRun.sessionContextEnabled,
                    toolKeys: preparedRun.toolKeys,
                    thinkingLevel: preparedRun.thinkingLevel,
                    runtimeState,
                    caller,
                    abortSignal: abortController.signal,
                },
                applyRuntimeMessages(messages) {
                    runtimeOnlySidecarMessages.push(...messages);
                    preparedRun.messages.push(...messages);
                },
                applyPersistedContext(update) {
                    preparedRun.snapshot = update.snapshot;
                    preparedRun.context = update.context;
                    preparedRun.messages = [
                        ...update.context.messages,
                        ...runtimeOnlySidecarMessages,
                    ];
                },
            });
            errorPhase = "model";

            const result = await this.runLoop({
                sessionId: input.sessionId,
                workspaceKey: preparedRun.snapshot.metadata.workspaceKey,
                workspaceRoot: preparedRun.context.workspaceRoot,
                projectPath: preparedRun.context.projectPath,
                systemPrompt: preparedRun.systemPrompt,
                messages: preparedRun.messages,
                model: preparedRun.model,
                apiKey: preparedRun.apiKey,
                timeoutMs: preparedRun.timeoutMs,
                requestOptions: preparedRun.requestOptions,
                compaction: preparedRun.compaction,
                sessionContextEnabled: preparedRun.sessionContextEnabled,
                toolKeys: preparedRun.toolKeys,
                executionToolKeys: preparedRun.executionToolKeys,
                profileKey: preparedRun.context.profileKey,
                profile: preparedRun.profile,
                thinkingLevel: preparedRun.thinkingLevel,
                runtimeState,
                reportResultReminderEnabled: preparedRun.reportResultReminderEnabled,
                caller,
                abortSignal: abortController.signal,
                invocationId,
                onEvent: input.onEvent,
            });
            errorPhase = "ingest";
            const finalResult = await this.finalizeInvokeResult({
                input,
                invocationId,
                snapshot: preparedRun.snapshot,
                context: preparedRun.context,
                prepared: preparedRun.prepared,
                toolKeys: preparedRun.toolKeys,
                result,
            });
            errorPhase = "settleRun";
            await this.completeInvocation({
                sessionId: input.sessionId,
                invocationId,
                profile: preparedRun.profile,
                sessionContextEnabled: preparedRun.sessionContextEnabled,
                runtimeState,
                runResult: result,
                finalResult,
                caller,
            });
            return finalResult;
        } catch (error) {
            return this.failInvocation({
                sessionId: input.sessionId,
                invocationId,
                error,
                errorPhase,
                aborted: abortController.signal.aborted,
            });
        }
    }

    private normalizeInvokeCaller(caller: InvokeAgentInput["caller"]): AgentInvokeCaller {
        return caller ?? {kind: "user"};
    }

    /**
     * 规范化创建 session 时显式传入的展示标题。
     */
    private normalizeCreateTitle(title: CreateAgentInput["title"]): string | undefined {
        return this.normalizeSessionTitle(title, "create_agent.title");
    }

    /**
     * 规范化调用方显式传入的 session 展示标题。
     */
    private normalizeInvokeTitle(title: InvokeAgentInput["title"]): string | undefined {
        return this.normalizeSessionTitle(title, "invoke_agent.title");
    }

    /**
     * 统一处理工具传入的可选 session 标题。
     */
    private normalizeSessionTitle(title: string | undefined, fieldName: string): string | undefined {
        if (title === undefined) {
            return undefined;
        }
        const trimmed = title.trim();
        if (!trimmed) {
            throw new Error(`${fieldName} 不能为空。`);
        }
        return trimmed;
    }

    /**
     * 写入 invoke_agent 指定的 session 展示标题，不移动 active path。
     */
    private async writeInvokeTitle(sessionId: number, title: string, invocationId: string): Promise<void> {
        await this.executeWritePlan({
            target: {sessionId},
            cause: "invoke_agent.title",
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "session_update",
                    updates: {title},
                },
            }],
        }, invocationId);
    }

    private async admitInvocation(input: InvokeAgentInput): Promise<InvocationAdmission> {
        let snapshot: SessionSnapshot | null = null;
        let pendingUserMessage: Message | null = null;
        let pendingResolution: AgentResolution | null = null;
        let currentInvocation = this.activeInvocations.get(input.sessionId) ?? null;
        if (!currentInvocation && input.mode === "continue" && input.resolution) {
            snapshot = await this.repo.readSession(input.sessionId);
            const context = this.repo.reduce(snapshot);
            const pendingMessages = context.messages.filter((message): message is Message => {
                return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
            });
            const pendingApproval = findPendingApprovalCall(pendingMessages, await this.approvalToolKeysForSnapshot(snapshot));
            const baseSummary = this.repo.summary(snapshot);
            currentInvocation = this.resolveActiveInvocation(input.sessionId, baseSummary.status, pendingApproval, snapshot);
            if (!pendingApproval) {
                throw new Error("当前 session 没有等待中的审批 tool call");
            }
            if (currentInvocation?.status !== "waiting") {
                throw new Error("waiting_invocation_not_recoverable");
            }
        }
        if (input.resolution && currentInvocation && currentInvocation.status !== "waiting") {
            if (currentInvocation.status === "aborting") {
                throw new Error("active_invocation_aborting");
            }
            throw new Error("waiting_invocation_not_recoverable");
        }
        const invocationId = input.resolution && currentInvocation?.status === "waiting"
            ? currentInvocation.invocationId
            : randomUUID();
        if ((input.mode === "steer" || input.mode === "followup") && !input.message) {
            throw new Error(`${input.mode} 模式必须提供 message`);
        }
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
                    queued: {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "waiting",
                        finalMessage: `steer queued: ${item.id}`,
                        queuedItem: item,
                    },
                };
            }
            if ((input.mode === "prompt" || input.mode === "followup") && input.message) {
                const item = await this.enqueueFollowUp(input.sessionId, input.message);
                return {
                    queued: {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "waiting",
                        finalMessage: `follow up queued: ${item.id}`,
                        queuedItem: item,
                    },
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
        if (input.mode === "prompt") {
            if (!input.message) {
                throw new Error("prompt 模式必须提供 message");
            }
            pendingUserMessage = createUserMessage(input.message);
        }
        if (input.mode === "continue" && input.resolution) {
            pendingResolution = input.resolution;
        }
        const activeInvocation: AgentActiveInvocationDto = currentInvocation?.status === "waiting" && input.resolution
            ? {
                ...currentInvocation,
                status: "running",
            }
            : {
                invocationId,
                sessionId: input.sessionId,
                status: "running",
                mode: input.mode,
                startedAt: Date.now(),
            };
        const abortController = this.abortControllers.get(input.sessionId) ?? new AbortController();
        this.activeInvocations.set(input.sessionId, activeInvocation);
        this.steerableSessions.add(input.sessionId);
        this.abortControllers.set(input.sessionId, abortController);
        this.invocationClientStates.set(invocationId, input.clientState);
        this.invocationVariableStates.set(invocationId, {
            readFingerprints: new Map(),
            clientOverlay: normalizeClientState(input.clientState),
        });
        const runtimeState = this.invocationRuntimeStates.get(invocationId) ?? new Map<string, JsonValue>();
        this.invocationRuntimeStates.set(invocationId, runtimeState);
        const isResume = Boolean(input.resolution && currentInvocation?.status === "waiting");
        try {
            if (!isResume) {
                await this.writeLifecycle(input.sessionId, invocationId, "start");
            }
        } catch (error) {
            this.finishInvocationState(input.sessionId, invocationId);
            throw error;
        }

        return {
            snapshot,
            pendingUserMessage,
            pendingResolution,
            currentInvocation,
            invocationId,
            abortController,
            runtimeState,
            isResume,
        };
    }

    private async finalizeInvokeResult(input: {
        input: InvokeAgentInput;
        invocationId: string;
        snapshot: SessionSnapshot;
        context: ReturnType<JsonlSessionRepository["reduce"]>;
        prepared: ProfileTurnPlan;
        toolKeys: string[];
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
    }): Promise<InvokeAgentResult> {
        const {input: invokeInput, invocationId, result} = input;
        if (result.status === "failed") {
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "error",
                error: result.errorInfo.message,
                errorPhase: result.errorInfo.phase,
                errorInfo: result.errorInfo,
                finalMessage: result.finalAssistant ? messageText(result.finalAssistant) : undefined,
                usage: result.finalAssistant?.usage,
            };
        }

        if (result.status === "waiting") {
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
            };
        }

        return {
            sessionId: invokeInput.sessionId,
            invocationId,
            status: "completed",
            finalMessage: result.finalAssistant ? messageText(result.finalAssistant) : undefined,
            reportResult: result.reportResult,
            usage: result.finalAssistant?.usage,
        };
    }

    /**
     * 处理 accepted invocation 的正常 terminal：settleRun、terminal lifecycle、queue policy 和 cleanup。
     */
    private async completeInvocation(input: {
        sessionId: number;
        invocationId: string;
        profile: AgentProfile;
        sessionContextEnabled: boolean;
        runtimeState: RunRuntimeState;
        runResult: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
        finalResult: InvokeAgentResult;
        caller: AgentInvokeCaller;
    }): Promise<void> {
        if (input.finalResult.status !== "error") {
            if (input.finalResult.status === "completed") {
                const snapshot = await this.repo.readSession(input.sessionId);
                const context = this.repo.reduce(snapshot);
                const config = await loadEffectiveConfig(context);
                const model = context.model ?? this.modelResolver(config, context.profileKey);
                const providerOptions = this.providerOptions(config, model);
                const apiKey = resolvePiApiKeyForModelFromConfig(config, model);
                const thinkingLevel = this.resolveThinkingLevel(context, config, model);
                await this.runSidecarPasses({
                    stage: "settleRun",
                    sidecarRun: {
                        sessionId: input.sessionId,
                        invocationId: input.invocationId,
                        snapshot,
                        context,
                        profile: input.profile,
                        systemPrompt: context.systemPrompt,
                        messages: context.messages,
                        model,
                        apiKey,
                        timeoutMs: providerOptions.timeoutMs,
                        requestOptions: providerOptions.requestOptions,
                        sessionContextEnabled: input.sessionContextEnabled,
                        toolKeys: [...input.profile.rootToolKeys],
                        thinkingLevel,
                        runtimeState: input.runtimeState,
                        runResult: input.runResult,
                        finalResult: input.finalResult,
                        caller: input.caller,
                    },
                });
            }
            await this.settleRun({
                sessionId: input.sessionId,
                invocationId: input.invocationId,
                profile: input.profile,
                runtimeState: input.runtimeState,
                status: input.finalResult.status,
                result: input.runResult,
                caller: input.caller,
            });
        }
        const aborted = input.runResult.status === "failed" && input.runResult.terminalStatus === "aborted";
        await this.writeLifecycle(
            input.sessionId,
            input.invocationId,
            aborted ? "aborted" : input.finalResult.status === "error" ? "error" : input.finalResult.status === "waiting" ? "waiting" : "end",
            input.finalResult.error,
            input.finalResult.errorInfo ?? (input.finalResult.error ? this.toInvocationErrorInfo(input.finalResult.error, input.finalResult.errorPhase ?? "unknown") : undefined),
        );
        if (input.finalResult.status === "error") {
            await this.pauseFollowUps(input.sessionId, input.invocationId, aborted ? "aborted" : "error");
        }
        if (input.finalResult.status !== "waiting") {
            await this.finishInvocation(input.sessionId, input.invocationId);
        }
        if (this.enableSessionSummarizer && input.finalResult.status === "completed" && input.profile.summarizer && input.profile.summarizer.enabled !== false) {
            this.scheduleSessionSummarizer(input.sessionId).catch((error) => {
                console.error("[agent] schedule summarizer failed", error);
            });
        }
        if (input.finalResult.status === "completed") {
            await this.drainFollowUps(input.sessionId);
        }
    }

    /**
     * 处理 accepted invocation 的异常 terminal：规范化错误、写 lifecycle，并释放运行态。
     */
    private async failInvocation(input: {
        sessionId: number;
        invocationId: string;
        error: unknown;
        errorPhase: InvocationErrorPhase;
        aborted: boolean;
    }): Promise<InvokeAgentResult> {
        const errorInfo = toRunKernelErrorInfo(input.error, input.aborted ? "unknown" : input.errorPhase);
        await this.writeLifecycle(input.sessionId, input.invocationId, input.aborted ? "aborted" : "error", errorInfo.message, errorInfo);
        await this.pauseFollowUps(input.sessionId, input.invocationId, input.aborted ? "aborted" : "error");
        await this.finishInvocation(input.sessionId, input.invocationId);
        return {
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            status: "error",
            error: errorInfo.message,
            errorPhase: errorInfo.phase,
            errorInfo,
        };
    }

    /**
     * prepareRun stage：恢复 resolution、执行 prepareRun hooks、运行 profile prepare，并组装首轮 RunFrame 输入。
     */
    private async prepareRun(input: {
        sessionId: number;
        invocationId: string;
        snapshot: SessionSnapshot;
        pendingResolution: AgentResolution | null;
        pendingUserMessage: Message | null;
        clientState?: ClientStateSnapshot;
        runtimeState: RunRuntimeState;
        caller: AgentInvokeCaller;
    }): Promise<PreparedRun> {
        let snapshot = input.snapshot;
        if (input.pendingResolution) {
            await this.appendResolution(snapshot, input.pendingResolution, input.invocationId);
            await this.writeLifecycle(input.sessionId, input.invocationId, "resumed");
            snapshot = await this.repo.readSession(input.sessionId);
        }
        await this.publishSessionState(input.sessionId, input.invocationId);

        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const prepareRunHooks = await this.runRuntimeHooks({
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            profile,
            runtimeState: input.runtimeState,
            stage: "prepareRun",
            snapshot,
            pendingUserMessage: input.pendingUserMessage ?? undefined,
            caller: input.caller,
        });

        snapshot = await this.repo.readSession(input.sessionId);
        const prepared = await this.prepare(snapshot, {
            invocationId: input.invocationId,
            pendingUserMessage: input.pendingUserMessage ?? undefined,
            clientState: input.clientState,
            caller: input.caller,
            sessionContextEnabled: prepareRunHooks.sessionContext === true,
        });
        if (prepared.writePlan) {
            await this.executeWritePlan(prepared.writePlan, input.invocationId);
        }

        snapshot = await this.repo.readSession(input.sessionId);
        if (input.pendingUserMessage) {
            await this.executeWritePlan({
                target: {sessionId: input.sessionId},
                cause: "prompt",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "message",
                        message: input.pendingUserMessage,
                        origin: "prompt",
                    },
                }],
            }, input.invocationId);
            snapshot = await this.repo.readSession(input.sessionId);
        }

        let context = this.repo.reduce(snapshot);
        const config = await loadEffectiveConfig(context);
        const model = context.model ?? this.modelResolver(config, context.profileKey);
        const providerOptions = this.providerOptions(config, model);
        const apiKey = resolvePiApiKeyForModelFromConfig(config, model);
        const runProfile = await this.profiles.get(context.profileKey);
        const toolKeys = [...runProfile.rootToolKeys];
        const executionToolKeys = runProfile.toolKeys ? [...runProfile.toolKeys] : undefined;
        const thinkingLevel = this.resolveThinkingLevel(context, config, model);
        const systemPrompt = prepareRunHooks.profilePrompt ? prepared.plan.systemPrompt ?? context.systemPrompt : context.systemPrompt;
        const preparedModelContextMessages = prepareRunHooks.sessionContext === true ? prepared.plan.modelContextMessages ?? [] : [];
        const messages = [
            ...context.messages,
            ...prepareRunHooks.runtimeMessages,
            ...preparedModelContextMessages,
        ];
        this.assertNoUnclosedToolCallsForModel(messages, this.approvalToolKeysForProfile(runProfile));

        snapshot = await this.repo.readSession(input.sessionId);
        context = this.repo.reduce(snapshot);
        return {
            snapshot,
            context,
            profile: runProfile,
            prepared: prepared.plan,
            systemPrompt,
            messages: [
                ...context.messages,
                ...prepareRunHooks.runtimeMessages,
                ...preparedModelContextMessages,
            ],
            model,
            apiKey,
            timeoutMs: providerOptions.timeoutMs,
            requestOptions: providerOptions.requestOptions,
            compaction: runProfile.compaction,
            sessionContextEnabled: prepareRunHooks.sessionContext === true,
            toolKeys,
            executionToolKeys,
            thinkingLevel,
            reportResultReminderEnabled: prepareRunHooks.reportResultReminder === true,
        };
    }

    /**
     * 执行正常 run 的收尾 hook。
     *
     * error / aborted 不进入这里，避免 profile hook 和 Kernel failure path 竞争写 terminal lifecycle。
     */
    private async settleRun(input: {
        sessionId: number;
        invocationId: string;
        profile: AgentProfile;
        runtimeState: RunRuntimeState;
        status: "completed" | "waiting";
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
        caller: AgentInvokeCaller;
    }): Promise<void> {
        if (input.result.status === "failed") {
            return;
        }
        const snapshot = await this.repo.readSession(input.sessionId);
        const context = this.repo.reduce(snapshot);
        await this.runRuntimeHooks({
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            profile: input.profile,
            runtimeState: input.runtimeState,
            stage: "settleRun",
            snapshot,
            context,
            caller: input.caller,
            runResult: {
                status: input.status,
                finalAssistant: input.result.finalAssistant,
                reportResult: input.result.reportResult,
                waiting: input.result.status === "waiting" ? input.result.waiting : undefined,
            },
        });
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
            const ownerContext = this.repo.reduce(await this.repo.readSession(ownerSessionId));
            const linked = ownerContext.linkedAgents.find((item) => item.sessionId === sessionId);
            await this.executeWritePlan({
                target: {sessionId: ownerSessionId},
                cause: "agent.detach",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "custom",
                        key: `agent.detach.${sessionId}`,
                        value: {
                            sessionId,
                        },
                    },
                }],
            });
            if (linked && !linked.detached) {
                this.publishLinkedAgentSnapshotRequired(sessionId);
            }
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
        const summaries: AgentSessionSummaryDto[] = [];
        for (const summary of await this.repo.listSessions(repoQuery)) {
            summaries.push((await this.resolveSessionRuntimeProjection(summary.sessionId)).summary);
        }
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
     * 返回 SSE 使用的轻量 session live state。
     *
     * 这里故意不包含 messages、entries、tree、systemPrompt、linked agents。
     */
    async getSessionLiveState(sessionId: number): Promise<AgentSessionLiveStateDto> {
        const projection = await this.resolveSessionRuntimeProjection(sessionId);
        const effectiveThinkingLevel = await this.snapshotThinkingLevel(projection.snapshot, projection.context);
        const summarizer = this.sessionSummarizerStateDto(projection.context);
        return {
            summary: projection.summary,
            ...(summarizer ? {summarizer} : {}),
            activeLeafId: projection.snapshot.leafId,
            activePathRevision: this.repo.activePathRevision(projection.snapshot),
            pendingApproval: projection.pendingApproval ? await this.pendingApprovalDto(projection.snapshot, projection.pendingApproval) : null,
            steerQueue: this.steerQueues.get(sessionId) ?? [],
            followUpQueue: this.followUpQueueState(sessionId, projection.context),
            activeInvocation: projection.activeInvocation,
            model: projection.context.model,
            thinkingLevel: projection.context.thinkingLevel,
            effectiveThinkingLevel,
            planModeActive: projection.context.planModeActive,
            usage: this.repo.usage(projection.snapshot),
            contextUsage: await this.sessionContextUsage(projection.snapshot, projection.context),
        };
    }

    /**
     * 返回完整前端 snapshot，作为 UI 恢复真相。
     */
    async getSessionSnapshot(sessionId: number): Promise<AgentSessionSnapshotDto> {
        const projection = await this.resolveSessionRuntimeProjection(sessionId);
        const {snapshot, context} = projection;
        const relations = await this.sessionRelations(projection);
        const systemPrompt = await this.snapshotSystemPrompt(snapshot, context, projection.profile);
        const effectiveThinkingLevel = await this.snapshotThinkingLevel(snapshot, context);
        const summarizer = this.sessionSummarizerStateDto(context);
        const followUpQueue = this.followUpQueueState(sessionId, context);
        const latestSeq = this.eventHub.lastSeq(sessionId);
        const eventCursor = this.snapshotEventCursor(sessionId, latestSeq);

        return {
            eventEpoch: this.eventHub.eventEpoch,
            eventCursor,
            latestSeq,
            summary: projection.summary,
            ...(summarizer ? {summarizer} : {}),
            activeLeafId: snapshot.leafId,
            activePathRevision: this.repo.activePathRevision(snapshot),
            ...systemPrompt ? {systemPrompt} : {},
            messages: context.messages,
            tree: this.repo.tree(snapshot),
            entries: this.repo.activePath(snapshot),
            linkedAgents: relations.linkedAgents,
            linkedByAgents: relations.linkedByAgents,
            pendingApproval: projection.pendingApproval ? await this.pendingApprovalDto(snapshot, projection.pendingApproval) : null,
            steerQueue: this.steerQueues.get(sessionId) ?? [],
            followUpQueue,
            activeInvocation: projection.activeInvocation,
            model: context.model,
            thinkingLevel: context.thinkingLevel,
            effectiveThinkingLevel,
            planModeActive: context.planModeActive,
            lastSeq: eventCursor.after,
            usage: this.repo.usage(snapshot),
            contextUsage: await this.sessionContextUsage(snapshot, context),
        };
    }

    private snapshotEventCursor(sessionId: number, latestSeq = this.eventHub.lastSeq(sessionId)): AgentSessionSnapshotDto["eventCursor"] {
        const anchor = this.transcriptReplayAnchors.get(sessionId);
        return {
            eventEpoch: this.eventHub.eventEpoch,
            after: anchor?.after ?? latestSeq,
        };
    }

    /**
     * 返回关联 Agent 面板使用的轻量关系投影。
     */
    async getSessionRelations(sessionId: number): Promise<AgentSessionRelationsDto> {
        return this.sessionRelations(await this.resolveSessionRuntimeProjection(sessionId));
    }

    /**
     * 把内部 summarizer custom state 投影成前端可用状态。
     */
    private sessionSummarizerStateDto(context: NeuroSessionContext): AgentSessionSummarizerStateDto | undefined {
        const state = this.readSummarizerState(context);
        if (!state.sessionId && !state.running && !state.dirty && !state.lastRunAt && !state.lastError) {
            return undefined;
        }
        return {
            running: state.running === true,
            dirty: state.dirty === true,
            lastDialogueContentTokens: state.lastDialogueContentTokens,
            lastRunAt: state.lastRunAt,
            lastError: state.lastError,
        };
    }

    private async sessionRelations(projection: SessionRuntimeProjection): Promise<AgentSessionRelationsDto> {
        const linkedAgents: AgentLinkedSessionDto[] = [];
        for (const linked of projection.context.linkedAgents) {
            const linkedSnapshot = await this.repo.readSession(linked.sessionId);
            const linkedProjection = await this.resolveSessionRuntimeProjection(linked.sessionId, linkedSnapshot);
            linkedAgents.push({
                ...linkedProjection.summary,
                detached: linked.detached,
            });
        }
        return {
            sessionId: projection.snapshot.metadata.sessionId,
            linkedAgents,
            linkedByAgents: await this.linkedByAgents(projection.snapshot.metadata.sessionId),
        };
    }

    /**
     * 查找哪些 session 仍记录了指向目标 session 的 agent link。
     * sessionId 是全局唯一的，显式 link 比 workspaceKey 更适合作为反向关系真相。
     */
    private async linkedByAgents(sessionId: number): Promise<AgentLinkedSessionDto[]> {
        const summaries = await this.repo.listSessions({includeArchived: true});
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
            const ownerProjection = await this.resolveSessionRuntimeProjection(summary.sessionId, ownerSnapshot);
            linkedByAgents.push({
                ...ownerProjection.summary,
                detached: linked.detached,
            });
        }
        return linkedByAgents.sort((left, right) => right.updatedAt - left.updatedAt);
    }

    /**
     * 解析当前 profile 的 provider system prompt，供前端只读展示。
     */
    private async snapshotSystemPrompt(snapshot: SessionSnapshot, context: NeuroSessionContext, profile: AgentProfile | null): Promise<string | undefined> {
        if (!profile) {
            return undefined;
        }
        if (!this.hasBuiltinHook(profile, "builtin.profilePrompt") || !profile.context) {
            return undefined;
        }
        const input = this.profiles.parseInput(profile, snapshot.metadata.input);
        const session = this.createRuntimeSessionFacade({
            sessionId: snapshot.metadata.sessionId,
            profileKey: profile.manifest.key,
            input,
            context,
        });
        const prepareContext = {
            session,
            input: input as never,
            vars: await this.createProfileVariableAccessor(snapshot, profile, {dryRun: true}),
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
            },
        };
        return compileProfileSystemPrompt(profile, prepareContext, await profile.context(prepareContext));
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
        const target = resolvePlanModeFile({
            workspaceRoot: snapshot.metadata.workspaceRoot,
            projectPath: snapshot.metadata.projectPath,
            planFilePath,
        });
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
            workDirectory: planModeDirectory({
                workspaceRoot: snapshot.metadata.workspaceRoot,
                projectPath: snapshot.metadata.projectPath,
            }).replace(/\\/g, "/"),
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
        if (body.command === "new" || body.command === "compact") {
            await this.assertProfileRunnable(snapshot);
        }
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
                createdSession: (await this.resolveSessionRuntimeProjection(created.sessionId)).summary,
            };
        }
        if (body.command === "fork") {
            const forked = await this.repo.forkSession(sessionId, body.entryId ?? snapshot.leafId ?? undefined);
            await this.publishSessionState(forked.metadata.sessionId);
            return {
                status: "completed",
                sessionId: forked.metadata.sessionId,
                createdSession: (await this.resolveSessionRuntimeProjection(forked.metadata.sessionId, forked)).summary,
            };
        }
        if (body.command === "retry") {
            const targetId = body.entryId ?? snapshot.leafId;
            if (targetId) {
                await this.moveLeafForPosition(sessionId, targetId, "before");
            }
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "tree") {
            await this.moveLeafForPosition(sessionId, body.targetEntryId, body.position);
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "plan") {
            const active = body.active;
            const context = this.repo.reduce(snapshot);
            const previous = context.customState[AGENT_PLAN_MODE_STATE_KEY];
            const previousRecord = previous && typeof previous === "object" && !Array.isArray(previous)
                ? previous as Record<string, JsonValue>
                : {};
            const reminderKind = active
                ? previousRecord.hasExited ? "reentry_full" : "full"
                : "exit";
            await this.executeWritePlan({
                target: {sessionId},
                cause: "command.plan",
                ops: [{
                    kind: "appendMany",
                    entries: [
                        {
                            type: "custom",
                            key: "ui.planMode.active",
                            value: active,
                        },
                        {
                            type: "custom",
                            key: AGENT_PLAN_MODE_STATE_KEY,
                            value: this.planModeState(snapshot, context, active, reminderKind, "ui_plan_toggle", {
                                hasExited: !active ? true : undefined,
                            }),
                        },
                    ],
                }],
            });
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
            await this.executeWritePlan({
                target: {sessionId},
                cause: "command.model",
                ops: [{
                    kind: "append",
                    entry,
                }],
            });
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
            await this.executeWritePlan({
                target: {sessionId},
                cause: "command.thinking",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "thinking_level_change",
                        thinkingLevel: body.thinkingLevel,
                    },
                }],
            });
            return {
                status: "completed",
                sessionId,
                snapshot: await this.getSessionSnapshot(sessionId),
            };
        }
        if (body.command === "archive") {
            await this.executeWritePlan({
                target: {sessionId},
                cause: "command.archive",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "session_archived",
                        reason: body.reason,
                    },
                }],
            });
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
            await this.executeWritePlan({
                target: {sessionId},
                cause: "tree.empty",
                ops: [{
                    kind: "moveLeaf",
                    leafId: null,
                }],
            });
            const updatedSnapshot = await this.getSessionSnapshot(sessionId);
            return {
                status: "completed",
                snapshot: updatedSnapshot,
            };
        }
        // TODO: 当前 next.invoke 失败时不会回滚 leaf；后续需要改成真正的原子 tree + invoke。
        if (body.next?.type === "invoke") {
            await this.assertProfileRunnable(snapshot);
        }
        await this.moveLeafForPosition(sessionId, body.targetEntryId, body.position);
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
        return {
            status: "completed",
            snapshot: updatedSnapshot,
        };
    }

    /**
     * 请求中断当前 invocation。底层 provider/tool 会通过 AbortSignal 尽量停止。
     */
    async abortInvocation(sessionId: number, body: AgentAbortRequestDto = {}): Promise<AgentAbortResult> {
        const admission = await this.withSessionAdmission(sessionId, async () => {
            const active = await this.claimAbortInvocation(sessionId);
            if (!active) {
                return {
                    kind: "idle" as const,
                };
            }
            if (active.status === "waiting") {
                active.status = "aborting";
                this.steerQueues.delete(sessionId);
                if (body.clearQueue ?? true) {
                    await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
                } else {
                    await this.pauseFollowUps(sessionId, active.invocationId, "aborted");
                }
                await this.appendAbortResolution(sessionId, active.invocationId, body.reason);
                await this.writeLifecycle(sessionId, active.invocationId, "aborted", body.reason ?? "invocation aborted", {
                    message: body.reason ?? "invocation aborted",
                    phase: "unknown",
                });
                this.eventHub.publish({
                    sessionId,
                    invocationId: active.invocationId,
                    kind: "session",
                    event: {
                        type: "invocation_aborted",
                        reason: body.reason,
                    },
                });
                await this.finishInvocation(sessionId, active.invocationId);
                return {
                    kind: "completed" as const,
                    result: {
                        status: "aborted" as const,
                        sessionId,
                    },
                };
            }
            active.status = "aborting";
            this.steerableSessions.delete(sessionId);
            return {
                kind: "running" as const,
                active,
            };
        });
        if (admission.kind === "idle") {
            return {
                status: "idle",
                sessionId,
            };
        }
        if (admission.kind === "completed") {
            return admission.result;
        }
        this.abortControllers.get(sessionId)?.abort(body.reason);
        if (body.clearQueue ?? true) {
            this.steerQueues.delete(sessionId);
            await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
        }
        this.eventHub.publish({
            sessionId,
            invocationId: admission.active.invocationId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: body.reason,
            },
        });
        await this.publishSessionState(sessionId, admission.active.invocationId);
        return {
            status: "aborted",
            sessionId,
        };
    }

    private async claimAbortInvocation(sessionId: number): Promise<AgentActiveInvocationDto | null> {
        let active = this.activeInvocations.get(sessionId) ?? null;
        if (active) {
            return active;
        }
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const messages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pendingApproval = findPendingApprovalCall(messages, await this.approvalToolKeysForSnapshot(snapshot));
        const baseSummary = this.repo.summary(snapshot);
        active = this.resolveActiveInvocation(sessionId, baseSummary.status, pendingApproval, snapshot);
        if (active?.status === "waiting") {
            this.activeInvocations.set(sessionId, active);
        }
        return active;
    }

    private async appendAbortResolution(sessionId: number, invocationId: string, reason?: string): Promise<void> {
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const messages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pending = findPendingApprovalCall(messages, await this.approvalToolKeysForSnapshot(snapshot));
        if (!pending) {
            return;
        }
        await this.executeWritePlan({
            target: {sessionId},
            cause: "resolution.abort",
            durability: "savePoint",
            ops: [{
                kind: "append",
                entry: {
                    type: "message",
                    message: createTextToolResult({
                        toolCallId: pending.toolCallId,
                        toolName: pending.toolName,
                        text: reason ? `Aborted: ${reason}` : "Aborted.",
                        isError: true,
                    }),
                    origin: "harness",
                },
            }],
        }, invocationId);
    }

    /**
     * 订阅 session 级事件流。
     */
    subscribeSessionEvents(sessionId: number, cursor: AgentSessionEventsQueryDto = {}): AsyncIterable<AgentSessionEventDto> & {connected: AgentSessionEventDto} {
        return Object.assign(this.eventHub.subscribe(sessionId, cursor), {
            connected: this.eventHub.connectedEvent(sessionId),
        });
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
        await new ToolSessionWriteSink({
            executor: this.writeExecutor,
            sessionId,
            invocationId: ack.invocationId,
        }).append("variable.client_ack", {
            type: "client_variable_patch_ack",
            namespace: "client",
            path: ack.path,
            operations: ack.operations,
            appliedValue: ack.appliedValue,
            error: ack.error,
            invocationId: ack.invocationId,
            toolCallId: ack.toolCallId,
        });
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
        const recentMessageRoles = query.recentMessageRoles ? new Set<SessionRecentMessageRole>(query.recentMessageRoles) : null;
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
            usage: this.repo.usage(snapshot),
            linkedAgents,
        };
        if (!query.includeRecentMessages) {
            return result;
        }
        const recentMessages = this.repo.activePath(snapshot)
            .filter((entry) => entry.type === "message")
            .filter((entry) => {
                return !recentMessageRoles || recentMessageRoles.has(entry.message.role as SessionRecentMessageRole);
            })
            .slice(-recentMessageLimit)
            .map((entry) => ({
                role: entry.message.role as SessionRecentMessageRole,
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
            .map((message) => message.role === "custom" ? "" : messageText(message as Message, { stripThinking: true }))
            .find((text) => text.trim().length > 0);
        return latest?.replace(/\s+/g, " ").trim().slice(0, 360) || undefined;
    }

    private async prepare(snapshot: SessionSnapshot, options: {
        invocationId?: string;
        pendingUserMessage?: Message;
        clientState?: ClientStateSnapshot;
        caller: AgentInvokeCaller;
        sessionContextEnabled: boolean;
    }): Promise<PreparedRunProfile> {
        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const context = this.repo.reduce(snapshot);
        const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
        const session = this.createRuntimeSessionFacade({
            sessionId: snapshot.metadata.sessionId,
            profileKey: profile.manifest.key,
            input: parsedInput,
            context,
        });
        const vars = await this.createProfileVariableAccessor(snapshot, profile, {clientState: options.clientState, invocationId: options.invocationId});
        const prepared = await profile.prepare!({
            session,
            input: parsedInput as never,
            invocation: {
                input: options.pendingUserMessage ? {message: messageText(options.pendingUserMessage)} : undefined,
                clientState: options.clientState,
                caller: options.caller,
            },
            vars,
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
                pendingUserMessage: options.pendingUserMessage,
            },
        });
        validateProfileTurnPlan(profile.manifest.key, prepared);

        const writePlan = compilePrepareRunWritePlan({
            sessionId: snapshot.metadata.sessionId,
            profileKey: profile.manifest.key,
            context,
            prepared,
            sessionContextEnabled: options.sessionContextEnabled,
        });
        return {
            plan: prepared,
            writePlan,
        };
    }

    /**
     * source invocation 完成后的后台摘要调度入口。
     *
     * 这里只负责调度和 preflight；摘要内容、runtime-only transcript 和写回由 summarizer profile 自己完成。
     */
    private async scheduleSessionSummarizer(sourceSessionId: number): Promise<void> {
        const running = this.summarizerRuns.get(sourceSessionId);
        if (running) {
            running.rerunRequested = true;
            await this.writeSummarizerState(sourceSessionId, {
                ...this.readSummarizerState(this.repo.reduce(await this.repo.readSession(sourceSessionId))),
                dirty: true,
            }, "summarizer.dirty");
            return;
        }

        const job: SessionSummarizerJob = {
            rerunRequested: false,
            promise: Promise.resolve(),
        };
        job.promise = this.runSessionSummarizerJob(sourceSessionId, job).finally(() => {
            this.summarizerRuns.delete(sourceSessionId);
        });
        this.summarizerRuns.set(sourceSessionId, job);
        await job.promise;
    }

    private async runSessionSummarizerJob(sourceSessionId: number, job: SessionSummarizerJob): Promise<void> {
        do {
            job.rerunRequested = false;
            const sourceSnapshot = await this.repo.readSession(sourceSessionId);
            if (sourceSnapshot.metadata.systemRole === "summarizer") {
                return;
            }
            const sourceProfile = await this.profiles.get(sourceSnapshot.metadata.profileKey);
            const config = sourceProfile.summarizer;
            if (!config || config.enabled === false) {
                return;
            }
            await this.runSessionSummarizer(sourceSnapshot, sourceProfile);
            const latest = await this.repo.readSession(sourceSessionId);
            const latestState = this.readSummarizerState(this.repo.reduce(latest));
            if (latestState.dirty && this.shouldAttemptDirtySummarizerRerun(latestState)) {
                job.rerunRequested = true;
            }
        } while (job.rerunRequested);
    }

    private shouldAttemptDirtySummarizerRerun(state: SessionSummarizerState): boolean {
        return state.lastError === undefined;
    }

    /**
     * 测试辅助：等待指定 source session 的 summarizer 后台任务结束。
     */
    async drainSessionSummarizer(sourceSessionId: number): Promise<void> {
        while (this.summarizerRuns.has(sourceSessionId)) {
            await this.summarizerRuns.get(sourceSessionId)?.promise;
        }
    }

    private async runSessionSummarizer(sourceSnapshot: SessionSnapshot, sourceProfile: AgentProfile): Promise<void> {
        const config = sourceProfile.summarizer;
        if (!config || config.enabled === false) {
            return;
        }
        const profileKey = config.profileKey;
        const summarizerInput = this.summarizerInput(sourceSnapshot.metadata.sessionId, config.input);
        const summarizerInputFingerprint = stableJsonHash({
            profileKey,
            input: summarizerInput,
        });
        const dialogue = buildAgentDialogueContent({
            repo: this.repo,
            snapshot: sourceSnapshot,
            summarizerProfileKey: profileKey,
            summarizerInput,
        });
        const state = this.readSummarizerState(this.repo.reduce(sourceSnapshot));
        const interval = this.summarizerInterval(config.input);
        const sourcePromptUserTurnCount = this.countPromptUserTurns(sourceSnapshot);
        if (!this.shouldRunSummarizer(state, dialogue, interval, summarizerInputFingerprint, sourcePromptUserTurnCount)) {
            if (state.running || state.dirty) {
                await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
                    ...state,
                    running: false,
                    dirty: false,
                    lastDialogueContentTokens: dialogue.tokens,
                    lastDialogueContentFingerprint: dialogue.fingerprint,
                }, "summarizer.preflight.skip");
            }
            return;
        }
        const maxTokens = this.summarizerMaxTokens(config.input);
        if (dialogue.tokens > maxTokens) {
            await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
                ...state,
                profileKey,
                summarizerInputFingerprint,
                running: false,
                dirty: false,
                sourceLeafId: sourceSnapshot.leafId,
                lastDialogueContentTokens: dialogue.tokens,
                lastError: `Agent Dialogue Content token 估算 ${dialogue.tokens} 超过 summarizer 上限 ${maxTokens}，已跳过本次摘要。`,
            }, "summarizer.preflight.tooLarge");
            return;
        }

        const summarizerSession = await this.ensureSummarizerSession({
            sourceSnapshot,
            profileKey,
            input: summarizerInput,
            state,
            summarizerInputFingerprint,
        });
        await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
            ...state,
            sessionId: summarizerSession.metadata.sessionId,
            profileKey,
            summarizerInputFingerprint,
            running: true,
            dirty: false,
            sourceLeafId: sourceSnapshot.leafId,
            runningSourcePromptUserTurnCount: sourcePromptUserTurnCount,
            runningDialogueContentTokens: dialogue.tokens,
            runningDialogueContentFingerprint: dialogue.fingerprint,
            lastError: undefined,
        }, "summarizer.preflight.start");

        const result = await this.invokeAgent({
            sessionId: summarizerSession.metadata.sessionId,
            mode: "continue",
            caller: {
                kind: "system",
                sessionId: sourceSnapshot.metadata.sessionId,
                profileKey: sourceSnapshot.metadata.profileKey,
            },
            internalQueued: true,
        });
        if (result.status === "error") {
            await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
                ...this.readSummarizerState(this.repo.reduce(await this.repo.readSession(sourceSnapshot.metadata.sessionId))),
                running: false,
                dirty: false,
                lastError: result.error ?? "summarizer 运行失败。",
            }, "summarizer.error");
        }
    }

    private async ensureSummarizerSession(input: {
        sourceSnapshot: SessionSnapshot;
        profileKey: string;
        input: JsonValue;
        state: SessionSummarizerState;
        summarizerInputFingerprint: string;
    }): Promise<SessionSnapshot> {
        if (input.state.sessionId && input.state.profileKey === input.profileKey && input.state.summarizerInputFingerprint === input.summarizerInputFingerprint) {
            try {
                const existing = await this.repo.readSession(input.state.sessionId);
                if (existing.metadata.systemRole === "summarizer" && existing.metadata.profileKey === input.profileKey) {
                    return existing;
                }
            } catch {
                // session 文件缺失时直接重建后台 summarizer session。
            }
        }
        return this.createSystemAgent({
            profileKey: input.profileKey,
            input: input.input,
            workspaceRoot: input.sourceSnapshot.metadata.workspaceRoot,
            workspaceKey: input.sourceSnapshot.metadata.workspaceKey,
            projectPath: input.sourceSnapshot.metadata.projectPath,
            systemRole: "summarizer",
        });
    }

    private summarizerInput(sourceSessionId: number, input: JsonValue | undefined): JsonValue {
        return {
            ...(isRecord(input) ? input : {}),
            sourceSessionId,
        };
    }

    private summarizerInterval(input: JsonValue | undefined): {kind: "sourceInvocation" | "dialogueContentTokens"; value: number} {
        const interval = isRecord(input) && isRecord(input.interval) ? input.interval : undefined;
        const kind = interval?.kind === "dialogueContentTokens" ? "dialogueContentTokens" : "sourceInvocation";
        const value = typeof interval?.value === "number" && Number.isFinite(interval.value) && interval.value > 0 ? interval.value : 1;
        return {kind, value};
    }

    private summarizerMaxTokens(input: JsonValue | undefined): number {
        const value = isRecord(input) && typeof input.maxDialogueContentTokens === "number" ? input.maxDialogueContentTokens : 80_000;
        return Number.isFinite(value) && value > 0 ? value : 80_000;
    }

    private shouldRunSummarizer(
        state: SessionSummarizerState,
        dialogue: ReturnType<typeof buildAgentDialogueContent>,
        interval: {kind: "sourceInvocation" | "dialogueContentTokens"; value: number},
        summarizerInputFingerprint: string,
        sourcePromptUserTurnCount: number,
    ): boolean {
        if (state.summarizerInputFingerprint !== summarizerInputFingerprint) {
            return true;
        }
        if (state.lastError) {
            return true;
        }
        if (!state.lastDialogueContentFingerprint) {
            return true;
        }
        if (state.sourcePromptUserTurnCount === undefined) {
            return true;
        }
        if (state.lastDialogueContentFingerprint === dialogue.fingerprint) {
            return false;
        }
        if (interval.kind === "dialogueContentTokens") {
            return Math.abs(dialogue.tokens - (state.lastDialogueContentTokens ?? 0)) >= interval.value;
        }
        return sourcePromptUserTurnCount - (state.sourcePromptUserTurnCount ?? 0) >= interval.value;
    }

    private async writeSummarizerState(sessionId: number, state: SessionSummarizerState, cause: string): Promise<void> {
        await this.executeWritePlan({
            target: {sessionId},
            cause,
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "custom",
                    key: SESSION_SUMMARIZER_STATE_KEY,
                    value: state,
                },
            }],
        });
    }

    private assertValidProfileStateWrite(profileKey: string, write: SessionEntryDraft): void {
        assertValidProfileStateWrite(profileKey, write);
    }

    private countPromptUserTurns(snapshot: SessionSnapshot): number {
        return this.repo.activePath(snapshot).filter((entry) => {
            return entry.type === "message" && entry.origin === "prompt" && entry.message.role === "user";
        }).length;
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
            sourceLeafId: typeof value.sourceLeafId === "string" || value.sourceLeafId === null ? value.sourceLeafId : undefined,
            sourcePromptUserTurnCount: typeof value.sourcePromptUserTurnCount === "number" ? value.sourcePromptUserTurnCount : undefined,
            lastDialogueContentFingerprint: typeof value.lastDialogueContentFingerprint === "string" ? value.lastDialogueContentFingerprint : undefined,
            lastDialogueContentTokens: typeof value.lastDialogueContentTokens === "number" ? value.lastDialogueContentTokens : undefined,
            runningDialogueContentFingerprint: typeof value.runningDialogueContentFingerprint === "string" ? value.runningDialogueContentFingerprint : undefined,
            runningDialogueContentTokens: typeof value.runningDialogueContentTokens === "number" ? value.runningDialogueContentTokens : undefined,
            runningSourcePromptUserTurnCount: typeof value.runningSourcePromptUserTurnCount === "number" ? value.runningSourcePromptUserTurnCount : undefined,
            lastRunAt: typeof value.lastRunAt === "number" ? value.lastRunAt : undefined,
            lastError: typeof value.lastError === "string" ? value.lastError : undefined,
        };
    }

    private async appendResolution(snapshot: SessionSnapshot, resolution: AgentResolution, invocationId?: string): Promise<void> {
        const context = this.repo.reduce(snapshot);
        const messages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pending = findPendingApprovalCall(messages, await this.approvalToolKeysForSnapshot(snapshot));
        if (!pending) {
            throw new Error("当前 session 没有等待中的审批 tool call");
        }
        const storedResolution = await this.withExitPlanModePreview(snapshot, pending, resolution);
        await this.executeWritePlan({
            target: {sessionId: snapshot.metadata.sessionId},
            cause: "resolution",
            durability: "savePoint",
            ops: [{
                kind: "append",
                entry: {
                    type: "message",
                    message: resolutionToToolResult(storedResolution, pending),
                    origin: "harness",
                },
            }],
        }, invocationId);
        if (resolution.kind === "tool_approval" && (pending.toolName === "enter_plan_mode" || pending.toolName === "exit_plan_mode")) {
            await this.appendPlanModeResolution(snapshot, context, pending, resolution.approved, invocationId);
        }
    }

    /**
     * 为 exit_plan_mode 的历史审批结果补齐 UI-only 计划文件预览。
     */
    private async withExitPlanModePreview(
        snapshot: SessionSnapshot,
        pending: {toolName: string; args: Record<string, unknown>},
        resolution: AgentResolution,
    ): Promise<AgentResolution> {
        if (resolution.kind !== "tool_approval" || pending.toolName !== "exit_plan_mode") {
            return resolution;
        }
        const planFilePath = typeof pending.args.planFilePath === "string" ? pending.args.planFilePath.trim() : "";
        if (!planFilePath) {
            return resolution;
        }
        const preview: {[key: string]: JsonValue} = {
            planFilePath,
        };
        try {
            const target = resolvePlanModeFile({
                workspaceRoot: snapshot.metadata.workspaceRoot,
                projectPath: snapshot.metadata.projectPath,
                planFilePath,
            });
            preview.planFilePath = target.displayPath;
            preview.planContent = await readFile(target.absolutePath, "utf-8");
        } catch {
            // 计划文件可能在等待审批期间被移动或删除；审批结果仍应正常落库。
        }
        return {
            ...resolution,
            data: preview,
        };
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
        compaction?: ProfileCompactionPlan;
        sessionContextEnabled: boolean;
        toolKeys: string[];
        executionToolKeys?: string[];
        profileKey: string;
        profile: AgentProfile;
        thinkingLevel: ThinkingLevel;
        runtimeState: RunRuntimeState;
        reportResultReminderEnabled: boolean;
        caller: AgentInvokeCaller;
        abortSignal?: AbortSignal;
        invocationId?: string;
        onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
        forceRuntimeOnlyTranscript?: boolean;
        forcePersistTranscript?: boolean;
        transcriptParentLeafId?: SessionEntryId | null;
        restoreLeafAfterTranscript?: boolean;
        restoreLeafIdAfterTranscript?: SessionEntryId | null;
        suppressEvents?: boolean;
        disableSteer?: boolean;
        disableAutomaticCompaction?: boolean;
        activeSidecar?: ActiveSidecarRun;
    }): Promise<RunLoopResult> {
        const frame = createRunFrame(input);

        this.assertNoUnclosedToolCallsForModel(frame.messages, this.approvalToolKeysForProfile(frame.profile));
        await this.emitRuntimeEvent(frame, {type: "agent_start"});
        let shouldContinue = true;
        let failedResult: RunLoopResult | undefined;
        while (shouldContinue) {
            const transaction = await this.runTurnTransaction(frame);
            if (transaction.kind === "failed") {
                failedResult = transaction.result;
                break;
            }
            if (transaction.kind === "waiting") {
                await this.emitRuntimeEvent(frame, {
                    type: "agent_end",
                    status: "waiting",
                    usage: frame.finalAssistant?.usage,
                });
                return transaction.result;
            }
            shouldContinue = transaction.shouldContinue;
        }
        if (!frame.disableSteer) {
            this.steerableSessions.delete(frame.sessionId);
        }
        const failedTerminalStatus = failedResult?.status === "failed" && (failedResult.terminalStatus === "aborted" || failedResult.terminalStatus === "interrupted")
            ? failedResult.terminalStatus
            : "failed";
        await this.emitRuntimeEvent(frame, {
            type: "agent_end",
            status: failedResult ? failedTerminalStatus : "completed",
            usage: frame.finalAssistant?.usage,
        });
        if (failedResult) {
            return failedResult;
        }
        return {
            status: "completed",
            finalAssistant: frame.finalAssistant,
            reportResult: frame.reportResult,
            sidecarResult: frame.sidecarResult,
        };
    }

    /**
     * 执行一个完整 Turn Transaction。
     *
     * 这里是 Run Kernel 的核心安全点：进入模型前 drain steer，provider/tool 完成后 ingest，
     * 再决定 waiting、failed 或准备下一轮。
     */
    private async runTurnTransaction(frame: RunFrame): Promise<RunTurnTransactionResult> {
        frame.turnIndex += 1;
        await this.emitRuntimeEvent(frame, {type: "turn_start", turnIndex: frame.turnIndex});
        const preModelSteers = frame.disableSteer ? [] : await this.drainSteers({
            sessionId: frame.sessionId,
            workspaceKey: frame.workspaceKey,
            invocationId: frame.invocationId,
        });
        for (const steeredMessage of preModelSteers) {
            frame.messages.push(steeredMessage);
        }

        const turnSnapshot = await withRunKernelPhase("model", () => this.createTurnSnapshot(frame));
        const outcome = await this.executeTurn(frame, turnSnapshot);
        if (outcome.kind === "failed") {
            if (!frame.disableSteer) {
                this.steerableSessions.delete(frame.sessionId);
            }
            const failedIngestDraft = createFailedTurnIngestDraft(outcome);
            const ingest = failedIngestDraft ? await withRunKernelPhase("ingest", () => this.ingestTurn(frame, failedIngestDraft)) : undefined;
            const transaction = applyFailedTurnTransaction(frame, outcome, ingest);
            if (ingest) {
                this.clearPersistedTranscriptReplayAnchor(frame, ingest);
            }
            await this.emitRuntimeEvent(frame, {type: "turn_end", turnIndex: frame.turnIndex, status: "failed"});
            return {
                kind: "failed",
                result: transaction.result,
            };
        }

        const turn = outcome.turn;
        const ingest = await withRunKernelPhase("ingest", () => this.ingestTurn(frame, {
            assistant: turn.assistant,
            toolResults: turn.toolResults,
            waiting: turn.waiting,
        }));
        const transaction = applySuccessfulTurnTransaction(frame, outcome, ingest);
        this.clearPersistedTranscriptReplayAnchor(frame, ingest);
        if (!frame.disableSteer && !turn.waiting) {
            this.steerableSessions.delete(frame.sessionId);
        }
        if (transaction.kind === "completed" && frame.reportResultErrorCount >= REPORT_RESULT_ERROR_LIMIT) {
            const toolName = this.requiredResultToolName(frame);
            await this.emitRuntimeEvent(frame, {type: "turn_end", turnIndex: frame.turnIndex, status: "failed"});
            return {
                kind: "failed",
                result: {
                    status: "failed",
                    finalAssistant: frame.finalAssistant,
                    errorInfo: {
                        message: `${toolName} 连续失败 ${REPORT_RESULT_ERROR_LIMIT} 次，最后错误：${frame.lastReportResultError ?? "unknown"}`,
                        phase: "tool",
                    },
                    terminalStatus: "error",
                },
            };
        }
        await this.emitRuntimeEvent(frame, {type: "turn_end", turnIndex: frame.turnIndex, status: turn.waiting ? "waiting" : "completed"});
        if (transaction.kind === "waiting") {
            return {
                kind: "waiting",
                result: transaction.result,
            };
        }

        const continuation = await this.resolveTurnContinuation(frame, transaction.turn);
        await this.prepareNextTurn(frame, turn, continuation);
        if (!frame.disableSteer && continuation.continue) {
            this.steerableSessions.add(frame.sessionId);
        }
        return {
            kind: "next",
            shouldContinue: continuation.continue,
        };
    }

    /**
     * 投影并发布 provider/tool raw event。
     */
    private async emitFrameEvent(frame: RunFrame, event: AgentEvent): Promise<void> {
        const projected = projectRuntimeEvent(event);
        if (!projected) {
            return;
        }
        await this.emitRuntimeEvent(frame, projected);
    }

    /**
     * 发布公开 runtime event。SSE 和 callback 都只接触这个轻量 DTO。
     */
    private async emitRuntimeEvent(frame: RunFrame, event: AgentRuntimeStreamEventDto): Promise<AgentSessionEventDto | null> {
        if (frame.suppressEvents) {
            return null;
        }
        await frame.onEvent?.(event);
        const payload = this.publishRuntimeEvent(frame.sessionId, frame.invocationId, event);
        if (event.type === "turn_start") {
            this.createTranscriptReplayAnchor(frame, payload.seq);
        }
        return payload;
    }

    /**
     * 创建本轮 provider 请求的冻结快照。
     */
    private async createTurnSnapshot(frame: RunFrame): Promise<TurnSnapshot> {
        const snapshot = await this.repo.readSession(frame.sessionId, frame.workspaceKey);
        const context = this.repo.reduce(snapshot);
        const modelMessages = consumeNextTurnModelMessages(frame);
        const prepareTurn = await this.runRuntimeHooks({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId ?? "",
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            stage: "prepareTurn",
            snapshot,
            context,
            caller: frame.caller,
            turnIndex: frame.turnIndex,
            modelMessages,
        });
        const requestOptions = {
            ...frame.requestOptions,
            ...prepareTurn.requestOptionsPatch,
        };
        const toolKeys = frame.toolKeys;
        if (prepareTurn.toolKeysPatch) {
            // Runtime hook 只能裁剪 root tools，不能突破 profile 声明的最大工具集合。
            const rootToolKeys = new Set(frame.toolKeys);
            const invalidToolKey = prepareTurn.toolKeysPatch.find((toolKey) => !rootToolKeys.has(toolKey));
            if (invalidToolKey) {
                throw new Error(`runtime hook prepareTurn toolKeysPatch 必须是 profile root tools 子集：${invalidToolKey}`);
            }
        }
        const executionBaseToolKeySet = new Set(frame.executionToolKeys ?? toolKeys);
        const executionPatchToolKeySet = prepareTurn.toolKeysPatch ? new Set(prepareTurn.toolKeysPatch) : undefined;
        const executionToolKeys = toolKeys.filter((toolKey) => {
            if (!executionBaseToolKeySet.has(toolKey)) {
                return false;
            }
            return executionPatchToolKeySet ? executionPatchToolKeySet.has(toolKey) : true;
        });
        const toolOverrides = await this.toolOverrides(toolKeys, frame.profileKey, frame.activeSidecar);
        const tools = this.tools.allowedWithOverrides(toolKeys, toolOverrides);
        const providerMessages = modelMessages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        if (!frame.disableAutomaticCompaction && !frame.compaction) {
            this.assertContextWithinWindow({
                messages: providerMessages,
                model: frame.model,
                profileKey: frame.profileKey,
            });
        }
        return {
            index: frame.turnIndex,
            sessionSnapshot: snapshot,
            sessionContext: context,
            systemPrompt: frame.systemPrompt,
            modelMessages,
            providerMessages,
            model: frame.model,
            apiKey: frame.apiKey,
            timeoutMs: frame.timeoutMs,
            requestOptions,
            toolKeys,
            executionToolKeys,
            toolOverrides,
            tools,
            thinkingLevel: frame.thinkingLevel,
        };
    }

    /**
     * 执行单个 ReAct turn，输出可被 ingest/failure path 消费的 TurnOutcome。
     */
    private async executeTurn(frame: RunFrame, snapshot: TurnSnapshot): Promise<TurnOutcome> {
        try {
            const assistant = await this.streamAssistant({
                snapshot,
                sessionId: frame.sessionId,
                abortSignal: frame.abortSignal,
                emit: (event) => this.emitFrameEvent(frame, event),
            });
            if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
                return {
                    kind: "failed",
                    phase: "provider",
                    errorInfo: this.toInvocationErrorInfo(assistant.errorMessage || (assistant.stopReason === "aborted" ? "生成已中断。" : "生成失败，provider 未返回错误详情。"), "model"),
                    finalAssistant: assistant,
                    partialAssistant: sanitizePartialAssistant(assistant) ?? undefined,
                    messageStatus: assistant.stopReason === "aborted" ? "interrupted" : "partial",
                };
            }
            const toolCalls = assistant.content.filter((block): block is AgentToolCall => block.type === "toolCall");
            const toolBatch = await this.runToolBatch({
                sessionId: frame.sessionId,
                workspaceKey: frame.workspaceKey,
                workspaceRoot: frame.workspaceRoot,
                projectPath: frame.projectPath,
                profileKey: frame.profileKey,
                invocationId: frame.invocationId,
                assistant,
                toolCalls,
                executionToolKeys: snapshot.executionToolKeys,
                toolOverrides: snapshot.toolOverrides,
                activeSidecar: frame.activeSidecar,
                enqueueSavePointWrite: (plan, source) => {
                    frame.pendingWritePlans.push({
                        ...source,
                        enqueueOrder: frame.pendingWritePlans.length,
                        plan,
                    });
                },
                abortSignal: frame.abortSignal,
                emit: (event) => this.emitFrameEvent(frame, event),
            });
            const turn: RuntimeTurn = {
                index: snapshot.index,
                snapshot,
                assistant,
                toolCalls,
                toolResults: toolBatch.toolResults,
                reportResult: toolBatch.reportResult,
                sidecarResult: toolBatch.sidecarResult,
                reportResultError: toolBatch.reportResultError,
                sidecarResultError: toolBatch.sidecarResultError,
                waiting: toolBatch.waiting,
                shouldContinue: toolBatch.shouldContinue,
            };
            if (toolBatch.waiting) {
                return {
                    kind: "waiting",
                    turn,
                    waiting: toolBatch.waiting,
                };
            }
            return {
                kind: "completed",
                turn,
            };
        } catch (error) {
            const assistant = createRuntimeErrorAssistant(error);
            return {
                kind: "failed",
                phase: "provider",
                errorInfo: this.toInvocationErrorInfo(error, "model"),
                finalAssistant: assistant,
            };
        }
    }

    /**
     * 执行本轮 turn 的持久化 ingest。
     */
    private async ingestTurn(frame: RunFrame, input: {
        assistant: AssistantMessage;
        toolResults: ToolResultMessage[];
        waiting?: RunToolBatchResult["waiting"];
        messageStatus?: "partial" | "interrupted" | "error";
    }): Promise<TurnIngestResult> {
        return this.commitTurn({
            sessionId: frame.sessionId,
            workspaceKey: frame.workspaceKey,
            invocationId: frame.invocationId,
            assistant: input.assistant,
            toolResults: input.toolResults,
            waiting: input.waiting,
            messageStatus: input.messageStatus,
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            caller: frame.caller,
            turnIndex: frame.turnIndex,
            pendingWritePlans: frame.pendingWritePlans,
            forceRuntimeOnlyTranscript: frame.forceRuntimeOnlyTranscript,
            forcePersistTranscript: frame.forcePersistTranscript,
            transcriptParentLeafId: frame.transcriptParentLeafId,
            restoreLeafAfterTranscript: frame.restoreLeafAfterTranscript,
            restoreLeafIdAfterTranscript: frame.restoreLeafIdAfterTranscript,
        });
    }

    /**
     * 在本轮 save point 后判断是否需要继续同一个 run。
     *
     * steer 在这里被 drain 成模型可见消息；真正为下一轮补充材料的动作放到 prepareNextTurn。
     */
    private async resolveTurnContinuation(frame: RunFrame, turn: RuntimeTurn): Promise<TurnContinuationDecision> {
        const steeredMessages = frame.disableSteer ? [] : await this.drainSteers({
            sessionId: frame.sessionId,
            workspaceKey: frame.workspaceKey,
            invocationId: frame.invocationId,
        });
        return resolveTurnContinuation({
            turn,
            steeredMessages,
            hasReportResult: this.hasRequiredResult(frame),
            reportResultReminderSent: frame.reportResultReminderSent,
            reportResultAllowed: frame.reportResultReminderEnabled && turn.snapshot.executionToolKeys.includes(this.requiredResultToolName(frame)),
        });
    }

    private requiredResultToolName(frame: Pick<RunFrame, "activeSidecar">): "report_result" | "report_sidecar_result" {
        return frame.activeSidecar ? "report_sidecar_result" : "report_result";
    }

    private hasRequiredResult(frame: Pick<RunFrame, "activeSidecar" | "reportResult" | "sidecarResult">): boolean {
        return frame.activeSidecar ? Boolean(frame.sidecarResult) : Boolean(frame.reportResult);
    }

    /**
     * 为同一个 run 的下一轮 turn 准备 runtime state 和模型可见消息。
     */
    private async prepareNextTurn(frame: RunFrame, turn: RuntimeTurn, decision: TurnContinuationDecision): Promise<void> {
        const preparation = applyNextTurnPreparation(frame, decision);
        if (preparation.reminderPlan) {
            const entries = await withRunKernelPhase("ingest", () => this.executeWritePlan(preparation.reminderPlan!, frame.invocationId));
            const reminderEntry = entries.findLast((entry) => entry.type === "message");
            if (reminderEntry) {
                frame.transcriptParentLeafId = reminderEntry.id;
            }
        }
        if (!preparation.shouldContinue) {
            return;
        }
        const snapshot = await this.repo.readSession(frame.sessionId, frame.workspaceKey);
        const context = this.repo.reduce(snapshot);
        const nextTurnHooks = await withRunKernelPhase("model", () => this.runRuntimeHooks({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId ?? "",
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            stage: "prepareNextTurn",
            snapshot,
            context,
            caller: frame.caller,
            turnIndex: frame.turnIndex,
            turn: {
                assistant: turn.assistant,
                toolResults: turn.toolResults,
                waiting: turn.waiting,
            },
            modelMessages: frame.messages,
        }));
        if (nextTurnHooks.reportResultReminder !== undefined) {
            frame.reportResultReminderEnabled = nextTurnHooks.reportResultReminder;
        }
        const compacted = await withRunKernelPhase("compaction", () => this.compactBeforeNextTurn(frame));
        if (compacted) {
            await withRunKernelPhase("ingest", () => this.reinjectHistorySetAfterCompaction(frame));
            const compactedSnapshot = await this.repo.readSession(frame.sessionId, frame.workspaceKey);
            frame.messages = this.repo.reduce(compactedSnapshot).messages;
        }
        frame.nextTurnRuntimeMessages = nextTurnHooks.runtimeMessages;
    }

    private async compactBeforeNextTurn(frame: RunFrame): Promise<boolean> {
        if (frame.disableAutomaticCompaction || frame.automaticCompactionDoneForTurn) {
            return false;
        }
        if (!frame.compaction) {
            this.assertContextWithinWindow(frame);
            return false;
        }
        const compacted = await compactIfNeeded({
            repo: this.repo,
            snapshot: await this.repo.readSession(frame.sessionId, frame.workspaceKey),
            messages: frame.messages,
            model: frame.model,
            apiKey: frame.apiKey,
            thinkingLevel: frame.thinkingLevel,
            timeoutMs: frame.timeoutMs,
            requestOptions: frame.requestOptions,
            compaction: frame.compaction,
            writeCompactionEntry: async (entry) => {
                await new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: frame.sessionId,
                    invocationId: frame.invocationId,
                }).append("compact.auto", entry);
            },
        });
        frame.automaticCompactionDoneForTurn = compacted;
        return compacted;
    }

    /**
     * 自动 compact 会把早期 HistorySet 压进 summary；下一轮前补写一次初始化历史。
     */
    private async reinjectHistorySetAfterCompaction(frame: RunFrame): Promise<void> {
        if (!frame.sessionContextEnabled || !frame.profile.prepare) {
            return;
        }
        const snapshot = await this.repo.readSession(frame.sessionId, frame.workspaceKey);
        const context = this.repo.reduce(snapshot);
        const parsedInput = this.profiles.parseInput(frame.profile, snapshot.metadata.input);
        const prepared = await frame.profile.prepare({
            session: this.createRuntimeSessionFacade({
                sessionId: frame.sessionId,
                profileKey: frame.profile.manifest.key,
                input: parsedInput,
                context,
            }),
            input: parsedInput as never,
            vars: await this.createProfileVariableAccessor(snapshot, frame.profile, {dryRun: true}),
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
            },
        });
        validateProfileTurnPlan(frame.profile.manifest.key, prepared);
        if (!prepared.historyInitMessages?.length) {
            return;
        }
        await this.executeWritePlan({
            target: {sessionId: frame.sessionId},
            cause: "compact.history_set",
            ops: [{
                kind: "appendMany",
                entries: prepared.historyInitMessages.map((message) => ({
                    type: "custom_message" as const,
                    message,
                    visibleToModel: true,
                })),
            }],
        }, frame.invocationId);
    }

    /**
     * 没有 compaction 配置时主动阻止超窗口请求，避免静默依赖 provider overflow。
     */
    private assertContextWithinWindow(frame: Pick<RunFrame, "messages" | "model" | "profileKey">): void {
        const usage = estimateContextTokens(frame.messages);
        if (usage.tokens <= frame.model.contextWindow) {
            return;
        }
        throw new Error(`当前 profile ${frame.profileKey} 未声明 compaction 配置，上下文 ${usage.tokens} tokens 已超过模型 ${frame.model.id} 的 ${frame.model.contextWindow} token 限制。`);
    }

    private async streamAssistant(input: {
        snapshot: TurnSnapshot;
        sessionId: number;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
    }): Promise<AssistantMessage> {
        const context = {
            systemPrompt: input.snapshot.systemPrompt,
            messages: input.snapshot.providerMessages,
            tools: input.snapshot.tools,
        };
        const options = {
            sessionId: String(input.sessionId),
            reasoning: input.snapshot.thinkingLevel === "off" ? undefined : input.snapshot.thinkingLevel,
            apiKey: input.snapshot.apiKey,
            timeoutMs: input.snapshot.timeoutMs ?? undefined,
            ...this.piStreamOptions(input.snapshot.requestOptions),
            signal: input.abortSignal,
        };
        const stream = await streamSimple(input.snapshot.model, context, options);

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
        profileKey: string;
        invocationId?: string;
        assistant: AssistantMessage;
        toolCalls: AgentToolCall[];
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        activeSidecar?: ActiveSidecarRun;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
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
        let sidecarResult: RunToolBatchResult["sidecarResult"] | undefined;
        let reportResultError: string | undefined;
        let sidecarResultError: string | undefined;
        let allExecutedTerminate = true;
        let segment: Array<{toolCall: AgentToolCall; index: number}> = [];
        const flushSegment = async (): Promise<void> => {
            if (segment.length === 0) {
                return;
            }
            const segmentResult = await this.executeToolSegment({
                ...input,
                toolCalls: segment,
            });
            toolResults.push(...segmentResult.toolResults);
            allExecutedTerminate = allExecutedTerminate && segmentResult.allTerminate;
            if (segmentResult.reportResult) {
                reportResult = segmentResult.reportResult;
                reportResultError = undefined;
            }
            if (segmentResult.sidecarResult) {
                sidecarResult = segmentResult.sidecarResult;
                sidecarResultError = undefined;
            }
            if (segmentResult.reportResultError) {
                reportResultError = segmentResult.reportResultError;
            }
            if (segmentResult.sidecarResultError) {
                sidecarResultError = segmentResult.sidecarResultError;
            }
            segment = [];
        };

        for (let index = 0; index < input.toolCalls.length; index += 1) {
            const toolCall = input.toolCalls[index]!;
            const approvalTool = input.toolOverrides[toolCall.name] ?? this.tools.get(toolCall.name);
            if (approvalTool?.approvalRequired) {
                await flushSegment();
                const approvalError = await this.validateApprovalTool(input.executionToolKeys, input.toolOverrides, input.workspaceRoot, input.projectPath, toolCall);
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
                    allExecutedTerminate = false;
                    continue;
                }
                const skippedToolResults = this.skippedToolResultsAfterApproval(input.toolCalls, toolCall);
                await this.emitToolResultMessages(skippedToolResults, input.emit);
                return {
                    toolResults: [
                        ...toolResults,
                        ...skippedToolResults,
                    ],
                    reportResult,
                    sidecarResult,
                    reportResultError,
                    sidecarResultError,
                    waiting: {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                    },
                    shouldContinue: false,
                };
            }

            if (isResultToolName(toolCall.name)) {
                await flushSegment();
                const segmentResult = await this.executeToolSegment({
                    ...input,
                    toolCalls: [{toolCall, index}],
                });
                toolResults.push(...segmentResult.toolResults);
                if (segmentResult.reportResult || segmentResult.sidecarResult) {
                    reportResult = segmentResult.reportResult;
                    sidecarResult = segmentResult.sidecarResult;
                    reportResultError = undefined;
                    sidecarResultError = undefined;
                    const skippedToolResults = this.skippedToolResultsAfterTerminal(input.toolCalls, toolCall);
                    await this.emitToolResultMessages(skippedToolResults, input.emit);
                    return {
                        toolResults: [
                            ...toolResults,
                            ...skippedToolResults,
                        ],
                        reportResult,
                        sidecarResult,
                        reportResultError,
                        sidecarResultError,
                        shouldContinue: false,
                    };
                }
                if (segmentResult.reportResultError) {
                    reportResultError = segmentResult.reportResultError;
                }
                if (segmentResult.sidecarResultError) {
                    sidecarResultError = segmentResult.sidecarResultError;
                }
                const skippedToolResults = this.skippedToolResultsAfterTerminal(input.toolCalls, toolCall);
                await this.emitToolResultMessages(skippedToolResults, input.emit);
                return {
                    toolResults: [
                        ...toolResults,
                        ...skippedToolResults,
                    ],
                    reportResult,
                    sidecarResult,
                    reportResultError,
                    sidecarResultError,
                    shouldContinue: true,
                };
            }

            segment.push({toolCall, index});
        }
        await flushSegment();
        return {
            toolResults,
            reportResult,
            sidecarResult,
            reportResultError,
            sidecarResultError,
            shouldContinue: !allExecutedTerminate,
        };
    }

    private async executeToolSegment(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        projectPath?: string;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        activeSidecar?: ActiveSidecarRun;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        toolCalls: Array<{toolCall: AgentToolCall; index: number}>;
    }): Promise<{
        toolResults: ToolResultMessage[];
        reportResult?: InvokeAgentResult["reportResult"];
        sidecarResult?: RunToolBatchResult["sidecarResult"];
        reportResultError?: string;
        sidecarResultError?: string;
        allTerminate: boolean;
    }> {
        const shouldRunSequentially = this.toolExecution === "sequential"
            || input.toolCalls.some(({toolCall}) => this.resolveToolExecutionMode(toolCall, input.toolOverrides) === "sequential");
        const executions = shouldRunSequentially
            ? await this.executeToolSegmentSequentially(input)
            : await Promise.all(input.toolCalls.map((toolCall) => this.executeToolWithEvents({...input, ...toolCall})));
        const orderedExecutions = executions.sort((left, right) => left.index - right.index);
        const toolResults: ToolResultMessage[] = [];
        let reportResult: InvokeAgentResult["reportResult"] | undefined;
        let sidecarResult: RunToolBatchResult["sidecarResult"] | undefined;
        let reportResultError: string | undefined;
        let sidecarResultError: string | undefined;
        let allTerminate = true;
        for (const executed of orderedExecutions) {
            const toolResult = createToolResultFromResult({
                toolCallId: executed.toolCall.id,
                toolName: executed.toolCall.name,
                result: executed.result,
                isError: executed.isError,
            });
            toolResults.push(toolResult);
            await input.emit({type: "message_start", message: toolResult});
            await input.emit({type: "message_end", message: toolResult});
            allTerminate = allTerminate && executed.result.terminate === true;
            if (executed.toolCall.name === "report_result") {
                if (executed.isError) {
                    reportResultError = messageText(toolResult) || "report_result 工具调用失败。";
                } else {
                    reportResult = this.readReportResult(executed.result.details);
                    reportResultError = undefined;
                }
            }
            if (executed.toolCall.name === "report_sidecar_result") {
                if (executed.isError) {
                    sidecarResultError = messageText(toolResult) || "report_sidecar_result 工具调用失败。";
                } else {
                    sidecarResult = this.readSidecarToolResult(executed.result.details);
                    sidecarResultError = undefined;
                }
            }
        }
        return {
            toolResults,
            reportResult,
            sidecarResult,
            reportResultError,
            sidecarResultError,
            allTerminate,
        };
    }

    private async emitToolResultMessages(toolResults: ToolResultMessage[], emit: (event: AgentEvent) => Promise<void>): Promise<void> {
        for (const toolResult of toolResults) {
            await emit({type: "message_start", message: toolResult});
            await emit({type: "message_end", message: toolResult});
        }
    }

    private async executeToolSegmentSequentially(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        projectPath?: string;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        activeSidecar?: ActiveSidecarRun;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        toolCalls: Array<{toolCall: AgentToolCall; index: number}>;
    }): Promise<Array<{
        toolCall: AgentToolCall;
        index: number;
        result: AgentToolResult<unknown>;
        isError: boolean;
    }>> {
        const executions: Array<{
            toolCall: AgentToolCall;
            index: number;
            result: AgentToolResult<unknown>;
            isError: boolean;
        }> = [];
        for (const toolCall of input.toolCalls) {
            executions.push(await this.executeToolWithEvents({...input, ...toolCall}));
        }
        return executions;
    }

    private async executeToolWithEvents(input: {
        sessionId: number;
        workspaceKey: string;
        workspaceRoot: string;
        projectPath?: string;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        activeSidecar?: ActiveSidecarRun;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        toolCall: AgentToolCall;
        index: number;
    }): Promise<{
        toolCall: AgentToolCall;
        index: number;
        result: AgentToolResult<unknown>;
        isError: boolean;
    }> {
        const {toolCall} = input;
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
            profileKey: input.profileKey,
            invocationId: input.invocationId,
            executionToolKeys: input.executionToolKeys,
            toolOverrides: input.toolOverrides,
            activeSidecar: input.activeSidecar,
            enqueueSavePointWrite: input.enqueueSavePointWrite,
            toolCallIndex: input.index,
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
        return {
            toolCall,
            index: input.index,
            result: executed.result,
            isError: executed.isError,
        };
    }

    private resolveToolExecutionMode(toolCall: AgentToolCall, toolOverrides: Record<string, NeuroAgentTool>): "sequential" | "parallel" {
        const tool = toolOverrides[toolCall.name] ?? this.tools.get(toolCall.name);
        return tool?.executionMode ?? "parallel";
    }

    private skippedToolResultsAfterTerminal(toolCalls: AgentToolCall[], terminalToolCall: AgentToolCall): ToolResultMessage[] {
        const terminalIndex = toolCalls.findIndex((toolCall) => toolCall.id === terminalToolCall.id);
        if (terminalIndex < 0) {
            return [];
        }
        return toolCalls.slice(terminalIndex + 1).map((toolCall) => createTextToolResult({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            text: `Skipped because ${terminalToolCall.name} already reported the final result. This tool was not executed in this turn.`,
            isError: true,
        }));
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

    private async validateApprovalTool(executionToolKeys: string[], toolOverrides: Record<string, NeuroAgentTool>, workspaceRoot: string, projectPath: string | undefined, toolCall: AgentToolCall): Promise<string | null> {
        const tool = toolOverrides[toolCall.name] ?? this.tools.get(toolCall.name);
        if (!tool) {
            return `Tool ${toolCall.name} not found`;
        }
        if (!executionToolKeys.includes(tool.key)) {
            return `Tool ${toolCall.name} is not allowed by this profile`;
        }
        if (toolCall.name === "exit_plan_mode" && typeof toolCall.arguments.planFilePath === "string" && toolCall.arguments.planFilePath.trim()) {
            try {
                await readFile(resolvePlanModeFile({
                    workspaceRoot,
                    projectPath,
                    planFilePath: toolCall.arguments.planFilePath,
                }).absolutePath, "utf-8");
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
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        activeSidecar?: ActiveSidecarRun;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        toolCallIndex: number;
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
        if (!input.executionToolKeys.includes(tool.key)) {
            const resultToolError = this.resultToolPermissionError(tool.key, input.activeSidecar);
            if (resultToolError) {
                return {
                    result: this.errorToolResult(resultToolError),
                    isError: true,
                };
            }
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
            const validationTool = tool.validationSchema
                ? {
                    ...tool,
                    parameters: tool.validationSchema,
                }
                : tool;
            const args = validateToolArguments(validationTool, preparedToolCall);
            const context: ToolExecutionContext = {
                harness: this,
                sessionId: input.sessionId,
                profileKey: input.profileKey,
                workspaceRoot: input.workspaceRoot,
                workspaceKey: input.workspaceKey,
                projectPath: input.projectPath,
                invocationId: input.invocationId,
                vars: await this.createVariableAccessor(input.sessionId, input.invocationId),
                sessionWrites: new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: input.sessionId,
                    invocationId: input.invocationId,
                    toolCallIndex: input.toolCallIndex,
                    toolCallId: input.toolCall.id,
                    enqueueSavePoint: input.enqueueSavePointWrite,
                }),
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

    private resultToolPermissionError(toolName: string, activeSidecar?: ActiveSidecarRun): string | null {
        if (toolName === "report_result" && activeSidecar) {
            return `当前处于 sidecar ${activeSidecar.name} 旁路阶段，不能使用 report_result；请改用 report_sidecar_result，并通过 report_sidecar_result.data 返回旁路结果。`;
        }
        if (toolName === "report_sidecar_result" && !activeSidecar) {
            return "当前是主 run，不能使用 report_sidecar_result；请改用 report_result 返回主路结果。";
        }
        return null;
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

    private async enqueueFollowUp(sessionId: number, message: AgentUserMessageInput): Promise<AgentFollowUpQueueItemDto> {
        const item: AgentFollowUpQueueItemDto = {
            id: randomUUID(),
            kind: "followup",
            message,
            createdAt: Date.now(),
        };
        const queue = this.followUpQueueState(sessionId);
        await this.setFollowUpQueueState(sessionId, {
            status: "ready",
            items: [...queue.items, item],
        });
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
        const entries: AppendManySessionEntryDraft[] = [];
        for (const item of queue) {
            const message = createUserMessage({
                ...item.message,
                text: this.steerText(item.message.text),
            });
            entries.push({
                type: "message",
                message,
                origin: "harness",
            });
            messages.push(message);
        }
        await this.executeWritePlan({
            target: {sessionId: input.sessionId},
            cause: "steer.drain",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries,
            }],
        }, input.invocationId);
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
        const queue = this.followUpQueueState(sessionId);
        if (queue.status === "paused") {
            return;
        }
        const next = queue.items[0];
        if (!next) {
            await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
            return;
        }
        const rest = queue.items.slice(1);
        if (rest.length === 0) {
            await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
        } else {
            await this.setFollowUpQueueState(sessionId, {
                status: "ready",
                items: rest,
            });
        }
        await this.invokeAgent({
            sessionId,
            mode: "prompt",
            message: next.message,
            caller: {kind: "system", sessionId},
            internalQueued: true,
        });
    }

    private async pauseFollowUps(sessionId: number, invocationId: string, reason: "error" | "aborted" | "interrupted"): Promise<void> {
        const queue = this.followUpQueueState(sessionId);
        if (queue.items.length === 0) {
            return;
        }
        await this.setFollowUpQueueState(sessionId, {
            status: "paused",
            pausedBy: {
                invocationId,
                reason,
            },
            items: queue.items,
        });
    }

    private async finishInvocation(sessionId: number, invocationId?: string): Promise<void> {
        this.finishInvocationState(sessionId, invocationId);
        await this.publishSessionState(sessionId, invocationId);
    }

    private finishInvocationState(sessionId: number, invocationId?: string): void {
        this.clearTranscriptReplayAnchor(sessionId);
        this.activeInvocations.delete(sessionId);
        this.steerableSessions.delete(sessionId);
        this.steerQueues.delete(sessionId);
        this.abortControllers.delete(sessionId);
        if (invocationId) {
            this.invocationClientStates.delete(invocationId);
            this.invocationVariableStates.delete(invocationId);
            this.invocationRuntimeStates.delete(invocationId);
            this.rejectPendingClientPatches(invocationId);
        }
    }

    private async writeLifecycle(
        sessionId: number,
        invocationId: string,
        status: Extract<SessionEntryDraft, {type: "invocation_lifecycle"}>["status"],
        error?: string,
        errorInfo?: InvocationErrorInfo,
    ): Promise<void> {
        await this.executeWritePlan({
            target: {sessionId},
            cause: `lifecycle.${status}`,
            ops: [{
                kind: "append",
                entry: {
                    type: "invocation_lifecycle",
                    invocationId,
                    status,
                    error,
                    errorInfo,
                },
            }],
        }, invocationId);
    }

    private async withSessionAdmission<TResult>(sessionId: number, task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.admissionQueues.get(sessionId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => current);
        this.admissionQueues.set(sessionId, queued);

        await previous.catch(() => undefined);
        try {
            return await task();
        } finally {
            release();
            if (this.admissionQueues.get(sessionId) === queued) {
                this.admissionQueues.delete(sessionId);
            }
        }
    }

    private async executeWritePlan(plan: SessionWritePlan, invocationId?: string): Promise<SessionEntry[]> {
        return (await this.writeExecutor.execute([plan], invocationId)).entries;
    }

    private followUpQueueState(sessionId: number, context?: NeuroSessionContext): AgentFollowUpQueueStateDto {
        const existing = this.followUpQueues.get(sessionId);
        if (existing) {
            return existing;
        }
        const persisted = context ? this.readFollowUpQueueState(context) : undefined;
        if (persisted) {
            this.followUpQueues.set(sessionId, persisted);
            return persisted;
        }
        return this.emptyFollowUpQueueState();
    }

    private emptyFollowUpQueueState(): AgentFollowUpQueueStateDto {
        return {
            status: "ready",
            items: [],
        };
    }

    private async setFollowUpQueueState(sessionId: number, queue: AgentFollowUpQueueStateDto): Promise<void> {
        if (queue.items.length === 0 && queue.status === "ready") {
            this.followUpQueues.delete(sessionId);
        } else {
            this.followUpQueues.set(sessionId, queue);
        }
        await this.executeWritePlan({
            target: {sessionId},
            cause: "followup.queue",
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "custom",
                    key: AGENT_FOLLOW_UP_QUEUE_STATE_KEY,
                    value: queue,
                },
            }],
        });
    }

    private readFollowUpQueueState(context: NeuroSessionContext): AgentFollowUpQueueStateDto | undefined {
        const value = context.customState[AGENT_FOLLOW_UP_QUEUE_STATE_KEY];
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return undefined;
        }
        const record = value as Record<string, JsonValue>;
        if (record.status !== "ready" && record.status !== "paused") {
            return undefined;
        }
        if (!Array.isArray(record.items)) {
            return undefined;
        }
        const items = record.items.filter(isFollowUpQueueItem);
        const pausedBy = record.pausedBy && typeof record.pausedBy === "object" && !Array.isArray(record.pausedBy)
            ? record.pausedBy as Record<string, JsonValue>
            : undefined;
        const reason = pausedBy?.reason;
        return {
            status: record.status,
            ...(record.status === "paused" && typeof pausedBy?.invocationId === "string" && (reason === "error" || reason === "aborted" || reason === "interrupted")
                ? {pausedBy: {invocationId: pausedBy.invocationId, reason}}
                : {}),
            items,
        };
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
            writeSessionEntry: options.dryRun
                ? undefined
                : (cause, entry) => new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: snapshot.metadata.sessionId,
                    invocationId: options.invocationId,
                }).append(cause, entry),
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

    private publishRuntimeEvent(sessionId: number, invocationId: string | undefined, event: AgentRuntimeStreamEventDto): AgentSessionEventDto {
        return this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "runtime",
            event,
        });
    }

    private createTranscriptReplayAnchor(frame: RunFrame, turnStartSeq: number): void {
        if (this.transcriptReplayAnchors.has(frame.sessionId)) {
            return;
        }
        const firstSeq = turnStartSeq;
        this.transcriptReplayAnchors.set(frame.sessionId, {
            invocationId: frame.invocationId,
            turnIndex: frame.turnIndex,
            after: firstSeq - 1,
            firstSeq,
        });
        this.eventHub.pinReplayFrom(frame.sessionId, firstSeq);
    }

    private clearPersistedTranscriptReplayAnchor(frame: RunFrame, ingest: TurnIngestResult): void {
        if (ingest.transcript !== "persist") {
            return;
        }
        const anchor = this.transcriptReplayAnchors.get(frame.sessionId);
        if (!anchor || anchor.turnIndex !== frame.turnIndex) {
            return;
        }
        if (anchor.invocationId && frame.invocationId && anchor.invocationId !== frame.invocationId) {
            return;
        }
        this.clearTranscriptReplayAnchor(frame.sessionId);
    }

    private clearTranscriptReplayAnchor(sessionId: number): void {
        this.transcriptReplayAnchors.delete(sessionId);
        this.eventHub.unpinReplay(sessionId);
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

    /**
     * 通知 target session 重新拉完整 snapshot，以刷新 linkedByAgents 这类跨 session 投影。
     */
    private publishLinkedAgentSnapshotRequired(sessionId: number): void {
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {
                type: "snapshot_required",
                reason: "linked agent relationship changed",
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
                state: await this.getSessionLiveState(sessionId),
            },
        });
    }

    private resolveSessionStatus(
        sessionId: number,
        baseStatus: AgentSessionSummaryDto["status"],
        archived: boolean,
        active: AgentActiveInvocationDto | null = this.activeInvocations.get(sessionId) ?? null,
    ): AgentSessionSummaryDto["status"] {
        if (archived) {
            return "archived";
        }
        if (active?.status === "waiting") {
            return "waiting";
        }
        if (active) {
            return "running";
        }
        return baseStatus;
    }

    private async resolveSessionRuntimeProjection(sessionId: number, snapshot?: SessionSnapshot): Promise<SessionRuntimeProjection> {
        const currentSnapshot = snapshot ?? await this.repo.readSession(sessionId);
        const context = this.repo.reduce(currentSnapshot);
        const profileRuntime = await this.resolveProfileRuntime(currentSnapshot.metadata.profileKey);
        const pendingMessages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pendingApproval = findPendingApprovalCall(pendingMessages, await this.approvalToolKeysForSnapshot(currentSnapshot, profileRuntime.profile));
        const baseSummary = this.repo.summary(currentSnapshot);
        const activeInvocation = this.resolveActiveInvocation(sessionId, baseSummary.status, pendingApproval, currentSnapshot);
        const summary = {
            ...baseSummary,
            status: this.resolveSessionStatus(sessionId, baseSummary.status, context.archived, activeInvocation),
            profileAvailability: profileRuntime.availability,
            ...(profileRuntime.issueMessage ? {profileIssueMessage: profileRuntime.issueMessage} : {}),
        };
        return {
            snapshot: currentSnapshot,
            context,
            profile: profileRuntime.profile,
            profileAvailability: profileRuntime.availability,
            ...(profileRuntime.issueMessage ? {profileIssueMessage: profileRuntime.issueMessage} : {}),
            baseSummary,
            summary,
            pendingApproval,
            activeInvocation,
        };
    }

    /**
     * 解析 session 引用的 profile 运行态；缺失或不可运行只影响继续运行，不影响历史读取。
     */
    private async resolveProfileRuntime(profileKey: string): Promise<{
        profile: AgentProfile | null;
        availability: AgentSessionProfileAvailability;
        issueMessage?: string;
    }> {
        try {
            return {
                profile: await this.profiles.get(profileKey),
                availability: "loaded",
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                const catalog = await this.profiles.snapshot();
                const catalogItem = catalog.profiles.find((profile) => profile.key === profileKey);
                if (catalogItem) {
                    return {
                        profile: null,
                        availability: "unloadable",
                        issueMessage: catalogItem.issue?.message ?? message,
                    };
                }
            } catch {
                return {
                    profile: null,
                    availability: "unloadable",
                    issueMessage: message,
                };
            }
            return {
                profile: null,
                availability: "missing",
                issueMessage: message,
            };
        }
    }

    /**
     * 确认当前 session 的 profile 仍可用于发起新运行。
     */
    private async assertProfileRunnable(snapshot: SessionSnapshot): Promise<AgentProfile> {
        const runtime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
        if (!runtime.profile) {
            throw new Error(this.profileUnavailableMessage(snapshot.metadata.profileKey));
        }
        return runtime.profile;
    }

    /**
     * 返回 profile 不可继续运行时统一展示给用户的错误文案。
     */
    private profileUnavailableMessage(profileKey: string): string {
        return `当前 session 使用的 profile "${profileKey}" 已不存在或不可运行，无法继续运行。请恢复该 profile，或新建/切换到其他 profile。`;
    }

    /**
     * 生成 profile 不可运行时的 invoke error result。
     */
    private profileUnavailableInvokeResult(sessionId: number, profileKey: string, invocationId: string = randomUUID()): InvokeAgentResult {
        const errorInfo = this.toInvocationErrorInfo(this.profileUnavailableMessage(profileKey), "pre_loop");
        return {
            sessionId,
            invocationId,
            status: "error",
            error: errorInfo.message,
            errorPhase: errorInfo.phase,
            errorInfo,
        };
    }

    /**
     * 生成当前 active context 的 token 估算信息。
     */
    private async sessionContextUsage(snapshot: SessionSnapshot, context: NeuroSessionContext): Promise<AgentSessionContextUsageDto> {
        const usedTokens = estimateContextTokens(context.messages).tokens;
        let limitTokens: number | null = null;
        try {
            const config = await loadEffectiveConfig(snapshot.metadata);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            limitTokens = typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
                ? model.contextWindow
                : null;
        } catch {
            limitTokens = null;
        }
        return {
            usedTokens,
            limitTokens,
            percent: limitTokens ? usedTokens / limitTokens * 100 : null,
            estimated: true,
        };
    }

    private resolveActiveInvocation(
        sessionId: number,
        baseStatus: AgentSessionSummaryDto["status"],
        pendingApproval: PendingApprovalLookup,
        snapshot: SessionSnapshot,
    ): AgentActiveInvocationDto | null {
        const active = this.activeInvocations.get(sessionId);
        if (active) {
            return active;
        }
        if (!pendingApproval) {
            return null;
        }
        return this.hydrateWaitingInvocation(sessionId, baseStatus, snapshot);
    }

    private hydrateWaitingInvocation(sessionId: number, baseStatus: AgentSessionSummaryDto["status"], snapshot: SessionSnapshot): AgentActiveInvocationDto | null {
        if (baseStatus === "archived") {
            return null;
        }
        const path = this.repo.activePath(snapshot);
        for (let index = path.length - 1; index >= 0; index -= 1) {
            const entry = path[index];
            if (entry?.type !== "invocation_lifecycle") {
                continue;
            }
            if (entry.status !== "waiting") {
                return null;
            }
            return {
                invocationId: entry.invocationId,
                sessionId,
                status: "waiting",
                mode: "continue",
                startedAt: entry.timestamp,
            };
        }
        return null;
    }

    private isLeaderProfile(profileKey: string): boolean {
        return profileKey === "leader.default"
            || profileKey === "leader.assets"
            || profileKey === "rp.leader"
            || profileKey === "simulator.leader"
            || profileKey.startsWith("leader.");
    }

    private async moveLeafForPosition(
        sessionId: number,
        targetEntryId: SessionEntryId,
        position: "at" | "before",
    ): Promise<void> {
        const snapshot = await this.repo.readSession(sessionId);
        const target = snapshot.entries.find((entry) => entry.id === targetEntryId);
        if (!target || target.type === "leaf") {
            throw new Error(`未找到目标 entry：${targetEntryId}`);
        }
        await this.executeWritePlan({
            target: {sessionId},
            cause: `tree.${position}`,
            ops: [{
                kind: "moveLeaf",
                leafId: position === "before" ? target.parentId : target.id,
            }],
        });
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
        await this.writeLifecycle(sessionId, invocationId, "start");
        try {
            const snapshot = await this.repo.readSession(sessionId);
            const context = this.repo.reduce(snapshot);
            const config = await loadEffectiveConfig(context);
            const model = context.model ?? this.modelResolver(config, context.profileKey);
            const providerOptions = this.providerOptions(config, model);
            const thinkingLevel = this.resolveThinkingLevel(context, config, model);
            const profile = await this.profiles.get(context.profileKey);
            const compaction = profile.compaction;
            if (!compaction) {
                throw new Error(`当前 profile ${context.profileKey} 未声明 compaction 配置，不能执行手动压缩。`);
            }
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
                writeCompactionEntry: async (entry) => {
                    await new ToolSessionWriteSink({
                        executor: this.writeExecutor,
                        sessionId,
                        invocationId,
                    }).append("compact.append", entry);
                },
            });
            await this.writeLifecycle(sessionId, invocationId, "end");
        } catch (error) {
            const errorInfo = this.toInvocationErrorInfo(error, "compaction");
            await this.writeLifecycle(sessionId, invocationId, "error", errorInfo.message, errorInfo);
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
        messageStatus?: "partial" | "interrupted" | "error";
        profile: AgentProfile;
        runtimeState: RunRuntimeState;
        caller: AgentInvokeCaller;
        turnIndex: number;
        pendingWritePlans: PendingSessionWritePlan[];
        forceRuntimeOnlyTranscript?: boolean;
        forcePersistTranscript?: boolean;
        transcriptParentLeafId?: SessionEntryId | null;
        restoreLeafAfterTranscript?: boolean;
        restoreLeafIdAfterTranscript?: SessionEntryId | null;
    }): Promise<TurnIngestResult> {
        const orderedToolResults = this.orderToolResults(input.assistant, input.toolResults);
        this.assertTurnClosed(input.assistant, orderedToolResults, input.waiting);
        const snapshot = await this.repo.readSession(input.sessionId, input.workspaceKey);
        const context = this.repo.reduce(snapshot);
        const ingest = await this.runRuntimeHooks({
            sessionId: input.sessionId,
            invocationId: input.invocationId ?? "",
            profile: input.profile,
            runtimeState: input.runtimeState,
            stage: "ingestTurn",
            snapshot,
            context,
            caller: input.caller,
            turnIndex: input.turnIndex,
            turn: {
                assistant: input.assistant,
                toolResults: orderedToolResults,
                waiting: input.waiting,
                messageStatus: input.messageStatus,
            },
        });
        const transcript = input.forcePersistTranscript ? "persist" : input.forceRuntimeOnlyTranscript ? "runtime_only" : ingest.transcript ?? "runtime_only";
        if (transcript === "runtime_only") {
            if (input.waiting) {
                throw new Error("waiting turn 必须显式使用 persist transcript；resume 需要持久化 pending tool call。");
            }
            await this.flushPendingWritePlans(input.pendingWritePlans, input.invocationId);
            return {transcript: "runtime_only"};
        }
        const transcriptPlan: SessionWritePlan = {
            target: {sessionId: input.sessionId},
            cause: "turn.ingest",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries: [
                    {
                        type: "message",
                        message: input.assistant,
                        origin: "harness",
                        ...(input.transcriptParentLeafId !== undefined ? {parentId: input.transcriptParentLeafId} : {}),
                        status: input.messageStatus,
                    },
                    ...orderedToolResults.map((toolResult) => ({
                        type: "message" as const,
                        message: toolResult,
                        origin: "harness" as const,
                    })),
                ],
            }],
        };
        const transcriptResult = await this.writeExecutor.execute([transcriptPlan, ...this.orderedPendingWritePlans(input.pendingWritePlans)], input.invocationId);
        const transcriptEntryCount = 1 + orderedToolResults.length;
        const transcriptLeafId = transcriptResult.entries.slice(0, transcriptEntryCount).at(-1)?.id ?? input.transcriptParentLeafId;
        input.pendingWritePlans.splice(0, input.pendingWritePlans.length);
        if (input.restoreLeafAfterTranscript) {
            await this.writeExecutor.execute([{
                target: {sessionId: input.sessionId},
                cause: "turn.ingest.restoreLeaf",
                ops: [{
                    kind: "moveLeaf",
                    leafId: input.restoreLeafIdAfterTranscript ?? null,
                }],
            }], input.invocationId);
        }
        return {transcript: "persist", transcriptLeafId};
    }

    private async flushPendingWritePlans(plans: PendingSessionWritePlan[], invocationId?: string): Promise<void> {
        if (plans.length === 0) {
            return;
        }
        await this.writeExecutor.execute(this.orderedPendingWritePlans(plans), invocationId);
        plans.splice(0, plans.length);
    }

    private orderedPendingWritePlans(plans: PendingSessionWritePlan[]): SessionWritePlan[] {
        return [...plans]
            .sort((left, right) => left.toolCallIndex - right.toolCallIndex || left.enqueueOrder - right.enqueueOrder)
            .map((pending) => pending.plan);
    }

    /**
     * 在固定 pipeline stage 执行 profile runtime hooks。
     *
     * hook 可以返回 write plan、runtimeState 和有限的 turn snapshot patch。
     */
    private async runRuntimeHooks(input: RuntimeHookExecutionInput): Promise<RuntimeHookExecutionResult> {
        const hooks = (input.profile.runtime?.hooks ?? [])
            .filter((hook): hook is AgentRuntimeHook => "stage" in hook && hook.stage === input.stage);
        const result: RuntimeHookExecutionResult = {
            runtimeMessages: [],
        };
        if (hooks.length === 0) {
            return result;
        }

        const context = input.context ?? this.repo.reduce(input.snapshot ?? await this.repo.readSession(input.sessionId));
        const hookInput = (input.snapshot ?? await this.repo.readSession(input.sessionId)).metadata.input;
        for (const hook of hooks) {
            if (hook.builtin && !this.isExecutableBuiltinHook(hook.name)) {
                continue;
            }
            const hookResult = await hook.run({
                stage: input.stage,
                sessionId: input.sessionId,
                invocationId: input.invocationId,
                profileKey: input.profile.manifest.key,
                input: hookInput,
                session: this.createRuntimeSessionFacade({
                    sessionId: input.sessionId,
                    profileKey: input.profile.manifest.key,
                    input: hookInput,
                    context,
                }),
                runtimeState: input.runtimeState.get(hook.name),
                turnIndex: input.turnIndex,
                pendingUserMessage: input.pendingUserMessage,
                invocation: {
                    caller: input.caller,
                },
                turn: input.turn,
                runResult: input.runResult,
                modelMessages: input.modelMessages,
            });
            await this.applyRuntimeHookResult({
                ...input,
                activeHookBuiltin: hook.builtin === true,
            }, hook.name, hookResult, result);
        }

        return result;
    }

    /**
     * 第一批只执行已经迁入 hook result 的 built-in hook。
     *
     * 其他 built-in hook 先作为默认 runtime 的结构标记，行为仍由 harness 现有路径提供。
     */
    private isExecutableBuiltinHook(name: string): boolean {
        return name === "builtin.profilePrompt"
            || name === "builtin.sessionContext"
            || name === "builtin.transcriptPersistence"
            || name === "builtin.runtimeOnlyTranscript"
            || name === "builtin.reportResult";
    }

    /**
     * 判断 profile runtime 是否组合了某个内置 hook。
     *
     * 有些默认行为需要在 hook stage 执行前参与 kernel 判定，例如 report_result reminder。
     */
    private hasBuiltinHook(profile: AgentProfile, hookName: string): boolean {
        return Boolean(profile.runtime?.hooks.some((hook) => "stage" in hook && hook.builtin && hook.name === hookName));
    }

    /**
     * 创建 runtime hook 可用的只读 session facade。
     *
     * 这里刻意不暴露 append/publish/enqueue；写入必须由 hook 返回 SessionWritePlan。
     */
    private createRuntimeSessionFacade(input: {
        sessionId: number;
        profileKey: string;
        input: JsonValue;
        context: NeuroSessionContext;
    }): RuntimeSessionFacade {
        return {
            ...input.context,
            read: async (sessionId = input.sessionId) => {
                const snapshot = await this.repo.readSession(sessionId);
                return {
                    snapshot,
                    context: this.repo.reduce(snapshot),
                };
            },
            agentDialogueContent: async (contentInput = {}) => {
                const snapshot = contentInput.snapshot ?? await this.repo.readSession(contentInput.sessionId ?? input.sessionId);
                return buildAgentDialogueContent({
                    repo: this.repo,
                    snapshot,
                    summarizerProfileKey: contentInput.profileKey ?? input.profileKey,
                    summarizerInput: contentInput.input ?? input.input,
                });
            },
        };
    }

    /**
     * 归并单个 hook result，并执行 hook 返回的 session write plans。
     */
    private async applyRuntimeHookResult(input: RuntimeHookExecutionInput, hookName: string, hookResult: AgentRuntimeHookResult, result: RuntimeHookExecutionResult): Promise<void> {
        if (hookResult.runtimeState !== undefined) {
            input.runtimeState.set(hookName, mergeRuntimeState(input.runtimeState.get(hookName), hookResult.runtimeState));
        }
        if (hookResult.runtimeMessages?.length) {
            if (input.stage !== "prepareRun" && input.stage !== "prepareNextTurn") {
                throw new Error(`runtime hook ${hookName} 的 runtimeMessages 只能在 prepareRun 或 prepareNextTurn stage 返回。`);
            }
            result.runtimeMessages.push(...hookResult.runtimeMessages);
        }
        if (hookResult.turnSnapshotPatch?.requestOptions) {
            result.requestOptionsPatch = {
                ...result.requestOptionsPatch,
                ...hookResult.turnSnapshotPatch.requestOptions,
            };
        }
        if (hookResult.turnSnapshotPatch?.toolKeys) {
            result.toolKeysPatch = hookResult.turnSnapshotPatch.toolKeys;
        }
        if (hookResult.transcript) {
            if (input.stage !== "ingestTurn") {
                throw new Error(`runtime hook ${hookName} 的 transcript 只能在 ingestTurn stage 返回。`);
            }
            result.transcript = hookResult.transcript;
        }
        if (hookResult.builtinBehavior?.reportResultReminder !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.reportResultReminder = hookResult.builtinBehavior.reportResultReminder;
        }
        if (hookResult.builtinBehavior?.profilePrompt !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.profilePrompt = hookResult.builtinBehavior.profilePrompt;
        }
        if (hookResult.builtinBehavior?.sessionContext !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.sessionContext = hookResult.builtinBehavior.sessionContext;
        }
        if (hookResult.writePlans?.length) {
            await this.writeExecutor.execute(hookResult.writePlans, input.invocationId);
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
        if (waiting && missing.length === 1 && missing[0]?.id === waiting.toolCallId && missing[0].name === waiting.toolName) {
            return;
        }
        throw new Error(`turn 存在未闭合 tool call，拒绝写入 session：${missing.map((toolCall) => toolCall.name).join(", ")}`);
    }

    private assertNoUnclosedToolCallsForModel(messages: AgentMessage[], approvalToolKeys: readonly string[]): void {
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
        const approvalToolKeySet = new Set(approvalToolKeys);
        const ordinaryToolCalls = pendingToolCalls.filter((toolCall) => !approvalToolKeySet.has(toolCall.name));
        if (ordinaryToolCalls.length > 0) {
            throw new Error(`当前 session 存在未闭合普通 tool call，不能继续发送给模型：${ordinaryToolCalls.map((toolCall) => toolCall.name).join(", ")}。请切换到干净分支或运行显式 session repair。`);
        }
        throw new Error("当前 session 正在等待用户审批或回答，请先完成 pending approval resolution。");
    }

    private async runSidecarPasses(input: {
        stage: SidecarProfilePassStage;
        sidecarRun: SidecarRunContext;
        applyRuntimeMessages?: (messages: AgentMessage[]) => void;
        applyPersistedContext?: (update: {snapshot: SessionSnapshot; context: NeuroSessionContext}) => void;
    }): Promise<AppliedSidecarMerge> {
        const applied: AppliedSidecarMerge = {
            persistedMessagesWritten: false,
            runtimeMessagesInjected: false,
        };
        const passes = (input.sidecarRun.profile.sidecars ?? []).filter((pass) => pass.stage === input.stage);
        for (const pass of passes) {
            const mergePlan = await this.runSidecarPass(pass, input.sidecarRun);
            this.validateSidecarMergePlan(input.stage, pass.name, mergePlan);
            if (mergePlan.persistedMessages?.length) {
                await this.executeWritePlan({
                    target: {sessionId: input.sidecarRun.sessionId},
                    cause: `sidecar.${pass.name}.persistedMessages`,
                    ops: [{
                        kind: "appendMany",
                        entries: mergePlan.persistedMessages.map((message) => ({
                            type: "message" as const,
                            message,
                            origin: "harness" as const,
                        })),
                    }],
                }, input.sidecarRun.invocationId);
                const snapshot = await this.repo.readSession(input.sidecarRun.sessionId, input.sidecarRun.snapshot.metadata.workspaceKey);
                const context = this.repo.reduce(snapshot);
                input.sidecarRun.snapshot = snapshot;
                input.sidecarRun.context = context;
                input.sidecarRun.messages = context.messages;
                input.applyPersistedContext?.({snapshot, context});
                applied.persistedMessagesWritten = true;
            }
            if (mergePlan.runtimeMessages?.length) {
                input.applyRuntimeMessages?.(mergePlan.runtimeMessages);
                input.sidecarRun.messages.push(...mergePlan.runtimeMessages);
                applied.runtimeMessagesInjected = true;
            }
            if (input.stage === "prepareRun" && (mergePlan.persistedMessages?.length || mergePlan.runtimeMessages?.length)) {
                this.assertSidecarInjectedContextWithinWindow(pass.name, input.sidecarRun);
            }
            if (mergePlan.runtimeState !== undefined) {
                input.sidecarRun.runtimeState.set(`sidecar.${pass.name}`, mergeRuntimeState(input.sidecarRun.runtimeState.get(`sidecar.${pass.name}`), mergePlan.runtimeState));
            }
            if (mergePlan.writePlans?.length) {
                await this.writeExecutor.execute(mergePlan.writePlans, input.sidecarRun.invocationId);
            }
        }
        return applied;
    }

    private async runSidecarPass(pass: SidecarProfilePass, sidecarRun: SidecarRunContext): Promise<SidecarMergePlan> {
        const context = this.createSidecarContext(pass, sidecarRun);
        const executionToolKeys = [...pass.toolKeys ?? sidecarRun.toolKeys];
        const sidecarReminder = createUserMessage({
            text: this.sidecarReminder(pass, context, executionToolKeys),
        });
        const parentLeafId = sidecarRun.snapshot.leafId ?? null;
        const sidecarLeafId = await this.appendSidecarEnterMessage(pass.name, sidecarRun, sidecarReminder, parentLeafId);
        const result = await this.runLoop({
            sessionId: sidecarRun.sessionId,
            workspaceKey: sidecarRun.snapshot.metadata.workspaceKey,
            workspaceRoot: sidecarRun.context.workspaceRoot,
            projectPath: sidecarRun.context.projectPath,
            systemPrompt: sidecarRun.systemPrompt,
            messages: [
                ...sidecarRun.messages,
                sidecarReminder,
            ],
            model: sidecarRun.model,
            apiKey: sidecarRun.apiKey,
            timeoutMs: sidecarRun.timeoutMs,
            requestOptions: sidecarRun.requestOptions,
            compaction: sidecarRun.compaction,
            sessionContextEnabled: false,
            toolKeys: sidecarRun.toolKeys,
            executionToolKeys,
            profileKey: sidecarRun.context.profileKey,
            profile: sidecarRun.profile,
            thinkingLevel: sidecarRun.thinkingLevel,
            runtimeState: new Map(sidecarRun.runtimeState),
            reportResultReminderEnabled: executionToolKeys.includes("report_sidecar_result"),
            caller: {
                kind: "sidecar",
                sessionId: sidecarRun.sessionId,
                profileKey: sidecarRun.context.profileKey,
            },
            abortSignal: sidecarRun.abortSignal,
            invocationId: sidecarRun.invocationId,
            forcePersistTranscript: true,
            transcriptParentLeafId: sidecarLeafId,
            restoreLeafAfterTranscript: true,
            restoreLeafIdAfterTranscript: parentLeafId,
            suppressEvents: true,
            disableSteer: true,
            disableAutomaticCompaction: true,
            activeSidecar: {
                name: pass.name,
                sidecarDataSchema: pass.sidecarDataSchema,
            },
        });
        if (result.status === "failed") {
            throw new Error(`sidecar ${pass.name} 执行失败：${result.errorInfo.message}`);
        }
        if (result.status === "waiting") {
            throw new Error(`sidecar ${pass.name} 进入 waiting 状态；V1 sidecar 不支持用户审批或回答。`);
        }
        const sidecarResult = this.readSidecarResult(pass, result);
        return await pass.merge(context, sidecarResult);
    }

    private async appendSidecarEnterMessage(passName: string, sidecarRun: SidecarRunContext, message: Message, parentLeafId: SessionEntryId | null): Promise<SessionEntryId | null> {
        const result = await this.writeExecutor.execute([{
            target: {sessionId: sidecarRun.sessionId},
            cause: `sidecar.${passName}.enter`,
            ops: [{
                kind: "appendMany",
                entries: [{
                    type: "message",
                    message,
                    origin: "harness",
                    parentId: parentLeafId,
                }],
            }],
        }], sidecarRun.invocationId);
        await this.writeExecutor.execute([{
            target: {sessionId: sidecarRun.sessionId},
            cause: `sidecar.${passName}.restoreLeaf`,
            ops: [{
                kind: "moveLeaf",
                leafId: parentLeafId,
            }],
        }], sidecarRun.invocationId);
        return result.entries.findLast((entry) => entry.type === "message")?.id ?? parentLeafId;
    }

    private validateSidecarMergePlan(stage: SidecarProfilePassStage, passName: string, mergePlan: SidecarMergePlan): void {
        if (mergePlan.runtimeMessages?.length && stage !== "prepareRun") {
            throw new Error(`sidecar ${passName} 的 runtimeMessages 只能在 prepareRun 阶段注入主 run。`);
        }
        for (const message of mergePlan.persistedMessages ?? []) {
            if (message.role !== "user") {
                throw new Error(`sidecar ${passName} 的 persistedMessages 第一版只允许 user message。`);
            }
        }
    }

    private assertSidecarInjectedContextWithinWindow(passName: string, frame: Pick<RunFrame, "messages" | "model">): void {
        const usage = estimateContextTokens(frame.messages);
        if (usage.tokens <= frame.model.contextWindow) {
            return;
        }
        throw new Error(`sidecar ${passName} 注入后上下文 ${usage.tokens} tokens 已超过模型 ${frame.model.id} 的 ${frame.model.contextWindow} token 限制。`);
    }

    private createSidecarContext(pass: SidecarProfilePass, sidecarRun: SidecarRunContext): SidecarContext {
        return {
            name: pass.name,
            stage: pass.stage,
            sessionId: sidecarRun.sessionId,
            session: this.createRuntimeSessionFacade({
                sessionId: sidecarRun.sessionId,
                profileKey: sidecarRun.context.profileKey,
                input: sidecarRun.snapshot.metadata.input,
                context: sidecarRun.context,
            }),
            input: sidecarRun.snapshot.metadata.input,
            invocationId: sidecarRun.invocationId,
            profileKey: sidecarRun.context.profileKey,
            caller: {
                kind: "sidecar",
                sessionId: sidecarRun.sessionId,
                profileKey: sidecarRun.context.profileKey,
            },
            runResult: sidecarRun.runResult && sidecarRun.finalResult ? {
                status: sidecarRun.finalResult.status === "waiting" ? "waiting" : "completed",
                finalMessage: sidecarRun.finalResult.finalMessage,
                reportResult: sidecarRun.runResult.status === "failed" ? undefined : sidecarRun.runResult.reportResult,
            } : undefined,
        };
    }

    private sidecarReminder(pass: SidecarProfilePass, context: SidecarContext, executionToolKeys: readonly string[]): string {
        const enterPrompt = typeof pass.enterPrompt === "function" ? pass.enterPrompt(context) : pass.enterPrompt;
        const schemaText = pass.sidecarDataSchema
            ? JSON.stringify(pass.sidecarDataSchema, null, 2)
            : "未声明 sidecarDataSchema；当前旁路不应使用 report_sidecar_result。";
        const dataExampleText = this.sidecarReportDataExample(pass);
        const resultInstructions = executionToolKeys.includes("report_sidecar_result")
            ? [
                `完成旁路后优先调用 report_sidecar_result，并把旁路结果数据放在 report_sidecar_result.data["${pass.name}"]；不要调用 report_result，也不要使用旧 sidecar_data 字段。`,
                ...this.sidecarDataFormatInstructions(pass),
                "report_sidecar_result.data 必须直接传对象，不要传 JSON 字符串。期望结构：",
                dataExampleText,
                `report_sidecar_result.data["${pass.name}"] 的 schema：`,
                schemaText,
            ]
            : [
                pass.outputFallback === "parse_final_message_json"
                    ? "当前旁路未开放 report_sidecar_result；完成后直接用最终 assistant 文本返回可被 JSON.parse 的旁路结果，不要调用 report_result 或 report_sidecar_result。"
                    : "当前旁路未开放 report_sidecar_result；完成后直接用最终 assistant 文本返回旁路结果，不要调用 report_result 或 report_sidecar_result。",
                ...this.sidecarDataFormatInstructions(pass, pass.outputFallback === "parse_final_message_json" ? "最终 assistant 文本解析后的 JSON" : "最终 assistant 文本"),
                "旁路结果期望结构：",
                schemaText,
            ];
        return [
            "<system-reminder>",
            "当前处于 Sidecar Profile Pass 旁路阶段，不是主扮演、主写作或主任务阶段。",
            `sidecar: ${pass.name}`,
            `stage: ${pass.stage}`,
            `allowed tools: ${executionToolKeys.length ? executionToolKeys.join(", ") : "(none)"}`,
            "旁路 transcript 会写入 session tree 的旁路分支供审计，但不会成为主 active path；主 run 只能看到 merge 后注入的结果。",
            "provider-visible tool schema 仍保持 profile 最大工具集合；但本旁路阶段只有 allowed tools 列出的工具允许实际执行。",
            ...resultInstructions,
            "</system-reminder>",
            "",
            enterPrompt,
        ].join("\n");
    }

    private sidecarReportDataExample(pass: SidecarProfilePass): string {
        const schemaType = sidecarSchemaType(pass);
        if (schemaType === "string") {
            return JSON.stringify({[pass.name]: "旁路结果正文"}, null, 2);
        }
        if (schemaType === "object" && isEmptyObjectSchema(pass.sidecarDataSchema)) {
            return JSON.stringify({[pass.name]: {}}, null, 2);
        }
        if (schemaType === "object") {
            return [
                "{",
                `  "${pass.name}": <按下方 schema 填写的 JSON object>`,
                "}",
            ].join("\n");
        }
        return [
            "{",
            `  "${pass.name}": <按下方 schema 填写>`,
            "}",
        ].join("\n");
    }

    private sidecarDataFormatInstructions(pass: SidecarProfilePass, key = "report_sidecar_result.data"): string[] {
        const schemaType = sidecarSchemaType(pass);
        const usesReportEnvelope = key === "report_sidecar_result.data";
        if (schemaType === "string") {
            return usesReportEnvelope
                ? [
                    `${key} 必须是对象 { "${pass.name}": "..." }，"${pass.name}" 的值必须直接是字符串正文；不要返回 JSON.stringify 后的对象文本。`,
                ]
                : [
                    `${key} 必须直接是字符串正文；不要返回 JSON.stringify 后的对象文本。`,
                ];
        }
        if (schemaType === "object") {
            return usesReportEnvelope
                ? [
                    `${key} 必须是对象 { "${pass.name}": {...} }，"${pass.name}" 的值必须直接是 JSON object；不要把对象包成字符串。`,
                    `${key}["${pass.name}"] 里不要复制 schema 的 type / required / properties 外壳。`,
                ]
                : [
                    `${key} 必须直接是 JSON object；不要把对象包成字符串。`,
                    `${key} 里不要复制 schema 的 type / required / properties 外壳。`,
                ];
        }
        return [];
    }

    private readSidecarResult(pass: SidecarProfilePass, result: RunLoopResult): SidecarResult {
        if (result.status !== "completed") {
            throw new Error(`sidecar ${pass.name} 未完成。`);
        }
        const report = result.sidecarResult;
        if (report && "data" in report) {
            return {
                result: report.result,
                sidecarData: this.extractSidecarData(pass, report.data),
            };
        }
        if (!pass.outputFallback) {
            throw new Error(`sidecar ${pass.name} 没有返回 report_sidecar_result.data。`);
        }
        const finalText = result.finalAssistant ? messageText(result.finalAssistant) : "";
        const fallbackData = pass.outputFallback === "parse_final_message_json"
            ? parseSidecarFinalJson(pass.name, finalText)
            : finalText;
        const sidecarData = this.normalizeSidecarData(pass, fallbackData);
        return {
            result: finalText,
            sidecarData,
        };
    }

    private extractSidecarData(pass: SidecarProfilePass, value: unknown): JsonValue {
        if (typeof value === "string") {
            throw new Error(`sidecar ${pass.name} report_sidecar_result.data 校验失败：收到的是字符串；请直接传对象 data: { "${pass.name}": ... }，不要传 JSON.stringify 后的文本。`);
        }
        if (!isRecord(value)) {
            throw new Error(`sidecar ${pass.name} report_sidecar_result.data 校验失败：必须是对象 { "${pass.name}": ... }。`);
        }
        const dataKeys = Object.keys(value);
        if (dataKeys.length !== 1) {
            throw new Error(`sidecar ${pass.name} report_sidecar_result.data 校验失败：只能包含一个 sidecar key，当前应为 "${pass.name}"。`);
        }
        if (!hasOwn(value, pass.name)) {
            throw new Error(`sidecar ${pass.name} report_sidecar_result.data 校验失败：只能包含当前 sidecar key "${pass.name}"。`);
        }
        return this.normalizeSidecarData(pass, value[pass.name]);
    }

    private normalizeSidecarData(pass: SidecarProfilePass, value: unknown): JsonValue {
        if (!pass.sidecarDataSchema) {
            return value as JsonValue;
        }
        try {
            return Value.Parse(pass.sidecarDataSchema, value) as JsonValue;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`sidecar ${pass.name} report_sidecar_result.data["${pass.name}"] 校验失败：${message}`);
        }
    }

    private readReportResult(details: unknown): InvokeAgentResult["reportResult"] | undefined {
        if (!details || typeof details !== "object" || !("result" in details) || typeof (details as {result?: unknown}).result !== "string") {
            return undefined;
        }
        const report = details as {result: string; data?: unknown};
        return {
            result: report.result,
            ...("data" in report ? {data: report.data} : {}),
        };
    }

    private readSidecarToolResult(details: unknown): RunToolBatchResult["sidecarResult"] | undefined {
        if (!details || typeof details !== "object" || !("result" in details) || typeof (details as {result?: unknown}).result !== "string") {
            return undefined;
        }
        const report = details as {result: string; data?: unknown};
        return {
            result: report.result,
            ...("data" in report ? {data: report.data} : {}),
        };
    }

    /**
     * 根据当前 profile 派生模型可见工具 schema 与执行校验。
     */
    private async toolOverrides(toolKeys: readonly string[], profileKey: string, activeSidecar?: ActiveSidecarRun): Promise<Record<string, NeuroAgentTool>> {
        const profile = await this.profiles.get(profileKey);
        const overrides: Record<string, NeuroAgentTool> = {};
        for (const toolKey of toolKeys) {
            const binding = profile.tools[toolKey];
            if (!binding) {
                continue;
            }
            if (toolKey === "report_result") {
                const dataSchema = isReportResultBinding(binding) ? binding.dataSchema ?? profile.outputSchema : profile.outputSchema;
                overrides.report_result = createReportResultTool(reportResultSchemaForProfile(profile), {
                    dataSchema: isEmptyObjectSchema(dataSchema) ? undefined : dataSchema,
                    activeSidecar: activeSidecar ? {name: activeSidecar.name} : undefined,
                });
                continue;
            }
            if (toolKey === "report_sidecar_result") {
                overrides.report_sidecar_result = createReportSidecarResultTool(reportSidecarResultSchemaForProfile(profile), {
                    activeSidecar,
                });
                continue;
            }
            const resolvedTool = this.resolveProfileTool(profile, toolKey);
            if (!resolvedTool) {
                continue;
            }
            if (isAgentToolDefinition(binding)) {
                overrides[toolKey] = resolvedTool;
                continue;
            }
            if (binding.definition || binding.parameters || binding.validationSchema || binding.description) {
                overrides[toolKey] = resolvedTool;
            }
        }
        return overrides;
    }

    private async approvalToolKeysForSnapshot(snapshot: SessionSnapshot, profile?: AgentProfile | null): Promise<string[]> {
        if (profile) {
            return this.approvalToolKeysForProfile(profile);
        }
        const runtime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
        if (runtime.profile) {
            return this.approvalToolKeysForProfile(runtime.profile);
        }
        return this.tools.approvalToolKeys();
    }

    private approvalToolKeysForProfile(profile: AgentProfile): string[] {
        const keys = new Set(this.tools.approvalToolKeys());
        for (const toolKey of profile.rootToolKeys) {
            const tool = this.resolveProfileTool(profile, toolKey);
            if (tool?.approvalRequired) {
                keys.add(tool.key);
            }
        }
        return [...keys].sort((left, right) => left.localeCompare(right));
    }

    private resolveProfileTool(profile: AgentProfile, toolKey: string): NeuroAgentTool | undefined {
        const binding = profile.tools[toolKey];
        if (!binding) {
            return this.tools.get(toolKey);
        }
        if (isAgentToolDefinition(binding)) {
            return binding.runtime();
        }
        const baseTool = binding.definition
            ? binding.definition.runtime(binding)
            : this.tools.get(toolKey);
        if (!baseTool) {
            return undefined;
        }
        if (!binding.parameters && !binding.validationSchema && !binding.description) {
            return baseTool;
        }
        return {
            ...baseTool,
            parameters: binding.parameters ?? baseTool.parameters,
            validationSchema: binding.validationSchema ?? baseTool.validationSchema,
            description: binding.description ?? baseTool.description,
        };
    }

}

function estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function isResultToolName(toolName: string): toolName is "report_result" | "report_sidecar_result" {
    return toolName === "report_result" || toolName === "report_sidecar_result";
}

function isReportResultBinding(binding: ProfileToolBinding | undefined): binding is ReportResultToolBinding {
    return Boolean(binding && typeof binding === "object" && binding.key === "report_result" && "dataSchema" in binding);
}

function sidecarSchemaType(pass: SidecarProfilePass): string | undefined {
    const schema = pass.sidecarDataSchema;
    if (!schema || typeof schema !== "object" || !("type" in schema)) {
        return undefined;
    }
    return typeof schema.type === "string" ? schema.type : undefined;
}

function stableJsonHash(value: JsonValue): string {
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

function parseSidecarFinalJson(sidecarName: string, text: string): JsonValue {
    try {
        return JSON.parse(text) as JsonValue;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`sidecar ${sidecarName} final message 不是合法 JSON：${message}`);
    }
}

function isFollowUpQueueItem(value: unknown): value is AgentFollowUpQueueItemDto {
    if (!isRecord(value)) {
        return false;
    }
    const message = value.message;
    return typeof value.id === "string"
        && value.kind === "followup"
        && typeof value.createdAt === "number"
        && isRecord(message)
        && typeof message.text === "string";
}

/**
 * 合并同名 hook 在同一次 invocation 内返回的 runtimeState。
 *
 * 对象做浅合并，非对象按后一次返回替换，避免把数组/字符串误当 patch。
 */
function mergeRuntimeState(previous: JsonValue | undefined, next: JsonValue): JsonValue {
    if (isRecord(previous) && isRecord(next)) {
        return {
            ...previous,
            ...next,
        };
    }
    return next;
}

async function loadEffectiveConfig(input: {workspaceRoot?: string; projectPath?: string}): Promise<EffectiveConfig> {
    const {loadEffectiveConfigForAgentRuntime} = await import("nbook/server/config/config-service");
    return loadEffectiveConfigForAgentRuntime(input);
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
