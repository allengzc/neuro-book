import {describe, expect, it, vi} from "vitest";
import {z} from "zod";
import {invokeSubagentTool} from "nbook/server/agent/tools/builtin/invoke-subagent.tool";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import type {AgentVariableScope} from "nbook/server/agent/types";

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
                listSubAgents: vi.fn(async () => [{
                    id: "203",
                    title: "Writer",
                    kind: "subagent",
                    profileKey: "subagent.writer",
                    summary: "",
                    status: "idle",
                    runStatus: "idle",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastMessageAt: new Date(),
                    metadata: {},
                    modelOverride: null,
                    modelOverrideKey: null,
                    usageSummary: null,
                    pendingUserInputSession: null,
                    planMode: null,
                }]),
            },
            threadId: "leader-1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            },
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => createScope({
                novelId: "1",
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
            }),
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

    it("执行前会同步当前 studio 关键作用域", async () => {
        const setStudio = vi.fn();
        const runSubAgent = vi.fn(async () => ({
            subagentThreadId: "203",
            status: "completed" as const,
            walkthrough: "done",
        }));

        await invokeSubagentTool.execute({
            subagentThreadId: "203",
            input: {
                prompt: "检索设定",
            },
        }, {
            agentGateway: {
                runSubAgent,
                listProfiles: vi.fn(async () => []),
                listSubAgents: vi.fn(async () => []),
            },
            threadId: "leader-1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            },
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => createScope({
                novelId: "1",
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
            }),
            setIde: () => ({}) as never,
            setStudio,
        } as unknown as AgentToolContext);

        expect(setStudio).toHaveBeenCalledWith({
            novelId: "1",
            workspace: "workspace/silver-dragon-hime",
            workspaceKind: "novel",
        });
    });

    it("writer 输入包含 plotPoints 但缺少 novelId 时会在调用前失败", async () => {
        const runSubAgent = vi.fn();

        await expect(invokeSubagentTool.execute({
            subagentThreadId: "203",
            input: {
                prompt: "写一章正文",
                plotPoints: ["30"],
                lorebookEntries: [],
            },
        }, {
            agentGateway: {
                runSubAgent,
                listProfiles: vi.fn(async () => []),
                listSubAgents: vi.fn(async () => [{
                    id: "203",
                    title: "Writer",
                    kind: "subagent",
                    profileKey: "subagent.writer",
                    summary: "",
                    status: "idle",
                    runStatus: "idle",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastMessageAt: new Date(),
                    metadata: {},
                    modelOverride: null,
                    modelOverrideKey: null,
                    usageSummary: null,
                    pendingUserInputSession: null,
                    planMode: null,
                }]),
            },
            threadId: "leader-1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            },
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => createScope({
                novelId: null,
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
            }),
            setIde: () => ({}) as never,
            setStudio: () => ({}) as never,
        } as unknown as AgentToolContext)).rejects.toThrow("当前 leader thread 没有 studio.novelId");

        expect(runSubAgent).not.toHaveBeenCalled();
    });

    it("非 writer subagent 输入包含 plotPoints 时不应用 writer novelId 校验", async () => {
        const runSubAgent = vi.fn(async () => ({
            subagentThreadId: "204",
            status: "completed" as const,
            walkthrough: "done",
        }));

        await invokeSubagentTool.execute({
            subagentThreadId: "204",
            input: {
                prompt: "检索设定",
                plotPoints: ["30"],
            },
        }, {
            agentGateway: {
                runSubAgent,
                listProfiles: vi.fn(async () => []),
                listSubAgents: vi.fn(async () => [{
                    id: "204",
                    title: "Retrieval",
                    kind: "subagent",
                    profileKey: "subagent.retrieval",
                    summary: "",
                    status: "idle",
                    runStatus: "idle",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastMessageAt: new Date(),
                    metadata: {},
                    modelOverride: null,
                    modelOverrideKey: null,
                    usageSummary: null,
                    pendingUserInputSession: null,
                    planMode: null,
                }]),
            },
            threadId: "leader-1",
            profileKey: "leader.default",
            profile: {
                key: "leader.default",
            },
            runOptions: {},
            writeToolOutput: () => {},
            getHistory: async () => [],
            getScope: () => createScope({
                novelId: null,
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
            }),
            setIde: () => ({}) as never,
            setStudio: () => ({}) as never,
        } as unknown as AgentToolContext);

        expect(runSubAgent).toHaveBeenCalledWith(
            "leader-1",
            "204",
            {
                prompt: "检索设定",
                plotPoints: ["30"],
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

/**
 * 构造最小变量作用域。
 */
function createScope(studio: {
    novelId: string | null;
    workspace: string | null;
    workspaceKind: "novel" | "user-assets" | null;
}): AgentVariableScope {
    return {
        ide: {
            panel: null,
            activePanel: null,
            theme: null,
            extra: {},
        },
        studio: {
            novelId: studio.novelId,
            selectedChapterId: null,
            previousSelectedChapterId: null,
            currentChapterTitle: null,
            previousChapterTitle: null,
            currentChapterLabel: null,
            previousChapterLabel: null,
            workspace: studio.workspace,
            workspaceKind: studio.workspaceKind,
            didSwitchChapter: false,
            selectionVersion: null,
            extra: {},
        },
        agent: {
            thread: {
                id: "leader-1",
                title: "Leader",
                summary: "",
                status: "idle",
            },
            profileKey: "leader.default",
            kind: "leader",
            tools: [],
            subagents: [],
            tasks: null,
        },
        input: {
            prompt: "",
        },
    };
}
