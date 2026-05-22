import type {ThreadRepository} from "nbook/server/agent/repositories/thread-repository";
import type {AgentTaskList, AgentTaskStatus, AgentTaskStep, ThreadId} from "nbook/server/agent/types";

export type CreateAgentTaskStepInput = {
    id: string;
    text: string;
    status: AgentTaskStatus;
};

export type CreateAgentTaskListInput = {
    title?: string;
    steps: CreateAgentTaskStepInput[];
};

export type SetAgentTaskStatusInput = {
    id: string;
    status: AgentTaskStatus;
    note?: string;
};

/**
 * 线程任务服务。
 * 负责维护当前线程的轻量任务列表。
 */
export class ThreadTaskService {
    private readonly mutationQueues = new Map<ThreadId, Promise<void>>();

    constructor(
        private readonly threadRepository: ThreadRepository,
    ) {}

    /**
     * 初始化或整体重建当前线程任务列表。
     */
    async createTaskList(threadId: ThreadId, input: CreateAgentTaskListInput): Promise<AgentTaskList> {
        return this.withThreadMutation(threadId, async () => {
            const thread = await this.requireThread(threadId);
            const now = new Date().toISOString();
            const taskList: AgentTaskList = {
                title: this.normalizeOptionalText(input.title),
                steps: input.steps.map((step) => ({
                    id: step.id.trim(),
                    text: step.text.trim(),
                    status: step.status,
                    updatedAt: now,
                })),
                updatedAt: now,
            };
            this.assertValidTaskList(taskList);
            await this.threadRepository.updateMetadata(threadId, {
                ...thread.metadata,
                tasks: taskList,
            });
            return taskList;
        });
    }

    /**
     * 更新单个任务步骤状态，并返回完整任务列表。
     */
    async setTaskStatus(threadId: ThreadId, input: SetAgentTaskStatusInput): Promise<AgentTaskList> {
        return this.withThreadMutation(threadId, async () => {
            const thread = await this.requireThread(threadId);
            const current = thread.metadata.tasks;
            if (!current) {
                throw new Error("当前线程还没有 task 列表");
            }

            const now = new Date().toISOString();
            const targetId = input.id.trim();
            let found = false;
            const steps = current.steps.map((step) => {
                if (step.id !== targetId) {
                    if (input.status === "in_progress" && step.status === "in_progress") {
                        return {
                            ...step,
                            status: "pending" as const,
                            updatedAt: now,
                        };
                    }
                    return step;
                }

                found = true;
                return this.patchStep(step, input, now);
            });

            if (!found) {
                throw new Error(`未找到 task step: ${input.id}`);
            }

            const taskList: AgentTaskList = {
                ...current,
                steps,
                updatedAt: now,
            };
            this.assertValidTaskList(taskList);
            await this.threadRepository.updateMetadata(threadId, {
                ...thread.metadata,
                tasks: taskList,
            });
            return taskList;
        });
    }

    /**
     * 按线程串行执行 metadata mutation。
     */
    private async withThreadMutation<TResult>(threadId: ThreadId, task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.mutationQueues.get(threadId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.then(() => current);
        this.mutationQueues.set(threadId, queued);

        await previous;
        try {
            return await task();
        } finally {
            release();
            if (this.mutationQueues.get(threadId) === queued) {
                this.mutationQueues.delete(threadId);
            }
        }
    }

    /**
     * 读取线程，缺失时抛出明确错误。
     */
    private async requireThread(threadId: ThreadId) {
        const thread = await this.threadRepository.findById(threadId);
        if (!thread) {
            throw new Error(`未找到 thread: ${threadId}`);
        }
        return thread;
    }

    /**
     * 更新单个任务步骤。
     */
    private patchStep(step: AgentTaskStep, input: SetAgentTaskStatusInput, updatedAt: string): AgentTaskStep {
        return {
            ...step,
            status: input.status,
            note: input.note !== undefined ? this.normalizeOptionalText(input.note) : step.note,
            updatedAt,
        };
    }

    /**
     * 校验任务列表运行期规则。
     */
    private assertValidTaskList(taskList: AgentTaskList): void {
        const inProgressCount = taskList.steps.filter((step) => step.status === "in_progress").length;
        if (inProgressCount > 1) {
            throw new Error("同一时间最多只能有一个 in_progress task step");
        }
        const ids = taskList.steps.map((step) => step.id);
        if (ids.some((id) => !id)) {
            throw new Error("task step id 不能为空");
        }
        if (taskList.steps.some((step) => !step.text)) {
            throw new Error("task step text 不能为空");
        }
        if (new Set(ids).size !== ids.length) {
            throw new Error("task step id 必须唯一");
        }
    }

    /**
     * 归一化可选文本。
     */
    private normalizeOptionalText(value: string | undefined): string | undefined {
        const normalized = value?.trim() ?? "";
        return normalized ? normalized : undefined;
    }
}
