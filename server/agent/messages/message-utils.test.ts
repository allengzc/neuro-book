import {describe, expect, it} from "vitest";
import type {Usage} from "@earendil-works/pi-ai";
import {sumUsage} from "nbook/server/agent/messages/message-utils";

describe("sumUsage", () => {
    it("仅当来源提供时汇总 reasoning 与 cacheWrite1h", () => {
        expect(sumUsage([usage(1, 2), usage(3, 4)])).not.toHaveProperty("reasoning");
        expect(sumUsage([
            {...usage(1, 2), reasoning: 1, cacheWrite1h: 3},
            usage(3, 4),
        ])).toMatchObject({reasoning: 1, cacheWrite1h: 3});
    });
});

function usage(input: number, output: number): Usage {
    return {
        input,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input + output,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    };
}
