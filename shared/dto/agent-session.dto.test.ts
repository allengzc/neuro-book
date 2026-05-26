import {describe, expect, it} from "vitest";
import {AgentInvokeRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";

describe("AgentInvokeRequestDtoSchema", () => {
    it("要求 prompt、steer、followup 携带 message", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "steer",
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "followup",
        }).success).toBe(false);
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "steer",
            message: {text: "调整"},
        }).success).toBe(true);
    });

    it("拒绝 continue 携带 message", () => {
        expect(AgentInvokeRequestDtoSchema.safeParse({
            mode: "continue",
            message: {text: "不应出现"},
        }).success).toBe(false);
    });
});
