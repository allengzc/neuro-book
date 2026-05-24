import type {Static, TSchema} from "typebox";
import type {AgentMessage, JsonValue, Message} from "nbook/server/agent/messages/types";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";
import type {ProfileDslNode} from "nbook/server/agent/profiles/profile-dsl";
import type {SkillCatalogItem} from "nbook/server/agent/skills/skill-catalog";

export type AgentProfileManifest<TKey extends string = string> = {
    key: TKey;
    name: string;
    description?: string;
};

export type AgentProfileSourceKind = "memory" | "system" | "user";

export type AgentProfileLoadStatus = "loaded" | "error";

export type AgentProfileIssueCode =
    | "load_failed"
    | "invalid_export"
    | "schema_missing"
    | "builtin_schema_locked"
    | "filename_mismatch"
    | "system_profile_shadowed"
    | "file_missing";

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
    session: NeuroSessionContext;
    input: TInput;
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

export type ProfileIngestResult = {
    messageWrites?: Message[];
    sessionUpdates?: {
        title?: string;
        summary?: string;
    };
};

export type AgentProfile<
    TInputSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
> = {
    manifest: AgentProfileManifest;
    inputSchema: TInputSchema;
    outputSchema?: TOutputSchema;
    allowedToolKeys: readonly string[];
    context?(ctx: ProfilePrepareContext<Static<TInputSchema>>): ProfileDslNode | Promise<ProfileDslNode>;
    prepare?(ctx: ProfilePrepareContext<Static<TInputSchema>>): ProfileTurnPlan | Promise<ProfileTurnPlan>;
    ingest?(ctx: ProfilePrepareContext<Static<TInputSchema>>): ProfileIngestResult | Promise<ProfileIngestResult>;
};
