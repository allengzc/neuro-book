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
    AgentSessionEventsQueryDto,
    AgentSessionListQueryDto,
    AgentSessionSnapshotDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
    ClientVariablePatchAckDto,
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

    const acknowledgeClientVariablePatch = (sessionId: number, body: ClientVariablePatchAckDto) => {
        return $fetch<{ok: boolean}>(`/api/agent/sessions/${sessionId}/client-variable-patch-acks`, {
            method: "POST",
            body,
        });
    };

    const subscribeSessionEvents = async (
        sessionId: number,
        cursor: AgentSessionEventsQueryDto,
        onEvent: (event: AgentSessionEventDto) => void | Promise<void>,
        signal?: AbortSignal,
        options: {onOpen?: () => void} = {},
    ): Promise<void> => {
        const query = new URLSearchParams();
        if (typeof cursor.after === "number") {
            query.set("after", String(cursor.after));
        }
        if (cursor.eventEpoch) {
            query.set("eventEpoch", cursor.eventEpoch);
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        const response = await fetch(`/api/agent/sessions/${sessionId}/events${suffix}`, {
            signal,
        });
        await readSseStream<AgentSessionEventDto>(response, onEvent, options);
    };

    return {
        acknowledgeClientVariablePatch,
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
