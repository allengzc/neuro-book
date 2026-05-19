import type {BaseMessage} from "@langchain/core/messages";
import type {AgentToolGateway} from "nbook/server/agent/contracts";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {AgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {AgentVariableStore} from "nbook/server/agent/store/agent-variable-store";
import type {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {loadAppConfig, resolveEnabledToolNames} from "nbook/server/utils/app-config";
import type {
    AgentVariables,
    AgentVariableScope,
    ClientVariables,
    JsonObject,
    ProfileInputMap,
    ProfileKey,
    RunOptions,
    ThreadId,
    AgentThreadRecord,
} from "nbook/server/agent/types";

/**
 * 线程上下文服务。
 * 统一负责变量同步、agent scope 刷新、以及 profile tool 解析。
 */
export class ThreadContextService {
    constructor(
        private readonly threadRepository: ThreadRepository,
        private readonly profileRegistry: AgentProfileRegistry,
        private readonly toolRegistry: AgentToolRegistry,
        private readonly variableStore: AgentVariableStore,
    ) {}

    /**
     * 同步某个线程的前端变量快照。
     */
    async syncClientVariables(
        threadId: ThreadId,
        clientVariables: ClientVariables,
        thread: AgentThreadRecord,
        profileKey: ProfileKey,
    ): Promise<AgentVariableScope> {
        const profile = this.profileRegistry.get(profileKey);
        this.variableStore.setAgent(threadId, await this.buildAgentVariables(thread, profile));
        return this.variableStore.syncClientVariables(threadId, clientVariables);
    }

    /**
     * 将 source 线程的 ide/studio 作用域同步到 target 线程。
     */
    async inheritClientScope(
        sourceThreadId: ThreadId,
        targetThreadId: ThreadId,
        targetThread: AgentThreadRecord,
        targetProfileKey: ProfileKey,
    ): Promise<void> {
        const sourceScope = this.getThreadScope(sourceThreadId);
        await this.syncClientVariables(
            targetThreadId,
            this.buildClientVariablesFromScope(sourceScope),
            targetThread,
            targetProfileKey,
        );
    }

    /**
     * 读取当前线程的变量快照。
     */
    getThreadScope<TKey extends ProfileKey>(threadId: ThreadId): AgentVariableScope<TKey> {
        return this.variableStore.getScope(threadId);
    }

    /**
     * 由 tool 显式更新 ide 命名空间。
     */
    patchToolIdeScope(threadId: ThreadId, patch: JsonObject): AgentVariableScope {
        return this.variableStore.patchIdeScope(threadId, patch);
    }

    /**
     * 由 tool 显式更新 studio 命名空间。
     */
    patchToolStudioScope(threadId: ThreadId, patch: JsonObject): AgentVariableScope {
        return this.variableStore.patchStudioScope(threadId, patch);
    }

    /**
     * prepare 前刷新完整线程 scope。
     */
    async refreshThreadScope<TKey extends ProfileKey>(
        thread: AgentThreadRecord,
        profile: AgentProfile<TKey>,
        input: ProfileInputMap[TKey],
    ): Promise<AgentVariableScope<TKey>> {
        const agent = await this.buildAgentVariables(thread, profile);
        this.variableStore.setAgent(String(thread.id), agent);
        return this.variableStore.setInput(String(thread.id), input);
    }

    /**
     * 只刷新 agent 命名空间。
     */
    async refreshThreadAgentScope(threadId: ThreadId, thread: AgentThreadRecord, profileKey: ProfileKey): Promise<AgentVariableScope> {
        const profile = this.profileRegistry.get(profileKey);
        return this.variableStore.setAgent(threadId, await this.buildAgentVariables(thread, profile));
    }

    /**
     * 构造本轮工具上下文。
     */
    createToolContext<TKey extends ProfileKey>(input: {
        agentGateway: AgentToolGateway;
        thread: AgentThreadRecord;
        profile: AgentProfile<TKey>;
        profileKey: ProfileKey;
        options: RunOptions;
        loadThreadHistoryMessages(threadId: ThreadId): Promise<BaseMessage[]>;
    }) {
        return {
            agentGateway: input.agentGateway,
            threadId: String(input.thread.id),
            profileKey: input.profileKey,
            profile: input.profile as AgentProfile<ProfileKey>,
            runOptions: input.options,
            writeToolOutput: () => {},
            getHistory: async () => input.loadThreadHistoryMessages(String(input.thread.id)),
            getScope: () => this.getThreadScope(String(input.thread.id)),
            setIde: (patch: JsonObject) => this.patchToolIdeScope(String(input.thread.id), patch),
            setStudio: (patch: JsonObject) => this.patchToolStudioScope(String(input.thread.id), patch),
        };
    }

    /**
     * 解析 profile tools。
     */
    async resolveProfileTools<TKey extends ProfileKey>(input: {
        agentGateway: AgentToolGateway;
        thread: AgentThreadRecord;
        profile: AgentProfile<TKey>;
        profileKey: ProfileKey;
        options: RunOptions;
        loadThreadHistoryMessages(threadId: ThreadId): Promise<BaseMessage[]>;
    }) {
        const enabledToolKeys = await this.resolveEnabledToolKeys(input.profile.allowedToolKeys);

        return this.toolRegistry.resolveBoundTools(enabledToolKeys, this.createToolContext(input));
    }

    /**
     * 将内部变量快照还原为可复用的 clientVariables。
     */
    private buildClientVariablesFromScope(scope: AgentVariableScope): ClientVariables {
        return {
            ide: {
                ...scope.ide.extra,
                panel: scope.ide.panel,
                activePanel: scope.ide.activePanel,
                theme: scope.ide.theme,
            },
            studio: {
                ...scope.studio.extra,
                novelId: scope.studio.novelId,
                selectedChapterId: scope.studio.selectedChapterId,
                previousSelectedChapterId: scope.studio.previousSelectedChapterId,
                currentChapterTitle: scope.studio.currentChapterTitle,
                previousChapterTitle: scope.studio.previousChapterTitle,
                currentChapterLabel: scope.studio.currentChapterLabel,
                previousChapterLabel: scope.studio.previousChapterLabel,
                workspace: scope.studio.workspace,
                workspaceKind: scope.studio.workspaceKind,
                didSwitchChapter: scope.studio.didSwitchChapter,
                selectionVersion: scope.studio.selectionVersion,
            },
        };
    }

    /**
     * 根据线程记录生成 agent 命名空间快照。
     */
    private async buildAgentVariables<TKey extends ProfileKey>(
        thread: AgentThreadRecord,
        profile: AgentProfile<TKey>,
    ): Promise<AgentVariables<TKey>> {
        const subagents = thread.kind === "leader"
            ? await this.threadRepository.listSubAgents(String(thread.id))
            : [];
        const tools = await this.resolveEnabledToolKeys(profile.allowedToolKeys);

        return {
            thread: {
                id: String(thread.id),
                title: thread.title,
                summary: thread.lastMessagePreview,
                status: thread.runStatus,
            },
            profileKey: profile.key,
            kind: profile.kind,
            tools,
            subagents: subagents.map((subagent) => ({
                id: subagent.id,
                title: subagent.title,
                profileKey: subagent.profileKey,
                status: subagent.status,
            })),
            tasks: thread.metadata.tasks ?? null,
        };
    }

    /**
     * 根据 config.yaml 过滤 profile 可用工具。
     */
    private async resolveEnabledToolKeys(toolKeys: readonly string[]): Promise<string[]> {
        const appConfig = await loadAppConfig();
        return resolveEnabledToolNames([...toolKeys], appConfig.agent.tools);
    }
}
