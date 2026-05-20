import {describe, expect, it, vi} from "vitest";
import {createSubagentTool} from "nbook/server/agent/tools/builtin/create-subagent.tool";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";

describe("createSubagentTool", () => {
    it("动态 schema 会枚举当前可用 subagent profileKey", async () => {
        const schema = await createSubagentTool.resolveSchema?.({
            agentGateway: {
                listProfiles: vi.fn(async () => [
                    {key: "subagent.custom"},
                    {key: "subagent.writer"},
                ]),
            },
        } as unknown as AgentToolContext);

        expect(() => schema?.parse({
            profileKey: "subagent.custom",
        })).not.toThrow();
        expect(() => schema?.parse({
            profileKey: "subagent.missing",
        })).toThrow();
    });
});
