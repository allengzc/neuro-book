import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {AgentSessionListQueryDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {initProjectDatabase, readProjectManifest, resolveProjectDatabasePath, writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {closeWorkspaceTreeIndex} from "nbook/server/workspace-files/project-workspace-index";
import {writeWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {invalidateNovelListCache, listNovels} from "nbook/server/utils/novel-chapter";

class FilteringSessionProvider {
    constructor(private readonly sessions: AgentSessionSummaryDto[]) {}

    /**
     * 模拟 Agent session 列表筛选，覆盖书架统计依赖的 projectPath / archived / systemRole 条件。
     */
    async listSessions(input: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> {
        return this.sessions.filter((session) => {
            if (input.projectPath && session.projectPath !== input.projectPath) {
                return false;
            }
            if (!input.includeArchived && session.archived) {
                return false;
            }
            if (!input.includeSystem && session.systemRole) {
                return false;
            }
            if (input.status === "active") {
                return !session.archived;
            }
            if (input.status && input.status !== "all" && session.status !== input.status) {
                return false;
            }
            return true;
        });
    }
}

describe("novel-chapter project list statistics", () => {
    const originalCwd = process.cwd();
    let root: string;

    beforeEach(async () => {
        root = path.join(os.tmpdir(), "neuro-book-novel-list-test", randomUUID());
        await fs.mkdir(path.join(root, "assets", "workspace", ".nbook"), {recursive: true});
        process.chdir(root);
    });

    afterEach(async () => {
        invalidateNovelListCache();
        await closeWorkspaceTreeIndex(path.join(root, "workspace", "novel-a"));
        await closeWorkspaceTreeIndex(path.join(root, "workspace", "novel-b"));
        await closeWorkspaceTreeIndex(path.join(root, "workspace", "empty-plot"));
        await closeWorkspaceTreeIndex(path.join(root, "workspace", "world-engine-test-hidden"));
        await closeWorkspaceTreeIndex(path.join(root, "workspace", "world-engine-api-test-selected"));
        process.chdir(originalCwd);
        await removeDirectoryWithRetry(root);
    });

    it("从 Project Workspace 与 Agent session 汇总书架统计", async () => {
        const projectPath = "workspace/novel-a";
        await writeProjectManifest(projectPath, {
            kind: "novel",
            title: "统计测试",
            summary: "项目简介",
        });
        await writeMarkdown(projectPath, "manuscript/001-volume/index.md", {
            title: "第一卷",
            type: "volume",
        }, "卷简介");
        await writeMarkdown(projectPath, "manuscript/001-volume/001-chapter/index.md", {
            title: "第一章",
            type: "chapter",
        }, "正文一二三");
        await writeMarkdown(projectPath, "manuscript/001-volume/002-chapter/index.md", {
            title: "第二章",
            type: "chapter",
        }, "第二章正文");
        await writeMarkdown(projectPath, "lorebook/index.md", {
            title: "设定根",
        }, "根目录说明不算 lorebook 条目");
        await writeMarkdown(projectPath, "lorebook/character/hero/index.md", {
            title: "主角",
            type: "character",
        }, "角色设定");
        await writeMarkdown(projectPath, "lorebook/location/city/index.md", {
            title: "城市",
            type: "location",
        }, "地点设定");

        const provider = new FilteringSessionProvider([
            createSessionSummary({sessionId: 1, projectPath}),
            createSessionSummary({sessionId: 2, projectPath, archived: true}),
            createSessionSummary({sessionId: 3, projectPath, systemRole: "summarizer"}),
            createSessionSummary({sessionId: 4, projectPath: "workspace/other"}),
        ]);

        const [novel] = await listNovels({sessionProvider: provider});

        expect(novel).toMatchObject({
            id: projectPath,
            title: "统计测试",
            volumeCount: 1,
            chapterCount: 2,
            totalWords: "正文一二三".length + "第二章正文".length,
            lorebookCount: 2,
            sessionCount: 1,
            threadCount: 0,
            sceneCount: 0,
            plotCount: 0,
        });
    });

    it("Project SQLite 不存在或没有 Story 时 Plot 统计为 0 且不创建 Story", async () => {
        const projectPath = "workspace/empty-plot";
        await writeProjectManifest(projectPath, {
            kind: "novel",
            title: "空剧情",
            summary: "",
        });

        const [beforeInit] = await listNovels({
            sessionProvider: new FilteringSessionProvider([]),
        });

        expect(beforeInit?.threadCount).toBe(0);
        expect(beforeInit?.sceneCount).toBe(0);
        expect(beforeInit?.plotCount).toBe(0);

        await initProjectDatabase(projectPath);
        const [afterInit] = await listNovels({
            sessionProvider: new FilteringSessionProvider([]),
        });

        expect(afterInit?.threadCount).toBe(0);
        expect(afterInit?.sceneCount).toBe(0);
        expect(afterInit?.plotCount).toBe(0);
        await expect(readProjectManifest(projectPath)).resolves.toEqual({
            kind: "novel",
            title: "空剧情",
            summary: "",
        });
        await expect(fs.stat(resolveProjectDatabasePath(projectPath))).resolves.toBeTruthy();
    });

    it("默认列表读取使用短 TTL 缓存，失效后重新汇总", async () => {
        const projectPath = "workspace/novel-a";
        await writeProjectManifest(projectPath, {
            kind: "novel",
            title: "缓存测试",
            summary: "",
        });
        const repo = new JsonlSessionRepository(path.join(root, "workspace"));
        await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath,
        });

        const first = await listNovels();
        expect(first[0]?.sessionCount).toBe(1);

        await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath,
        });

        const cached = await listNovels();
        expect(cached[0]?.sessionCount).toBe(1);

        invalidateNovelListCache();
        const refreshed = await listNovels();
        expect(refreshed[0]?.sessionCount).toBe(2);
    });

    it("includeProjectPath-only 与默认完整列表共享短缓存", async () => {
        const projectPath = "workspace/novel-a";
        await writeProjectManifest(projectPath, {
            kind: "novel",
            title: "include 缓存测试",
            summary: "",
        });
        const repo = new JsonlSessionRepository(path.join(root, "workspace"));
        await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath,
        });

        const firstDiagnostics = {};
        const timingMarks: string[] = [];
        const first = await listNovels({
            includeProjectPaths: [projectPath],
            diagnostics: firstDiagnostics,
            timingSink: {
                mark(name) {
                    timingMarks.push(name);
                },
            },
        });
        expect(first[0]?.sessionCount).toBe(1);
        expect(firstDiagnostics).toMatchObject({
            cacheMode: "default",
            fullListCache: "miss",
        });
        expect(timingMarks).toEqual(expect.arrayContaining([
            "projects.manifests",
            "projects.sessions",
            "projects.filter",
            "projects.stats.workspace",
            "projects.stats.plot",
            "projects.total",
        ]));

        await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath,
        });

        const secondDiagnostics = {};
        const cached = await listNovels({
            includeProjectPaths: [projectPath],
            diagnostics: secondDiagnostics,
        });
        expect(cached[0]?.sessionCount).toBe(1);
        expect(secondDiagnostics).toMatchObject({
            cacheMode: "default",
            fullListCache: "hit",
        });

        invalidateNovelListCache();
        const refreshed = await listNovels({includeProjectPaths: [projectPath]});
        expect(refreshed[0]?.sessionCount).toBe(2);
    });

    it("并发默认列表等待 pending 时记录等待分段", async () => {
        await writeProjectManifest("workspace/novel-a", {
            kind: "novel",
            title: "并发默认列表",
            summary: "",
        });
        const firstTiming = createTimingRecorder();
        const secondTiming = createTimingRecorder();
        const first = listNovels({timingSink: firstTiming.sink});
        const secondDiagnostics = {};
        const second = listNovels({
            diagnostics: secondDiagnostics,
            timingSink: secondTiming.sink,
        });

        await Promise.all([first, second]);

        expect(secondDiagnostics).toMatchObject({
            cacheMode: "default",
            fullListCache: "pending",
        });
        expect(timingNames(secondTiming.marks)).toEqual(expect.arrayContaining([
            "projects.manifests",
            "projects.sessions",
            "projects.stats.workspace",
            "projects.stats.plot",
            "projects.pending.fullList",
            "projects.total",
        ]));
    });

    it("并发过滤列表等待 manifest/session pending 时记录对应分段", async () => {
        await writeProjectManifest("workspace/novel-a", {
            kind: "novel",
            title: "并发过滤 A",
            summary: "",
        });
        const firstTiming = createTimingRecorder();
        const secondTiming = createTimingRecorder();
        const first = listNovels({limit: 1, timingSink: firstTiming.sink});
        const secondDiagnostics = {};
        const second = listNovels({
            limit: 1,
            diagnostics: secondDiagnostics,
            timingSink: secondTiming.sink,
        });

        await Promise.all([first, second]);

        expect(secondDiagnostics).toMatchObject({
            cacheMode: "filtered",
            projectListCache: "pending",
            sessionCountCache: "pending",
        });
        expect(timingNames(secondTiming.marks)).toEqual(expect.arrayContaining([
            "projects.manifests",
            "projects.sessions",
            "projects.total",
        ]));
    });

    it("并发统计等待 project stats pending 时记录等待分段", async () => {
        await writeProjectManifest("workspace/novel-a", {
            kind: "novel",
            title: "并发统计",
            summary: "",
        });
        await listNovels({limit: 0});

        const firstTiming = createTimingRecorder();
        const secondTiming = createTimingRecorder();
        const first = listNovels({limit: 1, timingSink: firstTiming.sink});
        const secondDiagnostics = {};
        const second = listNovels({
            limit: 1,
            diagnostics: secondDiagnostics,
            timingSink: secondTiming.sink,
        });

        await Promise.all([first, second]);

        expect(secondDiagnostics).toMatchObject({
            statsCachePending: 1,
        });
        expect(timingNames(secondTiming.marks)).toContain("projects.stats.pending");
    });

    it("支持按 Preview 入口裁剪 Project 列表并补回当前选择", async () => {
        await writeProjectManifest("workspace/novel-a", {
            kind: "novel",
            title: "普通项目 A",
            summary: "",
        });
        await writeProjectManifest("workspace/novel-b", {
            kind: "novel",
            title: "普通项目 B",
            summary: "",
        });
        await writeProjectManifest("workspace/world-engine-test-hidden", {
            kind: "novel",
            title: "应被排除的测试项目",
            summary: "",
        });
        await writeProjectManifest("workspace/world-engine-api-test-selected", {
            kind: "novel",
            title: "当前选中的测试项目",
            summary: "",
        });

        const diagnostics = {};
        const timing = createTimingRecorder();
        const projects = await listNovels({
            sessionProvider: new FilteringSessionProvider([]),
            limit: 1,
            excludeProjectPathPrefixes: ["workspace/world-engine-test-", "workspace/world-engine-api-test-"],
            includeProjectPaths: ["workspace/world-engine-api-test-selected"],
            diagnostics,
            timingSink: timing.sink,
        });

        expect(projects.map((project) => project.projectPath)).toContain("workspace/world-engine-api-test-selected");
        expect(projects.map((project) => project.projectPath)).not.toContain("workspace/world-engine-test-hidden");
        expect(projects.filter((project) => project.projectPath !== "workspace/world-engine-api-test-selected")).toHaveLength(1);
        expect(diagnostics).toMatchObject({
            cacheMode: "custom",
            visibleCount: 2,
            statsCacheMisses: 2,
        });
        expect(timingDuration(timing.marks, "projects.stats.workspace")).toBeLessThanOrEqual(timingDuration(timing.marks, "projects.total"));
        expect(timingDuration(timing.marks, "projects.stats.plot")).toBeLessThanOrEqual(timingDuration(timing.marks, "projects.total"));
    });
});

