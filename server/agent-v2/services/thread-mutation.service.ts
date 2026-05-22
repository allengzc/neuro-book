import {HumanMessage} from "@langchain/core/messages";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import {readAgentMessageRole} from "nbook/server/agent/messages/codec";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {AgentMessage, AgentMessageStoreSnapshot, ThreadId} from "nbook/server/agent/types";

/**
 * 负责线程消息级改写与活动路径切换。
 */
export class ThreadMutationService {
    constructor(
        private readonly messageStore: AgentMessageStore,
        private readonly threadRepository: ThreadRepository,
    ) {}

    /**
     * 创建新的用户消息节点。
     */
    async createUserMessage(threadId: ThreadId, content: string): Promise<void> {
        await this.requireIdleThread(threadId);
        await this.messageStore.appendMessages(threadId, {
            messages: [{
                status: "done",
                message: new HumanMessage({
                    content,
                    additional_kwargs: {
                        userInput: true,
                    },
                }),
            }],
        });
    }

    /**
     * 编辑一条消息。
     * user 会创建 sibling continuation；assistant 则原地改写并截断当前活动路径后续节点。
     */
    async updateMessage(threadId: ThreadId, messageId: string, content: string): Promise<void> {
        await this.requireIdleThread(threadId);
        const snapshot = await this.messageStore.loadSnapshot(threadId);
        const targetMessage = this.requireVisibleMessage(snapshot, messageId);

        const targetRole = readAgentMessageRole(targetMessage);
        if (targetRole === "system" || targetRole === "tool") {
            throw this.createInvalidOperationError(`${targetRole} 消息不允许编辑`);
        }

        if (targetRole === "user") {
            await this.messageStore.appendMessages(threadId, {
                parentId: targetMessage.parentId,
                messages: [{
                    status: "done",
                    message: new HumanMessage({
                        content,
                        additional_kwargs: {
                            userInput: true,
                        },
                    }),
                }],
            });
            return;
        }

        const activePath = this.collectActivePath(snapshot);
        const targetIndex = activePath.findIndex((message) => message.id === targetMessage.id);
        if (targetIndex >= 0) {
            const nextPathNode = activePath[targetIndex + 1];
            if (nextPathNode) {
                await this.messageStore.archiveMessages(threadId, this.collectSubtreeIds(snapshot, nextPathNode.id));
            }
        }
        await this.messageStore.updateMessage(threadId, {
            messageId,
            content,
        });
        await this.messageStore.setActiveCursor(threadId, messageId);
    }

    /**
     * 刷新一条消息。
     * user 直接回到该 user；assistant 则回退到最近一条非 assistant 节点。
     */
    async refreshMessage(threadId: ThreadId, messageId: string): Promise<void> {
        await this.requireIdleThread(threadId);
        const snapshot = await this.messageStore.loadSnapshot(threadId);
        const targetMessage = this.requireVisibleMessage(snapshot, messageId);

        const targetRole = readAgentMessageRole(targetMessage);
        if (targetRole === "system" || targetRole === "tool") {
            throw this.createInvalidOperationError(`${targetRole} 消息不允许刷新`);
        }

        if (targetRole === "user") {
            await this.messageStore.setActiveCursor(threadId, targetMessage.id);
            return;
        }

        const activePath = this.collectActivePath(snapshot);
        const targetIndex = activePath.findIndex((message) => message.id === targetMessage.id);
        if (targetIndex === -1) {
            throw this.createInvalidOperationError("当前 AI 消息不在活动路径上");
        }

        const anchor = this.findPreviousNonAssistant(activePath, targetIndex);
        if (!anchor) {
            throw this.createInvalidOperationError("当前 AI 消息前不存在可用于继续的非 AI 消息");
        }

        const anchorIndex = activePath.findIndex((message) => message.id === anchor.id);
        const nextPathNode = activePath[anchorIndex + 1];
        if (nextPathNode) {
            await this.messageStore.archiveMessages(threadId, this.collectSubtreeIds(snapshot, nextPathNode.id));
        }
        await this.messageStore.setActiveCursor(threadId, anchor.id);
    }

    /**
     * 回退到一条消息，保留该消息本身，只删除它之后的当前 continuation。
     */
    async rollbackMessage(threadId: ThreadId, messageId: string): Promise<void> {
        await this.requireIdleThread(threadId);
        const snapshot = await this.messageStore.loadSnapshot(threadId);
        const targetMessage = this.requireVisibleMessage(snapshot, messageId);

        const targetRole = readAgentMessageRole(targetMessage);
        if (targetRole === "system" || targetRole === "tool") {
            throw this.createInvalidOperationError(`${targetRole} 消息不允许回退`);
        }

        const activePath = this.collectActivePath(snapshot);
        const targetIndex = activePath.findIndex((message) => message.id === targetMessage.id);
        if (targetIndex === -1) {
            throw this.createInvalidOperationError("当前消息不在活动路径上");
        }

        const nextPathNode = activePath[targetIndex + 1];
        if (nextPathNode) {
            await this.messageStore.archiveMessages(threadId, this.collectSubtreeIds(snapshot, nextPathNode.id));
        }
        await this.messageStore.setActiveCursor(threadId, targetMessage.id);
    }

