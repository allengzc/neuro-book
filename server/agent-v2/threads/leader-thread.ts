import type {BaseMessage} from "@langchain/core/messages";
import {BaseAgentThread} from "nbook/server/agent/threads/base-agent-thread";
import type {AgentStreamEvent, AnySubAgentInput, CreateSubAgentThreadInput, LeaderInput, RunOptions, SubAgentCompletionResult, SubAgentThreadSummary} from "nbook/server/agent/types";
import type {SubAgentThread} from "nbook/server/agent/threads/subagent-thread";

/**
 * Leader 线程。
 */
export class LeaderThread extends BaseAgentThread<"leader.default"> {
    /**
     * 创建并挂接 subagent。
     */
    async createSubAgent<TKey extends string>(
        input: Omit<CreateSubAgentThreadInput<TKey>, "leaderThreadId">,
    ): Promise<SubAgentThread<TKey>> {
        return this.gateway.createSubAgentThread({
            leaderThreadId: this.id,
            profileKey: input.profileKey,
            title: input.title,
        });
    }

    /**
     * 挂接现有 subagent。
     */
    async attachSubAgent(subAgentThreadId: string): Promise<void> {
        return this.gateway.attachSubAgent(this.id, subAgentThreadId);
    }

    /**
     * 列出当前关联的 subagent。
     */
    async listSubAgents(): Promise<SubAgentThreadSummary[]> {
        return this.gateway.listSubAgents(this.id);
    }

    /**
     * 通过 leader 调用 subagent。
     */
    async runSubAgent(subAgentThreadId: string, input: AnySubAgentInput, options?: RunOptions): Promise<SubAgentCompletionResult> {
        return this.gateway.runSubAgent(this.id, subAgentThreadId, input, options);
    }

    /**
     * 派发 leader 任务。
     */
    async dispatchRun(input: LeaderInput, options?: RunOptions): Promise<void> {
        return this.gateway.dispatchLeaderRun(this.id, input, options);
    }

    /**
     * 触发一次 leader 输入，并返回当前线程流。
     */
    async *invokeStream(input: LeaderInput, options?: RunOptions): AsyncIterable<AgentStreamEvent> {
        await this.dispatchRun(input, options);
        yield* this.subscribeStream();
    }

    /**
     * 收集一次 leader run 的最终新增消息。
     */
    async run(input: LeaderInput, options?: RunOptions): Promise<BaseMessage[]> {
        return this.gateway.runLeader(this.id, input, options);
    }

}

