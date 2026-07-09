import {describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {createAssistantTextMessage} from "nbook/server/agent/messages/message-utils";
import {AGENT_TASKS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {ToolSessionWriteSink} from "nbook/server/agent/session/tool-session-write-sink";
import type {SessionWriteExecutor, SessionWritePlan} from "nbook/server/agent/session/write-plan";

describe("task tools", () => {
    it("task_create / task_set_status 写入 session custom state 并返回任务卡结构", async () => {
        const harness = new NeuroAgentHarness({enableSessionSummarizer: false});
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: ".agent/task-tools-test",
            workspaceKey: "task-tools-test",
        });
        const context = {
            harness,
            sessionId: created.sessionId,
            profileKey: "leader.default",
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
    }, 60_000);

    it("真实 turn 的 savePoint 提交后任务清单仍保持在当前分支", async () => {
        const harness = new NeuroAgentHarness({enableSessionSummarizer: false});
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: ".agent/task-tools-savepoint-test",
            workspaceKey: "task-tools-savepoint-test",
        });
        const writeExecutor = (harness as unknown as {writeExecutor: SessionWriteExecutor}).writeExecutor;
        const pendingPlans: Array<{plan: SessionWritePlan; toolCallIndex: number; enqueueOrder: number}> = [];
        let enqueueOrder = 0;
        const snapshotBeforeTurn = await harness.repo.readSession(created.sessionId, "task-tools-savepoint-test");
        const context = {
            harness,
            sessionId: created.sessionId,
            profileKey: "leader.default",
            workspaceRoot: ".agent/task-tools-savepoint-test",
            workspaceKey: "task-tools-savepoint-test",
            invocationId: "task-invocation",
            sessionWrites: new ToolSessionWriteSink({
                executor: writeExecutor,
                sessionId: created.sessionId,
                invocationId: "task-invocation",
                toolCallIndex: 0,
                toolCallId: "task-create-call",
                enqueueSavePoint(plan, source) {
                    pendingPlans.push({plan, toolCallIndex: source.toolCallIndex, enqueueOrder: enqueueOrder++});
                },
            }),
        };
        const taskCreate = harness.tools.get("task_create");
        const taskSetStatus = harness.tools.get("task_set_status");

        await taskCreate?.executeWithContext?.(context, "task-create-call", {
            title: "当前分支任务",
            steps: [
                {id: "one", text: "第一步", status: "in_progress"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        await taskSetStatus?.executeWithContext?.(context, "task-set-call", {
            id: "one",
            status: "completed",
        });

        await writeExecutor.execute([
            {
                target: {sessionId: created.sessionId},
                cause: "turn.ingest",
                durability: "savePoint",
                ops: [{
                    kind: "appendMany",
                    entries: [{
                        type: "message",
                        message: createAssistantTextMessage({text: "完成任务更新"}),
                        origin: "harness",
                        parentId: snapshotBeforeTurn.leafId,
                    }],
                }],
            },
            ...pendingPlans
                .sort((left, right) => left.toolCallIndex - right.toolCallIndex || left.enqueueOrder - right.enqueueOrder)
                .map((item) => item.plan),
        ], "task-invocation");

        const afterTurn = await harness.readSessionContext(created.sessionId, "task-tools-savepoint-test");
        expect(afterTurn.customState[AGENT_TASKS_STATE_KEY]).toMatchObject({
            title: "当前分支任务",
            steps: [
                {id: "one", status: "completed"},
                {id: "two", status: "pending"},
            ],
        });

        await harness.repo.moveLeaf(created.sessionId, snapshotBeforeTurn.leafId, "task-tools-savepoint-test");
        const otherBranch = await harness.readSessionContext(created.sessionId, "task-tools-savepoint-test");
        expect(otherBranch.customState[AGENT_TASKS_STATE_KEY]).toBeUndefined();
    }, 60_000);
});
