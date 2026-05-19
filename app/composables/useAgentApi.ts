import {readSseStream, SseHttpError} from "nbook/app/utils/http/read-sse";
import type {
    ClientVariablesDto,
    AgentRunOptionsDto,
    AgentStreamEventDto,
    AgentThreadDetailDto,
    AgentThreadSummaryDto,
    AttachSubAgentThreadRequestDto,
    CreateAgentMessageRequestDto,
    CreateAgentThreadRequestDto,
    CreateSubAgentThreadRequestDto,
    DispatchAgentRunRequestDto,
    AgentConversationMutationResponseDto,
    SubmitUserInputAnswersRequestDto,
    UpdateAgentPlanModeRequestDto,
    UpdateAgentThreadModelRequestDto,
    UpdateAgentMessageRequestDto,
} from "nbook/shared/dto/agent-chat.dto";
import {AGENT_CLIENT_VARIABLES_HEADER} from "nbook/shared/dto/agent-chat.dto";

type AgentEventHandler = (event: AgentStreamEventDto) => void;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = {
    [key: string]: JsonValue;
};
type UseAgentApiOptions = {
    getClientVariables?: () => ClientVariablesDto | null | undefined;
};
type AgentStreamSubscribeOptions = {
    onOpen?: () => void;
};

const SSE_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;

/**
 * 等待指定时间，期间响应 abort 信号。
 */
async function waitForReconnectDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }

    await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
            signal?.removeEventListener("abort", abort);
        };
        const timer = window.setTimeout(() => {
            cleanup();
            resolve();
        }, delayMs);
        const abort = (): void => {
            window.clearTimeout(timer);
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, {once: true});
    });
}

/**
 * Agent API 前端访问层。
 * 统一封装 thread、subagent、stream 相关请求。
 */
