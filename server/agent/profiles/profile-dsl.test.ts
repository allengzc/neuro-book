import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {
    AIMessage,
    AgentCatalog,
    AppendingSet,
    Compaction,
    CompactionPrompt,
    CompactionSummaryPrefix,
    HistorySet,
    If,
    LinkedAgentsReminder,
    Message,
    MentionedSkillsReminder,
    ModelContext,
    PlanModeExit,
    PlanModeFull,
    PlanModeReminder,
    PlanModeReentry,
    PlanModeSparse,
    ProfilePrompt,
    Reminder,
    RuntimeContext,
    SqlSchemaSummary,
    System,
    SkillCatalog,
    TaskReminder,
    ToolCall,
    ToolResult,
    validateProfileTurnPlan,
    Watch,
    VariableSchema,
} from "nbook/server/agent/profiles/profile-dsl";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

describe("profile TSX DSL", () => {
    it("profileKey 为 summarizer 时会把 input 收窄为 profile 作者可填参数", () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.summarizer-typing",
                name: "Summarizer Typing",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    trigger: "afterInvocation",
                    interval: {
                        kind: "sourceInvocation",
                        value: 1,
                    },
                    maxDialogueContentTokens: 80_000,
                },
            },
            context() {
                return ProfilePrompt({children: Message({children: "ok"})});
            },
        });

        defineAgentProfile({
            manifest: {
                key: "test.summarizer-typing-invalid",
                name: "Summarizer Typing Invalid",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            summarizer: {
                profileKey: "summarizer",
                input: {
                    // @ts-expect-error sourceSessionId 由 harness 注入，profile 作者不能填写。
                    sourceSessionId: 1,
                },
            },
            context() {
                return ProfilePrompt({children: Message({children: "ok"})});
            },
        });

        expect(profile.summarizer?.input).toMatchObject({
            trigger: "afterInvocation",
            interval: {
                kind: "sourceInvocation",
                value: 1,
            },
        });
    });

    it("编译 ProfilePrompt 分区为 ProfileTurnPlan", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.dsl",
                name: "DSL",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        System({children: "system"}),
                        HistorySet({children: Message({children: "history"})}),
                        ModelContext({children: Message({children: "model"})}),
                        AppendingSet({children: Message({children: "append"})}),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect(plan.systemPrompt).toBe("system");
        expect((plan.historyInitMessages ?? []).map(messageText)).toEqual(["history"]);
        expect((plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : message.role)).toEqual(["model"]);
        expect((plan.appendingMessages ?? []).map(messageText)).toEqual(["append"]);
    });

    it("编译 Compaction 顶层策略并校验非法落点", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.compaction",
                name: "Compaction",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        Compaction({
                            triggerPercent: 0.75,
                            keepRecentTokens: 12_000,
                            children: [
                                CompactionPrompt({children: "compact prompt"}),
                                CompactionSummaryPrefix({children: "summary prefix"}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect(plan.compaction).toEqual({
            enabled: undefined,
            triggerPercent: 0.75,
            triggerTokens: undefined,
            reserveTokens: undefined,
            keepRecentTokens: 12_000,
            keepRecentPercent: undefined,
            prompt: "compact prompt",
            summaryPrefix: "summary prefix",
        });

        const badPlacement = defineAgentProfile({
            manifest: {
                key: "test.bad-compaction-prompt",
                name: "Bad Compaction Prompt",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: CompactionPrompt({children: "bad"})}),
                    ],
                });
            },
        });
        await expect(badPlacement.prepare!(context())).rejects.toThrow("CompactionPrompt");
    });

    it("校验 Compaction 参数合同", async () => {
        expect(() => validateProfileTurnPlan("test.dsl", {
            compaction: {
                triggerPercent: 0.8,
                triggerTokens: 1000,
            },
        })).toThrow("triggerPercent");

        expect(() => validateProfileTurnPlan("test.dsl", {
            compaction: {
                keepRecentPercent: 0.5,
                keepRecentTokens: 1000,
            },
        })).toThrow("keepRecentPercent");

        expect(() => validateProfileTurnPlan("test.dsl", {
            compaction: {
                triggerPercent: 1.2,
            },
        })).toThrow("(0, 1]");

        expect(() => validateProfileTurnPlan("test.dsl", {
            compaction: {
                keepRecentTokens: 0,
            },
        })).toThrow("正整数");
    });

    it("拒绝旧 PreparedTurn 字段和 Message system role", async () => {
        expect(() => validateProfileTurnPlan("test.dsl", {
            systemPrompt: "ok",
            toolKeys: [],
        } as never)).toThrow("toolKeys");

        const profile = defineAgentProfile({
            manifest: {
                key: "test.system-message",
                name: "System Message",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: Message({role: "system", children: "bad"})}),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("Message role");
    });

    it("校验 Reminder 和 Watch 落点", async () => {
        const modelReminderProfile = defineAgentProfile({
            manifest: {
                key: "test.model-reminder",
                name: "Model Reminder",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        ModelContext({children: Reminder({id: "model", children: Message({children: "visible"})})}),
                    ],
                });
            },
        });
        const modelReminderPlan = await modelReminderProfile.prepare!(context());
        expect((modelReminderPlan.modelContextAppendingMessages ?? []).map(messageText)).toEqual(["visible"]);
        expect(modelReminderPlan.modelContextMessages).toBeUndefined();

        const badReminderProfile = defineAgentProfile({
            manifest: {
                key: "test.bad-reminder",
                name: "Bad Reminder",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Reminder({id: "bad", children: Message({children: "bad"})})}),
                    ],
                });
            },
        });
        await expect(badReminderProfile.prepare!(context())).rejects.toThrow("Reminder");

        const watchProfile = defineAgentProfile({
            manifest: {
                key: "test.bad-watch",
                name: "Bad Watch",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({children: Watch({path: "session.profileKey", children: Message({children: "bad"})})}),
                    ],
                });
            },
        });
        await expect(watchProfile.prepare!(context())).rejects.toThrow("Watch");
    });

    it("校验 Reminder 参数合同", async () => {
        const bothWatchInputs = defineAgentProfile({
            manifest: {
                key: "test.bad-reminder-watch",
                name: "Bad Reminder Watch",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: Reminder({
                                id: "bad",
                                watchPath: "client.foo",
                                watchValue: "foo",
                                children: Message({children: "bad"}),
                            }),
                        }),
                    ],
                });
            },
        });
        await expect(bothWatchInputs.prepare!(context())).rejects.toThrow("只能提供一个");

        const badRepeat = defineAgentProfile({
            manifest: {
                key: "test.bad-reminder-repeat",
                name: "Bad Reminder Repeat",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: Reminder({
                                id: "bad",
                                repeatEveryTurns: 0,
                                children: Message({children: "bad"}),
                            }),
                        }),
                    ],
                });
            },
        });
        await expect(badRepeat.prepare!(context())).rejects.toThrow("repeatEveryTurns");
    });

    it("ToolResult 必须匹配前序 ToolCall", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.tool-result",
                name: "Tool Result",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: [
                                AIMessage({children: ToolCall({id: "call-1", name: "read"})}),
                                ToolResult({toolCallId: "call-missing", toolName: "read", children: "result"}),
                            ],
                        }),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("ToolResult");
    });

    it("AIMessage 会递归收集 If/Fragment 内的 ToolCall", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.nested-tool-call",
                name: "Nested ToolCall",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: [
                                AIMessage({
                                    children: [
                                        "reading",
                                        If({condition: true, children: ToolCall({id: "call-1", name: "read"})}),
                                    ],
                                }),
                                ToolResult({toolCallId: "call-1", toolName: "read", children: "result"}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());
        const assistant = plan.historyInitMessages?.[0];

        expect(assistant?.role).toBe("assistant");
        expect(assistant?.role === "assistant" ? assistant.stopReason : null).toBe("toolUse");
        expect(assistant?.role === "assistant" ? assistant.content.map((block) => block.type) : []).toEqual(["text", "toolCall"]);
        expect(plan.historyInitMessages?.[1]?.role).toBe("toolResult");
    });

    it("拒绝 AIMessage ToolCall 后通过嵌套节点追加文本", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.tool-call-after-text",
                name: "ToolCall After Text",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: AIMessage({
                                children: [
                                    ToolCall({id: "call-1", name: "read"}),
                                    If({condition: true, children: "late text"}),
                                ],
                            }),
                        }),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("ToolCall 后不能再追加");
    });

    it("If false 不渲染子树也不写 state", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.if",
                name: "If",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: [
                                false && Reminder({id: "hidden", repeatEveryTurns: 1, children: Message({children: "hidden"})}),
                                Message({children: "visible"}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect((plan.appendingMessages ?? []).map(messageText)).toEqual(["visible"]);
        expect(plan.stateWrites).toBeUndefined();
    });

    it("SqlSchemaSummary 可作为 string fragment 注入 ModelContext", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.sql-summary",
                name: "SQL Summary",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        ModelContext({
                            children: Message({
                                children: SqlSchemaSummary({text: "SQL_SCHEMA"}),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect((plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : "")).toEqual(["SQL_SCHEMA"]);
    });

    it("SkillCatalog 只渲染 skills，不渲染 agent profiles", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.skill-catalog",
                name: "Skill Catalog",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: SkillCatalog({}),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!({
            ...context(),
            catalog: {
                profiles: [{
                    key: "writer",
                    name: "Writer",
                    description: "agent profile",
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                }],
                issues: [],
            },
            skills: [{
                key: "draft",
                name: "Draft Skill",
                description: "Write a draft.",
                whenToUse: "用户需要起草正文时",
                source: "system",
                rootPath: "assets/workspace/.nbook/agent/skills/draft",
                skillPath: "assets/workspace/.nbook/agent/skills/draft/SKILL.md",
            }],
        });
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("## Available Skills");
        expect(text).toContain("key: draft");
        expect(text).toContain("Draft Skill");
        expect(text).toContain(`location: ${resolve("assets", "workspace", ".nbook", "agent", "skills", "draft", "SKILL.md")}`);
        expect(text).toContain("read the SKILL.md file at the catalog location");
        expect(text).toContain("when_to_use");
        expect(text).not.toContain("## Available Agents");
        expect(text).not.toContain("writer");
    });

    it("AgentCatalog 只渲染 agent profile 索引", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.agent-catalog",
                name: "Agent Catalog",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: AgentCatalog({}),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!({
            ...context(),
            catalog: {
                profiles: [{
                    key: "writer",
                    name: "Writer",
                    description: "写作 agent",
                    inputSchema: Type.Object({
                        prompt: Type.String({description: "写作任务说明。"}),
                        outputPath: Type.Optional(Type.String({description: "可选输出路径。"})),
                    }),
                    outputSchema: Type.Object({
                        summary: Type.String({description: "写作摘要。"}),
                    }),
                    allowedToolKeys: ["read", "write"],
                    source: "system",
                    builtin: true,
                    loadStatus: "loaded",
                }],
                issues: [],
            },
            skills: [],
        });
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("## Available Agents");
        expect(text).toContain("writer");
        expect(text).toContain("get_agent_profile");
        expect(text).not.toContain("allowedTools: read, write");
        expect(text).not.toContain("写作任务说明");
        expect(text).not.toContain("inputSchema");
        expect(text).not.toContain("\"type\"");
    });

    it("通用 runtime reminder 节点能渲染英文 system-reminder", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.runtime-reminders",
                name: "Runtime Reminders",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        ModelContext({
                            children: Message({
                                children: RuntimeContext({}),
                            }),
                        }),
                        AppendingSet({
                            children: [
                                LinkedAgentsReminder(),
                                TaskReminder({repeatEveryTurns: 8}),
                                PlanModeReminder(),
                                Message({children: MentionedSkillsReminder()}),
                            ],
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!({
            ...context(),
            vars: createTestVariableAccessor({"client.currentProjectWorkspace": "workspace/novel-7"}),
            session: {
                ...context().session,
                projectPath: "workspace/novel-7",
                messages: [createUserMessage({text: "use $draft please"})],
                customState: {
                    "agent.tasks": {
                        title: "Test plan",
                        steps: [{id: "one", text: "Do one", status: "pending"}],
                    },
                    "agent.planMode": {
                        active: true,
                        reminderKind: "full",
                        workDirectory: "workspace/.agent/123",
                    },
                },
                linkedAgents: [{sessionId: 7, profileKey: "writer", detached: false}],
                planModeActive: true,
            },
        });
        const modelText = (plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : "").join("\n");
        const appendingText = (plan.appendingMessages ?? []).map(messageText).join("\n");

        expect(modelText).toContain("<dynamic-context>");
        expect(modelText).toContain("Agent cwd: workspace");
        expect(modelText).toContain("Current Project Workspace: workspace/novel-7");
        expect(modelText).not.toContain("Current novelId");
        expect(modelText).toContain("Linked agents:");
        expect(appendingText).toContain("Current linked agents:");
        expect(appendingText).toContain("Current task list: Test plan");
        expect(appendingText).toContain("## Thread Work Directory");
        expect(appendingText).toContain("## Restrictions");
        expect(appendingText).toContain("## Workflow");
        expect(appendingText.match(/## Thread Work Directory/g)).toHaveLength(1);
        expect(appendingText).toContain("The user explicitly mentioned skill(s): $draft");
        expect(appendingText).toContain("read the matching SKILL.md location");
        expect(appendingText).not.toContain("{sessionId}");
    });

    it("PlanModeReminder 支持 exit 和 reentry lifecycle 文案", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.plan-mode-reminder",
                name: "Plan Mode Reminder",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: PlanModeReminder()}),
                    ],
                });
            },
        });

        const exitPlan = await profile.prepare!({
            ...context(),
            session: {
                ...context().session,
                planModeActive: false,
                customState: {
                    "agent.planMode": {
                        active: false,
                        reminderKind: "exit",
                        workDirectory: "workspace/.agent/123",
                    },
                },
            },
        });
        const reentryPlan = await profile.prepare!({
            ...context(),
            session: {
                ...context().session,
                planModeActive: true,
                customState: {
                    "agent.planMode": {
                        active: true,
                        reminderKind: "reentry_full",
                        workDirectory: "workspace/.agent/123",
                    },
                },
            },
        });

        expect((exitPlan.appendingMessages ?? []).map(messageText).join("\n")).toContain("## Exited Plan Mode");
        expect((reentryPlan.appendingMessages ?? []).map(messageText).join("\n")).toContain("## Re-entering Plan Mode");
    });

    it("PlanModeReminder 在 UI soft toggle active 时也会注入 full reminder", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.plan-mode-soft-toggle",
                name: "Plan Mode Soft Toggle",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: PlanModeReminder()}),
                    ],
                });
            },
        });

        const idle = await profile.prepare!(context());

        expect(idle.appendingMessages ?? []).toEqual([]);
        expect(idle.stateWrites).toBeUndefined();

        const toggled = await profile.prepare!({
            ...context(),
            session: {
                ...context().session,
                planModeActive: true,
                customState: {
                    "profileState.test.plan-mode-soft-toggle": {
                        reminders: {
                            "plan-mode": {
                                fingerprint: "__undefined__",
                                injectedAtTurn: 1,
                            },
                        },
                    },
                },
            },
        });
        const text = (toggled.appendingMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("## Thread Work Directory");
        expect(text).toContain("## Restrictions");
    });

    it("PlanModeReminder 支持四种子节点插槽覆盖默认文案", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.plan-mode-slots",
                name: "Plan Mode Slots",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({
                            children: PlanModeReminder({
                                children: [
                                    PlanModeFull({children: "CUSTOM_FULL"}),
                                    PlanModeSparse({children: "CUSTOM_SPARSE"}),
                                    PlanModeExit({children: "CUSTOM_EXIT"}),
                                    PlanModeReentry({children: "CUSTOM_REENTRY"}),
                                ],
                            }),
                        }),
                    ],
                });
            },
        });

        const full = await profile.prepare!(planModeContext("full", true));
        const sparse = await profile.prepare!(planModeContext("sparse", true));
        const exit = await profile.prepare!(planModeContext("exit", false));
        const reentry = await profile.prepare!(planModeContext("reentry_full", true));

        expect((full.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_FULL");
        expect((full.appendingMessages ?? []).map(messageText).join("\n")).not.toContain("## Thread Work Directory");
        expect((sparse.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_SPARSE");
        expect((exit.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_EXIT");
        expect((reentry.appendingMessages ?? []).map(messageText).join("\n")).toContain("CUSTOM_REENTRY");
    });

    it("PlanMode slot 不能脱离 PlanModeReminder 使用", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.bad-plan-mode-slot",
                name: "Bad Plan Mode Slot",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        AppendingSet({children: PlanModeFull({children: "bad"})}),
                    ],
                });
            },
        });

        await expect(profile.prepare!(context())).rejects.toThrow("PlanModeFull");
    });

    it("VariableSchema 默认输出局部 schema", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.variable-schema",
                name: "Variable Schema",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: ModelContext({
                        children: VariableSchema({paths: ["client.currentProjectWorkspace"], includeToolGuide: false}),
                    }),
                });
            },
        });

        const plan = await profile.prepare!(context());
        const text = (plan.modelContextMessages ?? []).map((message) => message.role === "user" ? messageText(message) : "").join("\n");

        expect(text).toContain("\"schemas\"");
        expect(text).toContain("\"path\": \"client.currentProjectWorkspace\"");
        expect(text).toContain("\"schema\"");
    });

    it("拒绝 prepare 写入非 object 的 profile runtime state", () => {
        expect(() => validateProfileTurnPlan("test.dsl", {
            stateWrites: [{
                type: "custom",
                key: "profileState.test.dsl",
                value: "bad",
            }],
        })).toThrow("profile runtime state 必须是 object");

        expect(() => validateProfileTurnPlan("test.dsl", {
            stateWrites: [{
                type: "custom",
                key: "profileState.test.dsl",
                value: {
                    reminders: "bad",
                },
            }],
        })).toThrow("reminders 必须是 object map");
    });
});

function context(): ProfilePrepareContext<object> {
    const session: ProfilePrepareContext<object>["session"] = {
        systemPrompt: "",
        messages: [createUserMessage({text: "prompt"})],
        model: null,
        thinkingLevel: "off",
        profileKey: "test.dsl",
        workspaceRoot: "workspace",
        customState: {},
        linkedAgents: [],
        archived: false,
        planModeActive: false,
        async read() {
            return {
                snapshot: {
                    metadata: {
                        sessionId: -1,
                        profileKey: "test.dsl",
                        input: {},
                        workspaceRoot: "workspace",
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
    return {
        session,
        input: {},
        vars: createTestVariableAccessor(),
        catalog: {
            profiles: [],
            issues: [],
        },
        skills: [],
        runtime: {
            now: "2026-05-23T00:00:00.000Z",
            promptUserTurnCount: 1,
        },
    };
}

function planModeContext(kind: string, active: boolean): ProfilePrepareContext<object> {
    return {
        ...context(),
        session: {
            ...context().session,
            planModeActive: active,
            customState: {
                "agent.planMode": {
                    active,
                    reminderKind: kind,
                    workDirectory: "workspace/.agent/custom",
                },
            },
        },
    };
}
