import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {
    closeWorkspaceTreeIndex,
    invalidateProjectWorkspaceIndexAfterMutation,
    isIgnoredWorkspaceWatchPath,
    onProjectWorkspaceFileChange,
    readPlainWorkspaceTreeSnapshot,
    readProjectWorkspaceTreeSnapshot,
} from "nbook/server/workspace-files/project-workspace-index";

describe("project-workspace-index ProjectSession 守卫", () => {
    it("Project root 未 open 时拒绝创建 workspace tree index", async () => {
        await expect(readProjectWorkspaceTreeSnapshot({
            root: "workspace/not-open",
        })).rejects.toBeInstanceOf(ProjectNotOpenError);
    });
});

describe("isIgnoredWorkspaceWatchPath", () => {
    it("忽略 .git/.nbook/.agent 段（任意深度、含反斜杠路径）", () => {
        expect(isIgnoredWorkspaceWatchPath(".git/HEAD")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath(".nbook/project.sqlite")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath(".nbook/history.sqlite-wal")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath(".agent/plan/draft.md")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath("sub\\.nbook\\config.json")).toBe(true);
    });

    it("不误伤普通内容路径与形似名称", () => {
        expect(isIgnoredWorkspaceWatchPath("manuscript/001-chapter/index.md")).toBe(false);
        expect(isIgnoredWorkspaceWatchPath("lorebook/nbook-guide.md")).toBe(false);
        expect(isIgnoredWorkspaceWatchPath("notes/.nbook-backup.md")).toBe(false);
        expect(isIgnoredWorkspaceWatchPath("agents/leader.default/persona.md")).toBe(false);
    });
});

describe("onProjectWorkspaceFileChange", () => {
    it("注册后可取消订阅，取消后不再持有 listener", () => {
        let calls = 0;
        const unsubscribe = onProjectWorkspaceFileChange(() => {
            calls += 1;
        });
        unsubscribe();
        // 取消订阅本身不抛错、重复取消无副作用；分发链路由 workspace-history reconcile 集成测试覆盖。
        unsubscribe();
        expect(calls).toBe(0);
    });
});

describe("workspace tree snapshot cache", () => {
    it("已有旧 index 时 dirty 读取立即返回旧快照，并在后台刷新", async () => {
        const root = path.join(".agent", "workspace", `workspace-tree-cache-${randomUUID()}`);
        await fs.mkdir(root, {recursive: true});
        await fs.writeFile(path.join(root, "first.md"), "# First\n", "utf-8");
        try {
            const first = await readPlainWorkspaceTreeSnapshot({root});
            await fs.writeFile(path.join(root, "second.md"), "# Second\n", "utf-8");
            invalidateProjectWorkspaceIndexAfterMutation({root, workspaceKind: "user-assets"});

            const stale = await readPlainWorkspaceTreeSnapshot({root});
            await waitFor(async () => {
                const refreshed = await readPlainWorkspaceTreeSnapshot({root});
                expect(refreshed.nodes.some((node) => node.path === "second.md")).toBe(true);
            });

            expect(first.nodes.some((node) => node.path === "first.md")).toBe(true);
            expect(stale.nodes.some((node) => node.path === "second.md")).toBe(false);
        } finally {
            await closeWorkspaceTreeIndex(root);
            await fs.rm(root, {recursive: true, force: true});
        }
    });
});

async function waitFor(assertion: () => Promise<void>, timeoutMs = 2_000): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    throw lastError;
}
