import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {LiveRunRegistry} from "nbook/server/agent/runtime/live-run-registry";
import type {ThreadMessageService} from "nbook/server/agent/services/thread-message.service";
import type {
    AgentConversationTreeSnapshot,
    AgentThreadUsageSummary,
    AgentThreadRecord,
    LiveRunSnapshot,
    ProfileKey,
    SubAgentThreadSummary,
    ThreadId,
    ThreadSummary,
} from "nbook/server/agent/types";
import {normalizeAgentThreadUsageSummary} from "nbook/server/agent/types";

/**
 * 单个线程的静态详情投影。
 */
export type ThreadDetailProjection = {
    thread: ThreadSummary;
    subagents: SubAgentThreadSummary[];
    leaders: ThreadSummary[];
    conversationTree: AgentConversationTreeSnapshot;
};

/**
 * 单个线程的流式首帧快照投影。
 */
export type ThreadSnapshotProjection = ThreadDetailProjection & {
    activeRun: LiveRunSnapshot | null;
};

/**
 * 统一负责线程详情与首帧快照查询。
 */
export class ThreadProjectionService {
    constructor(
        private readonly threadRepository: ThreadRepository,
        private readonly threadMessages: ThreadMessageService,
        private readonly liveRuns: LiveRunRegistry,
    ) {}

    /**
     * 查询线程详情。
     */
    async getThreadDetail(threadId: ThreadId): Promise<ThreadDetailProjection | null> {
        const record = await this.threadRepository.findById(threadId);
        if (!record) {
            return null;
        }
        const usageSummary = await this.resolveRecordUsageSummary(threadId, record);

        return {
            thread: this.toThreadSummary(record, usageSummary),
            subagents: record.kind === "leader"
                ? await this.threadRepository.listSubAgents(threadId)
                : [],
            leaders: record.kind === "subagent"
                ? await this.threadRepository.listManagingLeaders(threadId)
                : [],
            conversationTree: await this.threadMessages.loadConversationTree(threadId),
        };
    }

    /**
     * 为轻量线程摘要补齐 usage 统计。
     * 列表路径只做 token 聚合，不加载历史树与 subagent 关系。
     */
    async enrichThreadSummary(summary: ThreadSummary): Promise<ThreadSummary> {
        return {
            ...summary,
            usageSummary: await this.resolveThreadUsageSummary(summary.id, summary.usageSummary),
        };
    }

    /**
     * 查询线程首帧快照。
     */
    async getThreadSnapshot(threadId: ThreadId): Promise<ThreadSnapshotProjection | null> {
        const detail = await this.getThreadDetail(threadId);
        if (!detail) {
            return null;
        }

        return {
            ...detail,
            activeRun: this.getLiveRunSnapshot(threadId),
        };
    }

    /**
     * 读取当前活跃 run 快照。
     */
    private getLiveRunSnapshot(threadId: ThreadId): LiveRunSnapshot | null {
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
     * 将仓储线程记录投影为统一线程摘要。
     */
    private toThreadSummary(record: AgentThreadRecord, usageSummary: AgentThreadUsageSummary | null): ThreadSummary {
        return {
            id: String(record.id),
            kind: record.kind,
            profileKey: record.profileKey as ProfileKey,
            title: record.title,
            summary: record.lastMessagePreview,
            status: record.runStatus,
            modelOverride: record.metadata.modelOverride ?? null,
            modelOverrideKey: record.metadata.modelOverrideKey ?? null,
            usageSummary,
            pendingUserInputSession: record.metadata.pendingUserInputSession ?? null,
            planMode: record.metadata.planMode ?? null,
            lastMessageAt: record.lastMessageAt,
        };
    }

    /**
     * 解析 thread usage：lastRun 取 metadata，cumulative 回扫完整消息树。
     */
    private async resolveThreadUsageSummary(
        threadId: ThreadId,
        usageSummary: AgentThreadUsageSummary | null,
    ): Promise<AgentThreadUsageSummary | null> {
        const metadataUsageSummary = normalizeAgentThreadUsageSummary(usageSummary);
        const cumulativeUsage = await this.threadMessages.collectThreadCumulativeUsage(threadId);

        if (!metadataUsageSummary?.lastRun && !cumulativeUsage) {
            return null;
        }

        return {
            lastRun: metadataUsageSummary?.lastRun ?? null,
            cumulative: cumulativeUsage,
        };
    }

    /**
     * 从线程记录解析 usage。
     */
    private async resolveRecordUsageSummary(threadId: ThreadId, record: AgentThreadRecord): Promise<AgentThreadUsageSummary | null> {
        return this.resolveThreadUsageSummary(threadId, normalizeAgentThreadUsageSummary(record.metadata.usageSummary));
    }
}
