import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {createUserMessage, messageText} from "nbook/server/agent/messages/message-utils";
import {
    AIMessage,
    AgentCatalog,
    AppendingSet,
    HistorySet,
    If,
    Import,
    LinkedAgentsReminder,
    Message,
    MentionedSkillsReminder,
    ModelContext,
    PlanModeAvailabilityReminder,
    PlanModeExit,
    PlanModeFull,
    PlanModeReminder,
    PlanModeReentry,
    PlanModeSparse,
    ProfilePrompt,
    Reminder,
    RuntimeLocationReminder,
    SqlSchemaSummary,
    System,
    SkillCatalog,
    TaskReminder,
    ToolCall,
    ToolResult,
    validateCompactionPlan,
    validateProfileTurnPlan,
    Watch,
    VariableSchema,
    WorkspaceFocusReminder,
} from "nbook/server/agent/profiles/profile-dsl";
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/profiles/profile-tools";
import type {ProfileTools} from "nbook/server/agent/profiles/profile-tools";
import type {AgentProfileDefinition, ProfilePrepareContext, SidecarProfilePass} from "nbook/server/agent/profiles/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

type LegacyTestSidecar<TInput = JsonValue> = Omit<SidecarProfilePass<TInput, JsonValue>, "toolKeys"> & {
    toolKeys?: readonly string[];
    allowedToolKeys?: readonly string[];
};

type LegacyTestProfile<
    TInputSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = Omit<AgentProfileDefinition<TInputSchema, TOutputSchema, TSummarizerKey, TTools>, "tools" | "mainRunToolKeys" | "sidecars"> & {
    tools?: ProfileTools;
    allowedToolKeys?: readonly string[];
    mainRunAllowedToolKeys?: readonly string[];
    mainRunToolKeys?: readonly string[];
    sidecars?: readonly LegacyTestSidecar<Static<TInputSchema>>[];
};

function defineAgentProfile<
    TInputSchema extends TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
