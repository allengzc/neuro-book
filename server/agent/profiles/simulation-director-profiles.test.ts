import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import directorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/director.profile";
import simulatorLeaderProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.leader.profile";
import {DirectorInputSchema, DirectorOutputSchema, SimulatorLeaderInputSchema, SimulatorLeaderOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentMessage, Message} from "nbook/server/agent/messages/types";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

function messagesText(messages: Array<Message | AgentMessage> | undefined): string {
    return (messages ?? []).map((message) => {
        if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
            return messageText(message as Message);
        }
        return "";
    }).join("\n");
}

describe("simulation and director builtin profiles", () => {
    it("simulator.leader 暴露世界模拟合同和受限工具", async () => {
        const prepared = await simulatorLeaderProfile.prepare!({
            session: testSession({
                profileKey: "simulator.leader",
                workspaceRoot: resolve("workspace"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            }),
            input: {
                projectPath: "workspace/rp-project",
                simulationRoot: "rp-project/simulation/",
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
        });
        const prompt = [prepared.systemPrompt ?? "", messagesText(prepared.historyInitMessages), messagesText(prepared.modelContextMessages)].join("\n");

        expect(simulatorLeaderProfile.inputSchema).toBe(SimulatorLeaderInputSchema);
        expect(simulatorLeaderProfile.outputSchema).toBe(SimulatorLeaderOutputSchema);
        expect(simulatorLeaderProfile.allowedToolKeys).toEqual([
            "read",
            "write",
            "edit",
            "apply_patch",
            "bash",
            "create_agent",
            "invoke_agent",
            "get_agent",
            "get_agent_profile",
            "get_session",
            "get_plot_tree",
            "get_story_thread",
            "get_story_scene_context",
            "get_chapter_plot",
        ]);
        expect(simulatorLeaderProfile.allowedToolKeys).not.toContain("create_story_plot");
        expect(simulatorLeaderProfile.allowedToolKeys).not.toContain("report_result");
        expect(prompt).toContain("世界模拟主管");
        expect(prompt).toContain("writer_safe_brief");
        expect(prompt).toContain("director_handoff");
        expect(prompt).toContain("不设计长期 Thread / Scene / Plot");
        expect(prompt).toContain("mode: 每轮任务 prompt 指定");
        expect(prompt).toContain("AGENTS.md 和 agent-context/simulator.leader.md");
        expect(prompt).toContain("最小 subject scaffold");
        expect(prompt).toContain("直接用普通 assistant 文本返回最终结果");
        expect(prompt).toContain("projectPath: workspace/rp-project");
        expect(prompt).toContain("reference/agent/workspace-tool-use.md");
        expect(prompt).toContain("reference/content/simulation.md");
    });

    it("director 暴露 Plot System 合同和 create_story_plots", async () => {
        const prepared = await directorProfile.prepare!({
            session: testSession({
                profileKey: "director",
                workspaceRoot: resolve("workspace"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            }),
            input: {
                projectPath: "workspace/rp-project",
                mode: "writing",
                defaultChapterPath: "rp-project/manuscript/001-volume/001-chapter/",
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
        });
        const prompt = [prepared.systemPrompt ?? "", messagesText(prepared.historyInitMessages), messagesText(prepared.modelContextMessages)].join("\n");

        expect(directorProfile.inputSchema).toBe(DirectorInputSchema);
        expect(directorProfile.outputSchema).toBe(DirectorOutputSchema);
        expect(directorProfile.allowedToolKeys).toContain("create_story_plots");
        expect(directorProfile.allowedToolKeys).not.toContain("write");
        expect(directorProfile.allowedToolKeys).not.toContain("edit");
        expect(prompt).toContain("剧情导演");
        expect(prompt).toContain("Thread / Scene / Plot");
        expect(prompt).toContain("不维护 simulation/subjects/**");
        expect(prompt).toContain("reference/plot/agent-spec.md");
        expect(prompt).toContain("defaultChapterPath: rp-project/manuscript/001-volume/001-chapter/");
    });
});

function testSession(input: Partial<NeuroSessionContext>): RuntimeSessionFacade {
    const session: RuntimeSessionFacade = {
        systemPrompt: "",
        messages: [],
        model: null,
        thinkingLevel: "off",
        profileKey: "test",
        workspaceRoot: "workspace",
        customState: {},
        linkedAgents: [],
        archived: false,
        planModeActive: false,
        ...input,
        async read() {
            return {
                snapshot: {
                    metadata: {
                        sessionId: -1,
                        profileKey: session.profileKey,
                        input: {},
                        workspaceRoot: session.workspaceRoot,
                        workspaceKey: "test",
                        createdAt: 0,
                    },
                    entries: [],
                    leafId: null,
                },
                context: session,
            };
        },
        async agentDialogueContent(): Promise<AgentDialogueContent> {
            return {
                text: "",
                tokens: 0,
                fingerprint: "test",
                entryIds: [],
            };
        },
    };
    return session;
}
