import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {AgentMessage, AgentToolCall, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import type {AgentProfile, ProfileCompactionPlan} from "nbook/server/agent/profiles/types";
import type {AgentRuntimeHookStage} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext, InvocationErrorInfo, SessionSnapshot} from "nbook/server/agent/session/types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {InvokeAgentResult} from "nbook/server/agent/harness/types";

export type RunRuntimeState = Map<string, JsonValue>;

export type RunToolBatchResult = {
    toolResults: ToolResultMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    toolOverrides?: Record<string, NeuroAgentTool>;
    waiting?: {
        toolCallId: string;
        toolName: string;
    };
    shouldContinue: boolean;
};

export type RuntimeHookExecutionInput = {
    sessionId: number;
    invocationId: string;
    profile: AgentProfile;
    runtimeState: RunRuntimeState;
    stage: AgentRuntimeHookStage;
    snapshot?: SessionSnapshot;
    context?: NeuroSessionContext;
    turnIndex?: number;
    pendingUserMessage?: Message;
    turn?: {
        assistant: AssistantMessage;
        toolResults: ToolResultMessage[];
        waiting?: RunToolBatchResult["waiting"];
        messageStatus?: "partial" | "interrupted" | "error";
    };
    runResult?: {
        status: "completed" | "waiting";
        finalAssistant?: AssistantMessage;
        reportResult?: InvokeAgentResult["reportResult"];
        waiting?: RunToolBatchResult["waiting"];
    };
    modelMessages?: AgentMessage[];
    activeHookBuiltin?: boolean;
};

export type RuntimeHookExecutionResult = {
    requestOptionsPatch?: Record<string, JsonValue>;
    toolKeysPatch?: string[];
    transcript?: "persist" | "runtime_only";
    profilePrompt?: boolean;
    sessionContext?: boolean;
    automaticCompaction?: boolean;
    reportResultReminder?: boolean;
    runtimeMessages: AgentMessage[];
};

export type TurnIngestResult = {
    transcript: "persist" | "runtime_only";
};

export type CompletedRunLoopResult = {
    status: "completed";
    events: AgentEvent[];
    finalAssistant?: AssistantMessage;
    reportResult?: InvokeAgentResult["reportResult"];
};

export type WaitingRunLoopResult = {
    status: "waiting";
    events: AgentEvent[];
    finalAssistant?: AssistantMessage;
    reportResult?: InvokeAgentResult["reportResult"];
    waiting: NonNullable<RunToolBatchResult["waiting"]>;
};

export type FailedRunLoopResult = {
    status: "failed";
    events: AgentEvent[];
    finalAssistant?: AssistantMessage;
    errorInfo: InvocationErrorInfo;
    terminalStatus?: "error" | "aborted" | "interrupted";
};

export type RunLoopResult = CompletedRunLoopResult | WaitingRunLoopResult | FailedRunLoopResult;

export type RunTurnTransactionResult =
    | {
        kind: "next";
        shouldContinue: boolean;
    }
    | {
        kind: "waiting";
        result: RunLoopResult;
    }
    | {
        kind: "failed";
        result: RunLoopResult;
    };

export type RunKernelPhase = "model" | "ingest" | "compaction" | "settleRun" | "unknown";

export type RunFrame = {
    invocationId?: string;
    sessionId: number;
    workspaceKey: string;
    workspaceRoot: string;
    projectPath?: string;
    systemPrompt: string;
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    compaction?: ProfileCompactionPlan;
    toolKeys: string[];
    profileKey: string;
    profile: AgentProfile;
    thinkingLevel: ThinkingLevel;
    runtimeState: RunRuntimeState;
    abortSignal?: AbortSignal;
    messages: AgentMessage[];
    events: AgentEvent[];
    reportResult?: InvokeAgentResult["reportResult"];
    finalAssistant?: AssistantMessage;
    turnIndex: number;
    reportResultReminderSent: boolean;
    reportResultReminderEnabled: boolean;
    automaticCompactionEnabled: boolean;
    lastTurnIngest?: TurnIngestResult;
    pendingWritePlans: SessionWritePlan[];
    onEvent?: (event: AgentEvent) => void | Promise<void>;
};

export type TurnSnapshot = {
    index: number;
    sessionSnapshot: SessionSnapshot;
    sessionContext: NeuroSessionContext;
    systemPrompt: string;
    modelMessages: AgentMessage[];
    providerMessages: Message[];
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    toolKeys: string[];
    toolOverrides: Record<string, NeuroAgentTool>;
    tools: ReturnType<AgentToolRegistry["allowed"]>;
    thinkingLevel: ThinkingLevel;
};

export type RuntimeTurn = {
    index: number;
    snapshot: TurnSnapshot;
    assistant: AssistantMessage;
    toolCalls: AgentToolCall[];
    toolResults: ToolResultMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    waiting?: RunToolBatchResult["waiting"];
    shouldContinue: boolean;
};

export type TurnContinuationReason = "tool" | "steer" | "report_result";

export type TurnContinuationDecision = {
    continue: boolean;
    reasons: TurnContinuationReason[];
    steeredMessages: Message[];
    needsReportResultReminder: boolean;
};

export type SuccessfulTurnOutcome =
    | {
        kind: "completed";
        turn: RuntimeTurn;
    }
    | {
        kind: "waiting";
        turn: RuntimeTurn;
        waiting: NonNullable<RunToolBatchResult["waiting"]>;
    };

export type FailedTurnOutcome = {
    kind: "failed";
    phase: "provider" | "tool" | "approval" | "unknown";
    errorInfo: InvocationErrorInfo;
    finalAssistant: AssistantMessage;
    partialAssistant?: AssistantMessage;
    messageStatus?: "partial" | "interrupted" | "error";
};

export type TurnOutcome = SuccessfulTurnOutcome | FailedTurnOutcome;
