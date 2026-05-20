import type {BaseMessage} from "@langchain/core/messages";
import type {ZodType} from "zod";
import type {ProfileContext, ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {AgentMessageCreateInput, AgentThreadKind, AgentThreadMetadata, ProfileInput, ProfileKey, ProfileOutput, ToolKey} from "nbook/server/agent/types";

/**
 * Profile 运行前需要持久化的上下文消息。
 */
export type PreparedProfilePersistedMessages = {
    /**
     * 写入历史树根部之前的稳定前缀，通常来自首次注入的 HistorySet。
     */
    prepend: AgentMessageCreateInput[];
    /**
     * 写入当前活动光标之后的运行期上下文，通常来自 Watch、显式激活 skill 和本轮输入。
     */
    append: AgentMessageCreateInput[];
    /**
     * append 的插入锚点。
     * 为空时使用当前 active cursor；continue 模式下可指向尾部用户输入，
     * 让 AppendingSet 历史消息插入到当前用户输入之前。
     */
    appendBeforeMessageId?: string;
};

/**
 * Profile prepare 产物。
 * modelMessages 用于真正发送给模型；persistedMessages 会在 run 开始前写入产品历史。
 */
export type PreparedProfileRun = {
    modelMessages: BaseMessage[];
    persistedMessages: PreparedProfilePersistedMessages;
    /**
     * run 开始前即可提交的线程 metadata。
     * 仅用于和已持久化历史消息绑定的状态，例如 Watch baseline。
     */
    immediateMetadata: AgentThreadMetadata;
    /**
     * run 最终 completed 后才提交的线程 metadata。
     * 用于表示模型稳定收到并完成处理后的 runtime 状态，例如 Reminder 消费状态。
     */
    completedMetadata: AgentThreadMetadata;
};

/**
 * Profile ingest 阶段。
 * 表示 ReAct loop 产物即将写回历史的来源。
 */
export type ProfileIngestPhase =
    | "assistant_iteration"
    | "assistant_success"
    | "assistant_stopped"
    | "assistant_failure"
    | "tool_result"
    | "interrupted_tools";

/**
 * Profile ingest 输入。
 * messages 是即将写入历史的候选消息，profile 可以按阶段过滤或改写。
 */
export type ProfileIngestInput<TKey extends ProfileKey> = {
    runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>;
    phase: ProfileIngestPhase;
    messages: AgentMessageCreateInput[];
};

/**
 * AgentProfile 最低层抽象。
 * 复杂 profile 可以完全掌控 prepare。
 */
export abstract class AgentProfile<TKey extends ProfileKey> implements ProfileContext<TKey, AgentProfile<TKey>> {
    /**
     * profile 唯一键。
     */
    abstract readonly key: TKey;

    /**
     * 该 profile 对应 leader 还是 subagent。
     */
    abstract readonly kind: AgentThreadKind;

    /**
     * profile 展示名称。
     */
    abstract readonly name: string;

    /**
     * profile 输入 schema。
     */
    abstract readonly inputSchema: ZodType<ProfileInput<TKey>>;

    /**
     * profile 结构化输出 schema。
     * 存在时，report_result.data 必须符合该结构。
     */
    readonly outputSchema?: ZodType<ProfileOutput<TKey>>;

    /**
     * 当前 profile 允许调用的工具列表。
     */
    abstract readonly allowedToolKeys: readonly ToolKey[];

    /**
     * 构造本次发送给模型的完整消息。
     */
    abstract prepare(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
    ): Promise<PreparedProfileRun>;

    /**
     * 处理 ReAct loop 产物如何写回历史。
     * 默认透传；需要清洗错误工具结果、压缩中间轨迹时由具体 profile 覆盖。
     */
    async ingest(input: ProfileIngestInput<TKey>): Promise<AgentMessageCreateInput[]> {
        return input.messages;
    }
}
