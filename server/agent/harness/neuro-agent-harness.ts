import {createHash, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import type {AgentEvent, AgentToolResult} from "@earendil-works/pi-agent-core";
import {streamSimple, validateToolArguments} from "@earendil-works/pi-ai";
import type {AgentMessage, AgentToolCall, AgentUserMessageInput, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createTextToolResult, createToolResultFromResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {summarizerProfile} from "nbook/server/agent/profiles/summarizer-profile";
import type {AgentProfile, ProfileCompactionPlan, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
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
import {createBuiltinTools, createReportResultTool} from "nbook/server/agent/tools/builtin-tools";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {AgentResolution, NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {appendCompaction, compactIfNeeded} from "nbook/server/agent/harness/compaction";
import type {
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
import {createRunFrame} from "nbook/server/agent/harness/run-frame-state";
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
    AgentFollowUpQueueStateDto,
    AgentFollowUpQueueItemDto,
    AgentLinkedSessionDto,
    AgentPendingApprovalDto,
    AgentSessionEventDto,
    AgentSessionListQueryDto,
    AgentSessionSummarizerStateDto,
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

type HarnessOptions = {
    repo?: JsonlSessionRepository;
    profiles?: AgentProfileCatalog;
    skills?: SkillCatalog;
    tools?: AgentToolRegistry;
    modelResolver?: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    eventHub?: AgentSessionEventHub;
    /** 测试可关闭后台 summarizer，避免 fire-and-forget 消耗 faux provider 响应；生产默认开启。 */
    enableSessionSummarizer?: boolean;
};

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
    toolKeys: string[];
    thinkingLevel: ThinkingLevel;
    reportResultReminderEnabled: boolean;
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
    private readonly enableSessionSummarizer: boolean;
    private readonly activeInvocations = new Map<number, AgentActiveInvocationDto>();
    private readonly steerableSessions = new Set<number>();
    private readonly steerQueues = new Map<number, AgentFollowUpQueueItemDto[]>();
    private readonly followUpQueues = new Map<number, AgentFollowUpQueueStateDto>();
    private readonly abortControllers = new Map<number, AbortController>();
    private readonly invocationClientStates = new Map<string, ClientStateSnapshot | undefined>();
    private readonly invocationVariableStates = new Map<string, VariableInvocationState>();
    private readonly invocationRuntimeStates = new Map<string, RunRuntimeState>();
    private readonly summarizerRuns = new Map<number, SessionSummarizerJob>();
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
            snapshotProvider: (sessionId) => this.getSessionSnapshot(sessionId),
        });
        this.modelResolver = options.modelResolver ?? resolvePiModelFromConfig;
        this.enableSessionSummarizer = options.enableSessionSummarizer ?? true;
        this.profiles.register(defaultAgentProfile);
        this.profiles.register(summarizerProfile);
        for (const tool of createBuiltinTools(this)) {
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
        const currentInvocation = this.activeInvocations.get(input.sessionId);
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
                    sessionId: input.sessionId,
                    invocationId,
                    status: "waiting",
                    finalMessage: `steer queued: ${item.id}`,
                    queuedItem: item,
                    events: [],
                };
            }
            if ((input.mode === "prompt" || input.mode === "followup") && input.message) {
                const item = await this.enqueueFollowUp(input.sessionId, input.message);
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
        if (!isResume) {
            await this.writeLifecycle(input.sessionId, invocationId, "start");
        }

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

            const preparedRun = await this.prepareRun({
                sessionId: input.sessionId,
                invocationId,
                snapshot,
                pendingResolution,
                pendingUserMessage,
                clientState: input.clientState,
                runtimeState,
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
                toolKeys: preparedRun.toolKeys,
                profileKey: preparedRun.context.profileKey,
                profile: preparedRun.profile,
                thinkingLevel: preparedRun.thinkingLevel,
                runtimeState,
                reportResultReminderEnabled: preparedRun.reportResultReminderEnabled,
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
                runtimeState,
                runResult: result,
                finalResult,
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
                events: result.events,
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
     * 处理 accepted invocation 的正常 terminal：settleRun、terminal lifecycle、queue policy 和 cleanup。
     */
    private async completeInvocation(input: {
        sessionId: number;
        invocationId: string;
        profile: AgentProfile;
        runtimeState: RunRuntimeState;
        runResult: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
        finalResult: InvokeAgentResult;
    }): Promise<void> {
        if (input.finalResult.status !== "error") {
            await this.settleRun({
                sessionId: input.sessionId,
                invocationId: input.invocationId,
                profile: input.profile,
                runtimeState: input.runtimeState,
                status: input.finalResult.status,
                result: input.runResult,
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
            events: [],
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
        });

        snapshot = await this.repo.readSession(input.sessionId);
        const prepared = await this.prepare(snapshot, {
            invocationId: input.invocationId,
            pendingUserMessage: input.pendingUserMessage ?? undefined,
            clientState: input.clientState,
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
        const toolKeys = [...runProfile.allowedToolKeys];
        const thinkingLevel = this.resolveThinkingLevel(context, config, model);
        const systemPrompt = prepareRunHooks.profilePrompt ? prepared.plan.systemPrompt ?? context.systemPrompt : context.systemPrompt;
        const preparedModelContextMessages = prepareRunHooks.sessionContext === true ? prepared.plan.modelContextMessages ?? [] : [];
        const messages = [
            ...context.messages,
            ...prepareRunHooks.runtimeMessages,
            ...preparedModelContextMessages,
        ];
        this.assertNoUnclosedToolCallsForModel(messages);

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
            compaction: prepared.plan.compaction,
            toolKeys,
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
        const summarizer = this.sessionSummarizerStateDto(context);
        const followUpQueue = this.followUpQueueState(sessionId, context);

        return {
            summary: {
                ...this.repo.summary(snapshot),
                status: this.resolveSessionStatus(sessionId, context.archived),
            },
            ...(summarizer ? {summarizer} : {}),
            activeLeafId: snapshot.leafId,
            ...systemPrompt ? {systemPrompt} : {},
            messages: context.messages,
            tree: this.repo.tree(snapshot),
            entries: this.repo.activePath(snapshot),
            linkedAgents,
            linkedByAgents,
            pendingApproval: pendingApproval ? await this.pendingApprovalDto(snapshot, pendingApproval) : null,
            steerQueue: this.steerQueues.get(sessionId) ?? [],
            followUpQueue,
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
        if (!this.hasBuiltinHook(profile, "builtin.profilePrompt")) {
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
                            value: this.planModeState(snapshot, context, active, active ? "full" : "sparse", "ui_plan_toggle"),
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
        const active = this.activeInvocations.get(sessionId);
        if (!active) {
            return {
                status: "idle",
                sessionId,
            };
        }
        if (active.status === "waiting") {
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
                status: "aborted",
                sessionId,
            };
        }
        active.status = "aborting";
        this.steerableSessions.delete(sessionId);
        this.abortControllers.get(sessionId)?.abort(body.reason);
        if (body.clearQueue ?? true) {
            this.steerQueues.delete(sessionId);
            await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
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

    private async appendAbortResolution(sessionId: number, invocationId: string, reason?: string): Promise<void> {
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const messages = context.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        const pending = findPendingApprovalCall(messages, this.tools.approvalToolKeys());
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

    private async prepare(snapshot: SessionSnapshot, options: {
        invocationId?: string;
        pendingUserMessage?: Message;
        clientState?: ClientStateSnapshot;
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

    private async prepareCompactionPolicy(profile: AgentProfile, snapshot: SessionSnapshot, context: ReturnType<JsonlSessionRepository["reduce"]>): Promise<ProfileCompactionPlan | undefined> {
        if (!profile.prepare) {
            return undefined;
        }
        const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
        const session = this.createRuntimeSessionFacade({
            sessionId: snapshot.metadata.sessionId,
            profileKey: profile.manifest.key,
            input: parsedInput,
            context,
        });
        const vars = await this.createProfileVariableAccessor(snapshot, profile, {dryRun: true});
        const prepared = await profile.prepare({
            session,
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
        const pending = findPendingApprovalCall(messages, this.tools.approvalToolKeys());
        if (!pending) {
            throw new Error("当前 session 没有等待中的审批 tool call");
        }
        await this.executeWritePlan({
            target: {sessionId: snapshot.metadata.sessionId},
            cause: "resolution",
            durability: "savePoint",
            ops: [{
                kind: "append",
                entry: {
                    type: "message",
                    message: resolutionToToolResult(resolution, pending),
                    origin: "harness",
                },
            }],
        }, invocationId);
        if (resolution.kind === "tool_approval" && (pending.toolName === "enter_plan_mode" || pending.toolName === "exit_plan_mode")) {
            await this.appendPlanModeResolution(snapshot, context, pending, resolution.approved, invocationId);
        }
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
        toolKeys: string[];
        profileKey: string;
        profile: AgentProfile;
        thinkingLevel: ThinkingLevel;
        runtimeState: RunRuntimeState;
        reportResultReminderEnabled: boolean;
        abortSignal?: AbortSignal;
        invocationId?: string;
        onEvent?: (event: AgentEvent) => void | Promise<void>;
    }): Promise<RunLoopResult> {
        const frame = createRunFrame(input);

        this.assertNoUnclosedToolCallsForModel(frame.messages);
        await this.emitFrameEvent(frame, {type: "agent_start"});
        let shouldContinue = true;
        let failedResult: RunLoopResult | undefined;
        while (shouldContinue) {
            const transaction = await this.runTurnTransaction(frame);
            if (transaction.kind === "failed") {
                failedResult = transaction.result;
                break;
            }
            if (transaction.kind === "waiting") {
                await this.emitFrameEvent(frame, {type: "agent_end", messages: frame.messages});
                return transaction.result;
            }
            shouldContinue = transaction.shouldContinue;
        }
        this.steerableSessions.delete(frame.sessionId);
        await this.emitFrameEvent(frame, {type: "agent_end", messages: frame.messages});
        if (failedResult) {
            return {
                ...failedResult,
                events: frame.events,
            };
        }
        return {
            status: "completed",
            events: frame.events,
            finalAssistant: frame.finalAssistant,
            reportResult: frame.reportResult,
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
        await this.emitFrameEvent(frame, {type: "turn_start"});
        const preModelSteers = await this.drainSteers({
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
            this.steerableSessions.delete(frame.sessionId);
            const failedIngestDraft = createFailedTurnIngestDraft(outcome);
            const ingest = failedIngestDraft ? await withRunKernelPhase("ingest", () => this.ingestTurn(frame, failedIngestDraft)) : undefined;
            const transaction = applyFailedTurnTransaction(frame, outcome, ingest);
            await this.emitFrameEvent(frame, {type: "turn_end", message: outcome.finalAssistant, toolResults: []});
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
        if (!turn.waiting) {
            this.steerableSessions.delete(frame.sessionId);
        }
        await this.emitFrameEvent(frame, {type: "turn_end", message: turn.assistant, toolResults: turn.toolResults});
        if (transaction.kind === "waiting") {
            return {
                kind: "waiting",
                result: transaction.result,
            };
        }

        const continuation = await this.resolveTurnContinuation(frame, transaction.turn);
        await this.prepareNextTurn(frame, turn, continuation);
        if (continuation.continue) {
            this.steerableSessions.add(frame.sessionId);
        }
        return {
            kind: "next",
            shouldContinue: continuation.continue,
        };
    }

    /**
     * 发布 PI event，并记录到当前 RunFrame。
     */
    private async emitFrameEvent(frame: RunFrame, event: AgentEvent): Promise<void> {
        frame.events.push(event);
        await frame.onEvent?.(event);
        this.publishPiEvent(frame.sessionId, frame.invocationId, event);
    }

    /**
     * 创建本轮 provider 请求的冻结快照。
     */
    private async createTurnSnapshot(frame: RunFrame): Promise<TurnSnapshot> {
        const snapshot = await this.repo.readSession(frame.sessionId, frame.workspaceKey);
        const context = this.repo.reduce(snapshot);
        const prepareTurn = await this.runRuntimeHooks({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId ?? "",
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            stage: "prepareTurn",
            snapshot,
            context,
            turnIndex: frame.turnIndex,
            modelMessages: frame.messages,
        });
        const requestOptions = {
            ...frame.requestOptions,
            ...prepareTurn.requestOptionsPatch,
        };
        const toolKeys = prepareTurn.toolKeysPatch ?? frame.toolKeys;
        const toolOverrides = await this.toolOverrides(toolKeys, frame.profileKey);
        const tools = this.tools.allowedWithOverrides(toolKeys, toolOverrides);
        const providerMessages = frame.messages.filter((message): message is Message => {
            return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
        });
        return {
            index: frame.turnIndex,
            sessionSnapshot: snapshot,
            sessionContext: context,
            systemPrompt: frame.systemPrompt,
            modelMessages: frame.messages.slice(),
            providerMessages,
            model: frame.model,
            apiKey: frame.apiKey,
            timeoutMs: frame.timeoutMs,
            requestOptions,
            toolKeys,
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
                invocationId: frame.invocationId,
                assistant,
                toolCalls,
                allowedToolKeys: snapshot.toolKeys,
                toolOverrides: snapshot.toolOverrides,
                enqueueSavePointWrite: (plan) => {
                    frame.pendingWritePlans.push(plan);
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
            turnIndex: frame.turnIndex,
            pendingWritePlans: frame.pendingWritePlans,
        });
    }

    /**
     * 在本轮 save point 后判断是否需要继续同一个 run。
     *
     * steer 在这里被 drain 成模型可见消息；真正为下一轮补充材料的动作放到 prepareNextTurn。
     */
    private async resolveTurnContinuation(frame: RunFrame, turn: RuntimeTurn): Promise<TurnContinuationDecision> {
        const steeredMessages = await this.drainSteers({
            sessionId: frame.sessionId,
            workspaceKey: frame.workspaceKey,
            invocationId: frame.invocationId,
        });
        return resolveTurnContinuation({
            turn,
            steeredMessages,
            hasReportResult: Boolean(frame.reportResult),
            reportResultReminderSent: frame.reportResultReminderSent,
            reportResultAllowed: frame.reportResultReminderEnabled && frame.toolKeys.includes("report_result"),
        });
    }

    /**
     * 为同一个 run 的下一轮 turn 准备 runtime state 和模型可见消息。
     */
    private async prepareNextTurn(frame: RunFrame, turn: RuntimeTurn, decision: TurnContinuationDecision): Promise<void> {
        const preparation = applyNextTurnPreparation(frame, decision);
        if (preparation.reminderPlan) {
            await withRunKernelPhase("ingest", () => this.executeWritePlan(preparation.reminderPlan!, frame.invocationId));
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
        if (nextTurnHooks.automaticCompaction !== undefined) {
            frame.automaticCompactionEnabled = nextTurnHooks.automaticCompaction;
        }
        const compacted = await withRunKernelPhase("compaction", () => this.compactBeforeNextTurn(frame));
        if (compacted) {
            const compactedSnapshot = await this.repo.readSession(frame.sessionId, frame.workspaceKey);
            frame.messages = this.repo.reduce(compactedSnapshot).messages;
        }
        for (const runtimeMessage of nextTurnHooks.runtimeMessages) {
            frame.messages.push(runtimeMessage);
        }
    }

    private async compactBeforeNextTurn(frame: RunFrame): Promise<boolean> {
        if (!frame.automaticCompactionEnabled) {
            return false;
        }
        return compactIfNeeded({
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
        invocationId?: string;
        assistant: AssistantMessage;
        toolCalls: AgentToolCall[];
        allowedToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        enqueueSavePointWrite?: (plan: SessionWritePlan) => void;
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
                enqueueSavePointWrite: input.enqueueSavePointWrite,
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
        enqueueSavePointWrite?: (plan: SessionWritePlan) => void;
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
                sessionWrites: new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: input.sessionId,
                    invocationId: input.invocationId,
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
        await this.publishSessionState(sessionId, invocationId);
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
        turnIndex: number;
        pendingWritePlans: SessionWritePlan[];
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
            turnIndex: input.turnIndex,
            turn: {
                assistant: input.assistant,
                toolResults: orderedToolResults,
                waiting: input.waiting,
                messageStatus: input.messageStatus,
            },
        });
        const transcript = ingest.transcript ?? "runtime_only";
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
        await this.writeExecutor.execute([transcriptPlan, ...input.pendingWritePlans], input.invocationId);
        input.pendingWritePlans.splice(0, input.pendingWritePlans.length);
        return {transcript: "persist"};
    }

    private async flushPendingWritePlans(plans: SessionWritePlan[], invocationId?: string): Promise<void> {
        if (plans.length === 0) {
            return;
        }
        await this.writeExecutor.execute(plans, invocationId);
        plans.splice(0, plans.length);
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
            || name === "builtin.compact"
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
        if (hookResult.builtinBehavior?.automaticCompaction !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.automaticCompaction = hookResult.builtinBehavior.automaticCompaction;
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
