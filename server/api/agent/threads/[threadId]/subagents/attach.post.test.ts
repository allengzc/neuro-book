import {beforeEach, describe, expect, it, vi} from "vitest";

describe("POST /api/agent/threads/[threadId]/subagents/attach", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("会把数字 subagentThreadId 归一化为字符串后挂载", async () => {
        const agentSystem = {
            syncClientVariables: vi.fn(async () => {}),
            attachSubAgent: vi.fn(async () => {}),
        };

        vi.doMock("nbook/server/agent/api", () => ({
            requireThreadId: vi.fn(() => "thread-1"),
            readClientVariablesHeader: vi.fn(() => ({studio: {workspace: "novel"}})),
        }));
        vi.doMock("nbook/server/utils/novel-chapter", async () => {
            const {AttachSubAgentThreadRequestDtoSchema} = await import("nbook/shared/dto/agent-chat.dto");
            return {
                validateBody: vi.fn(async () => AttachSubAgentThreadRequestDtoSchema.parse({
                    subagentThreadId: 203,
                })),
            };
        });
        vi.doMock("nbook/server/agent/http", () => ({
            useAgentSystem: () => agentSystem,
        }));

        const handler = (await import("nbook/server/api/agent/threads/[threadId]/subagents/attach.post")).default;
        const result = await handler({} as never);

        expect(agentSystem.syncClientVariables).toHaveBeenCalledWith("thread-1", {studio: {workspace: "novel"}});
        expect(agentSystem.attachSubAgent).toHaveBeenCalledWith("thread-1", "203");
        expect(result).toEqual({ok: true});
    });
});
