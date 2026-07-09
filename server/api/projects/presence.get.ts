import {createError, createEventStream} from "h3";
import {requireProjectPathQuery} from "nbook/server/utils/novel-chapter";
import {acquireUserPresence, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";

/** 心跳间隔：保持 SSE 连接活性，避免代理层按空闲断连；也让断连能在下个心跳被发现。 */
const PRESENCE_HEARTBEAT_MS = 30_000;

/** presence SSE 事件载荷：presence_ready 建连即推且携带 projectPath；heartbeat 周期推送不携带。 */
type PresenceStreamPayload =
    | {type: "presence_ready"; projectPath: string}
    | {type: "heartbeat"};

/**
 * 用户在场 SSE（Task 94）：连接建立即 acquireUserPresence 计数 +1，断开即 release 计数 -1。
 * 项目未 open 时返回 409 + data.code="PROJECT_NOT_OPEN"，前端应先调 POST /api/projects/open。
 */
export default defineEventHandler(async (event) => {
    const projectPath = requireProjectPathQuery(event);
    let release: () => void;
    try {
        release = acquireUserPresence(projectPath);
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createError({
                statusCode: 409,
                message: "项目未打开，请先打开项目",
                data: {code: "PROJECT_NOT_OPEN", projectPath},
            });
        }
        throw error;
    }

    const eventStream = createEventStream(event);
    let streamClosed = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // 统一清理：onClosed 回调与 push 断连判定都会走这里；release 本身幂等，双触发安全。
    const cleanup = () => {
        streamClosed = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        release();
    };

    /**
     * push 一帧 presence 事件。语义：流已关闭则静默丢弃；push 命中 closed-stream 错误
     * （客户端断开附近）转 cleanup 释放在场；其余错误上抛。
     */
    const pushPresenceEvent = async (payload: PresenceStreamPayload): Promise<void> => {
        if (streamClosed) {
            return;
        }
        try {
            await eventStream.push({
                event: "presence",
                data: JSON.stringify(payload),
            });
        } catch (error) {
            if (isClosingEventStreamError(error)) {
                cleanup();
                return;
            }
            throw error;
        }
    };

    eventStream.onClosed(() => {
        cleanup();
        eventStream.close();
    });

    await pushPresenceEvent({type: "presence_ready", projectPath});
    // 30s 心跳：push 遇断连错误走 cleanup；其余瞬时错误吞掉，连接真正断开最终由 onClosed 兜底释放。
    heartbeatTimer = setInterval(() => {
        void pushPresenceEvent({type: "heartbeat"}).catch(() => undefined);
    }, PRESENCE_HEARTBEAT_MS);
    if (streamClosed) {
        // onClosed 可能在定时器建立前已触发（对齐 events.get.ts 的补偿判定），此处立即回收定时器。
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    return eventStream.send();
});
