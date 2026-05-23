import {AIMessage, ToolMessage, type BaseMessage} from "@langchain/core/messages";
import {z} from "zod";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {ActiveRunSession} from "nbook/server/agent/runtime/live-run-registry";
import {stringifyEventValue, type AgentThreadRunner} from "nbook/server/agent/runtime/thread-runner";
import type {ThreadEventRegistry} from "nbook/server/agent/runtime/thread-event-registry";
import type {AgentRunnerEvent} from "nbook/server/agent/runtime/thread-runner";
import {extractAssistantDelta} from "nbook/server/agent/runtime/thread-runner";
import type {BoundAgentTool} from "nbook/server/agent/tools/tool-registry";
import {createToolMessage, createToolResultMessage, readToolArgsText, readToolRawResult} from "nbook/server/agent/tools/shared/tool-message";
import {createPlanModePlanDirectoryPath} from "nbook/server/agent/plan-mode-path";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import type {ThreadMessageIngest, ThreadMessageService} from "nbook/server/agent/services/thread-message.service";
import type {
    AgentConversationToolCall,
    AgentStreamEvent,
    AgentVariableScope,
    AgentThreadMetadata,
    AgentTokenUsage,
    AgentThreadRecord,
    JsonValue,
    LiveToolState,
    PendingUserInputSession,
    ProfileKey,
    SubAgentCompletionResult,
    ThreadId,
} from "nbook/server/agent/types";
import {normalizeAgentTokenUsage} from "nbook/server/agent/types";
import {RequestUserInputToolArgsSchema} from "nbook/server/agent-v2/dto/agent-chat.dto";

const REPORT_RESULT_TOOL_KEY = "report_result";
const REQUEST_USER_INPUT_TOOL_KEY = "request_user_input";
const SKILL_TOOL_KEY = "skill";
const PLAN_MODE_APPROVAL_TOOL_KEYS = new Set(["enter_plan_mode", "exit_plan_mode"] as const);
const PLAN_MODE_APPROVAL_ARGS_TEXT = JSON.stringify({
    questions: [{
        header: "Plan Mode",
        question: "是否批准 Agent 切换 Plan Mode？",
        options: [
            {
                label: "批准",
                description: "允许 Agent 执行这次 Plan Mode 切换。",
                recommended: true,
                defaultSelected: true,
            },
            {
                label: "取消",
                description: "拒绝这次切换，Agent 会继续当前对话。",
            },
        ],
        multiSelect: false,
    }],
});
const SKILL_APPROVAL_ARGS_TEXT = JSON.stringify({
    questions: [{
        header: "Skill",
        question: "是否批准 Agent 启用这个 skill？",
        options: [
            {
                label: "批准",
                description: "允许 Agent 读取并使用这个 skill。",
                recommended: true,
                defaultSelected: true,
            },
            {
                label: "取消",
                description: "拒绝启用这个 skill，Agent 会继续当前对话。",
            },
        ],
        multiSelect: false,
    }],
});
const SubAgentResultPayloadSchema = z.object({
    walkthrough: z.string().trim().min(1),
    data: z.json().optional(),
});
const ToolBindingSchema = z.object({
    toolNodeId: z.string(),
    toolCallId: z.string().optional(),
    toolName: z.string(),
    callIndex: z.number().int().nonnegative(),
    messageId: z.string(),
    subagentThreadId: z.string().optional(),
});

type ToolBinding = z.infer<typeof ToolBindingSchema>;
type PendingToolDraft = {
    callIndex: number;
    toolNodeId?: string;
    toolCallId?: string;
    toolName?: string;
    argsText: string;
    executionArgsText?: string;
    bufferedArgsChunks: string[];
    boundRunId?: string;
    startedPublished: boolean;
    execStarted: boolean;
};

type PendingUserInputTool = {
    binding: ToolBinding;
    toolMessage: ToolMessage;
    approvalToolArgsText?: string;
};

type PlanModePlanPreview = {
    planFilePath: string;
    planContent: string;
};

/**
 * 解析并规范化 request_user_input 的参数，避免流式参数片段重复拼接后污染持久化历史。
 */
function normalizeRequestUserInputArgsText(...candidates: string[]): string {
    for (const candidate of candidates) {
        if (!candidate.trim()) {
            continue;
        }
        try {
            const parsed = RequestUserInputToolArgsSchema.parse(JSON.parse(candidate));
            return JSON.stringify(parsed);
        } catch {
            continue;
        }
    }
    throw new Error("request_user_input 参数不是合法 JSON");
}

/**
 * 判断工具名是否为 request_user_input。
 */
function isRequestUserInputToolName(toolName: string): boolean {
    return toolName.trim() === REQUEST_USER_INPUT_TOOL_KEY;
}

/**
 * 判断工具名是否为需要用户审批的 Plan Mode 工具。
 */
function isPlanModeApprovalToolName(toolName: string): toolName is "enter_plan_mode" | "exit_plan_mode" {
    return PLAN_MODE_APPROVAL_TOOL_KEYS.has(toolName.trim() as "enter_plan_mode" | "exit_plan_mode");
}

/**
 * 判断工具名是否为需要用户审批的 skill 工具。
 */
function isSkillApprovalToolName(toolName: string): boolean {
    return toolName.trim() === SKILL_TOOL_KEY;
}

/**
 * 判断工具名是否为需要用户审批的工具。
 */
function isApprovalToolName(toolName: string): boolean {
    return isPlanModeApprovalToolName(toolName) || isSkillApprovalToolName(toolName);
}

/**
 * 判断工具结果是否真的在请求用户审批。
 */
function isPendingToolApprovalResult(rawResult: JsonValue | undefined, toolName: string): boolean {
    if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
        return false;
    }
    if (rawResult.kind !== "pending_tool_approval") {
        return false;
    }
    if (isPlanModeApprovalToolName(toolName)) {
        return rawResult.action === toolName;
    }
    if (isSkillApprovalToolName(toolName)) {
        return rawResult.action === SKILL_TOOL_KEY;
    }
    return false;
}

/**
 * 从 JSON 值中读取字符串字段。
 */
function readStringField(value: JsonValue | undefined, key: string): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const item = value[key];
    return typeof item === "string" && item.trim() ? item : undefined;
}

/**
 * 将当前 thread 工作目录展示路径解析成 workspace-files 扫描参数。
 */
