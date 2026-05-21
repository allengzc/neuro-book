import fs from "node:fs/promises";
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage} from "@langchain/core/messages";
import {describe, expect, it} from "vitest";
import {ComplexPromptTestProfile} from "nbook/server/agent/profiles/test/complex-prompt-test.profile";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {
    AgentSubagentVariables,
    AgentTaskVariables,
    ProfileInputMap,
    RunOptions,
    JsonObject,
    SkillCatalogItem,
    ToolKey,
    WatchedVariableBaseline,
} from "nbook/server/agent/types";

type MessageSnapshot = {
    role: string;
    text: string;
};

type ExpectedRoundMessages = {
    modelMessages: MessageSnapshot[];
    persistedPrepend: MessageSnapshot[];
    persistedAppend: MessageSnapshot[];
};

const TEST_SKILL_CATALOG: readonly SkillCatalogItem[] = [{
    name: "Writer",
    description: "写作技能",
    whenToUse: "用户显式要求写作",
    headerText: "name: Writer\ndescription: 写作技能\nwhen_to_use: 用户显式要求写作",
    location: "assets/agent/skills/Writer/SKILL.md",
}];
const TEST_ACTIVATED_SKILL_CATALOG: readonly SkillCatalogItem[] = [{
    name: "爽文",
    description: "通用商业网文节奏指导。用于设计或校验开局、危机推进、主角能动性、期待管理、低谷压迫、爽点释放、奖励兑现和章末钩子；不绑定任何固定题材、性别设定、世界观或流派。",
    headerText: "name: 爽文\ndescription: 通用商业网文节奏指导。用于设计或校验开局、危机推进、主角能动性、期待管理、低谷压迫、爽点释放、奖励兑现和章末钩子；不绑定任何固定题材、性别设定、世界观或流派。",
    location: "assets/agent/skills/爽文/SKILL.md",
}];

