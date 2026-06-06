import {join, resolve} from "node:path";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {parse as parseYaml} from "yaml";
import rpWriterProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile";
import simulatorActorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile";
import simulatorLeaderProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/simulator.leader.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {RpWriterInputSchema, RpWriterOutputSchema, SimulatorLeaderInputSchema, SubjectSimulatorInputSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {AgentMessage, Message} from "nbook/server/agent/messages/types";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {SidecarContext} from "nbook/server/agent/profiles/types";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

type SchemaWithProperties = {
    properties: Record<string, unknown>;
};

function messagesText(messages: Array<Message | AgentMessage> | undefined): string {
    return (messages ?? []).map((message) => {
        if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
            return messageText(message as Message);
        }
        return "";
    }).join("\n");
}

describe("RP builtin profiles", () => {
    it("catalog 加载 simulator.leader、simulator.actor、rp.writer，不再加载 leader.rp", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const snapshot = await catalog.snapshot();
        const profileKeys = snapshot.profiles.map((profile) => profile.key);

        expect(profileKeys).toContain("simulator.leader");
        expect(profileKeys).toContain("simulator.actor");
        expect(profileKeys).toContain("rp.writer");
        expect(profileKeys).not.toContain("leader.rp");
    }, 20_000);

    it("rp contracts 使用 RP 专用输入输出，不复用普通 writer chapterPaths", () => {
        expect(SimulatorLeaderInputSchema.properties).toHaveProperty("projectPath");
        expect(SimulatorLeaderInputSchema.properties).toHaveProperty("simulationRoot");
        expect(SimulatorLeaderInputSchema.properties).not.toHaveProperty("mode");

        expect(SubjectSimulatorInputSchema.properties).toHaveProperty("actorId");
        expect(SubjectSimulatorInputSchema.properties).toHaveProperty("instructionPath");
        expect(SubjectSimulatorInputSchema.properties).toHaveProperty("eventsPath");
        expect(SubjectSimulatorInputSchema.properties).toHaveProperty("knowledgePath");
        expect(SubjectSimulatorInputSchema.properties).toHaveProperty("mindPath");
        expect(SubjectSimulatorInputSchema.properties).toHaveProperty("statePath");
        expect(SubjectSimulatorOutputSchema.properties).toHaveProperty("visible_response");
        expect(SubjectSimulatorOutputSchema.properties).toHaveProperty("spoken_dialogue");
        expect(SubjectSimulatorOutputSchema.properties).toHaveProperty("inner_response");
        expect(SubjectSimulatorOutputSchema.properties).not.toHaveProperty("updates");
        expect(SubjectSimulatorOutputSchema.properties).not.toHaveProperty("questions");

        expect(RpWriterInputSchema.properties).toHaveProperty("writerInstructionPath");
        expect(RpWriterInputSchema.properties).not.toHaveProperty("chapterPaths");
        expect(RpWriterInputSchema.properties).not.toHaveProperty("lorebookEntries");
        expect(RpWriterOutputSchema.properties).toHaveProperty("result");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("prose");
        expect(RpWriterOutputSchema.properties).not.toHaveProperty("summary");
    });

    it("simulator.leader 作为 RP / simulation 入口并负责调度 actor", async () => {
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
        const systemPrompt = prepared.systemPrompt ?? "";
        const historyText = messagesText(prepared.historyInitMessages);
        const modelContextText = messagesText(prepared.modelContextMessages);

        expect(simulatorLeaderProfile.allowedToolKeys).toContain("create_agent");
        expect(simulatorLeaderProfile.allowedToolKeys).toContain("invoke_agent");
        expect(simulatorLeaderProfile.allowedToolKeys).toContain("bash");
        expect(simulatorLeaderProfile.allowedToolKeys).not.toContain("report_result");
        expect(systemPrompt).toContain("世界模拟主管");
        expect(systemPrompt).toContain("AGENTS.md 与 simulation/simulator.md");
        expect(systemPrompt).toContain("leader.default 和用户入口通常只与你交流");
        expect(systemPrompt).toContain("为需要模拟的 subject 创建或复用 simulator.actor");
        expect(systemPrompt).toContain("最小 subject scaffold");
        expect(systemPrompt).toContain("全自动下一 tick");
        expect(systemPrompt).toContain("直接用普通 assistant 文本返回最终结果");
        expect(historyText).toContain("```AGENTS.md");
        expect(historyText).toContain("```reference/agent/workspace-tool-use.md");
        expect(modelContextText).toContain("projectPath: workspace/rp-project");
        expect(modelContextText).toContain("mode: 每轮任务 prompt 指定");
    });

    it("simulator.actor 主路只注入 actor binding，subject 文件由 sidecar 加载", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
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
            const sidecars = simulatorActorProfile.sidecars ?? [];
            const contextLoad = sidecars.find((sidecar) => sidecar.name === "actor.context-load");
            const memorySave = sidecars.find((sidecar) => sidecar.name === "actor.memory-save");

            expect(simulatorActorProfile.allowedToolKeys).toEqual(["read", "write", "edit", "report_result"]);
            expect(sidecars.map((sidecar) => sidecar.name)).toEqual(["actor.context-load", "actor.memory-save"]);
            expect(contextLoad).toEqual(expect.objectContaining({
                stage: "prepareRun",
                allowedToolKeys: ["read", "report_result"],
            }));
            expect(memorySave).toEqual(expect.objectContaining({
                stage: "settleRun",
                allowedToolKeys: ["read", "write", "edit", "report_result"],
            }));
            expect((contextLoad?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("actor_safe_context");
            expect((contextLoad?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("sources");
            expect((contextLoad?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("withheld");
            expect((memorySave?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("changed_files");
            expect((memorySave?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("events_summary");
            expect((memorySave?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("knowledge_summary");
            expect((memorySave?.sidecarDataSchema as SchemaWithProperties | undefined)?.properties).toHaveProperty("mind_summary");
            const memorySavePrompt = typeof memorySave?.enterPrompt === "function"
                ? memorySave.enterPrompt({
                    name: "actor.memory-save",
                    stage: "settleRun",
                    sessionId: -1,
                    session: testSession({
                        profileKey: "simulator.actor",
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
                                visible_response: "她向后退了一步。",
                                spoken_dialogue: "",
                                inner_response: "她开始警惕这条新消息。",
                            },
                        },
                    },
                    invocationId: "test-invocation",
                    profileKey: "simulator.actor",
                    caller: {kind: "sidecar"},
                } satisfies SidecarContext<Parameters<typeof memorySave.merge>[0]["input"]>)
                : memorySave?.enterPrompt ?? "";
            expect(memorySavePrompt).toContain("eventsPath");
            expect(memorySavePrompt).toContain("根据 visible_response、spoken_dialogue、inner_response 和本轮上下文判断是否需要更新");
            expect(memorySavePrompt).toContain("不要修改 statePath");
            expect(systemPrompt).toContain("<actor_definition>");
            expect(systemPrompt).toContain("<actor id=\"heroine\" kind=\"npc\">绘璃奈</actor>");
            expect(systemPrompt).toContain("你就是这个角色本人");
            expect(systemPrompt).toContain("<thinking_mode>");
            expect(systemPrompt).toContain("请以 绘璃奈 的第一人称进行人物分析");
            expect(systemPrompt).toContain("思考示例：<｜begin▁of▁thinking｜>我是 绘璃奈");
            expect(systemPrompt).toContain("你的思考应严格按以下顺序进行");
            expect(systemPrompt).toContain("回顾 <actor_sidecar_context>");
            expect(systemPrompt).toContain("<message_tags>");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("report_result.result");
            expect(systemPrompt).toContain("inner_response");
            expect(systemPrompt).not.toContain("questions");
            expect(systemPrompt).toContain("如果你扮演的是玩家 actor");
            expect(systemPrompt).toContain("主扮演阶段不要调用 read、write 或 edit");
            expect(systemPrompt).toContain("你看不到 subject.md、events.md、knowledge.md、mind.md、state.md 原文");
            expect(systemPrompt).toContain("文件维护由 actor.context-load / actor.memory-save 旁路处理");
            expect(systemPrompt).toContain("visible_response");
            expect(systemPrompt).toContain("我只表达角色反应本身");
            expect(systemPrompt).toContain("必须调用 report_result");
            expect(systemPrompt).toContain("<gm>");
            expect(systemPrompt).toContain("<角色 name=\"...\">");
            expect(systemPrompt).not.toContain("knowledge.md 使用二级章节归类");
            expect(systemPrompt).not.toContain("not_known_to_you");
            expect(systemPrompt).not.toContain("必要时可更新");
            expect(modelContextText).toContain("<actor_binding>");
            expect(modelContextText).toContain("这些路径只供 actor.context-load / actor.memory-save 旁路使用");
            expect(modelContextText).not.toContain("<subject_instruction>");
            expect(modelContextText).not.toContain("保持礼貌但警惕");
            expect(modelContextText).not.toContain("她第一次在广场边缘见到主角");
            expect(modelContextText).not.toContain("她相信主角值得观察");
            expect(modelContextText).not.toContain("她正在判断主角的用意");
            expect(modelContextText).not.toContain("她位于学院区广场边缘");
            expect(modelContextText).toContain("knowledgePath");
            expect(modelContextText).toContain("eventsPath");
            expect(modelContextText).toContain("mindPath");
            expect(modelContextText).toContain("statePath");
            expect(modelContextText).toContain("<actor_run_reminder actorId=\"heroine\">");
            expect(modelContextText).toContain("只回应当前 user message");
            expect(modelContextText).toContain("并必须调用 report_result");
            expect(modelContextText).toContain("不要主动读写文件");
            expect(modelContextText).toContain("记忆维护交给 sidecar");
            expect(appendingText).toContain("Runtime Location");
            expect(appendingText).not.toContain("只回应当前 user message");
        } finally {
            await rm(fixture.workspaceRoot, {recursive: true, force: true});
        }
    });

    it("simulator.actor 复用 subject simulator 合同并注入新 profile 身份", async () => {
        const fixture = await createRoleplayFixture();
        try {
            const prepared = await simulatorActorProfile.prepare!({
                session: testSession({
                    profileKey: "simulator.actor",
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

            expect(simulatorActorProfile.inputSchema).toBe(SubjectSimulatorInputSchema);
            expect(simulatorActorProfile.outputSchema).toBe(SubjectSimulatorOutputSchema);
            expect(simulatorActorProfile.allowedToolKeys).toEqual(["read", "write", "edit", "report_result"]);
            expect(systemPrompt).toContain("<profile>simulator.actor</profile>");
            expect(systemPrompt).toContain("<actor id=\"heroine\" kind=\"npc\">绘璃奈</actor>");
            expect(modelContextText).toContain("<actor_binding>");
            expect(modelContextText).toContain("knowledgePath");
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
            expect(appendingText).toContain("Runtime Location");
        } finally {
            await rm(fixture.workspaceRoot, {recursive: true, force: true});
        }
    });

    it("simulation 模板包含 events 路径、runs 新结构和不产生断链的 entity 示例", async () => {
        const templateRoot = resolve("assets", "workspace", ".nbook", "templates", "project-directory-templates", "simulation");
        const configText = await readFile(join(templateRoot, "config.yaml"), "utf-8");
        const castText = await readFile(join(templateRoot, "cast.yaml"), "utf-8");
        const cast = parseYaml(castText) as {defaultActorProfile?: string; subjects?: Array<{id?: string; events?: string; profile?: string}>};
        const subjects = cast.subjects ?? [];

        expect(configText).toContain("leaderProfile: simulator.leader");
        expect(configText).toContain("defaultActorProfile: simulator.actor");
        expect(cast.defaultActorProfile).toBe("simulator.actor");
        expect(subjects.length).toBeGreaterThan(0);
        for (const subject of subjects) {
            expect(subject.profile).toBe("simulator.actor");
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
