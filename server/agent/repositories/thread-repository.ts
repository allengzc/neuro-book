import type {AgentThreadMetadata, AgentThreadRecord, AgentThreadStatus, CreateLeaderThreadInput, ListThreadsInput, SubAgentProfileKey, SubAgentThreadSummary, ThreadId, ThreadSummary} from "nbook/server/agent/types";

/**
 * Agent 线程仓储接口。
 */
export interface ThreadRepository {
    /**
     * 创建 leader 线程。
     */
    createLeader(input: CreateLeaderThreadInput): Promise<AgentThreadRecord>;

    /**
     * 创建 subagent 线程。
     */
    createSubAgent(input: {profileKey: SubAgentProfileKey; title?: string}): Promise<AgentThreadRecord>;

    /**
     * 列出线程。
     */
    listThreads(input?: ListThreadsInput): Promise<ThreadSummary[]>;

    /**
     * 按主键查找线程。
     */
    findById(threadId: ThreadId): Promise<AgentThreadRecord | null>;

    /**
     * 删除线程。
     */
    delete(threadId: ThreadId): Promise<void>;
    /**
     * 挂接 subagent。
     */
    attachSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId): Promise<void>;

    /**
     * 列出 leader 当前关联的 subagent。
     */
    listSubAgents(leaderThreadId: ThreadId): Promise<SubAgentThreadSummary[]>;

    /**
     * 列出管理指定 subagent 的 leader。
     */
    listManagingLeaders(subAgentThreadId: ThreadId): Promise<ThreadSummary[]>;

    /**
     * 断言 leader 是否管理指定 subagent。
     */
    assertLeaderManagesSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId): Promise<void>;

    /**
     * 更新线程状态。
     */
    updateRunStatus(threadId: ThreadId, status: AgentThreadStatus): Promise<AgentThreadRecord>;

    /**
     * 更新线程元数据。
     */
    updateMetadata(threadId: ThreadId, metadata: AgentThreadMetadata): Promise<AgentThreadRecord>;

    /**
     * 运行结束后回写摘要与终态。
     */
    touchAfterRun(threadId: ThreadId, input: {summary: string; status: AgentThreadStatus; metadata?: AgentThreadMetadata}): Promise<AgentThreadRecord>;
}
