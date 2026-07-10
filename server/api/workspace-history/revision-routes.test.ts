import {beforeEach, describe, expect, it, vi} from "vitest";
import type {InboxGroup, OperationLogEntry} from "nbook/server/vendor/nb-history/index";

describe("workspace history revision routes", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("diff 只读取请求指定的当前 revision", async () => {
        const textDiff = vi.fn(async () => ({
            available: true as const,
            changes: [{value: "old\n", removed: true, count: 1}, {value: "new\n", added: true, count: 1}],
            beforeText: "old\n",
            afterText: "new\n",
        }));
        mockGetQuery({projectPath: "workspace/book", path: "manuscript/a.md", revision: "7", mode: "inline"});
        mockHistory({inbox: vi.fn(async () => [group("manuscript/a.md", 7)]), textDiff});

        const handler = (await import("nbook/server/api/workspace-history/diff.get")).default;
        await expect(handler({} as never)).resolves.toMatchObject({status: "available", original: "old\n", modified: "new\n"});
        expect(textDiff).toHaveBeenCalledTimes(1);
    });

    it("diff revision 过期时返回 412，且不读取 snapshot 正文", async () => {
        const textDiff = vi.fn();
        mockGetQuery({projectPath: "workspace/book", path: "manuscript/a.md", revision: "6", mode: "inline"});
        mockHistory({inbox: vi.fn(async () => [group("manuscript/a.md", 7)]), textDiff});

        const handler = (await import("nbook/server/api/workspace-history/diff.get")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(textDiff).not.toHaveBeenCalled();
    });

    it("accept 与 revert 均拒绝 path 相同但 revision 已更新的分组", async () => {
        const history = {
            inbox: vi.fn(async () => [group("manuscript/a.md", 7)]),
            accept: vi.fn(),
            revert: vi.fn(),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectPath: "workspace/book", path: "manuscript/a.md", revision: 6})));

        const acceptHandler = (await import("nbook/server/api/workspace-history/accept.post")).default;
        await expect(acceptHandler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(history.accept).not.toHaveBeenCalled();

        vi.resetModules();
        mockHistory(history);
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectPath: "workspace/book", path: "manuscript/a.md", revision: 6})));
        const revertHandler = (await import("nbook/server/api/workspace-history/revert.post")).default;
        await expect(revertHandler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(history.revert).not.toHaveBeenCalled();
    });

    it("accept 与 revert 在 revision 匹配时只操作当前分组", async () => {
        const history = {
            inbox: vi.fn(async () => [group("manuscript/a.md", 7)]),
            accept: vi.fn(),
            revert: vi.fn(),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectPath: "workspace/book", path: "manuscript/a.md", revision: 7})));

        const acceptHandler = (await import("nbook/server/api/workspace-history/accept.post")).default;
        await expect(acceptHandler({} as never)).resolves.toEqual({success: true});
        expect(history.accept).toHaveBeenCalledWith("local", "manuscript/a.md");

        vi.resetModules();
        mockHistory(history);
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectPath: "workspace/book", path: "manuscript/a.md", revision: 7})));
        const revertHandler = (await import("nbook/server/api/workspace-history/revert.post")).default;
        await expect(revertHandler({} as never)).resolves.toEqual({success: true});
        expect(history.revert).toHaveBeenCalledWith("local", "manuscript/a.md");
    });

    it("accept-all 只接受用户确认过的 Inbox revision", async () => {
        const history = {
            inbox: vi.fn(async () => [group("manuscript/a.md", 7), group("manuscript/b.md", 9)]),
            accept: vi.fn(),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectPath: "workspace/book", revision: 7})));

        const handler = (await import("nbook/server/api/workspace-history/accept-all.post")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 412});
        expect(history.accept).not.toHaveBeenCalled();
    });

    it("accept-all 在 Inbox revision 匹配时接受当前全部分组", async () => {
        const history = {
            inbox: vi.fn(async () => [group("manuscript/a.md", 7), group("manuscript/b.md", 9)]),
            accept: vi.fn(),
        };
        mockHistory(history);
        vi.stubGlobal("readBody", vi.fn(async () => ({projectPath: "workspace/book", revision: 9})));

        const handler = (await import("nbook/server/api/workspace-history/accept-all.post")).default;
        await expect(handler({} as never)).resolves.toEqual({success: true, accepted: 2});
        expect(history.accept).toHaveBeenNthCalledWith(1, "local", "manuscript/a.md");
        expect(history.accept).toHaveBeenNthCalledWith(2, "local", "manuscript/b.md");
    });
});

/** 为 GET route 提供 h3 query，同时保留真实 createError 行为。 */
function mockGetQuery(query: Record<string, string>): void {
    vi.doMock("h3", async () => {
        const actual = await vi.importActual<typeof import("h3")>("h3");
        return {...actual, getQuery: () => query};
    });
}

/** 注入 Project Workspace 已打开且 history 可用的最小依赖。 */
function mockHistory(history: object): void {
    vi.doMock("nbook/server/workspace-files/project-open-guard", () => ({assertProjectOpenForRoot: vi.fn()}));
    vi.doMock("nbook/server/workspace-files/project-workspace", () => ({normalizeProjectPath: (value: string) => value}));
    vi.doMock("nbook/server/workspace-files/project-workspace-index", () => ({invalidateProjectWorkspaceIndexAfterMutation: vi.fn()}));
    vi.doMock("nbook/server/workspace-history/project-history", () => ({
        LOCAL_USER_ID: "local",
        ensureProjectHistory: vi.fn(async () => history),
    }));
}

/** 构造 route revision 测试使用的收件箱分组。 */
function group(path: string, revision: number): InboxGroup {
    return {
        path,
        baseHash: "before",
        endHash: "after",
        entries: [entry(revision, path)],
    };
}

/** 构造最小文件编辑条目。 */
function entry(id: number, path: string): OperationLogEntry {
    return {
        id,
        occurredAt: new Date(id * 1000).toISOString(),
        actor: {kind: "agent", sessionId: "7"},
        operation: {
            type: "file.edit",
            path,
            beforeHash: "before",
            afterHash: "after",
        },
    };
}
