import type {AgentMessage, AgentToolCall, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import type {AgentProfile, ProfileCompactionPlan} from "nbook/server/agent/profiles/types";
import type {AgentRuntimeHookStage} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext, InvocationErrorInfo, SessionSnapshot} from "nbook/server/agent/session/types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {AgentInvokeCaller, InvokeAgentResult} from "nbook/server/agent/harness/types";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";

export type RunRuntimeState = Map<string, JsonValue>;

export type PendingSessionWritePlan = {
    toolCallIndex: number;
    toolCallId: string;
    enqueueOrder: number;
    plan: SessionWritePlan;
};

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
    caller: AgentInvokeCaller;
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
    reportResultReminder?: boolean;
    runtimeMessages: AgentMessage[];
};

export type TurnIngestResult = {
    transcript: "persist" | "runtime_only";
};

export type CompletedRunLoopResult = {
    status: "completed";
    finalAssistant?: AssistantMessage;
    reportResult?: InvokeAgentResult["reportResult"];
};

export type WaitingRunLoopResult = {
    status: "waiting";
    finalAssistant?: AssistantMessage;
    reportResult?: InvokeAgentResult["reportResult"];
    waiting: NonNullable<RunToolBatchResult["waiting"]>;
};

export type FailedRunLoopResult = {
    status: "failed";
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
    sessionContextEnabled: boolean;
    toolKeys: string[];
    /** 当前 phase 实际可执行工具；为空时等于 toolKeys。 */
    executionToolKeys?: string[];
    profileKey: string;
    profile: AgentProfile;
    thinkingLevel: ThinkingLevel;
    runtimeState: RunRuntimeState;
    abortSignal?: AbortSignal;
    messages: AgentMessage[];
    /** prepareNextTurn 注入的下一轮临时上下文；进入一次 provider snapshot 后清空。 */
    nextTurnRuntimeMessages: AgentMessage[];
    reportResult?: InvokeAgentResult["reportResult"];
    finalAssistant?: AssistantMessage;
    turnIndex: number;
    reportResultReminderSent: boolean;
    reportResultReminderEnabled: boolean;
    caller: AgentInvokeCaller;
    /** sidecar run 强制不把 assistant/toolResult transcript 写入 session。 */
    forceRuntimeOnlyTranscript?: boolean;
    /** sidecar run 默认不向公开事件流发送内部 turn 事件。 */
    suppressEvents?: boolean;
    /** sidecar run 不消费用户 steer，避免旁路吃掉主 run 的引导。 */
    disableSteer?: boolean;
    /** sidecar run 不触发自动压缩，避免旁路写入 compaction entry。 */
    disableAutomaticCompaction?: boolean;
    /** 当前 turn 内已经执行过自动压缩。 */
    automaticCompactionDoneForTurn: boolean;
    lastTurnIngest?: TurnIngestResult;
    pendingWritePlans: PendingSessionWritePlan[];
    onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
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
    executionToolKeys: string[];
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