function resolvePlanDirectoryTarget(workspaceRoot: string | null | undefined, planDirectoryPath: string): {
    root: string;
    directoryPath: string;
} {
    const normalizedPlanDirectoryPath = planDirectoryPath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedPlanDirectoryPath === "workspace" || normalizedPlanDirectoryPath.startsWith("workspace/")) {
        return {
            root: ".",
            directoryPath: normalizedPlanDirectoryPath,
        };
    }

    const normalizedWorkspaceRoot = workspaceRoot?.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedWorkspaceRoot && normalizedPlanDirectoryPath.startsWith(`${normalizedWorkspaceRoot}/`)) {
        return {
            root: normalizedWorkspaceRoot,
            directoryPath: normalizedPlanDirectoryPath.slice(normalizedWorkspaceRoot.length + 1),
        };
    }

    return {
        root: ".",
        directoryPath: normalizedPlanDirectoryPath,
    };
}

/**
 * 将 exit_plan_mode 的显式 Markdown 文件参数约束到当前 thread 工作目录。
 */
function resolvePlanFileTarget(workspaceRoot: string | null | undefined, planDirectoryPath: string, planFilePath: string): {
    root: string;
    displayPath: string;
    filePath: string;
} {
    const normalizedPlanDirectoryPath = planDirectoryPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedInputPath = planFilePath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalizedInputPath) {
        throw new Error("exit_plan_mode planFilePath cannot be empty.");
    }

    const normalizedWorkspaceRoot = workspaceRoot?.replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
    const relativeInputPath = normalizedInputPath === normalizedPlanDirectoryPath || normalizedInputPath.startsWith(`${normalizedPlanDirectoryPath}/`)
        ? normalizedInputPath.slice(normalizedPlanDirectoryPath.length).replace(/^\/+/, "")
        : normalizedWorkspaceRoot && (normalizedInputPath === normalizedPlanDirectoryPath.slice(normalizedWorkspaceRoot.length + 1) || normalizedInputPath.startsWith(`${normalizedPlanDirectoryPath.slice(normalizedWorkspaceRoot.length + 1)}/`))
            ? normalizedInputPath.slice(normalizedPlanDirectoryPath.slice(normalizedWorkspaceRoot.length + 1).length).replace(/^\/+/, "")
            : normalizedInputPath;
    if (!relativeInputPath || relativeInputPath.includes("..")) {
        throw new Error("exit_plan_mode planFilePath must stay inside the current thread directory.");
    }
    if (!relativeInputPath.toLowerCase().endsWith(".md")) {
        throw new Error("exit_plan_mode planFilePath must point to a Markdown .md file.");
    }

    const {root, directoryPath} = resolvePlanDirectoryTarget(workspaceRoot, `${normalizedPlanDirectoryPath}/`);
    return {
        root,
        displayPath: `${normalizedPlanDirectoryPath}/${relativeInputPath}`,
        filePath: `${directoryPath}/${relativeInputPath}`,
    };
}

/**
 * 从未知对象中安全读取数字字段。
 */
type AgentInputTokenDetails = NonNullable<NonNullable<AIMessage["usage_metadata"]>["input_token_details"]> & {
    /**
     * 模型层归一化后的缓存未命中 token。
     */
    cache_miss?: number;
};

/**
 * 从 AIMessage 提取 usage。
 */
function readAssistantUsage(message: AIMessage): AgentTokenUsage | null {
    const usage = message.usage_metadata;
    if (!usage) {
        return null;
    }
    const inputTokenDetails = usage.input_token_details as AgentInputTokenDetails | undefined;

    return {
        inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
        outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
        cacheReadTokens: typeof inputTokenDetails?.cache_read === "number"
            ? inputTokenDetails.cache_read
            : null,
        cacheMissTokens: typeof inputTokenDetails?.cache_miss === "number"
            ? inputTokenDetails.cache_miss
            : null,
        cacheCreationTokens: typeof inputTokenDetails?.cache_creation === "number"
            ? inputTokenDetails.cache_creation
            : null,
    };
}

/**
 * 将本轮 usage 写回 thread metadata。
 */
function applyLastRunUsageToMetadata(
    metadata: AgentThreadMetadata,
    usage: AgentTokenUsage | null,
): AgentThreadMetadata {
    const normalizedUsage = normalizeAgentTokenUsage(usage);
    if (!normalizedUsage) {
        return metadata;
    }

    return {
        ...metadata,
        usageSummary: {
            lastRun: normalizedUsage,
            cumulative: metadata.usageSummary?.cumulative ?? null,
        },
    };
}

/**
 * 测试与旧调试入口曾直接喂 LangChain streamEvents。
 * 生产 runner 已输出 AgentRunnerEvent；这里保留一次窄适配，避免测试夹具和调试脚本同时大改。
 */
function normalizeRunnerEvent(event: unknown): AgentRunnerEvent | null {
    if (!event || typeof event !== "object") {
        return null;
    }
    if ("type" in event && typeof event.type === "string") {
        return event as AgentRunnerEvent;
    }
    const legacyEvent = event as {
        event?: string;
        name?: string;
        run_id?: string;
        data?: {
            input?: unknown;
            output?: unknown;
            error?: unknown;
            chunk?: unknown;
        };
    };
    if (legacyEvent.event === "on_chat_model_stream") {
        return {
            type: "model_delta",
            ...extractAssistantDelta({
                data: {
                    chunk: legacyEvent.data?.chunk,
                },
            }),
        };
    }
    if (legacyEvent.event === "on_chat_model_end" && AIMessage.isInstance(legacyEvent.data?.output)) {
        return {
            type: "model_end",
            message: legacyEvent.data.output,
        };
    }
    if (legacyEvent.event === "on_tool_start" && legacyEvent.name && legacyEvent.run_id) {
        const callIndex = readLegacyToolCallIndex(legacyEvent.data?.input);
        return {
            type: "tool_start",
            runId: legacyEvent.run_id,
            name: legacyEvent.name,
            input: legacyEvent.data?.input as JsonValue,
            inputText: stringifyEventValue(legacyEvent.data?.input ?? {}),
            callIndex,
        };
    }
    if (legacyEvent.event === "on_tool_end" && legacyEvent.name && legacyEvent.run_id) {
        return {
            type: "tool_end",
            runId: legacyEvent.run_id,
            name: legacyEvent.name,
            output: legacyEvent.data?.output as ToolMessage,
            callIndex: 0,
        };
    }
    if (legacyEvent.event === "on_tool_error" && legacyEvent.name && legacyEvent.run_id) {
        return {
            type: "tool_error",
            runId: legacyEvent.run_id,
            name: legacyEvent.name,
            error: legacyEvent.data?.error as ToolMessage,
            callIndex: 0,
        };
    }
    return null;
}

/**
 * 旧 streamEvents 没有稳定 callIndex；测试里单条 AIMessage 多工具时用 run_id 顺序即可。
 */
function readLegacyToolCallIndex(_input: unknown): number {
    return 0;
}