describe("ComplexPromptTestProfile prepare Message[]", () => {
    it.skip("round 1 prompt 模式会生成 fixture 中定义的消息序列", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-1-prompt.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "prompt",
                prompt: "第一轮：请用 $爽文 继续处理剧情",
            },
            currentChapterLabel: "第二章",
            watchedVariables: {
                "scope.studio.currentChapterLabel": {
                    fingerprint: "\"第一章\"",
                    hasValue: true,
                    value: "第一章",
                },
            },
            skillCatalog: TEST_ACTIVATED_SKILL_CATALOG,
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
        expect(preparedRun.immediateMetadata.watchedVariables?.["scope.studio.currentChapterLabel"]).toMatchObject({
            fingerprint: "\"第二章\"",
            hasValue: true,
            value: "第二章",
        });
        expect(preparedRun.immediateMetadata.reminders?.workspace).toMatchObject({
            fingerprint: "\"workspace/silver-dragon-hime\"",
            injectedAtTurn: 0,
        });
        expect(preparedRun.completedMetadata.watchedVariables).toBeUndefined();
        expect(preparedRun.completedMetadata.reminders).toBeUndefined();
    });

    it.skip("round 2 continue 模式会在尾部用户输入前插入运行期上下文", async () => {
        const profile = new ComplexPromptTestProfile();
        const round1 = await readExpectedMessages("round-1-prompt.messages.json");
        const expected = await readExpectedMessages("round-2-continue.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                ...toHistoryMessages([
                    ...round1.persistedPrepend,
                    ...round1.persistedAppend,
                ]),
                persistedAssistant("第一轮 AI：建议从冲突升级开始"),
                persistedUser("第二轮：请用 $爽文 继续细化"),
            ],
            currentChapterLabel: "第三章",
            watchedVariables: {
                "scope.studio.currentChapterLabel": {
                    fingerprint: "\"第二章\"",
                    hasValue: true,
                    value: "第二章",
                },
            },
            skillCatalog: TEST_ACTIVATED_SKILL_CATALOG,
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 3 prompt 模式会跳过所有 false 条件分支", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-3-minimal-prompt.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "prompt",
                prompt: "第三轮：普通输入",
            },
            tools: [],
            skillCatalog: [],
            workspace: null,
            currentChapterLabel: null,
            watchedVariables: {},
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 4 continue 尾部不是用户输入时不会挪动当前输入", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-4-continue-no-tail-user.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("第四轮历史用户"),
                persistedAssistant("第四轮历史 AI"),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: [],
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 5 cancel 后 continue 会保留 interrupted tool 历史", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-5-cancel-continue.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("取消场景：读取资料"),
                persistedAssistantToolCall(),
                persistedInterruptedTool(),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: [],
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 6 cancel 后新用户输入会追加新的 input message", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-6-cancel-new-input.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "prompt",
                prompt: "取消后新问题",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("取消场景：读取资料"),
                persistedAssistantToolCall(),
                persistedInterruptedTool(),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: [],
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it.skip("round 7 编辑用户消息后会使用编辑后的 active path", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-7-edit-user-branch.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("编辑后的问题：请用 $爽文 改写"),
            ],
            currentChapterLabel: "第二章",
            watchedVariables: {
                "scope.studio.currentChapterLabel": {
                    fingerprint: "\"第一章\"",
                    hasValue: true,
                    value: "第一章",
                },
            },
            skillCatalog: TEST_ACTIVATED_SKILL_CATALOG,
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it.skip("round 8 刷新 assistant 后会从最近 user 继续", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-8-refresh-assistant.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("刷新目标用户：请用 $爽文 重答"),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: TEST_ACTIVATED_SKILL_CATALOG,
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 9 回退到 assistant 时尾部 AI 会作为历史保留", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-9-rollback-assistant.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("回退前用户问题"),
                persistedAssistant("回退后保留的 AI 回答"),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: [],
            tools: [],
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 10 回退到 user 时尾部用户会作为当前输入", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-10-rollback-user.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("回退到用户问题"),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: [],
            tools: [],
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: undefined,
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

    it("round 11 cancel 后 continue 会重新注入未消费的 plan reminder", async () => {
        const profile = new ComplexPromptTestProfile();
        const expected = await readExpectedMessages("round-11-plan-cancel-continue.messages.json");
        const preparedRun = await profile.prepare(await createRuntime({
            profile,
            runtimeInput: {
                mode: "continue",
            },
            history: [
                persistedSystem("complex system prompt"),
                persistedUser("Plan Mode 取消场景：先规划"),
                persistedAssistantToolCall(),
                persistedInterruptedTool(),
                persistedUser("继续刚才的 plan"),
            ],
            currentChapterLabel: null,
            watchedVariables: {},
            skillCatalog: [],
            workspace: null,
            tasks: null,
            subagents: [],
            planModeReminder: "sparse",
            studioExtra: {},
        }));

        expect(snapshotMessages(preparedRun.modelMessages)).toEqual(expected.modelMessages);
        expect(snapshotMessages(preparedRun.persistedMessages.prepend.map((message) => message.message))).toEqual(expected.persistedPrepend);
        expect(snapshotMessages(preparedRun.persistedMessages.append.map((message) => message.message))).toEqual(expected.persistedAppend);
    });

});

function snapshotMessages(messages: BaseMessage[]): MessageSnapshot[] {
    return messages.map((message) => ({
        role: message._getType(),
        text: message.text.replaceAll("\r\n", "\n"),
    }));
}

async function readExpectedMessages(fileName: string): Promise<ExpectedRoundMessages> {
    const content = await fs.readFile(`server/agent/profiles/test/fixtures/${fileName}`, "utf-8");
    return JSON.parse(content) as ExpectedRoundMessages;
}

function toHistoryMessages(messages: MessageSnapshot[]): BaseMessage[] {
    return messages.map((message) => {
        if (message.role === "system") {
            return persistedSystem(message.text);
        }
        if (message.role === "ai" || message.role === "assistant") {
            return persistedAssistant(message.text);
        }
        return persistedUser(message.text);
    });
}

