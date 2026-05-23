import {describe, expect, it} from "vitest";
import {deriveMessagesFromSessionSnapshot} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentSessionSnapshotDto} from "nbook/shared/dto/agent-session.dto";

const baseSnapshot = (entries: AgentSessionSnapshotDto["entries"]): AgentSessionSnapshotDto => ({
    summary: {
        sessionId: 1,
        profileKey: "leader.default",
        workspaceKey: "global",
        workspaceRoot: ".",
        status: "idle",
        updatedAt: 1,
        archived: false,
    },
    activeLeafId: null,
    messages: [],
    tree: [],
    entries,
    linkedAgents: [],
    pendingApproval: null,
    followUpQueue: [],
    activeInvocation: null,
    model: null,
    planModeActive: false,
    lastSeq: 0,
});

describe("agent message projection", () => {
    it("在对话顶部展示当前 profile system prompt", () => {
        const snapshot = baseSnapshot([]);
        snapshot.systemPrompt = "# Leader\n\n保持协作。";

        const messages = deriveMessagesFromSessionSnapshot(snapshot);

        expect(messages[0]).toEqual(expect.objectContaining({
            id: "system-prompt:1:leader.default",
            type: "system",
            systemDisplayKind: "prompt",
            systemLabel: "System Prompt",
            content: "# Leader\n\n保持协作。",
        }));
    });

    it("把 system-reminder custom_message 投影为轻量系统提醒", () => {
        const messages = deriveMessagesFromSessionSnapshot(baseSnapshot([{
            id: "reminder-1",
            parentId: null,
            timestamp: Date.now(),
            type: "custom_message",
            visibleToModel: true,
            message: {
                role: "custom",
                customType: "system-reminder",
                content: "<system-reminder>记得检查计划。</system-reminder>",
                display: true,
                timestamp: Date.now(),
            } as never,
        }]));

        expect(messages).toEqual([
            expect.objectContaining({
                id: "reminder-1",
                type: "system",
                systemDisplayKind: "reminder",
                systemLabel: "System Reminder",
                content: "<system-reminder>记得检查计划。</system-reminder>",
            }),
        ]);
    });

    it("把普通 custom_message 与 compaction/branch summary 投影为系统卡片", () => {
        const messages = deriveMessagesFromSessionSnapshot(baseSnapshot([
            {
                id: "custom-1",
                parentId: null,
                timestamp: Date.now(),
                type: "custom_message",
                visibleToModel: true,
                message: {
                    role: "custom",
                    customType: "note",
                    content: "运行期提示",
                    display: true,
                    timestamp: Date.now(),
                } as never,
            },
            {
                id: "compact-1",
                parentId: "custom-1",
                timestamp: Date.now(),
                type: "compaction",
                summary: "压缩摘要",
                firstKeptEntryId: null,
                tokensBefore: 100,
            },
            {
                id: "branch-1",
                parentId: "compact-1",
                timestamp: Date.now(),
                type: "branch_summary",
                fromLeafId: "a",
                toLeafId: "b",
                summary: "分支摘要",
            },
        ]));

        expect(messages.map((message) => ({
            id: message.id,
            label: message.systemLabel,
            content: message.content,
        }))).toEqual([
            {id: "custom-1", label: "Custom: note", content: "运行期提示"},
            {id: "compact-1", label: "Compaction", content: "压缩摘要"},
            {id: "branch-1", label: "Branch Summary", content: "分支摘要"},
        ]);
    });

});
