import type {Static, TSchema} from "typebox";
import type {AgentMessage, JsonValue, Message} from "nbook/server/agent/messages/types";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {ProfileDslNode} from "nbook/server/agent/profiles/profile-dsl";
import type {SkillCatalogItem} from "nbook/server/agent/skills/skill-catalog";
import type {ClientStateSnapshot, ProfileVariableAccessor, VariableDefinition} from "nbook/server/agent/variables/types";
import type {SessionSummarizerInputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import type {AgentRuntimeDefinition, NormalizedAgentRuntimeDefinition, RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";

export type AgentProfileManifest<TKey extends string = string> = {
    key: TKey;
    name: string;
    description?: string;
};

export type AgentProfileSourceKind = "memory" | "system" | "user";

export type AgentProfileLoadStatus =
    | "loaded"
    | "not_compiled"
    | "compile_stale"
    | "compiled_load_failed"
    | "source_error";

export type AgentProfileIssueCode =
    | "load_failed"
    | "invalid_export"
    | "schema_missing"
    | "builtin_schema_locked"
    | "filename_mismatch"
    | "system_profile_shadowed"
    | "file_missing"
    | "not_compiled"
    | "compile_stale"
    | "source_stale"
    | "dependency_stale"
    | "compiled_load_failed"
    | "source_error";

export type AgentProfileIssue = {
    code: AgentProfileIssueCode;
    message: string;
    profileKey?: string;
    source?: AgentProfileSourceKind;
    sourcePath?: string;
};

export type AgentCatalogItem = {
    key: string;
    name: string;
    description?: string;
    allowedToolKeys?: readonly string[];
    inputSchema?: TSchema;
    outputSchema?: TSchema;
    source: AgentProfileSourceKind;
    sourcePath?: string;
    builtin: boolean;
    loadStatus: AgentProfileLoadStatus;
    issue?: AgentProfileIssue;
};

export type AgentCatalogSnapshot = {
    profiles: AgentCatalogItem[];
    issues: AgentProfileIssue[];
};

export type ProfilePrepareContext<TInput = JsonValue> = {
    session: RuntimeSessionFacade;
    input: TInput;
    /** 本次 invocation 的一次性入参。clientState 会同时归一化进 ctx.vars.client.*。 */
    invocation?: {
        input?: JsonValue;
        clientState?: ClientStateSnapshot;
    };
    /** 统一变量访问器。profile 普通写法优先用 TSX <Variable>/<VariableSchema> helper。 */
    vars: ProfileVariableAccessor;
    /** Agent profile catalog snapshot，用于 AgentCatalog 和 create_agent/invoke_agent 提示。 */
    catalog: AgentCatalogSnapshot;
    /** 当前可见 skill 快照，用于 SkillCatalog。 */
    skills: SkillCatalogItem[];
    runtime?: {
        now: string;
        promptUserTurnCount: number;
        /** prompt 模式下尚未写入 session 的本轮用户输入；continue 时为空。 */
        pendingUserMessage?: Message;
    };
};

export type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    /** ModelContext 内需要按 AppendingSet 语义写入 session 的运行时提醒。 */
    modelContextAppendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
    compaction?: ProfileCompactionPlan;
};

export type ProfileCompactionPlan = {
    enabled?: boolean;
    triggerPercent?: number;
    triggerTokens?: number;
    reserveTokens?: number;
    keepRecentTokens?: number;
    keepRecentPercent?: number;
    prompt?: string;
    summaryPrefix?: string;
};

export type KnownAgentProfileInputs = {
    summarizer: Omit<Static<typeof SessionSummarizerInputSchema>, "sourceSessionId">;
};

export type AgentProfileSummarizerConfig<TKey extends string = string> = {
    /** false 表示显式关闭当前 profile 的展示标题/摘要维护。 */
    enabled?: boolean;
    profileKey: TKey;
    input?: TKey extends keyof KnownAgentProfileInputs ? KnownAgentProfileInputs[TKey] : JsonValue;
};

export type SidecarProfilePassStage = "prepareRun" | "settleRun";

export type SidecarContext<TInput = JsonValue> = {
    name: string;
    stage: SidecarProfilePassStage;
    sessionId: number;
    session: RuntimeSessionFacade;
    input: TInput;
    invocationId: string;
    profileKey: string;
    runResult?: {
        status: "completed" | "waiting";
        finalMessage?: string;
        reportResult?: {
            result: string;
            success?: boolean;
            /** 为空表示主路未返回结构化 data。 */
            data?: unknown;
            /** 为空表示本次不是 sidecar 返回，或 sidecar 没有提供结构化旁路结果。 */
            sidecar_data?: unknown;
        };
    };
};

export type SidecarResult<TSidecarData = JsonValue> = {
    result: string;
    sidecarData: TSidecarData;
};

export type SidecarMergePlan = {
    runtimeMessages?: AgentMessage[];
    runtimeState?: JsonValue;
    writePlans?: SessionWritePlan[];
};

export type SidecarProfilePass<TInput = JsonValue, TSidecarData = JsonValue> = {
    name: string;
    stage: SidecarProfilePassStage;
    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);
    allowedToolKeys?: readonly string[];
    sidecarDataSchema?: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";
    merge(ctx: SidecarContext<TInput>, result: SidecarResult<TSidecarData>): SidecarMergePlan | Promise<SidecarMergePlan>;
};

export type AgentProfile<
    TInputSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
> = {
    manifest: AgentProfileManifest;
    inputSchema: TInputSchema;
    outputSchema?: TOutputSchema;
    allowedToolKeys: readonly string[];
    sidecars?: readonly SidecarProfilePass<Static<TInputSchema>, JsonValue>[];
    summarizer?: AgentProfileSummarizerConfig<TSummarizerKey>;
    runtime?: AgentRuntimeDefinition<Static<TInputSchema>> | NormalizedAgentRuntimeDefinition<Static<TInputSchema>>;
    /** profile 自带的 session.* 变量定义，随 profile `.compiled` artifact 加载。 */
    variableDefinitions?: readonly VariableDefinition[];
    context?(ctx: ProfilePrepareContext<Static<TInputSchema>>): ProfileDslNode | Promise<ProfileDslNode>;
    prepare?(ctx: ProfilePrepareContext<Static<TInputSchema>>): ProfileTurnPlan | Promise<ProfileTurnPlan>;
};
