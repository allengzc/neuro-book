import {readSseStream} from "nbook/app/utils/http/read-sse";
import type {
    InvokeAgentResult,
} from "nbook/server/agent/harness/types";
import type {
    AgentAbortRequestDto,
    AgentCommandRequestDto,
    AgentCreateSessionRequestDto,
    AgentInvokeRequestDto,
    AgentSessionEventDto,
    AgentSessionListQueryDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";

/**
 * Agent session HTTP API。新前端只使用 /api/agent/sessions/**。
 */
export function useAgentSessionApi() {
    const listSessions = (query: AgentSessionListQueryDto = {}) => {
        return $fetch<AgentSessionSummaryDto[]>("/api/agent/sessions", {
            query,
        });
    };

    const createSession = (body: AgentCreateSessionRequestDto) => {
        return $fetch<{sessionId: number; profileKey: string; title?: string}>("/api/agent/sessions", {
            method: "POST",
            body,
        });
    };

    const getSession = (sessionId: number) => {
        return $fetch<AgentSessionSnapshotDto>(`/api/agent/sessions/${sessionId}`);
    };

    const invokeSession = (sessionId: number, body: AgentInvokeRequestDto) => {
        return $fetch<InvokeAgentResult>(`/api/agent/sessions/${sessionId}/invocations`, {
            method: "POST",
            body,
        });
    };

    const runCommand = (sessionId: number, body: AgentCommandRequestDto) => {
        return $fetch<{
            status: "completed" | "started";
            sessionId: number;
            snapshot?: AgentSessionSnapshotDto;
            createdSession?: AgentSessionSummaryDto;
        }>(`/api/agent/sessions/${sessionId}/commands`, {
            method: "POST",
            body,
        });
    };

    const moveTree = (sessionId: number, body: AgentTreeRequestDto) => {
        return $fetch<{
            status: "completed" | "invoked";
            snapshot: AgentSessionSnapshotDto;
            invocation?: InvokeAgentResult;
        }>(`/api/agent/sessions/${sessionId}/tree`, {
            method: "POST",
            body,
        });
    };

    const abortSession = (sessionId: number, body: AgentAbortRequestDto = {}) => {
        return $fetch(`/api/agent/sessions/${sessionId}/abort`, {
            method: "POST",
            body,
        });
    };

    const subscribeSessionEvents = async (
        sessionId: number,
        after: number,
        onEvent: (event: AgentSessionEventDto) => void,
        signal?: AbortSignal,
        options: {onOpen?: () => void} = {},
    ): Promise<void> => {
        const response = await fetch(`/api/agent/sessions/${sessionId}/events?after=${String(after)}`, {
            signal,
        });
        await readSseStream<AgentSessionEventDto>(response, onEvent, options);
    };

    return {
        abortSession,
        createSession,
        getSession,
        invokeSession,
        listSessions,
        moveTree,
        runCommand,
        subscribeSessionEvents,
    };
}