export function useAgentApi(options: UseAgentApiOptions = {}) {
    /**
     * 构造 agent 请求头。
     */
    const buildHeaders = (): HeadersInit | undefined => {
        const clientVariables = options.getClientVariables?.();
        if (!clientVariables) {
            return undefined;
        }
        const json = JSON.stringify(clientVariables);
        // Encode to Base64 to support UTF-8 (like Chinese characters) in HTTP headers.
        // The standard btoa() only supports ASCII, so we encode to bytes first.
        const bytes = new TextEncoder().encode(json);
        const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
        const base64 = btoa(binString);

        return {
            [AGENT_CLIENT_VARIABLES_HEADER]: base64,
        };
    };

    /**
     * 查询线程列表。
     */
    const listThreads = async (kind: "leader" | "subagent" = "leader", profileKey?: string): Promise<AgentThreadSummaryDto[]> => {
        return $fetch<AgentThreadSummaryDto[]>("/api/agent/threads", {
            headers: buildHeaders(),
            query: {
                kind,
                ...(profileKey ? {profileKey} : {}),
            },
        });
    };

    /**
     * 创建线程。
     */
    const createThread = async (input: CreateAgentThreadRequestDto = {}): Promise<AgentThreadSummaryDto> => {
        return $fetch<AgentThreadSummaryDto>("/api/agent/threads", {
            headers: buildHeaders(),
            method: "POST",
            body: input,
        });
    };

    /**
     * 获取线程详情。
     */
    const getThreadDetail = async (threadId: string): Promise<AgentThreadDetailDto> => {
        return $fetch<AgentThreadDetailDto>(`/api/agent/threads/${threadId}`, {
            headers: buildHeaders(),
        });
    };

    /**
     * 更新线程模型覆盖。
     */
    const updateThreadModel = async (
        threadId: string,
        body: UpdateAgentThreadModelRequestDto,
    ): Promise<AgentThreadSummaryDto> => {
        return $fetch<AgentThreadSummaryDto>(`/api/agent/threads/${threadId}/model`, {
            headers: buildHeaders(),
            method: "PATCH",
            body,
        });
    };

    /**
     * 切换线程软 Plan Mode。
     */
    const updateThreadPlanMode = async (
        threadId: string,
        body: UpdateAgentPlanModeRequestDto,
    ): Promise<{ok: true}> => {
        return $fetch<{ok: true}>(`/api/agent/threads/${threadId}/plan-mode`, {
            headers: buildHeaders(),
            method: "PATCH",
            body,
        });
    };

    /**
     * 删除线程。
     */
    const deleteThread = async (threadId: string): Promise<{ok: true}> => {
        return $fetch<{ok: true}>(`/api/agent/threads/${threadId}`, {
            headers: buildHeaders(),
            method: "DELETE",
        });
    };

    /**
     * 通过统一写口触发线程运行。
     */
    const invokeThread = async (
        threadId: string,
        body: DispatchAgentRunRequestDto,
    ): Promise<{ok: true}> => {
        return $fetch<{ok: true}>(`/api/agent/threads/${threadId}/invoke`, {
            headers: buildHeaders(),
            method: "POST",
            body,
        });
    };

    /**
     * 停止当前线程运行。
     */
    const abortThreadRun = async (threadId: string): Promise<{ok: true}> => {
        return $fetch<{ok: true}>(`/api/agent/threads/${threadId}/abort`, {
            headers: buildHeaders(),
            method: "POST",
        });
    };

    /**
     * 创建新的用户消息节点。
     */
    const createMessage = async (
        threadId: string,
        body: CreateAgentMessageRequestDto,
    ): Promise<AgentConversationMutationResponseDto> => {
        return $fetch<AgentConversationMutationResponseDto>(`/api/agent/threads/${threadId}/messages`, {
            headers: buildHeaders(),
            method: "POST",
            body,
        });
    };

    /**
     * 提交 request_user_input 的答案。
     */
    const submitUserInputAnswers = async (
        threadId: string,
        body: SubmitUserInputAnswersRequestDto,
    ): Promise<{ok: true}> => {
        return $fetch<{ok: true}>(`/api/agent/threads/${threadId}/user-input/answers`, {
            headers: buildHeaders(),
            method: "POST",
            body,
        });
    };

    /**
     * 改写一条历史消息。
     */
    const updateMessage = async (
        threadId: string,
        messageId: string,
        body: UpdateAgentMessageRequestDto,
    ): Promise<AgentConversationMutationResponseDto> => {
        return $fetch<AgentConversationMutationResponseDto>(`/api/agent/threads/${threadId}/messages/${messageId}`, {
            headers: buildHeaders(),
            method: "PATCH",
            body,
        });
    };

    /**
     * 回退一条历史消息及其后续消息。
     */
    const rollbackMessage = async (threadId: string, messageId: string): Promise<AgentConversationMutationResponseDto> => {
        return $fetch<AgentConversationMutationResponseDto>(`/api/agent/threads/${threadId}/messages/${messageId}/rollback`, {
            headers: buildHeaders(),
            method: "POST",
        });
    };

    /**
     * 刷新指定消息。
     */
    const refreshMessage = async (threadId: string, messageId: string): Promise<AgentConversationMutationResponseDto> => {
        return $fetch<AgentConversationMutationResponseDto>(`/api/agent/threads/${threadId}/messages/${messageId}/refresh`, {
            headers: buildHeaders(),
            method: "POST",
        });
    };

    /**
     * 激活指定 continuation 节点。
     */
    const activateMessage = async (threadId: string, messageId: string): Promise<AgentConversationMutationResponseDto> => {
        return $fetch<AgentConversationMutationResponseDto>(`/api/agent/threads/${threadId}/messages/${messageId}/activate`, {
            headers: buildHeaders(),
            method: "POST",
        });
    };

    /**
     * 订阅当前线程的长期事件流。
     */
    const subscribeThreadStream = async (
        threadId: string,
        onEvent: AgentEventHandler,
        signal?: AbortSignal,
        options: AgentStreamSubscribeOptions = {},
    ): Promise<void> => {
        let reconnectAttempt = 0;
        let terminalStateReceived = false;

        while (!signal?.aborted) {
            try {
                const response = await fetch(`/api/agent/threads/${threadId}/stream`, {
                    headers: buildHeaders(),
                    method: "GET",
                    signal,
                });

                await readSseStream<AgentStreamEventDto>(response, (event) => {
                    if (event.type === "run_state" && ["completed", "stopped", "failed"].includes(event.status)) {
                        terminalStateReceived = true;
                    }
                    onEvent(event);
                }, options);
                if (terminalStateReceived) {
                    return;
                }
                reconnectAttempt = 0;
                const delayMs = SSE_RECONNECT_DELAYS_MS[0] ?? 500;
                await waitForReconnectDelay(delayMs, signal);
            } catch (error) {
                if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
                    throw error;
                }
                if (error instanceof SseHttpError) {
                    throw error;
                }
                const delayMs = SSE_RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, SSE_RECONNECT_DELAYS_MS.length - 1)] ?? 5_000;
                reconnectAttempt += 1;
                await waitForReconnectDelay(delayMs, signal);
            }
        }
    };

    /**
     * 查询 leader 关联的 subagent。
     */
    const listThreadSubagents = async (threadId: string): Promise<AgentThreadSummaryDto[]> => {
        return $fetch<AgentThreadSummaryDto[]>(`/api/agent/threads/${threadId}/subagents`, {
            headers: buildHeaders(),
        });
    };

    /**
     * 创建并挂接新的 subagent。
     */
    const createThreadSubagent = async (
        threadId: string,
        body: CreateSubAgentThreadRequestDto,
    ): Promise<AgentThreadSummaryDto> => {
        return $fetch<AgentThreadSummaryDto>(`/api/agent/threads/${threadId}/subagents`, {
            headers: buildHeaders(),
            method: "POST",
            body,
        });
    };

    /**
     * 挂接已有 subagent。
     */
    const attachThreadSubagent = async (
        threadId: string,
        body: AttachSubAgentThreadRequestDto,
    ): Promise<{ok: true}> => {
        return $fetch<{ok: true}>(`/api/agent/threads/${threadId}/subagents/attach`, {
            headers: buildHeaders(),
            method: "POST",
            body,
        });
    };

    /**
     * 创建本轮运行请求体。
     */
    const createPromptDispatchBody = (prompt: string, options?: AgentRunOptionsDto): DispatchAgentRunRequestDto => {
        return {
            mode: "prompt",
            input: {
                prompt,
            },
            options,
        };
    };

    /**
     * 创建继续运行请求体。
     */
    const createContinueDispatchBody = (options?: AgentRunOptionsDto): DispatchAgentRunRequestDto => {
        return {
            mode: "continue",
            options,
        };
    };

    return {
        activateMessage,
        attachThreadSubagent,
        createMessage,
        createContinueDispatchBody,
        createPromptDispatchBody,
        createThread,
        createThreadSubagent,
        deleteThread,
        abortThreadRun,
        getThreadDetail,
        invokeThread,
        listThreads,
        listThreadSubagents,
        refreshMessage,
        rollbackMessage,
        subscribeThreadStream,
        submitUserInputAnswers,
        updateThreadModel,
        updateThreadPlanMode,
        updateMessage,
    };
}
