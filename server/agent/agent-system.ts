import type {BaseMessage} from "@langchain/core/messages";
import {AsyncLocalStorageProviderSingleton} from "langsmith/singletons/traceable";
import {PrismaAgentMessageStore} from "nbook/server/agent/messages/prisma-agent-message-store";
import {toModelHistoryMessages} from "nbook/server/agent/messages/codec";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import {LeaderDefaultProfile} from "nbook/server/agent/profiles/builtin/leader-default.profile";
import {RetrievalProfile} from "nbook/server/agent/profiles/builtin/retrieval.profile";
import {WriterProfile} from "nbook/server/agent/profiles/builtin/writer.profile";
import {LocalSkillCatalogProvider, type SkillCatalogProvider} from "nbook/server/agent/skills/skill-catalog";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {AgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {InMemoryAgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {PrismaThreadRepository} from "nbook/server/agent/repositories/prisma-thread.repository";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import {LiveRunRegistry} from "nbook/server/agent/runtime/live-run-registry";
import {DefaultModelProvider} from "nbook/server/agent/runtime/model-provider";
import type {ModelProvider} from "nbook/server/agent/runtime/model-provider";
import {ThreadEventRegistry} from "nbook/server/agent/runtime/thread-event-registry";
import {AgentThreadRunner} from "nbook/server/agent/runtime/thread-runner";
import {LeaderThread} from "nbook/server/agent/threads/leader-thread";
import {SubAgentThread, type AnySubAgentThread} from "nbook/server/agent/threads/subagent-thread";
import {createSubagentTool} from "nbook/server/agent/tools/builtin/create-subagent.tool";
import {invokeSubagentTool} from "nbook/server/agent/tools/builtin/invoke-subagent.tool";
import {listSubagentsTool} from "nbook/server/agent/tools/builtin/list-subagents.tool";
import {enterPlanModeTool, exitPlanModeTool} from "nbook/server/agent/tools/builtin/plan-mode.tool";
import {requestUserInputTool} from "nbook/server/agent/tools/builtin/request-user-input.tool";
import {reportResultTool} from "nbook/server/agent/tools/builtin/report-result.tool";
import {skillTool} from "nbook/server/agent/tools/builtin/skill.tool";
import {taskCreateTool, taskSetStatusTool} from "nbook/server/agent/tools/builtin/task.tool";
import {createToolMessage, createToolResultMessage} from "nbook/server/agent/tools/shared/tool-message";
import {applyPatchTool} from "nbook/server/agent/tools/file/apply-patch.tool";
import {editFileTool} from "nbook/server/agent/tools/file/edit-file.tool";
import {readFileTool} from "nbook/server/agent/tools/file/read-file.tool";
import {writeFileTool} from "nbook/server/agent/tools/file/write-file.tool";
import {updateNovelTool} from "nbook/server/agent/tools/novel/update-novel.tool";
import {createStoryPlotTool} from "nbook/server/agent/tools/plot/create-story-plot.tool";
import {createStorySceneTool} from "nbook/server/agent/tools/plot/create-story-scene.tool";
import {createStoryThreadTool} from "nbook/server/agent/tools/plot/create-story-thread.tool";
import {getChapterPlotTool} from "nbook/server/agent/tools/plot/get-chapter-plot.tool";
import {getPlotTreeTool} from "nbook/server/agent/tools/plot/get-plot-tree.tool";
import {getStorySceneContextTool} from "nbook/server/agent/tools/plot/get-story-scene-context.tool";
import {getStoryThreadTool} from "nbook/server/agent/tools/plot/get-story-thread.tool";
import {updateStoryPlotTool} from "nbook/server/agent/tools/plot/update-story-plot.tool";
import {updateStorySceneTool} from "nbook/server/agent/tools/plot/update-story-scene.tool";
import {updateStoryThreadTool} from "nbook/server/agent/tools/plot/update-story-thread.tool";
import {executeSqlTool} from "nbook/server/agent/tools/sql/execute-sql.tool";
import {executeShellTool} from "nbook/server/agent/tools/shell/execute-shell.tool";
import {
    createPlanModePlanDirectoryPath,
} from "nbook/server/agent/plan-mode-path";
import {readFile} from "node:fs/promises";
import type {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {InMemoryAgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {AgentVariableStore} from "nbook/server/agent/store/agent-variable-store";
import type {AgentThreadGateway, AgentToolGateway} from "nbook/server/agent/contracts";
import {ThreadMessageService} from "nbook/server/agent/services/thread-message.service";
import {ThreadMutationService} from "nbook/server/agent/services/thread-mutation.service";
import {ThreadProjectionService} from "nbook/server/agent/services/thread-projection.service";
import {ThreadRunCoordinator} from "nbook/server/agent/services/thread-run-coordinator.service";
import {ThreadContextService} from "nbook/server/agent/services/thread-context.service";
import {ThreadTaskService} from "nbook/server/agent/services/thread-task.service";
import {loadAppConfigSync} from "nbook/server/utils/app-config";
import {normalizeThreadModelOverrideConfig, resolveConfiguredModel} from "nbook/server/utils/model";
import {
    normalizeAgentThreadUsageSummary,
    type AgentThreadMetadata,
    type AgentRunTurn,
    type AgentVariableScope,
    type AgentTaskList,
    type AgentTaskStatus,
    type AgentThreadModelOverride,
    type AgentThreadKind,
    type AgentStreamEvent,
    type AgentThreadStatus,
    type AgentThreadRecord,
    type AnySubAgentInput,
    type ClientVariables,
    type CreateLeaderThreadInput,
    type CreateSubAgentThreadInput,
    type JsonObject,
    type LeaderInput,
    type ProfileInputMap,
    type ProfileKey,
    type RunOptions,
    type SubAgentCompletionResult,
    type SubAgentProfileKey,
    type SubAgentThreadSummary,
    type ThreadId,
    type ThreadSummary,
    type LiveToolState,
} from "nbook/server/agent/types";
import {RequestUserInputToolAnswerSchema, RequestUserInputToolArgsSchema} from "nbook/shared/dto/agent-chat.dto";
import {z} from "zod";

const EMPTY_RUN_OPTIONS: RunOptions = {};
const APPROVAL_OPTION_INDEX = 0;
const PLAN_MODE_REMINDER_INTERVAL_TURNS = 10;
const ToolApprovalActionSchema = z.enum(["enter_plan_mode", "exit_plan_mode", "skill"]);
type ToolApprovalAction = z.infer<typeof ToolApprovalActionSchema>;
const SkillToolApprovalArgsSchema = z.object({
    skill: z.string().trim().min(1),
});

/**
 * AgentSystem。
 * 作为 `server/agent` 的主入口，对外暴露线程创建、上下文运行与 subagent 管理能力。
 */
export class AgentSystem implements AgentThreadGateway, AgentToolGateway {
    constructor(
        readonly threadRepository: ThreadRepository,
        readonly profileRegistry: AgentProfileRegistry,
        readonly toolRegistry: AgentToolRegistry,
        readonly modelProvider: ModelProvider,
        readonly threadRunner: AgentThreadRunner,
        readonly liveRuns: LiveRunRegistry,
        readonly threadEvents: ThreadEventRegistry,
        readonly messageStore: AgentMessageStore,
        readonly variableStore: AgentVariableStore,
        readonly skillCatalog: SkillCatalogProvider,
        readonly threadMessages: ThreadMessageService,
        readonly threadMutations: ThreadMutationService,
        readonly threadProjection: ThreadProjectionService,
        readonly threadRunCoordinator: ThreadRunCoordinator,
        readonly threadContext: ThreadContextService,
        readonly threadTasks: ThreadTaskService,
    ) {}

    /**
     * 创建默认 AgentSystem。
     */
    static createDefault(): AgentSystem {
        const profileRegistry = new InMemoryAgentProfileRegistry();
        profileRegistry.register(new LeaderDefaultProfile());
        profileRegistry.register(new WriterProfile());
        profileRegistry.register(new RetrievalProfile());

        const toolRegistry = new InMemoryAgentToolRegistry();
        toolRegistry.register(createSubagentTool);
        toolRegistry.register(listSubagentsTool);
        toolRegistry.register(invokeSubagentTool);
        toolRegistry.register(enterPlanModeTool);
        toolRegistry.register(exitPlanModeTool);
        toolRegistry.register(requestUserInputTool);
        toolRegistry.register(reportResultTool);
        toolRegistry.register(skillTool);
        toolRegistry.register(taskCreateTool);
        toolRegistry.register(taskSetStatusTool);
        toolRegistry.register(executeSqlTool);
        toolRegistry.register(executeShellTool);
        toolRegistry.register(readFileTool);
        toolRegistry.register(editFileTool);
        toolRegistry.register(applyPatchTool);
        toolRegistry.register(writeFileTool);
        toolRegistry.register(updateNovelTool);
        toolRegistry.register(getPlotTreeTool);
        toolRegistry.register(getStoryThreadTool);
        toolRegistry.register(getStorySceneContextTool);
        toolRegistry.register(getChapterPlotTool);
        toolRegistry.register(createStoryThreadTool);
        toolRegistry.register(updateStoryThreadTool);
        toolRegistry.register(createStorySceneTool);
        toolRegistry.register(updateStorySceneTool);
        toolRegistry.register(createStoryPlotTool);
        toolRegistry.register(updateStoryPlotTool);

        const modelProvider = new DefaultModelProvider();
        const threadRunner = new AgentThreadRunner(modelProvider);
        const messageStore = new PrismaAgentMessageStore();
        const threadRepository = new PrismaThreadRepository();
        const variableStore = new AgentVariableStore();
        const skillCatalog = new LocalSkillCatalogProvider();
        const liveRuns = new LiveRunRegistry();
        const threadEvents = new ThreadEventRegistry();
        const threadMessages = new ThreadMessageService(messageStore);
        const threadMutations = new ThreadMutationService(messageStore, threadRepository);
        const threadProjection = new ThreadProjectionService(threadRepository, threadMessages, liveRuns);
        const threadTasks = new ThreadTaskService(threadRepository);
        const threadContext = new ThreadContextService(
            threadRepository,
            profileRegistry,
            toolRegistry,
            variableStore,
        );
        let agentSystem!: AgentSystem;
        const threadRunCoordinator = new ThreadRunCoordinator({
            threadRunner,
            threadRepository,
            threadEvents,
            threadMessages,
            refreshThreadAgentScope: async (threadId) => agentSystem.refreshThreadAgentScope(threadId),
            subscribeThreadActive: (threadId) => agentSystem.subscribeThreadActive(threadId),
            loadThreadHistoryMessages: async (threadId) => agentSystem.loadThreadHistoryMessages(threadId),
            publishHistorySnapshot: async (threadId) => agentSystem.publishHistorySnapshot(threadId),
            publishThreadSnapshot: async (threadId) => agentSystem.publishThreadSnapshot(threadId),
            closeRun: (threadId) => liveRuns.close(threadId),
            stringifyError: (error) => agentSystem.stringifyError(error),
            isAbortError: (error) => agentSystem.isAbortError(error),
        });

        agentSystem = new AgentSystem(
            threadRepository,
            profileRegistry,
            toolRegistry,
            modelProvider,
            threadRunner,
            liveRuns,
            threadEvents,
            messageStore,
            variableStore,
            skillCatalog,
            threadMessages,
            threadMutations,
            threadProjection,
            threadRunCoordinator,
            threadContext,
            threadTasks,
        );
        return agentSystem;
    }

    /**
     * 创建 leader thread。
     */
    async createLeaderThread(input: CreateLeaderThreadInput = {}): Promise<LeaderThread> {
        const record = await this.threadRepository.createLeader(input);
        return this.toLeaderThread(record);
    }

    /**
     * 列出线程摘要。
     */
    async listThreads(kind: AgentThreadKind = "leader"): Promise<ThreadSummary[]> {
        const threads = await this.threadRepository.listThreads(kind);
        return Promise.all(threads.map(async (thread) => this.threadProjection.enrichThreadSummary(thread)));
    }

    /**
     * 更新线程模型覆盖。
     */
    async updateThreadModelOverride(threadId: ThreadId, modelOverride: AgentThreadModelOverride | null, legacyModelKey?: string | null): Promise<ThreadSummary> {
        const thread = await this.requireThread(threadId);
        const normalizedModelOverride = normalizeThreadModelOverrideConfig(modelOverride) ?? (
            legacyModelKey?.trim()
                ? {
                modelKey: legacyModelKey.trim(),
                temperature: null,
                topK: null,
                reasoningEffort: null,
                stream: true,
            }
                : null
        );

        if (normalizedModelOverride?.modelKey) {
            const appConfig = loadAppConfigSync();
            if (!resolveConfiguredModel(appConfig.models, normalizedModelOverride.modelKey)) {
                throw new Error(`模型 ${normalizedModelOverride.modelKey} 不存在或未启用`);
            }
        }

        const nextMetadata = {
            ...thread.metadata,
            modelOverride: normalizedModelOverride,
            modelOverrideKey: undefined,
        };
        const updated = await this.threadRepository.updateMetadata(threadId, nextMetadata);
        const detail = await this.threadProjection.getThreadDetail(threadId);
        return detail?.thread ?? this.toThreadSummary(updated);
    }

    /**
     * 读取 leader thread。
     */
    async getLeaderThread(threadId: ThreadId): Promise<LeaderThread> {
        const record = await this.requireThread(threadId);
        if (record.kind !== "leader") {
            throw new Error(`thread ${threadId} 不是 leader`);
        }
        return this.toLeaderThread(record);
    }

    /**
     * 读取 subagent thread。
     */
    async getSubAgentThread(threadId: ThreadId): Promise<AnySubAgentThread> {
        const record = await this.requireThread(threadId);
        if (record.kind !== "subagent") {
            throw new Error(`thread ${threadId} 不是 subagent`);
        }
        return this.toSubAgentThread(record);
    }

    /**
     * 删除线程。
     */
    async deleteThread(threadId: ThreadId): Promise<void> {
        await this.messageStore.deleteThread(threadId);
        await this.threadRepository.delete(threadId);
        this.variableStore.deleteScope(threadId);
        this.threadEvents.cleanup(threadId);
    }

    /**
     * 创建 subagent thread 并挂接到 leader。
     */
    async createSubAgentThread<TKey extends SubAgentProfileKey>(
        input: CreateSubAgentThreadInput<TKey>,
    ): Promise<SubAgentThread<TKey>> {
        const leader = await this.requireThread(input.leaderThreadId);
        if (leader.kind !== "leader") {
            throw new Error(`thread ${input.leaderThreadId} 不是 leader`);
        }

        const profile = this.profileRegistry.get(input.profileKey);
        if (profile.kind !== "subagent") {
            throw new Error(`profile ${input.profileKey} 不是 subagent profile`);
        }

        const created = await this.threadRepository.createSubAgent({
            profileKey: input.profileKey,
            title: input.title,
        });
        await this.threadRepository.attachSubAgent(input.leaderThreadId, String(created.id));
        await this.inheritClientScope(input.leaderThreadId, String(created.id));
        await this.refreshThreadAgentScope(input.leaderThreadId);
        await this.refreshThreadAgentScope(String(created.id));
        return this.toSubAgentThread(created) as SubAgentThread<TKey>;
    }

    /**
     * 将已有 subagent 挂接到 leader。
     */
    async attachSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId): Promise<void> {
        const leader = await this.requireThread(leaderThreadId);
        const subagent = await this.requireThread(subAgentThreadId);

        if (leader.kind !== "leader") {
            throw new Error(`thread ${leaderThreadId} 不是 leader`);
        }
        if (subagent.kind !== "subagent") {
            throw new Error(`thread ${subAgentThreadId} 不是 subagent`);
        }

        await this.threadRepository.attachSubAgent(leaderThreadId, subAgentThreadId);
        await this.inheritClientScope(leaderThreadId, subAgentThreadId);
        await this.refreshThreadAgentScope(leaderThreadId);
        await this.refreshThreadAgentScope(subAgentThreadId);
    }

    /**
     * 同步某个线程的前端变量快照。
     */
    async syncClientVariables(threadId: ThreadId, clientVariables: ClientVariables): Promise<AgentVariableScope> {
        const thread = await this.requireThread(threadId);
        const profileKey = this.requireProfileKey(thread.profileKey);
        return this.threadContext.syncClientVariables(threadId, clientVariables, thread, profileKey);
    }

    /**
     * 读取当前线程的变量快照。
     */
    getThreadScope<TKey extends ProfileKey>(threadId: ThreadId): AgentVariableScope<TKey> {
        return this.threadContext.getThreadScope(threadId);
    }

    /**
     * 将 source 线程的 ide/studio 作用域同步到 target 线程。
     * 主要用于 leader 通过服务端直接调用 subagent 时，补齐原本由 HTTP Header 传入的上下文。
     */
    private async inheritClientScope(sourceThreadId: ThreadId, targetThreadId: ThreadId): Promise<void> {
        const targetThread = await this.requireThread(targetThreadId);
        const targetProfileKey = this.requireProfileKey(targetThread.profileKey);
        await this.threadContext.inheritClientScope(sourceThreadId, targetThreadId, targetThread, targetProfileKey);
    }

    /**
     * 由 tool 显式更新 ide 命名空间。
     */
    patchToolIdeScope(threadId: ThreadId, patch: JsonObject): AgentVariableScope {
        return this.threadContext.patchToolIdeScope(threadId, patch);
    }

    /**
     * 由 tool 显式更新 studio 命名空间。
     */
    patchToolStudioScope(threadId: ThreadId, patch: JsonObject): AgentVariableScope {
        return this.threadContext.patchToolStudioScope(threadId, patch);
    }

    /**
     * 进入当前线程软 Plan Mode。
     */
    async enterPlanMode(threadId: ThreadId): Promise<void> {
        const thread = await this.requireThread(threadId);
        await this.threadRepository.updateMetadata(threadId, {
            ...thread.metadata,
            planMode: {
                active: true,
                enteredAt: new Date().toISOString(),
                turnsSinceReminder: 0,
                reminderCount: 0,
                needsExitReminder: false,
                hasExited: thread.metadata.planMode?.hasExited ?? false,
            },
        });
        await this.refreshThreadAgentScope(threadId);
        await this.publishThreadSnapshot(threadId);
    }

    /**
     * 退出当前线程软 Plan Mode。
     */
    async exitPlanMode(threadId: ThreadId): Promise<void> {
        const thread = await this.requireThread(threadId);
        await this.threadRepository.updateMetadata(threadId, {
            ...thread.metadata,
            planMode: {
                active: false,
                enteredAt: thread.metadata.planMode?.enteredAt,
                turnsSinceReminder: 0,
                reminderCount: thread.metadata.planMode?.reminderCount ?? 0,
                needsExitReminder: true,
                hasExited: true,
            },
        });
        await this.refreshThreadAgentScope(threadId);
        await this.publishThreadSnapshot(threadId);
    }

    /**
     * 初始化或整体重建当前线程任务列表。
     */
    async createTaskList(threadId: ThreadId, input: {
        title?: string;
        steps: Array<{
            id: string;
            text: string;
            status: AgentTaskStatus;
        }>;
    }): Promise<AgentTaskList> {
        const result = await this.threadTasks.createTaskList(threadId, input);
        await this.refreshThreadAgentScope(threadId);
        await this.publishThreadSnapshot(threadId);
        return result;
    }

    /**
     * 更新当前线程任务步骤状态。
     */
    async setTaskStatus(threadId: ThreadId, input: {
        id: string;
        status: AgentTaskStatus;
        note?: string;
    }): Promise<AgentTaskList> {
        const result = await this.threadTasks.setTaskStatus(threadId, input);
        await this.refreshThreadAgentScope(threadId);
        await this.publishThreadSnapshot(threadId);
        return result;
    }

    /**
     * 列出 leader 当前管理的 subagent。
     */
    async listSubAgents(leaderThreadId: ThreadId): Promise<SubAgentThreadSummary[]> {
        return this.threadRepository.listSubAgents(leaderThreadId);
    }

    /**
     * 列出管理指定 subagent 的 leader。
     */
    async listManagingLeaders(subAgentThreadId: ThreadId): Promise<ThreadSummary[]> {
        return this.threadRepository.listManagingLeaders(subAgentThreadId);
    }

    /**
     * 读取线程完整历史。
     */
    async getThreadHistory(threadId: ThreadId) {
        return this.threadMessages.loadThreadHistory(threadId);
    }

    /**
     * 创建新的用户消息节点。
     */
    async createThreadMessage(threadId: ThreadId, content: string): Promise<void> {
        await this.threadMutations.createUserMessage(threadId, content);
        await this.publishHistorySnapshot(threadId);
    }

    /**
     * 提交 request_user_input 的答案，并继续执行线程。
     */
    async submitUserInputAnswers(
        threadId: ThreadId,
        input: {
            assistantMessageId: string;
            answers: Array<{
                toolNodeId: string;
                questionIndex?: number;
                selectedOptionIndex?: number;
                selectedOptionIndexes?: number[];
                note?: string;
                ignored?: boolean;
            }>;
            resume?: boolean;
        },
    ): Promise<void> {
        const thread = await this.requireThread(threadId);
        const pendingSession = thread.metadata.pendingUserInputSession;
        if (!pendingSession || thread.runStatus !== "waiting_user") {
            throw new Error("当前线程没有待回答的问题");
        }
        if (pendingSession.assistantMessageId !== input.assistantMessageId) {
            throw new Error("assistantMessageId 与当前待回答问题不匹配");
        }

        const shouldResume = input.resume ?? true;
        const answerKey = (toolNodeId: string, questionIndex?: number): string => `${toolNodeId}\n${questionIndex ?? -1}`;
        const answersByQuestionKey = new Map(input.answers.map((answer) => [answerKey(answer.toolNodeId, answer.questionIndex), answer]));
        if (answersByQuestionKey.size !== input.answers.length) {
            throw new Error("answers 中存在重复的问题答案");
        }

        if (shouldResume) {
            for (const question of pendingSession.questions) {
                const answer = answersByQuestionKey.get(answerKey(question.toolNodeId, question.questionIndex));
                if (!answer) {
                    throw new Error(`问题 ${question.questionIndex + 1} 缺少答案`);
                }
            }
        }

        for (const answer of input.answers) {
            if (!pendingSession.questions.some((question) => question.toolNodeId === answer.toolNodeId && question.questionIndex === answer.questionIndex)) {
                throw new Error(`问题 ${answer.questionIndex ?? answer.toolNodeId} 不属于当前待回答会话`);
            }
        }

        const answeredQuestionKeys = new Set<string>();
        const targetQuestions = pendingSession.questions.filter((item) => answersByQuestionKey.has(answerKey(item.toolNodeId, item.questionIndex)));
        const targetToolNodeIds = new Set(targetQuestions.map((question) => question.toolNodeId));
        for (const toolNodeId of targetToolNodeIds) {
            const toolQuestions = pendingSession.questions.filter((question) => question.toolNodeId === toolNodeId);
            const hasAllToolAnswers = toolQuestions.every((question) => answersByQuestionKey.has(answerKey(question.toolNodeId, question.questionIndex)));
            if (!hasAllToolAnswers) {
                continue;
            }
            const firstQuestion = toolQuestions[0]!;
            const toolArgs = RequestUserInputToolArgsSchema.parse(JSON.parse(firstQuestion.toolArgsText));
            const contentParts: string[] = [];
            const rawAnswers: JsonObject[] = [];
            const isToolApproval = firstQuestion.kind === "tool_approval";
            let approvedToolAction = false;

            for (const question of toolQuestions) {
                const answer = RequestUserInputToolAnswerSchema.parse(answersByQuestionKey.get(answerKey(question.toolNodeId, question.questionIndex)));
                const toolQuestion = toolArgs.questions[question.questionIndex];
                if (!toolQuestion) {
                    throw new Error(`问题 ${question.questionIndex + 1} 不存在`);
                }
                const note = answer.note?.trim();
                let answerContent = `${toolQuestion.question}\n用户忽略了该问题，未提供答案。`;
                let rawAnswer: JsonObject = {
                    questionIndex: question.questionIndex,
                    ignored: true,
                };

                if (!answer.ignored) {
                    if (toolQuestion.options.length === 0) {
                        const openAnswer = note ?? "";
                        answerContent = `${toolQuestion.question}\n回答：${openAnswer}`;
                        rawAnswer = {
                            questionIndex: question.questionIndex,
                            note: openAnswer,
                        };
                    } else {
                        const selectedOptionIndexes = answer.selectedOptionIndexes?.length
                            ? answer.selectedOptionIndexes
                            : answer.selectedOptionIndex !== undefined
                                ? [answer.selectedOptionIndex]
                                : [];
                        if (selectedOptionIndexes.length === 0) {
                            throw new Error(`问题 ${question.questionIndex + 1} 必须选择选项`);
                        }
                        if (!toolQuestion.multiSelect && selectedOptionIndexes.length > 1) {
                            throw new Error(`问题 ${question.questionIndex + 1} 不允许多选`);
                        }
                        for (const selectedOptionIndex of selectedOptionIndexes) {
                            if (selectedOptionIndex !== -1 && !toolQuestion.options[selectedOptionIndex]) {
                                throw new Error(`问题 ${question.questionIndex + 1} 的选项 ${selectedOptionIndex} 不存在`);
                            }
                        }

                        const optionLabels = selectedOptionIndexes.map((selectedOptionIndex) => selectedOptionIndex === -1
                            ? "Additional suggestion"
                            : toolQuestion.options[selectedOptionIndex]?.label ?? String(selectedOptionIndex));
                        if (isToolApproval) {
                            approvedToolAction = selectedOptionIndexes.includes(APPROVAL_OPTION_INDEX);
                        }
                        answerContent = note
                            ? `${toolQuestion.question}\n选择：${optionLabels.join("、")}\n备注：${note}`
                            : `${toolQuestion.question}\n选择：${optionLabels.join("、")}`;
                        rawAnswer = {
                            questionIndex: question.questionIndex,
                            ...(toolQuestion.multiSelect ? {selectedOptionIndexes} : {selectedOptionIndex: selectedOptionIndexes[0] ?? -1}),
                            ...(note ? {note} : {}),
                        };
                    }
                }
                contentParts.push(answerContent);
                rawAnswers.push(rawAnswer);
                answeredQuestionKeys.add(answerKey(question.toolNodeId, question.questionIndex));
            }
            let toolResultText = contentParts.join("\n\n");
            let rawResult: JsonObject = {answers: rawAnswers};

            if (isToolApproval && firstQuestion.approvalAction) {
                const approvalToolArgsText = firstQuestion.approvalAction === "exit_plan_mode"
                    ? JSON.stringify({
                        ...parseApprovalArgs(firstQuestion.approvalToolArgsText),
                        ...(firstQuestion.planFilePath ? {planFilePath: firstQuestion.planFilePath} : {}),
                        ...(firstQuestion.planContent !== undefined ? {planContent: firstQuestion.planContent} : {}),
                    })
                    : firstQuestion.approvalToolArgsText;
                const approvalResult = await this.applyToolApproval(
                    threadId,
                    ToolApprovalActionSchema.parse(firstQuestion.approvalAction),
                    approvedToolAction,
                    approvalToolArgsText,
                );
                toolResultText = firstQuestion.approvalAction === "exit_plan_mode" && !approvedToolAction
                    ? `${approvalResult.content}\n\n${contentParts.join("\n\n")}`
                    : approvalResult.content;
                rawResult = {
                    ...rawResult,
                    approved: approvedToolAction,
                    action: firstQuestion.approvalAction,
                    ...(approvalResult.planFilePath ?? firstQuestion.planFilePath
                        ? {planFilePath: approvalResult.planFilePath ?? firstQuestion.planFilePath}
                        : {}),
                    ...(approvalResult.planContent ?? firstQuestion.planContent
                        ? {
                            planPreviewKind: "exit_plan_mode",
                            planContent: approvalResult.planContent ?? firstQuestion.planContent,
                        }
                        : {}),
                };
            }
            const toolMessage = createToolMessage({
                toolCallId: firstQuestion.toolCallId ?? firstQuestion.toolNodeId,
                toolNodeId: firstQuestion.toolNodeId,
                assistantMessageId: pendingSession.assistantMessageId,
                toolName: firstQuestion.toolName,
                result: {
                    ...createToolResultMessage(toolResultText, firstQuestion.toolArgsText, "success"),
                    rawResult,
                },
            });
            await this.threadMessages.persistToolMessage(threadId, toolMessage, "success");
        }

        const remainingQuestions = shouldResume
            ? pendingSession.questions.filter((question) => !answeredQuestionKeys.has(answerKey(question.toolNodeId, question.questionIndex)))
            : [];
        const pendingUserInputSession = remainingQuestions.length > 0
            ? {
                ...pendingSession,
                questions: remainingQuestions,
            }
            : null;
        const nextRunStatus: AgentThreadStatus = shouldResume
            ? pendingUserInputSession ? "waiting_user" : "idle"
            : "stopped";
        const latestThread = await this.requireThread(threadId);
        await this.threadRepository.updateMetadata(threadId, {
            ...latestThread.metadata,
            pendingUserInputSession,
        });
        await this.threadRepository.updateRunStatus(threadId, nextRunStatus);
        await this.publishHistorySnapshot(threadId);
        await this.refreshThreadAgentScope(threadId);
        await this.publishThreadSnapshot(threadId);
        if (!shouldResume) {
            this.threadEvents.publish(threadId, {
                type: "run_state",
                threadId,
                status: "stopped",
            });
            return;
        }
        await this.dispatchThreadRunById(threadId, {mode: "continue"});
    }

    /**
     * 应用需要用户审批的内部工具动作。
     */
    private async applyToolApproval(
        threadId: ThreadId,
        action: ToolApprovalAction,
        approved: boolean,
        approvalToolArgsText?: string,
    ): Promise<{
        content: string;
        planFilePath?: string;
        planContent?: string;
    }> {
        const scope = await this.threadContext.getThreadScope(threadId);
        if (action === "skill") {
            const skillArgs = SkillToolApprovalArgsSchema.parse(JSON.parse(approvalToolArgsText || "{}"));
            if (!approved) {
                return {
                    content: `User rejected loading skill "${skillArgs.skill}". Continue without this skill.`,
                };
            }
            return {
                content: await this.readApprovedSkill(skillArgs.skill),
            };
        }
        const approvalArgs = parseApprovalArgs(approvalToolArgsText);
        const planFilePath = typeof approvalArgs.planFilePath === "string" && approvalArgs.planFilePath.trim()
            ? approvalArgs.planFilePath
            : undefined;
        const planContent = typeof approvalArgs.planContent === "string"
            ? approvalArgs.planContent
            : undefined;
        const planDirectoryPath = createPlanModePlanDirectoryPath(scope, threadId);
        if (!approved) {
            return {
                ...(planFilePath ? {planFilePath} : {}),
                content: action === "enter_plan_mode"
                    ? "User rejected entering Plan Mode."
                    : planFilePath
                        ? `User rejected exiting Plan Mode. Continue planning in ${planFilePath}.`
                        : `User rejected exiting Plan Mode. Continue planning in chat; use ${planDirectoryPath} only if a plan file is useful.`,
            };
        }
        if (action === "enter_plan_mode") {
            const latestThread = await this.requireThread(threadId);
            await this.threadRepository.updateMetadata(threadId, {
                ...latestThread.metadata,
                planMode: {
                    active: true,
                    enteredAt: new Date().toISOString(),
                    turnsSinceReminder: 0,
                    reminderCount: 0,
                    needsExitReminder: false,
                    hasExited: latestThread.metadata.planMode?.hasExited ?? false,
                },
            });
            await this.refreshThreadAgentScope(threadId);
            await this.publishThreadSnapshot(threadId);
            return {
                content: `User approved entering Plan Mode. Plan Mode is now active. Plan visibly in chat; use ${planDirectoryPath} only if a Markdown plan file is useful.`,
            };
        }

        await this.exitPlanMode(threadId);
        return {
            ...(planFilePath ? {planFilePath} : {}),
            content: planFilePath
                ? `User approved exiting Plan Mode. The approved plan file is ${planFilePath}.`
                : "User approved exiting Plan Mode. No plan file preview was attached; use the visible chat plan as the approved plan.",
            ...(planContent ? {planContent} : {}),
        };
    }

    /**
     * 读取用户批准启用的 skill 内容。
     */
    private async readApprovedSkill(skillName: string): Promise<string> {
        const skillItem = (await this.skillCatalog.list()).find((item) => item.name === skillName);
        if (!skillItem) {
            return `Skill "${skillName}" was approved, but no catalog entry with that exact name was found. Use the exact original skill name from the catalog; Chinese names are allowed and must not be translated.`;
        }

        const skillContent = await readFile(skillItem.location, "utf-8");
        return [
            `Skill "${skillItem.name}" loaded.`,
            `location: ${skillItem.displayLocation ?? skillItem.location}`,
            "",
            "---",
            skillItem.headerText.trim(),
            "---",
            "",
            skillContent.trim() ? `SKILL.md\n${skillContent.trim()}` : "SKILL.md\n(empty)",
        ].join("\n");
    }

    /**
     * 改写一条历史消息。
     */
    async updateThreadMessage(threadId: ThreadId, messageId: string, content: string): Promise<void> {
        await this.threadMutations.updateMessage(threadId, messageId, content);
        await this.publishHistorySnapshot(threadId);
    }

    /**
     * 刷新一条历史消息。
     */
    async refreshThreadMessage(threadId: ThreadId, messageId: string): Promise<void> {
        await this.threadMutations.refreshMessage(threadId, messageId);
        await this.publishHistorySnapshot(threadId);
    }

    /**
     * 回退一条历史消息。
     */
    async rollbackThreadMessage(threadId: ThreadId, messageId: string): Promise<void> {
        await this.threadMutations.rollbackMessage(threadId, messageId);
        await this.publishHistorySnapshot(threadId);
    }

    /**
     * 激活指定 continuation 节点。
     */
    async activateThreadMessage(threadId: ThreadId, messageId: string): Promise<void> {
        await this.threadMutations.activateMessage(threadId, messageId);
        await this.publishHistorySnapshot(threadId);
    }

    /**
     * 查询线程详情投影。
     */
    async getThreadDetailProjection(threadId: ThreadId) {
        return this.threadProjection.getThreadDetail(threadId);
    }

    /**
     * 查询线程首帧快照投影。
     */
    async getThreadSnapshotProjection(threadId: ThreadId) {
        return this.threadProjection.getThreadSnapshot(threadId);
    }

    /**
     * 订阅当前线程活跃任务。
     */
    subscribeThreadActive(threadId: ThreadId): AsyncIterable<AgentStreamEvent> {
        const session = this.liveRuns.get(threadId);
        if (!session) {
            return this.createEmptyStream();
        }
        return session.subscribe(true);
    }

    /**
     * 订阅 thread 级事件流。
     */
    subscribeThreadStream(threadId: ThreadId): AsyncIterable<AgentStreamEvent> {
        return this.threadEvents.subscribe(threadId);
    }

    /**
     * 获取当前活跃运行快照。
     */
    getThreadActiveRun(threadId: ThreadId): {threadId: ThreadId; status: AgentThreadStatus; messageId: string; text: string; thinkingText: string; tools: LiveToolState[]} | null {
        const session = this.liveRuns.get(threadId);
        if (!session) {
            return null;
        }

        return {
            threadId,
            status: session.snapshot.status,
            messageId: session.snapshot.messageId,
            text: session.snapshot.text,
            thinkingText: session.snapshot.thinkingText,
            tools: session.snapshot.tools,
        };
    }

    /**
     * 主动停止当前活跃 run。
     */
    async stopThreadRun(threadId: ThreadId): Promise<boolean> {
        const session = this.liveRuns.get(threadId);
        if (session) {
            session.stop();
            return true;
        }

        const thread = await this.requireThread(threadId);
        if (thread.runStatus !== "running" && thread.runStatus !== "waiting_user") {
            return false;
        }
        if (thread.runStatus === "waiting_user" && thread.metadata.pendingUserInputSession) {
            await this.threadRepository.updateMetadata(threadId, {
                ...thread.metadata,
                pendingUserInputSession: null,
            });
        }

        await this.threadRepository.touchAfterRun(threadId, {
            summary: thread.lastMessagePreview || "执行已停止",
            status: "stopped",
        });
        await this.refreshThreadAgentScope(threadId);
        await this.publishThreadSnapshot(threadId);
        this.threadEvents.publish(threadId, {
            type: "run_state",
            threadId,
            status: "stopped",
        });
        return true;
    }

    /**
     * 由工具执行过程主动推送输出增量。
     */
    publishToolOutputDelta(threadId: ThreadId, toolCallId: string, chunkText: string): void {
        if (!chunkText) {
            return;
        }
        const session = this.liveRuns.get(threadId);
        if (!session) {
            return;
        }
        const toolState = session.appendToolOutput(toolCallId, chunkText);
        if (!toolState) {
            return;
        }
        this.publishRunEvent(session, {
            type: "tool_output_delta",
            threadId,
            assistantMessageId: toolState.assistantMessageId,
            toolNodeId: toolState.toolNodeId,
            outputChunk: chunkText,
        });
    }

    /**
     * 派发 leader 任务。
     */
    async dispatchLeaderRun(leaderThreadId: ThreadId, input: LeaderInput, options: RunOptions = EMPTY_RUN_OPTIONS): Promise<void> {
        await this.dispatchThreadRun(leaderThreadId, input, "leader", options);
    }

    /**
     * 收集 leader 任务结果。
     */
    async runLeader(leaderThreadId: ThreadId, input: LeaderInput, options: RunOptions = EMPTY_RUN_OPTIONS): Promise<BaseMessage[]> {
        await this.dispatchLeaderRun(leaderThreadId, input, options);
        return this.threadRunCoordinator.collectActiveMessages(leaderThreadId);
    }

    /**
     * 通过 leader 调用 subagent。
     * 这里按 threadId 调用时只能做运行时校验，无法在编译期自动推断具体输入。
     */
    async runSubAgent(
        leaderThreadId: ThreadId,
        subAgentThreadId: ThreadId,
        input: AnySubAgentInput,
        options: RunOptions = EMPTY_RUN_OPTIONS,
    ): Promise<SubAgentCompletionResult> {
        await this.threadRepository.assertLeaderManagesSubAgent(leaderThreadId, subAgentThreadId);
        await this.inheritClientScope(leaderThreadId, subAgentThreadId);
        return this.runDetachedSubAgent(subAgentThreadId, input, this.toSubAgentRunOptions(options));
    }

    /**
     * 过滤 leader 线程本地运行选项，避免 subagent 复用 leader 消息锚点。
     */
    private toSubAgentRunOptions(_options: RunOptions): RunOptions {
        return {};
    }

    /**
     * 派发 subagent 任务。
     */
    async dispatchDetachedSubAgent<TKey extends SubAgentProfileKey = SubAgentProfileKey>(
        subAgentThreadId: ThreadId,
        input: ProfileInputMap[TKey],
        options: RunOptions = EMPTY_RUN_OPTIONS,
    ): Promise<void> {
        await this.runOutsideActiveTrace(async () => {
            await this.dispatchThreadRun(subAgentThreadId, input, "subagent", options);
        });
    }

    /**
     * 按 threadId 派发运行。
     * API 层使用这个入口即可，不需要自己判断 leader/subagent。
     */
    async dispatchThreadRunById(
        threadId: ThreadId,
        input: Record<string, unknown> | LeaderInput,
        options: RunOptions = EMPTY_RUN_OPTIONS,
    ): Promise<void> {
        const thread = await this.requireThread(threadId);
        if (thread.kind === "leader") {
            await this.dispatchLeaderRun(threadId, this.normalizeLeaderInput(input), options);
            return;
        }
        await this.dispatchDetachedSubAgent(threadId, input as AnySubAgentInput, options);
    }

    /**
     * 收集 subagent 任务结果。
     */
    async runDetachedSubAgent<TKey extends SubAgentProfileKey = SubAgentProfileKey>(
        subAgentThreadId: ThreadId,
        input: ProfileInputMap[TKey],
        options: RunOptions = EMPTY_RUN_OPTIONS,
    ): Promise<SubAgentCompletionResult<TKey>> {
        await this.runOutsideActiveTrace(async () => {
            await this.dispatchDetachedSubAgent(subAgentThreadId, input, options);
        });
        return this.threadRunCoordinator.collectSubAgentCompletion(subAgentThreadId) as Promise<SubAgentCompletionResult<TKey>>;
    }

    /**
     * 派发线程任务。
     */
    private async dispatchThreadRun<TKey extends ProfileKey>(
        threadId: ThreadId,
        input: ProfileInputMap[TKey] | AnySubAgentInput,
        expectedKind: "leader" | "subagent",
        options: RunOptions,
    ): Promise<void> {
        let thread = await this.requireThread(threadId);
        if (thread.kind !== expectedKind) {
            throw new Error(`thread ${threadId} 不是 ${expectedKind}`);
        }
        if (this.liveRuns.get(threadId) || thread.runStatus === "running" || thread.runStatus === "waiting_user") {
            throw new Error(`thread ${threadId} 当前已有活跃 run`);
        }

        const parsedOptions = options;
        const profileKey = this.requireProfileKey(thread.profileKey) as TKey;
        const profile = this.profileRegistry.get(profileKey);
        const parsedInput = profile.inputSchema.parse(input) as ProfileInputMap[TKey];
        const runTurn = parsedOptions.turn ?? await this.resolveRunTurn(thread, parsedInput);
        const planModeRunState = await this.preparePlanModeForRun(thread, runTurn);
        thread = planModeRunState.thread;
        const runtimeOptions: RunOptions = {
            ...parsedOptions,
            turn: runTurn,
            ...(planModeRunState.reminder ? {planModeReminder: planModeRunState.reminder} : {}),
            ...(planModeRunState.commitMetadata ? {planModeCommitMetadata: planModeRunState.commitMetadata} : {}),
        };
        const scope = await this.threadContext.refreshThreadScope(thread, profile, parsedInput);
        const runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>> = {
            thread,
            profile,
            input: parsedInput,
            scope,
            skillCatalog: await this.skillCatalog.list(),
            options: runtimeOptions,
            messageStore: this.messageStore,
            loadHistoryMessages: async () => this.loadThreadHistoryMessages(String(thread.id)),
            threadRepository: this.threadRepository,
            variableStore: this.variableStore,
        };
        const tools = await this.threadContext.resolveProfileTools({
            agentGateway: this,
            thread,
            profile,
            profileKey: this.requireProfileKey(thread.profileKey),
            options: runtimeOptions,
            loadThreadHistoryMessages: async (targetThreadId) => this.loadThreadHistoryMessages(targetThreadId),
        });
        const session = this.liveRuns.open(threadId, profileKey);

        await this.threadRepository.updateRunStatus(threadId, "running");
        await this.refreshThreadAgentScope(threadId);
        session.setStatus("running");
        this.publishRunEvent(session, {
            type: "run_state",
            threadId,
            status: "running",
        });

        void this.threadRunCoordinator.runThread(thread, runtime, tools, session);
    }

    /**
     * 计算本轮 Plan Mode reminder，并返回送达模型后才应提交的 metadata。
     */
    private async preparePlanModeForRun(thread: AgentThreadRecord, runTurn: AgentRunTurn): Promise<{
        thread: AgentThreadRecord;
        reminder?: NonNullable<RunOptions["planModeReminder"]>;
        commitMetadata?: AgentThreadMetadata;
    }> {
        const planMode = thread.metadata.planMode;
        if (!planMode) {
            return {thread};
        }

        if (planMode.needsExitReminder) {
            const commitMetadata: AgentThreadMetadata = {
                planMode: {
                    ...planMode,
                    needsExitReminder: false,
                },
            };
            return {
                thread,
                reminder: "exit",
                commitMetadata,
            };
        }

        if (!planMode.active) {
            return {thread};
        }

        const isFirstReminder = planMode.reminderCount === 0;
        if (!isFirstReminder && isTaskListCompleted(thread.metadata.tasks)) {
            return {thread};
        }
        if (!isFirstReminder && runTurn.kind !== "new_user_turn") {
            return {thread};
        }

        const isReminderTurn = isFirstReminder || planMode.turnsSinceReminder + 1 >= PLAN_MODE_REMINDER_INTERVAL_TURNS;
        if (!isReminderTurn) {
            const commitMetadata: AgentThreadMetadata = {
                planMode: {
                    ...planMode,
                    turnsSinceReminder: planMode.turnsSinceReminder + 1,
                },
            };
            return {
                thread,
                commitMetadata,
            };
        }

        const nextReminderCount = planMode.reminderCount + 1;
        const reminder = planMode.hasExited && planMode.reminderCount === 0
            ? "reentry_full"
                : isFirstReminder || nextReminderCount % 5 === 0
                ? "full"
                : "sparse";
        const commitMetadata: AgentThreadMetadata = {
            planMode: {
                ...planMode,
                turnsSinceReminder: 0,
                reminderCount: nextReminderCount,
            },
        };
        return {
            thread,
            reminder,
            commitMetadata,
        };
    }

    /**
     * 解析本次运行对应的用户可见 Turn。
     * LangChain 的 ReAct loop 可能因为 request_user_input/审批恢复多次 dispatch，
     * 这里用当前活动路径尾部是否为用户消息来区分新用户 Turn 与同 Turn resume。
     */
    private async resolveRunTurn<TKey extends ProfileKey>(
        thread: AgentThreadRecord,
        input: ProfileInputMap[TKey] | AnySubAgentInput,
    ): Promise<AgentRunTurn> {
        const history = await this.loadThreadHistoryMessages(String(thread.id));
        const lastMessage = history.at(-1);
        const lastMessageIsLegacyTailUserInput = Boolean(
            lastMessage
            && lastMessage._getType() === "human"
            && !this.isMarkedUserInput(lastMessage.additional_kwargs),
        );
        const userTurnCount = history.filter((message, index) => (
            this.isMarkedUserInput(message.additional_kwargs)
            || (index === history.length - 1 && lastMessageIsLegacyTailUserInput)
        )).length;
        const isContinue = Boolean(
            typeof input === "object"
            && input !== null
            && "mode" in input
            && input.mode === "continue",
        );

        if (isContinue) {
            const anchorMessageId = lastMessage?._getType() === "human"
                && (this.isMarkedUserInput(lastMessage.additional_kwargs) || lastMessageIsLegacyTailUserInput)
                ? this.readMessageId(lastMessage.additional_kwargs)
                : null;
            return anchorMessageId
                ? {
                    kind: "new_user_turn",
                    turnIndex: userTurnCount,
                    anchorMessageId,
                }
                : {
                    kind: "resume_turn",
                    turnIndex: userTurnCount,
                };
        }

        return {
            kind: "new_user_turn",
            turnIndex: userTurnCount + 1,
        };
    }

    /**
     * 从 LangChain 消息 metadata 读取产品消息 id。
     */
    private readMessageId(additionalKwargs: BaseMessage["additional_kwargs"] | undefined): string | null {
        const messageId = additionalKwargs?.messageId;
        return typeof messageId === "string" ? messageId : null;
    }

    /**
     * 判断消息是否为真实用户输入，而不是 AppendingSet 生成的 human context。
     */
    private isMarkedUserInput(additionalKwargs: BaseMessage["additional_kwargs"] | undefined): boolean {
        return additionalKwargs?.userInput === true
            || additionalKwargs?.messageOrigin === "user_input";
    }

    /**
     * 只刷新 agent 命名空间。
     * 用于 API 查询、subagent 变更、run 状态变更等场景。
     */
    private async refreshThreadAgentScope(threadId: ThreadId): Promise<AgentVariableScope> {
        const thread = await this.requireThread(threadId);
        const profileKey = this.requireProfileKey(thread.profileKey);
        return this.threadContext.refreshThreadAgentScope(threadId, thread, profileKey);
    }

    /**
     * 在空 trace 上下文中执行异步任务。
     * 用于切断 leader tool 内部再起 subagent 时的 LangSmith run tree 继承，
     * 防止 nested stream events 被父线程重新包装后发到 leader /stream。
     */
    private async runOutsideActiveTrace<T>(task: () => Promise<T>): Promise<T> {
        const asyncLocalStorage = AsyncLocalStorageProviderSingleton.getInstance();
        return new Promise<T>((resolve, reject) => {
            asyncLocalStorage.run(undefined, () => {
                void task().then(resolve).catch(reject);
            });
        });
    }

    /**
     * 读取当前活跃分支历史，并转换为 LangChain 消息。
     */
    private async loadThreadHistoryMessages(threadId: ThreadId): Promise<BaseMessage[]> {
        const messages = await this.threadMessages.loadThreadHistory(threadId);
        return toModelHistoryMessages(messages);
    }

    /**
     * 广播一次已提交历史树快照。
     */
    async publishHistorySnapshot(threadId: ThreadId): Promise<void> {
        const detail = await this.threadProjection.getThreadDetail(threadId);
        if (!detail) {
            return;
        }
        this.threadEvents.publish(threadId, {
            type: "history_snapshot",
            threadId,
            conversationTree: detail.conversationTree,
        });
    }

    /**
     * 广播一次完整 thread 快照。
     * run 结束后用于刷新头部统计条等 thread 级信息。
     */
    async publishThreadSnapshot(threadId: ThreadId): Promise<void> {
        const detail = await this.threadProjection.getThreadDetail(threadId);
        if (!detail) {
            return;
        }
        this.threadEvents.publish(threadId, {
            type: "thread_snapshot",
            thread: detail.thread,
            subagents: detail.subagents,
            leaders: detail.leaders,
            conversationTree: detail.conversationTree,
            draft: null,
            pendingUserInputSession: detail.thread.pendingUserInputSession,
        });
    }

    /**
     * 同时向 live run 与 thread stream 广播一次运行期事件。
     */
    private publishRunEvent(session: {threadId: ThreadId; publish(event: AgentStreamEvent): void}, event: AgentStreamEvent): void {
        session.publish(event);
        this.threadEvents.publish(session.threadId, event);
    }

    /**
     * 规范化错误文本。
     */
    private stringifyError(error: unknown): string {
        return error instanceof Error ? error.message : String(error ?? "Agent 运行失败");
    }

    /**
     * 判断是否为主动停止导致的中断错误。
     */
    private isAbortError(error: unknown): boolean {
        if (error instanceof DOMException && error.name === "AbortError") {
            return true;
        }
        return error instanceof Error && error.name === "AbortError";
    }

    /**
     * 查找线程。
     */
    private async requireThread(threadId: ThreadId): Promise<AgentThreadRecord> {
        const thread = await this.threadRepository.findById(threadId);
        if (!thread) {
            throw new Error(`未找到 thread: ${threadId}`);
        }
        return thread;
    }

    /**
     * 校验并收窄 profileKey。
     */
    private requireProfileKey(profileKey: string): ProfileKey {
        if (
            profileKey === "leader.default"
            || profileKey === "subagent.writer"
            || profileKey === "subagent.retrieval"
        ) {
            return profileKey;
        }
        throw new Error(`未知的 profileKey: ${profileKey}`);
    }

    /**
     * 创建空流。
     */
    private async *createEmptyStream(): AsyncIterable<AgentStreamEvent> {}

    /**
     * 规范化 leader 输入，兼容 continue 模式。
     */
    private normalizeLeaderInput(input: Record<string, unknown> | LeaderInput): LeaderInput {
        if ("mode" in input && input.mode === "continue") {
            return {
                mode: "continue",
            };
        }
        return {
            mode: "prompt",
            prompt: String((input as {prompt?: unknown}).prompt ?? ""),
        };
    }

    /**
     * 包装 leader 线程对象。
     */
    private toLeaderThread(record: AgentThreadRecord): LeaderThread {
        return new LeaderThread(this, record);
    }

    /**
     * 包装 subagent 线程对象。
     */
    private toSubAgentThread(record: AgentThreadRecord): AnySubAgentThread {
        if (record.profileKey === "subagent.writer") {
            return new SubAgentThread<"subagent.writer">(this, record);
        }
        if (record.profileKey === "subagent.retrieval") {
            return new SubAgentThread<"subagent.retrieval">(this, record);
        }
        throw new Error(`未知的 subagent profileKey: ${record.profileKey}`);
    }

    /**
     * 线程记录投影为摘要。
     */
    private toThreadSummary(record: AgentThreadRecord): ThreadSummary {
        return {
            id: String(record.id),
            kind: record.kind,
            profileKey: this.requireProfileKey(record.profileKey),
            title: record.title,
            summary: record.lastMessagePreview,
            status: record.runStatus,
            modelOverride: record.metadata.modelOverride ?? null,
            modelOverrideKey: record.metadata.modelOverride?.modelKey ?? record.metadata.modelOverrideKey ?? null,
            usageSummary: normalizeAgentThreadUsageSummary(record.metadata.usageSummary),
            pendingUserInputSession: record.metadata.pendingUserInputSession ?? null,
            planMode: record.metadata.planMode ?? null,
            lastMessageAt: record.lastMessageAt,
        };
    }
}

/**
 * 解析审批工具参数中的 UI-only 字段。
 */
function parseApprovalArgs(input: string | undefined): Record<string, unknown> {
    if (!input?.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(input) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

/**
 * 判断 thread 级任务是否已经全部完成。
 */
function isTaskListCompleted(taskList: AgentTaskList | undefined): boolean {
    return Boolean(taskList && taskList.steps.every((step) => step.status === "completed"));
}















