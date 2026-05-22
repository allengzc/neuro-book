import {describe, expect, it} from "vitest";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import {deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";

const node = (patch: Partial<SessionTreeNode> & Pick<SessionTreeNode, "id" | "parentId">): SessionTreeNode => ({
    type: "message",
    timestamp: 1,
    active: false,
    terminal: true,
    childCount: 0,
    role: "assistant",
    messageId: patch.id,
    ...patch,
});

describe("agent session tree", () => {
    it("为 active path 上每个有 sibling 的消息派生切换状态", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: false}),
            node({id: "a2", parentId: "u1", timestamp: 3, active: true}),
            node({id: "u2", parentId: "a2", role: "user", timestamp: 4, active: true}),
            node({id: "u3", parentId: "a2", role: "user", timestamp: 5, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.switcherByMessageId.a2).toEqual({
            nodeIds: ["a1", "a2"],
            currentIndex: 1,
            total: 2,
        });
        expect(state.switcherByMessageId.u2).toEqual({
            nodeIds: ["u2", "u3"],
            currentIndex: 0,
            total: 2,
        });
    });

    it("切换 sibling 时定位到该分支最新 terminal descendant", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: false, terminal: false, childCount: 1}),
            node({id: "a1-u1", parentId: "a1", role: "user", timestamp: 10, active: false}),
            node({id: "a2", parentId: "u1", timestamp: 3, active: true}),
        ];

        const state = deriveAgentTreeState(tree);
        const target = resolveBranchSwitchTarget(state, "a2", 1);

        expect(target?.id).toBe("a1-u1");
    });

    it("按树结构 preorder 展开，而不是按 JSONL append 顺序展示", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: true}),
            node({id: "u2", parentId: "a1", role: "user", timestamp: 3, active: true}),
            node({id: "a2", parentId: "u1", timestamp: 4, active: false}),
            node({id: "a2-u1", parentId: "a2", role: "user", timestamp: 10, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.flattenedNodes.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2", "a2-u1"]);
    });
});
