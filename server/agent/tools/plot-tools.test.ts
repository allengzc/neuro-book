import {describe, expect, it} from "vitest";
import {Value} from "typebox/value";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import {MAX_STORY_SUMMARY_LENGTH} from "nbook/shared/dto/plot.dto";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";

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

    it("create_story_plots 要求批量 Plot summary 非空", () => {
        const tool = createPlotTools().find((item) => item.key === "create_story_plots");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            sceneId: "20",
            plots: [{
                kind: "action",
                summary: "角色接过五彩石。",
            }],
        })).toBe(true);
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            sceneId: "20",
            plots: [{
                kind: "action",
                summary: "",
            }],
        })).toBe(false);
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            sceneId: "20",
            plots: [{
                kind: "action",
                summary: "   ",
            }],
        })).toBe(false);
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            sceneId: "20",
            plots: [{
                kind: "action",
                summary: "x".repeat(MAX_STORY_SUMMARY_LENGTH + 1),
            }],
        })).toBe(false);
    });

    it("省略 threadId/sceneId 时不会跨 Project 复用 plot.selection", async () => {
        const harness = {
            async readSessionContext() {
                return {
                    customState: {
                        [PLOT_SELECTION_STATE_KEY]: {
                            projectPath: "workspace/novel-1",
                            threadId: "10",
                            sceneId: "20",
                        },
                    },
                };
            },
        } as unknown as NeuroAgentHarness;
        const context = {
            harness,
            sessionId: 1,
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
