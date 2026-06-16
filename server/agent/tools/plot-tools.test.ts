import {describe, expect, it, vi} from "vitest";
import {Value} from "typebox/value";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import {MAX_STORY_SUMMARY_LENGTH} from "nbook/shared/dto/plot.dto";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";

vi.mock("nbook/server/plot", () => ({
    plotFacade: {
        getStoryPlotDto: vi.fn(),
        getStorySceneDetailDto: vi.fn(),
        getStoryThreadDetailDto: vi.fn(),
    },
}));

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
            profileKey: "leader.default",
            workspaceRoot: ".agent/plot-tools-test",
            workspaceKey: "plot-tools-test",
        };
        const tool = createPlotTools().find((item) => item.key === "update_story_thread");

        await expect(tool?.executeWithContext?.(context, "plot-1", {
            projectPath: "workspace/novel-2",
            title: "Other novel thread",
        })).rejects.toThrow("plot.selection 属于 projectPath=workspace/novel-1");
    });

    it("get_story_plot_context 返回 Plot、所属 Scene、所属 Thread 并更新 selection", async () => {
        const appended: unknown[] = [];
        const plotFacadeMock = (await import("nbook/server/plot")).plotFacade as {
            getStoryPlotDto: ReturnType<typeof vi.fn>;
            getStorySceneDetailDto: ReturnType<typeof vi.fn>;
            getStoryThreadDetailDto: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getStoryPlotDto.mockResolvedValueOnce({
            id: "30",
            sceneId: "20",
            kind: "action",
            summary: "发现账册缺页。",
        });
        plotFacadeMock.getStorySceneDetailDto.mockResolvedValueOnce({
            id: "20",
            threadId: "10",
            title: "账册缺页",
            plots: [],
            refs: [],
            effectiveRefs: [],
        });
        plotFacadeMock.getStoryThreadDetailDto.mockResolvedValueOnce({
            id: "10",
            title: "主线",
            scenes: [],
        });
        const harness = {
            async readSessionContext() {
                return {customState: {}};
            },
            async appendCustomState(_sessionId: number, key: string, value: unknown) {
                appended.push({key, value});
                return {};
            },
        } as unknown as NeuroAgentHarness;
        const context = {
            harness,
            sessionId: 1,
            profileKey: "writer",
            workspaceRoot: ".agent/plot-tools-test",
            workspaceKey: "plot-tools-test",
        };
        const tool = createPlotTools().find((item) => item.key === "get_story_plot_context");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            plotId: "30",
        })).toBe(true);
        const result = await tool!.executeWithContext!(context, "plot-1", {
            projectPath: "workspace/novel-1",
            plotId: "30",
        });

        expect(plotFacadeMock.getStoryPlotDto).toHaveBeenCalledWith("workspace/novel-1", 30);
        expect(plotFacadeMock.getStorySceneDetailDto).toHaveBeenCalledWith("workspace/novel-1", 20);
        expect(plotFacadeMock.getStoryThreadDetailDto).toHaveBeenCalledWith("workspace/novel-1", 10);
        expect(result.details).toEqual({
            plot: expect.objectContaining({id: "30"}),
            scene: expect.objectContaining({id: "20"}),
            thread: expect.objectContaining({id: "10"}),
        });
        expect(appended).toEqual([{
            key: PLOT_SELECTION_STATE_KEY,
            value: expect.objectContaining({
                projectPath: "workspace/novel-1",
                threadId: "10",
                sceneId: "20",
            }),
        }]);
    });
});
