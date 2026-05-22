import type {InjectionKey, Ref} from "vue";
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";

export type AgentUserInputAnswerDraft = {
    selectedAnswers: Ref<Record<string, number[]>>;
    notes: Ref<Record<string, string>>;
};

export type AgentRequestUserInputContext = {
    pendingSession: Ref<AgentPendingUserInputSession | null>;
    submitting: Ref<boolean>;
    draft: AgentUserInputAnswerDraft;
    submitAnswers: () => void;
};

export const AGENT_REQUEST_USER_INPUT_CONTEXT_KEY: InjectionKey<AgentRequestUserInputContext> = Symbol("agent-request-user-input-context");
