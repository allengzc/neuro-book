import {onScopeDispose, ref, watch, type Ref} from "vue";
import {readSseStream} from "nbook/app/utils/http/read-sse";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useNotification} from "nbook/app/composables/useNotification";

/**
 * 项目在场连接状态：
 * - idle：无目标项目（或非客户端环境）；
 * - connecting：正在 open + 订阅 presence（含前几次快速重连）；
 * - connected：presence SSE 在线，服务端已登记用户在场；
 * - disconnected：连续失败达阈值（仍在低频自动重试）或项目已不存在（停止重试）。
 */
export type ProjectSessionStatus = "connected" | "connecting" | "disconnected" | "idle";

/**
 * presence SSE 事件负载（presence_ready / heartbeat）。
 * kind 可空：负载形态未契约化，前端也刻意不消费内容——收到帧的「事实」用于续命读看门狗，
 * 连接本身（建立 = 声明在场，断开 = 释放在场）才是语义所在。
 */
type ProjectPresenceEventDto = {kind?: string};

/** 快速重连退避表（与 useAgentSessionStream 保持一致）。 */
const RECONNECT_DELAYS_MS = [300, 800, 1500, 3000, 5000];

/** 连续失败达到该次数：状态转 disconnected、提示一次、改用低频重试。 */
const DISCONNECTED_AFTER_ATTEMPTS = 3;

/** 达到失败阈值后的低频重试间隔。 */
const LOW_FREQUENCY_RETRY_MS = 5000;

/**
 * 读看门狗超时：服务端每 30s 发一次 heartbeat，超过该时长（略大于 2 个心跳周期）未收到任何帧
 * 即判定半开连接（TCP 未 FIN 但已失效），主动断开并重连——否则客户端会永久停留 connected
 * 而服务端早已释放在场。
 */
const PRESENCE_READ_TIMEOUT_MS = 75_000;

/**
 * Task 94：项目显式生命周期的前端接线（用户在场声明）。
 * 维持 target 指向的项目处于 open 状态并向服务端声明「用户在场」：
 * 幂等 POST /api/projects/open → 订阅 /api/projects/presence SSE（连接即在场、断开即释放）
 * → 流断开（非 abort）按退避自动重连；每次重连都先重新 POST open 再订阅——
 * 服务器重启后 session 已失，幂等 open 即恢复路径。
 *
 * @param target 当前应保持 open 的 projectPath（`workspace/<slug>` 归一形）；null 表示无目标（自动断开）。
 * @returns status 连接状态 ref（供将来 UI 展示，当前可不消费）。
 */
