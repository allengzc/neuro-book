import {describe, expect, it, vi} from "vitest";
import {createSubagentTool} from "nbook/server/agent/tools/builtin/create-subagent.tool";
import type {AgentToolContext} from "nbook/server/agent/tools/agent-tool";
import type {AgentVariableScope} from "nbook/server/agent/types";

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

    it("创建 subagent 前会同步当前 studio 关键作用域", async () => {
        const setStudio = vi.fn();
        const createSubAgentThread = vi.fn(async () => ({
            id: "subagent-1",
            profileKey: "subagent.writer",
            title: "Writer",
        }));

        await createSubagentTool.execute({
            profileKey: "subagent.writer",
        }, {
            agentGateway: {
                assertSubAgentProfile: vi.fn(async () => {}),
                createSubAgentThread,
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
        expect(createSubAgentThread).toHaveBeenCalledWith({
            leaderThreadId: "leader-1",
            profileKey: "subagent.writer",
            title: undefined,
        });
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
