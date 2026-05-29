import type {AgentMessage, AssistantMessage, JsonValue, Message, ToolResultMessage} from "nbook/server/agent/messages/types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {NeuroSessionContext, SessionId, SessionSnapshot} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";

export type AgentRuntimeHookStage =
    | "prepareRun"
    | "prepareTurn"
    | "ingestTurn"
    | "prepareNextTurn"
    | "settleRun";

export type RuntimeSessionReadResult = {
    snapshot: SessionSnapshot;
    context: NeuroSessionContext;
};

export type RuntimeAgentDialogueContentInput = {
    /** 为空时读取当前 hook 所属 session。 */
    sessionId?: SessionId;
    /** 传入 snapshot 时不会再次读取 session。 */
    snapshot?: SessionSnapshot;
    /** 参与 fingerprint，默认使用当前 profileKey。 */
    profileKey?: string;
    /** 参与 fingerprint，默认使用当前 profile input。 */
    input?: JsonValue;
};

export type RuntimeSessionFacade = NeuroSessionContext & {
    /**
     * 只读读取 session，并返回 snapshot 与 reduce 后的 context。
     *
     * 不提供 append/publish 能力；hook 写入必须返回 SessionWritePlan。
     */
    read(sessionId?: SessionId): Promise<RuntimeSessionReadResult>;
    /**
     * 从指定 session 的 active path 构造 Agent Dialogue Content。
     *
     * 这是 summarizer 等 profile 读取 source session 的推荐入口。
     */
    agentDialogueContent(input?: RuntimeAgentDialogueContentInput): Promise<AgentDialogueContent>;
};

export type AgentRuntimeHookResult = {
    writePlans?: SessionWritePlan[];
    runtimeState?: JsonValue;
    /**
     * 只进入当前 RunFrame 的模型上下文，不写入 session history。
     *
     * 第一版用于 `prepareRun` / `prepareNextTurn`，让 runtime hook 能为下一轮构造临时上下文。
     */
    runtimeMessages?: AgentMessage[];
    /**
     * 仅 `ingestTurn` stage 生效。
     *
     * `persist` 表示把 assistant/toolResult transcript 写入 session。
     * `runtime_only` 表示本轮 transcript 只保留在当前 RunFrame，不写入 session 历史。
     * 没有任何 hook 返回 transcript 时，不会隐式落盘；普通 profile 依赖内置 `transcriptPersistence` hook 显式声明默认行为。
     */
    transcript?: "persist" | "runtime_only";
    /**
     * 仅内置 hook 使用的运行策略。
     *
     * profile 作者不需要手写这个字段；组合 built-in runtime bundle 即可启用对应默认行为。
     */
    builtinBehavior?: {
        profilePrompt?: boolean;
        reportResultReminder?: boolean;
        automaticCompaction?: boolean;
        sessionContext?: boolean;
    };
    turnSnapshotPatch?: {
        requestOptions?: Record<string, JsonValue>;
        toolKeys?: string[];
    };
};

export type AgentRuntimeHook<TInput = JsonValue> = {
    name: string;
    stage: AgentRuntimeHookStage;
    builtin?: true;
    run(ctx: AgentRuntimeHookContext<TInput>): AgentRuntimeHookResult | Promise<AgentRuntimeHookResult>;
};

export type AgentRuntimeBuiltin<TInput = JsonValue> = {
    kind: "builtin";
    name: string;
    hooks: readonly AgentRuntimeHook<TInput>[];
};

export type AgentRuntimeItem<TInput = JsonValue> = AgentRuntimeHook<TInput> | AgentRuntimeBuiltin<TInput>;

export type AgentRuntimeHookContext<TInput = JsonValue> = {
    stage: AgentRuntimeHookStage;
    sessionId: number;
    invocationId: string;
    profileKey: string;
    input: TInput;
    session: RuntimeSessionFacade;
    runtimeState: JsonValue | undefined;
    turnIndex?: number;
    pendingUserMessage?: Message;
    turn?: {
        assistant: AssistantMessage;
        toolResults: ToolResultMessage[];
        waiting?: {
            toolCallId: string;
            toolName: string;
        };
        messageStatus?: "partial" | "interrupted" | "error";
    };
    runResult?: {
        status: "completed" | "waiting";
        finalAssistant?: AssistantMessage;
        reportResult?: {
            result: string;
            success?: boolean;
            data?: unknown;
        };
        waiting?: {
            toolCallId: string;
            toolName: string;
        };
    };
    modelMessages?: AgentMessage[];
};

export type AgentRuntimeDefinition<TInput = JsonValue> = {
    hooks: readonly AgentRuntimeItem<TInput>[];
};

export type NormalizedAgentRuntimeDefinition<TInput = JsonValue> = {
    hooks: readonly AgentRuntimeHook<TInput>[];
};

/**
 * 定义 profile runtime hook bundle。
 *
 * 这个 helper 只规范化 hook 声明，不创建 session，也不执行副作用。
 */
export function defineAgentRuntime<TInput = JsonValue>(runtime: AgentRuntimeDefinition<TInput>): NormalizedAgentRuntimeDefinition<TInput> {
    const hooks = expandRuntimeHooks(runtime.hooks);
    const seen = new Set<string>();
    for (const hook of hooks) {
        if (!hook.name.trim()) {
            throw new Error("runtime hook name 不能为空");
        }
        const key = `${hook.stage}:${hook.name}`;
        if (seen.has(key)) {
            throw new Error(`runtime hook 重复：${key}`);
        }
        seen.add(key);
    }
    return {hooks};
}

export const agentRuntimeBuiltins = {
    defaultSessionRuntime<TInput = JsonValue>(): NormalizedAgentRuntimeDefinition<TInput> {
        return defineAgentRuntime({
            hooks: [
                this.sessionRuntime<TInput>(),
            ],
        });
    },
    sessionRuntime<TInput = JsonValue>(): AgentRuntimeBuiltin<TInput> {
        return {
            kind: "builtin",
            name: "sessionRuntime",
            hooks: [
                builtinHook("profilePrompt", "prepareRun", {
                    builtinBehavior: {
                        profilePrompt: true,
                    },
                }),
                builtinHook("sessionContext", "prepareRun", {
                    builtinBehavior: {
                        sessionContext: true,
                    },
                }),
                builtinHook("transcriptPersistence", "ingestTurn", {
                    transcript: "persist",
                }),
                builtinHook("compact", "prepareNextTurn", {
                    builtinBehavior: {
                        automaticCompaction: true,
                    },
                }),
                builtinHook("reportResult", "prepareRun", {
                    builtinBehavior: {
                        reportResultReminder: true,
                    },
                }),
            ],
        };
    },
};

function expandRuntimeHooks<TInput>(items: readonly AgentRuntimeItem<TInput>[]): AgentRuntimeHook<TInput>[] {
    return items.flatMap((item) => isRuntimeBuiltin(item) ? item.hooks : [item]);
}

function isRuntimeBuiltin<TInput>(item: AgentRuntimeItem<TInput>): item is AgentRuntimeBuiltin<TInput> {
    return "kind" in item && item.kind === "builtin";
}

function builtinHook<TInput = JsonValue>(name: string, stage: AgentRuntimeHookStage, result: AgentRuntimeHookResult = {}): AgentRuntimeHook<TInput> {
    return {
        name: `builtin.${name}`,
        stage,
        builtin: true,
        run() {
            return result;
        },
    };
}
