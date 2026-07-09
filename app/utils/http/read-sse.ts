/**
 * SSE 事件处理器。
 */
export type SseEventHandler<TEvent> = (event: TEvent) => void | Promise<void>;

export type SseReadOptions = {
    onOpen?: () => void;
};

export class SseHttpError extends Error {
    constructor(readonly status: number) {
        super(`请求失败：${status}`);
        this.name = "SseHttpError";
    }
}

/**
 * 解析单个 SSE 数据帧。
 */
const parseSseFrame = <TEvent>(frame: string): TEvent | null => {
    const lines = frame.split("\n");
    const dataLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).replace(/^ /, ""));
        }
    }

    const dataText = dataLines.join("\n");
    if (!dataText) {
        return null;
    }

    return JSON.parse(dataText) as TEvent;
};

/**
 * 读取一个 SSE 响应流。
 * 仅负责协议解析，不负责具体业务事件语义。
 */
export const readSseStream = async <TEvent>(
    response: Response,
    onEvent: SseEventHandler<TEvent>,
    options: SseReadOptions = {},
): Promise<void> => {
    if (!response.ok) {
        throw new SseHttpError(response.status);
    }
    if (!response.body) {
        throw new Error("服务端未返回流式数据");
    }
    options.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, {stream: true});
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
            const event = parseSseFrame<TEvent>(frame);
            if (event) {
                await onEvent(event);
            }
        }
    }

    if (buffer.trim()) {
        const event = parseSseFrame<TEvent>(buffer);
        if (event) {
            await onEvent(event);
        }
    }
};
