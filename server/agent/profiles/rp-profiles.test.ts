import {join, resolve} from "node:path";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import leaderRpProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile";
import rpActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.actor.profile";
import rpWriterProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {LeaderRpInputSchema, RpActorInputSchema, RpActorOutputSchema, RpWriterInputSchema, RpWriterOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

describe("RP builtin profiles", () => {
    it("catalog 加载 leader.rp、rp.actor、rp.writer", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const snapshot = await catalog.snapshot();
        const profileKeys = snapshot.profiles.map((profile) => profile.key);

        expect(profileKeys).toContain("leader.rp");
        expect(profileKeys).toContain("rp.actor");
        expect(profileKeys).toContain("rp.writer");
    });

    it("rp contracts 使用 RP 专用输入输出，不复用普通 writer chapterPaths", () => {
        expect(LeaderRpInputSchema.properties).toHaveProperty("roleplayRoot");

        expect(RpActorInputSchema.properties).toHaveProperty("actorId");
        expect(RpActorInputSchema.properties).toHaveProperty("instructionPath");
        expect(RpActorInputSchema.properties).toHaveProperty("knowledgePath");
        expect(RpActorOutputSchema.properties).toHaveProperty("visible_action");
        expect(RpActorOutputSchema.properties).toHaveProperty("spoken_dialogue");
        expect(RpActorOutputSchema.properties).toHaveProperty("knowledge_update");

        expect(RpWriterInputSchema.properties).toHaveProperty("writerInstructionPath");
        expect(RpWriterInputSchema.properties).not.toHaveProperty("chapterPaths");
        expect(RpWriterInputSchema.properties).not.toHaveProperty("lorebookEntries");
        expect(RpWriterOutputSchema.properties).toHaveProperty("prose");
        expect(RpWriterOutputSchema.properties).toHaveProperty("summary");
    });

    it("leader.rp 注入 GM 流程、agent catalog 和 RP 工具边界", async () => {
        const prepared = await leaderRpProfile.prepare!({
            session: testSession({
                profileKey: "leader.rp",
                workspaceRoot: resolve("workspace"),
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            }),
            input: {
                roleplayRoot: "rp-project/roleplay",
            },
            vars: createTestVariableAccessor({
                "client.currentProjectWorkspace": "workspace/rp-project",
            }),
            catalog: {
                profiles: [{
                    key: "rp.actor",
                    name: "RP Actor",
                    description: "通用角色扮演 agent",
                    allowedToolKeys: ["read", "write", "edit", "report_result"],
                    inputSchema: RpActorInputSchema,
                    outputSchema: RpActorOutputSchema,
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                }, {
                    key: "rp.writer",
                    name: "RP Writer",
                    description: "RP Tick 正文渲染 agent",
                    allowedToolKeys: ["report_result"],
                    inputSchema: RpWriterInputSchema,
                    outputSchema: RpWriterOutputSchema,
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                }],
                issues: [],
            },
            skills: [],
        });
        const systemPrompt = prepared.systemPrompt ?? "";
        const historyText = (prepared.historyInitMessages ?? []).map(messageText).join("\n");
        const modelContextText = (prepared.modelContextMessages ?? []).map(messageText).join("\n");
        const appendingText = (prepared.appendingMessages ?? []).map(messageText).join("\n");

        expect(leaderRpProfile.allowedToolKeys).toEqual([
            "read",
            "bash",
            "create_agent",
            "invoke_agent",
            "get_agent",
            "get_agent_profile",
            "get_session",
            "request_user_input",
        ]);
        expect(systemPrompt).toContain("GM 主控");
        expect(systemPrompt).toContain("roleplay/AGENTS.md");
        expect(systemPrompt).toContain("roleplay/config.yaml");
        expect(systemPrompt).toContain("roleplay/cast.yaml");
        expect(systemPrompt).toContain("filtered packet");
        expect(systemPrompt).toContain("writer brief");
        expect(systemPrompt).toContain("rp.writer");
        expect(systemPrompt).toContain("不要把 GM scratch");
        expect(historyText).toContain("rp.actor");
        expect(historyText).toContain("rp.writer");
        expect(modelContextText).toContain("roleplayRoot: rp-project/roleplay");
        expect(appendingText).toContain("Current Project Workspace: workspace/rp-project");
    });

    it("rp.actor 自动注入 actor.md 与 knowledge.md，并只允许角色知识维护工具", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await rpActorProfile.prepare!({
                session: testSession({
                    profileKey: "rp.actor",
                    workspaceRoot: fixture.workspaceRoot,
                    customState: {},
                    linkedAgents: [],
                    archived: false,
                    planModeActive: false,
                }),
                input: {
                    actorId: "heroine",
                    actorName: "绘璃奈",
                    kind: "npc",
                    instructionPath: `${fixture.projectSlug}/roleplay/actors/heroine/actor.md`,
                    knowledgePath: `${fixture.projectSlug}/roleplay/actors/heroine/knowledge.md`,
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = (prepared.modelContextMessages ?? []).map(messageText).join("\n");
            const appendingText = (prepared.appendingMessages ?? []).map(messageText).join("\n");

            expect(rpActorProfile.allowedToolKeys).toEqual(["read", "write", "edit", "report_result"]);
            expect(systemPrompt).toContain("只扮演一个角色：绘璃奈");
            expect(systemPrompt).toContain("不能读取 roleplay/AGENTS.md");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("knowledgePath");
            expect(modelContextText).toContain("<actor_instruction>");
            expect(modelContextText).toContain("保持礼貌但警惕");
            expect(modelContextText).toContain("<actor_knowledge>");
            expect(modelContextText).toContain("她相信主角值得观察");
            expect(modelContextText).toContain("只回复 GM");
            expect(appendingText).toContain("Current Workdir");
            expect(appendingText).not.toContain("只回复 GM");
        } finally {
            await rm(fixture.workspaceRoot, {recursive: true, force: true});
        }
    });

    it("rp.writer 自动注入 writer.md，只用 report_result 返回 prose", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await rpWriterProfile.prepare!({
                session: testSession({
                    profileKey: "rp.writer",
                    workspaceRoot: fixture.workspaceRoot,
                    customState: {},
                    linkedAgents: [],
                    archived: false,
                    planModeActive: false,
                }),
                input: {
                    writerInstructionPath: `${fixture.projectSlug}/roleplay/writer.md`,
                    style: "细腻、轻快、不过度解释。",
                    outputRequirements: ["只输出正文。"],
                    language: "zh-CN",
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = (prepared.modelContextMessages ?? []).map(messageText).join("\n");
            const appendingText = (prepared.appendingMessages ?? []).map(messageText).join("\n");

            expect(rpWriterProfile.allowedToolKeys).toEqual(["report_result"]);
            expect(systemPrompt).toContain("只负责把 GM 的 writer brief");
            expect(systemPrompt).toContain("不读取文件");
            expect(systemPrompt).toContain("prose");
            expect(systemPrompt).toContain("细腻、轻快");
            expect(systemPrompt).toContain("只输出正文");
            expect(modelContextText).toContain("<rp_writer_instruction>");
            expect(modelContextText).toContain("正文要保留角色信息差");
            expect(modelContextText).toContain("writer brief");
            expect(appendingText).toBe("");
        } finally {
            await rm(fixture.workspaceRoot, {recursive: true, force: true});
        }
    });
});

async function createRoleplayFixture(): Promise<{workspaceRoot: string; projectSlug: string}> {
    const workspaceRoot = resolve(".agent", "workspace", "rp-profile-test", randomUUID());
    const projectSlug = `rp-project-${randomUUID()}`;
    const actorRoot = join(workspaceRoot, projectSlug, "roleplay", "actors", "heroine");
    await mkdir(actorRoot, {recursive: true});
    await writeFile(join(actorRoot, "actor.md"), "保持礼貌但警惕，遇到未知物品会先询问来源。", "utf-8");
    await writeFile(join(actorRoot, "knowledge.md"), "她相信主角值得观察，但还不知道世界之心的真名。", "utf-8");
    await writeFile(join(workspaceRoot, projectSlug, "roleplay", "writer.md"), "正文要保留角色信息差，不泄露 GM 隐藏设定。", "utf-8");
    return {workspaceRoot, projectSlug};
}

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