>(profile: LegacyTestProfile<TInputSchema, TOutputSchema, TSummarizerKey, TTools>): ReturnType<typeof defineRuntimeAgentProfile> {
    const {
        allowedToolKeys,
        mainRunAllowedToolKeys,
        sidecars,
        ...rest
    } = profile;
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(allowedToolKeys ?? []),
        mainRunToolKeys: rest.mainRunToolKeys ?? mainRunAllowedToolKeys,
        // 测试 helper 只做旧字段到新字段的机械迁移，最终运行时校验仍由 defineRuntimeAgentProfile 负责。
        sidecars: sidecars?.map((sidecar) => {
            const {
                allowedToolKeys: sidecarAllowedToolKeys,
                ...sidecarRest
            } = sidecar;
            return {
                ...sidecarRest,
                toolKeys: sidecarRest.toolKeys ?? sidecarAllowedToolKeys,
            };
        }) as AgentProfileDefinition<TInputSchema, TOutputSchema, TSummarizerKey, TTools>["sidecars"],
    });
}

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

    it("使用 profile 顶层 compaction 配置", () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.compaction",
                name: "Compaction",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            compaction: {
                triggerPercent: 0.75,
                keepRecentTokens: 12_000,
                prompt: "compact prompt",
                summaryPrefix: "summary prefix",
            },
            context() {
                return ProfilePrompt({
                    children: [],
                });
            },
        });

        expect(profile.compaction).toEqual({
            triggerPercent: 0.75,
            keepRecentTokens: 12_000,
            prompt: "compact prompt",
            summaryPrefix: "summary prefix",
        });
    });

    it("校验 Compaction 参数合同", async () => {
        expect(() => validateCompactionPlan("test.dsl", {
            triggerPercent: 0.8,
            triggerTokens: 1000,
        })).toThrow("triggerPercent");

        expect(() => validateCompactionPlan("test.dsl", {
            keepRecentPercent: 0.5,
            keepRecentTokens: 1000,
        })).toThrow("keepRecentPercent");

        expect(() => validateCompactionPlan("test.dsl", {
            triggerPercent: 1.2,
        })).toThrow("(0, 1]");

        expect(() => validateCompactionPlan("test.dsl", {
            keepRecentTokens: 0,
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

    it("Import 可导入共享 Markdown，并支持 heading 与 maxBytes", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.import",
                name: "Import",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: [
                        HistorySet({
                            children: Message({
                                children: Import({
                                    path: "reference/README.md",
                                    heading: "Modules",
                                    maxBytes: 120,
                                    label: "Reference Modules",
                                }),
                            }),
                        }),
                    ],
                });
            },
        });

        const plan = await profile.prepare!(context());
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("[Import truncated: reference/README.md maxBytes=120]");
        expect(text).toContain("```reference/README.md");
        expect(text).toContain("```");
        expect(text).toContain("## Modules");
        expect(text).not.toContain("# NeuroBook Reference Bookshelf");
    });

    it("Import 可导入系统 skill 文档", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.import-system-skill",
                name: "Import System Skill",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({
                                path: "assets/workspace/.nbook/agent/skills/stop-slop/SKILL.md",
                                required: true,
                            }),
                        }),
                    }),
                });
            },
        });

        const plan = await profile.prepare!(context());
        const text = (plan.historyInitMessages ?? []).map(messageText).join("\n");

        expect(text).toContain("```assets/workspace/.nbook/agent/skills/stop-slop/SKILL.md");
        expect(text).toContain("# Stop Slop");
        expect(text).toContain("Eliminate predictable AI writing patterns from prose.");
    });

    it("Import 缺失文件默认渲染空消息，required=true 时抛错，并继续拒绝越界路径", async () => {
        const optionalProfile = defineAgentProfile({
            manifest: {
                key: "test.import-optional",
                name: "Import Optional",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "docs/no-such-import-file.md", required: false}),
                        }),
                    }),
                });
            },
        });

        const optionalPlan = await optionalProfile.prepare!(context());
        expect(optionalPlan.historyInitMessages ?? []).toEqual([]);

        const requiredProfile = defineAgentProfile({
            manifest: {
                key: "test.import-required",
                name: "Import Required",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "docs/no-such-import-file.md", required: true}),
                        }),
                    }),
                });
            },
        });
        await expect(requiredProfile.prepare!(context())).rejects.toThrow("no-such-import-file");

        const traversalProfile = defineAgentProfile({
            manifest: {
                key: "test.import-traversal",
                name: "Import Traversal",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "../AGENTS.md"}),
                        }),
                    }),
                });
            },
        });
        await expect(traversalProfile.prepare!(context())).rejects.toThrow("..");

        const disallowedProfile = defineAgentProfile({
            manifest: {
                key: "test.import-disallowed",
                name: "Import Disallowed",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: HistorySet({
                        children: Message({
                            children: Import({path: "package.json"}),
                        }),
                    }),
                });
            },
        });
        await expect(disallowedProfile.prepare!(context())).rejects.toThrow("assets/workspace/.nbook/agent/skills");
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
                    toolKeys: ["read", "write"],
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

    it("runtime reminder 节点能在 AppendingSet 注入可见 system-reminder", async () => {
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
                                children: SqlSchemaSummary({text: "SQL_SCHEMA"}),
                            }),
                        }),
                        AppendingSet({
                            children: [
                                RuntimeLocationReminder(),
                                WorkspaceFocusReminder(),
                                PlanModeAvailabilityReminder(),
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
            vars: createTestVariableAccessor({
                "client.currentProjectWorkspace": "workspace/novel-7",
                "client.studio.selectedFilePath": "manuscript/001-opening/index.md",
            }),
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

        expect(modelText).toBe("SQL_SCHEMA");
        expect(modelText).not.toContain("<dynamic-context>");
        expect(appendingText).toContain("Runtime Location:");
        expect(appendingText).toContain("- Tool cwd: workspace/");
        expect(appendingText).toContain("- Source root:");
        expect(appendingText).toContain("- Reference root:");
        expect(appendingText).toContain("Current Workspace Focus:");
        expect(appendingText).toContain("Current Project Workspace: workspace/novel-7");
        expect(appendingText).toContain("use novel-7/lorebook/... or novel-7/manuscript/...");
        expect(appendingText).toContain("Current selected file: novel-7/manuscript/001-opening/index.md");
        expect(appendingText).not.toContain("Plan mode is inactive");
        expect(appendingText).toContain("Current linked agents:");
        expect(appendingText).toContain("Current task list: Test plan");
        expect(appendingText).toContain("## Thread Work Directory");
        expect(appendingText).toContain("## Restrictions");
        expect(appendingText).toContain("## Workflow");
        expect(appendingText).toContain("The user explicitly mentioned skill(s): $draft");
        expect(appendingText).toContain("read the matching SKILL.md location");
        expect(appendingText).not.toContain("{sessionId}");
    });

    it("PlanModeAvailabilityReminder 首轮 inactive 时注入可用性提醒", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.plan-mode-availability",
                name: "Plan Mode Availability",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: AppendingSet({
                        children: PlanModeAvailabilityReminder(),
                    }),
                });
            },
        });

        const plan = await profile.prepare!(context());

        expect((plan.appendingMessages ?? []).map(messageText).join("\n")).toContain("Plan mode is inactive");
    });

    it("WorkspaceFocusReminder 在 Project Workspace 或选中文件变化时注入焦点提醒", async () => {
        const profile = defineAgentProfile({
            manifest: {
                key: "test.workspace-focus-reminder",
                name: "Workspace Focus Reminder",
            },
            inputSchema: Type.Object({}),
            allowedToolKeys: [],
            context() {
                return ProfilePrompt({
                    children: AppendingSet({
                        children: WorkspaceFocusReminder(),
                    }),
                });
            },
        });
        const base = context();
        const previousState = {
            "profileState.test.workspace-focus-reminder": {
                reminders: {
                    "workspace-focus": {
                        hasValue: true,
                        value: {
                            currentProjectWorkspace: "workspace/a",
                            selectedFilePath: "manuscript/001/index.md",
                        },
                        fingerprint: "{\"currentProjectWorkspace\":\"workspace/a\",\"selectedFilePath\":\"manuscript/001/index.md\"}",
                        injectedAtTurn: 1,
                    },
                },
            },
        };
        const unchanged = await profile.prepare!({
            ...base,
            vars: createTestVariableAccessor({
                "client.currentProjectWorkspace": "workspace/a",
                "client.studio.selectedFilePath": "manuscript/001/index.md",
            }),
            session: {
                ...base.session,
                profileKey: "test.workspace-focus-reminder",
                customState: previousState,
            },
        });
        const projectChanged = await profile.prepare!({
            ...base,
            vars: createTestVariableAccessor({
                "client.currentProjectWorkspace": "workspace/b",
                "client.studio.selectedFilePath": null,
            }),
            session: {
                ...base.session,
                profileKey: "test.workspace-focus-reminder",
                customState: previousState,
            },
        });
        const fileChanged = await profile.prepare!({
            ...base,
            vars: createTestVariableAccessor({
                "client.currentProjectWorkspace": "workspace/a",
                "client.studio.selectedFilePath": "manuscript/002/index.md",
            }),
            session: {
                ...base.session,
                profileKey: "test.workspace-focus-reminder",
                customState: previousState,
            },
        });

        expect(unchanged.appendingMessages ?? []).toEqual([]);
        const text = (projectChanged.appendingMessages ?? []).map(messageText).join("\n");
        expect(text).toContain("User switched Current Project Workspace to workspace/b");
        expect(text).toContain("Tool cwd is unchanged");
        expect(text).toContain("Use b/lorebook/..., b/manuscript/..., and b/reference/...");
        expect(text).toContain("Do not use workspace/b/...");

        const fileText = (fileChanged.appendingMessages ?? []).map(messageText).join("\n");
        expect(fileText).toContain("Current selected file changed to a/manuscript/002/index.md");
        expect(fileText).toContain("Use this cwd-relative path directly in file tools.");
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

        const exitText = (exitPlan.appendingMessages ?? []).map(messageText).join("\n");
        expect(exitText).toContain("## Exited Plan Mode");
        expect(exitText).not.toContain("Plan mode still active");
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
                projectPath: "workspace/alpha",
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
        expect(text).toContain("workspace/alpha/.agent/plan");
        expect(text).toContain("alpha/.agent/plan/<slug>.md");
        expect(text).toContain("planFilePath like .agent/plan/<slug>.md");
        expect(text).toContain("approval UI displays that Project Workspace file");
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
