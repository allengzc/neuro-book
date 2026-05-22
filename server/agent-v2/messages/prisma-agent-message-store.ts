import type {StoredMessage} from "@langchain/core/messages";
import type {AgentMessage as PrismaAgentMessage} from "nbook/server/generated/prisma/client";
import type {Prisma} from "nbook/server/generated/prisma/client";
import {replaceStoredMessageContent, toStoredMessage} from "nbook/server/agent/messages/codec";
import type {
    AgentMessage,
    AgentMessageCreateInput,
    AgentMessageStoreSnapshot,
    AgentMessageStatus,
    ThreadId,
} from "nbook/server/agent/types";
import type {
    AgentMessageAppendInput,
    AgentMessageStore,
    AgentMessageUpdateInput,
} from "nbook/server/agent/messages/agent-message-store";
import {parseEntityId} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 基于产品数据库的 Agent 历史树存储。
 * 这里不再借用 LangGraph checkpoint；历史树、分支和 active cursor 都由项目自己维护。
 */
export class PrismaAgentMessageStore implements AgentMessageStore {
    /**
     * 读取完整树快照。
     */
    async loadSnapshot(threadId: ThreadId): Promise<AgentMessageStoreSnapshot> {
        return this.loadSnapshotFromDatabase(threadId);
    }

    /**
     * 读取当前活动路径上的已提交消息。
     */
    async loadActivePathMessages(threadId: ThreadId): Promise<AgentMessage[]> {
        const snapshot = await this.loadSnapshotFromDatabase(threadId);
        return this.collectPathMessages(snapshot, snapshot.activeCursorId);
    }

    /**
     * 在指定父节点后追加消息链。
     */
    async appendMessages(threadId: ThreadId, input: AgentMessageAppendInput): Promise<AgentMessage[]> {
        if (input.messages.length === 0) {
            return [];
        }

        const threadDbId = this.parseThreadId(threadId);
        return prisma.$transaction(async (tx) => {
            const thread = await tx.agentThread.findUniqueOrThrow({
                where: {id: threadDbId},
                select: {activeCursorMessageId: true},
            });
            const parentId = input.parentId === undefined ? thread.activeCursorMessageId : input.parentId;
            if (parentId) {
                await this.requirePrismaMessage(tx, threadDbId, parentId);
            }

            const created: PrismaAgentMessage[] = [];
            let currentParentId = parentId;
            for (const messageInput of input.messages) {
                const message = await this.createPrismaMessage(tx, threadDbId, currentParentId, messageInput);
                created.push(message);
                currentParentId = message.id;
            }

            await tx.agentThread.update({
                where: {id: threadDbId},
                data: {activeCursorMessageId: created.at(-1)?.id ?? thread.activeCursorMessageId},
            });
            return this.toAgentMessages(created, {nodesById: {}});
        });
    }

    /**
     * 在指定消息之前插入消息链，并保留目标消息作为插入链的末尾子节点。
     */
    async insertMessagesBefore(threadId: ThreadId, input: {
        beforeMessageId: string;
        messages: AgentMessageCreateInput[];
    }): Promise<AgentMessage[]> {
        if (input.messages.length === 0) {
            return [];
        }

        const threadDbId = this.parseThreadId(threadId);
        return prisma.$transaction(async (tx) => {
            const target = await this.requirePrismaMessage(tx, threadDbId, input.beforeMessageId);
            const created: PrismaAgentMessage[] = [];
            let currentParentId = target.parentId;
            for (const messageInput of input.messages) {
                const message = await this.createPrismaMessage(tx, threadDbId, currentParentId, messageInput);
                created.push(message);
                currentParentId = message.id;
            }
            await tx.agentMessage.update({
                where: {id: target.id},
                data: {parentId: currentParentId},
            });
            return this.toAgentMessages(created, {nodesById: {}});
        });
    }

    /**
     * 在当前根节点之前插入新的根前缀消息链。
     */
    async prependMessages(threadId: ThreadId, input: {messages: AgentMessageCreateInput[]}): Promise<AgentMessage[]> {
        if (input.messages.length === 0) {
            return [];
        }

        const threadDbId = this.parseThreadId(threadId);
        return prisma.$transaction(async (tx) => {
            const snapshot = await this.loadSnapshotFromTransaction(tx, threadDbId);
            const previousRootId = snapshot.rootNodeId;
            const created: PrismaAgentMessage[] = [];
            let currentParentId: string | null = null;

            for (const messageInput of input.messages) {
                const message = await this.createPrismaMessage(tx, threadDbId, currentParentId, messageInput);
                created.push(message);
                currentParentId = message.id;
            }

            if (previousRootId && currentParentId) {
                await tx.agentMessage.update({
                    where: {id: previousRootId},
                    data: {parentId: currentParentId},
                });
            }
            if (!previousRootId) {
                await tx.agentThread.update({
                    where: {id: threadDbId},
                    data: {activeCursorMessageId: created.at(-1)?.id ?? null},
                });
            }
            return this.toAgentMessages(created, {nodesById: {}});
        });
    }

