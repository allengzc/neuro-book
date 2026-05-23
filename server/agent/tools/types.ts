import type {AgentTool, JsonValue} from "nbook/server/agent/messages/types";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";

export type ToolExecutionContext = {
    harness: NeuroAgentHarness;
    sessionId: number;
    parentSessionId?: number;
    workspaceRoot: string;
    workspaceKey: string;
};

export type NeuroAgentTool = AgentTool<any, any> & {
    key: string;
    approvalRequired?: boolean;
    /**
     * v3 harness 自己执行工具时使用的上下文入口。Pi 的 AgentTool.execute 没有当前 session 信息，
     * 所以需要把 Neuro Book 的 session/link 语义保留在这一层。
     */
    executeWithContext?: (
        context: ToolExecutionContext,
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: Parameters<AgentTool<any, any>["execute"]>[3],
    ) => ReturnType<AgentTool<any, any>["execute"]>;
};

export type ToolApprovalResolution = {
    kind: "tool_approval";
    toolCallId: string;
    approved: boolean;
    resultText?: string;
    data?: JsonValue;
    answers?: UserInputResolution["answers"];
};

export type UserInputResolution = {
    kind: "user_input";
    toolCallId: string;
    answers: Array<{
        questionIndex: number;
        text: string;
        selectedOptionIndex?: number;
        selectedOptionIndexes?: number[];
        note?: string;
        ignored?: boolean;
    }>;
};

export type AgentResolution = ToolApprovalResolution | UserInputResolution;
