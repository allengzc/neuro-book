import type {BaseMessage} from "@langchain/core/messages";
import type {
    AgentMessage,
    AgentTaskList,
    AgentTaskStatus,
    AgentStreamEvent,
    AnySubAgentInput,
    CreateSubAgentThreadInput,
    LeaderInput,
    ProfileKey,
    ProfileInput,
    RunOptions,
    SubAgentCompletionResult,
    SubAgentProfileKey,
    SubAgentThreadSummary,
    ThreadId,
} from "nbook/server/agent/types";
import type {SubAgentThread} from "nbook/server/agent/threads/subagent-thread";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";

/**
 * tool 运行时最小能力端口。
 * 只暴露 tool 执行过程中真正需要的输出推送能力。
 */
export interface ToolRuntimePort {
    /**
     * 向当前活跃 tool 节点追加输出文本。
     */
    publishToolOutputDelta(threadId: ThreadId, toolCallId: string, chunkText: string): void;
}

/**
 * tool 执行上下文依赖的最小网关。
 * 这里只暴露内建 tools 真正需要的线程能力。
 */
export interface AgentToolGateway extends ToolRuntimePort {
    /**
     * 进入当前线程的软 Plan Mode。
     */
    enterPlanMode(threadId: ThreadId): Promise<void>;

    /**
     * 退出当前线程的软 Plan Mode。
     */
    exitPlanMode(threadId: ThreadId): Promise<void>;

    /**
     * 初始化或整体重建当前线程任务列表。
     */
    createTaskList(threadId: ThreadId, input: {
        title?: string;
        steps: Array<{
            id: string;
            text: string;
            status: AgentTaskStatus;
        }>;
    }): Promise<AgentTaskList>;

    /**
     * 更新当前线程任务步骤状态。
     */
    setTaskStatus(threadId: ThreadId, input: {
        id: string;
        status: AgentTaskStatus;
        note?: string;
    }): Promise<AgentTaskList>;

    /**
     * 创建并挂接 subagent。
     */
    createSubAgentThread<TKey extends string>(
        input: CreateSubAgentThreadInput<TKey>,
    ): Promise<SubAgentThread<TKey>>;

    /**
     * 校验 profileKey 是否为当前可用 subagent profile。
     */
    assertSubAgentProfile(profileKey: string): Promise<void>;

    /**
     * 列出当前可用 profile。
     */
    listProfiles(kind?: "leader" | "subagent"): Promise<AgentProfile<ProfileKey>[]>;

    /**
     * 列出 leader 管理的 subagent。
     */
    listSubAgents(leaderThreadId: ThreadId): Promise<SubAgentThreadSummary[]>;

    /**
     * 由 leader 运行 subagent。
     */
    runSubAgent(
        leaderThreadId: ThreadId,
        subAgentThreadId: ThreadId,
        input: AnySubAgentInput,
        options?: RunOptions,
    ): Promise<SubAgentCompletionResult>;
}

/**
 * 线程对象依赖的最小网关。
 * 线程包装层不应依赖完整 AgentSystem 具体类型。
 */
export interface AgentThreadGateway {
    /**
     * 读取线程完整历史。
     */
    getThreadHistory(threadId: ThreadId): Promise<AgentMessage[]>;

    /**
     * 订阅线程事件流。
     */
    subscribeThreadStream(threadId: ThreadId): AsyncIterable<AgentStreamEvent>;

    createSubAgentThread<TKey extends string>(input: CreateSubAgentThreadInput<TKey>): Promise<SubAgentThread<TKey>>;
    attachSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId): Promise<void>;
    listSubAgents(leaderThreadId: ThreadId): Promise<SubAgentThreadSummary[]>;
    runSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId, input: AnySubAgentInput, options?: RunOptions): Promise<SubAgentCompletionResult>;

    dispatchLeaderRun(leaderThreadId: ThreadId, input: LeaderInput, options?: RunOptions): Promise<void>;
    runLeader(leaderThreadId: ThreadId, input: LeaderInput, options?: RunOptions): Promise<BaseMessage[]>;
    assertSubAgentProfile(profileKey: string): Promise<void>;
    dispatchDetachedSubAgent<TKey extends SubAgentProfileKey = SubAgentProfileKey>(
        subAgentThreadId: ThreadId,
        input: ProfileInput<TKey>,
        options?: RunOptions,
    ): Promise<void>;
    runDetachedSubAgent<TKey extends SubAgentProfileKey = SubAgentProfileKey>(
        subAgentThreadId: ThreadId,
        input: ProfileInput<TKey>,
        options?: RunOptions,
    ): Promise<SubAgentCompletionResult<TKey>>;
}
