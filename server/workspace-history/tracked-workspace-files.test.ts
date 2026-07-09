import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import os from "node:os";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest, resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceAssetRootContextForTest} from "nbook/server/workspace-files/workspace-assets-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    ensureProjectHistory,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    workspaceHistoryResourceOwner,
} from "nbook/server/workspace-history/project-history";
import {
    USER_LOCAL_ACTOR,
    convertWorkspaceFileToDirectoryTracked,
    createWorkspaceDirectoryTracked,
    createWorkspaceFileTracked,
    deleteWorkspacePathTracked,
    recordUploadedFiles,
    renameWorkspacePathTracked,
    writeWorkspaceTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";

describe("tracked-workspace-files 写面记账", () => {
    let tempRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        // reset 清空了 owner 注册表：把 history 属主重新挂回，级联关闭才可用。
        registerProjectResourceOwner(workspaceHistoryResourceOwner);
        setHistoryEnabledOverrideForTest(true);
        tempRoot = join(os.tmpdir(), `neuro-book-tracked-files-test-${randomUUID()}`);
        await mkdir(join(tempRoot, "workspace"), {recursive: true});
        setWorkspaceAssetRootContextForTest({workspaceContainerRoot: join(tempRoot, "workspace")});
        // 核心写函数按 cwd 解析 `workspace/<slug>`：把 cwd 指到临时根，与 history 侧解析在 tempRoot 汇合。
        vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceAssetRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    /** 建一个可 open 的真实 Project 并 open。返回 `workspace/<slug>`（与路由 root 同形）。 */
    async function openTempProject(slug: string): Promise<string> {
        const projectPath = `workspace/${slug}`;
        await writeProjectManifest(projectPath, {kind: "novel", title: slug, summary: ""});
        await openProjectForTest(projectPath);
        return projectPath;
    }

    it("写文件：首写补 before 建 create 账，二写复用 knownBefore 记 edit", async () => {
        const projectPath = await openTempProject("write");
        await writeWorkspaceTextFileTracked({
            root: projectPath, filePath: "manuscript/ch1.md",
            content: "正文 v1", actor: USER_LOCAL_ACTOR,
        });
        // 冲突检测路径：调用方已读到旧内容，作为 knownBefore 传入（不再读盘）
        await writeWorkspaceTextFileTracked({
            root: projectPath, filePath: "manuscript/ch1.md",
            content: "正文 v2", actor: USER_LOCAL_ACTOR, knownBefore: "正文 v1",
        });

        const history = (await ensureProjectHistory(projectPath))!;
        const timeline = await history.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.edit"]);
        expect(timeline[1]!.entry.actor).toEqual(USER_LOCAL_ACTOR);
        expect(timeline[1]!.bodyAvailable).toEqual({before: true, after: true});
    });

    it("convert 文件转目录 = 一条 rename：时间线跨转换连续", async () => {
        const projectPath = await openTempProject("convert");
        await createWorkspaceFileTracked({root: projectPath, filePath: "lorebook/hero.md", content: "英雄设定", actor: USER_LOCAL_ACTOR});
        await convertWorkspaceFileToDirectoryTracked({root: projectPath, filePath: "lorebook/hero.md", actor: USER_LOCAL_ACTOR});

        const history = (await ensureProjectHistory(projectPath))!;
        const timeline = await history.timeline("lorebook/hero/index.md", {followRenames: true});
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.rename"]);
        expect(timeline[0]!.pathAtThatTime).toBe("lorebook/hero.md");
        // 旧路径不算删除（活在新名下）
        expect(await history.deletedFiles()).toEqual([]);
    });

    it("目录 rename 展开为目录内逐文件 rename", async () => {
        const projectPath = await openTempProject("rename-dir");
        await createWorkspaceFileTracked({root: projectPath, filePath: "lorebook/npc/a.md", content: "甲", actor: USER_LOCAL_ACTOR});
        await createWorkspaceFileTracked({root: projectPath, filePath: "lorebook/npc/b.md", content: "乙", actor: USER_LOCAL_ACTOR});
        await renameWorkspacePathTracked({root: projectPath, fromPath: "lorebook/npc", toPath: "lorebook/cast", actor: USER_LOCAL_ACTOR});

        const history = (await ensureProjectHistory(projectPath))!;
        for (const name of ["a.md", "b.md"]) {
            const timeline = await history.timeline(`lorebook/cast/${name}`, {followRenames: true});
            expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.rename"]);
        }
    });

    it("目录删除展开为逐文件 delete：before 快照可找回", async () => {
        const projectPath = await openTempProject("delete-dir");
        await createWorkspaceFileTracked({root: projectPath, filePath: "lorebook/npc/a.md", content: "正文A", actor: USER_LOCAL_ACTOR});
        await createWorkspaceFileTracked({root: projectPath, filePath: "lorebook/npc/b.md", content: "正文B", actor: USER_LOCAL_ACTOR});
        await deleteWorkspacePathTracked({root: projectPath, filePath: "lorebook/npc", recursive: true, actor: USER_LOCAL_ACTOR});

        const history = (await ensureProjectHistory(projectPath))!;
        expect((await history.deletedFiles()).map((f) => f.path).sort()).toEqual(["lorebook/npc/a.md", "lorebook/npc/b.md"]);

        const timeline = await history.timeline("lorebook/npc/a.md");
        const last = timeline[timeline.length - 1]!;
        expect(last.entry.operation.type).toBe("file.delete");
        if (last.entry.operation.type !== "file.delete") {
            throw new Error("unreachable");
        }
        const body = await history.snapshotBody(last.entry.operation.beforeHash);
        expect(new TextDecoder().decode(body!)).toBe("正文A");
    });

    it("createDirectory 附带 index 内容记账（目录本身不是账面对象）", async () => {
        const projectPath = await openTempProject("mkdir");
        await createWorkspaceDirectoryTracked({root: projectPath, dirPath: "lorebook/组织", indexContent: "# 组织", actor: USER_LOCAL_ACTOR});

        const history = (await ensureProjectHistory(projectPath))!;
        const timeline = await history.timeline("lorebook/组织/index.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create"]);
    });

    it("upload 记账：仅 written 入账，二进制自动降级 hash-only", async () => {
        const projectPath = await openTempProject("upload");
        const absoluteRoot = resolveProjectAbsolutePath(projectPath);
        await mkdir(join(absoluteRoot, "upload"), {recursive: true});
        await writeFile(join(absoluteRoot, "upload", "a.md"), "文本内容", "utf-8");
        await writeFile(join(absoluteRoot, "upload", "b.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));

        await recordUploadedFiles({
            root: projectPath,
            files: [
                {path: "upload/a.md", size: 12, action: "written"},
                {path: "upload/b.png", size: 4, action: "written"},
                {path: "upload/skip.md", size: 2, action: "skipped"},
            ],
            actor: USER_LOCAL_ACTOR,
        });

        const history = (await ensureProjectHistory(projectPath))!;
        const textTimeline = await history.timeline("upload/a.md");
        expect(textTimeline).toHaveLength(1);
        expect(textTimeline[0]!.bodyAvailable.after).toBe(true);
        // 含 NUL 字节 → 模块只记 hash 行，不存 body
        const binaryTimeline = await history.timeline("upload/b.png");
        expect(binaryTimeline).toHaveLength(1);
        expect(binaryTimeline[0]!.bodyAvailable.after).toBe(false);
        expect(await history.timeline("upload/skip.md")).toHaveLength(0);
    });
});
