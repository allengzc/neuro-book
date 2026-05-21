import type {BaseMessage} from "@langchain/core/messages";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {describe, expect, it, vi} from "vitest";
vi.mock("nbook/server/agent/repositories/prisma-thread.repository", () => ({
    PrismaThreadRepository: class PrismaThreadRepository {},
}));
vi.mock("nbook/server/agent/messages/prisma-agent-message-store", () => ({
    PrismaAgentMessageStore: class PrismaAgentMessageStore {},
}));
vi.mock("nbook/server/utils/prisma", () => ({
    prisma: {},
}));
import {AgentSystem} from "nbook/server/agent/agent-system";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import {InMemoryAgentProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import {
    AppendingSet,
    ProfilePrompt,
    Reminder,
    SimpleProfile,
    type ProfilePromptContext,
} from "nbook/server/agent/profiles/simple-profile";
import {Message} from "nbook/server/agent/prompts";
import {InMemoryAgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {LiveRunRegistry} from "nbook/server/agent/runtime/live-run-registry";
import {AgentVariableStore} from "nbook/server/agent/store/agent-variable-store";
import {ThreadTaskService} from "nbook/server/agent/services/thread-task.service";
import {createAgentMessage, createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {
    AgentMessageStore,
} from "nbook/server/agent/messages/agent-message-store";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {
    AgentThreadRecord,
    AgentVariableScope,
    AnySubAgentInput,
    AgentMessage,
    CreateLeaderThreadInput,
    SubAgentThreadSummary,
    ThreadSummary,
} from "nbook/server/agent/types";
import {LeaderInputSchema, WriterInputSchema} from "nbook/server/agent/types";

class TestLeaderProfile extends AgentProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "测试 Leader";
    readonly inputSchema = LeaderInputSchema;
    readonly allowedToolKeys = [];

    async prepare(_runtime: ProfileContextRuntime<"leader.default">) {
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

class TestWriterProfile extends AgentProfile<"subagent.writer"> {
    readonly key = "subagent.writer";
    readonly kind = "subagent" as const;
    readonly name = "测试 Writer";
    readonly inputSchema = WriterInputSchema;
    readonly allowedToolKeys = [];

    async prepare(_runtime: ProfileContextRuntime<"subagent.writer">) {
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

/**
 * 创建最小线程摘要。
 */
function toSummary(record: AgentThreadRecord): ThreadSummary {
    return {
        id: String(record.id),
        kind: record.kind,
        profileKey: record.profileKey as AgentThreadRecord["profileKey"] & ThreadSummary["profileKey"],
        title: record.title,
        summary: record.lastMessagePreview,
        status: record.runStatus,
        modelOverride: record.metadata.modelOverride ?? null,
        modelOverrideKey: record.metadata.modelOverrideKey ?? null,
        usageSummary: null,
        pendingUserInputSession: record.metadata.pendingUserInputSession ?? null,
        planMode: record.metadata.planMode ?? null,
        lastMessageAt: record.lastMessageAt,
    };
}

class RuntimeReminderProfile extends SimpleProfile<"leader.default"> {
    readonly key = "leader.default";
    readonly kind = "leader" as const;
    readonly name = "运行期 Reminder 测试";
    readonly inputSchema = z.union([
        z.object({
            mode: z.literal("prompt"),
            prompt: z.string().min(1),
        }),
        z.object({
            mode: z.literal("continue"),
        }),
    ]);
    readonly allowedToolKeys = [];

    /**
     * 只渲染运行期 reminder，便于 AgentSystem 生命周期测试。
     */
    protected override async buildPrompt(ctx: ProfilePromptContext<"leader.default">) {
        const workspace = ctx.scope.studio.workspace ?? "";
        return ProfilePrompt({
            children: AppendingSet({
                children: [
                    Reminder({
                        id: "workspace",
                        when: Boolean(workspace),
                        watchPath: "scope.studio.workspace",
                        repeatEveryTurns: 5,
                        children: Message({
                            role: "system",
                            children: `workspace reminder: ${workspace}`,
                        }),
                    }),
                    ctx.runtime.options.planModeReminder
                        ? Reminder({
                            id: "plan-mode",
                            children: Message({
                                role: "system",
                                children: `plan reminder: ${ctx.runtime.options.planModeReminder}`,
                            }),
                        })
                        : null,
                ],
            }),
        });
    }
}

class TestAssetsProfile extends AgentProfile<"leader.assets"> {
    readonly key = "leader.assets";
    readonly kind = "leader" as const;
    readonly name = "Assets";
    readonly inputSchema = LeaderInputSchema;
    readonly allowedToolKeys = [];

    async prepare(_runtime: ProfileContextRuntime<"leader.assets">) {
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

class TestCustomLeaderProfile extends AgentProfile<"leader.custom"> {
    readonly key = "leader.custom";
    readonly kind = "leader" as const;
    readonly name = "Custom";
    readonly inputSchema = LeaderInputSchema;
    readonly allowedToolKeys = [];

    async prepare(_runtime: ProfileContextRuntime<"leader.custom">) {
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

/**
 * 内存线程仓储。
 */
function createThreadRepository(): ThreadRepository {
    const records = new Map<string, AgentThreadRecord>();
    const subagentsByLeader = new Map<string, Set<string>>();
    let nextId = 1;

    const persist = (record: AgentThreadRecord): AgentThreadRecord => {
        records.set(String(record.id), record);
        return record;
    };

    return {
        async createLeader(input: CreateLeaderThreadInput) {
            return persist(createThreadRecord({
                id: nextId++,
                kind: "leader",
                profileKey: input.profileKey ?? "leader.default",
                title: input.title ?? "新建线程",
            }));
        },
        async createSubAgent(input) {
            return persist(createThreadRecord({
                id: nextId++,
                kind: "subagent",
                profileKey: input.profileKey,
                title: input.title ?? "新建 Subagent",
            }));
        },
        async listThreads(input = {}) {
            return [...records.values()]
                .filter((record) => !input.kind || record.kind === input.kind)
                .filter((record) => !input.profileKey || record.profileKey === input.profileKey)
                .map(toSummary);
        },
        async findById(threadId) {
            return records.get(String(threadId)) ?? null;
        },
        async delete(threadId) {
            records.delete(String(threadId));
            subagentsByLeader.delete(String(threadId));
            for (const subagents of subagentsByLeader.values()) {
                subagents.delete(String(threadId));
            }
        },
        async attachSubAgent(leaderThreadId, subAgentThreadId) {
            const subagents = subagentsByLeader.get(String(leaderThreadId)) ?? new Set<string>();
            subagents.add(String(subAgentThreadId));
            subagentsByLeader.set(String(leaderThreadId), subagents);
        },
        async listSubAgents(leaderThreadId) {
            const subagents = subagentsByLeader.get(String(leaderThreadId)) ?? new Set<string>();
            return [...subagents]
                .map((threadId) => records.get(threadId))
                .filter((record): record is AgentThreadRecord => Boolean(record))
                .map((record) => ({
                    ...toSummary(record),
                    profileKey: record.profileKey as SubAgentThreadSummary["profileKey"],
                }));
        },
        async listManagingLeaders(subAgentThreadId) {
            const leaders: ThreadSummary[] = [];
            for (const [leaderThreadId, subagents] of subagentsByLeader.entries()) {
                if (!subagents.has(String(subAgentThreadId))) {
                    continue;
                }
                const record = records.get(leaderThreadId);
                if (record) {
                    leaders.push(toSummary(record));
                }
            }
            return leaders;
        },
        async assertLeaderManagesSubAgent(leaderThreadId, subAgentThreadId) {
            const subagents = subagentsByLeader.get(String(leaderThreadId));
            if (!subagents?.has(String(subAgentThreadId))) {
                throw new Error("leader 不管理该 subagent");
            }
        },
        async updateRunStatus(threadId, status) {
            const record = records.get(String(threadId));
            if (!record) {
                throw new Error("thread 不存在");
            }
            return persist({
                ...record,
                runStatus: status,
            });
        },
        async updateMetadata(threadId, metadata) {
            const record = records.get(String(threadId));
            if (!record) {
                throw new Error("thread 不存在");
            }
            return persist({
                ...record,
                metadata,
            });
        },
        async touchAfterRun(threadId, input) {
            const record = records.get(String(threadId));
            if (!record) {
                throw new Error("thread 不存在");
            }
            return persist({
                ...record,
                runStatus: input.status,
                lastMessagePreview: input.summary,
                metadata: input.metadata ?? record.metadata,
            });
        },
    };
}

/**
 * 构造一个可测试的 AgentSystem。
 */
function createAgentSystemHarness(leaderProfile: AgentProfile<"leader.default"> = new TestLeaderProfile()) {
    const profileRegistry = new InMemoryAgentProfileRegistry();
    profileRegistry.register(leaderProfile);
    profileRegistry.register(new TestAssetsProfile());
    profileRegistry.register(new TestCustomLeaderProfile());
    profileRegistry.register(new TestWriterProfile());
    const toolRegistry = new InMemoryAgentToolRegistry();
    const threadRepository = createThreadRepository();
    const liveRuns = new LiveRunRegistry();
    const variableStore = new AgentVariableStore();
    const messageStore = {
        deleteThread: vi.fn(async () => {}),
        loadBranchMessages: vi.fn(async () => [createAgentMessage()]),
    } as unknown as AgentMessageStore;
    const historyMessages: AgentMessage[] = [];
    const threadMessages = {
        loadThreadHistory: vi.fn(async () => [...historyMessages]),
        persistToolMessage: vi.fn(async (_threadId: string, _message: {text: string}, _status: "success" | "error") => {}),
    };
    const threadProjection = {
        getThreadDetail: vi.fn(),
        getThreadSnapshot: vi.fn(),
        enrichThreadSummary: vi.fn(async (summary: ThreadSummary) => summary),
    };
    const threadRunCoordinator = {
        runThread: vi.fn(async (
            _thread: AgentThreadRecord,
            _runtime: ProfileContextRuntime<"leader.default">,
            _tools: unknown[],
            _session: unknown,
        ) => {}),
        collectActiveMessages: vi.fn(async () => [] as BaseMessage[]),
        collectSubAgentCompletion: vi.fn(async () => ({
            subagentThreadId: "2",
            status: "completed" as const,
            walkthrough: "done",
        })),
    };
    const threadContext = {
        syncClientVariables: vi.fn(async (threadId: string, clientVariables) => variableStore.syncClientVariables(threadId, clientVariables)),
        getThreadScope: vi.fn((threadId: string) => variableStore.getScope(threadId)),
        inheritClientScope: vi.fn(async () => {}),
        patchToolIdeScope: vi.fn((threadId: string, patch) => variableStore.patchIdeScope(threadId, patch)),
        patchToolStudioScope: vi.fn((threadId: string, patch) => variableStore.patchStudioScope(threadId, patch)),
        refreshThreadScope: vi.fn(async () => ({ide: {}, studio: {}, agent: {}, input: {}} as AgentVariableScope)),
        refreshThreadAgentScope: vi.fn(async () => ({ide: {}, studio: {}, agent: {}, input: {}} as AgentVariableScope)),
        resolveProfileTools: vi.fn(async () => []),
    };
    const threadEvents = {
        publish: vi.fn(),
        cleanup: vi.fn(),
        subscribe: vi.fn(async function* () {}),
    };
    const threadTasks = new ThreadTaskService(threadRepository);
    const skillCatalog = {
        list: vi.fn(async () => [] as Awaited<ReturnType<AgentSystem["skillCatalog"]["list"]>>),
    };

        const agentSystem = new AgentSystem(
            threadRepository,
            profileRegistry,
            toolRegistry,
            {} as never,
            {} as never,
            liveRuns,
            threadEvents as never,
            messageStore,
            variableStore,
            skillCatalog,
            threadMessages as never,
            {} as never,
            threadProjection as never,
            threadRunCoordinator as never,
            threadContext as never,
            threadTasks,
        );

    return {
        agentSystem,
        liveRuns,
        messageStore,
        historyMessages,
        threadContext,
        threadEvents,
        threadMessages,
        threadRepository,
        threadProjection,
        threadRunCoordinator,
        skillCatalog,
    };
}

describe("AgentSystem", () => {
    it("enterPlanMode 会写入线程级 Plan Mode 状态", async () => {
        const {agentSystem, threadContext, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });

        await agentSystem.enterPlanMode(leader.id);

        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).toEqual(expect.objectContaining({
            active: true,
            turnsSinceReminder: 0,
            reminderCount: 0,
            needsExitReminder: false,
            hasExited: false,
        }));
        expect(threadContext.refreshThreadAgentScope).toHaveBeenCalledWith(leader.id, expect.any(Object), "leader.default");
    });

    it("exitPlanMode 会标记下一轮退出提醒", async () => {
        const {agentSystem, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });

        await agentSystem.enterPlanMode(leader.id);
        await agentSystem.exitPlanMode(leader.id);

        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).toEqual(expect.objectContaining({
            active: false,
            needsExitReminder: true,
            hasExited: true,
        }));
    });

    it("dispatch 时只把 Plan Mode reminder 放进 runtime，不提前消费 metadata", async () => {
        const {agentSystem, threadRepository, threadRunCoordinator} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });
        await agentSystem.enterPlanMode(leader.id);

        await agentSystem.dispatchLeaderRun(leader.id, {
            mode: "prompt",
            prompt: "先做计划",
        });

        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).toEqual(expect.objectContaining({
            active: true,
            turnsSinceReminder: 0,
            reminderCount: 0,
        }));
        const runtime = vi.mocked(threadRunCoordinator.runThread).mock.calls[0]?.[1] as unknown as ProfileContextRuntime<"leader.default">;
        expect(runtime.options.planModeReminder).toBe("full");
        expect(runtime.options.planModeCommitMetadata?.planMode).toEqual(expect.objectContaining({
            active: true,
            turnsSinceReminder: 0,
            reminderCount: 1,
        }));
    });

    it("waiting_user 回答后 continue 会保留未消费的 runtime reminder", async () => {
        const {agentSystem, historyMessages, threadContext, threadRepository, threadRunCoordinator} = createAgentSystemHarness(new RuntimeReminderProfile());
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });
        historyMessages.push(
            createAgentMessage({
                id: "user-1",
                role: "user",
                content: "用户：请先做计划",
                rawAdditionalKwargs: {
                    userInput: true,
                },
            }),
            createAgentMessage({
                id: "assistant-1",
                role: "assistant",
                content: "需要确认一个问题",
            }),
        );
        await threadRepository.updateMetadata(leader.id, {
            planMode: {
                active: true,
                enteredAt: "2026-05-04T00:00:00.000Z",
                turnsSinceReminder: 0,
                reminderCount: 1,
                needsExitReminder: false,
                hasExited: false,
            },
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "继续吗？", options: [{label: "继续"}]}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");
        vi.mocked(threadContext.refreshThreadScope).mockResolvedValue({
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
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: null,
                extra: {},
            },
            agent: {
                thread: {
                    id: leader.id,
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
                mode: "continue",
            },
        } as AgentVariableScope);

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: 0,
            }],
        });

        const record = await threadRepository.findById(leader.id);
        const runtime = vi.mocked(threadRunCoordinator.runThread).mock.calls[0]?.[1] as ProfileContextRuntime<"leader.default">;
        const preparedRun = await runtime.profile.prepare(runtime);

        expect(record?.metadata.planMode).toEqual(expect.objectContaining({
            active: true,
            reminderCount: 1,
        }));
        expect(runtime.options.turn).toEqual({
            kind: "resume_turn",
            turnIndex: 1,
        });
        expect(runtime.options.planModeReminder).toBeUndefined();
        expect(preparedRun.modelMessages.map((message) => message.text)).toEqual([
            "用户：请先做计划",
            "需要确认一个问题",
            "workspace reminder: workspace/silver-dragon-hime",
        ]);
        expect(preparedRun.completedMetadata.reminders).toBeUndefined();
    });

    it("Plan Mode active reminder 按用户 Turn 每 10 轮注入一次", async () => {
        const {agentSystem, historyMessages, threadContext, threadRepository, threadRunCoordinator} = createAgentSystemHarness(new RuntimeReminderProfile());
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });
        await threadRepository.updateMetadata(leader.id, {
            planMode: {
                active: true,
                enteredAt: "2026-05-04T00:00:00.000Z",
                turnsSinceReminder: 9,
                reminderCount: 1,
                needsExitReminder: false,
                hasExited: false,
            },
        });
        vi.mocked(threadContext.refreshThreadScope).mockResolvedValue({
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
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: null,
                extra: {},
            },
            agent: {
                thread: {
                    id: leader.id,
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
                mode: "prompt",
                prompt: "第二轮请求",
            },
        } as AgentVariableScope);
        historyMessages.push(
            createAgentMessage({
                id: "user-2",
                role: "user",
                content: "第二轮请求",
                rawAdditionalKwargs: {
                    userInput: true,
                },
            }),
        );

        await agentSystem.dispatchLeaderRun(leader.id, {
            mode: "continue",
        });

        const runtime = vi.mocked(threadRunCoordinator.runThread).mock.calls[0]?.[1] as ProfileContextRuntime<"leader.default">;
        const preparedRun = await runtime.profile.prepare(runtime);

        expect(runtime.options.turn).toEqual({
            kind: "new_user_turn",
            turnIndex: 1,
            anchorMessageId: "user-2",
        });
        expect(runtime.options.planModeReminder).toBe("sparse");
        expect(preparedRun.modelMessages.map((message) => message.text)).toContain("plan reminder: sparse");
    });

    it("Plan Mode turn 计数会忽略 AppendingSet 生成的 human context", async () => {
        const {agentSystem, historyMessages, threadRepository, threadRunCoordinator} = createAgentSystemHarness(new RuntimeReminderProfile());
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });
        await threadRepository.updateMetadata(leader.id, {
            planMode: {
                active: true,
                enteredAt: "2026-05-04T00:00:00.000Z",
                turnsSinceReminder: 9,
                reminderCount: 1,
                needsExitReminder: false,
                hasExited: false,
            },
        });
        historyMessages.push(
            createAgentMessage({
                id: "user-1",
                role: "user",
                content: "第一轮用户请求",
                rawAdditionalKwargs: {
                    userInput: true,
                },
            }),
            createAgentMessage({
                id: "activated-skills-1",
                role: "user",
                content: "【显式激活 Skill】\nWriter",
            }),
            createAgentMessage({
                id: "assistant-1",
                role: "assistant",
                content: "第一轮回答",
            }),
            createAgentMessage({
                id: "user-2",
                role: "user",
                content: "第二轮用户请求",
                rawAdditionalKwargs: {
                    userInput: true,
                },
            }),
        );

        await agentSystem.dispatchLeaderRun(leader.id, {
            mode: "continue",
        });

        const runtime = vi.mocked(threadRunCoordinator.runThread).mock.calls[0]?.[1] as ProfileContextRuntime<"leader.default">;

        expect(runtime.options.turn).toEqual({
            kind: "new_user_turn",
            turnIndex: 2,
            anchorMessageId: "user-2",
        });
        expect(runtime.options.planModeReminder).toBe("sparse");
    });

    it("Plan Mode active reminder 在 task 全部完成后不再注入", async () => {
        const {agentSystem, historyMessages, threadRepository, threadRunCoordinator} = createAgentSystemHarness(new RuntimeReminderProfile());
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });
        await threadRepository.updateMetadata(leader.id, {
            tasks: {
                title: "实现计划",
                updatedAt: "2026-05-04T00:00:00.000Z",
                steps: [
                    {
                        id: "done",
                        text: "完成实现",
                        status: "completed",
                        updatedAt: "2026-05-04T00:00:00.000Z",
                    },
                ],
            },
            planMode: {
                active: true,
                enteredAt: "2026-05-04T00:00:00.000Z",
                turnsSinceReminder: 9,
                reminderCount: 1,
                needsExitReminder: false,
                hasExited: false,
            },
        });
        historyMessages.push(
            createAgentMessage({
                id: "user-2",
                role: "user",
                content: "第二轮用户请求",
                rawAdditionalKwargs: {
                    userInput: true,
                },
            }),
        );

        await agentSystem.dispatchLeaderRun(leader.id, {
            mode: "continue",
        });

        const runtime = vi.mocked(threadRunCoordinator.runThread).mock.calls[0]?.[1] as ProfileContextRuntime<"leader.default">;
        const record = await threadRepository.findById(leader.id);

        expect(runtime.options.planModeReminder).toBeUndefined();
        expect(record?.metadata.planMode?.turnsSinceReminder).toBe(9);
        expect(record?.metadata.planMode?.reminderCount).toBe(1);
    });

    it("Plan Mode 首次 reminder 不会被已完成 task 跳过", async () => {
        const {agentSystem, historyMessages, threadRepository, threadRunCoordinator} = createAgentSystemHarness(new RuntimeReminderProfile());
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });
        await threadRepository.updateMetadata(leader.id, {
            tasks: {
                title: "上一轮任务",
                updatedAt: "2026-05-04T00:00:00.000Z",
                steps: [
                    {
                        id: "done",
                        text: "上一轮已完成",
                        status: "completed",
                        updatedAt: "2026-05-04T00:00:00.000Z",
                    },
                ],
            },
            planMode: {
                active: true,
                enteredAt: "2026-05-04T00:00:00.000Z",
                turnsSinceReminder: 0,
                reminderCount: 0,
                needsExitReminder: false,
                hasExited: false,
            },
        });
        historyMessages.push(
            createAgentMessage({
                id: "user-2",
                role: "user",
                content: "第二轮用户请求",
                rawAdditionalKwargs: {
                    userInput: true,
                },
            }),
        );

        await agentSystem.dispatchLeaderRun(leader.id, {
            mode: "continue",
        });

        const runtime = vi.mocked(threadRunCoordinator.runThread).mock.calls[0]?.[1] as ProfileContextRuntime<"leader.default">;

        expect(runtime.options.planModeReminder).toBe("full");
    });

    it("createSubAgentThread 会创建、挂接并同步上下文", async () => {
        const {agentSystem, threadContext, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread({
            title: "Leader",
        });

        const subagent = await agentSystem.createSubAgentThread({
            leaderThreadId: leader.id,
            profileKey: "subagent.writer",
            title: "Writer",
        });

        const summaries = await threadRepository.listSubAgents(leader.id);
        expect(subagent.id).toBe("2");
        expect(summaries.map((item) => item.id)).toEqual(["2"]);
        expect(threadContext.inheritClientScope).toHaveBeenCalled();
        expect(threadContext.refreshThreadAgentScope).toHaveBeenCalledTimes(2);
    });

    it("syncClientVariables 会委托给 threadContext", async () => {
        const {agentSystem, threadContext} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();

        await agentSystem.syncClientVariables(leader.id, {
            ide: {
                theme: "sepia",
            },
        });

        expect(threadContext.syncClientVariables).toHaveBeenCalledWith(
            leader.id,
            {ide: {theme: "sepia"}},
            expect.objectContaining({id: 1}),
            "leader.default",
        );
    });

    it("createSubAgentThread 会把 leader 的 studio novelId 继承给 subagent", async () => {
        const {agentSystem, threadContext} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        await agentSystem.syncClientVariables(leader.id, {
            studio: {
                novelId: "1",
                workspace: "workspace/silver-dragon-hime",
                workspaceKind: "novel",
            },
        });

        const subagent = await agentSystem.createSubAgentThread({
            leaderThreadId: leader.id,
            profileKey: "subagent.writer",
        });

        expect(threadContext.inheritClientScope).toHaveBeenCalledWith(leader.id, subagent.id, expect.anything(), "subagent.writer");
    });

    it("listThreads 走轻量 summary 补全，不会退化为 detail 查询", async () => {
        const {agentSystem, threadProjection} = createAgentSystemHarness();
        await agentSystem.createLeaderThread({
            title: "Leader",
        });

        const result = await agentSystem.listThreads();

        expect(result).toHaveLength(1);
        expect(threadProjection.enrichThreadSummary).toHaveBeenCalledTimes(1);
        expect(threadProjection.getThreadDetail).not.toHaveBeenCalled();
    });

    it("leader.assets 线程会按 profileKey 创建并可独立列表查询", async () => {
        const {agentSystem} = createAgentSystemHarness();
        await agentSystem.createLeaderThread({
            title: "Novel Leader",
        });
        const assetsLeader = await agentSystem.createLeaderThread({
            profileKey: "leader.assets",
            title: "Assets Leader",
        });

        const assetsThreads = await agentSystem.listThreads({
            kind: "leader",
            profileKey: "leader.assets",
        });

        expect(assetsLeader.profileKey).toBe("leader.assets");
        expect(assetsThreads).toHaveLength(1);
        expect(assetsThreads[0]?.profileKey).toBe("leader.assets");
        expect(assetsThreads[0]?.title).toBe("Assets Leader");
    });

    it("createLeaderThread 未显式传 profileKey 时会读取 workspace 默认 profile", async () => {
        const {agentSystem, threadContext} = createAgentSystemHarness();
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-agent-profile-settings-"));
        await fs.mkdir(path.join(workspaceRoot, ".nbook"), {recursive: true});
        await fs.writeFile(path.join(workspaceRoot, ".nbook", "agent-profile-settings.json"), JSON.stringify({
            leader: {
                defaultProfileKey: "leader.custom",
            },
        }), "utf-8");

        try {
            const leader = await agentSystem.createLeaderThread({
                title: "Custom Leader",
                clientVariables: {
                    studio: {
                        workspace: workspaceRoot,
                        workspaceKind: "novel",
                    },
                },
            });

            expect(leader.profileKey).toBe("leader.custom");
            expect(threadContext.syncClientVariables).toHaveBeenCalledWith(
                leader.id,
                expect.objectContaining({
                    studio: expect.objectContaining({
                        workspace: workspaceRoot,
                    }),
                }),
                expect.objectContaining({profileKey: "leader.custom"}),
                "leader.custom",
            );
        } finally {
            await fs.rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("dispatchThreadRunById 会按线程类型分派到 leader 或 subagent", async () => {
        const {agentSystem} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const subagent = await agentSystem.createSubAgentThread({
            leaderThreadId: leader.id,
            profileKey: "subagent.writer",
        });
        const dispatchLeaderRun = vi.spyOn(agentSystem, "dispatchLeaderRun").mockResolvedValue();
        const dispatchDetachedSubAgent = vi.spyOn(agentSystem, "dispatchDetachedSubAgent").mockResolvedValue();

        await agentSystem.dispatchThreadRunById(leader.id, {prompt: "hello"});
        await agentSystem.dispatchThreadRunById(subagent.id, {
            prompt: "hello",
            plotPoints: ["p1"],
            lorebookEntries: [{path: "lorebook/test/"}],
        });

        expect(dispatchLeaderRun).toHaveBeenCalledWith(leader.id, {mode: "prompt", prompt: "hello"}, {});
        expect(dispatchDetachedSubAgent).toHaveBeenCalled();
    });

    it("dispatchLeaderRun 会打开 live run、发布 running 并交给 coordinator", async () => {
        const {agentSystem, liveRuns, threadContext, threadEvents, threadRunCoordinator} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();

        await agentSystem.dispatchLeaderRun(leader.id, {
            mode: "prompt",
            prompt: "hello",
        });

        expect(threadContext.refreshThreadScope).toHaveBeenCalled();
        expect(threadContext.resolveProfileTools).toHaveBeenCalled();
        expect(liveRuns.get(leader.id)?.snapshot.status).toBe("running");
        expect(threadEvents.publish).toHaveBeenCalledWith(leader.id, {
            type: "run_state",
            threadId: leader.id,
            status: "running",
        });
        expect(threadRunCoordinator.runThread).toHaveBeenCalledWith(
            expect.objectContaining({id: 1}),
            expect.objectContaining({
                input: {mode: "prompt", prompt: "hello"},
            }),
            [],
            expect.anything(),
        );
    });

    it("runLeader 会先派发运行，再收集新增消息", async () => {
        const {agentSystem, threadRunCoordinator} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const dispatchLeaderRun = vi.spyOn(agentSystem, "dispatchLeaderRun").mockResolvedValue();
        threadRunCoordinator.collectActiveMessages.mockResolvedValue(["done"] as never);

        const result = await agentSystem.runLeader(leader.id, {
            prompt: "hello",
        });

        expect(dispatchLeaderRun).toHaveBeenCalledWith(leader.id, {prompt: "hello"}, {});
        expect(result).toEqual(["done"]);
    });

    it("runSubAgent 会校验归属、继承上下文，并复用 runDetachedSubAgent", async () => {
        const {agentSystem, threadContext} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const subagent = await agentSystem.createSubAgentThread({
            leaderThreadId: leader.id,
            profileKey: "subagent.writer",
        });
        const runDetachedSubAgent = vi.spyOn(agentSystem, "runDetachedSubAgent").mockResolvedValue({
            subagentThreadId: subagent.id,
            status: "completed",
            walkthrough: "done",
        });
        const input: AnySubAgentInput = {
            prompt: "hello",
            plotPoints: ["p1"],
            lorebookEntries: [{path: "lorebook/test/"}],
        };

        const result = await agentSystem.runSubAgent(leader.id, subagent.id, input);

        expect(threadContext.inheritClientScope).toHaveBeenCalledWith(leader.id, subagent.id, expect.anything(), "subagent.writer");
        expect(runDetachedSubAgent).toHaveBeenCalledWith(subagent.id, input, {});
        expect(result.walkthrough).toBe("done");
    });

    it("runSubAgent 会把 subagent 运行失败原样抛回 leader", async () => {
        const {agentSystem} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const subagent = await agentSystem.createSubAgentThread({
            leaderThreadId: leader.id,
            profileKey: "subagent.writer",
        });
        const runDetachedSubAgent = vi.spyOn(agentSystem, "runDetachedSubAgent").mockRejectedValue(new Error("writer 无法解析 plotPoints[0] 场景 999"));
        const input: AnySubAgentInput = {
            prompt: "hello",
            plotPoints: ["999"],
            lorebookEntries: [{path: "lorebook/test/"}],
        };

        await expect(agentSystem.runSubAgent(leader.id, subagent.id, input)).rejects.toThrow("writer 无法解析 plotPoints[0] 场景 999");
        expect(runDetachedSubAgent).toHaveBeenCalledWith(subagent.id, input, {});
    });

    it("runSubAgent 不会把 leader 线程的 turn anchor 传给 subagent", async () => {
        const {agentSystem} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const subagent = await agentSystem.createSubAgentThread({
            leaderThreadId: leader.id,
            profileKey: "subagent.writer",
        });
        const runDetachedSubAgent = vi.spyOn(agentSystem, "runDetachedSubAgent").mockResolvedValue({
            subagentThreadId: subagent.id,
            status: "completed",
            walkthrough: "done",
        });
        const input: AnySubAgentInput = {
            prompt: "hello",
            plotPoints: ["p1"],
            lorebookEntries: [{path: "lorebook/test/"}],
        };

        await agentSystem.runSubAgent(leader.id, subagent.id, input, {
            turn: {
                kind: "new_user_turn",
                turnIndex: 3,
                anchorMessageId: "msg-leader-only",
            },
            planModeReminder: "sparse",
            planModeCommitMetadata: {
                planMode: {
                    active: true,
                    turnsSinceReminder: 0,
                    reminderCount: 1,
                    needsExitReminder: false,
                    hasExited: false,
                },
            },
        });

        expect(runDetachedSubAgent).toHaveBeenCalledWith(subagent.id, input, {});
    });

    it("submitUserInputAnswers 遇到重复 toolNodeId 会报错", async () => {
        const {agentSystem, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "选一个方向", options: [{label: "写作"}]}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await expect(agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [
                {toolNodeId: "tool-1", questionIndex: 0, selectedOptionIndex: 0},
                {toolNodeId: "tool-1", questionIndex: 0, selectedOptionIndex: 0},
            ],
        })).rejects.toThrow("answers 中存在重复的问题答案");
    });

    it("submitUserInputAnswers 忽略后会清空整组等待并停止 run", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const dispatchThreadRunById = vi.spyOn(agentSystem, "dispatchThreadRunById");
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [
                    {
                        toolNodeId: "tool-1",
                        questionIndex: 0,
                        toolCallId: "call-1",
                        toolName: "request_user_input",
                        toolArgsText: JSON.stringify({
                            questions: [{question: "选一个方向", options: [{label: "写作"}]}],
                        }),
                        createdAt: "2026-04-05T00:00:00.000Z",
                    },
                    {
                        toolNodeId: "tool-2",
                        questionIndex: 0,
                        toolCallId: "call-2",
                        toolName: "request_user_input",
                        toolArgsText: JSON.stringify({
                            questions: [{question: "选一个视角", options: [{label: "第一人称"}]}],
                        }),
                        createdAt: "2026-04-05T00:00:01.000Z",
                    },
                ],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            resume: false,
            answers: [
                {
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    ignored: true,
                },
                {
                    toolNodeId: "tool-2",
                    questionIndex: 0,
                    ignored: true,
                },
            ],
        });

        const record = await threadRepository.findById(leader.id);
        expect(threadMessages.persistToolMessage).toHaveBeenCalledTimes(2);
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toBe("选一个方向\n用户忽略了该问题，未提供答案。");
        expect(threadMessages.persistToolMessage.mock.calls[1]?.[1].text).toBe("选一个视角\n用户忽略了该问题，未提供答案。");
        expect(record?.runStatus).toBe("stopped");
        expect(record?.metadata.pendingUserInputSession).toBeNull();
        expect(dispatchThreadRunById).not.toHaveBeenCalled();
    });

    it("submitUserInputAnswers 最后一题 resume false 后会清空等待并暂停 run", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const dispatchThreadRunById = vi.spyOn(agentSystem, "dispatchThreadRunById");
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "选一个方向", options: [{label: "写作"}]}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            resume: false,
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                ignored: true,
            }],
        });

        const record = await threadRepository.findById(leader.id);
        expect(threadMessages.persistToolMessage).toHaveBeenCalledTimes(1);
        expect(record?.runStatus).toBe("stopped");
        expect(record?.metadata.pendingUserInputSession).toBeNull();
        expect(dispatchThreadRunById).not.toHaveBeenCalled();
    });

    it("submitUserInputAnswers 全部回答后会继续运行", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const dispatchThreadRunById = vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "选一个方向", options: [{label: "写作"}]}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: 0,
                note: "先写正文",
            }],
        });

        const record = await threadRepository.findById(leader.id);
        expect(threadMessages.persistToolMessage).toHaveBeenCalledTimes(1);
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toBe("选一个方向\n选择：写作\n备注：先写正文");
        expect(record?.runStatus).toBe("idle");
        expect(record?.metadata.pendingUserInputSession).toBeNull();
        expect(dispatchThreadRunById).toHaveBeenCalledWith(leader.id, {mode: "continue"});
    });

    it("submitUserInputAnswers 批准 enter_plan_mode 后才进入 Plan Mode", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "enter_plan_mode",
                    toolArgsText: JSON.stringify({
                        questions: [{
                            header: "Plan Mode",
                            question: "是否批准 Agent 切换 Plan Mode？",
                            options: [{label: "批准"}, {label: "取消"}],
                        }],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                    kind: "tool_approval",
                    approvalAction: "enter_plan_mode",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: 0,
            }],
        });

        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).toEqual(expect.objectContaining({
            active: true,
            needsExitReminder: false,
        }));
        expect(record?.metadata.pendingUserInputSession).toBeNull();
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toContain("User approved entering Plan Mode");
    });

    it("submitUserInputAnswers 拒绝 enter_plan_mode 后不会进入 Plan Mode", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "enter_plan_mode",
                    toolArgsText: JSON.stringify({
                        questions: [{
                            question: "是否批准 Agent 切换 Plan Mode？",
                            options: [{label: "批准"}, {label: "取消"}],
                        }],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                    kind: "tool_approval",
                    approvalAction: "enter_plan_mode",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: 1,
            }],
        });

        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).toBeUndefined();
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toContain("User rejected entering Plan Mode");
    });

    it("submitUserInputAnswers 批准 skill 后按中文原名读取 SKILL.md", async () => {
        const {agentSystem, skillCatalog, threadMessages, threadRepository} = createAgentSystemHarness();
        const skillRoot = await fs.mkdtemp(path.join(os.tmpdir(), `nbook-skill-${randomUUID()}-`));
        const skillPath = path.join(skillRoot, "SKILL.md");
        await fs.writeFile(skillPath, [
            "---",
            "name: 爽文",
            "description: 网文节奏",
            "---",
            "# 爽文",
            "",
            "保持强冲突开局。",
        ].join("\n"), "utf-8");
        skillCatalog.list.mockResolvedValue([{
            name: "爽文",
            description: "网文节奏",
            headerText: "name: 爽文\ndescription: 网文节奏",
            location: skillPath,
        }]);
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "skill",
                    toolArgsText: JSON.stringify({
                        questions: [{
                            header: "Skill",
                            question: "是否批准 Agent 启用这个 skill？",
                            options: [{label: "批准"}, {label: "取消"}],
                        }],
                    }),
                    approvalToolArgsText: JSON.stringify({skill: "爽文"}),
                    createdAt: "2026-04-05T00:00:00.000Z",
                    kind: "tool_approval",
                    approvalAction: "skill",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        try {
            await agentSystem.submitUserInputAnswers(leader.id, {
                assistantMessageId: "assistant-1",
                answers: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    selectedOptionIndex: 0,
                }],
            });
        } finally {
            await fs.rm(skillRoot, {recursive: true, force: true});
        }

        expect(skillCatalog.list).toHaveBeenCalledTimes(1);
        expect(threadMessages.persistToolMessage).toHaveBeenCalledTimes(1);
        const toolMessage = threadMessages.persistToolMessage.mock.calls[0]?.[1] as {text: string};
        expect(toolMessage.text).toContain('Skill "爽文" loaded.');
        expect(toolMessage.text).toContain("保持强冲突开局。");
    });

    it("submitUserInputAnswers 拒绝 skill 时不会读取 catalog", async () => {
        const {agentSystem, skillCatalog, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "skill",
                    toolArgsText: JSON.stringify({
                        questions: [{
                            question: "是否批准 Agent 启用这个 skill？",
                            options: [{label: "批准"}, {label: "取消"}],
                        }],
                    }),
                    approvalToolArgsText: JSON.stringify({skill: "爽文"}),
                    createdAt: "2026-04-05T00:00:00.000Z",
                    kind: "tool_approval",
                    approvalAction: "skill",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: 1,
            }],
        });

        expect(skillCatalog.list).not.toHaveBeenCalled();
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toContain('User rejected loading skill "爽文"');
    });

    it("submitUserInputAnswers 追加建议 exit_plan_mode 后继续规划", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const dispatchThreadRunById = vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            planMode: {
                active: true,
                enteredAt: "2026-04-05T00:00:00.000Z",
                turnsSinceReminder: 0,
                reminderCount: 1,
                needsExitReminder: false,
                hasExited: false,
            },
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "exit_plan_mode",
                    toolArgsText: JSON.stringify({
                        questions: [{
                            question: "是否批准 Agent 切换 Plan Mode？",
                            options: [{label: "批准"}, {label: "取消"}],
                        }],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                    kind: "tool_approval",
                    approvalAction: "exit_plan_mode",
                    planFilePath: `workspace/.agent/${leader.id}/agent-plan-mode-path.md`,
                    planContent: "# 待审计划",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: -1,
                note: "请补充测试方案",
            }],
        });

        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).toEqual(expect.objectContaining({active: true}));
        expect(record?.runStatus).toBe("idle");
        expect(dispatchThreadRunById).toHaveBeenCalledWith(leader.id, {mode: "continue"});
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toContain("User rejected exiting Plan Mode");
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toContain("Additional suggestion");
        expect(threadMessages.persistToolMessage.mock.calls[0]?.[1].text).toContain("请补充测试方案");
    });

    it("submitUserInputAnswers 批准 exit_plan_mode 时不把完整计划写进工具正文", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        const planFilePath = `workspace/.agent/${leader.id}/agent-plan-mode-path.md`;
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            planMode: {
                active: true,
                enteredAt: "2026-04-05T00:00:00.000Z",
                turnsSinceReminder: 0,
                reminderCount: 1,
                needsExitReminder: false,
                hasExited: false,
            },
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "exit_plan_mode",
                    toolArgsText: JSON.stringify({
                        questions: [{
                            question: "是否批准 Agent 切换 Plan Mode？",
                            options: [{label: "批准"}, {label: "取消"}],
                        }],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                    kind: "tool_approval",
                    approvalAction: "exit_plan_mode",
                    planFilePath,
                    planContent: "# 绑定计划\n\n执行步骤。",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: 0,
            }],
        });

        const toolMessage = threadMessages.persistToolMessage.mock.calls[0]?.[1] as {
            text: string;
            additional_kwargs: Record<string, unknown>;
        } | undefined;
        expect(toolMessage?.text).toContain("User approved exiting Plan Mode");
        expect(toolMessage?.text).toContain(planFilePath);
        expect(toolMessage?.text).not.toContain("# 绑定计划");
        expect(toolMessage?.additional_kwargs.toolResultRaw).toEqual(expect.objectContaining({
            planPreviewKind: "exit_plan_mode",
            planFilePath,
            planContent: "# 绑定计划\n\n执行步骤。",
        }));
        const record = await threadRepository.findById(leader.id);
        expect(record?.metadata.planMode).not.toHaveProperty("planFilePath");
    });

    it("submitUserInputAnswers 支持追加建议和备注", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "选一个方向", options: [{label: "写作"}]}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                selectedOptionIndex: -1,
                note: "没有合适选项",
            }],
        });

        const toolMessage = threadMessages.persistToolMessage.mock.calls[0]?.[1] as {
            text: string;
            metadata?: {toolArgs?: string};
        } | undefined;
        expect(toolMessage?.text).toBe("选一个方向\n选择：Additional suggestion\n备注：没有合适选项");
        expect(() => JSON.parse(toolMessage?.metadata?.toolArgs ?? "")).not.toThrow();
    });

    it("submitUserInputAnswers 支持开放问题直接用备注回答", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "请说明主角地球死亡原因"}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [{
                toolNodeId: "tool-1",
                questionIndex: 0,
                note: "先按灵魂牵引副作用处理。",
            }],
        });

        const toolMessage = threadMessages.persistToolMessage.mock.calls[0]?.[1] as {
            text: string;
            additional_kwargs?: {toolResultRaw?: unknown};
        } | undefined;
        expect(toolMessage?.text).toBe("请说明主角地球死亡原因\n回答：先按灵魂牵引副作用处理。");
        expect(toolMessage?.additional_kwargs?.toolResultRaw).toEqual({
            answers: [{
                questionIndex: 0,
                note: "先按灵魂牵引副作用处理。",
            }],
        });
    });

    it("submitUserInputAnswers 支持单个工具调用内的多题和多选", async () => {
        const {agentSystem, threadMessages, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        vi.spyOn(agentSystem, "dispatchThreadRunById").mockResolvedValue();
        const toolArgsText = JSON.stringify({
            questions: [
                {question: "主角地球死亡原因是什么？"},
                {
                    question: "这一段要突出哪些主题？",
                    multiSelect: true,
                    options: [
                        {label: "命运"},
                        {label: "亲情"},
                        {label: "悬疑"},
                    ],
                },
            ],
        });
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [
                    {
                        toolNodeId: "tool-1",
                        questionIndex: 0,
                        toolCallId: "call-1",
                        toolName: "request_user_input",
                        toolArgsText,
                        createdAt: "2026-04-05T00:00:00.000Z",
                    },
                    {
                        toolNodeId: "tool-1",
                        questionIndex: 1,
                        toolCallId: "call-1",
                        toolName: "request_user_input",
                        toolArgsText,
                        createdAt: "2026-04-05T00:00:00.000Z",
                    },
                ],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await agentSystem.submitUserInputAnswers(leader.id, {
            assistantMessageId: "assistant-1",
            answers: [
                {toolNodeId: "tool-1", questionIndex: 0, note: "灵魂牵引副作用。"},
                {toolNodeId: "tool-1", questionIndex: 1, selectedOptionIndexes: [0, 2]},
            ],
        });

        const toolMessage = threadMessages.persistToolMessage.mock.calls[0]?.[1] as {
            text: string;
            additional_kwargs?: {toolResultRaw?: unknown};
        } | undefined;
        expect(threadMessages.persistToolMessage).toHaveBeenCalledTimes(1);
        expect(toolMessage?.text).toContain("主角地球死亡原因是什么？\n回答：灵魂牵引副作用。");
        expect(toolMessage?.text).toContain("这一段要突出哪些主题？\n选择：命运、悬疑");
        expect(toolMessage?.additional_kwargs?.toolResultRaw).toEqual({
            answers: [
                {questionIndex: 0, note: "灵魂牵引副作用。"},
                {questionIndex: 1, selectedOptionIndexes: [0, 2]},
            ],
        });
    });

    it("stopThreadRun 会按活跃状态返回布尔值", async () => {
        const {agentSystem, liveRuns} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        await expect(agentSystem.stopThreadRun(leader.id)).resolves.toBe(false);

        liveRuns.open("thread-1", "leader.default");
        await expect(agentSystem.stopThreadRun("thread-1")).resolves.toBe(true);
    });

    it("stopThreadRun 会在 waiting_user 时清空待回答问题", async () => {
        const {agentSystem, threadRepository} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        await threadRepository.updateMetadata(leader.id, {
            pendingUserInputSession: {
                assistantMessageId: "assistant-1",
                status: "pending",
                questions: [{
                    toolNodeId: "tool-1",
                    questionIndex: 0,
                    toolCallId: "call-1",
                    toolName: "request_user_input",
                    toolArgsText: JSON.stringify({
                        questions: [{question: "选一个方向", options: [{label: "写作"}]}],
                    }),
                    createdAt: "2026-04-05T00:00:00.000Z",
                }],
            },
        });
        await threadRepository.updateRunStatus(leader.id, "waiting_user");

        await expect(agentSystem.stopThreadRun(leader.id)).resolves.toBe(true);

        const record = await threadRepository.findById(leader.id);
        expect(record?.runStatus).toBe("stopped");
        expect(record?.metadata.pendingUserInputSession).toBeNull();
    });

    it("deleteThread 会清理 message、repo、scope 和 event channel", async () => {
        const {agentSystem, messageStore, threadEvents} = createAgentSystemHarness();
        const leader = await agentSystem.createLeaderThread();
        await agentSystem.syncClientVariables(leader.id, {
            ide: {
                theme: "sepia",
            },
        });

        await agentSystem.deleteThread(leader.id);

        expect(messageStore.deleteThread).toHaveBeenCalledWith(leader.id);
        expect(threadEvents.cleanup).toHaveBeenCalledWith(leader.id);
        expect(agentSystem.getThreadScope(leader.id)).toMatchObject({
            ide: {
                theme: null,
            },
        });
    });

    it("createDefault 会注册 leader 可用的 plot tools", async () => {
        const agentSystem = AgentSystem.createDefault();
        const leaderProfile = await agentSystem.profileRegistry.get("leader.default");
        const scope: AgentVariableScope<"leader.default"> = {
            ide: {
                panel: null,
                activePanel: "outline",
                theme: "sepia",
                extra: {},
            },
            studio: {
                novelId: "1",
                selectedChapterId: "1",
                previousSelectedChapterId: null,
                currentChapterTitle: null,
                previousChapterTitle: null,
                currentChapterLabel: null,
                previousChapterLabel: null,
                workspace: "novel-ide",
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: 1,
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
                tools: leaderProfile.allowedToolKeys,
                subagents: [],
                tasks: null,
            },
            input: {
                prompt: "",
            },
        };
        const tools = await agentSystem.toolRegistry.resolveTools(leaderProfile.allowedToolKeys, {
            agentGateway: {
                publishToolOutputDelta: vi.fn(),
                createSubAgentThread: vi.fn(),
                listSubAgents: vi.fn(),
                runSubAgent: vi.fn(),
                assertSubAgentProfile: vi.fn(),
                listProfiles: vi.fn(async () => []),
                createTaskList: vi.fn(),
                setTaskStatus: vi.fn(),
                enterPlanMode: vi.fn(),
                exitPlanMode: vi.fn(),
            },
            threadId: "leader-1",
            profileKey: "leader.default",
            profile: leaderProfile,
            runOptions: {},
            writeToolOutput: vi.fn(),
            getHistory: vi.fn(async () => []),
            getScope: vi.fn(() => scope),
            setIde: vi.fn(),
            setStudio: vi.fn(),
        });

        expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
            "get_plot_tree",
            "get_story_thread",
            "get_story_scene_context",
            "get_chapter_plot",
            "execute_shell",
            "create_story_thread",
            "update_story_thread",
            "create_story_scene",
            "update_story_scene",
            "create_story_plot",
            "update_story_plot",
            "task_create",
            "task_set_status",
        ]));
    });
});
