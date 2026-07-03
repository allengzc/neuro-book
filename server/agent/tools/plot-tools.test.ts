import {describe, expect, it, vi} from "vitest";
import {Value} from "typebox/value";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";

vi.mock("nbook/server/plot", () => ({
    plotFacade: {
        getChapterWriterBrief: vi.fn(),
        getSceneWorldContext: vi.fn(),
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

    it("create_story_scene 接受 World Anchor", () => {
        const tool = createPlotTools().find((item) => item.key === "create_story_scene");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            threadId: "2",
            title: "Scene",
            worldAnchor: {
                startTime: null,
                endTime: null,
                startInstant: null,
                endInstant: null,
                subjectIds: ["hero"],
                locationSubjectId: "temple",
            },
        })).toBe(true);
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

    it("get_scene_world_context 返回 Scene 的 World Engine 上下文并更新 selection", async () => {
        const appended: unknown[] = [];
        const plotFacadeMock = (await import("nbook/server/plot")).plotFacade as unknown as {
            getSceneWorldContext: ReturnType<typeof vi.fn>;
            getStorySceneDetailDto: ReturnType<typeof vi.fn>;
            getStoryThreadDetailDto: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getSceneWorldContext.mockResolvedValueOnce({
            slices: [{id: "slice-1", time: "第1日", title: "祭坛苏醒", summary: "火焰亮起。", kind: "scene", patchCount: 2}],
            subjectStates: [{subjectId: "hero", type: "character", name: "主角", attrs: {hp: 8}}],
            unresolvedSubjectIds: ["future-subject"],
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
        const tool = createPlotTools().find((item) => item.key === "get_scene_world_context");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            sceneId: "20",
        })).toBe(true);
        const result = await tool!.executeWithContext!(context, "plot-1", {
            projectPath: "workspace/novel-1",
            sceneId: "20",
        });

        expect(plotFacadeMock.getSceneWorldContext).toHaveBeenCalledWith("workspace/novel-1", 20);
        expect(result.details).toEqual({
            slices: [expect.objectContaining({id: "slice-1"})],
            subjectStates: [expect.objectContaining({subjectId: "hero"})],
            unresolvedSubjectIds: ["future-subject"],
        });
        expect(appended).toEqual([{
            key: PLOT_SELECTION_STATE_KEY,
            value: expect.objectContaining({
                projectPath: "workspace/novel-1",
                sceneId: "20",
            }),
        }]);
    });

    it("get_chapter_writer_brief 返回 markdown text 和完整 details，且不读写 plot.selection", async () => {
        const plotFacadeMock = (await import("nbook/server/plot")).plotFacade as unknown as {
            getChapterWriterBrief: ReturnType<typeof vi.fn>;
        };
        plotFacadeMock.getChapterWriterBrief.mockResolvedValueOnce({
            chapter: {id: "7", name: "001-opening", title: "开篇"},
            mode: "autonomous",
            status: "ready",
            scenes: [],
            totalScenes: 0,
            suggestedReading: [],
            warnings: [],
            suggestedBriefMarkdown: "# Brief\n\n写作交接。",
        });
        const harness = {
            readSessionContext: vi.fn(async () => ({customState: {}})),
            appendCustomState: vi.fn(async () => ({})),
        } as unknown as NeuroAgentHarness & {
            readSessionContext: ReturnType<typeof vi.fn>;
            appendCustomState: ReturnType<typeof vi.fn>;
        };
        const context = {
            harness,
            sessionId: 1,
            profileKey: "leader.default",
            workspaceRoot: ".agent/plot-tools-test",
            workspaceKey: "plot-tools-test",
        };
        const tool = createPlotTools().find((item) => item.key === "get_chapter_writer_brief");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            projectPath: "workspace/novel-1",
            chapterId: "7",
        })).toBe(true);
        const result = await tool!.executeWithContext!(context, "plot-brief-1", {
            projectPath: "workspace/novel-1",
            chapterId: "7",
        });

        expect(plotFacadeMock.getChapterWriterBrief).toHaveBeenCalledWith("workspace/novel-1", 7, "autonomous");
        expect(result.content).toEqual([{type: "text", text: "# Brief\n\n写作交接。"}]);
        expect(result.details).toMatchObject({
            chapter: {id: "7", name: "001-opening"},
            status: "ready",
            suggestedBriefMarkdown: "# Brief\n\n写作交接。",
        });
        expect(harness.readSessionContext).not.toHaveBeenCalled();
        expect(harness.appendCustomState).not.toHaveBeenCalled();
    });
});
