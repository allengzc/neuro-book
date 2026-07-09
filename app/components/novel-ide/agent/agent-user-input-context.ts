import type {Ref} from "vue";
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";

export type AgentUserInputContext = {
    pendingSession: Ref<AgentPendingUserInputSession | null>;
    submitting: Ref<boolean>;
    selectedAnswers: Ref<Record<string, number[]>>;
    notes: Ref<Record<string, string>>;
    canSubmit: ComputedRef<boolean>;
    isLastQuestion(toolNodeId: string): boolean;
    submit(): Promise<void>;
};

export const AGENT_USER_INPUT_CONTEXT_KEY = "agent-user-input-context";
