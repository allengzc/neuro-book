import {describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AGENT_TASKS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";

describe("task tools", () => {
    it("task_create / task_set_status 写入 session custom state 并返回任务卡结构", async () => {
        const harness = new NeuroAgentHarness();
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: ".agent/task-tools-test",
            workspaceKey: "task-tools-test",
        });
        const context = {
            harness,
            sessionId: created.sessionId,
            workspaceRoot: ".agent/task-tools-test",
            workspaceKey: "task-tools-test",
        };
        const taskCreate = harness.tools.get("task_create");
        const taskSetStatus = harness.tools.get("task_set_status");

        const createdTasks = await taskCreate?.executeWithContext?.(context, "task-1", {
            title: "迁移",
            steps: [
                {id: "one", text: "第一步", status: "in_progress"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        const updatedTasks = await taskSetStatus?.executeWithContext?.(context, "task-2", {
            id: "one",
            status: "completed",
            note: "完成",
        });
        const session = await harness.readSessionContext(created.sessionId, "task-tools-test");

        expect(createdTasks?.details).toMatchObject({
            title: "迁移",
            steps: [
                {id: "one", text: "第一步", status: "in_progress"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        expect(updatedTasks?.details).toMatchObject({
            title: "迁移",
            steps: [
                {id: "one", text: "第一步", status: "completed", note: "完成"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        expect(session.customState[AGENT_TASKS_STATE_KEY]).toEqual(updatedTasks?.details);
    });
});
