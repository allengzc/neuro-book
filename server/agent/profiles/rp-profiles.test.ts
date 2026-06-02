import {join, resolve} from "node:path";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {parse as parseYaml} from "yaml";
import leaderRpProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile";
import rpActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.actor.profile";
import rpWriterProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {LeaderRpInputSchema, RpActorInputSchema, RpActorOutputSchema, RpWriterInputSchema, RpWriterOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentMessage, Message} from "nbook/server/agent/messages/types";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {SidecarContext} from "nbook/server/agent/profiles/types";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

function messagesText(messages: Array<Message | AgentMessage> | undefined): string {
    return (messages ?? []).map((message) => {
        if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
            return messageText(message as Message);
        }
        return "";
    }).join("\n");
}

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
        expect(LeaderRpInputSchema.properties).toHaveProperty("simulationRoot");

        expect(RpActorInputSchema.properties).toHaveProperty("actorId");
        expect(RpActorInputSchema.properties).toHaveProperty("instructionPath");
        expect(RpActorInputSchema.properties).toHaveProperty("eventsPath");
        expect(RpActorInputSchema.properties).toHaveProperty("knowledgePath");
        expect(RpActorInputSchema.properties).toHaveProperty("mindPath");
        expect(RpActorInputSchema.properties).toHaveProperty("statePath");
        expect(RpActorOutputSchema.properties).toHaveProperty("visible_action");
        expect(RpActorOutputSchema.properties).toHaveProperty("spoken_dialogue");
        expect(RpActorOutputSchema.properties).toHaveProperty("event_update");
        expect(RpActorOutputSchema.properties).toHaveProperty("knowledge_update");
        expect(RpActorOutputSchema.properties).toHaveProperty("mind_update");
        expect(RpActorOutputSchema.properties).toHaveProperty("state_update");

        expect(RpWriterInputSchema.properties).toHaveProperty("writerInstructionPath");
        expect(RpWriterInputSchema.properties).not.toHaveProperty("chapterPaths");
        expect(RpWriterInputSchema.properties).not.toHaveProperty("lorebookEntries");
        expect(RpWriterOutputSchema.properties).toHaveProperty("result");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("prose");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("summary");
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
                simulationRoot: "rp-project/simulation",
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
                    allowedToolKeys: ["read", "write", "edit", "bash"],
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
        const historyText = messagesText(prepared.historyInitMessages);
        const modelContextText = messagesText(prepared.modelContextMessages);
        const appendingText = messagesText(prepared.appendingMessages);

        expect(leaderRpProfile.allowedToolKeys).toEqual([
            "read",
            "write",
            "edit",
            "bash",
            "create_agent",
            "invoke_agent",
            "get_agent",
            "get_agent_profile",
            "get_session",
            "request_user_input",
        ]);
        expect(systemPrompt).toContain("simulator leader");
        expect(systemPrompt).toContain("simulation/config.yaml");
        expect(systemPrompt).toContain("simulation/cast.yaml");
        expect(systemPrompt).toContain("simulation/simulator.md 是唯一 simulator leader 入口说明");
        expect(systemPrompt).toContain("actor-facing message");
        expect(systemPrompt).toContain("GM internal scratch");
        expect(systemPrompt).toContain("不要把 not_known_to_you");
        expect(systemPrompt).toContain("writer brief");
        expect(systemPrompt).toContain("rp.writer");
        expect(systemPrompt).toContain("不要把 GM scratch");
        expect(systemPrompt).toContain("mindPath");
        expect(systemPrompt).toContain("eventsPath");
        expect(systemPrompt).toContain("simulation/entities");
        expect(systemPrompt).toContain("report.md + prose.md");
        expect(systemPrompt).toContain("prose.md 保存用户最终看到的正文");
        expect(systemPrompt).toContain("subject state.md");
        expect(systemPrompt).toContain("普通 assistant 回复");
        expect(systemPrompt).toContain("需要选项时由你输出");
        expect(systemPrompt).toContain("不要输出 packet、YAML、JSON");
        expect(systemPrompt).toContain("最多 2-4 个");
        expect(systemPrompt).toContain("Project Workspace 相对路径");
        expect(systemPrompt).toContain("instruction -> instructionPath");
        expect(systemPrompt).toContain("events -> eventsPath");
        expect(systemPrompt).toContain("knowledge -> knowledgePath");
        expect(systemPrompt).toContain("mind -> mindPath");
        expect(systemPrompt).toContain("state -> statePath");
        expect(historyText).toContain("rp.actor");
        expect(historyText).toContain("rp.writer");
        expect(historyText).toContain("```AGENTS.md");
        expect(modelContextText).toContain("simulationRoot: rp-project/simulation");
        expect(appendingText).toContain("Current Project Workspace: workspace/rp-project");
    });

    it("rp.actor 自动注入 subject.md、events.md、knowledge.md、mind.md 与 state.md，并把文件维护交给 sidecar", async () => {
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
                    instructionPath: `${fixture.projectSlug}/simulation/subjects/heroine/subject.md`,
                    eventsPath: `${fixture.projectSlug}/simulation/subjects/heroine/events.md`,
                    knowledgePath: `${fixture.projectSlug}/simulation/subjects/heroine/knowledge.md`,
                    mindPath: `${fixture.projectSlug}/simulation/subjects/heroine/mind.md`,
                    statePath: `${fixture.projectSlug}/simulation/subjects/heroine/state.md`,
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = messagesText(prepared.modelContextMessages);
            const appendingText = messagesText(prepared.appendingMessages);
            const sidecars = rpActorProfile.sidecars ?? [];
            const contextLoad = sidecars.find((sidecar) => sidecar.name === "actor.context-load");
            const memorySave = sidecars.find((sidecar) => sidecar.name === "actor.memory-save");

            expect(rpActorProfile.allowedToolKeys).toEqual(["read", "write", "edit", "report_result"]);
            expect(sidecars.map((sidecar) => sidecar.name)).toEqual(["actor.context-load", "actor.memory-save"]);
            expect(contextLoad).toEqual(expect.objectContaining({
                stage: "prepareRun",
                allowedToolKeys: ["read", "report_result"],
            }));
            expect(memorySave).toEqual(expect.objectContaining({
                stage: "settleRun",
                allowedToolKeys: ["read", "write", "edit", "report_result"],
            }));
            expect(contextLoad?.sidecarDataSchema?.properties).toHaveProperty("actor_safe_context");
            expect(contextLoad?.sidecarDataSchema?.properties).toHaveProperty("sources");
            expect(contextLoad?.sidecarDataSchema?.properties).toHaveProperty("withheld");
            expect(memorySave?.sidecarDataSchema?.properties).toHaveProperty("changed_files");
            expect(memorySave?.sidecarDataSchema?.properties).toHaveProperty("events_summary");
            expect(memorySave?.sidecarDataSchema?.properties).toHaveProperty("knowledge_summary");
            expect(memorySave?.sidecarDataSchema?.properties).toHaveProperty("mind_summary");
            const memorySavePrompt = typeof memorySave?.enterPrompt === "function"
                ? memorySave.enterPrompt({
                    name: "actor.memory-save",
                    stage: "settleRun",
                    sessionId: -1,
                    session: testSession({
                        profileKey: "rp.actor",
                        workspaceRoot: fixture.workspaceRoot,
                    }),
                    input: {
                        actorId: "heroine",
                        actorName: "绘璃奈",
                        kind: "npc",
                        instructionPath: `${fixture.projectSlug}/simulation/subjects/heroine/subject.md`,
                        eventsPath: `${fixture.projectSlug}/simulation/subjects/heroine/events.md`,
                        knowledgePath: `${fixture.projectSlug}/simulation/subjects/heroine/knowledge.md`,
                        mindPath: `${fixture.projectSlug}/simulation/subjects/heroine/mind.md`,
                        statePath: `${fixture.projectSlug}/simulation/subjects/heroine/state.md`,
                    },
                    runResult: {
                        status: "completed",
                        reportResult: {
                            result: "ok",
                            data: {
                                event_update: "她收到了一条新消息。",
                                knowledge_update: "",
                                mind_update: "",
                                state_update: "她向后退了一步。",
                            },
                        },
                    },
                    invocationId: "test-invocation",
                    profileKey: "rp.actor",
                } satisfies SidecarContext<Parameters<typeof memorySave.merge>[0]["input"]>)
                : memorySave?.enterPrompt ?? "";
            expect(memorySavePrompt).toContain("eventsPath");
            expect(memorySavePrompt).toContain("event_update");
            expect(memorySavePrompt).toContain("不要修改 statePath");
            expect(systemPrompt).toContain("只扮演一个角色：绘璃奈");
            expect(systemPrompt).toContain("不能读取完整 simulation/");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("report_result.result");
            expect(systemPrompt).toContain("mind_update");
            expect(systemPrompt).toContain("state_update");
            expect(systemPrompt).toContain("如果你扮演的是玩家 actor");
            expect(systemPrompt).toContain("主扮演阶段不要主动调用 read、write 或 edit");
            expect(systemPrompt).toContain("角色文件维护由 actor.memory-save 旁路完成");
            expect(systemPrompt).toContain("event_update");
            expect(systemPrompt).toContain("不要为了“完成更新”而编造 update");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("戏内消息");
            expect(systemPrompt).not.toContain("not_known_to_you");
            expect(systemPrompt).not.toContain("必要时可更新");
            expect(modelContextText).toContain("<subject_instruction>");
            expect(modelContextText).toContain("保持礼貌但警惕");
            expect(modelContextText).toContain("<subject_events>");
            expect(modelContextText).toContain("她第一次在广场边缘见到主角");
            expect(modelContextText).toContain("<subject_knowledge>");
            expect(modelContextText).toContain("她相信主角值得观察");
            expect(modelContextText).toContain("<subject_mind>");
            expect(modelContextText).toContain("她正在判断主角的用意");
            expect(modelContextText).toContain("<subject_state>");
            expect(modelContextText).toContain("她位于学院区广场边缘");
            expect(modelContextText).toContain("knowledgePath");
            expect(modelContextText).toContain("eventsPath");
            expect(modelContextText).toContain("mindPath");
            expect(modelContextText).toContain("statePath");
            expect(modelContextText).toContain("只回复 GM");
            expect(modelContextText).toContain("并必须调用 report_result");
            expect(modelContextText).toContain("不要主动读写文件");
            expect(appendingText).toContain("Current Workdir");
            expect(appendingText).not.toContain("只回复 GM");
        } finally {
            await rm(fixture.workspaceRoot, {recursive: true, force: true});
        }
    });

    it("rp.writer 自动注入 writer.md，直接输出正文并允许 GM 指定文件工具", async () => {
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
                    writerInstructionPath: `${fixture.projectSlug}/simulation/writer.md`,
                    style: "细腻、轻快、不过度解释。",
                    outputRequirements: ["只输出正文。"],
                    language: "zh-CN",
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const modelContextText = messagesText(prepared.modelContextMessages);
            const appendingText = messagesText(prepared.appendingMessages);

            expect(rpWriterProfile.allowedToolKeys).toEqual(["read", "write", "edit", "bash"]);
            expect(systemPrompt).toContain("只负责把 GM 的 writer brief");
            expect(systemPrompt).toContain("只有 GM 明确要求");
            expect(systemPrompt).toContain("普通 assistant 回复");
            expect(systemPrompt).toContain("prose.md");
            expect(systemPrompt).toContain("不写“你可以选择");
            expect(systemPrompt).toContain("正文代笔，不是 GM");
            expect(systemPrompt).toContain("不替用户角色添加未输入");
            expect(systemPrompt).toContain("不输出标题、摘要、选项");
            expect(systemPrompt).toContain("细腻、轻快");
            expect(systemPrompt).toContain("只输出正文");
            expect(systemPrompt).not.toContain("必须调用 report_result");
            expect(modelContextText).toContain("<rp_writer_instruction>");
            expect(modelContextText).toContain("正文要保留角色信息差");
            expect(modelContextText).toContain("writer brief");
            expect(modelContextText).toContain("不要生成选项、标题、摘要或解释");
            expect(appendingText).toContain("Current Workdir");
        } finally {
            await rm(fixture.workspaceRoot, {recursive: true, force: true});
        }
    });

    it("simulation 模板包含 events 路径、runs 新结构和不产生断链的 entity 示例", async () => {
        const templateRoot = resolve("assets", "workspace", ".nbook", "templates", "project-directory-templates", "simulation");
        const castText = await readFile(join(templateRoot, "cast.yaml"), "utf-8");
        const cast = parseYaml(castText) as {subjects?: Array<{id?: string; events?: string}>};
        const subjects = cast.subjects ?? [];

        expect(subjects.length).toBeGreaterThan(0);
        for (const subject of subjects) {
            expect(subject.events).toBeTruthy();
            const eventsPath = String(subject.events).replace(/^simulation[\\/]/, "");
            const eventsText = await readFile(join(templateRoot, eventsPath), "utf-8");
            expect(eventsText).toMatch(/事件流水|经历/);
        }

        const entityText = await readFile(join(templateRoot, "entities", "example-item", "entity.md"), "utf-8");
        await expect(readFile(join(templateRoot, "entities", "example-item", "state.md"), "utf-8")).resolves.toContain("subjectVisibleName");
        expect(entityText).toContain("prototype: null");
        expect(entityText).not.toContain("lorebook/item/example/");

        const reportText = await readFile(join(templateRoot, "runs", "ticks", "000000-initial-state", "report.md"), "utf-8");
        const proseText = await readFile(join(templateRoot, "runs", "ticks", "000000-initial-state", "prose.md"), "utf-8");
        await expect(readFile(join(templateRoot, "runs", "index.md"), "utf-8")).resolves.toContain("000000");
        expect(reportText).toContain("Writer-safe Brief");
        expect(reportText).toContain("Commits");
        expect(proseText).toContain("用户可见正文");
        await expect(readFile(join(templateRoot, "runs", "ticks", "000001", "user-input.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "runs", "ticks", "000001", "gm-scratch.md"), "utf-8")).rejects.toThrow();
        await expect(readFile(join(templateRoot, "runs", "ticks", "000001", "writer-brief.md"), "utf-8")).rejects.toThrow();
    });
});

async function createRoleplayFixture(): Promise<{workspaceRoot: string; projectSlug: string}> {
    const workspaceRoot = resolve(".agent", "workspace", "rp-profile-test", randomUUID());
    const projectSlug = `rp-project-${randomUUID()}`;
    const actorRoot = join(workspaceRoot, projectSlug, "simulation", "subjects", "heroine");
    await mkdir(actorRoot, {recursive: true});
    await writeFile(join(actorRoot, "subject.md"), "保持礼貌但警惕，遇到未知物品会先询问来源。", "utf-8");
    await writeFile(join(actorRoot, "events.md"), "她第一次在广场边缘见到主角，还没有确认对方目的。", "utf-8");
    await writeFile(join(actorRoot, "knowledge.md"), "她相信主角值得观察，但还不知道世界之心的真名。", "utf-8");
    await writeFile(join(actorRoot, "mind.md"), "她正在判断主角的用意，暂时不想显露紧张。", "utf-8");
    await writeFile(join(actorRoot, "state.md"), "她位于学院区广场边缘，双手空着，状态正常。", "utf-8");
    await writeFile(join(workspaceRoot, projectSlug, "simulation", "writer.md"), "正文要保留角色信息差，不泄露 GM 隐藏设定。", "utf-8");
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
