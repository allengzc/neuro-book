import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AgentUserMessageInput, JsonValue, Usage} from "nbook/server/agent/messages/types";
import type {SessionMetadata, SessionTreeNode} from "nbook/server/agent/session/types";
import type {AgentResolution} from "nbook/server/agent/tools/types";

export type CreateAgentInput = {
    profileKey: string;
    input?: JsonValue;
    workspaceRoot?: string;
    workspaceKey?: string;
    parentSessionId?: number;
};

export type CreateAgentResult = {
    sessionId: number;
    profileKey: string;
    title?: string;
};

export type InvokeAgentInput = {
    sessionId: number;
    mode: "prompt" | "continue";
    message?: AgentUserMessageInput;
    resolution?: AgentResolution;
    block?: boolean;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
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
    usage?: Usage;
    events: AgentEvent[];
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

export type SessionQueryResult = {
    metadata: SessionMetadata;
    activeLeafId: string | null;
    tree: SessionTreeNode[];
    title?: string;
    summary?: string;
    usage?: Usage;
    linkedAgents: AgentSummary[];
    recentMessages: SessionRecentMessage[];
};