type ThreadRunCoordinatorDeps = {
    threadRunner: AgentThreadRunner;
    threadRepository: ThreadRepository;
    threadEvents: ThreadEventRegistry;
    threadMessages: ThreadMessageService;
    refreshThreadAgentScope(threadId: ThreadId): Promise<AgentVariableScope>;
    subscribeThreadActive(threadId: ThreadId): AsyncIterable<AgentStreamEvent>;
    loadThreadHistoryMessages(threadId: ThreadId): Promise<BaseMessage[]>;
    publishHistorySnapshot?(threadId: ThreadId): Promise<void>;
    publishThreadSnapshot?(threadId: ThreadId): Promise<void>;
    closeRun(threadId: ThreadId): void;
    stringifyError(error: unknown): string;
    isAbortError(error: unknown): boolean;
};

/**
 * 统一负责线程运行编排与最终结果收集。
 * AgentSystem 只负责参数准备与 service 装配。
 */
export class ThreadRunCoordinator {
    constructor(
        private readonly deps: ThreadRunCoordinatorDeps,
    ) {}

    /**
     * 后台消费 LangChain 流并驱动整个线程 run 生命周期。
     */
    async runThread<TKey extends ProfileKey>(
        thread: AgentThreadRecord,
        runtime: ProfileContextRuntime<TKey>,
        tools: BoundAgentTool[],
        session: ActiveRunSession,
    ): Promise<void> {
        const toolBindings = new Map<string, ToolBinding>();
        const pendingToolDrafts = new Map<number, PendingToolDraft>();
        let hasToolsThisIteration = false;
        let assistantIterationPersisted = false;
        const completedAssistantMessages: BaseMessage[] = [];
        let reportedWalkthrough = "";
        let currentAssistantUsage: AgentTokenUsage | null = null;
        let currentAssistantModelName: string | null = null;
        const ingestReactMessages: ThreadMessageIngest = async ({phase, messages}) => runtime.profile.ingest({
            runtime,
            phase,
            messages,
        });
        let currentMetadata: AgentThreadMetadata = thread.metadata;
        const pendingUserInputTools: PendingUserInputTool[] = [];

        const createPendingToolDraft = (callIndex: number): PendingToolDraft => ({
            callIndex,
            argsText: "",
            bufferedArgsChunks: [],
            startedPublished: false,
            execStarted: false,
        });

        const resetLocalIterationState = (): void => {
            pendingToolDrafts.clear();
            toolBindings.clear();
            session.resetIteration();
            assistantIterationPersisted = false;
            currentAssistantUsage = null;
            currentAssistantModelName = null;
        };

        const persistAssistantIterationBeforeTool = async (): Promise<void> => {
            if (assistantIterationPersisted) {
                return;
            }
            assistantIterationPersisted = true;
            const iterationMessages = await this.deps.threadMessages.finalizeAssistantIteration(
                String(thread.id),
                session,
                currentAssistantUsage,
                currentAssistantModelName,
                ingestReactMessages,
            );
            if (iterationMessages.length === 0) {
                return;
            }
            completedAssistantMessages.push(...iterationMessages);
            this.publishAssistantDoneMessages(session, iterationMessages);
        };

        const persistInterruptedToolsBeforeReset = async (): Promise<void> => {
            if (!hasToolsThisIteration || !assistantIterationPersisted) {
                return;
            }
            const interruptedToolMessages = await this.deps.threadMessages.persistInterruptedToolMessages(String(thread.id), session, ingestReactMessages);
            if (interruptedToolMessages.length > 0) {
                await this.deps.publishHistorySnapshot?.(String(thread.id));
            }
        };

        let completedProfileMetadata: AgentThreadMetadata = {};
        const commitCompletedRunMetadata = (metadata: AgentThreadMetadata): AgentThreadMetadata => {
            return {
                ...metadata,
                ...completedProfileMetadata,
            };
        };

        const retireDraft = (binding: ToolBinding): void => {
            pendingToolDrafts.delete(binding.callIndex);
        };

        const nextFallbackCallIndex = (): number => {
            const currentIndexes = [
                ...pendingToolDrafts.keys(),
                ...session.snapshot.tools.map((tool) => tool.callIndex),
            ];
            if (currentIndexes.length === 0) {
                return 0;
            }
            return Math.max(...currentIndexes) + 1;
        };

        const findExecutionDraft = (toolName: string): PendingToolDraft | undefined => {
            return [...pendingToolDrafts.values()]
                .filter((draft) => draft.toolName === toolName && !draft.boundRunId)
                .sort((left, right) => left.callIndex - right.callIndex)[0];
        };

        const findBoundDraft = (runId: string): PendingToolDraft | undefined => {
            return [...pendingToolDrafts.values()]
                .filter((draft) => draft.boundRunId === runId)
                .sort((left, right) => left.callIndex - right.callIndex)[0];
        };

        const findDraftByToolCallId = (toolCallId: string): PendingToolDraft | undefined => {
            return [...pendingToolDrafts.values()]
                .find((draft) => draft.toolCallId === toolCallId);
        };

        const resolveToolCallDraft = (toolCallChunk: {
            callIndex: number;
            toolCallId?: string;
        }): PendingToolDraft => {
            if (toolCallChunk.toolCallId) {
                const draftByToolCallId = findDraftByToolCallId(toolCallChunk.toolCallId);
                if (draftByToolCallId) {
                    return draftByToolCallId;
                }
            }

            const draftByCallIndex = pendingToolDrafts.get(toolCallChunk.callIndex);
            if (
                draftByCallIndex?.toolCallId
                && toolCallChunk.toolCallId
                && draftByCallIndex.toolCallId !== toolCallChunk.toolCallId
            ) {
                return createPendingToolDraft(nextFallbackCallIndex());
            }
            return draftByCallIndex ?? createPendingToolDraft(toolCallChunk.callIndex);
        };

        const consumeToolArgsChunk = (draft: PendingToolDraft, rawArgsChunk: string): string => {
            if (!rawArgsChunk) {
                return "";
            }
            if (rawArgsChunk.startsWith(draft.argsText)) {
                const nextDelta = rawArgsChunk.slice(draft.argsText.length);
                draft.argsText = rawArgsChunk;
                return nextDelta;
            }
            const maxOverlap = Math.min(draft.argsText.length, rawArgsChunk.length);
            let overlapLength = 0;
            for (let index = maxOverlap; index > 0; index -= 1) {
                if (draft.argsText.endsWith(rawArgsChunk.slice(0, index))) {
                    overlapLength = index;
                    break;
                }
            }
            const shouldTrimOverlap = overlapLength >= Math.min(16, rawArgsChunk.length) && overlapLength >= 8;
            const nextDelta = shouldTrimOverlap ? rawArgsChunk.slice(overlapLength) : rawArgsChunk;
            draft.argsText = `${draft.argsText}${nextDelta}`;
            return nextDelta;
        };

        const ensureToolStarted = (
            draft: PendingToolDraft,
            toolName: string,
        ): {
            draft: PendingToolDraft;
            toolState: LiveToolState;
            subagentThreadId?: string;
        } => {
            if (!draft.toolName) {
                draft.toolName = toolName;
            }
            const subagentThreadId = this.readSubagentThreadId(draft.argsText, draft.toolName);
            const toolState = session.ensureToolDraft({
                callIndex: draft.callIndex,
                toolName: draft.toolName,
                toolCallId: draft.toolCallId,
                subagentThreadId,
            });

            if (!draft.toolNodeId) {
                draft.toolNodeId = toolState.toolNodeId;
            }

            if (!draft.startedPublished) {
                this.publishRunEvent(session, {
                    type: "tool_call_started",
                    threadId: session.threadId,
                    assistantMessageId: toolState.assistantMessageId,
                    toolNodeId: toolState.toolNodeId,
                    callIndex: draft.callIndex,
                    toolName: draft.toolName,
                    toolCallId: draft.toolCallId,
                    subagentThreadId,
                });
                draft.startedPublished = true;
            }
            pendingToolDrafts.set(draft.callIndex, draft);
            return {draft, toolState, subagentThreadId};
        };

        const publishToolArgsChunk = (draft: PendingToolDraft, argsChunk: string, toolName: string): void => {
            if (!argsChunk) {
                return;
            }
            const {draft: nextDraft, toolState, subagentThreadId} = ensureToolStarted(draft, toolName);
            session.appendToolArgs(toolState.toolNodeId, argsChunk, subagentThreadId);
            this.publishRunEvent(session, {
                type: "tool_args_delta",
                threadId: session.threadId,
                assistantMessageId: toolState.assistantMessageId,
                toolNodeId: toolState.toolNodeId,
                argsChunk,
            });
            pendingToolDrafts.set(nextDraft.callIndex, nextDraft);
        };

        const flushBufferedToolArgs = (draft: PendingToolDraft, toolName: string): void => {
            if (draft.bufferedArgsChunks.length === 0) {
                return;
            }
            const bufferedArgsChunks = [...draft.bufferedArgsChunks];
            draft.bufferedArgsChunks = [];
            for (const argsChunk of bufferedArgsChunks) {
                publishToolArgsChunk(draft, argsChunk, toolName);
            }
        };

        const bindToolExecution = (
            runId: string,
            draft: PendingToolDraft,
            toolName: string,
            preferredArgsText = "",
        ): ToolBinding => {
            const existingBinding = toolBindings.get(runId);
            if (existingBinding) {
                return existingBinding;
            }
            if (preferredArgsText) {
                draft.executionArgsText = preferredArgsText;
                if (!draft.argsText) {
                    const normalizedArgsChunk = consumeToolArgsChunk(draft, preferredArgsText);
                    if (normalizedArgsChunk) {
                        draft.bufferedArgsChunks.push(normalizedArgsChunk);
                    }
                }
            }
            const {draft: nextDraft, toolState, subagentThreadId} = ensureToolStarted(draft, toolName);
            flushBufferedToolArgs(nextDraft, toolName);
            const runningToolState = session.startToolExecution(toolState.toolNodeId, nextDraft.toolCallId, subagentThreadId) ?? toolState;
            const binding = ToolBindingSchema.parse({
                toolNodeId: runningToolState.toolNodeId,
                toolCallId: nextDraft.toolCallId,
                toolName: nextDraft.toolName,
                callIndex: nextDraft.callIndex,
                messageId: session.snapshot.messageId,
                subagentThreadId,
            });
            nextDraft.boundRunId = runId;
            pendingToolDrafts.set(nextDraft.callIndex, nextDraft);
            toolBindings.set(runId, binding);
            if (!nextDraft.execStarted) {
                this.publishRunEvent(session, {
                    type: "tool_exec_started",
                    threadId: session.threadId,
                    assistantMessageId: binding.messageId,
                    toolNodeId: binding.toolNodeId,
                    toolCallId: binding.toolCallId,
                    subagentThreadId: binding.subagentThreadId,
                });
                nextDraft.execStarted = true;
                pendingToolDrafts.set(nextDraft.callIndex, nextDraft);
            }
            return binding;
        };

        const ensureToolBindingForTerminalEvent = (runId: string, toolName: string): ToolBinding => {
            const binding = toolBindings.get(runId);
            if (binding) {
                return binding;
            }

            const boundDraft = findBoundDraft(runId);
            if (boundDraft?.toolName) {
                return bindToolExecution(runId, boundDraft, boundDraft.toolName, boundDraft.argsText);
            }

            const matchedDraft = findExecutionDraft(toolName);
            const draft = matchedDraft ?? {
                ...createPendingToolDraft(nextFallbackCallIndex()),
                toolName,
            };
            return bindToolExecution(runId, draft, toolName);
        };

        try {
            const preparedRun = await runtime.profile.prepare(runtime);
            completedProfileMetadata = preparedRun.completedMetadata;
            currentMetadata = {
                ...thread.metadata,
                ...preparedRun.immediateMetadata,
                ...runtime.options.planModeCommitMetadata,
                usageSummary: thread.metadata.usageSummary ?? undefined,
            };
            const persistedMessages = preparedRun.persistedMessages;
            if (persistedMessages.prepend.length > 0 || persistedMessages.append.length > 0) {
                if (persistedMessages.prepend.length > 0) {
                    await runtime.messageStore.prependMessages(String(thread.id), {
                        messages: persistedMessages.prepend,
                    });
                }
                if (persistedMessages.append.length > 0) {
                    if (persistedMessages.appendBeforeMessageId) {
                        await runtime.messageStore.insertMessagesBefore(String(thread.id), {
                            beforeMessageId: persistedMessages.appendBeforeMessageId,
                            messages: persistedMessages.append,
                        });
                    } else {
                        await runtime.messageStore.appendMessages(String(thread.id), {
                            messages: persistedMessages.append,
                        });
                    }
                }
                await this.deps.publishHistorySnapshot?.(String(thread.id));
            }
            await this.deps.threadRepository.updateMetadata(String(thread.id), currentMetadata);
            const streamEvents = await this.deps.threadRunner.streamPreparedEvents(
                thread,
                runtime.profile.key,
                preparedRun.modelMessages,
                tools,
                session.signal,
            );

            for await (const rawStreamEvent of streamEvents) {
                const streamEvent = normalizeRunnerEvent(rawStreamEvent);
                if (!streamEvent) {
                    continue;
                }
                if (streamEvent.type === "model_delta") {
                    if (pendingUserInputTools.length > 0) {
                        break;
                    }
                    const {chunkText, thinkingText, toolCallChunks} = streamEvent;
                    if (!chunkText && !thinkingText && toolCallChunks.length === 0) {
                        continue;
                    }
                    if (hasToolsThisIteration && pendingUserInputTools.length === 0) {
                        if (!assistantIterationPersisted) {
                            await persistAssistantIterationBeforeTool();
                        }
                        resetLocalIterationState();
                        hasToolsThisIteration = false;
                    }
                    if (thinkingText && pendingUserInputTools.length === 0) {
                        const normalizedThinkingDelta = session.appendThinkingText(thinkingText);
                        if (normalizedThinkingDelta) {
                            this.publishRunEvent(session, {
                                type: "thinking_delta",
                                threadId: session.threadId,
                                messageId: session.snapshot.messageId,
                                chunkText: normalizedThinkingDelta,
                            });
                        }
                    }
                    if (chunkText && pendingUserInputTools.length === 0) {
                        const normalizedAssistantDelta = session.appendAssistantText(chunkText);
                        if (normalizedAssistantDelta) {
                            this.publishRunEvent(session, {
                                type: "assistant_delta",
                                threadId: session.threadId,
                                messageId: session.snapshot.messageId,
                                chunkText: normalizedAssistantDelta,
                            });
                        }
                    }
                    for (const toolCallChunk of toolCallChunks) {
                        const draft = resolveToolCallDraft(toolCallChunk);
                        if (toolCallChunk.toolCallId) {
                            draft.toolCallId = toolCallChunk.toolCallId;
                        }
                        if (toolCallChunk.toolName) {
                            draft.toolName = toolCallChunk.toolName;
                        }
                        if (toolCallChunk.argsChunk) {
                            const normalizedArgsChunk = consumeToolArgsChunk(draft, toolCallChunk.argsChunk);
                            if (normalizedArgsChunk) {
                                if (draft.toolName) {
                                    publishToolArgsChunk(draft, normalizedArgsChunk, draft.toolName);
                                } else {
                                    draft.bufferedArgsChunks.push(normalizedArgsChunk);
                                }
                            }
                        }
                        if (draft.toolName) {
                            ensureToolStarted(draft, draft.toolName);
                            flushBufferedToolArgs(draft, draft.toolName);
                        }
                        pendingToolDrafts.set(draft.callIndex, draft);
                    }
                    continue;
                }

                if (streamEvent.type === "model_end") {
                    if (AIMessage.isInstance(streamEvent.message)) {
                        currentAssistantUsage = readAssistantUsage(streamEvent.message);
                        currentAssistantModelName = typeof streamEvent.message.response_metadata?.model_name === "string"
                            ? streamEvent.message.response_metadata.model_name
                            : currentAssistantModelName;
                        if (currentAssistantUsage) {
                            currentMetadata = applyLastRunUsageToMetadata(currentMetadata, currentAssistantUsage);
                            await this.deps.threadRepository.updateMetadata(String(thread.id), await this.mergeLatestThreadMetadata(String(thread.id), currentMetadata));
                            await this.deps.publishThreadSnapshot?.(String(thread.id));
                        }
                    }
                    continue;
                }

                if (streamEvent.type === "tool_start") {
                    const inputText = this.normalizeToolInputText(streamEvent.inputText || streamEvent.input);
                    const matchedDraft = findExecutionDraft(streamEvent.name);
                    const fallbackCallIndex = matchedDraft?.callIndex ?? nextFallbackCallIndex();
                    const draft = matchedDraft ?? {
                        ...createPendingToolDraft(fallbackCallIndex),
                        toolName: streamEvent.name,
                    };
                    if (streamEvent.toolCallId) {
                        draft.toolCallId = streamEvent.toolCallId;
                    }
                    if (!draft.toolName) {
                        draft.toolName = streamEvent.name;
                    }
                    bindToolExecution(streamEvent.runId, draft, streamEvent.name, inputText);
                    continue;
                }

                if (streamEvent.type === "tool_end") {
                    const binding = ensureToolBindingForTerminalEvent(streamEvent.runId, streamEvent.name);
                    await persistAssistantIterationBeforeTool();
                    const currentToolArgsText = session.snapshot.tools.find((tool) => tool.toolNodeId === binding.toolNodeId)?.argsText ?? "";
                    const toolMessage = this.normalizeToolMessage(streamEvent.output, binding, "success", currentToolArgsText);
                    const rawResult = readToolRawResult(toolMessage.additional_kwargs);
                    if (isRequestUserInputToolName(binding.toolName) || isPendingToolApprovalResult(rawResult, binding.toolName)) {
                        const requestedPlanFilePath = binding.toolName === "exit_plan_mode"
                            ? readStringField(rawResult, "planFilePath")
                            : undefined;
                        let planPreview: PlanModePlanPreview | null = null;
                        if (binding.toolName === "exit_plan_mode" && requestedPlanFilePath) {
                            try {
                                planPreview = await this.resolveCurrentPlanPreview(runtime.scope, String(thread.id), requestedPlanFilePath);
                            } catch (error) {
                                const errorText = this.deps.stringifyError(error);
                                const errorToolMessage = createToolMessage({
                                    toolCallId: binding.toolCallId ?? binding.toolNodeId,
                                    toolNodeId: binding.toolNodeId,
                                    assistantMessageId: binding.messageId,
                                    toolName: binding.toolName,
                                    result: createToolResultMessage(errorText, currentToolArgsText, "error"),
                                    id: toolMessage.id,
                                    additionalKwargs: toolMessage.additional_kwargs,
                                });
                                await this.deps.threadMessages.persistToolMessage(String(thread.id), errorToolMessage, "error", ingestReactMessages);
                                await this.deps.publishHistorySnapshot?.(String(thread.id));
                                session.finishTool(binding.toolNodeId, binding.toolCallId, errorText, "error", binding.subagentThreadId);
                                this.publishRunEvent(session, {
                                    type: "tool_finished",
                                    threadId: session.threadId,
                                    assistantMessageId: binding.messageId,
                                    status: "error",
                                    toolCall: this.toConversationToolCall(binding, errorToolMessage, "error"),
                                    subagentThreadId: binding.subagentThreadId,
                                });
                                toolBindings.delete(streamEvent.runId);
                                retireDraft(binding);
                                hasToolsThisIteration = true;
                                continue;
                            }
                        }
                        const draft = pendingToolDrafts.get(binding.callIndex);
                        const toolArgsText = isRequestUserInputToolName(binding.toolName)
                            ? normalizeRequestUserInputArgsText(
                                draft?.executionArgsText ?? "",
                                readToolArgsText(toolMessage),
                                draft?.argsText ?? "",
                            )
                            : isPlanModeApprovalToolName(binding.toolName)
                                ? PLAN_MODE_APPROVAL_ARGS_TEXT
                                : SKILL_APPROVAL_ARGS_TEXT;
                        const normalizedToolMessage = createToolMessage({
                            toolCallId: binding.toolCallId ?? binding.toolNodeId,
                            toolNodeId: binding.toolNodeId,
                            assistantMessageId: binding.messageId,
                            toolName: binding.toolName,
                            result: {
                                ...createToolResultMessage(toolMessage.text, toolArgsText, "success"),
                                rawResult: {
                                    ...(rawResult && typeof rawResult === "object" && !Array.isArray(rawResult) ? rawResult : {}),
                                    ...(planPreview ? {
                                        planPreviewKind: "exit_plan_mode",
                                        planFilePath: planPreview.planFilePath,
                                        planContent: planPreview.planContent,
                                    } : {}),
                                },
                            },
                            id: toolMessage.id,
                            additionalKwargs: toolMessage.additional_kwargs,
                        });
                        pendingUserInputTools.push({
                            binding,
                            toolMessage: normalizedToolMessage,
                            ...(isApprovalToolName(binding.toolName) ? {
                                approvalToolArgsText: draft?.executionArgsText || currentToolArgsText || draft?.argsText || readToolArgsText(toolMessage),
                            } : {}),
                        });
                        toolBindings.delete(streamEvent.runId);
                        retireDraft(binding);
                        hasToolsThisIteration = true;
                        continue;
                    }
                    await this.deps.threadMessages.persistToolMessage(String(thread.id), toolMessage, "success", ingestReactMessages);
                    await this.deps.publishHistorySnapshot?.(String(thread.id));
                    session.finishTool(binding.toolNodeId, binding.toolCallId, toolMessage.text, "success", binding.subagentThreadId);
                    this.publishRunEvent(session, {
                        type: "tool_finished",
                        threadId: session.threadId,
                        assistantMessageId: binding.messageId,
                        status: "success",
                        toolCall: this.toConversationToolCall(binding, toolMessage, "success"),
                        subagentThreadId: binding.subagentThreadId,
                    });
                    toolBindings.delete(streamEvent.runId);
                    retireDraft(binding);
                    if (thread.kind === "subagent" && binding.toolName === REPORT_RESULT_TOOL_KEY) {
                        const rawResult = readToolRawResult(toolMessage.additional_kwargs);
                        const parsedPayload = SubAgentResultPayloadSchema.safeParse(rawResult);
                        if (parsedPayload.success) {
                            reportedWalkthrough = parsedPayload.data.walkthrough.trim();
                        }
                        resetLocalIterationState();
                        hasToolsThisIteration = false;
                        break;
                    }
                    hasToolsThisIteration = true;
                    continue;
                }

                if (streamEvent.type === "tool_error") {
                    const binding = ensureToolBindingForTerminalEvent(streamEvent.runId, streamEvent.name);
                    await persistAssistantIterationBeforeTool();
                    const currentToolArgsText = session.snapshot.tools.find((tool) => tool.toolNodeId === binding.toolNodeId)?.argsText ?? "";
                    const toolMessage = this.normalizeToolMessage(streamEvent.error, binding, "error", currentToolArgsText);
                    await this.deps.threadMessages.persistToolMessage(String(thread.id), toolMessage, "error", ingestReactMessages);
                    await this.deps.publishHistorySnapshot?.(String(thread.id));
                    session.finishTool(binding.toolNodeId, binding.toolCallId, toolMessage.text, "error", binding.subagentThreadId);
                    this.publishRunEvent(session, {
                        type: "tool_finished",
                        threadId: session.threadId,
                        assistantMessageId: binding.messageId,
                        status: "error",
                        toolCall: this.toConversationToolCall(binding, toolMessage, "error"),
                        subagentThreadId: binding.subagentThreadId,
                    });
                    toolBindings.delete(streamEvent.runId);
                    retireDraft(binding);
                    hasToolsThisIteration = true;
                    continue;
                }

                if (streamEvent.type === "tool_batch_end" && pendingUserInputTools.length > 0) {
                    break;
                }
            }

            if (pendingUserInputTools.length > 0) {
                await this.transitionToWaitingUser(thread, session, runtime, currentMetadata, pendingUserInputTools);
                return;
            }

            if (hasToolsThisIteration && assistantIterationPersisted) {
                resetLocalIterationState();
                hasToolsThisIteration = false;
            }
            const resultMessages = await this.deps.threadMessages.finalizeAssistantSuccess(
                String(thread.id),
                session,
                currentAssistantUsage,
                currentAssistantModelName,
                ingestReactMessages,
            );
            completedAssistantMessages.push(...resultMessages);
            this.publishAssistantDoneMessages(session, resultMessages);
            if (resultMessages.length > 0) {
                await this.deps.publishHistorySnapshot?.(String(thread.id));
            }

            const finalSummary = reportedWalkthrough
                || this.deps.threadMessages.buildSummary(completedAssistantMessages)
                || thread.lastMessagePreview
                || "执行完成";
            currentMetadata = applyLastRunUsageToMetadata(currentMetadata, currentAssistantUsage);
            currentMetadata = await this.mergeLatestThreadMetadata(String(thread.id), currentMetadata);
            currentMetadata = commitCompletedRunMetadata(currentMetadata);
            await this.deps.threadRepository.touchAfterRun(String(thread.id), {
                summary: finalSummary,
                status: "completed",
                metadata: currentMetadata,
            });
            await this.deps.refreshThreadAgentScope(String(thread.id));
            await this.deps.publishThreadSnapshot?.(String(thread.id));
            session.setStatus("completed");
            this.publishRunEvent(session, {
                type: "run_state",
                threadId: session.threadId,
                status: "completed",
            });
        } catch (error) {
            if (this.deps.isAbortError(error)) {
                if (hasToolsThisIteration && assistantIterationPersisted) {
                    await persistInterruptedToolsBeforeReset();
                    resetLocalIterationState();
                    hasToolsThisIteration = false;
                }
                const stoppedMessages = await this.deps.threadMessages.finalizeAssistantStopped(
                    String(thread.id),
                    session,
                    currentAssistantUsage,
                    currentAssistantModelName,
                    ingestReactMessages,
                );
                completedAssistantMessages.push(...stoppedMessages);
                this.publishAssistantDoneMessages(session, stoppedMessages);
                if (stoppedMessages.length > 0) {
                    await this.deps.publishHistorySnapshot?.(String(thread.id));
                }
                const stopSummary = this.deps.threadMessages.buildSummary(completedAssistantMessages) || thread.lastMessagePreview || "执行已停止";
                currentMetadata = applyLastRunUsageToMetadata(currentMetadata, currentAssistantUsage);
                currentMetadata = await this.mergeLatestThreadMetadata(String(thread.id), currentMetadata);
                await this.deps.threadRepository.touchAfterRun(String(thread.id), {
                    summary: stopSummary,
                    status: "stopped",
                    metadata: currentMetadata,
                });
                await this.deps.refreshThreadAgentScope(String(thread.id));
                await this.deps.publishThreadSnapshot?.(String(thread.id));
                session.setStatus("stopped");
                this.publishRunEvent(session, {
                    type: "run_state",
                    threadId: session.threadId,
                    status: "stopped",
                });
                return;
            }

            console.error("[agent] run failed", {
                threadId: String(thread.id),
                profileKey: runtime.profile.key,
            }, error);
            if (hasToolsThisIteration && assistantIterationPersisted) {
                await persistInterruptedToolsBeforeReset();
                resetLocalIterationState();
                hasToolsThisIteration = false;
            }
            const errorMessage = this.deps.stringifyError(error);
            const failedMessages = await this.deps.threadMessages.finalizeAssistantFailure(
                String(thread.id),
                session,
                errorMessage,
                currentAssistantUsage,
                currentAssistantModelName,
                ingestReactMessages,
            );
            completedAssistantMessages.push(...failedMessages);
            this.publishAssistantDoneMessages(session, failedMessages);
            if (failedMessages.length > 0) {
                await this.deps.publishHistorySnapshot?.(String(thread.id));
            }
            currentMetadata = applyLastRunUsageToMetadata(currentMetadata, currentAssistantUsage);
            currentMetadata = await this.mergeLatestThreadMetadata(String(thread.id), currentMetadata);
            await this.deps.threadRepository.touchAfterRun(String(thread.id), {
                summary: this.deps.threadMessages.buildSummary(completedAssistantMessages) || errorMessage,
                status: "failed",
                metadata: currentMetadata,
            });
            await this.deps.refreshThreadAgentScope(String(thread.id));
            await this.deps.publishThreadSnapshot?.(String(thread.id));
            session.setStatus("failed");
            this.publishRunEvent(session, {
                type: "run_state",
                threadId: session.threadId,
                status: "failed",
                error: errorMessage,
            });
        } finally {
            this.deps.closeRun(session.threadId);
        }
    }