describe("JsonlSessionRepository projectPath filter", () => {
    let root: string;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = path.join(os.tmpdir(), "neuro-book-session-filter-test", randomUUID());
        repo = new JsonlSessionRepository(root);
    });

    afterEach(async () => {
        await removeDirectoryWithRetry(root);
    });

    it("按 projectPath 筛选 session，并在摘要中保留 projectPath", async () => {
        const target = await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath: "workspace/novel-a",
        });
        await repo.createSession({
            profileKey: "leader.default",
            input: {},
            workspaceRoot: "workspace",
            workspaceKey: "global",
            projectPath: "workspace/novel-b",
        });

        const sessions = await repo.listSessions({projectPath: "workspace/novel-a"});

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            sessionId: target.metadata.sessionId,
            projectPath: "workspace/novel-a",
        });
    });
});

function createSessionSummary(input: {
    sessionId: number;
    projectPath: string;
    archived?: boolean;
    systemRole?: "summarizer";
}): AgentSessionSummaryDto {
    return {
        sessionId: input.sessionId,
        profileKey: "leader.default",
        workspaceKey: "global",
        workspaceRoot: "workspace",
        projectPath: input.projectPath,
        systemRole: input.systemRole,
        status: input.archived ? "archived" : "idle",
        updatedAt: input.sessionId,
        archived: input.archived ?? false,
    };
}

async function writeMarkdown(projectPath: string, filePath: string, frontmatter: Record<string, string>, body: string): Promise<void> {
    const yaml = Object.entries(frontmatter)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join("\n");
    await writeWorkspaceTextFile(resolveProjectRoot(projectPath), filePath, `---\n${yaml}\n---\n\n${body}`);
}

function resolveProjectRoot(projectPath: string): string {
    return path.join(process.cwd(), projectPath);
}

type TimingMark = {
    name: string;
    durationMs: number;
};

function createTimingRecorder(): {marks: TimingMark[]; sink: {mark(name: string, durationMs: number): void}} {
    const marks: TimingMark[] = [];
    return {
        marks,
        sink: {
            mark(name, durationMs) {
                marks.push({name, durationMs});
            },
        },
    };
}

function timingNames(marks: readonly TimingMark[]): string[] {
    return marks.map((mark) => mark.name);
}

function timingDuration(marks: readonly TimingMark[], name: string): number {
    const mark = marks.find((item) => item.name === name);
    expect(mark).toBeDefined();
    return mark?.durationMs ?? 0;
}

async function removeDirectoryWithRetry(target: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await fs.rm(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
            return;
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
            if (code !== "EBUSY" || attempt === 19) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
}