    /**
     * 切换活动光标。
     */
    async setActiveCursor(threadId: ThreadId, messageId: string | null): Promise<void> {
        const threadDbId = this.parseThreadId(threadId);
        if (messageId) {
            await this.requireMessage(threadDbId, messageId);
        }
        await prisma.agentThread.update({
            where: {id: threadDbId},
            data: {activeCursorMessageId: messageId},
        });
    }

    /**
     * 原地改写消息内容。
     */
    async updateMessage(threadId: ThreadId, input: AgentMessageUpdateInput): Promise<AgentMessage> {
        const threadDbId = this.parseThreadId(threadId);
        const target = await this.requireMessage(threadDbId, input.messageId);
        const updated = await prisma.agentMessage.update({
            where: {id: target.id},
            data: {
                storedMessage: this.toPrismaJson(replaceStoredMessageContent(target.storedMessage, input.content)),
            },
        });
        const snapshot = await this.loadSnapshotFromDatabase(threadId);
        return this.toAgentMessage(updated, snapshot);
    }

    /**
     * 归档指定节点集合。
     */
    async archiveMessages(threadId: ThreadId, messageIds: string[]): Promise<void> {
        if (messageIds.length === 0) {
            return;
        }

        const threadDbId = this.parseThreadId(threadId);
        await prisma.$transaction(async (tx) => {
            const snapshot = await this.loadSnapshotFromTransaction(tx, threadDbId);
            const archivedAt = new Date();

            for (const messageId of messageIds) {
                this.requireSnapshotMessage(snapshot, messageId);
            }
            await tx.agentMessage.updateMany({
                where: {
                    threadId: threadDbId,
                    id: {in: messageIds},
                },
                data: {archivedAt},
            });

            if (snapshot.activeCursorId && messageIds.includes(snapshot.activeCursorId)) {
                await tx.agentThread.update({
                    where: {id: threadDbId},
                    data: {
                        activeCursorMessageId: this.findNearestVisibleAncestor(snapshot, snapshot.activeCursorId, new Set(messageIds)),
                    },
                });
            }
        });
    }

    /**
     * 删除整个线程的消息存储。
     */
    async deleteThread(threadId: ThreadId): Promise<void> {
        const threadDbId = this.parseThreadId(threadId);
        await prisma.agentMessage.deleteMany({
            where: {threadId: threadDbId},
        });
        await prisma.agentThread.updateMany({
            where: {id: threadDbId},
            data: {activeCursorMessageId: null},
        });
    }

    /**
     * 从数据库读取快照。
     */
    private async loadSnapshotFromDatabase(threadId: ThreadId): Promise<AgentMessageStoreSnapshot> {
        return this.loadSnapshotFromTransaction(prisma, this.parseThreadId(threadId));
    }

    /**
     * 在 Prisma client 或 transaction 中读取快照。
     */
    private async loadSnapshotFromTransaction(
        tx: Pick<typeof prisma, "agentThread" | "agentMessage">,
        threadDbId: number,
    ): Promise<AgentMessageStoreSnapshot> {
        const thread = await tx.agentThread.findUniqueOrThrow({
            where: {id: threadDbId},
            select: {activeCursorMessageId: true},
        });
        const messages = await tx.agentMessage.findMany({
            where: {threadId: threadDbId},
            orderBy: {createdAt: "asc"},
        });
        const snapshot: AgentMessageStoreSnapshot = {
            version: 3,
            revision: messages.length,
            activeCursorId: thread.activeCursorMessageId,
            rootNodeId: messages.find((message) => !message.parentId)?.id ?? null,
            nodesById: {},
        };
        for (const message of messages) {
            snapshot.nodesById[message.id] = this.toAgentMessage(message, {nodesById: {}});
        }
        for (const messageId of Object.keys(snapshot.nodesById)) {
            const message = this.requireSnapshotMessage(snapshot, messageId);
            snapshot.nodesById[messageId] = {
                ...message,
                childIds: this.collectChildIds(snapshot, messageId),
            };
        }
        return snapshot;
    }

