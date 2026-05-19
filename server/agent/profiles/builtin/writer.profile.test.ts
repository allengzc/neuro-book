import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {BaseMessage} from "@langchain/core/messages";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {WriterProfile} from "nbook/server/agent/profiles/builtin/writer.profile";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import {createThreadRecord} from "nbook/server/agent/test/fixtures";
import type {ProfileInputMap, SkillCatalogItem, ToolKey} from "nbook/server/agent/types";

const mockPlotFacade = vi.hoisted(() => ({
    getStorySceneDetailDto: vi.fn(),
    getStoryThreadDetailDto: vi.fn(),
    getChapterPlotDetailDto: vi.fn(),
}));

vi.mock("nbook/server/plot", () => ({
    plotFacade: mockPlotFacade,
}));

const createdWorkspacePaths: string[] = [];

afterEach(async () => {
    await Promise.all(createdWorkspacePaths.splice(0).map(async (workspacePath) => {
        await fs.rm(workspacePath, {recursive: true, force: true});
    }));
});

describe("WriterProfile", () => {
    beforeEach(() => {
        mockPlotFacade.getStorySceneDetailDto.mockReset();
        mockPlotFacade.getStoryThreadDetailDto.mockReset();
        mockPlotFacade.getChapterPlotDetailDto.mockReset();
    });

    it("注入前置文风参考正文，不输出 skill 或普通动态上下文", async () => {
        const workspace = await createWorkspace();
        mockPlotFacade.getStorySceneDetailDto.mockResolvedValue(buildSceneDetail());
        mockPlotFacade.getStoryThreadDetailDto.mockResolvedValue(buildThreadDetail());
        mockPlotFacade.getChapterPlotDetailDto.mockResolvedValue(buildChapterPlotDetail());
        const profile = new WriterProfile();
        const preparedRun = await profile.prepare(createWriterRuntime({
            profile,
            workspace,
            skillCatalog: [{
                name: "SkillShouldNotAppear",
                description: "不应出现在 writer prompt",
                headerText: "name: SkillShouldNotAppear\ndescription: 不应出现",
                location: path.join(workspace, "SKILL.md"),
            }],
            tools: ["read_file", "skill", "report_result"],
        }));
        const texts = preparedRun.modelMessages.map((message) => message.text);
        const combined = texts.join("\n\n");
        const lorebookMessage = texts.find((text) => text.startsWith("以下是本轮写作的核心输入。")) ?? "";

        expect(texts[0]).toContain("<writing_reference>");
        expect(texts[0]).toContain("# 第1章 反派魔法少女");
        expect(texts[0]).not.toContain("key:");
        expect(combined).not.toContain("SkillShouldNotAppear");
        expect(combined).not.toContain("frontmatter.retrieval");
        expect(combined).not.toContain("inject.profiles");
        expect(combined).not.toContain("frontmatter.inject");
        expect(combined).not.toContain("frontmatter.ext");
        expect(combined).not.toContain("<thread_title>");
        expect(combined).not.toContain("<current_chapter>");
        expect(combined).not.toContain("<active_panel>");
        expect(combined).not.toContain("<workspace>");
        expect(combined).toContain("Writer 是 ReAct 子代理");
        expect(combined).toContain("write_file");
        expect(combined).toContain("润色复查");
        expect(combined).toContain("最后必须调用 report_result");
        expect(combined).toContain("Scene 1: 场景一");
        expect(combined).toContain("sceneId: 1");
        expect(combined).toContain("### Plots");
        expect(combined).toContain("scene-1-summary");
        expect(lorebookMessage).toContain("title: 测试角色");
        expect(lorebookMessage).toContain("status: active");
        expect(lorebookMessage).toContain("knowledge:");
        expect(lorebookMessage).toContain("reason: 测试注入原因");
        expect(lorebookMessage).not.toContain("priority:");
        expect(lorebookMessage).not.toContain("retrieval:");
        expect(lorebookMessage).not.toContain("inject:");
        expect(lorebookMessage).not.toContain("governance:");
        expect(lorebookMessage).not.toContain("ext:");
        expect(lorebookMessage).not.toContain("icon:");
    });

    it("找不到 scene 时会在准备阶段失败", async () => {
        const workspace = await createWorkspace();
        mockPlotFacade.getStorySceneDetailDto.mockRejectedValue(new Error("Scene not found: 999"));
        const profile = new WriterProfile();

        await expect(profile.prepare(createWriterRuntime({
            profile,
            workspace,
            plotPoints: ["999"],
        }))).rejects.toThrow("writer 无法解析 plotPoints[0] 场景 999");
    });

    it("找不到内容节点时会在准备阶段失败", async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "writer-profile-missing-node-"));
        createdWorkspacePaths.push(workspace);
        mockPlotFacade.getStorySceneDetailDto.mockResolvedValue(buildSceneDetail());
        mockPlotFacade.getStoryThreadDetailDto.mockResolvedValue(buildThreadDetail());
        mockPlotFacade.getChapterPlotDetailDto.mockResolvedValue(buildChapterPlotDetail());
        const profile = new WriterProfile();

        await expect(profile.prepare(createWriterRuntime({
            profile,
            workspace,
        }))).rejects.toThrow("writer 无法解析 lorebookEntries 节点 lorebook/character/test/");
    });
});

/**
 * 创建包含内容节点的临时 workspace。
 */
