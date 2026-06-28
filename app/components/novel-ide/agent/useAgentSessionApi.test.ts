import {afterEach, describe, expect, it, vi} from "vitest";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";

const globalWithFetch = globalThis as unknown as Record<string, unknown>;
let previousFetch: unknown;

describe("useAgentSessionApi", () => {
    afterEach(() => {
        globalWithFetch.$fetch = previousFetch;
        previousFetch = undefined;
    });

    it("getSessionRelations 请求轻量关联关系接口", async () => {
        const relations = {
            sessionId: 12,
            linkedAgents: [],
            linkedByAgents: [],
        };
        const fetchMock = vi.fn(async () => relations);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const api = useAgentSessionApi();

        await expect(api.getSessionRelations(12)).resolves.toEqual(relations);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/12/relations");
    });

    it("listSessions 返回分页结果", async () => {
        const page = {
            items: [],
            total: 0,
            offset: 0,
            limit: 50,
            hasMore: false,
        };
        const fetchMock = vi.fn(async () => page);
        previousFetch = globalWithFetch.$fetch;
        globalWithFetch.$fetch = fetchMock;

        const api = useAgentSessionApi();

        await expect(api.listSessions({workspaceKey: "global", limit: 50})).resolves.toEqual(page);
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions", {
            query: {workspaceKey: "global", limit: 50},
        });
    });
});