    /**
     * 创建一条 Prisma 消息。
     */
    private async createPrismaMessage(
        tx: Pick<typeof prisma, "agentMessage">,
        threadDbId: number,
        parentId: string | null,
        input: AgentMessageCreateInput,
    ): Promise<PrismaAgentMessage> {
        const id = input.id ?? `msg-${crypto.randomUUID()}`;
        const status = input.status ?? "done";
        const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();
        return tx.agentMessage.create({
            data: {
                id,
                threadId: threadDbId,
                parentId,
                status,
                createdAt,
                storedMessage: this.toPrismaJson(toStoredMessage(input, {
                    id,
                    status,
                    createdAt: createdAt.toISOString(),
                })),
            },
        });
    }

    /**
     * 读取并校验消息存在。
     */
    private async requireMessage(threadDbId: number, messageId: string): Promise<AgentMessage> {
        const found = await prisma.agentMessage.findFirst({
            where: {
                id: messageId,
                threadId: threadDbId,
            },
        });
        if (!found) {
            throw new Error(`未找到消息节点: ${messageId}`);
        }
        const snapshot = await this.loadSnapshotFromTransaction(prisma, threadDbId);
        return this.toAgentMessage(found, snapshot);
    }

    /**
     * 在事务中读取并校验消息存在。
     */
    private async requirePrismaMessage(
        tx: Pick<typeof prisma, "agentMessage">,
        threadDbId: number,
        messageId: string,
    ): Promise<PrismaAgentMessage> {
        const found = await tx.agentMessage.findFirst({
            where: {
                id: messageId,
                threadId: threadDbId,
            },
        });
        if (!found) {
            throw new Error(`未找到消息节点: ${messageId}`);
        }
        return found;
    }

    /**
     * 收集目标节点所在路径上的已提交消息。
     */
    private collectPathMessages(snapshot: AgentMessageStoreSnapshot, cursorId: string | null): AgentMessage[] {
        if (!cursorId) {
            return [];
        }

        const path: AgentMessage[] = [];
        let currentId: string | null = cursorId;
        while (currentId) {
            const target = this.requireSnapshotMessage(snapshot, currentId);
            if (!target.archivedAt) {
                path.push(target);
            }
            currentId = target.parentId;
        }
        return path.reverse();
    }

    /**
     * 向上找到最近未归档祖先。
     */
    private findNearestVisibleAncestor(snapshot: AgentMessageStoreSnapshot, messageId: string, archivedNow = new Set<string>()): string | null {
        let currentId = this.requireSnapshotMessage(snapshot, messageId).parentId;
        while (currentId) {
            const current = this.requireSnapshotMessage(snapshot, currentId);
            if (!current.archivedAt && !archivedNow.has(current.id)) {
                return current.id;
            }
            currentId = current.parentId;
        }
        return null;
    }

    /**
     * 读取快照消息。
     */
    private requireSnapshotMessage(snapshot: AgentMessageStoreSnapshot, messageId: string): AgentMessage {
        const message = snapshot.nodesById[messageId];
        if (!message) {
            throw new Error(`未找到消息节点: ${messageId}`);
        }
        return message;
    }

    /**
     * 转换多条 Prisma 记录。
     */
    private toAgentMessages(messages: PrismaAgentMessage[], snapshot: Pick<AgentMessageStoreSnapshot, "nodesById">): AgentMessage[] {
        return messages.map((message) => this.toAgentMessage(message, snapshot));
    }

    /**
     * 转换 Prisma 记录。
     */
    private toAgentMessage(message: PrismaAgentMessage, snapshot: Pick<AgentMessageStoreSnapshot, "nodesById">): AgentMessage {
        return {
            id: message.id,
            threadId: String(message.threadId),
            parentId: message.parentId,
            childIds: this.collectChildIds(snapshot, message.id),
            archivedAt: message.archivedAt?.toISOString() ?? null,
            status: this.normalizeStatus(message.status),
            createdAt: message.createdAt.toISOString(),
            storedMessage: message.storedMessage as unknown as StoredMessage,
        };
    }

    /**
     * 收集子节点 id。
     */
    private collectChildIds(snapshot: Pick<AgentMessageStoreSnapshot, "nodesById">, messageId: string): string[] {
        return Object.values(snapshot.nodesById)
            .filter((node) => node.parentId === messageId)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map((node) => node.id);
    }

    /**
     * 规范化消息状态。
     */
    private normalizeStatus(status: string): AgentMessageStatus {
        return status === "stopped" ? "stopped" : "done";
    }

    /**
     * 解析线程 id。
     */
    private parseThreadId(threadId: ThreadId): number {
        return parseEntityId("threadId", String(threadId));
    }

    /**
     * StoredMessage 是纯 JSON；Prisma 需要显式 JSON 输入类型。
     */
    private toPrismaJson(value: StoredMessage): Prisma.InputJsonValue {
        return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    }
}
