import type {BaseMessage} from "@langchain/core/messages";
import type {AgentThreadGateway} from "nbook/server/agent/contracts";
import type {AgentMessage, AgentStreamEvent, AgentThreadRecord, AgentThreadStatus, ProfileInput, ProfileKey, RunOptions, SubAgentCompletionResult} from "nbook/server/agent/types";

/**
 * 线程公共接口。
 */
export interface AgentThreadHandle<TKey extends ProfileKey> {
    /**
     * 读取完整历史消息。
     */
    getHistory(): Promise<AgentMessage[]>;

    /**
     * 派发一次新的运行任务。
     */
    dispatchRun(input: ProfileInput<TKey>, options?: RunOptions): Promise<void>;

    /**
     * 订阅当前线程的长期事件流。
     */
    subscribeStream(): AsyncIterable<AgentStreamEvent>;

    /**
     * 触发一次输入，并返回当前线程流。
     */
    invokeStream(input: ProfileInput<TKey>, options?: RunOptions): AsyncIterable<AgentStreamEvent>;

    /**
     * 执行本次输入并返回本次新增消息。
     */
    run(input: ProfileInput<TKey>, options?: RunOptions): Promise<BaseMessage[] | SubAgentCompletionResult>;
}

/**
 * 基础线程类。
 */
export abstract class BaseAgentThread<TKey extends ProfileKey> implements AgentThreadHandle<TKey> {
    constructor(
        protected readonly gateway: AgentThreadGateway,
        protected record: AgentThreadRecord,
    ) {}

    /**
     * 线程 ID。
     */
    get id(): string {
        return String(this.record.id);
    }

    /**
     * profileKey。
     */
    get profileKey(): TKey {
        return this.record.profileKey as TKey;
    }

    /**
     * 标题。
     */
    get title(): string {
        return this.record.title;
    }

    /**
     * 摘要。
     */
    get summary(): string {
        return this.record.lastMessagePreview;
    }

    /**
     * 当前线程状态。
     */
    get status(): AgentThreadStatus {
        return this.record.runStatus;
    }

    /**
     * 读取完整历史。
     */
    async getHistory(): Promise<AgentMessage[]> {
        return this.gateway.getThreadHistory(this.id);
    }

    /**
     * 订阅当前线程的长期事件流。
     */
    subscribeStream(): AsyncIterable<AgentStreamEvent> {
        return this.gateway.subscribeThreadStream(this.id);
    }

    /**
     * 刷新内部记录。
     */
    refresh(record: AgentThreadRecord): void {
        this.record = record;
    }

    /**
     * 子类必须声明如何发起 run。
     */
    abstract dispatchRun(input: ProfileInput<TKey>, options?: RunOptions): Promise<void>;

    /**
     * 子类必须声明如何触发运行并返回线程流。
     */
    abstract invokeStream(input: ProfileInput<TKey>, options?: RunOptions): AsyncIterable<AgentStreamEvent>;

    /**
     * 子类必须声明如何收集 run 结果。
     */
    abstract run(input: ProfileInput<TKey>, options?: RunOptions): Promise<BaseMessage[] | SubAgentCompletionResult>;
}


