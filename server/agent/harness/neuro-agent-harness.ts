import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import type {AgentEvent, AgentToolResult} from "@earendil-works/pi-agent-core";
import {streamSimple, validateToolArguments} from "@earendil-works/pi-ai";
import type {AgentMessage, AgentToolCall, AgentUserMessageInput, AssistantMessage, JsonValue, Message, Model, ToolResultMessage} from "nbook/server/agent/messages/types";
import {createTextToolResult, createToolResultFromResult, createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import type {AgentProfile, ProfileCompactionPlan, ProfileIngestResult, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {compileProfileSystemPrompt, profileStateKey, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {AGENT_PLAN_MODE_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {InvocationErrorInfo, InvocationErrorPhase, ModelChangeEntry, NeuroSessionContext, SessionEntry, SessionEntryDraft, SessionEntryId, SessionSnapshot} from "nbook/server/agent/session/types";
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
            workspaceRoot: normalizeAgentWorkspaceRoot(input.workspaceRoot),
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
            const prepared = await this.prepare(snapshot, invocationId, pendingUserMessage ?? undefined);
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
                thinkingLevel: context.thinkingLevel,
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
                novelId: context.novelId,
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
                thinkingLevel: context.thinkingLevel,
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
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
    }): Promise<InvokeAgentResult> {
        const {input: invokeInput, invocationId, snapshot, context, prepared, toolKeys, model, apiKey, result} = input;
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
        const systemPrompt = await this.snapshotSystemPrompt(snapshot, context);

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
            pendingApproval: pendingApproval ? await this.pendingApprovalDto(snapshot, pendingApproval) : null,
            followUpQueue: this.followUpQueues.get(sessionId) ?? [],
            activeInvocation: this.activeInvocations.get(sessionId) ?? null,
            model: context.model,
            planModeActive: context.planModeActive,
            lastSeq: this.eventHub.lastSeq,
            usage: [...context.messages].reverse().find((message) => message.role === "assistant")?.usage,
        };
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
                novelId: snapshot.metadata.novelId,
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

    private async prepare(snapshot: SessionSnapshot, invocationId?: string, pendingUserMessage?: Message): Promise<ProfileTurnPlan> {
        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const context = this.repo.reduce(snapshot);
        const parsedInput = this.profiles.parseInput(profile, snapshot.metadata.input);
        const prepared = await profile.prepare!({
            session: context,
            input: parsedInput as never,
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
        const prepared = await profile.prepare({
            session: context,
            input: parsedInput as never,
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
            const ingest = await profile.ingest({
                session: context,
                input: parsedInput as never,
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
        novelId?: string;
        systemPrompt: string;
        messages: AgentMessage[];
        model: Model<any>;
        apiKey?: string;
        timeoutMs?: number | null;
        requestOptions?: Record<string, JsonValue>;
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
                novelId: input.novelId,
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
        timeoutMs?: number | null;
        requestOptions?: Record<string, JsonValue>;
        tools: ReturnType<AgentToolRegistry["allowed"]>;
        sessionId: number;
        thinkingLevel: string;
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
            reasoning: input.thinkingLevel === "off" ? undefined : input.thinkingLevel as never,
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
        novelId?: string;
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
                novelId: input.novelId,
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
        novelId?: string;
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
                novelId: input.novelId,
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
                thinkingLevel: context.thinkingLevel,
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
            thinkingLevel: string;
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

async function loadEffectiveConfig(input: {workspaceRoot?: string; novelId?: string}): Promise<EffectiveConfig> {
    const {
        loadEffectiveConfig: loadEffectiveConfigByQuery,
        loadEffectiveConfigForWorkspaceRoot,
    } = await import("nbook/server/config/config-service");
    if (input.novelId) {
        return loadEffectiveConfigByQuery({workspaceKind: "novel", novelId: input.novelId});
    }
    return loadEffectiveConfigForWorkspaceRoot(input.workspaceRoot);
}

function normalizeAgentWorkspaceRoot(workspaceRoot: string | undefined): string {
    const normalized = workspaceRoot?.trim().replaceAll("\\", "/").replace(/\/+$/g, "");
    if (!normalized) {
        return WORKSPACE_CONTAINER_ROOT;
    }
    if (normalized === USER_ASSETS_WORKSPACE_ROOT) {
        return USER_ASSETS_WORKSPACE_ROOT;
    }
    if (normalized === WORKSPACE_CONTAINER_ROOT || normalized.startsWith(`${WORKSPACE_CONTAINER_ROOT}/`)) {
        return WORKSPACE_CONTAINER_ROOT;
    }
    return normalized;
}