export function useProjectSession(target: Ref<string | null>): {status: Ref<ProjectSessionStatus>} {
    const status = ref<ProjectSessionStatus>("idle");
    // 纯 SPA（ssr:false），但按仓库惯例仍在订阅入口做客户端守卫：非客户端返回 idle 空实现。
    if (!import.meta.client) {
        return {status};
    }

    const notification = useNotification();
    // 代次守卫：target 变化 / 作用域销毁时递增，旧连接循环据此自行终止。
    let generation = 0;
    // 当前 presence SSE 连接的中断控制器。非空表示存在在途/在线的订阅连接。
    let controller: AbortController | null = null;
    // 等待中的重连定时器。非空表示已安排下一次重连。
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // 连续失败计数；成功建立连接后归零。
    let failedAttempts = 0;
    // 本轮断线是否已提示过，避免低频重试期间反复弹通知；连接恢复后复位。
    let interruptWarned = false;

    /** 终止当前连接循环：代次失效 + 清定时器 + 中断 SSE（服务端随连接断开释放在场）+ 复位计数。 */
    const stopCurrent = (): void => {
        generation += 1;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        controller?.abort();
        controller = null;
        failedAttempts = 0;
        interruptWarned = false;
    };

    /** 安排一次重连：前两次按退避表快速重试；连续 3 次失败提示一次并转入 5s 低频重试。 */
    const scheduleReconnect = (projectPath: string, gen: number): void => {
        if (gen !== generation) {
            return;
        }
        const attempt = failedAttempts;
        failedAttempts += 1;
        if (failedAttempts >= DISCONNECTED_AFTER_ATTEMPTS) {
            status.value = "disconnected";
            if (!interruptWarned) {
                interruptWarned = true;
                notification.warning("项目在场连接中断，将自动重试", {title: "项目连接中断"});
            }
        } else {
            status.value = "connecting";
        }
        const delay = failedAttempts >= DISCONNECTED_AFTER_ATTEMPTS
            ? LOW_FREQUENCY_RETRY_MS
            : RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? LOW_FREQUENCY_RETRY_MS;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connect(projectPath, gen);
        }, delay);
    };

    /** 单次连接流程：幂等 open → 订阅 presence SSE；失败、流断开或读看门狗超时（非主动 abort）走重连。 */
    const connect = async (projectPath: string, gen: number): Promise<void> => {
        if (gen !== generation) {
            return;
        }
        try {
            // 每次（重）连都先重新 open：服务器重启后 session 已失，幂等 open 是恢复路径。
            await $fetch("/api/projects/open", {method: "POST", body: {projectPath}});
        } catch (error) {
            if (gen !== generation) {
                return;
            }
            // 提取 HTTP 状态码：$fetch FetchError 带 status/statusCode；无法识别按 null。
            const errObj = typeof error === "object" && error !== null ? (error as {status?: unknown; statusCode?: unknown}) : null;
            const status404 = typeof errObj?.status === "number" ? errObj.status === 404 : errObj?.statusCode === 404;
            if (status404) {
                // 项目目录已不存在（或被标记删除）：提示并停止该 target 的重试。
                status.value = "disconnected";
                notification.error(resolveApiErrorMessage(error, `项目不存在或已删除：${projectPath}`), {title: "项目打开失败"});
                return;
            }
            scheduleReconnect(projectPath, gen);
            return;
        }
        if (gen !== generation) {
            return;
        }
        const nextController = new AbortController();
        controller = nextController;
        // 读看门狗：超时未收到任何帧（含心跳）即半开，主动 abort 并重连（区别于 stopCurrent 的主动断开）。
        let readTimer: ReturnType<typeof setTimeout> | null = null;
        let staleReconnect = false;
        const resetReadWatchdog = (): void => {
            if (readTimer) {
                clearTimeout(readTimer);
            }
            readTimer = setTimeout(() => {
                staleReconnect = true;
                nextController.abort();
            }, PRESENCE_READ_TIMEOUT_MS);
        };
        try {
            const response = await fetch(`/api/projects/presence?projectPath=${encodeURIComponent(projectPath)}`, {
                method: "GET",
                signal: nextController.signal,
            });
            resetReadWatchdog();
            await readSseStream<ProjectPresenceEventDto>(response, () => {
                // 收到任意帧（presence_ready / heartbeat）即为连接活性证据，续命读看门狗；内容无需处理。
                resetReadWatchdog();
            }, {
                onOpen: () => {
                    if (gen !== generation) {
                        return;
                    }
                    failedAttempts = 0;
                    interruptWarned = false;
                    status.value = "connected";
                    resetReadWatchdog();
                },
            });
            // 流被服务端正常收尾（非 abort）：按断线处理，重连以恢复在场。
            scheduleReconnect(projectPath, gen);
        } catch (error) {
            if (gen !== generation) {
                return;
            }
            // 主动 abort（DOMException/AbortError）：看门狗触发的要重连，stopCurrent 触发的已被上面 gen 变更拦截。
            if (error instanceof DOMException && error.name === "AbortError") {
                if (staleReconnect) {
                    scheduleReconnect(projectPath, gen);
                }
                return;
            }
            scheduleReconnect(projectPath, gen);
        } finally {
            if (readTimer) {
                clearTimeout(readTimer);
                readTimer = null;
            }
            if (controller === nextController) {
                controller = null;
            }
        }
    };

    // target 变化：先停掉旧项目的连接循环（abort 即向服务端释放在场），再为新项目建立会话。
    watch(target, (next) => {
        stopCurrent();
        if (!next) {
            status.value = "idle";
            return;
        }
        status.value = "connecting";
        void connect(next, generation);
    }, {immediate: true});

    // 作用域销毁（页面卸载 / HMR）：断开全部连接与定时器，服务端 presence 随连接断开而释放。
    onScopeDispose(() => {
        stopCurrent();
        status.value = "idle";
    });

    return {status};
}