async function createWorkspace(): Promise<string> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "writer-profile-"));
    createdWorkspacePaths.push(workspace);
    const nodeDirectory = path.join(workspace, "lorebook", "character", "test");
    await fs.mkdir(nodeDirectory, {recursive: true});
    await fs.writeFile(path.join(nodeDirectory, "index.md"), `---
title: 测试角色
type: character
status: active
icon: user
aliases:
  - 小测
tags:
  - 测试
summary: 用于验证 writer frontmatter 过滤的角色。
refs:
  - relation: mentions
    target: lorebook/location/test/
    note: 测试引用
retrieval:
  enabled: true
  trigger: null
inject:
  profiles:
    - subagent.writer
  always: true
governance:
  source: manual
  review: proposed
ext:
  internalOnly: true
---

## 正文

这是角色正文。
`, "utf-8");
    await fs.writeFile(path.join(nodeDirectory, "state.md"), `---
statusNote: 当前正在验证 writer 注入。
updatedAt: null
knowledge:
  - 测试角色知道自己的测试任务。
ext:
  hidden: true
---

当前状态正文。
`, "utf-8");
    await fs.writeFile(path.join(workspace, "SKILL.md"), "---\nname: SkillShouldNotAppear\ndescription: 不应出现\n---\n正文", "utf-8");
    return workspace;
}

/**
 * 创建 writer profile runtime。
 */
function createWriterRuntime(input: {
    profile: WriterProfile;
    workspace: string;
    history?: BaseMessage[];
    skillCatalog?: readonly SkillCatalogItem[];
    tools?: ToolKey[];
    plotPoints?: string[];
}): ProfileContextRuntime<"subagent.writer", AgentProfile<"subagent.writer">> {
    const runtimeInput: ProfileInputMap["subagent.writer"] = {
        prompt: "写一段测试正文。",
        plotPoints: input.plotPoints ?? ["1"],
        lorebookEntries: [{
            path: "lorebook/character/test/",
            priority: 1,
            reason: "测试注入原因",
        }],
        constraints: ["保持第三人称。"],
    };

    return {
        thread: createThreadRecord({
            profileKey: "subagent.writer",
        }),
        profile: input.profile,
        input: runtimeInput,
        scope: {
            ide: {
                panel: null,
                activePanel: "should-not-render",
                theme: null,
                extra: {},
            },
            studio: {
                novelId: "1",
                selectedChapterId: null,
                previousSelectedChapterId: null,
                currentChapterTitle: "should-not-render",
                previousChapterTitle: null,
                currentChapterLabel: null,
                previousChapterLabel: null,
                workspace: input.workspace,
                workspaceKind: "novel",
                didSwitchChapter: false,
                selectionVersion: null,
                extra: {},
            },
            agent: {
                thread: {
                    id: "writer-thread",
                    title: "should-not-render",
                    summary: "",
                    status: "idle",
                },
                profileKey: "subagent.writer" as const,
                kind: "subagent" as const,
                tools: input.tools ?? ["read_file", "edit_file", "apply_patch", "write_file", "report_result"],
                subagents: [],
                tasks: null,
            },
            input: runtimeInput,
        },
        skillCatalog: input.skillCatalog ?? [],
        options: {},
        messageStore: {} as never,
        loadHistoryMessages: async () => input.history ?? [],
        threadRepository: {} as never,
        variableStore: {} as never,
    };
}

/**
 * 构造测试用 Scene 详情。
 */
function buildSceneDetail() {
    return {
        id: "1",
        storyId: "100",
        threadId: "11",
        chapterPath: "manuscript/chapter-1/",
        threadSortOrder: 0,
        chapterSortOrder: 0,
        title: "场景一",
        status: "active",
        summary: "scene-1-summary",
        purpose: "scene-1-purpose",
        writingTip: "scene-1-writing-tip",
        note: "scene-1-note",
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
        plots: [{
            id: "plot-1",
            sceneId: "1",
            sortOrder: 0,
            kind: "setup",
            summary: "plot-1-summary",
            effect: "plot-1-effect",
            writingTip: "plot-1-writing-tip",
            note: "plot-1-note",
            createdAt: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:00.000Z",
        }],
        refs: [{
            id: "ref-1",
            relation: "mentions",
            target: "lorebook/character/test/",
            visibility: "reader",
            note: "scene-ref-note",
        }],
        effectiveRefs: [],
    };
}

/**
 * 构造测试用 Thread 详情。
 */
function buildThreadDetail() {
    return {
        id: "11",
        storyId: "100",
        storyPhaseId: null,
        sortOrder: 0,
        name: "thread-1",
        title: "线程一",
        isMainThread: true,
        status: "active",
        summary: "thread-summary",
        tags: ["tag-1"],
        writingTip: "thread-writing-tip",
        note: "thread-note",
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
        refs: [],
    };
}

/**
 * 构造测试用 Chapter Plot 详情。
 */
function buildChapterPlotDetail() {
    return {
        chapterPath: "manuscript/chapter-1/",
        totalScenes: 1,
        totalPlots: 1,
        scenes: [{
            id: "1",
            threadId: "11",
            threadTitle: "线程一",
            threadIsMain: true,
            chapterPath: "manuscript/chapter-1/",
            chapterSortOrder: 0,
            threadSortOrder: 0,
            title: "场景一",
            status: "active",
            summary: "chapter-scene-summary",
            purpose: "chapter-scene-purpose",
            plots: [{
                id: "plot-1",
                sceneId: "1",
                sortOrder: 0,
                kind: "setup",
                summary: "chapter-plot-summary",
                effect: "chapter-plot-effect",
                writingTip: "chapter-plot-writing-tip",
                note: "chapter-plot-note",
                createdAt: "2026-05-15T00:00:00.000Z",
                updatedAt: "2026-05-15T00:00:00.000Z",
            }],
        }],
    };
}