function persistedSystem(content: string): SystemMessage {
    return new SystemMessage({
        content,
        additional_kwargs: {
            messageOrigin: "system_prompt",
        },
    });
}

function persistedUser(content: string): HumanMessage {
    return new HumanMessage({
        content,
        additional_kwargs: {
            messageOrigin: "user_input",
        },
    });
}

function persistedAssistant(content: string): AIMessage {
    return new AIMessage({
        content,
        additional_kwargs: {
            messageOrigin: "assistant_output",
        },
    });
}

function persistedAssistantToolCall(): AIMessage {
    return new AIMessage({
        content: "",
        additional_kwargs: {
            messageOrigin: "assistant_output",
        },
        tool_calls: [{
            id: "tool-call-canceled",
            name: "read_file",
            args: {
                filePath: "workspace/chapter.md",
            },
            type: "tool_call",
        }],
    });
}

function persistedInterruptedTool(): ToolMessage {
    return new ToolMessage({
        content: "Tool call canceled by user before it returned.",
        tool_call_id: "tool-call-canceled",
        name: "read_file",
        status: "error",
        additional_kwargs: {
            messageOrigin: "tool_result",
            assistantMessageId: "assistant-canceled",
        },
    });
}

async function createRuntime(input: {
    profile: AgentProfile<"leader.default">;
    runtimeInput: ProfileInputMap["leader.default"];
    currentChapterLabel: string | null;
    watchedVariables: Record<string, WatchedVariableBaseline>;
    history?: BaseMessage[];
    skillCatalog?: readonly SkillCatalogItem[];
    tools?: readonly ToolKey[];
    workspace?: string | null;
    tasks?: AgentTaskVariables | null;
    subagents?: readonly AgentSubagentVariables[];
    planModeReminder?: RunOptions["planModeReminder"];
    studioExtra?: JsonObject;
}): Promise<ProfileContextRuntime<"leader.default">> {
    const tasks: AgentTaskVariables | null = input.tasks === undefined ? {
        title: "推进剧情测试",
        updatedAt: "2026-05-05T00:00:00.000Z",
        steps: [{
            id: "task-active",
            text: "整理第二章冲突",
            status: "in_progress",
            note: "需要保持伏笔连续",
            updatedAt: "2026-05-05T00:00:00.000Z",
        }],
    } : input.tasks;
    const subagents: readonly AgentSubagentVariables[] = input.subagents ?? [{
        id: "thread-writer",
        title: "Writer subagent",
        profileKey: "subagent.writer",
        status: "running",
    }];
    const skillCatalog = input.skillCatalog ?? TEST_ACTIVATED_SKILL_CATALOG;
    const planModeReminder: RunOptions["planModeReminder"] = Object.hasOwn(input, "planModeReminder")
        ? input.planModeReminder
        : "full";

    return {
        thread: createThreadRecord({
            profileKey: input.profile.key,
            kind: input.profile.kind,
            metadata: {
                watchedVariables: input.watchedVariables,
            },
        }),
        profile: input.profile,
        input: input.runtimeInput,
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
                currentChapterLabel: input.currentChapterLabel,
                previousChapterLabel: null,
                workspace: input.workspace === undefined ? "workspace/silver-dragon-hime" : input.workspace,
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: null,
                extra: input.studioExtra ?? {
                    selectedStoryThreadId: "thread-main",
                    selectedStorySceneId: "scene-opening",
                },
            },
            agent: {
                thread: {
                    id: "thread-1",
                    title: "测试线程",
                    summary: "",
                    status: "idle",
                },
                profileKey: input.profile.key,
                kind: input.profile.kind,
                tools: input.tools ?? [
                    "read_file",
                    "skill",
                    "execute_shell",
                ],
                subagents,
                tasks,
            },
            input: input.runtimeInput,
        },
        skillCatalog,
        options: {
            planModeReminder,
        },
        messageStore: {} as never,
        loadHistoryMessages: async () => input.history ?? [],
        threadRepository: {} as never,
        variableStore: {} as never,
    };
}
