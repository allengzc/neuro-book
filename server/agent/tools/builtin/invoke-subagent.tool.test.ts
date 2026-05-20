import {describe, expect, it, vi} from "vitest";
import {z} from "zod";
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
                listProfiles: vi.fn(async () => []),
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
        } as unknown as AgentToolContext);

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

    it("动态 schema 会合并当前可用 subagent profile 的 inputSchema", async () => {
        const customInputSchema = z.object({
            instruction: z.string(),
            depth: z.number(),
        });

        const schema = await invokeSubagentTool.resolveSchema?.({
            agentGateway: {
                listProfiles: vi.fn(async () => [
                    {
                        key: "subagent.custom",
                        inputSchema: customInputSchema,
                    },
                ]),
            },
        } as unknown as AgentToolContext);

        expect(() => schema?.parse({
            subagentThreadId: "subagent-1",
            input: {
                instruction: "整理 assets",
                depth: 2,
            },
        })).not.toThrow();
    });
});
