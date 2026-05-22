import type {AgentMessage, JsonValue, Message, Model, ThinkingLevel} from "nbook/server/agent/messages/types";

export type SessionId = number;
export type SessionEntryId = string;

export type SessionMetadata = {
    sessionId: SessionId;
    profileKey: string;
    input: JsonValue;
    workspaceRoot: string;
    workspaceKey: string;
    parentSessionId?: SessionId;
    createdAt: number;
    title?: string;
    summary?: string;
};

export type MessageSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "message";
    message: Message;
};

export type SessionUpdateEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_update";
    updates: {
        title?: string;
        summary?: string;
    };
};

export type CustomSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "custom";
    key: string;
    value: JsonValue;
};

export type CustomMessageSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "custom_message";
    message: AgentMessage;
    visibleToModel: boolean;
};

export type LeafSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "leaf";
    leafId: SessionEntryId | null;
};

export type CompactionSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "compaction";
    summary: string;
    firstKeptEntryId: SessionEntryId | null;
    tokensBefore: number;
    details?: {
        instructions?: string;
        reserveTokens?: number;
        keepRecentTokens?: number;
    };
};

export type BranchSummaryEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "branch_summary";
    fromLeafId: SessionEntryId;
    toLeafId: SessionEntryId;
    summary: string;
};

export type LabelSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "label";
    targetEntryId: SessionEntryId;
    label: string;
};

export type ModelChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "model_change";
    model: Model<any> | null;
};

export type ThinkingLevelChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "thinking_level_change";
    thinkingLevel: ThinkingLevel;
};

export type ProfileChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "profile_change";
    profileKey: string;
    input?: JsonValue;
};

export type VariableChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "variable_change";
    key: string;
    value: JsonValue;
};

export type SessionArchivedEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_archived";
    reason?: string;
};

export type InvocationLifecycleEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "invocation_lifecycle";
    invocationId: string;
    status: "start" | "end" | "error" | "aborted";
    error?: string;
};

export type SessionEntry =
    | MessageSessionEntry
    | SessionUpdateEntry
    | CustomSessionEntry
    | CustomMessageSessionEntry
    | LeafSessionEntry
    | CompactionSessionEntry
    | BranchSummaryEntry
    | LabelSessionEntry
    | ModelChangeEntry
    | ThinkingLevelChangeEntry
    | ProfileChangeEntry
    | VariableChangeEntry
    | SessionArchivedEntry
    | InvocationLifecycleEntry;

export type SessionFileRecord =
    | {
        kind: "header";
        metadata: SessionMetadata;
    }
    | {
        kind: "entry";
        entry: SessionEntry;
    };

export type SessionSnapshot = {
    metadata: SessionMetadata;
    entries: SessionEntry[];
    leafId: SessionEntryId | null;
};

export type NeuroSessionContext = {
    systemPrompt: string;
    messages: AgentMessage[];
    model: Model<any> | null;
    thinkingLevel: ThinkingLevel;
    profileKey: string;
    workspaceRoot: string;
    customState: Record<string, JsonValue>;
    linkedAgents: LinkedAgentSummary[];
    title?: string;
    summary?: string;
    archived: boolean;
    planModeActive: boolean;
};

export type LinkedAgentSummary = {
    sessionId: SessionId;
    profileKey: string;
    detached: boolean;
};

export type SessionTreeNode = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    type: SessionEntry["type"];
    timestamp: number;
    active: boolean;
    terminal: boolean;
    childCount: number;
    role?: string;
    messageId?: string;
    preview?: string;
    toolName?: string;
    label?: string;
};

export type SessionEntryDraft = SessionEntry extends infer TEntry
    ? TEntry extends SessionEntry
        ? Omit<TEntry, "id" | "parentId" | "timestamp">
        : never
    : never;
