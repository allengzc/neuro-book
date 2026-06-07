import type {AgentMessage, JsonValue, Message, Model, ThinkingLevel} from "nbook/server/agent/messages/types";
import type {VariableJsonPatchOperation, VariableNamespace} from "nbook/server/agent/variables/types";

export type SessionId = number;
export type SessionEntryId = string;

export type SessionMetadata = {
    sessionId: SessionId;
    profileKey: string;
    input: JsonValue;
    workspaceRoot: string;
    workspaceKey: string;
    projectPath?: string;
    parentSessionId?: SessionId;
    createdAt: number;
    title?: string;
    summary?: string;
    /** system session 默认从普通列表隐藏；summarizer 表示 session 展示元数据维护者。 */
    systemRole?: "summarizer";
};

export type SessionProjectionScope = {
    scope: "activeLeaf";
    leafId: SessionEntryId | null;
};

export type MessageSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "message";
    message: Message;
    /** 为空表示旧 entry 或手工追加；prompt 表示真实用户 prompt。 */
    origin?: "prompt" | "harness" | "manual" | "ingest";
    /** partial 表示 provider stream 中途失败后保存的半截 assistant。 */
    status?: "partial" | "interrupted" | "error";
};

export type SessionUpdateEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_update";
    /** projection 表示后台元数据更新，不改变 active leaf，但参与 session reduce。 */
    origin?: "projection";
    /** 限制 projection 只在特定 active leaf 下参与 reduce。 */
    projectionScope?: SessionProjectionScope;
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
    /** projection 表示后台状态投影，不改变 active leaf，但参与 session reduce。 */
    origin?: "projection";
    /** 限制 projection 只在特定 active leaf 下参与 reduce。 */
    projectionScope?: SessionProjectionScope;
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
    /** auto 表示普通 append 后自动移动；move 表示用户/控制面显式重定位 active path。 */
    origin?: "auto" | "move";
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
        triggerPercent?: number;
        triggerTokens?: number;
        promptSource?: "default" | "profile";
        summaryPrefixSource?: "default" | "profile";
        recentTokens?: number;
        summarizedTokens?: number;
        visibleTokensBefore?: number;
        firstKeptEntryType?: "message" | "custom_message";
        visibleEntryCountBefore?: number;
        recentEntryCount?: number;
        summarizedEntryCount?: number;
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
    /** null 表示清除 session 覆盖，重新跟随 Agent Profile。 */
    thinkingLevel: ThinkingLevel | null;
};

export type ProfileChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "profile_change";
    profileKey: string;
    input?: JsonValue;
};

export type VariablePatchSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "variable_patch";
    namespace: VariableNamespace;
    path: string;
    operations: VariableJsonPatchOperation[];
    source: "agent" | "profile" | "frontend" | "user";
    invocationId?: string;
    toolCallId?: string;
};

export type ClientVariablePatchAckEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "client_variable_patch_ack";
    namespace: "client";
    path: string;
    operations: VariableJsonPatchOperation[];
    appliedValue?: JsonValue;
    error?: string;
    invocationId?: string;
    toolCallId?: string;
};

export type SessionArchivedEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_archived";
    reason?: string;
};

export type InvocationErrorPhase = "prepare" | "pre_loop" | "model" | "tool" | "ingest" | "compaction" | "settleRun" | "unknown";

export type InvocationErrorInfo = {
    message: string;
    phase: InvocationErrorPhase;
    retryable?: boolean;
    code?: string;
};

export type InvocationLifecycleEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "invocation_lifecycle";
    invocationId: string;
    status: "start" | "waiting" | "resumed" | "end" | "error" | "aborted" | "interrupted";
    error?: string;
    errorInfo?: InvocationErrorInfo;
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
    | VariablePatchSessionEntry
    | ClientVariablePatchAckEntry
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
    }
    | {
        kind: "batch";
        entries: SessionEntry[];
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
    /** Session 级显式 thinking 覆盖；null 表示跟随 Agent Profile 默认。 */
    thinkingLevel: ThinkingLevel | null;
    profileKey: string;
    workspaceRoot: string;
    projectPath?: string;
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
