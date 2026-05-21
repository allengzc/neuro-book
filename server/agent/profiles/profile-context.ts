import type {BaseMessage} from "@langchain/core/messages";
import type {AgentMessageStore} from "nbook/server/agent/messages/agent-message-store";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {AgentProfile, PreparedProfileRun} from "nbook/server/agent/profiles/agent-profile";
import type {AgentThreadRecord, ProfileInput, ProfileKey, ProfileOutput, RunOptions, AgentVariableScope, SkillCatalogItem} from "nbook/server/agent/types";
import type {AgentVariableStore} from "nbook/server/agent/store/agent-variable-store";

/**
 * Profile 上下文运行时依赖。
 * profile 会通过这个对象访问产品级消息历史与强类型变量作用域。
 */
export type ProfileContextRuntime<
    TKey extends ProfileKey,
    TInput = ProfileInput<TKey>,
    TOutput = ProfileOutput<TKey>,
    TProfile = AgentProfile<TKey, TInput, TOutput>,
> = {
    thread: AgentThreadRecord;
    profile: TProfile;
    input: TInput;
    scope: AgentVariableScope<TKey, TInput>;
    skillCatalog: readonly SkillCatalogItem[];
    options: RunOptions;
    messageStore: AgentMessageStore;
    loadHistoryMessages(): Promise<BaseMessage[]>;
    threadRepository: ThreadRepository;
    variableStore: AgentVariableStore;
};

/**
 * Profile 上下文接口。
 * profile 需要自行决定如何组装完整上下文。
 */
export interface ProfileContext<
    TKey extends ProfileKey,
    TInput = ProfileInput<TKey>,
    TOutput = ProfileOutput<TKey>,
    TProfile = unknown,
> {
    /**
     * 根据当前输入、变量与历史，构造本次发送给模型的完整消息与待持久化前导消息。
     */
    prepare(
        runtime: ProfileContextRuntime<TKey, TInput, TOutput, TProfile>,
    ): Promise<PreparedProfileRun>;
}
