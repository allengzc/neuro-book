import type {H3Event} from "h3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushServerTiming} from "nbook/server/utils/server-timing";
import type {NovelListDiagnostics} from "nbook/server/utils/novel-chapter";

const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const listNovelsMock = vi.fn();
const warnMock = vi.fn();

vi.mock("nbook/server/utils/novel-chapter", () => ({
    listNovels: listNovelsMock,
}));

vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {
        warn: warnMock,
    },
}));

vi.mock("h3", async (importOriginal) => ({
    ...await importOriginal<typeof import("h3")>(),
    getQuery: (event: {query?: Record<string, unknown>}) => event.query ?? {},
}));

describe("GET /api/projects", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
        vi.restoreAllMocks();
    });

    it("把 query、Server-Timing sink 和 diagnostics 传给 Project 列表服务", async () => {
        listNovelsMock.mockImplementation(async (options: {
            limit?: number;
            includeProjectPaths?: string[];
            excludeProjectPathPrefixes?: string[];
            timingSink?: {mark(name: string, durationMs: number): void};
            diagnostics?: NovelListDiagnostics;
        }) => {
            options.timingSink?.mark("projects.manifests", 1.2);
            options.timingSink?.mark("projects.total", 3.4);
            if (options.diagnostics) {
                options.diagnostics.cacheMode = "filtered";
                options.diagnostics.projectCount = 2;
                options.diagnostics.visibleCount = 1;
            }
            return [{id: "workspace/a"}];
        });
        const handler = (await import("nbook/server/api/projects/index.get")).default as (event: H3Event) => Promise<unknown>;
        const {event, headers} = createProjectsEvent({
            limit: "20",
            includeProjectPath: ["workspace/a", "workspace/b"],
            excludeProjectPathPrefix: "workspace/tmp-",
        });

        const result = await handler(event);
        flushServerTiming(event, {headers: {}});

        expect(result).toEqual([{id: "workspace/a"}]);
        expect(listNovelsMock).toHaveBeenCalledWith(expect.objectContaining({
            limit: 20,
            includeProjectPaths: ["workspace/a", "workspace/b"],
            excludeProjectPathPrefixes: ["workspace/tmp-"],
            timingSink: expect.objectContaining({mark: expect.any(Function)}),
            diagnostics: expect.any(Object),
        }));
        expect(headers["server-timing"]).toContain("projects.manifests;dur=1.2");
        expect(headers["server-timing"]).toContain("projects.total;dur=3.4");
        expect(warnMock).not.toHaveBeenCalled();
    });

    it("慢请求 warn 包含 query shape 和 cache diagnostics", async () => {
        vi.spyOn(performance, "now")
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(750);
        listNovelsMock.mockImplementation(async (options: {diagnostics?: NovelListDiagnostics}) => {
            if (options.diagnostics) {
                Object.assign(options.diagnostics, {
                    cacheMode: "default",
                    fullListCache: "pending",
                    projectListCache: "hit",
                    sessionCountCache: "hit",
                    projectCount: 12,
                    visibleCount: 12,
                    statsCacheHits: 10,
                    statsCacheMisses: 1,
                    statsCachePending: 1,
                } satisfies NovelListDiagnostics);
            }
            return [{id: "workspace/a"}];
        });
        const handler = (await import("nbook/server/api/projects/index.get")).default as (event: H3Event) => Promise<unknown>;
        const {event} = createProjectsEvent({includeProjectPath: "workspace/a"});

        await handler(event);

        expect(warnMock).toHaveBeenCalledWith("projects.list.slow", expect.objectContaining({
            durationMs: 750,
            queryShape: {
                hasLimit: false,
                includeProjectPathCount: 1,
                excludePrefixCount: 0,
            },
            projectCount: 12,
            visibleCount: 12,
            cache: {
                mode: "default",
                fullList: "pending",
                projectList: "hit",
                sessions: "hit",
                statsHits: 10,
                statsMisses: 1,
                statsPending: 1,
            },
        }), "Project 列表请求过慢");
    });
});

function createProjectsEvent(query: Record<string, unknown>): {event: H3Event; headers: Record<string, string>} {
    const headers: Record<string, string> = {};
    const event = {
        query,
        context: {},
        node: {
            res: {
                getHeader: (name: string) => headers[name.toLowerCase()],
                setHeader: (name: string, value: string) => {
                    headers[name.toLowerCase()] = value;
                },
                getHeaders: () => headers,
            },
        },
    } as unknown as H3Event;
    return {event, headers};
}
