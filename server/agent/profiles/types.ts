import type {Static, TSchema} from "typebox";
import type {AgentMessage, JsonValue, Message} from "nbook/server/agent/messages/types";
import type {NeuroSessionContext, SessionEntryDraft} from "nbook/server/agent/session/types";

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
    | "filename_mismatch";

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
    catalog: AgentCatalogSnapshot;
};

export type PreparedTurn = {
    systemPrompt?: string;
    historyMessages?: Message[];
    dynamicMessages?: AgentMessage[];
    appendingMessages?: Message[];
    toolKeys?: string[];
    sessionWrites?: SessionEntryDraft[];
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
    prepare(ctx: ProfilePrepareContext<Static<TInputSchema>>): PreparedTurn | Promise<PreparedTurn>;
    ingest?(ctx: ProfilePrepareContext<Static<TInputSchema>>): ProfileIngestResult | Promise<ProfileIngestResult>;
};
