import {z} from "zod";
import {describe, expect, it, vi} from "vitest";
import {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {InMemoryAgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {ThreadContextService} from "nbook/server/agent/services/thread-context.service";
import {AgentVariableStore} from "nbook/server/agent/store/agent-variable-store";
import {createThreadRecord, createThreadSummary} from "nbook/server/agent/test/fixtures";
import type {AgentToolContext, AgentToolResult} from "nbook/server/agent/tools/agent-tool";
import {InMemoryAgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";

class TestLeaderProfile extends AgentProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "测试 Leader";
    readonly inputSchema = z.object({
        prompt: z.string(),
    });
    readonly allowedToolKeys = ["demo_tool"] as const;

    /**
     * 测试 profile 不参与真实 prepare。
     */
    async prepare(_runtime: ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>) {
        return {
            modelMessages: [],
            persistedMessages: {
                prepend: [],
                append: [],
            },
            immediateMetadata: {},
            completedMetadata: {},
        };
    }
}

describe("ThreadContextService", () => {
    it("syncClientVariables 会刷新 agent 变量并写入 client scope", async () => {
        const profileRegistry = new InMemoryAgentProfileRegistry();
        profileRegistry.register(new TestLeaderProfile());
        const service = new ThreadContextService(
            {
                listSubAgents: async () => [],
            } as never,
            profileRegistry,
            new InMemoryAgentToolRegistry(),
            new AgentVariableStore(),
        );

        const scope = await service.syncClientVariables(
            "thread-1",
            {
                ide: {
                    theme: "sepia",
                },
                studio: {
                    novelId: "1",
                    selectedStoryThreadId: "thread_1",
                    selectedStorySceneId: "scene_2",
                },
            },
            createThreadRecord(),
            "leader.default",
        );

        expect(scope.ide.theme).toBe("sepia");
        expect(scope.studio.novelId).toBe("1");
        expect(scope.studio.extra.selectedStoryThreadId).toBe("thread_1");
        expect(scope.studio.extra.selectedStorySceneId).toBe("scene_2");
        expect(scope.agent.thread.id).toBe("1");
        expect(scope.agent.tools).toEqual(["demo_tool"]);
    });

    it("resolveProfileTools 会把最小 gateway 注入 tool 上下文", async () => {
        const profileRegistry = new InMemoryAgentProfileRegistry();
        const toolRegistry = new InMemoryAgentToolRegistry();
        const profile = new TestLeaderProfile();
        const execute = vi.fn(async (_input: {filePath: string}, context: AgentToolContext): Promise<AgentToolResult> => {
            context.writeToolOutput("chunk");
            return {
                content: "ok",
                toolArgs: JSON.stringify(_input),
            };
        });
        profileRegistry.register(profile);
        toolRegistry.register({
            key: "demo_tool",
            description: "demo",
            schema: z.object({
                filePath: z.string(),
            }),
            execute,
        });

        const service = new ThreadContextService(
            {
                listSubAgents: async () => [
                    createThreadSummary({
                        id: "subagent-1",
                        kind: "subagent",
                        profileKey: "subagent.writer",
                    }),
                ],
            } as never,
            profileRegistry,
            toolRegistry,
            new AgentVariableStore(),
        );
        const gateway = {
            publishToolOutputDelta: vi.fn(),
            createSubAgentThread: vi.fn(),
            listSubAgents: vi.fn(async () => []),
            runSubAgent: vi.fn(),
            assertSubAgentProfile: vi.fn(),
            listProfiles: vi.fn(async () => []),
            createTaskList: vi.fn(),
            setTaskStatus: vi.fn(),
            enterPlanMode: vi.fn(),
            exitPlanMode: vi.fn(),
        };

        const [tool] = await service.resolveProfileTools({
            agentGateway: gateway,
            thread: createThreadRecord(),
            profile,
            profileKey: "leader.default",
            options: {},
            loadThreadHistoryMessages: async () => [],
        });

        const result = await tool?.invoke({
            filePath: "chapter.md",
        }, {
            toolCall: {
                id: "tool-call-1",
                name: "demo_tool",
                args: {
                    filePath: "chapter.md",
                },
                type: "tool_call",
            },
        });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(gateway.publishToolOutputDelta).toHaveBeenCalledWith("1", "tool-call-1", "chunk");
        expect(result).toBeInstanceOf(Object);
    });
});
