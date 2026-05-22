import type {
    AgentMessage,
    AgentMessageCreateInput,
    AgentMessageStoreSnapshot,
    ThreadId,
} from "nbook/server/agent/types";

/**
 * AgentMessage 追加参数。
 * parentId 为空时表示从根开始追加。
 */
export type AgentMessageAppendInput = {
    parentId?: string | null;
    messages: AgentMessageCreateInput[];
};

/**
 * AgentMessage 内容改写参数。
 */
export type AgentMessageUpdateInput = {
    messageId: string;
    content: string;
};

/**
 * AgentMessage 持久化层。
 * 这里维护的是产品级历史树，而不是 runtime graph state。
 */
export interface AgentMessageStore {
    /**
     * 读取完整历史树快照。
     */
    loadSnapshot(threadId: ThreadId): Promise<AgentMessageStoreSnapshot>;

    /**
     * 读取当前活动路径上的已提交消息。
     */
    loadActivePathMessages(threadId: ThreadId): Promise<AgentMessage[]>;

    /**
     * 在指定父节点后追加消息链；未指定时接到当前 activeCursor 后。
     */
    appendMessages(threadId: ThreadId, input: AgentMessageAppendInput): Promise<AgentMessage[]>;

    /**
     * 在指定消息之前插入消息链，并保持指定消息位于插入链之后。
     */
    insertMessagesBefore(threadId: ThreadId, input: {
        beforeMessageId: string;
        messages: AgentMessageCreateInput[];
    }): Promise<AgentMessage[]>;

    /**
     * 在当前根节点之前前插消息链。
     * 主要用于首轮持久化 system prompt，确保其稳定处于历史树最前面。
     */
    prependMessages(threadId: ThreadId, input: {messages: AgentMessageCreateInput[]}): Promise<AgentMessage[]>;

    /**
     * 切换当前活动光标。
     */
    setActiveCursor(threadId: ThreadId, messageId: string | null): Promise<void>;

    /**
     * 原地改写一条消息内容。
     */
    updateMessage(threadId: ThreadId, input: AgentMessageUpdateInput): Promise<AgentMessage>;

    /**
     * 归档指定节点集合。
     */
    archiveMessages(threadId: ThreadId, messageIds: string[]): Promise<void>;

    /**
     * 删除整个线程的消息存储。
     */
    deleteThread(threadId: ThreadId): Promise<void>;
}