    /**
     * 收集 leader 线程本轮新增 assistant 消息。
     */
    async collectActiveMessages(threadId: ThreadId): Promise<BaseMessage[]> {
        const assistantMessages: BaseMessage[] = [];
        let errorMessage = "";

        for await (const event of this.deps.subscribeThreadActive(threadId)) {
            if (event.type === "assistant_done") {
                assistantMessages.push(new AIMessage({
                    content: event.message.content,
                    additional_kwargs: {
                        messageId: event.message.id,
                        messageStatus: event.message.status,
                        messageCreatedAt: event.message.createdAt,
                        ...(event.message.thinking ? {thinking: event.message.thinking} : {}),
                        ...(event.message.thinking ? {reasoning_content: event.message.thinking} : {}),
                    },
                }));
            }
            if (event.type === "run_state" && event.status === "failed") {
                errorMessage = event.error ?? "Agent 运行失败";
            }
        }

        if (errorMessage) {
            throw new Error(errorMessage);
        }
        return assistantMessages;
    }

    /**
     * 收集 subagent 的最终完成结果。
     */
    async collectSubAgentCompletion(threadId: ThreadId): Promise<SubAgentCompletionResult> {
        let errorMessage = "";
        let stopped = false;

        for await (const event of this.deps.subscribeThreadActive(threadId)) {
            if (event.type === "run_state" && event.status === "failed") {
                errorMessage = event.error ?? "Agent 运行失败";
            }
            if (event.type === "run_state" && event.status === "stopped") {
                stopped = true;
            }
        }

        if (errorMessage) {
            throw new Error(errorMessage);
        }
        if (stopped) {
            throw new Error(`subagent ${threadId} 已停止，未返回最终结果`);
        }

        const history = await this.deps.loadThreadHistoryMessages(threadId);
        return this.resolveSubAgentCompletionResult(threadId, history);
    }

