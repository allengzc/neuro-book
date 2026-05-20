import {AgentThreadKind, AgentThreadRunStatus} from "nbook/server/generated/prisma/enums";
import type {AgentThread} from "nbook/server/generated/prisma/client";
import {parseEntityId, stringifyEntityId} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";
import {AgentThreadMetadataSchema, normalizeAgentThreadUsageSummary, type AgentThreadMetadata, type AgentThreadRecord, type AgentThreadStatus, type CreateLeaderThreadInput, type ListThreadsInput, type SubAgentThreadSummary, type ThreadId, type ThreadSummary} from "nbook/server/agent/types";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";

/**
 * Prisma 版线程仓储。
 */
export class PrismaThreadRepository implements ThreadRepository {

    /**
     * 创建 leader 线程。
     */
    async createLeader(input: CreateLeaderThreadInput): Promise<AgentThreadRecord> {
        const normalizedModelOverride = input.modelOverride?.modelKey?.trim()
            ? {
                modelKey: input.modelOverride.modelKey.trim(),
                temperature: input.modelOverride.temperature ?? null,
                topK: input.modelOverride.topK ?? null,
                reasoningEffort: input.modelOverride.reasoningEffort ?? null,
                stream: input.modelOverride.stream ?? true,
            }
            : null;

        const created = await prisma.agentThread.create({
            data: {
                kind: AgentThreadKind.leader,
                runStatus: AgentThreadRunStatus.idle,
                profileKey: input.profileKey ?? "leader.default",
                metadata: {
                    ...(normalizedModelOverride ? {modelOverride: normalizedModelOverride} : {}),
                    ...(input.modelOverrideKey?.trim() ? {modelOverrideKey: input.modelOverrideKey.trim()} : {}),
                },
                title: input.title?.trim() ?? "",
                lastMessagePreview: "",
            },
        });
        return this.toRecord(created);
    }

    /**
     * 创建 subagent 线程。
     */
    async createSubAgent(input: {profileKey: string; title?: string}): Promise<AgentThreadRecord> {
        const created = await prisma.agentThread.create({
            data: {
                kind: AgentThreadKind.subagent,
                runStatus: AgentThreadRunStatus.idle,
                profileKey: input.profileKey,
                metadata: {},
                title: input.title?.trim() ?? "",
                lastMessagePreview: "",
            },
        });
        return this.toRecord(created);
    }

