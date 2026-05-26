import type {H3Event} from "h3";

type ServerTimingMark = {
    name: string;
    durationMs: number;
};

/**
 * 收集并写出 Server-Timing 响应头。
 */
export function createServerTiming(event: H3Event) {
    const marks: ServerTimingMark[] = [];

    const measure = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
        const startedAt = performance.now();
        try {
            return await task();
        } finally {
            marks.push({
                name,
                durationMs: performance.now() - startedAt,
            });
        }
    };

    const commit = (): void => {
        if (marks.length === 0) {
            return;
        }
        setResponseHeader(event, "Server-Timing", marks
            .map((mark) => `${mark.name};dur=${mark.durationMs.toFixed(1)}`)
            .join(", "));
    };

    return {
        measure,
        commit,
    };
}

