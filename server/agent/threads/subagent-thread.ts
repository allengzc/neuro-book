import type {BaseMessage} from "@langchain/core/messages";
import {BaseAgentThread} from "nbook/server/agent/threads/base-agent-thread";
import type {AgentStreamEvent, ProfileInput, RunOptions, SubAgentCompletionResult, SubAgentProfileKey} from "nbook/server/agent/types";

/**
 * Subagent 线程。
 */
export class SubAgentThread<TKey extends SubAgentProfileKey> extends BaseAgentThread<TKey> {
    /**
     * 派发一次新的 subagent 任务。
     */
    async dispatchRun(input: ProfileInput<TKey>, options?: RunOptions): Promise<void> {
        return this.gateway.dispatchDetachedSubAgent(this.id, input, options);
    }

    /**
     * 触发一次 subagent 输入，并返回当前线程流。
     */
    async *invokeStream(input: ProfileInput<TKey>, options?: RunOptions): AsyncIterable<AgentStreamEvent> {
        await this.dispatchRun(input, options);
        yield* this.subscribeStream();
    }

    /**
     * 在当前 subagent 历史上运行一次结构化输入。
     */
    async run(input: ProfileInput<TKey>, options?: RunOptions): Promise<SubAgentCompletionResult<TKey>> {
        return this.gateway.runDetachedSubAgent(this.id, input, options) as Promise<SubAgentCompletionResult<TKey>>;
    }

}

/**
 * 任意 subagent 线程联合。
 */
export type AnySubAgentThread =
    | SubAgentThread<"subagent.writer">
    | SubAgentThread<"subagent.retrieval">
    | SubAgentThread<string>;

