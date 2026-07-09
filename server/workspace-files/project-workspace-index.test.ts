import {describe, expect, it} from "vitest";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {
    isIgnoredWorkspaceWatchPath,
    onProjectWorkspaceFileChange,
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