    /**
     * 合并运行中工具或 UI 已写入的最新 metadata，避免 run 结束时用旧快照覆盖。
     */
    private async mergeLatestThreadMetadata(threadId: ThreadId, currentMetadata: AgentThreadMetadata): Promise<AgentThreadMetadata> {
        const repository = this.deps.threadRepository as ThreadRepository & {
            findById?: ThreadRepository["findById"];
        };
        if (typeof repository.findById !== "function") {
            return currentMetadata;
        }
        const latestThread = await repository.findById(threadId);
        if (!latestThread) {
            return currentMetadata;
        }
        return {
            ...currentMetadata,
            planMode: latestThread.metadata.planMode ?? currentMetadata.planMode,
            tasks: latestThread.metadata.tasks ?? currentMetadata.tasks,
        };
    }

    /**
     * 通过 subagent 历史解析最终完成结果。
     */
    private resolveSubAgentCompletionResult(threadId: ThreadId, messages: BaseMessage[]): SubAgentCompletionResult {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (!message || !ToolMessage.isInstance(message) || message.name !== REPORT_RESULT_TOOL_KEY) {
                continue;
            }
            const rawResult = readToolRawResult(message.additional_kwargs);
            const parsedPayload = SubAgentResultPayloadSchema.safeParse(rawResult);
            if (!parsedPayload.success) {
                continue;
            }
            return {
                subagentThreadId: threadId,
                status: "completed",
                walkthrough: parsedPayload.data.walkthrough,
                data: parsedPayload.data.data,
            };
        }

        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (!message || !AIMessage.isInstance(message)) {
                continue;
            }
            const walkthrough = message.text.trim();
            if (!walkthrough) {
                continue;
            }
            return {
                subagentThreadId: threadId,
                status: "completed",
                walkthrough,
            };
        }

        throw new Error(`subagent ${threadId} 未产出可用的最终结果`);
    }

    /**
     * 同时向 live run 与 thread stream 广播一次运行期事件。
     */
    private publishRunEvent(session: ActiveRunSession, event: AgentStreamEvent): void {
        session.publish(event);
        this.deps.threadEvents.publish(session.threadId, event);
    }

    /**
     * 向前端发布 assistant 完成事件。
     */
    private publishAssistantDoneMessages(session: ActiveRunSession, messages: BaseMessage[]): void {
        for (const message of messages) {
            if (!AIMessage.isInstance(message)) {
                continue;
            }
            const conversationMessage = this.deps.threadMessages.toConversationAssistantMessage(message);
            this.publishRunEvent(session, {
                type: "assistant_done",
                threadId: session.threadId,
                messageId: conversationMessage.id,
                message: conversationMessage,
            });
        }
    }

    /**
     * 从工具参数中解析 subagentThreadId。
     */
    private readSubagentThreadId(inputText: string, toolName: string): string | undefined {
        if (toolName !== "invoke_subagent" && toolName !== "create_subagent") {
            return undefined;
        }
        try {
            const parsed = JSON.parse(inputText) as {subagentThreadId?: unknown};
            if (typeof parsed.subagentThreadId === "string") {
                return parsed.subagentThreadId.trim() || undefined;
            }
            if (typeof parsed.subagentThreadId === "number") {
                return String(parsed.subagentThreadId);
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 规范化工具消息，确保 toolCallId 与当前流式会话一致。
     */
    private normalizeToolMessage(output: unknown, binding: ToolBinding, status: "success" | "error", toolArgsText = ""): ToolMessage {
        if (ToolMessage.isInstance(output)) {
            const toolCallId = output.tool_call_id || binding.toolCallId || binding.toolNodeId;
            return createToolMessage({
                toolCallId,
                toolNodeId: binding.toolNodeId,
                assistantMessageId: binding.messageId,
                toolName: output.name || binding.toolName,
                id: output.id || toolCallId,
                metadata: output.metadata,
                additionalKwargs: output.additional_kwargs,
                result: {
                    content: output.text,
                    toolArgs: readToolArgsText(output),
                    status,
                    rawResult: readToolRawResult(output.additional_kwargs),
                },
            });
        }

        return createToolMessage({
            toolCallId: binding.toolCallId ?? binding.toolNodeId,
            toolNodeId: binding.toolNodeId,
            assistantMessageId: binding.messageId,
            toolName: binding.toolName,
            result: createToolResultMessage(output, toolArgsText, status),
        });
    }

    /**
     * 将工具终态消息转换为前端工具节点。
     */
    private toConversationToolCall(
        binding: ToolBinding,
        message: ToolMessage,
        status: "success" | "error",
    ): AgentConversationToolCall {
        const toolArgsText = readToolArgsText(message);
        return {
            id: binding.toolNodeId,
            assistantMessageId: binding.messageId,
            toolNodeId: binding.toolNodeId,
            callIndex: binding.callIndex,
            toolCallId: binding.toolCallId,
            toolName: message.name || binding.toolName,
            argsText: toolArgsText,
            status,
            outputText: message.text,
            rawResult: readToolRawResult(message.additional_kwargs),
            subagentThreadId: binding.subagentThreadId,
        };
    }

    /**
     * 将 tool start 输入统一收敛为模型原始参数文本。
     */
    private normalizeToolInputText(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }
        if (value && typeof value === "object" && "input" in value) {
            const input = (value as {input?: unknown}).input;
            if (typeof input === "string") {
                return input;
            }
        }
        return stringifyEventValue(value ?? {});
    }

    /**
     * 读取 exit_plan_mode 显式指定的当前 thread Markdown 计划文件。
     */
    private async resolveCurrentPlanPreview(
        scope: AgentVariableScope,
        threadId: ThreadId,
        requestedPlanFilePath: string,
    ): Promise<PlanModePlanPreview | null> {
        const planDirectoryPath = createPlanModePlanDirectoryPath(scope, threadId);
        const target = resolvePlanFileTarget(scope.studio.workspace, planDirectoryPath, requestedPlanFilePath);
        return {
            planFilePath: target.displayPath,
            planContent: (await readWorkspaceTextFile(target.root, target.filePath)).trim(),
        };
    }

    /**
     * 将 request_user_input 问题挂起到线程元数据，并把线程切到 waiting_user。
     */
    private async transitionToWaitingUser(
        thread: AgentThreadRecord,
        session: ActiveRunSession,
        runtime: ProfileContextRuntime<ProfileKey>,
        currentMetadata: AgentThreadMetadata,
        pendingUserInputTools: PendingUserInputTool[],
    ): Promise<void> {
        const pendingUserInputSession: PendingUserInputSession = {
            assistantMessageId: pendingUserInputTools[0]?.binding.messageId ?? session.snapshot.messageId,
            status: "pending",
            questions: pendingUserInputTools.flatMap(({binding, toolMessage, approvalToolArgsText}) => {
                const toolArgsText = readToolArgsText(toolMessage);
                const parsedArgs = RequestUserInputToolArgsSchema.parse(JSON.parse(toolArgsText));
                const rawResult = readToolRawResult(toolMessage.additional_kwargs);
                const planFilePath = readStringField(rawResult, "planFilePath");
                const planContent = readStringField(rawResult, "planContent");
                return parsedArgs.questions.map((question, questionIndex) => ({
                    toolNodeId: binding.toolNodeId,
                    questionIndex,
                    toolCallId: binding.toolCallId ?? null,
                    toolName: binding.toolName,
                    toolArgsText,
                    approvalToolArgsText: isApprovalToolName(binding.toolName)
                        ? approvalToolArgsText
                        : undefined,
                    createdAt: typeof toolMessage.additional_kwargs?.messageCreatedAt === "string"
                        ? toolMessage.additional_kwargs.messageCreatedAt
                        : new Date().toISOString(),
                    ...(isPlanModeApprovalToolName(binding.toolName) ? {
                        kind: "tool_approval" as const,
                        approvalAction: binding.toolName,
                        ...(planFilePath ? {planFilePath} : {}),
                        ...(planContent ? {planContent} : {}),
                    } : {}),
                    ...(isSkillApprovalToolName(binding.toolName) ? {
                        kind: "tool_approval" as const,
                        approvalAction: "skill" as const,
                    } : {}),
                }));
            }),
        };

        const nextMetadata = await this.mergeLatestThreadMetadata(String(thread.id), {
            ...currentMetadata,
            pendingUserInputSession,
        });
        await this.deps.threadRepository.updateMetadata(String(thread.id), {
            ...nextMetadata,
        });
        await this.deps.threadRepository.updateRunStatus(String(thread.id), "waiting_user");
        await this.deps.refreshThreadAgentScope(String(thread.id));
        await this.deps.publishHistorySnapshot?.(String(thread.id));
        session.setStatus("waiting_user");
        session.resetIteration();
        await this.deps.publishThreadSnapshot?.(String(thread.id));
        this.publishRunEvent(session, {
            type: "user_input_requested",
            threadId: session.threadId,
            session: pendingUserInputSession,
        });
        this.publishRunEvent(session, {
            type: "run_state",
            threadId: session.threadId,
            status: "waiting_user",
        });
    }
}
