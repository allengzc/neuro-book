import type {AgentEvent} from "@earendil-works/pi-agent-core";
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
    AgentSessionListQueryDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";

export type CreateAgentInput = {
    profileKey: string;
    input?: JsonValue;
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
    resolution?: AgentResolution;
    clientState?: ClientStateSnapshot;
    block?: boolean;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
    internalQueued?: boolean;
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
        data?: unknown;
    };
    error?: string;
    errorPhase?: InvocationErrorPhase;
    errorInfo?: InvocationErrorInfo;
    usage?: Usage;
    events: AgentEvent[];
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
    role: string;
    text: string;
    timestamp?: number;
};

export type SessionQueryInput = {
    sessionId?: number;
    includeRecentMessages?: boolean;
    recentMessageLimit?: number;
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
    getSessionSnapshot(sessionId: number): Promise<AgentSessionSnapshotDto>;
    runCommand(sessionId: number, body: AgentCommandRequestDto): Promise<AgentCommandResult>;
    moveTree(sessionId: number, body: AgentTreeRequestDto): Promise<AgentTreeResult>;
    abortInvocation(sessionId: number, body?: AgentAbortRequestDto): Promise<AgentAbortResult>;
};
