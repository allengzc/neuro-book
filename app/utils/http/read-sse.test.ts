import {describe, expect, it} from "vitest";
import {readSseStream} from "nbook/app/utils/http/read-sse";

describe("readSseStream", () => {
    it("按帧顺序等待异步事件处理完成", async () => {
        let releaseFirst!: () => void;
        let resolveFirstStarted!: () => void;
        const order: string[] = [];
        const firstStarted = new Promise<void>((resolve) => {
            resolveFirstStarted = resolve;
        });
        const response = new Response([
            "data: {\"seq\":1}\n\n",
            "data: {\"seq\":2}\n\n",
        ].join(""));

        const reading = readSseStream<{seq: number}>(response, async (event) => {
            order.push(`start-${String(event.seq)}`);
            if (event.seq === 1) {
                resolveFirstStarted();
                await new Promise<void>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            order.push(`end-${String(event.seq)}`);
        });

        await firstStarted;
        expect(order).toEqual(["start-1"]);

        releaseFirst();
        await reading;

        expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
    });
});
