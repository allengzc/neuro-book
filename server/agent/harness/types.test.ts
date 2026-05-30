import {describe, expectTypeOf, it} from "vitest";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";
import type {InvokeAgentResult} from "nbook/server/agent/harness/types";

describe("InvokeAgentResult public contract", () => {
    it("不返回历史 runtime events，事件只走 SSE/onEvent", () => {
        expectTypeOf<InvokeAgentResult>().not.toHaveProperty("events");
    });
});

describe("AgentRuntimeStreamEventDto public contract", () => {
    it("agent_end / turn_end 不包含 PI 的大字段", () => {
        type AgentEnd = Extract<AgentRuntimeStreamEventDto, {type: "agent_end"}>;
        type TurnEnd = Extract<AgentRuntimeStreamEventDto, {type: "turn_end"}>;

        expectTypeOf<AgentEnd>().not.toHaveProperty("messages");
        expectTypeOf<TurnEnd>().not.toHaveProperty("message");
        expectTypeOf<TurnEnd>().not.toHaveProperty("toolResults");
    });
});