    /**
     * 激活指定 continuation 节点。
     */
    async activateMessage(threadId: ThreadId, messageId: string): Promise<void> {
        await this.requireIdleThread(threadId);
        const snapshot = await this.messageStore.loadSnapshot(threadId);
        const targetMessage = this.requireVisibleOrHiddenMessage(snapshot, messageId);
        if (targetMessage.archivedAt) {
            throw this.createInvalidOperationError("归档消息不能激活");
        }

        await this.messageStore.setActiveCursor(threadId, this.resolveDefaultLeafId(snapshot, targetMessage.id));
    }

    /**
     * 收集当前活动路径。
     */
    private collectActivePath(snapshot: AgentMessageStoreSnapshot): AgentMessage[] {
        if (!snapshot.activeCursorId) {
            return [];
        }

        const path: AgentMessage[] = [];
        let currentId: string | null = snapshot.activeCursorId;
        while (currentId) {
            const current = this.requireVisibleOrHiddenMessage(snapshot, currentId);
            if (!current.archivedAt) {
                path.push(current);
            }
            currentId = current.parentId;
        }
        return path.reverse();
    }

    /**
     * 收集目标节点整个子树。
     */
    private collectSubtreeIds(snapshot: AgentMessageStoreSnapshot, rootId: string): string[] {
        const ids: string[] = [];
        const queue = [rootId];

        while (queue.length > 0) {
            const currentId = queue.shift();
            if (!currentId) {
                continue;
            }
            const current = this.requireVisibleOrHiddenMessage(snapshot, currentId);
            ids.push(current.id);
            queue.push(...current.childIds);
        }

        return ids;
    }

    /**
     * 向前找到最近的非 assistant 节点。
     */
    private findPreviousNonAssistant(messages: AgentMessage[], fromIndex: number): AgentMessage | null {
        for (let index = fromIndex - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (message && readAgentMessageRole(message) !== "assistant") {
                return message;
            }
        }
        return null;
    }

    /**
     * 解析某个 continuation 的默认叶子。
     * 规则：每层选择最新创建且未归档的子节点。
     */
    private resolveDefaultLeafId(snapshot: AgentMessageStoreSnapshot, messageId: string): string {
        let current = this.requireVisibleOrHiddenMessage(snapshot, messageId);
        while (true) {
            const nextChild = [...current.childIds]
                .map((childId) => this.requireVisibleOrHiddenMessage(snapshot, childId))
                .filter((child) => !child.archivedAt)
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                .at(-1);
            if (!nextChild) {
                return current.id;
            }
            current = nextChild;
        }
    }

    /**
     * 读取一条可见消息。
     */
    private requireVisibleMessage(snapshot: AgentMessageStoreSnapshot, messageId: string): AgentMessage {
        const message = this.requireVisibleOrHiddenMessage(snapshot, messageId);
        if (message.archivedAt) {
            throw this.createMessageNotFoundError(messageId);
        }
        return message;
    }

    /**
     * 读取任意消息节点。
     */
    private requireVisibleOrHiddenMessage(snapshot: AgentMessageStoreSnapshot, messageId: string): AgentMessage {
        const message = snapshot.nodesById[messageId];
        if (!message) {
            throw this.createMessageNotFoundError(messageId);
        }
        return message;
    }

    /**
     * 保证当前线程没有活跃运行。
     */
    private async requireIdleThread(threadId: ThreadId) {
        const thread = await this.threadRepository.findById(threadId);
        if (!thread) {
            throw this.createHttpError(404, "线程不存在");
        }
        if (thread.runStatus === "running" || thread.runStatus === "waiting_user") {
            throw this.createInvalidOperationError("线程正在运行中，暂时不能改写历史消息");
        }
        return thread;
    }

    /**
     * 构造消息不存在错误。
     */
    private createMessageNotFoundError(messageId: string) {
        return this.createHttpError(404, `消息不存在: ${messageId}`);
    }

    /**
     * 构造消息改写非法操作错误。
     */
    private createInvalidOperationError(message: string) {
        return this.createHttpError(400, message);
    }

    /**
     * 构造带 statusCode 的错误对象，便于 API 直接透传。
     */
    private createHttpError(statusCode: number, message: string) {
        return Object.assign(new Error(message), {
            statusCode,
            statusMessage: message,
        });
    }
}
