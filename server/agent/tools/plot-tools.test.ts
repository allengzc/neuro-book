import {describe, expect, it} from "vitest";
import {Value} from "typebox/value";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";

describe("plot tools", () => {
    it("refs.note 可以省略", () => {
        const tool = createPlotTools().find((item) => item.key === "create_story_scene");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            threadId: "2",
            title: "Scene",
            refs: [{
                relation: "mentions",
                target: "lorebook/character/foo/",
                visibility: "author",
            }],
        })).toBe(true);
    });

    it("省略 threadId/sceneId 时不会跨 Project 复用 plot.selection", async () => {
        const harness = new NeuroAgentHarness();
        const created = await harness.createAgent({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: ".agent/plot-tools-test",
            workspaceKey: "plot-tools-test",
        });
        await harness.appendCustomState(created.sessionId, PLOT_SELECTION_STATE_KEY, {
            projectPath: "workspace/novel-1",
            threadId: "10",
            sceneId: "20",
        }, "plot-tools-test");
        const context = {
            harness,
            sessionId: created.sessionId,
            workspaceRoot: ".agent/plot-tools-test",
            workspaceKey: "plot-tools-test",
        };
        const tool = createPlotTools().find((item) => item.key === "update_story_thread");

        await expect(tool?.executeWithContext?.(context, "plot-1", {
            projectPath: "workspace/novel-2",
            title: "Other novel thread",
        })).rejects.toThrow("plot.selection 属于 projectPath=workspace/novel-1");
    });
});
