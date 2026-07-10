import type {Static, TSchema} from "typebox";
import type {AgentMessage, JsonValue, Message} from "nbook/server/agent/messages/types";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {ProfileDslNode} from "nbook/server/agent/profiles/profile-dsl";
import type {SkillCatalogItem} from "nbook/server/agent/skills/skill-catalog";
import type {ClientStateSnapshot, ProfileVariableAccessor, VariableDefinition} from "nbook/server/agent/variables/types";
import type {SessionSummarizerInitialSchema} from "nbook/server/agent/profiles/builtin-contracts";
import type {AgentRuntimeDefinition, NormalizedAgentRuntimeDefinition, RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {AgentInvokeCaller} from "nbook/server/agent/harness/types";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";
import type {LowCodeFormDefinition} from "nbook/server/low-code-form";
import type {LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";
import type {ProfileHomeDefinition, ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import type {ProfileTurnContextPlan} from "nbook/server/agent/profiles/profile-turn-context";

export type AgentProfileManifest<TKey extends string = string> = {
    key: TKey;
    name: string;
    description?: string;
    version?: number;
};

export type AgentProfileSourceKind = "memory" | "system" | "user";

export type AgentProfileLoadStatus =
    | "loaded"
    | "compiling"
    | "compile_failed"
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
    | "compile_failed"
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
    toolKeys?: readonly string[];
    initialSchema?: TSchema;
    payloadSchema?: TSchema;
    outputSchema?: TSchema;
    source: AgentProfileSourceKind;
    sourcePath?: string;
    builtin: boolean;
    loadStatus: AgentProfileLoadStatus;
    hasSettingsForm: boolean;
    /** profile 源码是否声明了后台会话摘要（summarizer），设置面板据此展示摘要开关。 */
    hasSummarizer: boolean;
    canResetHome: boolean;
    issue?: AgentProfileIssue;
};

export type AgentCatalogSnapshot = {
    profiles: AgentCatalogItem[];
    issues: AgentProfileIssue[];
};

type ProfileSettingsContext<TSettings> = TSettings extends undefined
    ? {settings?: LowCodeJsonObject}
    : unknown extends TSettings
        ? {settings?: LowCodeJsonObject}
    : {settings: TSettings};

type StaticSettings<TSettingsSchema extends TSchema | undefined> = [TSettingsSchema] extends [TSchema]
    ? Static<TSettingsSchema>
    : undefined;

export type ProfilePrepareContext<TInitial = JsonValue, TPayload = unknown, TSettings = undefined> = {
    session: RuntimeSessionFacade;
    /** 创建 agent session 时传入的稳定初始化参数。 */
    initial: TInitial;
    /** 本次 invocation 的一次性入参。clientState 会同时归一化进 ctx.vars.client.*。 */
    invocation?: {
        payload?: TPayload;
        message?: string;
        clientState?: ClientStateSnapshot;
        caller: AgentInvokeCaller;
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
    /** 当前 profile home。Project session 读取时 Project 优先、Global 兜底；写入仍落当前主 home。 */
    home?: ProfileHomeFacade;
} & ProfileSettingsContext<TSettings>;

export type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    /** ModelContext 内需要按 AppendingSet 语义写入 session 的运行时提醒。 */
    modelContextAppendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    /** 每个 provider turn 由 profile 显式声明并动态物化的 AppendingSet 上下文。 */
    turnContexts?: ProfileTurnContextPlan[];
    stateWrites?: SessionEntryDraft[];
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
    summarizer: Omit<Static<typeof SessionSummarizerInitialSchema>, "sourceSessionId">;
};

export type AgentProfileSummarizerConfig<TKey extends string = string> = {
    /** false 表示显式关闭当前 profile 的展示标题/摘要维护。 */
    enabled?: boolean;
    profileKey: TKey;
    input?: TKey extends keyof KnownAgentProfileInputs ? KnownAgentProfileInputs[TKey] : JsonValue;
};

export type SidecarProfilePassStage = "prepareRun" | "settleRun";

export type SidecarContext<TInitial = JsonValue> = {
    name: string;
    stage: SidecarProfilePassStage;
    sessionId: number;
    session: RuntimeSessionFacade;
    initial: TInitial;
    invocationId: string;
    profileKey: string;
    caller: AgentInvokeCaller;
    runResult?: {
        status: "completed" | "waiting";
        finalMessage?: string;
        reportResult?: {
            result: string;
            success?: boolean;
            /** 为空表示主路未返回结构化 data。 */
            data?: unknown;
        };
    };
};

export type SidecarResult<TSidecarData = JsonValue> = {
    result: string;
    sidecarData: TSidecarData;
};

export type SidecarMergePlan = {
    runtimeMessages?: AgentMessage[];
    persistedMessages?: Message[];
    runtimeState?: JsonValue;
    writePlans?: SessionWritePlan[];
};

export type SidecarProfilePass<TInitial = JsonValue, TSidecarData = JsonValue> = {
    name: string;
    stage: SidecarProfilePassStage;
    enterPrompt: string | ((ctx: SidecarContext<TInitial>) => string);
    toolKeys?: readonly string[];
    sidecarDataSchema?: TSchema;
    outputFallback?: "final_message_as_result" | "parse_final_message_json";
    merge(ctx: SidecarContext<TInitial>, result: SidecarResult<TSidecarData>): SidecarMergePlan | Promise<SidecarMergePlan>;
};

export type AgentProfileDefinition<
    TInitialSchema extends TSchema = TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSettingsSchema extends TSchema | undefined = TSchema | undefined,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = {
    manifest: AgentProfileManifest;
    initialSchema: TInitialSchema;
    payloadSchema?: TPayloadSchema;
    outputSchema?: TOutputSchema;
    settingsForm?: TSettingsSchema extends TSchema ? LowCodeFormDefinition<TSettingsSchema> : undefined;
    home?: ProfileHomeDefinition;
    tools: TTools;
    /** 主 run 实际可执行工具；不声明时等于 tools 的全部 key。sidecar 仍可声明自己的执行子集。 */
    toolKeys?: readonly (keyof TTools & string)[];
    /**
     * Skill catalog 可见性白名单。声明 include 后，prepare ctx.skills 只保留列表内的 skill key。
     * 这是提示层可见性过滤，不是文件级权限隔离：文件工具仍可读取任何 skill 目录。不声明时全量可见。
     */
    skills?: {include: readonly string[]};
    sidecars?: readonly SidecarProfilePass<Static<TInitialSchema>, JsonValue>[];
    summarizer?: AgentProfileSummarizerConfig<TSummarizerKey>;
    compaction?: ProfileCompactionPlan;
    runtime?: AgentRuntimeDefinition<Static<TInitialSchema>> | NormalizedAgentRuntimeDefinition<Static<TInitialSchema>>;
    /** profile 自带的 session.* 变量定义，随 profile `.compiled` artifact 加载。 */
    variableDefinitions?: readonly VariableDefinition[];
    context?(ctx: ProfilePrepareContext<Static<TInitialSchema>, Static<TPayloadSchema>, StaticSettings<TSettingsSchema>>): ProfileDslNode | Promise<ProfileDslNode>;
    prepare?(ctx: ProfilePrepareContext<Static<TInitialSchema>, Static<TPayloadSchema>, StaticSettings<TSettingsSchema>>): ProfileTurnPlan | Promise<ProfileTurnPlan>;
};

export type AgentProfile<
    TInitialSchema extends TSchema = TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSettingsSchema extends TSchema | undefined = TSchema | undefined,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = Omit<AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools>, "sidecars"> & {
    /** 运行时只需要 sidecar 合同本身；profile 定义阶段仍按 InitialSchema 约束 ctx.initial。 */
    sidecars?: readonly SidecarProfilePass<any, JsonValue>[];
    /** 由 tools 对象派生的稳定 root 工具 key 列表。运行时以 tools 为真相源，此字段只供便捷读取。 */
    rootToolKeys: readonly (keyof TTools & string)[];
};
