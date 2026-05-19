import {describe, expect, it, vi} from "vitest";
import {invokeSubagentTool} from "nbook/server/agent/tools/builtin/invoke-subagent.tool";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";

describe("invokeSubagentTool", () => {
    it("执行前会归一化 provider 字符串化的 subagent 参数", async () => {
        const runSubAgent = vi.fn(async () => ({
            subagentThreadId: "203",
            status: "completed" as const,
            walkthrough: "done",
        }));

        await invokeSubagentTool.execute({
            subagentThreadId: 203,
            input: JSON.stringify({
                prompt: "写一章正文",
                plotPoints: ["30"],
                lorebookEntries: [{
                    path: "lorebook/character/test/",
                }],
            }),
        }, {
            agentGateway: {
                runSubAgent,
            },
            threadId: "leader-1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            },
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => ({}) as never,
            setIde: () => ({}) as never,
            setStudio: () => ({}) as never,
        } as AgentToolContext);

        expect(runSubAgent).toHaveBeenCalledWith(
            "leader-1",
            "203",
            {
                prompt: "写一章正文",
                plotPoints: ["30"],
                lorebookEntries: [{
                    path: "lorebook/character/test/",
                }],
            },
            {},
        );
    });
});
