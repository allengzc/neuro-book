import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from "@langchain/core/messages";
import {z} from "zod";
import {afterEach, describe, expect, it} from "vitest";
import {
    ActivatedSkills,
    AppendingSet,
    DynamicSet,
    HistorySet,
    ProfilePrompt,
    Reminder,
    SimpleProfile,
    SkillCatalog,
    Watch,
    type ProfilePromptContext,
    type SimpleProfileTemplate,
} from "nbook/server/agent/profiles/simple-profile";
import {Message} from "nbook/server/agent/prompts";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {AgentProfile, PreparedProfileRun} from "nbook/server/agent/profiles/agent-profile";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {AgentReminderState, ProfileInputMap, SkillCatalogItem, ToolKey, WatchedVariableBaseline} from "nbook/server/agent/types";

class TestSimpleProfile extends SimpleProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "测试 SimpleProfile";
    readonly inputSchema = z.object({
        prompt: z.string().trim().min(1),
    });
    readonly allowedToolKeys = ["read_file"] as const;

    protected override async buildPrompt(ctx: ProfilePromptContext<"leader.default">) {
        const prompt = "prompt" in ctx.input ? ctx.input.prompt : "";
        const activatedSkillsText = await ctx.activatedSkillsText();
        return ProfilePrompt({
            children: [
                HistorySet({
                    children: [
                        Message({
                            role: "system",
                            children: "system",
                        }),
                        ctx.skillCatalogText
                            ? Message({
                                role: "system",
                                children: SkillCatalog({text: ctx.skillCatalogText}),
                            })
                            : null,
                    ],
                }),
                DynamicSet({
                    children: Message({
                        role: "human",
                        children: "dynamic",
                    }),
                }),
                AppendingSet({
                    children: [
                        Watch({
                            path: "scope.studio.workspace",
                            render: ({previousValue, currentValue}) => {
                                if (previousValue === currentValue) {
                                    return null;
                                }
                                return Message({
                                    role: "system",
                                    children: `watch:${String(previousValue)}->${String(currentValue)}`,
                                });
                            },
                        }),
                        activatedSkillsText
                            ? Message({
                                role: "human",
                                children: ActivatedSkills({text: activatedSkillsText}),
                            })
                            : null,
                        Message({
                            role: "human",
                            source: "input",
                            children: `input:${prompt}`,
                        }),
                    ],
                }),
            ],
        });
    }
}

class CustomSimpleProfile extends SimpleProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "自定义 SimpleProfile";
    readonly inputSchema = z.object({
        prompt: z.string().trim().min(1),
    });
    readonly allowedToolKeys = ["read_file"] as const;

    constructor(
        private readonly template: (ctx: ProfilePromptContext<"leader.default">) => SimpleProfileTemplate,
    ) {
        super();
    }

    protected override buildPrompt(ctx: ProfilePromptContext<"leader.default">) {
        return this.template(ctx);
    }
}

/**
 * 创建最小 runtime。
 */
function createRuntime(input: {
    profile?: AgentProfile<"leader.default">;
    history?: BaseMessage[];
    skillCatalog?: readonly SkillCatalogItem[];
    watchedVariables?: Record<string, WatchedVariableBaseline>;
    reminders?: Record<string, AgentReminderState>;
    prompt?: string;
    runtimeInput?: ProfileInputMap["leader.default"];
    workspace?: string | null;
    tools?: ToolKey[];
}) {
    const profile = input.profile ?? new TestSimpleProfile();
    const history = input.history ?? [new HumanMessage("history")];
    const workspace = input.workspace ?? "novel-ide";
    const watchedVariables = input.watchedVariables ?? {
        "scope.studio.workspace": {
            fingerprint: JSON.stringify(workspace),
            hasValue: true,
            value: workspace,
        },
    };

    return {
        thread: createThreadRecord({
            metadata: {
                watchedVariables,
                reminders: input.reminders,
            },
        }),
        profile,
        input: input.runtimeInput ?? {
            prompt: input.prompt ?? "hello",
        },
        scope: {
            ide: {
                panel: null,
                activePanel: null,
                theme: null,
                extra: {},
            },
            studio: {
                novelId: null,
                selectedChapterId: null,
                previousSelectedChapterId: null,
                currentChapterTitle: null,
                previousChapterTitle: null,
                currentChapterLabel: null,
                previousChapterLabel: null,
                workspace,
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: null,
                extra: {},
            },
            agent: {
                thread: {
                    id: "thread-1",
                    title: "测试线程",
                    summary: "",
                    status: "idle",
                },
                profileKey: "leader.default" as const,
                kind: "leader" as const,
                tools: input.tools ?? ["read_file"],
                subagents: [],
                tasks: null,
            },
            input: input.runtimeInput ?? {
                prompt: input.prompt ?? "hello",
            },
        },
        skillCatalog: input.skillCatalog ?? [],
        options: {},
        messageStore: {} as never,
        loadHistoryMessages: async () => history,
        threadRepository: {} as never,
        variableStore: {} as never,
    } satisfies ProfileContextRuntime<"leader.default", AgentProfile<"leader.default">>;
}

