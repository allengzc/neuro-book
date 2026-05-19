import {describe, expect, it} from "vitest";
import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import {ThreadTaskService} from "nbook/server/agent/services/thread-task.service";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {AgentThreadMetadata, AgentThreadRecord, AgentThreadStatus, CreateLeaderThreadInput, ListThreadsInput, SubAgentProfileKey, ThreadId} from "nbook/server/agent/types";

/**
 * 创建只覆盖任务服务所需能力的线程仓储。
 */
function createTaskRepository(initial: AgentThreadRecord = createThreadRecord()): {
    repository: ThreadRepository;
    read(): AgentThreadRecord;
} {
    let record = initial;
    const repository: ThreadRepository = {
        async createLeader(_input: CreateLeaderThreadInput) {
            throw new Error("测试未实现 createLeader");
        },
        async createSubAgent(_input: {profileKey: SubAgentProfileKey; title?: string}) {
            throw new Error("测试未实现 createSubAgent");
        },
        async listThreads(_input?: ListThreadsInput) {
            return [];
        },
        async findById(threadId: ThreadId) {
            return String(record.id) === String(threadId) ? record : null;
        },
        async delete(_threadId: ThreadId) {},
        async attachSubAgent(_leaderThreadId: ThreadId, _subAgentThreadId: ThreadId) {},
        async listSubAgents(_leaderThreadId: ThreadId) {
            return [];
        },
        async listManagingLeaders(_subAgentThreadId: ThreadId) {
            return [];
        },
        async assertLeaderManagesSubAgent(_leaderThreadId: ThreadId, _subAgentThreadId: ThreadId) {},
        async updateRunStatus(_threadId: ThreadId, status: AgentThreadStatus) {
            record = {
                ...record,
                runStatus: status,
            };
            return record;
        },
        async updateMetadata(_threadId: ThreadId, metadata: AgentThreadMetadata) {
            record = {
                ...record,
                metadata,
            };
            return record;
        },
        async touchAfterRun(_threadId: ThreadId, input: {summary: string; status: AgentThreadStatus; metadata?: AgentThreadMetadata}) {
            record = {
                ...record,
                runStatus: input.status,
                lastMessagePreview: input.summary,
                metadata: input.metadata ?? record.metadata,
            };
            return record;
        },
    };

    return {
        repository,
        read: () => record,
    };
}

describe("ThreadTaskService", () => {
    it("会初始化或整体替换当前任务列表", async () => {
        const {repository, read} = createTaskRepository();
        const service = new ThreadTaskService(repository);

        await service.createTaskList("1", {
            title: "实现登录修复",
            steps: [
                {id: "inspect_auth_flow", text: "检查现有登录流程", status: "in_progress"},
                {id: "run_tests", text: "运行相关测试", status: "pending"},
            ],
        });
        const replaced = await service.createTaskList("1", {
            steps: [
                {id: "summarize", text: "总结当前结果", status: "pending"},
            ],
        });

        expect(replaced.title).toBeUndefined();
        expect(replaced.steps).toHaveLength(1);
        expect(replaced.steps[0]).toMatchObject({
            id: "summarize",
            text: "总结当前结果",
            status: "pending",
        });
        expect(read().metadata.tasks).toEqual(replaced);
    });

    it("任务列表会保留更新时间并只允许一个 in_progress", async () => {
        const {repository} = createTaskRepository();
        const service = new ThreadTaskService(repository);

        const created = await service.createTaskList("1", {
            title: "实现展示",
            steps: [
                {id: "design", text: "设计卡片", status: "in_progress"},
                {id: "build", text: "补前端", status: "pending"},
            ],
        });

        expect(created.updatedAt).toBeTruthy();
        expect(created.steps.every((step) => step.updatedAt === created.updatedAt)).toBe(true);
    });

    it("会更新单个步骤状态并保留完整列表", async () => {
        const {repository} = createTaskRepository();
        const service = new ThreadTaskService(repository);
        await service.createTaskList("1", {
            steps: [
                {id: "read_context", text: "读取上下文", status: "pending"},
                {id: "edit_code", text: "修改代码", status: "pending"},
            ],
        });

        const updated = await service.setTaskStatus("1", {
            id: "read_context",
            status: "completed",
            note: "已确认入口",
        });

        expect(updated.steps).toMatchObject([
            {
                id: "read_context",
                status: "completed",
                note: "已确认入口",
            },
            {
                id: "edit_code",
                status: "pending",
            },
        ]);
    });

    it("设置 in_progress 时会把旧 in_progress 退回 pending", async () => {
        const {repository} = createTaskRepository();
        const service = new ThreadTaskService(repository);
        await service.createTaskList("1", {
            steps: [
                {id: "read_context", text: "读取上下文", status: "in_progress"},
                {id: "edit_code", text: "修改代码", status: "pending"},
                {id: "run_tests", text: "运行测试", status: "completed"},
            ],
        });

        const updated = await service.setTaskStatus("1", {
            id: "edit_code",
            status: "in_progress",
        });

        expect(updated.steps.map((step) => ({id: step.id, status: step.status}))).toEqual([
            {id: "read_context", status: "pending"},
            {id: "edit_code", status: "in_progress"},
            {id: "run_tests", status: "completed"},
        ]);
    });

    it("创建列表时会拒绝多个 in_progress", async () => {
        const {repository} = createTaskRepository();
        const service = new ThreadTaskService(repository);

        await expect(service.createTaskList("1", {
            steps: [
                {id: "first", text: "第一步", status: "in_progress"},
                {id: "second", text: "第二步", status: "in_progress"},
            ],
        })).rejects.toThrow("最多只能有一个");
    });

    it("更新不存在的步骤时会报错", async () => {
        const {repository} = createTaskRepository();
        const service = new ThreadTaskService(repository);
        await service.createTaskList("1", {
            steps: [
                {id: "read_context", text: "读取上下文", status: "pending"},
            ],
        });

        await expect(service.setTaskStatus("1", {
            id: "missing",
            status: "completed",
        })).rejects.toThrow("未找到 task step");
    });
});
