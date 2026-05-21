import {describe, expect, it} from "vitest";
import {z} from "zod";
import {RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin/retrieval.contract";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {reportResultTool} from "nbook/server/agent/tools/builtin/report-result.tool";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import type {ProfileKey} from "nbook/server/agent/types";

/**
 * 构造 report_result 单元测试需要的最小工具上下文。
 */
function createContext(profile: Pick<AgentProfile<ProfileKey>, "key" | "outputSchema">): AgentToolContext {
    return {
        agentGateway: {} as never,
        threadId: "thread-1",
        profileKey: profile.key,
        profile: profile as AgentProfile<ProfileKey>,
        runOptions: {},
        writeToolOutput: () => {},
        getHistory: async () => [],
        getScope: () => ({}) as never,
        setIde: () => ({}) as never,
        setStudio: () => ({}) as never,
    };
}

describe("report_result tool", () => {
    it("会使用当前 profile 的 outputSchema 校验结构化 data", async () => {
        const result = await reportResultTool.execute({
            walkthrough: "完成检索",
            data: ["lorebook/character/a"],
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }));

        expect(result.status).toBe("success");
        expect(result.rawResult).toEqual({
            walkthrough: "完成检索",
            data: ["lorebook/character/a"],
        });
    });

    it("会兼容 provider 字符串化的 retrieval data", async () => {
        const result = await reportResultTool.execute({
            walkthrough: "完成检索",
            data: JSON.stringify(["lorebook/character/a"]),
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }));

        expect(result.rawResult).toEqual({
            walkthrough: "完成检索",
            data: ["lorebook/character/a"],
        });
    });

    it("原值符合 outputSchema 时不会被当作 JSON 字符串强行解析", async () => {
        const result = await reportResultTool.execute({
            walkthrough: "完成检索",
            data: JSON.stringify(["lorebook/character/a"]),
        }, createContext({
            key: "subagent.custom",
            outputSchema: z.string(),
        }));

        expect(result.rawResult).toEqual({
            walkthrough: "完成检索",
            data: JSON.stringify(["lorebook/character/a"]),
        });
    });

    it("有 outputSchema 的 profile 缺少 data 时失败", async () => {
        await expect(reportResultTool.execute({
            walkthrough: "完成检索",
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }))).rejects.toThrow("必须通过 report_result.data 提交结构化输出");
    });

    it("有 outputSchema 的 profile 收到错误 data 结构时失败", async () => {
        await expect(reportResultTool.execute({
            walkthrough: "完成检索",
            data: [{path: "lorebook/character/a"}],
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }))).rejects.toThrow("report_result.data 不符合 profile 输出结构");
    });

    it("有 outputSchema 的 profile 收到 JSON object 字符串时仍按结构失败", async () => {
        await expect(reportResultTool.execute({
            walkthrough: "完成检索",
            data: JSON.stringify({path: "lorebook/character/a"}),
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }))).rejects.toThrow("report_result.data 不符合 profile 输出结构");
    });

    it("有 outputSchema 的 profile 收到非法 JSON 字符串时仍按结构失败", async () => {
        await expect(reportResultTool.execute({
            walkthrough: "完成检索",
            data: "[",
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }))).rejects.toThrow("report_result.data 不符合 profile 输出结构");
    });

    it("有 outputSchema 的 profile 收到空路径数组时失败", async () => {
        await expect(reportResultTool.execute({
            walkthrough: "完成检索",
            data: JSON.stringify([""]),
        }, createContext({
            key: "subagent.retrieval",
            outputSchema: RetrievalOutputSchema,
        }))).rejects.toThrow("report_result.data 不符合 profile 输出结构");
    });

    it("没有 outputSchema 的 profile 仍然允许只提交 walkthrough", async () => {
        const result = await reportResultTool.execute({
            walkthrough: "完成写作",
        }, createContext({
            key: "subagent.writer",
            outputSchema: undefined,
        }));

        expect(result.rawResult).toEqual({
            walkthrough: "完成写作",
        });
    });

    it("没有 outputSchema 的 profile 仍然透传可选 data", async () => {
        const result = await reportResultTool.execute({
            walkthrough: "完成整理",
            data: {
                ok: true,
            },
        }, createContext({
            key: "subagent.writer",
            outputSchema: undefined,
        }));

        expect(result.rawResult).toEqual({
            walkthrough: "完成整理",
            data: {
                ok: true,
            },
        });
    });

    it("校验逻辑来自 profile 实例而不是固定 profileKey 映射", async () => {
        await expect(reportResultTool.execute({
            walkthrough: "完成",
            data: "not-array",
        }, createContext({
            key: "subagent.writer",
            outputSchema: z.array(z.string()),
        }))).rejects.toThrow("subagent.writer 的 report_result.data 不符合 profile 输出结构");
    });
});
