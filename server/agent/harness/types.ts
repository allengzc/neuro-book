import type {AgentUserMessageInput, JsonValue, Usage} from "nbook/server/agent/messages/types";
import type {InvocationErrorInfo, InvocationErrorPhase, SessionMetadata} from "nbook/server/agent/session/types";
import type {AgentResolution} from "nbook/server/agent/tools/types";
import type {ClientStateSnapshot} from "nbook/server/agent/variables/types";
import type {
    AgentAbortRequestDto,
    AgentActiveInvocationDto,
    AgentCommandRequestDto,
    AgentFollowUpQueueStateDto,
    AgentQueuedMessageDto,
    AgentRuntimeStreamEventDto,
    AgentSessionListPageDto,
    AgentSessionListQueryDto,
    AgentSessionRelationsDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";

export type CreateAgentInput = {
    profileKey: string;
    initial?: JsonValue;
    /** 可选展示标题；为空时使用 profile manifest name。 */
    title?: string;
    workspaceRoot?: string;
    workspaceKey?: string;
    projectPath?: string;
    parentSessionId?: number;
};

export type CreateAgentResult = {
    sessionId: number;
    profileKey: string;
    title?: string;
};

export type InvokeAgentInput = {
    sessionId: number;
    mode: "prompt" | "continue" | "steer" | "followup";
    message?: AgentUserMessageInput;
    payload?: JsonValue;
    /** 可选展示标题；提供时会在 invocation admission 成功后写入目标 session。 */
    title?: string;
    /** 向后兼容：单个 resolution */
    resolution?: AgentResolution;
    /** 批量 resolutions，用于多个 tool approval 场景 */
    resolutions?: AgentResolution[];
    clientState?: ClientStateSnapshot;
    caller?: AgentInvokeCaller;
    block?: boolean;
    onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
    internalQueued?: boolean;
};

export type AgentInvokeCallerKind = "user" | "agent" | "sidecar" | "system";

export type AgentInvokeCaller = {
    kind: AgentInvokeCallerKind;
    sessionId?: number;
    profileKey?: string;
    toolCallId?: string;
};

export type InvokeAgentStatus = "completed" | "waiting" | "error";

export type InvokeAgentResult = {
    sessionId: number;
    invocationId: string;
    status: InvokeAgentStatus;
    finalMessage?: string;
    reportResult?: {
        result: string;
        success?: boolean;
        /** 为空表示本次主路没有可用结构化结果，例如任务失败或只返回可读错误说明。 */
        data?: unknown;
    };
    error?: string;
    errorPhase?: InvocationErrorPhase;
    errorInfo?: InvocationErrorInfo;
    usage?: Usage;
    elapsedMs?: number;
    queuedItem?: AgentQueuedMessageDto;
};

export type AgentSummary = {
    sessionId: number;
    profileKey: string;
    workspaceRoot: string;
    title?: string;
    summary?: string;
    status: "idle" | "detached";
};

export type SessionRecentMessage = {
    role: SessionRecentMessageRole;
    text: string;
    timestamp?: number;
};

export type SessionRecentMessageRole = "user" | "assistant" | "toolResult";

export type SessionQueryInput = {
    sessionId?: number;
    includeRecentMessages?: boolean;
    recentMessageLimit?: number;
    recentMessageRoles?: SessionRecentMessageRole[];
    tokenBudget?: number;
};

export type SessionQueryResult = {
    metadata: SessionMetadata;
    activeLeafId: string | null;
    title?: string;
    summary?: string;
    usage?: Usage;
    linkedAgents: AgentSummary[];
    recentMessages?: SessionRecentMessage[];
};

export type AgentRuntimeState = {
    activeInvocation: AgentActiveInvocationDto | null;
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
};

export type AgentCommandResult = {
    status: "completed" | "started";
    sessionId: number;
    snapshot?: AgentSessionSnapshotDto;
    createdSession?: AgentSessionSummaryDto;
};

export type AgentTreeResult = {
    status: "completed" | "invoked";
    snapshot: AgentSessionSnapshotDto;
    invocation?: InvokeAgentResult;
};

export type AgentAbortResult = {
    status: "idle" | "aborted";
    sessionId: number;
};

export type AgentSessionService = {
    listSessions(query?: AgentSessionListQueryDto): Promise<AgentSessionSummaryDto[]>;
    listSessionPage(query?: AgentSessionListQueryDto): Promise<AgentSessionListPageDto>;
    getSessionSnapshot(sessionId: number): Promise<AgentSessionSnapshotDto>;
    getSessionRelations(sessionId: number): Promise<AgentSessionRelationsDto>;
    runCommand(sessionId: number, body: AgentCommandRequestDto): Promise<AgentCommandResult>;
    moveTree(sessionId: number, body: AgentTreeRequestDto): Promise<AgentTreeResult>;
    abortInvocation(sessionId: number, body?: AgentAbortRequestDto): Promise<AgentAbortResult>;
};