    /**
     * 列出线程。
     */
    async listThreads(input: ListThreadsInput = {}): Promise<ThreadSummary[]> {
        const threads = await prisma.agentThread.findMany({
            where: {
                ...(input.kind ? {kind: input.kind} : {}),
                ...(input.profileKey ? {profileKey: input.profileKey} : {}),
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        return threads.map((thread) => {
            const metadata = AgentThreadMetadataSchema.parse(thread.metadata ?? {});
            return {
                id: stringifyEntityId(thread.id),
                kind: thread.kind,
                profileKey: thread.profileKey as ThreadSummary["profileKey"],
                title: thread.title,
                summary: thread.lastMessagePreview,
                status: this.fromRunStatus(thread.runStatus),
                modelOverride: metadata.modelOverride ?? null,
                modelOverrideKey: metadata.modelOverrideKey ?? null,
                usageSummary: normalizeAgentThreadUsageSummary(metadata.usageSummary),
                pendingUserInputSession: metadata.pendingUserInputSession ?? null,
                planMode: metadata.planMode ?? null,
                lastMessageAt: thread.lastMessageAt,
            };
        });
    }

    /**
     * 列出管理指定 subagent 的 leader。
     */
    async listManagingLeaders(subAgentThreadId: ThreadId): Promise<ThreadSummary[]> {
        const subagent = await prisma.agentThread.findUnique({
            where: {id: parseEntityId("threadId", subAgentThreadId)},
            include: {
                managingLeaders: true,
            },
        });

        if (!subagent) {
            throw new Error(`未找到 subagent thread: ${subAgentThreadId}`);
        }

        return subagent.managingLeaders.map((thread) => {
            const metadata = AgentThreadMetadataSchema.parse(thread.metadata ?? {});
            return {
                id: stringifyEntityId(thread.id),
                kind: thread.kind,
                profileKey: thread.profileKey as ThreadSummary["profileKey"],
                title: thread.title,
                summary: thread.lastMessagePreview,
                status: this.fromRunStatus(thread.runStatus),
                modelOverride: metadata.modelOverride ?? null,
                modelOverrideKey: metadata.modelOverrideKey ?? null,
                usageSummary: normalizeAgentThreadUsageSummary(metadata.usageSummary),
                pendingUserInputSession: metadata.pendingUserInputSession ?? null,
                planMode: metadata.planMode ?? null,
                lastMessageAt: thread.lastMessageAt,
            };
        });
    }

    /**
     * 查找线程。
     */
    async findById(threadId: ThreadId): Promise<AgentThreadRecord | null> {
        const found = await prisma.agentThread.findUnique({
            where: {id: parseEntityId("threadId", threadId)},
        });
        return found ? this.toRecord(found) : null;
    }

    /**
     * 删除线程。
     */
    async delete(threadId: ThreadId): Promise<void> {
        await prisma.agentThread.delete({
            where: {id: parseEntityId("threadId", threadId)},
        });
    }

    /**
     * 挂接 subagent。
     */
    async attachSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId): Promise<void> {
        await prisma.agentThread.update({
            where: {id: parseEntityId("threadId", leaderThreadId)},
            data: {
                managedSubagents: {
                    connect: {
                        id: parseEntityId("threadId", subAgentThreadId),
                    },
                },
            },
        });
    }

    /**
     * 列出 subagent。
     */
    async listSubAgents(leaderThreadId: ThreadId): Promise<SubAgentThreadSummary[]> {
        const leader = await prisma.agentThread.findUnique({
            where: {id: parseEntityId("threadId", leaderThreadId)},
            include: {
                managedSubagents: true,
            },
        });

        if (!leader) {
            throw new Error(`未找到 leader thread: ${leaderThreadId}`);
        }

        return leader.managedSubagents.map((thread) => {
            const metadata = AgentThreadMetadataSchema.parse(thread.metadata ?? {});
            return {
                id: stringifyEntityId(thread.id),
                kind: thread.kind,
                profileKey: thread.profileKey,
                title: thread.title,
                summary: thread.lastMessagePreview,
                status: this.fromRunStatus(thread.runStatus),
                modelOverride: metadata.modelOverride ?? null,
                modelOverrideKey: metadata.modelOverrideKey ?? null,
                usageSummary: normalizeAgentThreadUsageSummary(metadata.usageSummary),
                pendingUserInputSession: metadata.pendingUserInputSession ?? null,
                planMode: metadata.planMode ?? null,
                lastMessageAt: thread.lastMessageAt,
            };
        });
    }

    /**
     * 校验管理关系。
     */
    async assertLeaderManagesSubAgent(leaderThreadId: ThreadId, subAgentThreadId: ThreadId): Promise<void> {
        const leader = await prisma.agentThread.findUnique({
            where: {id: parseEntityId("threadId", leaderThreadId)},
            include: {
                managedSubagents: {
                    where: {id: parseEntityId("threadId", subAgentThreadId)},
                },
            },
        });

        if (!leader || leader.managedSubagents.length === 0) {
            throw new Error(`leader ${leaderThreadId} 未关联 subagent ${subAgentThreadId}`);
        }
    }

    /**
     * 更新运行状态。
     */
    async updateRunStatus(threadId: ThreadId, status: AgentThreadStatus): Promise<AgentThreadRecord> {
        const updated = await prisma.agentThread.update({
            where: {id: parseEntityId("threadId", threadId)},
            data: {
                runStatus: this.toRunStatus(status),
            },
        });
        return this.toRecord(updated);
    }

    /**
     * 更新线程元数据。
     */
    async updateMetadata(threadId: ThreadId, metadata: AgentThreadMetadata): Promise<AgentThreadRecord> {
        const updated = await prisma.agentThread.update({
            where: {id: parseEntityId("threadId", threadId)},
            data: {
                metadata,
            },
        });
        return this.toRecord(updated);
    }

    /**
     * 运行结束后回写摘要。
     */
    async touchAfterRun(threadId: ThreadId, input: {summary: string; status: AgentThreadStatus; metadata?: AgentThreadMetadata}): Promise<AgentThreadRecord> {
        const updated = await prisma.agentThread.update({
            where: {id: parseEntityId("threadId", threadId)},
            data: {
                runStatus: this.toRunStatus(input.status),
                lastMessageAt: new Date(),
                lastMessagePreview: input.summary.slice(0, 200),
                ...(input.metadata ? {metadata: input.metadata} : {}),
            },
        });
        return this.toRecord(updated);
    }

    /**
     * 转换仓储记录。
     */
    private toRecord(thread: AgentThread): AgentThreadRecord {
        return {
            id: thread.id,
            kind: thread.kind,
            runStatus: thread.runStatus,
            profileKey: thread.profileKey,
            metadata: AgentThreadMetadataSchema.parse(thread.metadata ?? {}),
            title: thread.title,
            activeCursorMessageId: thread.activeCursorMessageId,
            lastMessagePreview: thread.lastMessagePreview,
            lastMessageAt: thread.lastMessageAt,
        };
    }

    /**
     * 转换状态到 Prisma 枚举。
     */
    private toRunStatus(status: AgentThreadStatus): AgentThreadRunStatus {
        return AgentThreadRunStatus[status];
    }

    /**
     * 从 Prisma 枚举转换状态。
     */
    private fromRunStatus(status: AgentThreadRunStatus): AgentThreadStatus {
        return status;
    }
}
