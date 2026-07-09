import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref, watch} from "vue";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

type FetchMock = ReturnType<typeof vi.fn>;

describe("useNovelIdeStore deleteNovel", () => {
    beforeAll(() => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        globals.defineStore = defineStore;
        globals.ref = ref;
        globals.computed = computed;
        globals.watch = watch;
        globals.piniaPluginPersistedstate = {
            sessionStorage: () => ({}),
        };
    });

    beforeEach(() => {
        setActivePinia(createPinia());
        (globalThis as typeof globalThis & {$fetch: typeof globalThis.$fetch}).$fetch = createFetchMock() as unknown as typeof globalThis.$fetch;
    });

    it("删除非当前书后清理对应 workspace session", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentNovelId = "workspace/current-book";
        store.novels = [
            createNovel("workspace/current-book"),
            createNovel("workspace/deleted-book"),
        ];
        store.workspaceSessions = {
            "novel:workspace/current-book": createWorkspaceSession("manuscript/current.md"),
            "novel:workspace/deleted-book": createWorkspaceSession("manuscript/deleted.md"),
        };

        await store.deleteNovel("workspace/deleted-book");

        expect(store.workspaceSessions["novel:workspace/deleted-book"]).toBeUndefined();
        expect(store.workspaceSessions["novel:workspace/current-book"]).toBeDefined();
        expect(store.currentNovelId).toBe("workspace/current-book");
    });

    it("删除当前书后不会把旧 workspace session 重新写回", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentNovelId = "workspace/deleted-book";
        store.novels = [
            createNovel("workspace/deleted-book"),
            createNovel("workspace/next-book"),
        ];
        store.activeWorkspaceTabPath = "manuscript/deleted.md";
        store.workspaceTabs = [{
            path: "manuscript/deleted.md",
            title: "旧标签",
            editorKind: "markdown" as const,
            viewMode: "rich" as const,
            pinned: false,
            preview: false,
            dirty: false,
        }];
        store.workspaceSessions = {
            "novel:workspace/deleted-book": createWorkspaceSession("manuscript/deleted.md"),
            "novel:workspace/next-book": createWorkspaceSession("manuscript/next.md"),
        };

        await store.deleteNovel("workspace/deleted-book");

        expect(store.workspaceSessions["novel:workspace/deleted-book"]).toBeUndefined();
        expect(store.workspaceSessions["novel:workspace/next-book"]).toBeDefined();
        expect(store.currentNovelId).toBe("workspace/next-book");
        expect(store.activeWorkspaceTabPath).not.toBe("manuscript/deleted.md");
    });

    it("初始化主入口不发送 include-only 查询", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();
        store.currentNovelId = "workspace/current-book";

        await store.initializeWorkspace();

        expect(globalThis.$fetch).toHaveBeenCalledWith("/api/projects");
        expect(store.currentNovelId).toBe("workspace/current-book");
    });

    it("新建 Project 后刷新列表时包含新 Project，避免 route 规范化回旧书", async () => {
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const store = useNovelIdeStore();

        const createdId = await store.createNovel("新 Project", "");

        expect(createdId).toBe("workspace/created-book");
        expect(globalThis.$fetch).toHaveBeenCalledWith("/api/projects");
        expect(store.novels.some((novel) => novel.id === "workspace/created-book")).toBe(true);
    });
});

function createFetchMock(): FetchMock {
    let createdProjectVisible = false;
    return vi.fn(async (url: string, options?: {method?: string; query?: {includeProjectPath?: string}}) => {
        if (url === "/api/projects" && "method" in (options ?? {}) && (options as {method?: string}).method === "POST") {
            createdProjectVisible = true;
            return {id: "workspace/created-book"};
        }
        if (url === "/api/projects/item") {
            return {success: true};
        }
        if (url === "/api/projects") {
            const novels = [
                createNovel("workspace/next-book"),
                createNovel("workspace/current-book"),
            ];
            if (options?.query?.includeProjectPath === "workspace/ming-ding-zhi-shi-2") {
                novels.push(createNovel("workspace/ming-ding-zhi-shi-2"));
            }
            if (options?.query?.includeProjectPath === "workspace/created-book") {
                novels.push(createNovel("workspace/created-book"));
            }
            if (createdProjectVisible && !novels.some((novel) => novel.id === "workspace/created-book")) {
                novels.push(createNovel("workspace/created-book"));
            }
            return novels;
        }
        if (url === "/api/workspace-files/tree") {
            return {
                nodes: [],
                issues: [],
                revision: 1,
                validatedAt: new Date().toISOString(),
            };
        }
        throw new Error(`Unexpected fetch: ${url}`);
    });
}

function createNovel(id: string) {
    const workspaceSlug = id.split("/").at(-1) ?? id;
    return {
        id,
        title: workspaceSlug,
        summary: "",
        workspaceSlug,
        projectPath: id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        volumeCount: 0,
        chapterCount: 0,
        totalWords: 0,
        lorebookCount: 0,
        sessionCount: 0,
        threadCount: 0,
        sceneCount: 0,
        plotCount: 0,
    };
}

function createWorkspaceSession(path: string) {
    return {
        activeWorkspaceTabPath: path,
        workspaceTabs: [{
            path,
            title: path,
            editorKind: "markdown" as const,
            viewMode: "rich" as const,
            pinned: false,
            preview: false,
            dirty: false,
        }],
        workspaceBuffers: {},
        monacoFontSizeOverridesByPath: {},
    };
}