const createdWorkspacePaths: string[] = [];

/**
 * 合并本轮所有需要落盘的 profile 前导消息。
 */
function allPersistedMessages(preparedRun: PreparedProfileRun) {
    return [
        ...preparedRun.persistedMessages.prepend,
        ...preparedRun.persistedMessages.append,
    ];
}

/**
 * 构造带产品 origin 的历史用户消息。
 */
function persistedUser(content: string): HumanMessage {
    return new HumanMessage({
        content,
        additional_kwargs: {
            messageOrigin: "user_input",
        },
    });
}

/**
 * 构造带产品 origin 的历史 assistant 消息。
 */
function persistedAssistant(content: string): AIMessage {
    return new AIMessage({
        content,
        additional_kwargs: {
            messageOrigin: "assistant_output",
        },
    });
}

afterEach(async () => {
    await Promise.all(createdWorkspacePaths.splice(0).map(async (workspacePath) => {
        await fs.rm(workspacePath, {recursive: true, force: true});
    }));
});

describe("SimpleProfile", () => {
    it("HistorySet 直接包含 SkillCatalog 时会在首次 run 写入 system_prompt", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            skillCatalog: [{
                name: "Writer",
                description: "写作",
                whenToUse: "用户显式要求写作",
                headerText: "name: Writer\\ndescription: 写作",
                location: "C:\\skills\\Writer\\SKILL.md",
            }],
            tools: ["read_file", "skill"],
            watchedVariables: {
                "scope.studio.workspace": {
                    fingerprint: "\"old-workspace\"",
                    value: "old-workspace",
                },
            },
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            expect.stringContaining("name: Writer"),
            "history",
            "dynamic",
            "watch:old-workspace->novel-ide",
            "input:hello",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => ({
            role: message.message._getType(),
            content: message.message.text,
        }))).toEqual([
            {
                role: "system",
                content: "system",
            },
            {
                role: "system",
                content: expect.stringContaining("when_to_use: 用户显式要求写作"),
            },
            {
                role: "system",
                content: "watch:old-workspace->novel-ide",
            },
            {
                role: "human",
                content: "input:hello",
            },
        ]);
        expect(preparedRun.persistedMessages.prepend.map((message) => message.message.text)).toEqual([
            "system",
            expect.stringContaining("when_to_use: 用户显式要求写作"),
        ]);
        expect(preparedRun.persistedMessages.append.map((message) => message.message.text)).toEqual([
            "watch:old-workspace->novel-ide",
            "input:hello",
        ]);
    });

    it("<Message role=\"system\"> 在 HistorySet 中等价于稳定 system prompt", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: HistorySet({
                children: Message({
                    role: "system",
                    children: "message-system",
                }),
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "message-system",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => ({
            role: message.message._getType(),
            content: message.message.text,
        }))).toEqual([{
            role: "system",
            content: "message-system",
        }]);
    });

    it("条件渲染 Message 时不会追加用户输入", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: [
                HistorySet({
                    children: Message({
                        role: "system",
                        children: "system",
                    }),
                }),
                AppendingSet({
                    children: false ? Message({
                        role: "human",
                        source: "input",
                        children: "input:hidden",
                    }) : null,
                }),
            ],
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            "history",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => message.message._getType())).toEqual([
            "system",
        ]);
    });

    it("input Message 空文本不会生成空 user message", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: Message({
                    role: "human",
                    source: "input",
                    children: "",
                }),
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [],
        }));

        expect(preparedRun.modelMessages).toEqual([]);
        expect(allPersistedMessages(preparedRun)).toEqual([]);
    });

    it("ProfilePrompt 顶层裸 Message 会作为 dynamic 上下文渲染且不持久化", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: Message({
                role: "human",
                children: "dynamic bare message",
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "history",
            "dynamic bare message",
        ]);
        expect(allPersistedMessages(preparedRun)).toEqual([]);
    });

    it("DynamicSet 接受 SkillCatalog 这类 string 节点包裹在 Message 内", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: DynamicSet({
                children: Message({
                    role: "system",
                    children: SkillCatalog({text: "catalog"}),
                }),
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual(["catalog"]);
    });

    it("DynamicSet 会按声明顺序出现在 HistorySet 前后且不持久化", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: [
                DynamicSet({
                    children: Message({
                        role: "system",
                        children: "dynamic-before-history",
                    }),
                }),
                HistorySet({
                    children: Message({
                        role: "system",
                        children: "stable-history",
                    }),
                }),
                DynamicSet({
                    children: Message({
                        role: "human",
                        children: "dynamic-after-history",
                    }),
                }),
                AppendingSet({
                    children: Message({
                        role: "human",
                        source: "input",
                        children: "input:hello",
                    }),
                }),
            ],
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "dynamic-before-history",
            "stable-history",
            "dynamic-after-history",
            "input:hello",
        ]);
        expect(preparedRun.persistedMessages.prepend.map((message) => message.message.text)).toEqual(["stable-history"]);
        expect(preparedRun.persistedMessages.append.map((message) => message.message.text)).toEqual(["input:hello"]);
    });

    it("ProfilePrompt 只能包含一个 HistorySet", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: [
                HistorySet({
                    children: Message({
                        role: "system",
                        children: "first-history",
                    }),
                }),
                HistorySet({
                    children: Message({
                        role: "system",
                        children: "second-history",
                    }),
                }),
            ],
        }));

        await expect(profile.prepare(createRuntime({
            profile,
            history: [],
        }))).rejects.toThrow("ProfilePrompt 只能包含一个 HistorySet");
    });

    it("HistorySet 不接受 Watch 这类异地节点", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: HistorySet({
                children: Watch({
                    path: "scope.studio.workspace",
                    render: () => Message({
                        role: "system",
                        children: "bad watch",
                    }),
                }),
            }),
        }));

        await expect(profile.prepare(createRuntime({
            profile,
        }))).rejects.toThrow("profile_watch 节点不能出现在普通 prompt 区域");
    });

    it("DynamicSet 不接受 Reminder 这类异地节点", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: DynamicSet({
                children: Reminder({
                    id: "bad-reminder",
                    children: Message({
                        role: "system",
                        children: "bad",
                    }),
                }),
            }),
        }));

        await expect(profile.prepare(createRuntime({
            profile,
        }))).rejects.toThrow("profile_reminder 节点不能出现在普通 prompt 区域");
    });

    it("AppendingSet 不接受裸文本", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: "bad text",
            }),
        }));

        await expect(profile.prepare(createRuntime({
            profile,
        }))).rejects.toThrow("AppendingSet 文本必须放在 Message 内部");
    });

    it("continue 模式会把历史尾部用户输入移动到最新位置", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedUser("你好"),
            ],
            skillCatalog: [{
                name: "Writer",
                description: "写作",
                headerText: "name: Writer\ndescription: 写作",
                location: "C:\\skills\\Writer\\SKILL.md",
            }],
            tools: ["read_file", "skill"],
            watchedVariables: {},
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            expect.stringContaining("name: Writer"),
            "dynamic",
            "watch:undefined->novel-ide",
            "你好",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => message.message._getType())).toEqual([
            "system",
            "system",
            "system",
        ]);
    });

    it("continue 模式会要求把 AppendingSet 持久消息插入到尾部用户输入之前", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            runtimeInput: {
                mode: "continue",
            },
            history: [
                new HumanMessage({
                    content: "当前用户输入",
                    additional_kwargs: {
                        messageId: "user-current",
                    },
                }),
            ],
            watchedVariables: {},
        }));

        expect(preparedRun.persistedMessages.appendBeforeMessageId).toBe("user-current");
        expect(preparedRun.persistedMessages.append.map((message) => message.message.text)).toEqual([
            "watch:undefined->novel-ide",
        ]);
        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            "dynamic",
            "watch:undefined->novel-ide",
            "当前用户输入",
        ]);
    });

    it("continue 无尾部用户输入时不会伪造当前输入", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedUser("你好"),
                persistedAssistant("你好，有什么可以帮你？"),
            ],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            "你好",
            "你好，有什么可以帮你？",
            "dynamic",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => message.message._getType())).toEqual([
            "system",
        ]);
    });

    it("<Message> 内部可以嵌套 SkillCatalog string", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: HistorySet({
                children: Message({
                    role: "system",
                    children: SkillCatalog({text: "catalog"}),
                }),
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual(["catalog"]);
    });

    it("Reminder 会在 AppendingSet 中持久化追加，并位于当前用户输入之前", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: [
                    Reminder({
                        id: "mode",
                        children: Message({
                            role: "system",
                            children: "当前是 Plan Mode",
                        }),
                    }),
                    Message({
                        role: "human",
                        source: "input",
                        children: "direct input",
                    }),
                ],
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [
                persistedUser("当前是什么模式"),
            ],
            runtimeInput: {
                mode: "continue",
            },
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "当前是 Plan Mode",
            "当前是什么模式",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => ({
            role: message.message._getType(),
            content: message.message.text,
        }))).toEqual([{
            role: "system",
            content: "当前是 Plan Mode",
        }]);
    });

    it("Reminder children 为空时不会产生空消息", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: Reminder({
                    id: "empty",
                    children: Message({
                        role: "system",
                        children: "",
                    }),
                }),
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [],
        }));

        expect(preparedRun.modelMessages).toEqual([]);
        expect(allPersistedMessages(preparedRun)).toEqual([]);
    });

    it("Reminder 支持变量变化和周期性重复注入", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: Reminder({
                    id: "workspace",
                    watchPath: "scope.studio.workspace",
                    repeatEveryTurns: 2,
                    children: Message({
                        role: "system",
                        children: "workspace reminder",
                    }),
                }),
            }),
        }));
        const changed = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("一")],
            runtimeInput: {
                mode: "continue",
            },
            reminders: {
                workspace: {
                    fingerprint: "\"old\"",
                    injectedAtTurn: 1,
                },
            },
        }));
        const unchangedTooSoon = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("一"), persistedAssistant("二"), persistedUser("三")],
            runtimeInput: {
                mode: "continue",
            },
            reminders: {
                workspace: {
                    fingerprint: "\"novel-ide\"",
                    injectedAtTurn: 1,
                },
            },
        }));
        const repeated = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("一"), persistedAssistant("二"), persistedUser("三"), persistedAssistant("四"), persistedUser("五")],
            runtimeInput: {
                mode: "continue",
            },
            reminders: {
                workspace: {
                    fingerprint: "\"novel-ide\"",
                    injectedAtTurn: 1,
                },
            },
        }));

        expect(changed.modelMessages.map((message) => message.text)).toEqual([
            "workspace reminder",
            "一",
        ]);
        expect(unchangedTooSoon.modelMessages.map((message) => message.text)).toEqual([
            "一",
            "二",
            "三",
        ]);
        expect(repeated.modelMessages.map((message) => message.text)).toEqual([
            "一",
            "二",
            "三",
            "四",
            "workspace reminder",
            "五",
        ]);
        expect(changed.immediateMetadata.reminders?.workspace).toMatchObject({
            fingerprint: "\"novel-ide\"",
            injectedAtTurn: 1,
        });
        expect(unchangedTooSoon.completedMetadata.reminders).toBeUndefined();
        expect(repeated.immediateMetadata.reminders?.workspace).toMatchObject({
            fingerprint: "\"novel-ide\"",
            injectedAtTurn: 3,
        });
        expect(changed.completedMetadata.reminders).toBeUndefined();
        expect(repeated.completedMetadata.reminders).toBeUndefined();
    });

    it("Reminder 支持稳定 watchValue", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: Reminder({
                    id: "tasks",
                    watchValue: {
                        title: "当前任务",
                        steps: ["id: a | status: in_progress | text: 执行"],
                    },
                    repeatEveryTurns: 5,
                    children: Message({
                        role: "system",
                        children: "task reminder",
                    }),
                }),
            }),
        }));
        const firstRun = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("一")],
            runtimeInput: {
                mode: "continue",
            },
        }));
        const secondRun = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("一"), persistedAssistant("二"), persistedUser("三")],
            runtimeInput: {
                mode: "continue",
            },
            reminders: firstRun.immediateMetadata.reminders,
        }));

        expect(firstRun.modelMessages.map((message) => message.text)).toEqual([
            "task reminder",
            "一",
        ]);
        expect(secondRun.modelMessages.map((message) => message.text)).toEqual([
            "一",
            "二",
            "三",
        ]);
    });

    it("无 watch/repeat 的 workspace guardrail completed 后下一轮仍然注入", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: Reminder({
                    id: "workspace",
                    when: true,
                    children: Message({
                        role: "system",
                        children: "workspace reminder",
                    }),
                }),
            }),
        }));
        const firstRun = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("第一轮")],
            runtimeInput: {
                mode: "continue",
            },
            reminders: {},
        }));
        const secondRun = await profile.prepare(createRuntime({
            profile,
            history: [persistedUser("第一轮"), persistedAssistant("第一轮 AI"), persistedUser("第二轮")],
            runtimeInput: {
                mode: "continue",
            },
            reminders: firstRun.completedMetadata.reminders,
        }));

        expect(firstRun.modelMessages.map((message) => message.text)).toContain("workspace reminder");
        expect(firstRun.completedMetadata.reminders).toBeUndefined();
        expect(secondRun.modelMessages.map((message) => message.text)).toContain("workspace reminder");
        expect(secondRun.completedMetadata.reminders).toBeUndefined();
    });

    it("会在 dynamic 与 input 之间插入显式 $skill 的自动激活内容", async () => {
        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-activated-skill-"));
        createdWorkspacePaths.push(workspacePath);
        const skillPath = path.join(workspacePath, "Writer", "SKILL.md");
        await fs.mkdir(path.dirname(skillPath), {recursive: true});
        await fs.writeFile(skillPath, [
            "---",
            "name: Writer",
            "description: 写作",
            "when_to_use:",
            "  - 用户显式要求写作",
            "---",
            "# Writer",
            "",
            "Use this skill to write.",
        ].join("\n"), "utf-8");

        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            prompt: "please use $Writer now",
            skillCatalog: [{
                name: "Writer",
                description: "写作",
                whenToUse: "用户显式要求写作",
                headerText: "name: Writer\ndescription: 写作\nwhen_to_use:\n  - 用户显式要求写作",
                location: skillPath,
            }],
            tools: ["read_file", "skill"],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            expect.stringContaining("name: Writer"),
            "history",
            "dynamic",
            expect.stringContaining("【显式激活 Skill】"),
            "input:please use $Writer now",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => message.message._getType())).toEqual([
            "system",
            "system",
            "human",
            "human",
        ]);
    });

    it("旧 system_prompt 历史不匹配当前 HistorySet 时也不会补齐稳定提示", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            history: [
                new SystemMessage({
                    content: "persisted-system",
                    additional_kwargs: {
                        messageOrigin: "system_prompt",
                    },
                }),
                new HumanMessage("history"),
            ],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "persisted-system",
            "history",
            "dynamic",
            "input:hello",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => message.message._getType())).toEqual([
            "human",
        ]);
        expect(preparedRun.persistedMessages.prepend).toEqual([]);
        expect(preparedRun.persistedMessages.append.map((message) => message.message.text)).toEqual([
            "input:hello",
        ]);
    });

    it("已有完整 HistorySet 前缀时不会重复写入新的 system prompt", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            history: [
                new SystemMessage("system"),
                new HumanMessage("history"),
            ],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            "history",
            "dynamic",
            "input:hello",
        ]);
        expect(allPersistedMessages(preparedRun).map((message) => message.message._getType())).toEqual([
            "human",
        ]);
        expect(preparedRun.persistedMessages.prepend).toEqual([]);
        expect(preparedRun.persistedMessages.append.map((message) => message.message.text)).toEqual([
            "input:hello",
        ]);
    });

    it("已有部分 HistorySet 前缀时不会在本轮补齐缺失的 SkillCatalog", async () => {
        const profile = new CustomSimpleProfile((ctx) => ProfilePrompt({
            children: HistorySet({
                children: [
                    Message({
                        role: "system",
                        children: "system",
                    }),
                    Message({
                        role: "system",
                        children: "catalog",
                    }),
                ],
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            history: [
                new SystemMessage("system"),
                new HumanMessage("history"),
            ],
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "system",
            "history",
        ]);
        expect(preparedRun.persistedMessages.prepend).toEqual([]);
        expect(preparedRun.persistedMessages.append).toEqual([]);
    });

    it("已有 system 历史时 Watch 生成的 system 消息仍然追加到当前光标", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            history: [
                new SystemMessage("system"),
                new HumanMessage("history"),
            ],
            watchedVariables: {
                "scope.studio.workspace": {
                    fingerprint: "\"old-workspace\"",
                    value: "old-workspace",
                },
            },
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toContain("watch:old-workspace->novel-ide");
        expect(preparedRun.persistedMessages.prepend).toEqual([]);
        expect(preparedRun.persistedMessages.append.map((message) => ({
            role: message.message._getType(),
            content: message.message.text,
        }))).toEqual([
            {
                role: "system",
                content: "watch:old-workspace->novel-ide",
            },
            {
                role: "human",
                content: "input:hello",
            },
        ]);
    });

    it("watched variable 首次观察到有效值时会插入变化消息", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({
            watchedVariables: {},
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toContain("watch:undefined->novel-ide");
        expect(allPersistedMessages(preparedRun).some((message) => (
            message.message.additional_kwargs.systemMessageKind === "variable_change"
            && message.message.text === "watch:undefined->novel-ide"
        ))).toBe(true);
        expect(preparedRun.immediateMetadata.watchedVariables?.["scope.studio.workspace"]).toMatchObject({
            fingerprint: "\"novel-ide\"",
            hasValue: true,
            value: "novel-ide",
        });
    });

    it("watched variable 首次观察到 undefined 时只记录 baseline", async () => {
        const profile = new CustomSimpleProfile(() => ProfilePrompt({
            children: AppendingSet({
                children: Watch({
                    path: "scope.studio.extra.missing",
                    render: ({previousValue, currentValue}) => Message({
                        role: "system",
                        children: `missing:${String(previousValue)}->${String(currentValue)}`,
                    }),
                }),
            }),
        }));
        const preparedRun = await profile.prepare(createRuntime({
            profile,
            watchedVariables: {},
        }));

        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "history",
        ]);
        expect(allPersistedMessages(preparedRun)).toEqual([]);
        expect(preparedRun.immediateMetadata.watchedVariables?.["scope.studio.extra.missing"]).toMatchObject({
            fingerprint: "__undefined__",
            hasValue: false,
            value: null,
        });
    });

    it("未渲染 ActivatedSkills 时不会读取显式提及 skill 的文件", async () => {
        const profile = new CustomSimpleProfile((ctx) => ProfilePrompt({
            children: [
                HistorySet({
                    children: Message({
                        role: "system",
                        children: "system",
                    }),
                }),
                AppendingSet({
                    children: Message({
                        role: "human",
                        source: "input",
                        children: "no activated skill render",
                    }),
                }),
            ],
        }));

        await expect(profile.prepare(createRuntime({
            profile,
            prompt: "please use $MissingFileSkill",
            skillCatalog: [{
                name: "MissingFileSkill",
                description: "不存在的 skill 文件",
                headerText: "name: MissingFileSkill\ndescription: 不存在的 skill 文件",
                location: "C:\\missing\\MissingFileSkill\\SKILL.md",
            }],
        }))).resolves.toMatchObject({
            modelMessages: expect.any(Array),
        });
    });

    it("watched variable 指纹不变时不会重复插入变化消息", async () => {
        const profile = new TestSimpleProfile();
        const preparedRun = await profile.prepare(createRuntime({}));

        expect(preparedRun.modelMessages.map((message) => message.text)).not.toContain("watch:undefined->novel-ide");
        expect(allPersistedMessages(preparedRun).some((message) => (
            message.message.additional_kwargs.systemMessageKind === "variable_change"
        ))).toBe(false);
    });

    it("watched variable 会区分旧值 undefined 与 null", async () => {
        const profile = new TestSimpleProfile();
        const fromUndefined = await profile.prepare(createRuntime({
            watchedVariables: {
                "scope.studio.workspace": {
                    fingerprint: "__undefined__",
                    value: null,
                },
            },
        }));
        const fromNull = await profile.prepare(createRuntime({
            watchedVariables: {
                "scope.studio.workspace": {
                    fingerprint: "null",
                    value: null,
                },
            },
        }));

        expect(fromUndefined.modelMessages.map((message) => message.text)).toContain("watch:undefined->novel-ide");
        expect(fromNull.modelMessages.map((message) => message.text)).toContain("watch:null->novel-ide");
        expect(fromUndefined.immediateMetadata.watchedVariables?.["scope.studio.workspace"]).toMatchObject({
            fingerprint: "\"novel-ide\"",
            hasValue: true,
            value: "novel-ide",
        });
    });
});
