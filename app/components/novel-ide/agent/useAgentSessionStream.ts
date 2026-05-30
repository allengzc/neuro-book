import type {AgentSessionEventDto, AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";
import type {Ref} from "vue";
import {ref} from "vue";

export type AgentSessionStreamSnapshotReason =
    | "initial_load"
    | "seq_gap"
    | "snapshot_required"
    | "manual_refresh"
    | "invoke_error_fallback";

type AgentSessionStreamStore = {
    lastSeq: Ref<number>;
    needsSnapshot: Ref<boolean>;
    snapshotReasons: Ref<string[]>;
    applyConnectionStatus(status: "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected"): void;
    applyEvent(event: AgentSessionEventDto): void;
    applySnapshot(snapshot: AgentSessionSnapshotDto): void;
    clearSnapshotRequest(): void;
};

type AgentSessionStreamApi = {
    getSession(sessionId: number): Promise<AgentSessionSnapshotDto>;
    subscribeSessionEvents(
        sessionId: number,
        after: number,
        onEvent: (event: AgentSessionEventDto) => void | Promise<void>,
        signal?: AbortSignal,
        options?: {onOpen?: () => void},
    ): Promise<void>;
};

type AgentSessionStreamOptions = {
    session: AgentSessionStreamStore;
    api: AgentSessionStreamApi;
    activeSessionId: Ref<number | null>;
    applySnapshotSideEffects?: (snapshot: AgentSessionSnapshotDto) => void;
    onEvent?: (event: AgentSessionEventDto) => void | Promise<void>;
    onError?: (error: unknown, fallback: string) => void;
};

const reconnectDelay = (attempt: number): number => {
    const delays = [300, 800, 1500, 3000, 5000];
    return delays[Math.min(attempt, delays.length - 1)] ?? 5000;
};
const DISCONNECTED_AFTER_ATTEMPTS = 3;

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

/**
 * 管理 Agent session SSE 连接、重连和 snapshot single-flight。
 */
export function useAgentSessionStream(options: AgentSessionStreamOptions) {
    const controller = ref<AbortController | null>(null);
    const sessionId = ref<number | null>(null);
    const reconnectAttempt = ref(0);
    const lastDisconnectReason = ref("");
    let readyPromise: Promise<void> | null = null;
    let resolveReady: (() => void) | null = null;
    let rejectReady: ((error: unknown) => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshotPromise: {sessionId: number; promise: Promise<boolean>} | null = null;
    let snapshotGeneration = 0;
    let stopped = false;

    const clearReconnectTimer = (): void => {
        if (!reconnectTimer) {
            return;
        }
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    };

    const createReadyPromise = (): void => {
        readyPromise = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        void readyPromise.catch(() => {});
    };

    const scheduleReconnect = (targetSessionId: number, reason: string): void => {
        if (targetSessionId !== options.activeSessionId.value || stopped) {
            return;
        }
        lastDisconnectReason.value = reason;
        options.session.applyConnectionStatus(reconnectAttempt.value >= DISCONNECTED_AFTER_ATTEMPTS ? "disconnected" : "reconnecting");
        const delay = reconnectDelay(reconnectAttempt.value);
        reconnectAttempt.value += 1;
        reconnectTimer = setTimeout(() => {
            void start(targetSessionId).catch(() => {});
        }, delay);
    };

    const syncSnapshot = async (reason: AgentSessionStreamSnapshotReason): Promise<boolean> => {
        const targetSessionId = options.activeSessionId.value;
        if (!targetSessionId) {
            return false;
        }
        if (snapshotPromise?.sessionId === targetSessionId) {
            return snapshotPromise.promise;
        }
        const generation = snapshotGeneration;
        if (reason !== "manual_refresh" && reason !== "invoke_error_fallback") {
            options.session.applyConnectionStatus("recovering");
        }
        const request = {sessionId: targetSessionId, promise: Promise.resolve(false)};
        const promise = (async () => {
            try {
                const snapshot = await options.api.getSession(targetSessionId);
                if (generation !== snapshotGeneration || targetSessionId !== options.activeSessionId.value) {
                    return false;
                }
                options.session.applySnapshot(snapshot);
                options.session.clearSnapshotRequest();
                options.applySnapshotSideEffects?.(snapshot);
                return true;
            } catch (error) {
                options.onError?.(error, "同步 Agent session 失败");
                return false;
            } finally {
                if (snapshotPromise === request) {
                    snapshotPromise = null;
                }
            }
        })();
        request.promise = promise;
        snapshotPromise = request;
        return promise;
    };

    const handleEvent = async (targetSessionId: number, event: AgentSessionEventDto): Promise<void> => {
        if (targetSessionId !== options.activeSessionId.value) {
            return;
        }
        await options.onEvent?.(event);
        options.session.applyEvent(event);
        if (options.session.needsSnapshot.value) {
            const reason = options.session.snapshotReasons.value.includes("snapshot_required") ? "snapshot_required" : "seq_gap";
            await syncSnapshot(reason);
        }
    };

    const start = async (targetSessionId: number): Promise<void> => {
        if (controller.value && sessionId.value === targetSessionId) {
            await readyPromise;
            return;
        }
        clearReconnectTimer();
        controller.value?.abort();
        const nextController = new AbortController();
        controller.value = nextController;
        sessionId.value = targetSessionId;
        stopped = false;
        createReadyPromise();
        options.session.applyConnectionStatus(reconnectAttempt.value > 0 ? "reconnecting" : "connecting");

        void (async () => {
            try {
                await options.api.subscribeSessionEvents(targetSessionId, options.session.lastSeq.value, async (event) => {
                    await handleEvent(targetSessionId, event);
                }, nextController.signal, {
                    onOpen: () => {
                        reconnectAttempt.value = 0;
                        resolveReady?.();
                    },
                });
                scheduleReconnect(targetSessionId, "event stream closed");
            } catch (error) {
                rejectReady?.(error);
                if (targetSessionId === options.activeSessionId.value && !isAbortError(error) && !stopped) {
                    scheduleReconnect(targetSessionId, error instanceof Error ? error.message : String(error));
                }
            } finally {
                if (controller.value === nextController) {
                    controller.value = null;
                    sessionId.value = null;
                    readyPromise = null;
                    resolveReady = null;
                    rejectReady = null;
                }
            }
        })();
        await readyPromise;
    };

    const ensure = async (): Promise<void> => {
        if (!options.activeSessionId.value) {
            return;
        }
        await start(options.activeSessionId.value);
    };

    const reconnectNow = async (): Promise<void> => {
        if (!options.activeSessionId.value) {
            return;
        }
        clearReconnectTimer();
        reconnectAttempt.value = 0;
        controller.value?.abort();
        controller.value = null;
        sessionId.value = null;
        readyPromise = null;
        await start(options.activeSessionId.value);
    };

    const stop = (): void => {
        stopped = true;
        clearReconnectTimer();
        controller.value?.abort();
        controller.value = null;
        sessionId.value = null;
        readyPromise = null;
        snapshotGeneration += 1;
        snapshotPromise = null;
        options.session.applyConnectionStatus("idle");
    };

    return {
        ensure,
        lastDisconnectReason,
        reconnectNow,
        reconnectAttempt,
        start,
        stop,
        syncSnapshot,
    };
}
